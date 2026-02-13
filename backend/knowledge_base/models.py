"""
知识库数据模型
"""

from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime
from enum import Enum


class DocumentType(str, Enum):
    """文档类型枚举"""
    TXT = "txt"
    DOC = "doc"
    DOCX = "docx"
    XLS = "xls"
    XLSX = "xlsx"
    PPT = "ppt"
    PPTX = "pptx"
    PDF = "pdf"
    MD = "md"


class DocumentStatus(str, Enum):
    """文档状态枚举"""
    PENDING = "pending"           # 待处理
    PROCESSING = "processing"     # 处理中
    COMPLETED = "completed"       # 已完成
    FAILED = "failed"             # 处理失败


class DocumentChunk(BaseModel):
    """文档分块模型"""
    chunk_id: str
    document_id: str
    content: str
    embedding: Optional[List[float]] = None
    chunk_index: int
    start_pos: int
    end_pos: int
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Document(BaseModel):
    """文档模型"""
    document_id: str
    filename: str
    file_type: DocumentType
    file_size: int
    file_path: str
    status: DocumentStatus = DocumentStatus.PENDING
    content: Optional[str] = None
    chunks: List[DocumentChunk] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    error_message: Optional[str] = None


class KnowledgeBase(BaseModel):
    """知识库模型"""
    kb_id: str
    name: str
    description: str
    documents: List[str] = Field(default_factory=list)  # document_id列表
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SearchResult(BaseModel):
    """搜索结果模型"""
    chunk: DocumentChunk
    score: float
    document: Optional[Document] = None


class RelevanceCheckResult(BaseModel):
    """相关性检查结果"""
    is_sufficient: bool
    confidence: float
    reason: str
    relevant_chunks: List[SearchResult]
    coverage_score: float
