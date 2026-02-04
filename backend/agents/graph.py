from langgraph.graph import StateGraph, END
from backend.models.schemas import WorkState
from backend.agents.nodes import planner_node, executor_node, verifier_node, report_generator_node
import logging

logger = logging.getLogger(__name__)


def should_retry(state: WorkState) -> str:
    verification = state.get("verification", {})
    is_valid = verification.get("is_valid", False)
    
    if is_valid:
        logger.info("验证通过，进入报告生成阶段")
        return "generate_report"
    else:
        logger.info("验证失败，直接进入报告生成阶段")
        return "generate_report"


def create_graph() -> StateGraph:
    graph = StateGraph(WorkState)
    
    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_node("verifier", verifier_node)
    graph.add_node("report_generator", report_generator_node)
    
    graph.set_entry_point("planner")
    
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
    
    return graph.compile()


workflow = create_graph()
