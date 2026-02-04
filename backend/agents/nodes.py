from backend.models.schemas import WorkState
from backend.models.llm import deepseek_client
from backend.tools.search import search_tool
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)


def planner_node(state: WorkState) -> Dict[str, Any]:
    user_query = state["user_query"]
    
    messages = [
        {
            "role": "system",
            "content": "你是一个任务规划专家。请将用户的任务拆解为可执行的搜索步骤。每个步骤应该是一个具体的搜索查询。"
        },
        {
            "role": "user",
            "content": f"用户任务：{user_query}\n\n请生成3-5个搜索步骤来完成任务。"
        }
    ]
    
    response = deepseek_client.chat_completion(messages)
    
    plan_steps = [step.strip() for step in response.split("\n") if step.strip()]
    
    logger.info(f"Planner生成 {len(plan_steps)} 个步骤")
    
    return {
        "plan_steps": plan_steps,
        "search_results": [],
        "verification": {},
        "final_report": "",
        "retry_count": state.get("retry_count", 0)
    }


def executor_node(state: WorkState) -> Dict[str, Any]:
    plan_steps = state["plan_steps"]
    all_results = state.get("search_results", [])
    
    for step in plan_steps:
        results = search_tool.search(step, num_results=3)
        all_results.extend(results)
    
    logger.info(f"Executor累积 {len(all_results)} 条搜索结果")
    
    return {
        "search_results": all_results
    }


def verifier_node(state: WorkState) -> Dict[str, Any]:
    user_query = state["user_query"]
    search_results = state["search_results"]
    
    if not search_results:
        return {
            "verification": {
                "is_valid": False,
                "reason": "未获取到任何搜索结果"
            }
        }
    
    messages = [
        {
            "role": "system",
            "content": "你是一个信息验证专家。请评估搜索结果是否能够回答用户的查询。"
        },
        {
            "role": "user",
            "content": f"用户查询：{user_query}\n\n搜索结果摘要：\n" + 
                      "\n".join([f"- {r['snippet'][:100]}..." for r in search_results[:5]]) +
                      "\n\n这些结果是否足够回答用户查询？请说明理由。"
        }
    ]
    
    response = deepseek_client.chat_completion(messages)
    
    is_valid = "足够" in response or "可以" in response or "valid" in response.lower()
    
    logger.info(f"Verifier校验结果: {'通过' if is_valid else '失败'}")
    
    return {
        "verification": {
            "is_valid": is_valid,
            "reason": response
        }
    }


def report_generator_node(state: WorkState) -> Dict[str, Any]:
    user_query = state["user_query"]
    search_results = state["search_results"]
    
    messages = [
        {
            "role": "system",
            "content": "你是一个专业报告生成专家。请基于搜索结果生成结构化的报告。"
        },
        {
            "role": "user",
            "content": f"用户查询：{user_query}\n\n搜索结果：\n" +
                      "\n".join([f"标题：{r['title']}\n摘要：{r['snippet']}\n" for r in search_results]) +
                      "\n\n请生成一份结构化的Markdown报告，包含摘要、核心内容和结论。"
        }
    ]
    
    report = deepseek_client.chat_completion(messages)
    
    logger.info("报告生成完成")
    
    return {
        "final_report": report
    }
