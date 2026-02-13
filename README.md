# 个人工作助手 (Personal Work Assistant)

[![GitHub stars](https://img.shields.io/github/stars/HYFLLLo/Personal-Work-Assistant?style=social)](https://github.com/HYFLLLo/Personal-Work-Assistant/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/HYFLLLo/Personal-Work-Assistant?style=social)](https://github.com/HYFLLLo/Personal-Work-Assistant/network/members)

## 📋 项目简介

个人工作助手是一个轻量级AI工作流系统，通过**自动化信息检索→结构化处理→专业汇报生成**的完整闭环，解决职场中重复性资料整理痛点，同时作为AI Agent架构的实践载体。

### 🌟 核心价值
- **效率提升**：将资料搜集与格式整理时间减少80%
- **专业输出**：基于预定义模板生成结构化报告
- **智能交互**：支持多轮对话，实现精准修改和扩展
- **知识管理**：本地知识库存储，提升信息复用率

## 🚀 核心功能

### 1. 智能任务处理
- 自动拆解任务步骤
- 调用搜索工具获取资料
- 验证信息可靠性
- 生成结构化报告

### 2. 流式交互体验
- 实时显示处理进度
- 可视化Planner思考过程
- 搜索关键词和结果摘要
- 最终报告流式输出

### 3. 多轮对话协作
- **追问模式**：基于选中段落获取详细解释
- **修改模式**：精准修改报告中的特定段落
- **补充模式**：在指定位置添加新内容

### 4. 知识库管理
- 支持多种格式文档上传（TXT, MD, DOCX, PDF等）
- 智能文档解析和向量存储
- 本地知识库优先检索
- 相关性评估和智能决策

### 5. 报告模板系统
- **工作周报**：周工作总结和计划
- **工作月报**：月度工作成果和分析
- **竞品分析**：竞争对手调研和对比
- **行业研究**：行业趋势和机会分析
- **项目汇报**：项目进度和风险管理
- **研究报告**：深度研究和洞察
- **总结汇报**：事件总结和经验提取
- **营销方案**：营销策划和执行计划

## 🛠️ 技术栈

### 后端
- **框架**：FastAPI, LangGraph
- **向量数据库**：ChromaDB
- **文档解析**：PyPDF2, python-docx, pandas, python-pptx
- **嵌入模型**：Ollama API (nomic-embed-text)
- **部署**：Uvicorn

### 前端
- **基础**：HTML5, CSS3, JavaScript (ES6+)
- **样式**：原生CSS, 响应式设计
- **交互**：Server-Sent Events (SSE)
- **存储**：LocalStorage

### 依赖管理
- Python 3.9+
- 详见 `requirements.txt`

## 📦 快速开始

### 1. 环境准备

#### 安装Python依赖
```bash
pip install -r requirements.txt
```

#### 安装Ollama（用于嵌入模型）
1. 下载并安装 [Ollama](https://ollama.com/download)
2. 拉取嵌入模型：
   ```bash
   ollama pull nomic-embed-text
   ```

### 2. 配置环境变量

复制环境变量示例文件并修改：
```bash
cp .env.example .env
```

编辑 `.env` 文件，配置必要的环境变量：
```env
# 应用配置
APP_HOST=0.0.0.0
APP_PORT=8000

# 搜索API配置（可选）
SERPAPI_KEY=your_serpapi_key

# Ollama配置
OLLAMA_HOST=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
```

### 3. 启动应用

```bash
python -m backend.main
```

应用将在 `http://localhost:8000` 启动。

## 📁 项目结构

```
├── backend/                 # 后端代码
│   ├── agents/             # LangGraph智能体
│   ├── knowledge_base/     # 知识库系统
│   ├── models/             # 数据模型
│   ├── routers/            # API路由
│   ├── templates/          # 报告模板
│   ├── tools/              # 工具函数
│   ├── config.py           # 配置管理
│   ├── conversation.py     # 会话管理
│   └── main.py             # 应用入口
├── frontend/               # 前端代码
│   └── static/             # 静态资源
│       ├── css/            # 样式文件
│       └── js/             # JavaScript文件
├── chroma_db/              # 向量数据库
├── uploads/                # 上传文件存储
├── .env.example            # 环境变量示例
├── PRD.md                  # 产品需求文档
├── TRD.md                  # 技术需求文档
├── requirements.txt        # 依赖清单
└── README.md               # 项目说明
```

## 📖 使用指南

### 1. 生成报告

1. 在首页输入任务描述，例如："生成Q3市场趋势分析"
2. 选择合适的报告模板（可选，默认使用工作周报）
3. 点击"提交"按钮
4. 实时查看处理进度和思考过程
5. 等待报告生成完成
6. 点击"复制报告"按钮获取结果

### 2. 多轮对话

#### 追问细节
1. 选中报告中的某个段落
2. 点击"追问"按钮
3. 输入具体问题
4. 查看详细回答

#### 修改内容
1. 选中需要修改的段落
2. 点击"修改"按钮
3. 输入修改要求
4. 查看修改结果（Diff高亮显示）

#### 补充扩展
1. 在需要补充的位置点击
2. 点击"补充"按钮
3. 输入补充要求
4. 查看补充内容

### 3. 知识库管理

1. 点击导航栏"知识库"进入管理页面
2. 点击"上传文档"按钮选择文件
3. 等待文档处理完成（解析和嵌入）
4. 在主页面提交任务时，系统会自动检索知识库

## 🔧 配置说明

### 环境变量

| 变量名 | 类型 | 默认值 | 说明 |
|-------|------|-------|------|
| APP_HOST | str | 0.0.0.0 | 应用主机地址 |
| APP_PORT | int | 8000 | 应用端口 |
| SERPAPI_KEY | str | - | SerpAPI密钥（可选） |
| OLLAMA_HOST | str | http://localhost:11434 | Ollama服务地址 |
| EMBEDDING_MODEL | str | nomic-embed-text | 嵌入模型名称 |

### 系统配置

- **文档上传限制**：单文件最大50MB
- **输入长度限制**：任务描述≤500字符
- **对话历史**：最多保留10轮上下文
- **知识库容量**：支持万级文档存储

## 📈 性能指标

- **单任务处理**：端到端耗时≤90秒
- **流式交互**：延迟<2秒/事件
- **知识库检索**：响应时间≤500ms
- **报告生成**：成功率≥85%
- **相关性判断**：准确率≥85%

## 🔍 开发说明

### 运行测试

```bash
python test_integration.py
```

### 代码风格

- 遵循PEP 8规范
- 使用类型提示
- 模块化设计，便于扩展

### 扩展指南

1. **添加新模板**：在 `backend/templates/report_templates.py` 中定义
2. **添加新工具**：在 `backend/tools/` 目录中创建新模块
3. **扩展知识库**：修改 `backend/knowledge_base/` 相关模块
4. **前端扩展**：修改 `frontend/static/` 目录下的文件

## 🤝 贡献指南

1. **Fork** 本仓库
2. **创建** 特性分支 (`git checkout -b feature/amazing-feature`)
3. **提交** 更改 (`git commit -m 'Add some amazing feature'`)
4. **推送到** 分支 (`git push origin feature/amazing-feature`)
5. **开启** Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 📞 联系方式

- **GitHub**：[HYFLLLo](https://github.com/HYFLLLo)
- **项目地址**：[https://github.com/HYFLLLo/Personal-Work-Assistant](https://github.com/HYFLLLo/Personal-Work-Assistant)

---

**感谢使用个人工作助手！** 🎉

如果觉得这个项目有帮助，欢迎给个 ⭐️ 支持一下！