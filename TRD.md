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

## 三、多轮对话技术设计（v2.0 新增）

### 3.1 架构扩展
```
┌─────────────┐     SSE      ┌───────────────────────────────┐
│   前端      │ ◄───────────►│        FastAPI 后端           │
│ (HTML/CSS/JS)│   (text/event-stream) │  ├─ 路由层：/stream, /chat    │
└─────────────┘              │  ├─ 会话管理：ConversationManager│
                             │  ├─ Agent编排层：LangGraph      │
                             │  │   ├─ 原工作流（首次请求）    │
                             │  │   └─ 对话工作流（后续请求）  │
                             │  ├─ 上下文管理：ContextManager  │
                             │  └─ 模型层：DeepSeek客户端      │
                             └───────────────────────────────┘
```

### 3.2 数据模型
```python
# 消息类型定义
class MessageType(str, Enum):
    QUERY = "query"           # 初始查询
    FOLLOW_UP = "follow_up"   # 追问
    MODIFICATION = "modification"  # 修改
    SUPPLEMENT = "supplement"      # 补充
    REPORT = "report"         # 报告
    ANSWER = "answer"         # 回答

# 消息模型
class Message(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str
    type: MessageType
    timestamp: datetime
    metadata: Dict = {}       # 段落位置、选中内容、搜索结果等

# 会话模型
class Conversation(BaseModel):
    id: str
    title: str                # 自动生成（取首条消息前20字）
    created_at: datetime
    updated_at: datetime
    messages: List[Message]   # 最多保留10轮
    current_report: str       # 当前报告版本
    report_versions: List[Dict]  # 历史版本（用于撤销）
```

### 3.3 对话路由工作流
```python
def route_by_operation(state: WorkState) -> str:
    """根据操作类型路由到不同处理节点"""
    op_type = state.get("operation_type", "generate")
    routing_map = {
        "generate": "planner",
        "follow_up": "qa_handler", 
        "modify": "modify_handler",
        "supplement": "expand_handler"
    }
    return routing_map.get(op_type, "planner")

# 新增节点实现
def qa_handler_node(state: WorkState):
    """追问处理：基于上下文回答，不修改报告"""
    
def modify_handler_node(state: WorkState):
    """修改处理：精准修改选中段落"""
    
def expand_handler_node(state: WorkState):
    """补充处理：在指定位置添加内容"""
```

### 3.4 API 接口
```python
# 对话接口（复用SSE）
@app.get("/api/chat")
async def chat_stream(
    conversation_id: Optional[str] = None,
    query: str,
    operation_type: str = "generate",  # generate/follow_up/modify/supplement
    selected_text: Optional[str] = None,  # 选中的段落
    position: Optional[str] = None        # 插入位置
):
    """多轮对话流式接口"""

# 会话管理
@app.get("/api/conversations")
async def list_conversations()

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str)

@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str)
```

### 3.5 存储方案
**LocalStorage 结构**
```javascript
{
  "conversations": [
    {
      "id": "conv_xxx",
      "title": "Q3市场趋势分析",
      "created_at": "2024-01-15T10:30:00",
      "updated_at": "2024-01-15T11:00:00",
      "messages": [...],  // 最多10轮
      "current_report": "# 报告内容...",
      "report_versions": [
        {"version": 1, "content": "...", "timestamp": "..."}
      ]
    }
  ]
}
```

### 3.6 上下文管理策略
- **保留策略**：最近10轮对话 + 当前报告全文 + 原始搜索结果
- **截断策略**：超过Token限制时，优先截断早期对话，保留最近3轮
- **摘要策略**：对早期对话生成摘要，替代原始内容

## 四、边界与约束（明确不做）
- ❌ 不支持文件上传/多模态输入  
- ❌ 不实现用户登录/服务端历史记录（使用LocalStorage）  
- ❌ 不做搜索结果人工标注（依赖Verifier自动校验）  
- ❌ 不适配移动端（桌面优先）  
- ❌ 不支持多用户协作（单用户会话）  

---

## 五、知识库存储技术设计（v3.0 新增）

