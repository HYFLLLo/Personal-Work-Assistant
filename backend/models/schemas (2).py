from pydantic import BaseModel, Field
from typing import List, Dict, Any, TypedDict, Optional, Literal


class WorkState(TypedDict):
    user_query: str
    plan_steps: List[str]
    search_results: List[Dict[str, Any]]
    verification: Dict[str, Any]
    final_report: str
    retry_count: int
    # 多轮对话新增字段
    conversation_id: Optional[str]
    operation_type: str  # generate/follow_up/modify/supplement
    selected_text: Optional[str]  # 用户选中的段落
    position: Optional[str]  # 补充内容的插入位置
    answer: Optional[str]  # 追问的回答


class StreamRequest(BaseModel):
    query: str = Field(..., max_length=500, description="用户查询内容")
    conversation_id: Optional[str] = Field(None, description="会话ID，首次请求为空")
    operation_type: str = Field("generate", description="操作类型：generate/follow_up/modify/supplement")
    selected_text: Optional[str] = Field(None, description="选中的段落内容")
    position: Optional[str] = Field(None, description="插入位置")


class PlannerUpdate(BaseModel):
    step: str
    plan: List[str]


class SearchResult(BaseModel):
    query: str
    snippet: str


class VerificationFeedback(BaseModel):
    is_valid: bool
    reason: str


class FinalReport(BaseModel):
    content: str


class ErrorReport(BaseModel):
    error: str
    message: str
