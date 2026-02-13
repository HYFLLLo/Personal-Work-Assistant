from langgraph.graph import StateGraph, END
from backend.models.schemas import WorkState
from backend.agents.nodes import (
    intent_recognizer_node, planner_node, knowledge_base_search_node, 
    executor_node, verifier_node, report_generator_node, 
    qa_handler_node, modify_handler_node, expand_handler_node,
    user_confirmation_node
)
import logging

logger = logging.getLogger(__name__)


def should_retry(state: WorkState) -> str:
    """判断是否重试或生成报告"""
    kb_sufficient = state.get("kb_sufficient", False)
    
    # 如果知识库已经足够，直接进入报告生成
    if kb_sufficient:
        logger.info("知识库内容足够，直接进入报告生成")
        return "generate_report"
    
    # 否则按照原有逻辑
    logger.info("进入报告生成阶段")
    return "generate_report"


def route_by_operation(state: WorkState) -> str:
    """根据操作类型路由到不同处理节点"""
    op_type = state.get("operation_type", "generate")
    
    routing_map = {
        "generate": "intent_recognizer",  # v5.0: 首先进行意图识别
        "follow_up": "qa_handler",
        "modify": "modify_handler",
        "supplement": "expand_handler"
    }
    
    route = routing_map.get(op_type, "intent_recognizer")
    logger.info(f"操作类型: {op_type}, 路由到: {route}")
    return route


def should_use_knowledge_base(state: WorkState) -> str:
    """
    v5.0 决策路由：根据知识库充分性级别决定路径
    
    返回:
        - "generate_from_kb": 知识库足够，直接生成
        - "ask_user_confirmation": 需要用户确认是否搜索
        - "use_api_search": 默认使用API搜索
    """
    sufficiency_level = state.get("kb_sufficiency_level")
    needs_confirmation = state.get("needs_user_confirmation", False)
    
    # 如果指定了document_id，直接使用知识库
    document_id = state.get("document_id")
    if document_id:
        logger.info("指定了文档ID，直接使用知识库生成")
        return "generate_from_kb"
    
    if sufficiency_level == "sufficient":
        # 路径A：知识库足够，直接生成
        logger.info("知识库内容足够，直接生成报告")
        return "generate_from_kb"
    
    elif needs_confirmation:
        # 路径B/C：需要用户确认
        logger.info(f"知识库{sufficiency_level}，需要用户确认是否搜索")
        return "ask_user_confirmation"
    
    else:
        # 默认使用API搜索
        logger.info("默认使用API搜索")
        return "use_api_search"


def should_use_api_search(state: WorkState) -> str:
    """
    v5.0 用户确认后的决策路由
    
    返回:
        - "use_api_search": 用户同意搜索
        - "generate_from_kb": 用户拒绝搜索，但内容不足
        - "generate_template_only": 用户拒绝搜索，且内容不相关
    """
    user_confirmed = state.get("user_confirmed_search")
    sufficiency_level = state.get("kb_sufficiency_level")
    
    if user_confirmed:
        # 用户同意搜索
        logger.info("用户确认搜索，调用API")
        return "use_api_search"
    
    elif sufficiency_level == "insufficient":
        # 用户拒绝搜索，但内容不足，基于现有内容生成
        logger.info("用户拒绝搜索，基于现有内容生成")
        return "generate_from_kb"
    
    else:  # irrelevant
        # 用户拒绝搜索，且内容不相关，仅输出模板框架
        logger.info("用户拒绝搜索且内容不相关，仅输出模板框架")
        return "generate_template_only"


def check_user_confirmation(state: WorkState) -> str:
    """
    v5.0 检查用户确认状态
    
    返回:
        - "wait": 等待用户确认
        - "proceed": 继续执行
    """
    needs_confirmation = state.get("needs_user_confirmation", False)
    confirmation_status = state.get("user_confirmation_status")
    
    if not needs_confirmation:
        # 不需要确认，直接继续
        return "proceed"
    
    if confirmation_status is None:
        # 需要确认但还未确认，等待
        logger.info("等待用户确认...")
        return "wait"
    
    # 已经确认过了，继续执行
    logger.info(f"用户已确认: {confirmation_status}")
    return "proceed"


def create_graph() -> StateGraph:
    graph = StateGraph(WorkState)
    
    # 添加所有节点
    graph.add_node("intent_recognizer", intent_recognizer_node)
    graph.add_node("knowledge_base_search", knowledge_base_search_node)
    graph.add_node("user_confirmation", user_confirmation_node)  # v5.0: 用户确认等待节点
    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_node("verifier", verifier_node)
    graph.add_node("report_generator", report_generator_node)
    graph.add_node("qa_handler", qa_handler_node)
    graph.add_node("modify_handler", modify_handler_node)
    graph.add_node("expand_handler", expand_handler_node)
    
    # 设置入口点为条件路由
    graph.set_conditional_entry_point(
        route_by_operation,
        {
            "intent_recognizer": "intent_recognizer",
            "qa_handler": "qa_handler",
            "modify_handler": "modify_handler",
            "expand_handler": "expand_handler"
        }
    )
    
    # v5.0: 意图识别 → 知识库检索
    graph.add_edge("intent_recognizer", "knowledge_base_search")
    
    # v5.0: 知识库检索后条件分支
    graph.add_conditional_edges(
        "knowledge_base_search",
        should_use_knowledge_base,
        {
            "generate_from_kb": "report_generator",      # 路径A：直接生成
            "ask_user_confirmation": "user_confirmation",  # 路径B/C：进入用户确认等待
            "use_api_search": "planner"                   # 备用：直接搜索
        }
    )
    
    # v5.0: 用户确认等待节点循环检查
    graph.add_conditional_edges(
        "user_confirmation",
        check_user_confirmation,
        {
            "wait": "user_confirmation",    # 继续等待
            "proceed": "post_confirmation_router"  # 用户已确认，进入后续路由
        }
    )
    
    # v5.0: 添加 post_confirmation_router 节点（空操作，用于路由）
    graph.add_node("post_confirmation_router", lambda state: state)
    
    # v5.0: 用户确认后的条件路由
    graph.add_conditional_edges(
        "post_confirmation_router",
        should_use_api_search,
        {
            "use_api_search": "planner",           # 用户同意搜索
            "generate_from_kb": "report_generator", # 用户拒绝搜索，但内容不足
            "generate_template_only": "report_generator"  # 用户拒绝搜索且内容不相关
        }
    )
    
    # 原有工作流边（API搜索流程）
    graph.add_edge("planner", "executor")
    graph.add_edge("executor", "verifier")
    
    graph.add_conditional_edges(
        "verifier",
        should_retry,
        {
            "generate_report": "report_generator",
            "retry": "planner",
            "error": END
        }
    )
    
    graph.add_edge("report_generator", END)
    
    # 对话处理节点直接结束
    graph.add_edge("qa_handler", END)
    graph.add_edge("modify_handler", END)
    graph.add_edge("expand_handler", END)
    
    return graph.compile()


workflow = create_graph()
