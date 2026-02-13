from backend.models.schemas import WorkState
from backend.models.llm import deepseek_client
from backend.tools.search import search_tool
from backend.conversation import conversation_manager
from backend.knowledge_base import knowledge_base_manager
from backend.templates import get_template, get_default_template
from typing import Dict, Any, List
import logging
import json

logger = logging.getLogger(__name__)


def intent_recognizer_node(state: WorkState) -> Dict[str, Any]:
    """
    意图识别节点 (v5.0 新增)
    
    分析用户问题的核心意图，提取关键信息
    """
    user_query = state["user_query"]
    
    logger.info(f"开始意图识别: {user_query[:50]}...")
    
    try:
        # 构建提示词
        system_prompt = """你是一个意图识别专家。请分析用户的问题，识别其核心意图和关键信息。

请输出JSON格式：
{
    "intent_type": "report_generation|information_query|data_analysis|other",
    "core_requirement": "核心需求描述",
    "keywords": ["关键词1", "关键词2"],
    "expected_output": "期望输出类型",
    "confidence": 0.95
}

intent_type说明：
- report_generation: 生成报告（如周报、分析报告等）
- information_query: 信息查询（如查询某个概念、事件等）
- data_analysis: 数据分析（如分析趋势、对比数据等）
- other: 其他类型
"""
        
        # 调用LLM进行意图识别
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"用户问题: {user_query}"}
        ]
        
        response = deepseek_client.chat_completion(messages)
        
        # 解析JSON结果
        try:
            # 尝试直接解析
            intent_analysis = json.loads(response)
        except json.JSONDecodeError:
            # 如果直接解析失败，尝试提取JSON部分
            import re
            json_match = re.search(r'\{[^}]*\}', response, re.DOTALL)
            if json_match:
                intent_analysis = json.loads(json_match.group())
            else:
                raise ValueError("无法解析意图识别结果")
        
        logger.info(f"意图识别完成: {intent_analysis.get('intent_type')}, 置信度: {intent_analysis.get('confidence')}")
        
        return {
            "intent_analysis": intent_analysis,
            "user_query": user_query
        }
        
    except Exception as e:
        logger.error(f"意图识别失败: {str(e)}")
        # 降级到通用意图
        return {
            "intent_analysis": {
                "intent_type": "report_generation",
                "core_requirement": user_query,
                "keywords": [],
                "expected_output": "报告",
                "confidence": 0.5
            }
        }


def planner_node(state: WorkState) -> Dict[str, Any]:
    user_query = state["user_query"]
    template_id = state.get("template_id")
    
    # 获取模板
    try:
        template = get_template(template_id) if template_id else get_default_template()
    except ValueError:
        template = get_default_template()
    
    # 使用模板特定的规划提示
    system_prompt = "你是一个任务规划专家。请将用户的任务拆解为可执行的搜索步骤。每个步骤应该是一个具体的搜索查询。"
    if template and template.planner_prompt:
        system_prompt += f"\n\n{template.planner_prompt}"
    
    messages = [
        {
            "role": "system",
            "content": system_prompt
        },
        {
            "role": "user",
            "content": f"用户任务：{user_query}\n\n请生成3-5个搜索步骤来完成任务。"
        }
    ]
    
    response = deepseek_client.chat_completion(messages)
    
    plan_steps = [step.strip() for step in response.split("\n") if step.strip()]
    
    logger.info(f"Planner生成 {len(plan_steps)} 个步骤，使用模板: {template.name if template else '默认'}")
    
    return {
        "plan_steps": plan_steps,
        "search_results": [],
        "verification": {},
        "final_report": "",
        "retry_count": state.get("retry_count", 0),
        "template_id": template_id
    }


