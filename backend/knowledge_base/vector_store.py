"""
向量存储模块
基于ChromaDB实现文档向量的存储和相似度检索
使用Ollama本地嵌入模型
"""

import os
import uuid
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
import logging
import requests

from .models import DocumentChunk, SearchResult
from backend.config import settings

logger = logging.getLogger(__name__)


class VectorStore:
    """向量存储类"""
    
    def __init__(
        self,
        collection_name: str = "knowledge_base",
        persist_directory: str = "./chroma_db",
        ollama_url: str = None,
        ollama_model: str = None
    ):
        """
        初始化向量存储
        
        Args:
            collection_name: 集合名称
            persist_directory: 持久化目录
            ollama_url: Ollama服务地址
            ollama_model: Ollama嵌入模型名称
        """
        self.collection_name = collection_name
        self.persist_directory = persist_directory
        # 使用配置文件中的设置，或传入的参数
        self.ollama_url = ollama_url or settings.ollama_base_url
        self.ollama_model = ollama_model or settings.ollama_embed_model
        self.ollama_model_fallback = settings.ollama_embed_model_fallback
        self.collection = None
        
        # 确保目录存在
        os.makedirs(persist_directory, exist_ok=True)
        
        # 初始化
        self._init_chroma()
        self._check_ollama()
    
    def _init_chroma(self):
        """初始化ChromaDB"""
        try:
            import chromadb
            from chromadb.config import Settings
            
            # 使用新的ChromaDB配置方式
            settings = Settings(
                persist_directory=self.persist_directory,
                anonymized_telemetry=False,
                is_persistent=True
            )
            
            self.chroma_client = chromadb.Client(settings)
            
            # 获取或创建集合
            self.collection = self.chroma_client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"}  # 使用余弦相似度
            )
            
            logger.info(f"ChromaDB初始化成功，集合: {self.collection_name}")
            
        except Exception as e:
            logger.error(f"ChromaDB初始化失败: {str(e)}")
            raise
    
    def _check_ollama(self):
        """检查Ollama服务是否可用"""
        try:
            response = requests.get(f"{self.ollama_url}/api/tags", timeout=5)
            if response.status_code == 200:
                models = response.json().get('models', [])
                model_names = [m['name'] for m in models]
                logger.info(f"Ollama服务可用，已安装模型: {model_names}")
                
                # 检查指定的嵌入模型是否可用
                if self.ollama_model not in model_names:
                    logger.warning(f"指定的嵌入模型 '{self.ollama_model}' 未找到，将尝试使用其他可用模型")
                    
                    # 首先尝试使用配置的备用模型
                    if self.ollama_model_fallback in model_names:
                        self.ollama_model = self.ollama_model_fallback
                        logger.info(f"使用备用嵌入模型: {self.ollama_model_fallback}")
                    else:
                        # 尝试查找其他嵌入模型
                        for name in model_names:
                            if 'embed' in name.lower():
                                self.ollama_model = name
                                logger.info(f"使用替代嵌入模型: {name}")
                                break
            else:
                logger.warning("Ollama服务响应异常，将使用备用嵌入方案")
        except Exception as e:
            logger.warning(f"Ollama服务检查失败: {str(e)}，将使用备用嵌入方案")
    
    def _ollama_embed(self, text: str) -> List[float]:
        """
        使用Ollama生成嵌入向量
        
        Args:
            text: 输入文本
            
        Returns:
            向量表示（固定768维）
        """
        try:
            response = requests.post(
                f"{self.ollama_url}/api/embeddings",
                json={
                    "model": self.ollama_model,
                    "prompt": text
                },
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                embedding = result.get('embedding', [])
                if embedding:
                    # 确保向量维度为768维
                    target_dim = 768
                    current_dim = len(embedding)
                    
                    if current_dim == target_dim:
                        return embedding
                    elif current_dim > target_dim:
                        # 截断到768维
                        return embedding[:target_dim]
                    else:
                        # 填充到768维
                        embedding.extend([0.0] * (target_dim - current_dim))
                        return embedding
            
            logger.warning(f"Ollama嵌入生成失败，状态码: {response.status_code}")
            return self._fallback_encode(text)
            
        except Exception as e:
            logger.warning(f"Ollama嵌入请求失败: {str(e)}")
            return self._fallback_encode(text)
    
    def _fallback_encode(self, text: str) -> List[float]:
        """
        备用编码方案：基于简单词频的哈希向量
        当Ollama不可用时使用
        """
        import hashlib
        
        # 生成768维的向量（与nomic-embed-text模型一致）
        vector_dim = 768
        vector = np.zeros(vector_dim)
        
        # 使用字符n-gram生成向量
        text = text.lower()
        for i in range(len(text) - 2):
            trigram = text[i:i+3]
            hash_val = int(hashlib.md5(trigram.encode()).hexdigest(), 16)
            idx = hash_val % vector_dim
            vector[idx] += 1
        
        # 归一化
        norm = np.linalg.norm(vector)
        if norm > 0:
            vector = vector / norm
        
        return vector.tolist()
    
    def encode_text(self, text: str) -> List[float]:
        """
        将文本编码为向量
        
        Args:
            text: 输入文本
            
        Returns:
            向量表示
        """
        try:
            # 优先使用Ollama
            return self._ollama_embed(text)
        except Exception as e:
            logger.error(f"文本编码失败: {str(e)}")
            return self._fallback_encode(text)
    
    def encode_texts(self, texts: List[str]) -> List[List[float]]:
        """
        批量编码文本
        
        Args:
            texts: 文本列表
            
        Returns:
            向量列表
        """
        embeddings = []
        for text in texts:
            try:
                embedding = self._ollama_embed(text)
                embeddings.append(embedding)
            except Exception as e:
                logger.warning(f"批量编码中单条失败: {str(e)}")
                embeddings.append(self._fallback_encode(text))
        return embeddings
    
    def add_chunks(self, chunks: List[DocumentChunk]) -> bool:
        """
        添加文档块到向量存储
        
        Args:
            chunks: 文档块列表
            
        Returns:
            是否成功
        """
        if not chunks:
            return True
        
        try:
            # 准备数据
            ids = []
            documents = []
            embeddings = []
            metadatas = []
            
            logger.info(f"开始为 {len(chunks)} 个文档块生成嵌入向量...")
            
            for chunk in chunks:
                # 生成嵌入
                if not chunk.embedding:
                    chunk.embedding = self.encode_text(chunk.content)
                
                ids.append(chunk.chunk_id)
                documents.append(chunk.content)
                embeddings.append(chunk.embedding)
                metadatas.append({
                    'document_id': chunk.document_id,
                    'chunk_index': chunk.chunk_index,
                    'start_pos': chunk.start_pos,
                    'end_pos': chunk.end_pos,
                    **chunk.metadata
                })
            
            # 批量添加到ChromaDB
            self.collection.add(
                ids=ids,
                documents=documents,
                embeddings=embeddings,
                metadatas=metadatas
            )
            
            logger.info(f"成功添加 {len(chunks)} 个文档块到向量存储")
            return True
            
        except Exception as e:
            logger.error(f"添加文档块失败: {str(e)}")
            return False
    
    def search(
        self,
        query: str,
        top_k: int = 5,
        score_threshold: float = 0.5
    ) -> List[SearchResult]:
        """
        相似度搜索
        
        Args:
            query: 查询文本
            top_k: 返回结果数量
            score_threshold: 相似度阈值 (0-1，越大越相似)
            
        Returns:
            搜索结果列表
        """
        try:
            # 编码查询
            query_embedding = self.encode_text(query)
            
            # 执行搜索
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
                include=['documents', 'metadatas', 'distances']
            )
            
            # 解析结果
            search_results = []
            
            if results['ids'] and len(results['ids'][0]) > 0:
                for i, chunk_id in enumerate(results['ids'][0]):
                    # ChromaDB返回的是距离，需要转换为相似度分数
                    distance = results['distances'][0][i]
                    # 余弦距离转相似度: 1 - distance
                    similarity = 1 - distance
                    
                    # 过滤低相似度结果
                    if similarity < score_threshold:
                        continue
                    
                    metadata = results['metadatas'][0][i]
                    content = results['documents'][0][i]
                    
                    chunk = DocumentChunk(
                        chunk_id=chunk_id,
                        document_id=metadata['document_id'],
                        content=content,
                        chunk_index=metadata['chunk_index'],
                        start_pos=metadata['start_pos'],
                        end_pos=metadata['end_pos'],
                        metadata={k: v for k, v in metadata.items() 
                                if k not in ['document_id', 'chunk_index', 'start_pos', 'end_pos']}
                    )
                    
                    search_results.append(SearchResult(
                        chunk=chunk,
                        score=similarity
                    ))
            
            # 按相似度排序
            search_results.sort(key=lambda x: x.score, reverse=True)
            
            logger.info(f"搜索完成，找到 {len(search_results)} 个相关结果")
            return search_results
            
        except Exception as e:
            logger.error(f"搜索失败: {str(e)}")
            return []
    
    def delete_by_document_id(self, document_id: str) -> bool:
        """
        删除指定文档的所有块
        
        Args:
            document_id: 文档ID
            
        Returns:
            是否成功
        """
        try:
            # 先查询获取所有相关chunk_id
            results = self.collection.get(
                where={"document_id": document_id}
            )
            
            if results['ids']:
                self.collection.delete(ids=results['ids'])
                logger.info(f"成功删除文档 {document_id} 的 {len(results['ids'])} 个块")
            
            return True
            
        except Exception as e:
            logger.error(f"删除文档块失败: {str(e)}")
            return False
    
    def get_stats(self) -> Dict[str, Any]:
        """获取存储统计信息"""
        try:
            count = self.collection.count()
            return {
                'total_chunks': count,
                'collection_name': self.collection_name,
                'persist_directory': self.persist_directory,
                'embedding_model': self.ollama_model
            }
        except Exception as e:
            logger.error(f"获取统计信息失败: {str(e)}")
            return {'total_chunks': 0}
    
    def clear(self) -> bool:
        """清空所有数据"""
        try:
            self.chroma_client.delete_collection(self.collection_name)
            self.collection = self.chroma_client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"}
            )
            logger.info("向量存储已清空")
            return True
        except Exception as e:
            logger.error(f"清空存储失败: {str(e)}")
            return False


# 全局向量存储实例
vector_store = VectorStore()