### 5.1 系统架构扩展
```
┌─────────────────────────────────────────────────────────────────┐
│                     知识库存储系统架构                           │
├─────────────────────────────────────────────────────────────────┤
│  数据层                                                          │
│  ├── 文件存储：本地文件系统 (./uploads/)                        │
│  ├── 元数据：JSON文件 (./knowledge_base_db.json)               │
│  └── 向量存储：ChromaDB (./chroma_db/)                         │
├─────────────────────────────────────────────────────────────────┤
│  服务层                                                          │
│  ├── DocumentParser (文档解析)                                 │
│  │   ├── TXT/MD: 直接读取                                      │
│  │   ├── DOCX: python-docx                                     │
│  │   ├── XLSX: pandas                                          │
│  │   ├── PPTX: python-pptx                                     │
│  │   └── PDF: PyPDF2                                           │
│  ├── VectorStore (向量存储)                                    │
│  │   ├── 嵌入生成: Ollama API (nomic-embed-text)              │
│  │   ├── 备用方案: 哈希编码                                    │
│  │   └── 相似度检索: ChromaDB (余弦相似度)                     │
│  ├── RelevanceChecker (相关性检查)                             │
│  │   ├── 相似度评估                                            │
│  │   ├── 覆盖度计算                                            │
│  │   └── 置信度判断                                            │
│  └── KnowledgeBaseManager (知识库管理)                         │
│      ├── 文档CRUD                                              │
│      └── 知识库组织                                            │
├─────────────────────────────────────────────────────────────────┤
│  集成层                                                          │
│  ├── API路由: /api/knowledge-base/*                            │
│  ├── 工作流节点: knowledge_base_search_node                    │
│  └── 智能路由: 知识库优先 → API搜索补充                        │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 核心数据模型
```python
# 文档类型枚举
class DocumentType(str, Enum):
    TXT = "txt"
    MD = "md"
    DOC = "doc"
    DOCX = "docx"
    XLS = "xls"
    XLSX = "xlsx"
    PPT = "ppt"
    PPTX = "pptx"
    PDF = "pdf"

# 文档状态
class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

# 文档块模型
class DocumentChunk(BaseModel):
    chunk_id: str
    document_id: str
    content: str
    embedding: Optional[List[float]]
    chunk_index: int
    start_pos: int
    end_pos: int

# 文档模型
class Document(BaseModel):
    document_id: str
    filename: str
    file_type: DocumentType
    file_size: int
    file_path: str
    status: DocumentStatus
    content: Optional[str]
    chunks: List[DocumentChunk]
    metadata: Dict
    created_at: datetime
    updated_at: datetime

# 相关性检查结果
class RelevanceCheckResult(BaseModel):
    is_sufficient: bool      # 是否足够回答
    confidence: float        # 置信度 0-1
    reason: str             # 原因说明
    relevant_chunks: List[SearchResult]
    coverage_score: float   # 覆盖分数
```

### 5.3 工作流集成设计
```python
# 修改后的工作流状态
def knowledge_base_search_node(state: WorkState) -> Dict[str, Any]:
    """
    知识库检索节点 - 新增到工作流入口
    
    1. 检索本地知识库
    2. 评估相关性
    3. 标记是否足够回答
    """
    user_query = state["user_query"]
    
    # 执行相关性检查
    relevance_result = knowledge_base_manager.check_relevance(user_query, top_k=5)
    
    if relevance_result.is_sufficient and relevance_result.confidence >= 0.75:
        # 知识库足够，转换为标准搜索结果格式
        return {
            "search_results": [...],  # 知识库片段
            "kb_sufficient": True,
            "kb_relevance_result": {...}
        }
    else:
        # 知识库不足，继续原有流程
        return {
            "search_results": [...],  # 部分知识库结果
            "kb_sufficient": False,
            "kb_relevance_result": {...}
        }

# 修改后的执行器节点
def executor_node(state: WorkState) -> Dict[str, Any]:
    """
    根据知识库检索结果决定是否调用API搜索
    """
    kb_sufficient = state.get("kb_sufficient", False)
    
    if kb_sufficient:
        # 知识库足够，跳过API搜索
        return {"search_results": state["search_results"], "kb_sufficient": True}
    
    # 知识库不足，执行API搜索补充
    for step in plan_steps:
        results = search_tool.search(step, num_results=3)
        all_results.extend(results)
    
    return {"search_results": all_results, "kb_sufficient": False}

# 工作流图修改
def create_graph() -> StateGraph:
    graph = StateGraph(WorkState)
    
    # 添加知识库检索节点
    graph.add_node("knowledge_base_search", knowledge_base_search_node)
    
    # 入口点改为知识库检索
    graph.set_conditional_entry_point(
        route_by_operation,
        {
            "knowledge_base_search": "knowledge_base_search",
            ...
        }
    )
    
    # 知识库检索后条件分支
    graph.add_conditional_edges(
        "knowledge_base_search",
        should_use_api_search,
        {
            "skip_to_verifier": "verifier",  # 知识库足够
            "need_api_search": "planner"     # 需要API搜索
        }
    )
```

### 5.4 API 接口设计
```python
# 文档上传
@router.post("/knowledge-base/upload")
async def upload_document(file: UploadFile, kb_id: Optional[str] = None)

# 文档管理
@router.get("/knowledge-base/documents")
async def list_documents(kb_id: Optional[str], status: Optional[str])

@router.get("/knowledge-base/documents/{document_id}")
async def get_document(document_id: str)