def knowledge_base_search_node(state: WorkState) -> Dict[str, Any]:
    """
    增强版知识库检索节点 (v5.0)
    
    1. 如果指定了document_id，直接使用该文档
    2. 否则检索本地知识库，评估相关性
    3. 根据充分性级别(sufficient/insufficient/irrelevant)决定是否需要用户确认
    """
    user_query = state["user_query"]
    document_id = state.get("document_id")
    intent_analysis = state.get("intent_analysis")
    
    logger.info(f"开始知识库检索: {user_query[:50]}..., 指定文档: {document_id}")
    
    try:
        # 如果指定了document_id，直接使用该文档
        if document_id:
            document = knowledge_base_manager.get_document(document_id)
            if document and document.status.value == "completed":
                logger.info(f"使用指定文档: {document.filename}")
                search_results = []
                total_content_length = 0
                max_content_length = 50000  # 限制最大内容长度约5万字符（约1.5万tokens）
                
                for chunk in document.chunks:
                    chunk_content = chunk.content
                    # 检查添加此chunk是否会超出限制
                    if total_content_length + len(chunk_content) > max_content_length:
                        # 如果已添加的内容已经足够，则停止添加
                        if total_content_length > max_content_length * 0.8:
                            logger.info(f"文档内容已截断，保留前 {total_content_length} 字符")
                            break
                        # 否则截断当前chunk
                        remaining_space = max_content_length - total_content_length
                        chunk_content = chunk_content[:remaining_space] + "..."
                    
                    search_results.append({
                        'query': f"知识库: {document.filename}",
                        'title': document.filename,
                        'snippet': chunk_content,
                        'url': f"kb://{document.document_id}/{chunk.chunk_id}",
                        'source': 'knowledge_base',
                        'score': 1.0
                    })
                    total_content_length += len(chunk_content)
                    
                    # 如果已达到限制，停止添加
                    if total_content_length >= max_content_length:
                        break
                
                logger.info(f"文档处理完成，共使用 {len(search_results)} 个片段，总长度 {total_content_length} 字符")
                
                return {
                    "search_results": search_results,
                    "kb_sufficiency_level": "sufficient",
                    "kb_relevance_score": 1.0,
                    "kb_coverage_score": 1.0,
                    "needs_user_confirmation": False,
                    "confirmation_prompt": None
                }
            else:
                logger.warning(f"指定文档不存在或未处理完成: {document_id}")
        
        # 执行相关性检查
        relevance_result = knowledge_base_manager.check_relevance(user_query, top_k=5)
        
        # 根据置信度判断充分性级别
        confidence = relevance_result.confidence
        if confidence >= 0.75:
            sufficiency_level = "sufficient"
            needs_confirmation = False
        elif confidence >= 0.3:
            sufficiency_level = "insufficient"
            needs_confirmation = True
        else:
            sufficiency_level = "irrelevant"
            needs_confirmation = True
        
        # 构建搜索结果
        search_results = []
        for result in relevance_result.relevant_chunks:
            search_results.append({
                'query': f"知识库: {result.document.filename if result.document else 'Unknown'}",
                'title': result.document.filename if result.document else '知识库文档',
                'snippet': result.chunk.content,
                'url': f"kb://{result.chunk.document_id}/{result.chunk.chunk_id}",
                'source': 'knowledge_base',
                'score': result.score
            })
        
        # 生成确认提示文本
        confirmation_prompt = None
        if needs_confirmation:
            if sufficiency_level == "insufficient":
                confirmation_prompt = f"知识库内容不足以完整回答您的问题（{relevance_result.reason}）。是否需要通过搜索获取更多信息？"
            else:  # irrelevant
                confirmation_prompt = f"知识库内容与问题不相关（{relevance_result.reason}）。是否需要通过搜索获取相关信息？"
        
        logger.info(f"知识库评估结果: {sufficiency_level}, 置信度: {confidence:.2f}, 需要确认: {needs_confirmation}")
        
        return {
            "search_results": search_results,
            "kb_sufficiency_level": sufficiency_level,
            "kb_relevance_score": confidence,
            "kb_coverage_score": relevance_result.coverage_score,
            "needs_user_confirmation": needs_confirmation,
            "confirmation_prompt": confirmation_prompt
        }
        
    except Exception as e:
        logger.error(f"知识库检索失败: {str(e)}")
        # 出错时返回空结果，需要用户确认是否搜索
        return {
            "search_results": [],
            "kb_sufficiency_level": "irrelevant",
            "kb_relevance_score": 0.0,
            "kb_coverage_score": 0.0,
            "needs_user_confirmation": True,
            "confirmation_prompt": "知识库检索失败，是否需要通过搜索获取信息？"
        }


