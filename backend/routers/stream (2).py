from fastapi import APIRouter, HTTPException, Depends
from fastapi.params import Query
from sse_starlette.sse import EventSourceResponse
from backend.agents.graph import workflow
from backend.models.schemas import StreamRequest
from backend.conversation import conversation_manager
import logging
import json
import asyncio
import traceback

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter()


async def event_generator(query: str, conversation_id: str = None, operation_type: str = "generate",
                         selected_text: str = None, position: str = None):
    """事件生成器 - 支持多轮对话"""
    
    # 创建或获取会话
    if not conversation_id:
        conversation = conversation_manager.create_conversation(query)
        conversation_id = conversation.id
        is_new_conversation = True
    else:
        conversation = conversation_manager.get_conversation(conversation_id)
        is_new_conversation = False
        if not conversation:
            yield {
                "event": "error",
                "data": json.dumps({"error": "会话不存在", "message": "请重新创建会话"})
            }
            return
    
    # 构建初始状态
    initial_state = {
        "user_query": query,
        "plan_steps": [],
        "search_results": [],
        "verification": {},
        "final_report": "",
        "retry_count": 0,
        # 多轮对话字段
        "conversation_id": conversation_id,
        "operation_type": operation_type,
        "selected_text": selected_text,
        "position": position,
        "answer": None
    }
    
    try:
        print(f"开始处理查询: {query[:100]}...")
        logger.info(f"开始处理查询: {query[:100]}..., 操作类型: {operation_type}")
        
        # 发送开始事件，包含会话ID
        yield {
            "event": "start",
            "data": json.dumps({
                "message": "开始处理任务",
                "query": query,
                "conversation_id": conversation_id,
                "operation_type": operation_type
            })
        }
        await asyncio.sleep(0.1)
        
        # 添加用户消息到会话
        from backend.conversation import MessageType
        msg_type = MessageType.QUERY if is_new_conversation else MessageType.FOLLOW_UP
        if operation_type == "modify":
            msg_type = MessageType.MODIFICATION
        elif operation_type == "supplement":
            msg_type = MessageType.SUPPLEMENT
            
        conversation_manager.add_message(
            conversation_id=conversation_id,
            role="user",
            content=query,
            msg_type=msg_type,
            metadata={
                "selected_text": selected_text,
                "position": position,
                "operation_type": operation_type
            }
        )
        
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
                    
                    # 保存搜索结果到会话
                    conversation_manager.save_search_results(conversation_id, search_results)
                    
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
                    
                    # 更新会话中的报告
                    conversation_manager.update_report(conversation_id, final_report, operation_type)
                    
                    # 添加助手消息
                    conversation_manager.add_message(
                        conversation_id=conversation_id,
                        role="assistant",
                        content=final_report,
                        msg_type=MessageType.REPORT
                    )
                    
                    yield {
                        "event": "final_report",
                        "data": json.dumps({
                            "content": final_report,
                            "conversation_id": conversation_id
                        })
                    }
                    await asyncio.sleep(0.1)
                
                # 处理对话节点
                elif node_name == "qa_handler":
                    answer = node_output.get("answer", "")
                    print(f"QA回答生成完成，长度: {len(answer)} 字符")
                    logger.info(f"QA回答生成完成，长度: {len(answer)} 字符")
                    
                    # 添加助手回答消息
                    conversation_manager.add_message(
                        conversation_id=conversation_id,
                        role="assistant",
                        content=answer,
                        msg_type=MessageType.ANSWER
                    )
                    
                    yield {
                        "event": "answer",
                        "data": json.dumps({
                            "content": answer,
                            "conversation_id": conversation_id,
                            "type": "follow_up"
                        })
                    }
                    await asyncio.sleep(0.1)
                
                elif node_name == "modify_handler":
                    final_report = node_output.get("final_report", "")
                    modification = node_output.get("modification", "")
                    print(f"报告修改完成，长度: {len(final_report)} 字符")
                    logger.info(f"报告修改完成，长度: {len(final_report)} 字符")
                    
                    # 更新会话中的报告
                    conversation_manager.update_report(conversation_id, final_report, "modify")
                    
                    # 添加助手消息
                    conversation_manager.add_message(
                        conversation_id=conversation_id,
                        role="assistant",
                        content=final_report,
                        msg_type=MessageType.REPORT,
                        metadata={"modification": modification}
                    )
                    
                    yield {
                        "event": "final_report",
                        "data": json.dumps({
                            "content": final_report,
                            "conversation_id": conversation_id,
                            "type": "modification",
                            "modification": modification
                        })
                    }
                    await asyncio.sleep(0.1)
                
                elif node_name == "expand_handler":
                    final_report = node_output.get("final_report", "")
                    expansion = node_output.get("expansion", "")
                    print(f"内容补充完成，长度: {len(final_report)} 字符")
                    logger.info(f"内容补充完成，长度: {len(final_report)} 字符")
                    
                    # 更新会话中的报告
                    conversation_manager.update_report(conversation_id, final_report, "supplement")
                    
                    # 添加助手消息
                    conversation_manager.add_message(
                        conversation_id=conversation_id,
                        role="assistant",
                        content=final_report,
                        msg_type=MessageType.REPORT,
                        metadata={"expansion": expansion}
                    )
                    
                    yield {
                        "event": "final_report",
                        "data": json.dumps({
                            "content": final_report,
                            "conversation_id": conversation_id,
                            "type": "supplement",
                            "expansion": expansion
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
                "message": "处理完成",
                "conversation_id": conversation_id
            })
        }


async def validate_stream_request(
    query: str = Query(..., description="用户查询内容", max_length=500),
    conversation_id: str = Query(None, description="会话ID，首次请求为空"),
    operation_type: str = Query("generate", description="操作类型：generate/follow_up/modify/supplement"),
    selected_text: str = Query(None, description="选中的段落内容"),
    position: str = Query(None, description="插入位置")
) -> StreamRequest:
    """验证流式请求参数"""
    if not query or len(query.strip()) == 0:
        raise HTTPException(status_code=400, detail="查询内容不能为空")
    
    if len(query) > 500:
        raise HTTPException(status_code=400, detail="查询内容不能超过500字符")
    
    # 验证操作类型
    valid_operations = ["generate", "follow_up", "modify", "supplement"]
    if operation_type not in valid_operations:
        raise HTTPException(status_code=400, detail=f"无效的操作类型，必须是: {', '.join(valid_operations)}")
    
    return StreamRequest(
        query=query,
        conversation_id=conversation_id,
        operation_type=operation_type,
        selected_text=selected_text,
        position=position
    )


@router.get("/stream")
async def stream_endpoint(
    stream_request: StreamRequest = Depends(validate_stream_request)
):
    """流式处理端点，用于处理用户任务并返回实时进度（支持多轮对话）"""
    query = stream_request.query
    conversation_id = stream_request.conversation_id
    operation_type = stream_request.operation_type
    selected_text = stream_request.selected_text
    position = stream_request.position
    
    logger.info(f"收到流式请求: {query}, 操作类型: {operation_type}, 会话ID: {conversation_id}")
    
    return EventSourceResponse(
        event_generator(query, conversation_id, operation_type, selected_text, position),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# 会话管理API
@router.get("/conversations")
async def list_conversations():
    """获取会话列表"""
    return {
        "conversations": conversation_manager.list_conversations()
    }


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """获取会话详情"""
    conversation = conversation_manager.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conversation.model_dump()


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """删除会话"""
    success = conversation_manager.delete_conversation(conversation_id)
    if not success:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"message": "会话已删除"}