@router.delete("/knowledge-base/documents/{document_id}")
async def delete_document(document_id: str)

# 知识库搜索
@router.post("/knowledge-base/search")
async def search_knowledge_base(query: str, top_k: int = 5, kb_id: Optional[str] = None)

# 相关性检查
@router.post("/knowledge-base/check-relevance")
async def check_relevance(query: str, top_k: int = 5)

# 知识库管理
@router.post("/knowledge-base/create")
async def create_knowledge_base(name: str, description: str = "")

@router.get("/knowledge-base/list")
async def list_knowledge_bases()

@router.get("/knowledge-base/stats")
async def get_stats()
```

### 5.5 相关性评估算法
```python
def check_relevance(self, query: str, top_k: int = 5) -> RelevanceCheckResult:
    """
    相关性检查核心逻辑
    
    评估维度：
    1. 相似度分数 (40%): 向量检索的相似度
    2. 覆盖度分数 (30%): 查询关键词在结果中的覆盖率
    3. 质量分数 (30%): 结果多样性、内容充分性
    
    判断标准：
    - 至少有一个高相似度结果 (>0.75)
    - 或平均相似度 >= 0.6 且 覆盖度 >= 0.5 且 质量 >= 0.6
    """
    # 1. 执行向量检索
    search_results = self.vector_store.search(query, top_k=top_k)
    
    # 2. 计算覆盖分数
    coverage_score = self._calculate_coverage(query, search_results)
    
    # 3. 评估质量
    quality_score = self._assess_quality(search_results)
    
    # 4. 综合判断
    is_sufficient = self._is_sufficient(search_results, coverage_score, quality_score)
    
    # 5. 计算置信度
    confidence = self._calculate_confidence(search_results, coverage_score, quality_score)
    
    return RelevanceCheckResult(
        is_sufficient=is_sufficient,
        confidence=confidence,
        reason=reason,
        relevant_chunks=search_results,
        coverage_score=coverage_score
    )
```

### 5.6 性能优化策略
| 优化点 | 策略 | 预期效果 |
|--------|------|----------|
| **检索速度** | ChromaDB HNSW索引 | <100ms |
| **嵌入生成** | Ollama本地服务 | 500-1000ms/文档 |
| **批量处理** | 异步文档处理 | 支持并发上传 |
| **降级方案** | 哈希编码备用 | 无需外部依赖 |
| **缓存策略** | 向量结果缓存 | 重复查询加速 |

### 5.7 依赖清单
```
# 新增依赖
chromadb>=0.4.0          # 向量数据库
sentence-transformers    # 备用嵌入模型（可选）
PyPDF2>=3.0.0           # PDF解析
python-docx>=0.8.11     # Word解析
pandas>=1.3.0           # Excel解析
openpyxl>=3.0.0         # Excel支持
python-pptx>=0.6.21     # PPT解析
requests>=2.25.0        # Ollama API调用

# Ollama本地服务
# 需提前安装Ollama并下载嵌入模型
# ollama pull nomic-embed-text
```

---

## 六、报告模板技术设计（v4.0 新增）

### 6.1 系统架构
```
┌─────────────────────────────────────────────────────────────────┐
│                     报告模板系统架构                             │
├─────────────────────────────────────────────────────────────────┤
│  模板定义层                                                      │
│  ├── ReportTemplate (Pydantic模型)                             │
│  │   ├── id, name, description, icon, category                 │
│  │   ├── structure (模板结构定义)                              │
│  │   ├── planner_prompt (规划提示词)                          │
│  │   └── report_prompt (报告生成提示词)                       │
│  └── REPORT_TEMPLATES (模板字典)                              │
├─────────────────────────────────────────────────────────────────┤
│  API层                                                          │
│  ├── GET /api/templates (获取所有模板)                        │
│  ├── GET /api/templates/{id} (获取模板详情)                   │
│  ├── GET /api/templates/categories (获取分类)                │
│  └── GET /api/templates/category/{category} (按分类获取)      │
├─────────────────────────────────────────────────────────────────┤
│  工作流集成层                                                    │
│  ├── planner_node (读取模板planner_prompt)                    │
│  └── report_generator_node (读取模板report_prompt)            │
├─────────────────────────────────────────────────────────────────┤
│  前端层                                                          │
│  ├── TemplateSelector (模板选择器组件)                        │
│  ├── 分类展示 + 网格布局                                        │
│  └── 选中状态管理                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 数据模型
```python
class TemplateType(str, Enum):
    WEEKLY = "weekly"           # 工作周报
    MONTHLY = "monthly"         # 工作月报
    COMPETITOR = "competitor"   # 竞品分析
    INDUSTRY = "industry"       # 行业研究
    PROJECT = "project"         # 项目汇报
    RESEARCH = "research"       # 研究报告
    SUMMARY = "summary"         # 总结汇报
    MARKETING = "marketing"     # 营销方案

class ReportTemplate(BaseModel):
    id: str                     # 模板唯一标识
    name: str                   # 显示名称
    description: str            # 简短描述
    icon: str                   # Emoji图标
    category: str               # 分类（工作汇报/市场分析等）
    structure: List[Dict]       # 报告结构定义
    planner_prompt: str         # Planner节点专用提示词
    report_prompt: str          # Report Generator专用提示词
    default_sections: List[str] # 默认包含的章节
```