def executor_node(state: WorkState) -> Dict[str, Any]:
    """
    执行器节点
    
    根据知识库检索结果决定是否需要API搜索
    """
    plan_steps = state["plan_steps"]
    all_results = state.get("search_results", [])
    kb_sufficient = state.get("kb_sufficient", False)
    kb_relevance = state.get("kb_relevance_result", {})
    
    # 如果知识库已经足够，跳过API搜索
    if kb_sufficient:
        logger.info("知识库内容足够，跳过API搜索")
        return {
            "search_results": all_results,
            "kb_sufficient": True,
            "kb_relevance_result": kb_relevance
        }
    
    # 知识库不足，执行API搜索
    logger.info("知识库内容不足，执行API搜索补充")
    
    for step in plan_steps:
        results = search_tool.search(step, num_results=3)
        # 标记来源
        for r in results:
            r['source'] = 'api_search'
        all_results.extend(results)
    
    logger.info(f"Executor累积 {len(all_results)} 条搜索结果（含知识库和API）")
    
    return {
        "search_results": all_results,
        "kb_sufficient": False,
        "kb_relevance_result": kb_relevance
    }


def verifier_node(state: WorkState) -> Dict[str, Any]:
    user_query = state["user_query"]
    search_results = state["search_results"]
    kb_sufficient = state.get("kb_sufficient", False)
    
    if not search_results:
        return {
            "verification": {
                "is_valid": False,
                "reason": "未获取到任何搜索结果"
            }
        }
    
    # 如果知识库已经足够，直接通过验证
    if kb_sufficient:
        logger.info("知识库内容已足够，验证通过")
        return {
            "verification": {
                "is_valid": True,
                "reason": "基于知识库内容生成回答",
                "source": "knowledge_base"
            }
        }
    
    messages = [
        {
            "role": "system",
            "content": "你是一个信息验证专家。请评估搜索结果是否能够回答用户的查询。只要搜索结果包含相关信息，即使不完整，也应视为有效。"
        },
        {
            "role": "user",
            "content": f"用户查询：{user_query}\n\n搜索结果摘要：\n" +
                      "\n".join([f"- {r['snippet'][:100]}..." for r in search_results[:5]]) +
                      "\n\n这些结果是否包含相关信息可以回答用户查询？请简要说明。"
        }
    ]

    response = deepseek_client.chat_completion(messages)

    # 放宽验证条件：只要有搜索结果且AI没有明确说"无法回答"或"不相关"，就视为通过
    negative_keywords = ["无法回答", "不相关", "完全不", "没有任何", "未能找到", "no relevant", "cannot answer", "unrelated"]
    is_valid = not any(keyword in response.lower() for keyword in negative_keywords)

    logger.info(f"Verifier校验结果: {'通过' if is_valid else '失败'}")

    return {
        "verification": {
            "is_valid": is_valid,
            "reason": response
        }
    }


