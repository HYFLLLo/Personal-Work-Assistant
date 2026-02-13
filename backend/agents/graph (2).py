from langgraph.graph import StateGraph, END
from backend.models.schemas import WorkState
from backend.agents.nodes import (
    planner_node, executor_node, verifier_node, report_generator_node,
    qa_handler_node, modify_handler_node, expand_handler_node
)
import logging

logger = logging.getLogger(__name__)


def should_retry(state: WorkState) -> str:
    # 无论验证结果如何，都直接进入报告生成阶段，不进行重试
    logger.info("进入报告生成阶段")
    return "generate_report"


def route_by_operation(state: WorkState) -> str:
    """根据操作类型路由到不同处理节点"""
    op_type = state.get("operation_type", "generate")
    
    routing_map = {
        "generate": "planner",
        "follow_up": "qa_handler",
        "modify": "modify_handler",
        "supplement": "expand_handler"
    }
    
    route = routing_map.get(op_type, "planner")
    logger.info(f"操作类型: {op_type}, 路由到: {route}")
    return route


def create_graph() -> StateGraph:
    graph = StateGraph(WorkState)
    
    # 添加所有节点
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
            "planner": "planner",
            "qa_handler": "qa_handler",
            "modify_handler": "modify_handler",
            "expand_handler": "expand_handler"
        }
    )
    
    # 原工作流边（generate 流程）
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
