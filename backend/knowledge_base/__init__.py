"""
知识库存储模块
提供文档管理、向量嵌入、相似度检索等功能
"""

from .models import Document, DocumentChunk, KnowledgeBase
from .document_parser import DocumentParser
from .vector_store import VectorStore
from .relevance_checker import RelevanceChecker
from .knowledge_base_manager import KnowledgeBaseManager, knowledge_base_manager

__all__ = [
    'Document',
    'DocumentChunk',
    'KnowledgeBase',
    'DocumentParser',
    'VectorStore',
    'RelevanceChecker',
    'KnowledgeBaseManager',
    'knowledge_base_manager'
]