def report_generator_node(state: WorkState) -> Dict[str, Any]:
    """
    增强版报告生成节点 (v5.0)
    
    支持多种生成模式：
    1. 基于知识库生成
    2. 基于搜索结果生成
    3. 基于混合内容生成
    4. 仅输出模板框架（内容不相关且用户拒绝搜索时）
    """
    user_query = state["user_query"]
    search_results = state["search_results"]
    template_id = state.get("template_id")
    
    # 获取新的工作流状态
    kb_sufficiency_level = state.get("kb_sufficiency_level")
    user_confirmed_search = state.get("user_confirmed_search")
    kb_relevance_score = state.get("kb_relevance_score", 0.0)
    
    # 兼容旧版本状态
    kb_sufficient = state.get("kb_sufficient", False)
    kb_relevance = state.get("kb_relevance_result", {})
    
    # 获取模板
    try:
        template = get_template(template_id) if template_id else get_default_template()
    except ValueError:
        template = get_default_template()
    
    # 判断生成模式
    generation_mode = "unknown"
    
    # 模式4：内容不相关且用户拒绝搜索，仅输出模板框架
    if kb_sufficiency_level == "irrelevant" and user_confirmed_search == False:
        generation_mode = "template_only"
        logger.info("生成模式：仅输出模板框架（内容不相关且用户拒绝搜索）")
        report = generate_template_only(template, user_query)
        
        return {
            "final_report": report,
            "generation_mode": generation_mode,
            "kb_sufficiency_level": kb_sufficiency_level,
            "kb_relevance_score": kb_relevance_score,
            "template_id": template_id
        }
    
    # 区分知识库和API搜索结果
    kb_results = [r for r in search_results if r.get('source') == 'knowledge_base']
    api_results = [r for r in search_results if r.get('source') == 'api_search']
    
    # 判断生成模式
    if kb_results and api_results:
        generation_mode = "hybrid"
        source_note = "（基于知识库和网络搜索综合生成）"
    elif kb_results:
        generation_mode = "knowledge_base"
        source_note = "（基于知识库内容生成）"
    else:
        generation_mode = "api_search"
        source_note = "（基于网络搜索生成）"
    
    # 构建参考信息
    reference_info = ""
    if kb_results:
        reference_info += "【知识库内容】\n"
        reference_info += "\n".join([f"来源：{r['title']}\n{r['snippet']}\n" for r in kb_results])
    
    if api_results:
        reference_info += "\n【网络搜索结果】\n"
        reference_info += "\n".join([f"标题：{r['title']}\n摘要：{r['snippet']}\n" for r in api_results])
    
    # 构建系统提示，加入模板特定的报告提示
    system_prompt = f"""你是一个专业报告生成专家。请基于搜索结果生成纯文本格式的结构化报告。

【报告类型】{template.name if template else '通用报告'}

【核心铁律】
1. 全文禁用所有符号标记：# * - _ ** ## > [] ``` • ○ 及任何Markdown/项目符号
2. 结构仅靠三要素构建：文字标题 + 阿拉伯数字编号 + 空行分隔
3. 关键词用中文引号""标注（如"核心目标"），禁用加粗/斜体

【格式规范】
- 主标题：居中独占一行，上下各空1行
- 章节标题：用"一、""二、"或"第一部分："等文字标识，单独成行，前空1行
- 列表内容：统一用"1. ""2. ""3. "编号，每项独立成段，项与项之间空1行
- 普通段落：自然分段，段间空1行，首行不缩进
- 引用/注释：用"（注：……）"文字说明，不缩进

【输出前自查】
- 全文无任何#/*/-等残留符号
- 所有层级通过文字+空行体现
- 编号连续且每项独立成段
- 无缩进、无特殊字符"""

    # 构建用户提示，加入模板特定的报告要求
    user_prompt = f"主题：{user_query}{source_note}\n\n参考信息：\n{reference_info}\n\n"
    
    if template and template.report_prompt:
        user_prompt += f"\n【报告要求】\n{template.report_prompt}\n\n"
    
    user_prompt += "请基于以上信息生成一份纯文本格式的结构化报告，严格遵循系统指令中的格式规范。"
    
    messages = [
        {
            "role": "system",
            "content": system_prompt
        },
        {
            "role": "user",
            "content": user_prompt
        }
    ]
    
    report = deepseek_client.chat_completion(messages)
    
    logger.info(f"报告生成完成{source_note}，模式: {generation_mode}，使用模板: {template.name if template else '默认'}")
    
    return {
        "final_report": report,
        "generation_mode": generation_mode,
        "kb_sufficient": kb_sufficient or (kb_sufficiency_level == "sufficient"),
        "kb_relevance_result": kb_relevance,
        "kb_sufficiency_level": kb_sufficiency_level,
        "kb_relevance_score": kb_relevance_score,
        "template_id": template_id
    }


