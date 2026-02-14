# 个人工作助手 (Personal Work Assistant)

## 项目简介

个人工作助手是一个基于AI驱动的智能工作辅助系统，通过Perceive-Brain-Act三层架构，实现自动化信息检索、结构化处理和专业汇报生成的完整闭环，帮助用户提高工作效率，释放更多时间用于创造性工作。

## 核心功能

### 🤖 智能任务处理
- 基于Perceive-Brain-Act三层架构，自动拆解任务步骤
- 调用搜索工具获取资料，验证信息可靠性
- 生成结构化、专业的报告

### 🌊 流式交互体验
- 实时显示处理进度，可视化AI模型思考过程
- 搜索关键词和结果摘要实时展示
- 最终报告流式输出，事件延迟<2秒/事件

### 💬 多轮对话协作
- 支持追问模式、修改模式和补充模式
- 实现精准修改和扩展，平均响应时间<3秒

### 📚 知识库管理
- 支持多种格式文档上传（TXT, MD, DOCX, PDF等）
- 智能文档解析和向量存储
- 本地知识库优先检索，相关性评估和智能决策
- 知识库检索响应时间≤500ms

### 📋 报告模板系统
- 提供8种预定义报告模板：
  - 工作周报
  - 月报
  - 竞品分析
  - 行业研究
  - 项目汇报
  - 研究报告
  - 总结汇报
  - 营销方案
- 支持自定义模板

### 📤 报告导出
- 支持导出为TXT、Markdown、Word、PDF等格式
- 导出成功率≥95%

### 📖 历史记录管理
- 保存历史任务和报告，支持按时间、类型、关键词搜索
- 历史记录保存期限≥90天

### ⚙️ 系统设置
- 支持LLM模型选择、知识库配置、系统参数调整等设置

### 📊 监控与日志
- 提供系统运行状态监控、任务执行日志、错误记录等功能

## 技术架构

### 系统架构
- **前端**：HTML5 + CSS3 + JavaScript，赛博朋克风格界面
- **后端**：Python + FastAPI，实现RESTful API
- **AI引擎**：基于LangGraph的Agent系统，包含多个专业Agent
- **知识库**：ChromaDB向量数据库
- **LLM服务**：集成DeepSeek API和Ollama API

### 核心模块
- **意图识别Agent**：分析用户任务的意图和具体要求
- **知识库Agent**：从本地知识库中检索相关信息
- **搜索Agent**：通过外部搜索获取最新信息
- **验证Agent**：验证获取信息的可靠性和准确性
- **报告生成Agent**：生成结构化、专业的报告

## 快速开始

### 环境要求
- Python 3.8+
- Node.js 14+（前端开发）
- 足够的系统资源（建议8GB+内存）

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/yourusername/personal-work-assistant.git
   cd personal-work-assistant
   ```

2. **安装依赖**
   ```bash
   pip install -r requirements.txt
   ```

3. **配置环境变量**
   ```bash
   cp .env.example .env
   # 编辑.env文件，填写必要的配置信息
   ```

4. **启动服务**
   ```bash
   python backend/main.py
   ```

5. **访问系统**
   打开浏览器，访问 `http://localhost:8000`

## 使用指南

### 生成报告
1. 在任务输入区输入任务描述
2. 选择合适的报告模板
3. 可选：上传参考文档到知识库
4. 点击"生成报告"按钮
5. 查看系统处理进度和生成的报告
6. 如需修改，使用多轮对话功能进行调整
7. 导出报告为所需格式

### 管理知识库
1. 进入知识库管理页面
2. 上传文档（支持TXT, MD, DOCX, PDF等格式）
3. 查看文档处理状态
4. 在生成报告时，系统会自动从知识库中检索相关信息

### 查看历史记录
1. 进入历史记录页面
2. 按时间、类型或关键词搜索历史任务
3. 点击查看历史报告详情
4. 支持重新执行历史任务

## 项目结构

