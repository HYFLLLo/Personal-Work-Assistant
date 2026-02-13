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
                         selected_text: str = None, position: str = None, template_id: str = None,
                         document_id: str = None):
    """事件生成器 - 支持多轮对话和报告模板"""
    
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
        "answer": None,
        # 报告模板字段
        "template_id": template_id,
        # 知识库文档字段
        "document_id": document_id
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
                
                # v5.0: 意图识别节点事件
                if node_name == "intent_recognizer":
                    intent_analysis = node_output.get("intent_analysis", {})
                    print(f"意图识别完成: {intent_analysis.get('intent_type')}")
                    logger.info(f"意图识别完成: {intent_analysis.get('intent_type')}")
                    yield {
                        "event": "intent_analysis",
                        "data": json.dumps(intent_analysis)
                    }
                    await asyncio.sleep(0.1)
                
                # v5.0: 知识库检索节点事件
                elif node_name == "knowledge_base_search":
                    sufficiency_level = node_output.get("kb_sufficiency_level")
                    relevance_score = node_output.get("kb_relevance_score", 0.0)
                    coverage_score = node_output.get("kb_coverage_score", 0.0)
                    needs_confirmation = node_output.get("needs_user_confirmation", False)
                    confirmation_prompt = node_output.get("confirmation_prompt")
                    
                    print(f"知识库评估: {sufficiency_level}, 相关度: {relevance_score:.2f}")
                    logger.info(f"知识库评估: {sufficiency_level}, 相关度: {relevance_score:.2f}")
                    
                    yield {
                        "event": "kb_evaluation",
                        "data": json.dumps({
                            "sufficiency_level": sufficiency_level,
                            "relevance_score": relevance_score,
                            "coverage_score": coverage_score,
                            "needs_confirmation": needs_confirmation,
                            "prompt": confirmation_prompt
                        })
                    }
                    await asyncio.sleep(0.1)
                    
                    # v5.0: 如果需要用户确认，发送确认请求事件
                    if needs_confirmation:
                        print("发送用户确认请求")
                        logger.info("发送用户确认请求")
                        yield {
                            "event": "user_confirmation_required",
                            "data": json.dumps({
                                "prompt": confirmation_prompt or "是否需要通过搜索获取更多信息？",
                                "sufficiency_level": sufficiency_level,
                                "conversation_id": conversation_id
                            })
                        }
                        await asyncio.sleep(0.1)
                
                # v5.0: 用户确认等待节点
                elif node_name == "user_confirmation":
                    needs_confirmation = node_output.get("needs_user_confirmation", False)
                    confirmation_status = node_output.get("user_confirmation_status")
                    
                    if needs_confirmation and confirmation_status is None:
                        # 正在等待用户确认，更新会话状态
                        conversation_manager.update_conversation(
                            conversation_id=conversation_id,
                            updates={
                                "needs_user_confirmation": True,
                                "user_confirmation_status": None,
                                "confirmation_prompt": node_output.get("confirmation_prompt")
                            }
                        )
                        print("等待用户确认...")
                        logger.info("等待用户确认...")
                
                # v5.0: 用户确认后的路由节点
                elif node_name == "post_confirmation_router":
                    user_confirmed = node_output.get("user_confirmed_search")
                    sufficiency_level = node_output.get("kb_sufficiency_level")
                    
                    if user_confirmed:
                        print(f"用户已确认搜索，继续执行")
                        logger.info(f"用户已确认搜索，继续执行")
                    else:
                        print(f"用户未确认搜索，sufficiency_level: {sufficiency_level}")
                        logger.info(f"用户未确认搜索，sufficiency_level: {sufficiency_level}")
                
                elif node_name == "planner":
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
                        # 安全截断字符串，避免截断多字节字符导致乱码
                        snippet = result.get("snippet", "")
                        if len(snippet) > 200:
                            # 找到第200个字符之前的最后一个完整字符
                            snippet = snippet[:200]
                            # 确保不截断在多字节字符中间
                            while len(snippet.encode('utf-8')) > 200:
                                snippet = snippet[:-1]
                        
                        yield {
                            "event": "search_result",
                            "data": json.dumps({
                                "query": result.get("query", ""),
                                "snippet": snippet
                            }, ensure_ascii=False)
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
    position: str = Query(None, description="插入位置"),
    template_id: str = Query(None, description="报告模板ID"),
    document_id: str = Query(None, description="知识库文档ID")
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
        position=position,
        template_id=template_id,
        document_id=document_id
    )


