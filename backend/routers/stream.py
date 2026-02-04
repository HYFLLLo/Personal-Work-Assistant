from fastapi import APIRouter, HTTPException, Depends
from fastapi.params import Query
from sse_starlette.sse import EventSourceResponse
from backend.agents.graph import workflow
from backend.models.schemas import StreamRequest
import logging
import json
import asyncio
import traceback

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()


async def event_generator(query: str):
    initial_state = {
        "user_query": query,
        "plan_steps": [],
        "search_results": [],
        "verification": {},
        "final_report": "",
        "retry_count": 0
    }
    
    try:
        print(f"开始处理查询: {query[:100]}...")
        logger.info(f"开始处理查询: {query[:100]}...")
        # 发送开始事件
        yield {
            "event": "start",
            "data": json.dumps({
                "message": "开始处理任务",
                "query": query
            })
        }
        await asyncio.sleep(0.1)
        
        print("启动工作流执行")
        logger.info("启动工作流执行")
        async for event in workflow.astream(initial_state):
            for node_name, node_output in event.items():
                print(f"收到节点事件: {node_name}")
                logger.info(f"收到节点事件: {node_name}")
                if node_name == "planner":
                    plan_steps = node_output.get("plan_steps", [])
                    print(f"规划生成 {len(plan_steps)} 个步骤")
                    logger.info(f"规划生成 {len(plan_steps)} 个步骤")
                    yield {
                        "event": "planner_update",
                        "data": json.dumps({
                            "step": f"已生成 {len(plan_steps)} 个执行步骤",
                            "plan": plan_steps
                        })
                    }
                    await asyncio.sleep(0.1)
                
                elif node_name == "executor":
                    search_results = node_output.get("search_results", [])
                    print(f"执行器返回 {len(search_results)} 个搜索结果")
                    logger.info(f"执行器返回 {len(search_results)} 个搜索结果")
                    for result in search_results:
                        yield {
                            "event": "search_result",
                            "data": json.dumps({
                                "query": result.get("query", ""),
                                "snippet": result.get("snippet", "")[:200]
                            })
                        }
                        await asyncio.sleep(0.1)
                
                elif node_name == "verifier":
                    verification = node_output.get("verification", {})
                    is_valid = verification.get("is_valid", False)
                    print(f"验证结果: {'有效' if is_valid else '无效'}")
                    logger.info(f"验证结果: {'有效' if is_valid else '无效'}")
                    yield {
                        "event": "verification_feedback",
                        "data": json.dumps(verification)
                    }
                    await asyncio.sleep(0.1)
                    
                    if not is_valid:
                        initial_state["retry_count"] += 1
                        print(f"触发重试，当前重试次数: {initial_state['retry_count']}")
                        logger.info(f"触发重试，当前重试次数: {initial_state['retry_count']}")
                        yield {
                            "event": "retry_trigger",
                            "data": json.dumps({
                                "retry_count": initial_state["retry_count"],
                                "message": "验证失败，重新规划"
                            })
                        }
                        await asyncio.sleep(0.1)
                
                elif node_name == "report_generator":
                    final_report = node_output.get("final_report", "")
                    print(f"报告生成完成，长度: {len(final_report)} 字符")
                    logger.info(f"报告生成完成，长度: {len(final_report)} 字符")
                    yield {
                        "event": "final_report",
                        "data": json.dumps({
                            "content": final_report
                        })
                    }
                    await asyncio.sleep(0.1)
    
    except Exception as e:
        print(f"工作流执行错误: {e}")
        print(f"错误详情: {traceback.format_exc()}")
        logger.error(f"工作流执行错误: {e}")
        logger.error(f"错误详情: {traceback.format_exc()}")
        yield {
            "event": "error",
            "data": json.dumps({
                "error": str(e),
                "message": "处理过程中发生错误"
            })
        }
    finally:
        print("处理完成")
        logger.info("处理完成")
        # 发送结束事件
        yield {
            "event": "end",
            "data": json.dumps({
                "message": "处理完成"
            })
        }


async def validate_stream_request(
    query: str = Query(
        ..., 
        description="用户查询内容",
        max_length=500,
        examples=["生成2024年AI行业趋势报告"]
    )
) -> StreamRequest:
    """验证流式请求参数"""
    if not query or len(query.strip()) == 0:
        raise HTTPException(status_code=400, detail="查询内容不能为空")
    
    if len(query) > 500:
        raise HTTPException(status_code=400, detail="查询内容不能超过500字符")
    
    return StreamRequest(query=query)


@router.get("/stream")
async def stream_endpoint(
    stream_request: StreamRequest = Depends(validate_stream_request)
):
    """流式处理端点，用于处理用户任务并返回实时进度"""
    query = stream_request.query
    logger.info(f"收到流式请求: {query}")
    
    return EventSourceResponse(
        event_generator(query),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