```
.
├── backend/             # 后端代码
│   ├── agents/          # AI Agent模块
│   ├── knowledge_base/  # 知识库管理模块
│   ├── models/          # 数据模型
│   ├── routers/         # API路由
│   ├── templates/       # 报告模板
│   ├── tools/           # 工具函数
│   ├── config.py        # 配置文件
│   ├── conversation.py  # 对话管理
│   └── main.py          # 主入口
├── frontend/            # 前端代码
│   └── static/          # 静态资源
│       ├── css/         # 样式文件
│       └── js/          # JavaScript文件
├── chroma_db/           # ChromaDB向量数据库
├── uploads/             # 上传文件存储
├── .env.example         # 环境变量示例
├── .gitignore           # Git忽略文件
├── PRD.md               # 产品需求文档
├── TRD.md               # 技术需求文档
└── requirements.txt     # Python依赖
```

## 配置说明

### 环境变量配置

在 `.env` 文件中配置以下参数：

- `DEEPSEEK_API_KEY`：DeepSeek API密钥
- `OLLAMA_API_URL`：Ollama API地址
- `CHROMA_DB_PATH`：ChromaDB存储路径
- `UPLOAD_DIR`：上传文件存储路径
- `MAX_UPLOAD_SIZE`：最大上传文件大小

### 系统设置

在系统设置页面可配置：

- LLM模型选择（DeepSeek或Ollama）
- 知识库配置（存储路径、向量模型选择等）
- 系统参数调整（响应时间阈值、重试次数等）

## 性能指标

- **响应时间**：平均响应时间<3秒，95%分位响应时间<5秒
- **处理能力**：单任务处理端到端耗时≤90秒，支持≥10个并发任务
- **知识库**：支持≥10万条文档，向量存储支持≥100万条向量
- **准确率**：任务完成准确率≥85%，信息检索准确率≥90%
- **报告质量**：结构完整性≥90%，内容相关性≥85%，语言流畅性≥90%
- **系统可用性**：99.9%

## 安全与隐私

- **数据安全**：数据传输加密（TLS 1.3），敏感数据存储加密（AES-256）
- **隐私保护**：自动识别并处理敏感信息，数据最小化收集
- **合规性**：符合GDPR、网络安全法等法规要求

## 故障处理

### 常见问题

1. **外部API不可用**
   - 系统会自动切换到本地知识库模式
   - 建议上传相关文档到知识库

2. **网络连接中断**
   - 系统会保存当前处理状态
   - 网络恢复后自动继续处理

3. **系统资源不足**
   - 系统会启用资源限制，优先保证核心功能
   - 建议增加系统资源或减少并发任务数

## 开发与扩展

### 开发环境设置

1. **安装开发依赖**
   ```bash
   pip install -r requirements-dev.txt
   ```

2. **运行测试**
   ```bash
   python -m pytest
   ```

3. **代码风格检查**
   ```bash
   flake8 backend/
   ```

### 扩展指南

1. **添加新的Agent**
   - 在 `backend/agents/` 目录下创建新的Agent模块
   - 在 `backend/agents/graph.py` 中注册新的Agent

2. **添加新的报告模板**
   - 在 `backend/templates/report_templates.py` 中添加新的模板定义

3. **集成新的LLM模型**
   - 在 `backend/models/llm.py` 中添加新的模型集成

## 版本历史

### v0.1.0（2026-02-14）
- 初始版本
- 实现核心功能：智能任务处理、流式交互体验、报告模板系统
- 支持基础系统设置和监控

## 贡献指南

我们欢迎社区贡献！请按照以下步骤进行：

1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开Pull Request

## 许可证

本项目采用MIT许可证。详见 [LICENSE](LICENSE) 文件。

## 联系方式

- 项目维护者：[Your Name]
- 邮箱：[your.email@example.com]
- GitHub：[https://github.com/yourusername/personal-work-assistant](https://github.com/yourusername/personal-work-assistant)

---

**个人工作助手** - 让AI为你工作，释放创造力！