def generate_template_only(template, query: str) -> str:
    """仅生成模板框架，不包含实质性内容"""
    report = f"""{template.name if template else '报告'}

"""
    
    # 添加模板结构框架
    if template and template.structure:
        for i, section in enumerate(template.structure, 1):
            report += f"{i}、{section.get('title', '章节')}\n\n"
            desc = section.get('description', '此部分暂无内容')
            report += f"（{desc}）\n\n"
    else:
        # 默认结构
        report += """1、概述

（此部分暂无内容）

2、主要内容

（此部分暂无内容）

3、总结

（此部分暂无内容）
"""
    
    # 添加固定说明
    report += """---

说明：知识库内容与问题不符，需要您进一步提供更多信息。
您可以通过以下方式解决：
1、上传相关文档到知识库
2、重新描述您的问题
3、允许系统通过搜索获取信息
"""
    
    return report


def qa_handler_node(state: WorkState) -> Dict[str, Any]:
    """处理用户追问 - 基于上下文回答，不修改报告"""
    conversation_id = state.get("conversation_id")
    user_query = state["user_query"]
    selected_text = state.get("selected_text", "")
    
    # 获取会话上下文
    context = conversation_manager.get_context_for_llm(conversation_id) if conversation_id else {}
    current_report = context.get("current_report", "")
    
    # 先尝试从知识库获取相关信息
    kb_context = ""
    try:
        relevance_result = knowledge_base_manager.check_relevance(user_query, top_k=3)
        if relevance_result.relevant_chunks:
            kb_context = "\n\n【知识库相关信息】\n"
            kb_context += "\n".join([f"- {r.chunk.content[:200]}..." for r in relevance_result.relevant_chunks[:2]])
    except Exception as e:
        logger.warning(f"追问时知识库检索失败: {str(e)}")
    
    messages = [
        {
            "role": "system",
            "content": "你是一个专业的问答助手。基于提供的报告内容和相关知识，回答用户的问题。回答要简洁、准确、有依据。"
        },
        {
            "role": "user",
            "content": f"报告内容：\n{current_report[:2000]}...{kb_context}\n\n" +
                      (f"用户选中的段落：{selected_text}\n\n" if selected_text else "") +
                      f"用户问题：{user_query}\n\n请基于以上信息回答问题。"
        }
    ]
    
    answer = deepseek_client.chat_completion(messages)
    
    logger.info(f"QA回答生成完成，问题：{user_query[:30]}...")
    
    return {
        "answer": answer,
        "operation_type": "follow_up"
    }


def modify_handler_node(state: WorkState) -> Dict[str, Any]:
    """处理报告修改 - 精准修改选中段落"""
    conversation_id = state.get("conversation_id")
    user_query = state["user_query"]  # 修改要求
    selected_text = state.get("selected_text", "")
    
    # 获取当前报告
    context = conversation_manager.get_context_for_llm(conversation_id) if conversation_id else {}
    current_report = context.get("current_report", "")
    
    if not selected_text or not current_report:
        return {
            "final_report": current_report,
            "modification": "未找到选中内容或报告",
            "operation_type": "modify"
        }
    
    messages = [
        {
            "role": "system",
            "content": """你是一个专业的文档编辑助手。根据用户的修改要求，仅修改报告中指定的段落，其他内容保持不变。

【修改规则】
1. 仅修改用户指定的段落内容
2. 保持原文档的整体结构和风格
3. 确保修改后的内容与上下文衔接自然
4. 输出完整的修改后报告"""
        },
        {
            "role": "user",
            "content": f"完整报告：\n{current_report}\n\n" +
                      f"需要修改的段落：\n{selected_text}\n\n" +
                      f"修改要求：{user_query}\n\n" +
                      "请输出修改后的完整报告，仅修改指定段落，其他内容保持不变。"
        }
    ]
    
    modified_report = deepseek_client.chat_completion(messages)
    
    logger.info(f"报告修改完成，修改要求：{user_query[:30]}...")
    
    return {
        "final_report": modified_report,
        "modification": f"已修改段落：{selected_text[:50]}...",
        "operation_type": "modify"
    }


