"""
知识库管理器
统一管理文档的上传、解析、存储和检索
"""

import os
import uuid
import shutil
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
import logging
import json

from .models import (
    Document, DocumentChunk, DocumentType, DocumentStatus,
    KnowledgeBase, SearchResult, RelevanceCheckResult
)
from .document_parser import DocumentParser
from .vector_store import VectorStore
from .relevance_checker import RelevanceChecker

logger = logging.getLogger(__name__)


class KnowledgeBaseManager:
    """知识库管理器类"""
    
    def __init__(
        self,
        upload_dir: str = "./uploads",
        db_path: str = "./knowledge_base_db.json"
    ):
        """
        初始化知识库管理器
        
        Args:
            upload_dir: 文件上传目录
            db_path: 元数据数据库路径
        """
        self.upload_dir = upload_dir
        self.db_path = db_path
        self.documents: Dict[str, Document] = {}
        self.knowledge_bases: Dict[str, KnowledgeBase] = {}
        
        # 初始化组件
        self.parser = DocumentParser()
        self.vector_store = VectorStore()
        self.relevance_checker = RelevanceChecker(self.vector_store)
        
        # 确保目录存在
        os.makedirs(upload_dir, exist_ok=True)
        
        # 加载已有数据
        self._load_db()
    
    def _load_db(self):
        """从JSON文件加载数据"""
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    
                    # 加载文档
                    for doc_data in data.get('documents', []):
                        doc = Document(**doc_data)
                        self.documents[doc.document_id] = doc
                    
                    # 加载知识库
                    for kb_data in data.get('knowledge_bases', []):
                        kb = KnowledgeBase(**kb_data)
                        self.knowledge_bases[kb.kb_id] = kb
                
                logger.info(f"知识库数据加载完成: {len(self.documents)} 个文档, {len(self.knowledge_bases)} 个知识库")
            except Exception as e:
                logger.error(f"加载知识库数据失败: {str(e)}")
    
    def _save_db(self):
        """保存数据到JSON文件"""
        try:
            data = {
                'documents': [doc.model_dump() for doc in self.documents.values()],
                'knowledge_bases': [kb.model_dump() for kb in self.knowledge_bases.values()]
            }
            
            with open(self.db_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
            
            logger.info("知识库数据已保存")
        except Exception as e:
            logger.error(f"保存知识库数据失败: {str(e)}")
    
    def upload_document(
        self,
        file_content: bytes,
        filename: str,
        kb_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        上传并处理文档
        
        Args:
            file_content: 文件内容
            filename: 文件名
            kb_id: 目标知识库ID（可选）
            
        Returns:
            处理结果
        """
        document_id = str(uuid.uuid4())
        
        try:
            # 1. 检查文件类型
            if not self.parser.is_supported(filename):
                return {
                    'success': False,
                    'error': f'不支持的文件类型: {Path(filename).suffix}'
                }
            
            # 2. 检查文件大小
            file_size = len(file_content)
            if file_size > self.parser.MAX_FILE_SIZE:
                return {
                    'success': False,
                    'error': f'文件大小超过限制 ({self.parser.MAX_FILE_SIZE / 1024 / 1024}MB)'
                }
            
            # 3. 保存文件
            file_ext = Path(filename).suffix
            file_path = os.path.join(self.upload_dir, f"{document_id}{file_ext}")
            
            with open(file_path, 'wb') as f:
                f.write(file_content)
            
            # 4. 创建文档记录
            doc_type = self.parser.get_document_type(filename)
            document = Document(
                document_id=document_id,
                filename=filename,
                file_type=doc_type,
                file_size=file_size,
                file_path=file_path,
                status=DocumentStatus.PROCESSING
            )
            
            self.documents[document_id] = document
            
            # 5. 解析文档
            logger.info(f"开始解析文档: {filename}")
            parse_result = self.parser.parse(file_path)
            
            # 更新文档状态
            document.status = parse_result['status']
            document.content = parse_result.get('content', '')
            document.metadata = parse_result.get('metadata', {})
            
            if parse_result['status'] == DocumentStatus.FAILED:
                document.error_message = parse_result.get('error_message', '解析失败')
                self._save_db()
                return {
                    'success': False,
                    'document_id': document_id,
                    'error': document.error_message
                }
            
            # 6. 分块处理
            logger.info(f"开始分块处理: {filename}")
            chunks_data = self.parser.chunk_text(document.content, chunk_size=500, overlap=50)
            
            # 7. 创建文档块并生成嵌入
            chunks = []
            for i, chunk_data in enumerate(chunks_data):
                chunk = DocumentChunk(
                    chunk_id=f"{document_id}_chunk_{i}",
                    document_id=document_id,
                    content=chunk_data['content'],
                    chunk_index=i,
                    start_pos=chunk_data['start_pos'],
                    end_pos=chunk_data['end_pos']
                )
                chunks.append(chunk)
            
            # 8. 批量生成嵌入并存储
            logger.info(f"开始生成向量嵌入: {len(chunks)} 个块")
            success = self.vector_store.add_chunks(chunks)
            
            if not success:
                document.status = DocumentStatus.FAILED
                document.error_message = "向量存储失败"
                self._save_db()
                return {
                    'success': False,
                    'document_id': document_id,
                    'error': '向量存储失败'
                }
            
            document.chunks = chunks
            document.status = DocumentStatus.COMPLETED
            document.updated_at = datetime.now()
            
            # 9. 如果指定了知识库，添加到知识库
            if kb_id and kb_id in self.knowledge_bases:
                kb = self.knowledge_bases[kb_id]
                if document_id not in kb.documents:
                    kb.documents.append(document_id)
                    kb.updated_at = datetime.now()
            
            # 10. 保存数据
            self._save_db()
            
            logger.info(f"文档上传成功: {filename}, ID: {document_id}")
            
            return {
                'success': True,
                'document_id': document_id,
                'filename': filename,
                'file_type': doc_type.value,
                'file_size': file_size,
                'chunk_count': len(chunks),
                'word_count': len(document.content),
                'status': document.status.value
            }
            
        except Exception as e:
            logger.error(f"文档上传失败: {filename}, 错误: {str(e)}")
            
            # 清理文件
            if os.path.exists(file_path):
                os.remove(file_path)
            
            # 如果有文档记录，更新状态
            if document_id in self.documents:
                self.documents[document_id].status = DocumentStatus.FAILED
                self.documents[document_id].error_message = str(e)
                self._save_db()
            
            return {
                'success': False,
                'document_id': document_id,
                'error': str(e)
            }
    
    def delete_document(self, document_id: str) -> bool:
        """
        删除文档
        
        Args:
            document_id: 文档ID
            
        Returns:
            是否成功
        """
        try:
            if document_id not in self.documents:
                return False
            
            document = self.documents[document_id]
            
            # 1. 从向量存储删除
            self.vector_store.delete_by_document_id(document_id)
            
            # 2. 删除文件
            if os.path.exists(document.file_path):
                os.remove(document.file_path)
            
            # 3. 从知识库中移除引用
            for kb in self.knowledge_bases.values():
                if document_id in kb.documents:
                    kb.documents.remove(document_id)
            
            # 4. 删除文档记录
            del self.documents[document_id]
            
            # 5. 保存数据
            self._save_db()
            
            logger.info(f"文档删除成功: {document_id}")
            return True
            
        except Exception as e:
            logger.error(f"文档删除失败: {document_id}, 错误: {str(e)}")
            return False
    
    def get_document(self, document_id: str) -> Optional[Document]:
        """获取文档信息"""
        return self.documents.get(document_id)
    
    def list_documents(
        self,
        kb_id: Optional[str] = None,
        status: Optional[DocumentStatus] = None
    ) -> List[Document]:
        """
        列出文档
        
        Args:
            kb_id: 知识库ID（可选）
            status: 状态过滤（可选）
            
        Returns:
            文档列表
        """
        docs = list(self.documents.values())
        
        if kb_id:
            if kb_id in self.knowledge_bases:
                doc_ids = set(self.knowledge_bases[kb_id].documents)
                docs = [d for d in docs if d.document_id in doc_ids]
            else:
                return []
        
        if status:
            docs = [d for d in docs if d.status == status]
        
        # 按时间倒序
        docs.sort(key=lambda x: x.created_at, reverse=True)
        
        return docs
    
    def search_knowledge_base(
        self,
        query: str,
        top_k: int = 5,
        kb_id: Optional[str] = None
    ) -> List[SearchResult]:
        """
        搜索知识库
        
        Args:
            query: 查询文本
            top_k: 返回结果数量
            kb_id: 知识库ID（可选，None表示搜索全部）
            
        Returns:
            搜索结果列表
        """
        try:
            # 执行向量搜索
            results = self.vector_store.search(query, top_k=top_k)
            
            # 如果指定了知识库，过滤结果
            if kb_id and kb_id in self.knowledge_bases:
                kb_doc_ids = set(self.knowledge_bases[kb_id].documents)
                results = [r for r in results if r.chunk.document_id in kb_doc_ids]
            
            # 补充文档信息
            for result in results:
                result.document = self.documents.get(result.chunk.document_id)
            
            return results
            
        except Exception as e:
            logger.error(f"知识库搜索失败: {str(e)}")
            return []
    
    def check_relevance(
        self,
        query: str,
        top_k: int = 5
    ) -> RelevanceCheckResult:
        """
        检查知识库内容是否足够回答查询
        
        Args:
            query: 用户查询
            top_k: 检索结果数量
            
        Returns:
            相关性检查结果
        """
        return self.relevance_checker.check_relevance(query, top_k=top_k)
    
    def create_knowledge_base(self, name: str, description: str = "") -> KnowledgeBase:
        """
        创建知识库
        
        Args:
            name: 知识库名称
            description: 描述
            
        Returns:
            创建的知识库
        """
        kb = KnowledgeBase(
            kb_id=str(uuid.uuid4()),
            name=name,
            description=description
        )
        
        self.knowledge_bases[kb.kb_id] = kb
        self._save_db()
        
        logger.info(f"知识库创建成功: {name}, ID: {kb.kb_id}")
        return kb
    
    def delete_knowledge_base(self, kb_id: str) -> bool:
        """
        删除知识库（不删除文档）
        
        Args:
            kb_id: 知识库ID
            
        Returns:
            是否成功
        """
        if kb_id not in self.knowledge_bases:
            return False
        
        del self.knowledge_bases[kb_id]
        self._save_db()
        
        logger.info(f"知识库删除成功: {kb_id}")
        return True
    
    def get_knowledge_base(self, kb_id: str) -> Optional[KnowledgeBase]:
        """获取知识库信息"""
        return self.knowledge_bases.get(kb_id)
    
    def list_knowledge_bases(self) -> List[KnowledgeBase]:
        """列出所有知识库"""
        return list(self.knowledge_bases.values())
    
    def add_document_to_kb(self, document_id: str, kb_id: str) -> bool:
        """
        将文档添加到知识库
        
        Args:
            document_id: 文档ID
            kb_id: 知识库ID
            
        Returns:
            是否成功
        """
        if document_id not in self.documents or kb_id not in self.knowledge_bases:
            return False
        
        kb = self.knowledge_bases[kb_id]
        if document_id not in kb.documents:
            kb.documents.append(document_id)
            kb.updated_at = datetime.now()
            self._save_db()
        
        return True
    
    def remove_document_from_kb(self, document_id: str, kb_id: str) -> bool:
        """
        从知识库移除文档
        
        Args:
            document_id: 文档ID
            kb_id: 知识库ID
            
        Returns:
            是否成功
        """
        if kb_id not in self.knowledge_bases:
            return False
        
        kb = self.knowledge_bases[kb_id]
        if document_id in kb.documents:
            kb.documents.remove(document_id)
            kb.updated_at = datetime.now()
            self._save_db()
        
        return True
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        vector_stats = self.vector_store.get_stats()
        
        return {
            'total_documents': len(self.documents),
            'total_knowledge_bases': len(self.knowledge_bases),
            'completed_documents': len([d for d in self.documents.values() if d.status == DocumentStatus.COMPLETED]),
            'failed_documents': len([d for d in self.documents.values() if d.status == DocumentStatus.FAILED]),
            'vector_store': vector_stats
        }


# 全局知识库管理器实例
knowledge_base_manager = KnowledgeBaseManager()
