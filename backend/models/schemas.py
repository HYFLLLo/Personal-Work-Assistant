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
    # 报告模板字段
    template_id: Optional[str]  # 报告模板ID
    # 知识库文档字段
    document_id: Optional[str]  # 指定使用的知识库文档ID
    # 智能工作流新增字段 (v5.0)
    # 意图识别
    intent_analysis: Optional[Dict[str, Any]]  # 意图分析结果
    # 知识库评估
    kb_sufficiency_level: Optional[str]  # 'sufficient' | 'insufficient' | 'irrelevant'
    kb_relevance_score: float  # 相关性分数 0-1
    kb_coverage_score: float  # 覆盖度分数 0-1
    # 用户确认
    needs_user_confirmation: bool  # 是否需要用户确认
    user_confirmation_status: Optional[str]  # 'pending' | 'confirmed' | 'declined' | 'timeout'
    user_confirmed_search: Optional[bool]  # 用户是否同意搜索
    confirmation_prompt: Optional[str]  # 确认提示文本


class StreamRequest(BaseModel):
    query: str = Field(..., max_length=500, description="用户查询内容")
    conversation_id: Optional[str] = Field(None, description="会话ID，首次请求为空")
    operation_type: str = Field("generate", description="操作类型：generate/follow_up/modify/supplement")
    selected_text: Optional[str] = Field(None, description="选中的段落内容")
    position: Optional[str] = Field(None, description="插入位置")
    template_id: Optional[str] = Field(None, description="报告模板ID，如weekly/monthly/competitor等")
    document_id: Optional[str] = Field(None, description="知识库文档ID，指定使用特定文档生成报告")


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
