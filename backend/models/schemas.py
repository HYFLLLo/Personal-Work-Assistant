from pydantic import BaseModel, Field
from typing import List, Dict, Any, TypedDict


class WorkState(TypedDict):
    user_query: str
    plan_steps: List[str]
    search_results: List[Dict[str, Any]]
    verification: Dict[str, Any]
    final_report: str
    retry_count: int


class StreamRequest(BaseModel):
    query: str = Field(..., max_length=500, description="用户查询内容")


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
