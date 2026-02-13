"""
知识库API路由
提供文档上传、管理和检索接口
"""

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import JSONResponse
from typing import List, Optional
import logging

from backend.knowledge_base import knowledge_base_manager
from backend.knowledge_base.models import DocumentStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge-base", tags=["knowledge-base"])


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    kb_id: Optional[str] = Query(None, description="目标知识库ID")
):
    """
    上传文档到知识库
    
    支持格式: txt, md, doc, docx, xls, xlsx, ppt, pptx, pdf
    """
    try:
        # 读取文件内容
        content = await file.read()
        
        # 检查文件大小 (50MB)
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(400, "文件大小超过50MB限制")
        
        # 上传并处理文档
        result = knowledge_base_manager.upload_document(
            file_content=content,
            filename=file.filename,
            kb_id=kb_id
        )
        
        if not result['success']:
            raise HTTPException(400, result['error'])
        
        return JSONResponse(content=result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"文档上传接口错误: {str(e)}")
        raise HTTPException(500, f"上传失败: {str(e)}")


@router.get("/documents")
async def list_documents(
    kb_id: Optional[str] = Query(None, description="知识库ID过滤"),
    status: Optional[str] = Query(None, description="状态过滤: pending/processing/completed/failed")
):
    """列出所有文档"""
    try:
        # 转换状态枚举
        status_enum = None
        if status:
            try:
                status_enum = DocumentStatus(status)
            except ValueError:
                raise HTTPException(400, f"无效的状态值: {status}")
        
        documents = knowledge_base_manager.list_documents(
            kb_id=kb_id,
            status=status_enum
        )
        
        return JSONResponse(content={
            'documents': [
                {
                    'document_id': doc.document_id,
                    'filename': doc.filename,
                    'file_type': doc.file_type.value,
                    'file_size': doc.file_size,
                    'status': doc.status.value,
                    'chunk_count': len(doc.chunks),
                    'word_count': len(doc.content) if doc.content else 0,
                    'created_at': doc.created_at.isoformat(),
                    'updated_at': doc.updated_at.isoformat(),
                    'error_message': doc.error_message
                }
                for doc in documents
            ],
            'total': len(documents)
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"列出文档接口错误: {str(e)}")
        raise HTTPException(500, f"查询失败: {str(e)}")


@router.get("/documents/{document_id}")
async def get_document(document_id: str):
    """获取文档详情"""
    try:
        document = knowledge_base_manager.get_document(document_id)
        
        if not document:
            raise HTTPException(404, "文档不存在")
        
        return JSONResponse(content={
            'document_id': document.document_id,
            'filename': document.filename,
            'file_type': document.file_type.value,
            'file_size': document.file_size,
            'status': document.status.value,
            'content_preview': document.content[:1000] if document.content else None,
            'chunk_count': len(document.chunks),
            'word_count': len(document.content) if document.content else 0,
            'metadata': document.metadata,
            'created_at': document.created_at.isoformat(),
            'updated_at': document.updated_at.isoformat(),
            'error_message': document.error_message
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取文档接口错误: {str(e)}")
        raise HTTPException(500, f"查询失败: {str(e)}")


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """删除文档"""
    try:
        success = knowledge_base_manager.delete_document(document_id)
        
        if not success:
            raise HTTPException(404, "文档不存在或删除失败")
        
        return JSONResponse(content={
            'success': True,
            'message': '文档已删除'
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除文档接口错误: {str(e)}")
        raise HTTPException(500, f"删除失败: {str(e)}")


@router.post("/search")
async def search_knowledge_base(
    query: str,
    top_k: int = Query(5, ge=1, le=20),
    kb_id: Optional[str] = Query(None)
):
    """
    搜索知识库
    
    返回与查询最相关的文档片段
    """
    try:
        results = knowledge_base_manager.search_knowledge_base(
            query=query,
            top_k=top_k,
            kb_id=kb_id
        )
        
        return JSONResponse(content={
            'query': query,
            'results': [
                {
                    'chunk_id': result.chunk.chunk_id,
                    'document_id': result.chunk.document_id,
                    'filename': result.document.filename if result.document else None,
                    'content': result.chunk.content,
                    'score': result.score,
                    'chunk_index': result.chunk.chunk_index
                }
                for result in results
            ],
            'total': len(results)
        })
        
    except Exception as e:
        logger.error(f"搜索知识库接口错误: {str(e)}")
        raise HTTPException(500, f"搜索失败: {str(e)}")


@router.post("/check-relevance")
async def check_relevance(
    query: str,
    top_k: int = Query(5, ge=1, le=10)
):
    """
    检查知识库内容是否足够回答查询
    
    返回相关性评估结果，包括是否足够、置信度、相关片段等
    """
    try:
        result = knowledge_base_manager.check_relevance(query, top_k=top_k)
        
        return JSONResponse(content={
            'query': query,
            'is_sufficient': result.is_sufficient,
            'confidence': result.confidence,
            'reason': result.reason,
            'coverage_score': result.coverage_score,
            'relevant_chunks': [
                {
                    'chunk_id': r.chunk.chunk_id,
                    'document_id': r.chunk.document_id,
                    'filename': r.document.filename if r.document else None,
                    'content': r.chunk.content[:200] + '...' if len(r.chunk.content) > 200 else r.chunk.content,
                    'score': r.score
                }
                for r in result.relevant_chunks
            ]
        })
        
    except Exception as e:
        logger.error(f"相关性检查接口错误: {str(e)}")
        raise HTTPException(500, f"检查失败: {str(e)}")


# ============ 知识库管理接口 ============

@router.post("/create")
async def create_knowledge_base(
    name: str,
    description: str = ""
):
    """创建新知识库"""
    try:
        kb = knowledge_base_manager.create_knowledge_base(name, description)
        
        return JSONResponse(content={
            'success': True,
            'knowledge_base': {
                'kb_id': kb.kb_id,
                'name': kb.name,
                'description': kb.description,
                'document_count': len(kb.documents),
                'created_at': kb.created_at.isoformat()
            }
        })
        
    except Exception as e:
        logger.error(f"创建知识库接口错误: {str(e)}")
        raise HTTPException(500, f"创建失败: {str(e)}")


@router.get("/list")
async def list_knowledge_bases():
    """列出所有知识库"""
    try:
        knowledge_bases = knowledge_base_manager.list_knowledge_bases()
        
        return JSONResponse(content={
            'knowledge_bases': [
                {
                    'kb_id': kb.kb_id,
                    'name': kb.name,
                    'description': kb.description,
                    'document_count': len(kb.documents),
                    'created_at': kb.created_at.isoformat(),
                    'updated_at': kb.updated_at.isoformat()
                }
                for kb in knowledge_bases
            ],
            'total': len(knowledge_bases)
        })
        
    except Exception as e:
        logger.error(f"列出知识库接口错误: {str(e)}")
        raise HTTPException(500, f"查询失败: {str(e)}")


@router.get("/{kb_id}")
async def get_knowledge_base(kb_id: str):
    """获取知识库详情"""
    try:
        kb = knowledge_base_manager.get_knowledge_base(kb_id)
        
        if not kb:
            raise HTTPException(404, "知识库不存在")
        
        # 获取文档详情
        documents = []
        for doc_id in kb.documents:
            doc = knowledge_base_manager.get_document(doc_id)
            if doc:
                documents.append({
                    'document_id': doc.document_id,
                    'filename': doc.filename,
                    'file_type': doc.file_type.value,
                    'status': doc.status.value
                })
        
        return JSONResponse(content={
            'kb_id': kb.kb_id,
            'name': kb.name,
            'description': kb.description,
            'documents': documents,
            'document_count': len(documents),
            'created_at': kb.created_at.isoformat(),
            'updated_at': kb.updated_at.isoformat()
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取知识库接口错误: {str(e)}")
        raise HTTPException(500, f"查询失败: {str(e)}")


@router.delete("/{kb_id}")
async def delete_knowledge_base(kb_id: str):
    """删除知识库（不删除文档）"""
    try:
        success = knowledge_base_manager.delete_knowledge_base(kb_id)
        
        if not success:
            raise HTTPException(404, "知识库不存在")
        
        return JSONResponse(content={
            'success': True,
            'message': '知识库已删除'
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除知识库接口错误: {str(e)}")
        raise HTTPException(500, f"删除失败: {str(e)}")


@router.post("/{kb_id}/documents/{document_id}")
async def add_document_to_kb(kb_id: str, document_id: str):
    """将文档添加到知识库"""
    try:
        success = knowledge_base_manager.add_document_to_kb(document_id, kb_id)
        
        if not success:
            raise HTTPException(400, "文档或知识库不存在")
        
        return JSONResponse(content={
            'success': True,
            'message': '文档已添加到知识库'
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"添加文档到知识库接口错误: {str(e)}")
        raise HTTPException(500, f"添加失败: {str(e)}")


@router.delete("/{kb_id}/documents/{document_id}")
async def remove_document_from_kb(kb_id: str, document_id: str):
    """从知识库移除文档"""
    try:
        success = knowledge_base_manager.remove_document_from_kb(document_id, kb_id)
        
        if not success:
            raise HTTPException(400, "知识库不存在")
        
        return JSONResponse(content={
            'success': True,
            'message': '文档已从知识库移除'
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"从知识库移除文档接口错误: {str(e)}")
        raise HTTPException(500, f"移除失败: {str(e)}")


@router.get("/stats")
async def get_stats():
    """获取知识库统计信息"""
    try:
        stats = knowledge_base_manager.get_stats()
        return JSONResponse(content=stats)
        
    except Exception as e:
        logger.error(f"获取统计信息接口错误: {str(e)}")
        raise HTTPException(500, f"查询失败: {str(e)}")