@router.get("/stream")
async def stream_endpoint(
    stream_request: StreamRequest = Depends(validate_stream_request)
):
    """流式处理端点，用于处理用户任务并返回实时进度（支持多轮对话和报告模板）"""
    query = stream_request.query
    conversation_id = stream_request.conversation_id
    operation_type = stream_request.operation_type
    selected_text = stream_request.selected_text
    position = stream_request.position
    template_id = stream_request.template_id
    document_id = stream_request.document_id
    
    logger.info(f"收到流式请求: {query}, 操作类型: {operation_type}, 会话ID: {conversation_id}, 模板: {template_id}, 文档: {document_id}")
    
    return EventSourceResponse(
        event_generator(query, conversation_id, operation_type, selected_text, position, template_id, document_id),
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


# v5.0: 用户确认API
from pydantic import BaseModel

class ConfirmationRequest(BaseModel):
    confirmed: bool
    conversation_id: str

@router.post("/confirm")
async def user_confirmation(request: ConfirmationRequest):
    """
    用户确认回调接口
    
    前端在用户点击确认按钮后调用此接口
    更新工作流状态，继续执行
    """
    conversation_id = request.conversation_id
    confirmed = request.confirmed
    
    logger.info(f"收到用户确认: conversation_id={conversation_id}, confirmed={confirmed}")
    
    # 获取会话
    conversation = conversation_manager.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="会话不存在")
    
    # 更新会话状态
    conversation_manager.update_conversation(
        conversation_id=conversation_id,
        updates={
            "user_confirmed_search": confirmed,
            "user_confirmation_status": "confirmed" if confirmed else "declined",
            "needs_user_confirmation": False
        }
    )
    
    logger.info(f"用户确认已保存: conversation_id={conversation_id}, confirmed={confirmed}")
    
    return {
        "status": "success",
        "confirmed": confirmed,
        "conversation_id": conversation_id
    }


# 恢复会话API（用于撤销删除）
from backend.conversation import Conversation

@router.post("/conversations/restore")
async def restore_conversation(conversation_data: dict):
    """
    恢复被删除的会话
    
    前端在撤销删除操作时调用此接口
    """
    try:
        conversation_id = conversation_data.get('conversation_id')
        if not conversation_id:
            raise HTTPException(status_code=400, detail="缺少会话ID")
        
        # 检查会话是否已存在
        existing = conversation_manager.get_conversation(conversation_id)
        if existing:
            return {
                "status": "success",
                "message": "会话已存在",
                "conversation_id": conversation_id
            }
        
        # 从传入的数据重建会话
        conversation = Conversation(
            id=conversation_id,
            title=conversation_data.get('query', '恢复的记录')[:20] + "..." if len(conversation_data.get('query', '')) > 20 else conversation_data.get('query', '恢复的记录'),
            created_at=conversation_data.get('timestamp', datetime.now().isoformat()),
            updated_at=datetime.now().isoformat(),
            messages=[],
            current_report=conversation_data.get('report', ''),
            report_versions=[],
            search_results=[],
            metadata={
                "restored": True,
                "restored_at": datetime.now().isoformat(),
                "original_status": conversation_data.get('status', 'unknown')
            }
        )
        
        # 添加到会话管理器
        conversation_manager.conversations[conversation_id] = conversation
        conversation_manager.save_to_file()
        
        logger.info(f"会话已恢复: {conversation_id}")
        
        return {
            "status": "success",
            "message": "会话已恢复",
            "conversation_id": conversation_id
        }
        
    except Exception as e:
        logger.error(f"恢复会话失败: {e}")
        raise HTTPException(status_code=500, detail=f"恢复会话失败: {str(e)}")


# 导入datetime用于恢复API
from datetime import datetime