def expand_handler_node(state: WorkState) -> Dict[str, Any]:
    """处理内容补充 - 在指定位置添加内容"""
    conversation_id = state.get("conversation_id")
    user_query = state["user_query"]  # 补充要求
    position = state.get("position", "末尾")  # 插入位置
    
    # 获取当前报告
    context = conversation_manager.get_context_for_llm(conversation_id) if conversation_id else {}
    current_report = context.get("current_report", "")
    search_results = context.get("search_results", [])
    
    # 尝试从知识库获取补充信息
    kb_supplement = ""
    try:
        relevance_result = knowledge_base_manager.check_relevance(user_query, top_k=3)
        if relevance_result.relevant_chunks:
            kb_supplement = "\n\n【知识库参考信息】\n"
            kb_supplement += "\n".join([f"- {r.chunk.content[:300]}..." for r in relevance_result.relevant_chunks[:2]])
    except Exception as e:
        logger.warning(f"补充时知识库检索失败: {str(e)}")
    
    messages = [
        {
            "role": "system",
            "content": """你是一个专业的内容扩展助手。根据用户的要求，在报告的指定位置添加新内容。

【补充规则】
1. 新内容要与原文风格一致
2. 确保补充内容与上下文衔接自然
3. 输出包含新内容的完整报告
4. 保持原文档的格式规范"""
        },
        {
            "role": "user",
            "content": f"当前报告：\n{current_report}\n\n" +
                      f"插入位置：{position}\n\n" +
                      f"补充要求：{user_query}\n\n" +
                      (f"参考信息：\n{search_results[:3]}{kb_supplement}\n\n" if search_results or kb_supplement else "") +
                      "请生成需要补充的内容，并输出包含新内容的完整报告。"
        }
    ]
    
    expanded_report = deepseek_client.chat_completion(messages)
    
    logger.info(f"内容补充完成，补充要求：{user_query[:30]}...")
    
    return {
        "final_report": expanded_report,
        "expansion": f"已在{position}添加内容",
        "operation_type": "supplement"
    }


def user_confirmation_node(state: WorkState) -> Dict[str, Any]:
    """
    用户确认等待节点 (v5.0 新增)
    
    从会话管理器中读取最新的用户确认状态
    这样当用户通过API确认后，工作流能够获取到最新状态
    """
    conversation_id = state.get("conversation_id")
    
    if conversation_id:
        # 从会话管理器获取最新状态
        conversation = conversation_manager.get_conversation(conversation_id)
        if conversation:
            # 从metadata中检查是否有用户确认状态更新
            metadata = conversation.metadata if conversation.metadata else {}
            user_confirmed = metadata.get("user_confirmed_search") if isinstance(metadata, dict) else None
            confirmation_status = metadata.get("user_confirmation_status") if isinstance(metadata, dict) else None
            
            # 如果metadata中有确认状态，更新状态
            if user_confirmed is not None or confirmation_status is not None:
                logger.info(f"从会话读取到用户确认状态: confirmed={user_confirmed}, status={confirmation_status}")
                return {
                    "user_confirmed_search": user_confirmed,
                    "user_confirmation_status": confirmation_status,
                    "needs_user_confirmation": False  # 已经确认过了
                }
    
    # 如果没有更新，返回当前状态（继续等待）
    return {
        "user_confirmed_search": state.get("user_confirmed_search"),
        "user_confirmation_status": state.get("user_confirmation_status"),
        "needs_user_confirmation": state.get("needs_user_confirmation", False)
    }