### 6.3 工作流集成
```python
# Planner节点集成
def planner_node(state: WorkState) -> Dict[str, Any]:
    template_id = state.get("template_id")
    template = get_template(template_id) if template_id else get_default_template()
    
    # 使用模板特定的规划提示词
    system_prompt = "你是一个任务规划专家..."
    if template and template.planner_prompt:
        system_prompt += f"\n\n{template.planner_prompt}"
    
    # ... 调用LLM生成规划

# Report Generator节点集成
def report_generator_node(state: WorkState) -> Dict[str, Any]:
    template_id = state.get("template_id")
    template = get_template(template_id) if template_id else get_default_template()
    
    # 构建系统提示
    system_prompt = f"你是一个专业报告生成专家...\n【报告类型】{template.name}"
    
    # 构建用户提示，加入模板要求
    user_prompt = f"主题：{user_query}..."
    if template and template.report_prompt:
        user_prompt += f"\n【报告要求】\n{template.report_prompt}"
    
    # ... 调用LLM生成报告
```

### 6.4 API设计
```python
# 获取所有模板
@router.get("/templates")
async def list_templates() -> List[Dict]:
    """返回模板列表（不含详细提示词）"""
    
# 获取模板详情
@router.get("/templates/{template_id}")
async def get_template_detail(template_id: str) -> Dict:
    """返回完整模板信息（含提示词）"""
    
# 获取所有分类
@router.get("/templates/categories")
async def list_categories() -> List[str]:
    """返回所有模板分类"""
    
# 按分类获取模板
@router.get("/templates/category/{category}")
async def get_templates_by_cat(category: str) -> List[Dict]:
    """返回指定分类的模板列表"""
```

### 6.5 前端实现
```javascript
// 模板选择器组件
class TemplateSelector {
    constructor() {
        this.currentTemplateId = 'weekly';
        this.templates = [];
    }
    
    async loadTemplates() {
        const response = await fetch('/api/templates');
        this.templates = await response.json();
        this.render();
    }
    
    render() {
        // 按分类分组渲染
        // 绑定点击事件
        // 更新选中状态
    }
    
    selectTemplate(templateId) {
        this.currentTemplateId = templateId;
        // 更新UI
        // 触发回调
    }
}

// 提交时传递模板ID
this.sseClient.connect(query, callbacks, this.currentTemplateId);
```

### 6.6 模板扩展示例
```python
# 新增模板只需在REPORT_TEMPLATES字典中添加
REPORT_TEMPLATES = {
    TemplateType.WEEKLY: ReportTemplate(
        id="weekly",
        name="工作周报",
        description="记录本周工作进展、成果与下周计划",
        icon="📊",
        category="工作汇报",
        structure=[...],
        planner_prompt="请为工作周报生成搜索步骤...",
        report_prompt="请根据搜索结果生成工作周报...",
        default_sections=[...]
    ),
    # ... 其他模板
}
```

---

## 七、边界与约束（明确不做）
- ❌ 不支持多模态输入（图片、音频、视频）  
- ❌ 不实现用户登录/服务端历史记录（使用LocalStorage）  
- ❌ 不做搜索结果人工标注（依赖Verifier自动校验）  
- ❌ 不适配移动端（桌面优先）  
- ❌ 不支持多用户协作（单用户会话）  
- ❌ 不做知识库版本控制（仅保留最新版本）  
- ❌ 不支持文档在线编辑（仅支持上传新版本）  
- ❌ 不支持自定义模板（仅使用预定义模板）  
- ❌ 不支持模板参数配置（如字数、章节开关）  

---

## 七、智能报告生成工作流程技术设计（v5.0 新增）

