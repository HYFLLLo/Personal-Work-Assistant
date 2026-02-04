## 二、技术需求文档（TRD）

### 2.1 系统架构图
```
┌─────────────┐     SSE      ┌───────────────────────────────┐
│   前端      │ ◄───────────►│        FastAPI 后端           │
│ (HTML/CSS/JS)│   (text/event-stream) │  ├─ 路由层：/stream端点       │
└─────────────┘              │  ├─ Agent编排层：LangGraph状态机│
                             │  ├─ 工具层：SerpAPI封装        │
                             │  └─ 模型层：DeepSeek客户端     │
                             └───────────────────────────────┘
                                      ▲
                                      │
                             ┌────────┴────────┐
                             │  LangGraph状态图 │
                             │  (Planner→Executor→Verifier)│
                             └─────────────────┘
```

### 2.2 LangGraph核心设计
#### 状态定义（Pydantic模型）
```python
class WorkState(TypedDict):
    user_query: str          # 原始任务
    plan_steps: List[str]    # Planner输出步骤
    search_results: List[Dict] # Executor累积结果
    verification: Dict       # Verifier反馈（含is_valid/reason）
    final_report: str        # 最终输出
    retry_count: int         # 重试计数器（≤3）
```

#### 节点与条件边
| 节点 | 职责 | 输出事件类型 |
|------|------|--------------|
| `planner_node` | 生成可执行步骤（调用LLM） | `planner_update` |
| `executor_node` | 按步骤调用SerpAPI，聚合结果 | `search_result` |
| `verifier_node` | 检查结果完整性/相关性 | `verification_feedback` |
| **条件边** | **跳转逻辑** | |
| → 验证通过？ | 是 → 生成报告 → 结束 | `final_report` |
| → 验证失败？ | retry_count<3 → 返回planner_node | `retry_trigger` |
| | 否 → 返回错误报告 | `error` |

### 2.3 通信协议（SSE规范）
```http
GET /stream?query=生成AI周报 HTTP/1.1

Event格式示例：
event: planner_update
data: {"step": "1. 搜索2024Q4 AI融资新闻", "plan": ["步骤1","步骤2"]}

event: search_result
data: {"query": "AI 融资 2024 Q4", "snippet": "某公司获1亿美元..."}

event: final_report
data: {"content": "# AI行业周报\\n## 核心动态..."}
```
- 前端需处理：`open/error/message`事件
- 后端需设置：`Cache-Control: no-cache`, `Connection: keep-alive`

### 2.4 关键技术决策
| 问题 | 方案 | 理由 |
|------|------|------|
| 为何用SSE而非WebSocket？ | SSE轻量、天然支持文本流、浏览器原生API | 符合单向推送场景，降低前端复杂度 |
| 为何Verifier独立节点？ | 明确职责分离，便于LangGraph可视化调试 | 避免Planner/Executor逻辑耦合 |
| 搜索结果如何防幻觉？ | Verifier校验：关键词覆盖率+结果数量阈值 | 平衡效率与可靠性，避免无限循环 |
| 前端为何不用框架？ | 原生JS聚焦SSE核心逻辑 | 符合“掌握基础通信机制”学习目标 |

### 2.5 安全与部署
- **密钥管理**：`.env`文件 + `python-dotenv`，.gitignore排除
- **输入校验**：Pydantic模型验证 + 前端长度限制
- **部署建议**：Docker容器化（含gunicorn+uvicorn），Nginx反向代理SSE
- **监控**：关键节点添加`logger.info`（如“Planner输出步骤数：X"）

---

## 三、成功度量标准
| 维度 | 指标 |
|------|------|
| **产品目标** | 用户提交任务→获得可用报告成功率≥85% |
| **学习目标** | 1. LangGraph状态图可被Graphviz可视化2. 前端SSE事件处理代码注释清晰标注各阶段 |
| **工程目标** | 无硬编码密钥；模块解耦（工具/Agent/路由可独立测试） |

---

## 四、边界与约束（明确不做）
- ❌ 不支持文件上传/多模态输入  
- ❌ 不实现用户登录/历史记录（聚焦核心Agent流）  
- ❌ 不做搜索结果人工标注（依赖Verifier自动校验）  
- ❌ 不适配移动端（桌面优先）  

> 本文档为开发唯一依据。任何需求变更需同步更新此文档并标注版本。  
> **下一步行动**：基于此文档拆分开发任务（前端SSE客户端→后端基础API→LangGraph节点实现）