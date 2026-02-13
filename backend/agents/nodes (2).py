from backend.models.schemas import WorkState
from backend.models.llm import deepseek_client
from backend.tools.search import search_tool
from backend.conversation import conversation_manager
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
    user_query = state["user_query"]
    search_results = state["search_results"]
    
    messages = [
        {
            "role": "system",
            "content": """你是一个专业报告生成专家。请基于搜索结果生成纯文本格式的结构化报告。

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
        },
        {
            "role": "user",
            "content": f"主题：{user_query}\n\n参考搜索结果：\n" +
                      "\n".join([f"标题：{r['title']}\n摘要：{r['snippet']}\n" for r in search_results]) +
                      "\n\n请基于以上信息生成一份纯文本格式的结构化报告，严格遵循系统指令中的格式规范。"
        }
    ]
    
    report = deepseek_client.chat_completion(messages)
    
    logger.info("报告生成完成")
    
    return {
        "final_report": report
    }


def qa_handler_node(state: WorkState) -> Dict[str, Any]:
    """处理用户追问 - 基于上下文回答，不修改报告"""
    conversation_id = state.get("conversation_id")
    user_query = state["user_query"]
    selected_text = state.get("selected_text", "")
    
    # 获取会话上下文
    context = conversation_manager.get_context_for_llm(conversation_id) if conversation_id else {}
    current_report = context.get("current_report", "")
    
    messages = [
        {
            "role": "system",
            "content": "你是一个专业的问答助手。基于提供的报告内容和搜索结果，回答用户的问题。回答要简洁、准确、有依据。"
        },
        {
            "role": "user",
            "content": f"报告内容：\n{current_report[:2000]}...\n\n" +
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
                      (f"参考信息：\n{search_results[:3]}\n\n" if search_results else "") +
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