### 7.1 系统架构扩展
```
┌─────────────────────────────────────────────────────────────────┐
│                  智能报告生成工作流程架构                        │
├─────────────────────────────────────────────────────────────────┤
│  意图识别层                                                      │
│  ├── IntentRecognizer (意图识别器)                             │
│  │   ├── 问题分类 (报告生成/信息查询/数据分析)                 │
│  │   ├── 核心需求提取                                          │
│  │   └── 关键词识别                                            │
│  └── intent_recognizer_node (工作流节点)                       │
├─────────────────────────────────────────────────────────────────┤
│  知识库评估层                                                    │
│  ├── KnowledgeBaseSearch (知识库检索)                          │
│  │   ├── 向量检索                                              │
│  │   └── 结果排序                                              │
│  ├── SufficiencyEvaluator (充分性评估器)                       │
│  │   ├── 相关性评分                                            │
│  │   ├── 覆盖度计算                                            │
│  │   └── 充分性分级 (sufficient/insufficient/irrelevant)      │
│  └── knowledge_base_search_node (增强版)                       │
├─────────────────────────────────────────────────────────────────┤
│  用户交互层                                                      │
│  ├── UserConfirmation (用户确认管理)                           │
│  │   ├── 确认请求生成                                          │
│  │   ├── 等待用户响应                                          │
│  │   └── 决策执行                                              │
│  ├── ConfirmationDialog (前端对话框)                           │
│  │   ├── 确认提示展示                                          │
│  │   ├── 用户选择收集                                          │
│  │   └── 结果回传                                              │
│  └── user_confirmation_node (工作流节点)                       │
├─────────────────────────────────────────────────────────────────┤
│  决策路由层                                                      │
│  ├── DecisionRouter (决策路由器)                               │
│  │   ├── 路径A: 知识库足够 → 直接生成                          │
│  │   ├── 路径B: 知识库不足 → 询问用户                          │
│  │   └── 路径C: 完全不相关 → 询问用户                          │
│  └── 条件边 (conditional_edges)                                │
│      ├── should_use_knowledge_base                             │
│      ├── should_ask_user_confirmation                          │
│      └── should_use_api_search                                 │
├─────────────────────────────────────────────────────────────────┤
│  报告生成层                                                      │
│  ├── ReportGenerator (报告生成器)                              │
│  │   ├── 基于知识库生成                                        │
│  │   ├── 基于搜索结果生成                                      │
│  │   ├── 基于混合内容生成                                      │
│  │   └── 仅输出模板框架                                        │
│  └── report_generator_node (增强版)                            │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 数据模型扩展
```python
# 意图分析结果
class IntentAnalysis(BaseModel):
    intent_type: str           # 意图类型: report_generation / information_query / data_analysis
    core_requirement: str      # 核心需求描述
    keywords: List[str]        # 关键词列表
    expected_output: str       # 期望输出类型
    confidence: float          # 置信度

# 知识库充分性级别
class KBSufficiencyLevel(str, Enum):
    SUFFICIENT = "sufficient"       # 内容足够，置信度≥75%
    INSUFFICIENT = "insufficient"   # 内容不足，置信度30%-75%
    IRRELEVANT = "irrelevant"       # 完全不相关，置信度<30%

# 用户确认状态
class UserConfirmationStatus(str, Enum):
    PENDING = "pending"         # 等待用户确认
    CONFIRMED = "confirmed"     # 用户确认搜索
    DECLINED = "declined"       # 用户拒绝搜索
    TIMEOUT = "timeout"         # 超时默认

# 扩展WorkState
class WorkState(TypedDict):
    # ... 原有字段 ...
    # 意图识别
    intent_analysis: Optional[IntentAnalysis]
    # 知识库评估
    kb_sufficiency_level: Optional[KBSufficiencyLevel]
    kb_relevance_score: float           # 相关性分数
    kb_coverage_score: float            # 覆盖度分数
    # 用户确认
    needs_user_confirmation: bool       # 是否需要用户确认
    user_confirmation_status: Optional[UserConfirmationStatus]
    user_confirmed_search: Optional[bool]
    confirmation_prompt: Optional[str]  # 确认提示文本
```

### 7.3 工作流节点实现

#### 7.3.1 意图识别节点
```python
def intent_recognizer_node(state: WorkState) -> Dict[str, Any]:
    """
    意图识别节点
    
    分析用户问题的核心意图，提取关键信息
    """
    user_query = state["user_query"]
    
    logger.info(f"开始意图识别: {user_query[:50]}...")
    
    try:
        # 构建提示词
        system_prompt = """你是一个意图识别专家。请分析用户的问题，识别其核心意图和关键信息。
        
请输出JSON格式：
{
    "intent_type": "report_generation|information_query|data_analysis",
    "core_requirement": "核心需求描述",
    "keywords": ["关键词1", "关键词2"],
    "expected_output": "期望输出类型",
    "confidence": 0.95
}"""
        
        # 调用LLM进行意图识别
        response = deepseek_client.generate(
            system_prompt=system_prompt,
            user_prompt=f"用户问题: {user_query}"
        )
        
        # 解析结果
        intent_analysis = parse_intent_response(response)
        
        logger.info(f"意图识别完成: {intent_analysis.intent_type}, 置信度: {intent_analysis.confidence}")
        
        return {
            "intent_analysis": intent_analysis,
            "user_query": user_query  # 可能根据意图进行优化
        }
        
    except Exception as e:
        logger.error(f"意图识别失败: {str(e)}")
        # 降级到通用意图
        return {
            "intent_analysis": IntentAnalysis(
                intent_type="report_generation",
                core_requirement=user_query,
                keywords=[],
                expected_output="报告",
                confidence=0.5
            )
        }
```

#### 7.3.2 增强版知识库检索节点
```python
def knowledge_base_search_node(state: WorkState) -> Dict[str, Any]:
    """
    增强版知识库检索节点
    
    1. 检索知识库
    2. 评估充分性（sufficient/insufficient/irrelevant）
    3. 决定是否需要用户确认
    """
    user_query = state["user_query"]
    intent_analysis = state.get("intent_analysis")
    document_id = state.get("document_id")
    
    logger.info(f"开始知识库检索: {user_query[:50]}...")
    
    try:
        # 如果指定了document_id，直接使用该文档
        if document_id:
            document = knowledge_base_manager.get_document(document_id)
            if document and document.status.value == "completed":
                # 直接使用指定文档，标记为足够
                search_results = []
                for chunk in document.chunks:
                    search_results.append({...})
                
                return {
                    "search_results": search_results,
                    "kb_sufficiency_level": KBSufficiencyLevel.SUFFICIENT,
                    "kb_relevance_score": 1.0,
                    "kb_coverage_score": 1.0,
                    "needs_user_confirmation": False
                }
        
        # 执行相关性检查
        relevance_result = knowledge_base_manager.check_relevance(user_query, top_k=5)
        
        # 根据置信度判断充分性级别
        confidence = relevance_result.confidence
        if confidence >= 0.75:
            sufficiency_level = KBSufficiencyLevel.SUFFICIENT
            needs_confirmation = False
        elif confidence >= 0.3:
            sufficiency_level = KBSufficiencyLevel.INSUFFICIENT
            needs_confirmation = True
        else:
            sufficiency_level = KBSufficiencyLevel.IRRELEVANT
            needs_confirmation = True
        
        # 构建搜索结果
        search_results = []
        for result in relevance_result.relevant_chunks:
            search_results.append({...})
        
        # 生成确认提示文本
        confirmation_prompt = generate_confirmation_prompt(
            sufficiency_level, relevance_result.reason
        )
        
        return {
            "search_results": search_results,
            "kb_sufficiency_level": sufficiency_level,
            "kb_relevance_score": confidence,
            "kb_coverage_score": relevance_result.coverage_score,
            "needs_user_confirmation": needs_confirmation,
            "confirmation_prompt": confirmation_prompt if needs_confirmation else None
        }
        
    except Exception as e:
        logger.error(f"知识库检索失败: {str(e)}")
        return {
            "search_results": [],
            "kb_sufficiency_level": KBSufficiencyLevel.IRRELEVANT,
            "kb_relevance_score": 0.0,
            "kb_coverage_score": 0.0,
            "needs_user_confirmation": True,
            "confirmation_prompt": "知识库检索失败，是否需要通过搜索获取信息？"
        }

def generate_confirmation_prompt(level: KBSufficiencyLevel, reason: str) -> str:
    """生成确认提示文本"""
    if level == KBSufficiencyLevel.INSUFFICIENT:
        return f"知识库内容不足以完整回答您的问题（{reason}）。是否需要通过搜索获取更多信息？"
    else:  # IRRELEVANT
        return f"知识库内容与问题不相关（{reason}）。是否需要通过搜索获取相关信息？"
```

#### 7.3.3 用户确认节点
```python
def user_confirmation_node(state: WorkState) -> Dict[str, Any]:
    """
    用户确认节点
    
    暂停工作流，等待用户确认是否进行搜索
    通过SSE发送确认请求，前端显示对话框
    """
    confirmation_prompt = state.get("confirmation_prompt")
    
    logger.info("等待用户确认...")
    
    # 发送确认请求事件到前端
    yield {
        "event": "user_confirmation_required",
        "data": json.dumps({
            "prompt": confirmation_prompt,
            "options": [
                {"value": True, "label": "是，搜索补充"},
                {"value": False, "label": "否，现有内容"}
            ]
        })
    }
    
    # 等待用户响应（通过API回调更新状态）
    # 实际实现中，这里需要暂停工作流，等待前端回调
    # 简化版本：使用状态轮询或回调机制
    
    # 返回当前状态，等待外部更新
    return {
        "user_confirmation_status": UserConfirmationStatus.PENDING,
        "needs_user_confirmation": True
    }
```

### 7.4 决策路由实现
```python
def should_use_knowledge_base(state: WorkState) -> str:
    """
    决策路由：根据知识库充分性级别决定路径
    """
    sufficiency_level = state.get("kb_sufficiency_level")
    needs_confirmation = state.get("needs_user_confirmation", False)
    
    if sufficiency_level == KBSufficiencyLevel.SUFFICIENT:
        # 路径A：知识库足够，直接生成
        logger.info("知识库内容足够，直接生成报告")
        return "generate_from_kb"
    
    elif needs_confirmation:
        # 路径B/C：需要用户确认
        logger.info("需要用户确认是否搜索")
        return "ask_user_confirmation"
    
    else:
        # 默认使用API搜索
        logger.info("默认使用API搜索")
        return "use_api_search"

def should_use_api_search(state: WorkState) -> str:
    """
    用户确认后的决策路由
    """
    user_confirmed = state.get("user_confirmed_search")
    sufficiency_level = state.get("kb_sufficiency_level")
    
    if user_confirmed:
        # 用户同意搜索
        logger.info("用户确认搜索，调用API")
        return "use_api_search"
    
    elif sufficiency_level == KBSufficiencyLevel.INSUFFICIENT:
        # 用户拒绝搜索，但内容不足，基于现有内容生成
        logger.info("用户拒绝搜索，基于现有内容生成")
        return "generate_from_kb"
    
    else:  # IRRELEVANT
        # 用户拒绝搜索，且内容不相关，仅输出模板框架
        logger.info("用户拒绝搜索且内容不相关，仅输出模板框架")
        return "generate_template_only"
```

### 7.5 增强版报告生成节点
```python
def report_generator_node(state: WorkState) -> Dict[str, Any]:
    """
    增强版报告生成节点
    
    支持多种生成模式：
    1. 基于知识库生成
    2. 基于搜索结果生成
    3. 基于混合内容生成
    4. 仅输出模板框架（内容不相关时）
    """
    user_query = state["user_query"]
    search_results = state.get("search_results", [])
    template_id = state.get("template_id")
    sufficiency_level = state.get("kb_sufficiency_level")
    user_confirmed = state.get("user_confirmed_search")
    
    # 获取模板
    template = get_template(template_id) if template_id else get_default_template()
    
    # 判断生成模式
    if sufficiency_level == KBSufficiencyLevel.IRRELEVANT and not user_confirmed:
        # 模式4：仅输出模板框架
        logger.info("生成模式：仅输出模板框架")
        report = generate_template_only(template, user_query)
        
    elif search_results and any(r.get('source') == 'knowledge_base' for r in search_results):
        # 模式1或3：基于知识库（可能混合搜索）生成
        logger.info("生成模式：基于知识库内容生成")
        report = generate_from_kb_and_search(user_query, search_results, template)
        
    else:
        # 模式2：基于搜索生成
        logger.info("生成模式：基于搜索结果生成")
        report = generate_from_search(user_query, search_results, template)
    
    return {
        "final_report": report,
        "generation_mode": get_generation_mode(sufficiency_level, user_confirmed)
    }

def generate_template_only(template: ReportTemplate, query: str) -> str:
    """仅生成模板框架，不包含实质性内容"""
    report = f"# {template.name}\n\n"
    
    # 添加模板结构框架
    for section in template.structure:
        report += f"## {section['title']}\n\n"
        report += f"*{section['description']}*\n\n"
        report += "（此部分暂无内容）\n\n"
    
    # 添加固定说明
    report += "\n---\n\n"
    report += "**说明**：知识库内容与问题不符，需要您进一步提供更多信息。\n"
    report += "您可以通过以下方式解决：\n"
    report += "1. 上传相关文档到知识库\n"
    report += "2. 重新描述您的问题\n"
    report += "3. 允许系统通过搜索获取信息\n"
    
    return report
```

### 7.6 工作流图定义
```python
def create_graph() -> StateGraph:
    graph = StateGraph(WorkState)
    
    # 添加所有节点
    graph.add_node("intent_recognizer", intent_recognizer_node)
    graph.add_node("knowledge_base_search", knowledge_base_search_node)
    graph.add_node("user_confirmation", user_confirmation_node)
    graph.add_node("planner", planner_node)
    graph.add_node("executor", executor_node)
    graph.add_node("verifier", verifier_node)
    graph.add_node("report_generator", report_generator_node)
    
    # 设置入口点
    graph.set_entry_point("intent_recognizer")
    
    # 意图识别 → 知识库检索
    graph.add_edge("intent_recognizer", "knowledge_base_search")
    
    # 知识库检索后条件分支
    graph.add_conditional_edges(
        "knowledge_base_search",
        should_use_knowledge_base,
        {
            "generate_from_kb": "report_generator",      # 路径A：直接生成
            "ask_user_confirmation": "user_confirmation", # 路径B/C：询问用户
            "use_api_search": "planner"                   # 备用：直接搜索
        }
    )
    
    # 用户确认后条件分支
    graph.add_conditional_edges(
        "user_confirmation",
        should_use_api_search,
        {
            "use_api_search": "planner",              # 用户同意搜索
            "generate_from_kb": "report_generator",   # 用户拒绝，但内容不足
            "generate_template_only": "report_generator"  # 用户拒绝，内容不相关
        }
    )
    
    # 原有工作流边
    graph.add_edge("planner", "executor")
    graph.add_edge("executor", "verifier")
    graph.add_edge("verifier", "report_generator")
    
    # 结束边
    graph.add_edge("report_generator", END)
    
    return graph.compile()
```

### 7.7 前端交互实现
```javascript
// 确认对话框组件
class ConfirmationDialog {
    constructor() {
        this.dialog = document.getElementById('confirmationDialog');
        this.title = document.getElementById('confirmTitle');
        this.message = document.getElementById('confirmMessage');
        this.yesBtn = document.getElementById('confirmYes');
        this.noBtn = document.getElementById('confirmNo');
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.yesBtn.addEventListener('click', () => this.handleResponse(true));
        this.noBtn.addEventListener('click', () => this.handleResponse(false));
    }
    
    show(prompt, onResponse) {
        this.message.textContent = prompt;
        this.onResponse = onResponse;
        this.dialog.style.display = 'flex';
    }
    
    hide() {
        this.dialog.style.display = 'none';
    }
    
    async handleResponse(confirmed) {
        this.hide();
        
        // 发送用户选择到后端
        await fetch('/api/confirm', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({confirmed: confirmed})
        });
        
        if (this.onResponse) {
            this.onResponse(confirmed);
        }
    }
}

// SSE事件处理
handleSSEMessage(event) {
    const data = JSON.parse(event.data);
    
    switch(data.event) {
        case 'user_confirmation_required':
            // 显示确认对话框
            this.confirmationDialog.show(
                data.prompt,
                (confirmed) => {
                    console.log('用户选择:', confirmed ? '搜索' : '不搜索');
                }
            );
            break;
            
        case 'intent_analysis':
            this.showStatus('正在分析您的问题...');
            break;
            
        case 'kb_evaluation':
            this.showStatus('正在评估知识库内容...');
            break;
            
        // ... 其他事件处理
    }
}
```

### 7.8 API接口扩展
```python
# 用户确认回调
@router.post("/confirm")
async def user_confirmation(
    confirmed: bool = Body(...),
    conversation_id: str = Body(...)
):
    """
    用户确认回调接口
    
    前端在用户点击确认按钮后调用此接口
    更新工作流状态，继续执行
    """
    # 更新会话状态
    conversation = conversation_manager.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(404, "会话不存在")
    
    # 更新确认状态
    conversation.metadata["user_confirmed_search"] = confirmed
    conversation.metadata["user_confirmation_status"] = (
        UserConfirmationStatus.CONFIRMED if confirmed 
        else UserConfirmationStatus.DECLINED
    )
    
    # 触发工作流继续（通过事件机制）
    workflow_manager.resume_workflow(conversation_id, confirmed)
    
    return {"status": "success", "confirmed": confirmed}
```

### 7.9 状态机转换图
```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   初始状态   │────▶│   意图识别中     │────▶│  知识库检索中    │
└─────────────┘     └─────────────────┘     └─────────────────┘
                                                      │
                        ┌─────────────────────────────┼─────────────────────────────┐
                        │                             │                             │
                        ▼                             ▼                             ▼
              ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
              │   内容足够       │           │   内容不足       │           │  完全不相关      │
              │ (SUFFICIENT)    │           │ (INSUFFICIENT)  │           │  (IRRELEVANT)   │
              └────────┬────────┘           └────────┬────────┘           └────────┬────────┘
                       │                             │                             │
                       ▼                             ▼                             ▼
              ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
              │  直接生成报告    │           │  等待用户确认    │◀─────────▶│  等待用户确认    │
              │                 │           │  (是否搜索?)     │           │  (是否搜索?)     │
              └─────────────────┘           └────────┬────────┘           └────────┬────────┘
                                                     │                             │
                              ┌──────────────────────┼──────────────────────┐     │
                              │                      │                      │     │
                              ▼                      ▼                      ▼     ▼
                     ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                     │   用户确认搜索   │   │  用户拒绝搜索    │   │  用户拒绝搜索    │
                     │                 │   │  (内容不足)      │   │  (内容不相关)    │
                     └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
                              │                      │                      │
                              ▼                      ▼                      ▼
                     ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                     │  API搜索+生成    │   │ 基于现有内容生成 │   │ 仅输出模板框架   │
                     │                 │   │                 │   │                 │
                     └─────────────────┘   └─────────────────┘   └─────────────────┘
```

> 本文档为开发唯一依据。任何需求变更需同步更新此文档并标注版本。  
> **下一步行动**：基于此文档拆分开发任务（前端SSE客户端→后端基础API→LangGraph节点实现）