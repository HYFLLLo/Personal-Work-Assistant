/**
 * FlowAgent - 个人工作助手前端应用
 * 优化版：支持步骤可视化、折叠展开、增强交互
 */

class SSEClient {
    constructor() {
        this.eventSource = null;
        this.isConnected = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 2000;
    }

    connect(query, callbacks) {
        if (this.eventSource) {
            this.disconnect();
        }

        const url = `http://localhost:8000/api/stream?query=${encodeURIComponent(query)}`;
        this.eventSource = new EventSource(url);

        this.eventSource.onopen = () => {
            this.isConnected = true;
            this.retryCount = 0;
            console.log('SSE连接已建立');
            if (callbacks.onOpen) callbacks.onOpen();
        };

        this.eventSource.onmessage = (event) => {
            console.log('收到消息:', event.data);
            if (callbacks.onMessage) callbacks.onMessage(event);
        };

        this.eventSource.onerror = (error) => {
            console.error('SSE连接错误:', error);
            this.isConnected = false;
            
            if (callbacks.onError) callbacks.onError(error);

            if (this.retryCount < this.maxRetries) {
                this.retryCount++;
                console.log(`尝试重连 (${this.retryCount}/${this.maxRetries})...`);
                setTimeout(() => {
                    this.connect(query, callbacks);
                }, this.retryDelay);
            } else {
                this.disconnect();
            }
        };

        this.setupEventListeners(callbacks);
    }

    setupEventListeners(callbacks) {
        const eventTypes = ['start', 'planner_update', 'search_result', 'verification_feedback', 'retry_trigger', 'final_report', 'error', 'end'];
        
        eventTypes.forEach(eventType => {
            this.eventSource.addEventListener(eventType, (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (callbacks[eventType]) callbacks[eventType](data);
                } catch (error) {
                    console.error(`解析${eventType}事件数据失败:`, error);
                }
            });
        });
    }

    disconnect() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
            this.isConnected = false;
            console.log('SSE连接已关闭');
        }
    }
}

class App {
    constructor() {
        this.sseClient = new SSEClient();
        this.isProcessing = false;
        this.timerInterval = null;
        this.processingTime = 0;
        this.currentNodeId = 0;
        this.currentStepId = 0;
        this.searchTransitionNode = null;
        this.reportTransitionNode = null;
        this.workflowData = {
            planner: null,
            searches: [],
            verifications: [],
            report: null
        };
        
        this.initElements();
        this.createHistoryModal();
        this.bindEvents();
        this.loadHistory();
    }

    initElements() {
        // 顶部状态栏
        this.statusBadge = document.getElementById('statusBadge');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.timer = document.getElementById('timer');

        // 历史记录按钮
        this.historyBtn = document.getElementById('historyBtn');
        this.historyCount = document.getElementById('historyCount');

        // 左侧任务工作台
        this.queryInput = document.getElementById('queryInput');
        this.charCount = document.getElementById('charCount');
        this.charCountBar = document.getElementById('charCountBar');
        this.submitBtn = document.getElementById('submitBtn');
        this.submitBtnIcon = document.getElementById('submitBtnIcon');
        this.submitBtnText = document.getElementById('submitBtnText');

        // 右侧智能流程画布
        this.workflowCanvas = document.getElementById('workflowCanvas');
        this.emptyState = document.getElementById('emptyState');
        this.workflowNodes = document.getElementById('workflowNodes');
    }

    bindEvents() {
        this.queryInput.addEventListener('input', () => this.updateCharCount());
        this.submitBtn.addEventListener('click', () => this.handleSubmit());
        
        // 历史记录按钮事件
        this.historyBtn.addEventListener('click', () => this.openHistoryModal());
        
        // 模态框关闭事件
        if (this.historyModalClose) {
            this.historyModalClose.addEventListener('click', () => this.closeHistoryModal());
        }
        if (this.historyModalOverlay) {
            this.historyModalOverlay.addEventListener('click', () => this.closeHistoryModal());
        }
        
        // 报告模态框关闭事件
        if (this.reportModalClose) {
            this.reportModalClose.addEventListener('click', () => this.closeReportModal());
        }
        if (this.reportModalOverlay) {
            this.reportModalOverlay.addEventListener('click', () => this.closeReportModal());
        }
        
        // 报告操作按钮
        if (this.reportModalCopy) {
            this.reportModalCopy.addEventListener('click', () => this.copyCurrentReport());
        }
        if (this.reportModalExport) {
            this.reportModalExport.addEventListener('click', () => this.exportCurrentReport());
        }
        
        // ESC键关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeHistoryModal();
                this.closeReportModal();
            }
        });
        
        // 预置问题点击事件
        this.bindPresetQuestions();
    }
    
    bindPresetQuestions() {
        const presetItems = document.querySelectorAll('.preset-item');
        presetItems.forEach(item => {
            // 点击事件 - 只填充输入框，不自动提交
            item.addEventListener('click', () => {
                const query = item.dataset.query;
                if (query) {
                    this.queryInput.value = query;
                    this.updateCharCount();
                    // 聚焦到输入框，让用户可以编辑或点击生成按钮
                    this.queryInput.focus();
                    // 滚动到输入框位置（移动端友好）
                    this.queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            
            // 键盘事件（可访问性）- 只填充输入框，不自动提交
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const query = item.dataset.query;
                    if (query) {
                        this.queryInput.value = query;
                        this.updateCharCount();
                        this.queryInput.focus();
                        this.queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            });
        });
    }

    // 历史记录模态框
    createHistoryModal() {
        this.historyModal = document.getElementById('historyModal');
        this.historyModalOverlay = document.getElementById('historyModalOverlay');
        this.historyModalClose = document.getElementById('historyModalClose');
        this.historyModalBody = document.getElementById('historyModalBody');
        
        this.reportModal = document.getElementById('reportModal');
        this.reportModalOverlay = document.getElementById('reportModalOverlay');
        this.reportModalClose = document.getElementById('reportModalClose');
        this.reportModalTitle = document.getElementById('reportModalTitle');
        this.reportModalBody = document.getElementById('reportModalBody');
        this.reportModalCopy = document.getElementById('reportModalCopy');
        this.reportModalExport = document.getElementById('reportModalExport');
        
        this.currentReportContent = '';
    }

    openHistoryModal() {
        if (this.historyModal) {
            this.renderHistoryList();
            this.historyModal.classList.add('show');
            this.historyBtn.classList.add('active');
            // 焦点管理
            this.historyModalClose.focus();
        }
    }

    closeHistoryModal() {
        if (this.historyModal) {
            this.historyModal.classList.remove('show');
            this.historyBtn.classList.remove('active');
            // 焦点返回到触发按钮
            this.historyBtn.focus();
        }
    }

    openReportModal(item) {
        if (this.reportModal) {
            this.reportModalTitle.textContent = item.query;
            this.reportModalBody.innerHTML = this.formatReportContent(item.report);
            this.currentReportContent = item.report;
            this.reportModal.classList.add('show');
        }
    }

    closeReportModal() {
        if (this.reportModal) {
            this.reportModal.classList.remove('show');
        }
    }

    renderHistoryList() {
        const history = this.getHistory();
        
        if (history.length === 0) {
            this.historyModalBody.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon">📝</div>
                    <div class="history-empty-text">暂无历史记录</div>
                </div>
            `;
            return;
        }
        
        this.historyModalBody.innerHTML = history.map(item => {
            const date = new Date(item.timestamp);
            const timeStr = date.toLocaleString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            return `
                <div class="history-list-item" data-id="${item.id}" tabindex="0" role="button">
                    <div class="history-item-query">${this.escapeHtml(item.query)}</div>
                    <div class="history-item-meta">
                        <div class="history-item-time">🕐 ${timeStr}</div>
                        <div class="history-item-status ${item.status}">
                            ${item.status === 'completed' ? '✅ 已完成' : '❌ 失败'}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        // 绑定点击事件
        this.historyModalBody.querySelectorAll('.history-list-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id);
                const item = history.find(h => h.id === id);
                if (item) {
                    this.openReportModal(item);
                }
            });
            
            // 键盘事件
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const id = parseInt(el.dataset.id);
                    const item = history.find(h => h.id === id);
                    if (item) {
                        this.openReportModal(item);
                    }
                }
            });
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    copyCurrentReport() {
        if (this.currentReportContent) {
            navigator.clipboard.writeText(this.currentReportContent).then(() => {
                this.showNotification('报告已复制到剪贴板', 'success');
            }).catch(() => {
                this.showNotification('复制失败', 'error');
            });
        }
    }

    exportCurrentReport() {
        if (this.currentReportContent) {
            const blob = new Blob([this.currentReportContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `report_${new Date().getTime()}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    // 历史记录相关方法
    getHistoryKey() {
        return 'flowagent_history';
    }

    loadHistory() {
        const history = this.getHistory();
        this.updateHistoryCount(history);
    }

    getHistory() {
        try {
            const data = localStorage.getItem(this.getHistoryKey());
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('加载历史记录失败:', e);
            return [];
        }
    }

    saveHistory(history) {
        try {
            localStorage.setItem(this.getHistoryKey(), JSON.stringify(history));
        } catch (e) {
            console.error('保存历史记录失败:', e);
        }
    }

    addToHistory(query, report, duration, status = 'completed') {
        console.log('========== 添加历史记录 ==========');
        console.log('Query:', query.substring(0, 50) + '...');
        console.log('Report长度:', report ? report.length : 0);
        console.log('Duration:', duration);
        console.log('Status:', status);
        
        try {
            const history = this.getHistory();
            console.log('当前历史记录数:', history.length);
            
            const item = {
                id: Date.now(),
                query: query,
                report: report,
                timestamp: Date.now(),
                duration: duration,
                status: status
            };

            // 添加到开头
            history.unshift(item);

            // 最多保存20条
            if (history.length > 20) {
                history.pop();
            }

            console.log('准备保存，新历史记录数:', history.length);
            this.saveHistory(history);
            this.updateHistoryCount(history);
            
            // 验证保存是否成功
            const verifyHistory = this.getHistory();
            console.log('验证保存结果:', verifyHistory.length);
            console.log('========== 历史记录保存完成 ==========');
        } catch (e) {
            console.error('添加历史记录时出错:', e);
        }
    }

    updateHistoryCount(history) {
        if (this.historyCount) {
            this.historyCount.textContent = history.length;
        }
    }

    updateCharCount() {
        const count = this.queryInput.value.length;
        const maxCount = 500;
        const percentage = (count / maxCount) * 100;
        
        this.charCount.textContent = count;
        this.charCountBar.style.width = `${percentage}%`;
        
        // 根据进度改变颜色
        this.charCountBar.classList.remove('warning', 'danger');
        if (percentage >= 90) {
            this.charCountBar.classList.add('danger');
        } else if (percentage >= 70) {
            this.charCountBar.classList.add('warning');
        }
    }

    handleSubmit() {
        const query = this.queryInput.value.trim();
        
        if (!query) {
            this.showNotification('请输入任务描述', 'error');
            return;
        }

        if (this.queryInput.value.length > 500) {
            this.showNotification('任务描述不能超过500字符', 'error');
            return;
        }

        if (this.isProcessing) {
            return;
        }

        this.startProcessing(query);
    }

    startProcessing(query) {
        this.isProcessing = true;
        this.processingTime = 0;
        this.currentNodeId = 0;
        this.currentStepId = 0;
        this.workflowData = {
            planner: null,
            searches: [],
            verifications: [],
            report: null
        };
        
        // 更新状态
        this.updateStatus('working', '智能规划中...');
        this.startTimer();
        
        // 更新按钮状态
        this.submitBtn.disabled = true;
        this.submitBtn.classList.add('processing');
        this.submitBtnIcon.textContent = '';
        this.submitBtnIcon.className = 'btn-loader';
        this.submitBtnText.textContent = '处理中...';
        
        // 清空画布
        this.workflowNodes.innerHTML = '';
        this.emptyState.style.display = 'none';
        this.workflowNodes.style.display = 'flex';
        
        // 初始化工作流模块
        this.initWorkflowModules();
        
        const callbacks = {
            onOpen: () => {
                console.log('开始处理任务');
            },
            onError: (error) => {
                this.addErrorStep('连接失败', '网络波动或服务器暂不可用');
                this.endProcessing();
            },
            start: (data) => {
                console.log('收到开始事件:', data);
                this.updateStatus('working', '开始处理任务...');
                this.addWorkflowStep('start', '🚀', '任务启动', '开始处理用户请求');
            },
            planner_update: (data) => {
                this.workflowData.planner = data;
                this.addPlannerSteps(data);
                this.updateModuleStatus('planner', 'completed');
                this.updateModuleStatus('executor', 'active');
            },
            search_result: (data) => {
                this.workflowData.searches.push(data);
                this.addSearchStep(data);
            },
            verification_feedback: (data) => {
                this.workflowData.verifications.push(data);
                this.addVerificationStep(data);
                if (data.is_valid) {
                    this.updateModuleStatus('executor', 'completed');
                    this.updateModuleStatus('reporter', 'active');
                }
            },
            retry_trigger: (data) => {
                console.log('收到重试事件:', data);
                this.addWorkflowStep('retry', '🔄', '重新规划', data.message || '验证失败，正在重新规划...');
            },
            final_report: (data) => {
                this.workflowData.report = data;
                this.addReportStep(data);
                this.updateModuleStatus('reporter', 'completed');
                this.updateStatus('completed', '报告已生成 ✅');
                
                // 保存到历史记录
                const duration = this.formatTime(this.processingTime);
                this.addToHistory(query, data.content, duration, 'completed');
                this.endProcessing();
                this.showNotification('任务处理完成', 'success');
            },
            error: (data) => {
                this.addErrorStep('处理失败', data.message || '未知错误');
                this.endProcessing();
                this.showNotification('任务处理失败', 'error');
            },
            end: (data) => {
                console.log('收到结束事件:', data);
            }
        };

        this.sseClient.connect(query, callbacks);
    }

    endProcessing() {
        this.isProcessing = false;
        this.stopTimer();
        
        // 恢复按钮状态
        this.submitBtn.disabled = false;
        this.submitBtn.classList.remove('processing');
        this.submitBtnIcon.className = 'btn-icon';
        this.submitBtnIcon.textContent = '🚀';
        this.submitBtnText.textContent = '生成报告';
        
        this.sseClient.disconnect();
    }

    showNotification(message, type) {
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️'
        };
        
        const titles = {
            success: '成功',
            error: '错误',
            warning: '警告'
        };
        
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span class="notification-icon">${icons[type]}</span>
            <div class="notification-content">
                <div class="notification-title">${titles[type]}</div>
                <div class="notification-message">${message}</div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // ========== 工作流模块管理 ==========
    
    initWorkflowModules() {
        this.workflowNodes.innerHTML = `
            <div class="workflow-module" id="module-planner">
                <div class="workflow-module-header">
                    <div class="module-icon">🧠</div>
                    <div class="module-title">[Planner] 任务规划</div>
                    <div class="module-status active" id="status-planner">进行中</div>
                </div>
                <div class="workflow-steps" id="steps-planner"></div>
            </div>
            
            <div class="workflow-module" id="module-executor">
                <div class="workflow-module-header">
                    <div class="module-icon">🔍</div>
                    <div class="module-title">[Executor] 信息执行</div>
                    <div class="module-status pending" id="status-executor">等待中</div>
                </div>
                <div class="workflow-steps" id="steps-executor"></div>
            </div>
            
            <div class="workflow-module" id="module-reporter">
                <div class="workflow-module-header">
                    <div class="module-icon">📄</div>
                    <div class="module-title">[Reporter] 报告生成</div>
                    <div class="module-status pending" id="status-reporter">等待中</div>
                </div>
                <div class="workflow-steps" id="steps-reporter"></div>
            </div>
        `;
        
        this.stepsPlanner = document.getElementById('steps-planner');
        this.stepsExecutor = document.getElementById('steps-executor');
        this.stepsReporter = document.getElementById('steps-reporter');
    }

    updateModuleStatus(module, status) {
        const statusEl = document.getElementById(`status-${module}`);
        if (statusEl) {
            statusEl.className = `module-status ${status}`;
            statusEl.textContent = status === 'active' ? '进行中' : status === 'completed' ? '已完成' : '等待中';
        }
    }

    addWorkflowStep(type, icon, title, description, module = 'planner') {
        const stepId = `step-${this.currentStepId++}`;
        const timestamp = new Date().toLocaleTimeString('zh-CN', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        const stepHtml = `
            <div class="workflow-step" id="${stepId}" data-type="${type}">
                <div class="step-header">
                    <div class="step-number">${this.currentStepId}</div>
                    <div class="step-content-wrapper">
                        <div class="step-title-row">
                            <div class="step-title">
                                <span class="step-icon">${icon}</span>
                                <span>${title}</span>
                            </div>
                            <div class="step-time">${timestamp}</div>
                        </div>
                        <div class="step-description">${description}</div>
                    </div>
                </div>
            </div>
        `;
        
        let container;
        switch(module) {
            case 'planner': container = this.stepsPlanner; break;
            case 'executor': container = this.stepsExecutor; break;
            case 'reporter': container = this.stepsReporter; break;
            default: container = this.stepsPlanner;
        }
        
        if (container) {
            container.insertAdjacentHTML('beforeend', stepHtml);
            this.scrollToBottom();
        }
        
        return stepId;
    }

    addPlannerSteps(data) {
        // 添加规划步骤
        const stepId = this.addWorkflowStep(
            'planner', 
            '📋', 
            '任务规划完成', 
            `已拆解为 ${data.plan.length} 个执行步骤`,
            'planner'
        );
        
        // 添加可折叠的详细计划
        const stepEl = document.getElementById(stepId);
        const detailsHtml = `
            <div class="step-details collapsed" id="${stepId}-details">
                <ul class="plan-list">
                    ${data.plan.map((item, idx) => `<li>${idx + 1}. ${item}</li>`).join('')}
                </ul>
            </div>
            <button class="step-toggle" onclick="this.classList.toggle('expanded'); document.getElementById('${stepId}-details').classList.toggle('collapsed')">
                <span>查看详情</span>
                <span class="step-toggle-icon">▼</span>
            </button>
        `;
        
        stepEl.insertAdjacentHTML('beforeend', detailsHtml);
        this.scrollToBottom();
    }

    addSearchStep(data) {
        const stepId = this.addWorkflowStep(
            'search', 
            '🔍', 
            '信息检索', 
            `搜索：${data.query.substring(0, 50)}${data.query.length > 50 ? '...' : ''}`,
            'executor'
        );
        
        // 添加可折叠的搜索结果
        const stepEl = document.getElementById(stepId);
        const detailsHtml = `
            <div class="step-details collapsed" id="${stepId}-details">
                <div class="search-results">
                    <div class="search-item">
                        <div class="search-query">${data.query}</div>
                        <div class="search-snippet">${data.snippet}</div>
                    </div>
                </div>
            </div>
            <button class="step-toggle" onclick="this.classList.toggle('expanded'); document.getElementById('${stepId}-details').classList.toggle('collapsed')">
                <span>查看结果</span>
                <span class="step-toggle-icon">▼</span>
            </button>
        `;
        
        stepEl.insertAdjacentHTML('beforeend', detailsHtml);
        this.scrollToBottom();
    }

    addVerificationStep(data) {
        const isValid = data.is_valid;
        const stepId = this.addWorkflowStep(
            'verification', 
            isValid ? '✅' : '⚠️', 
            '质量校验', 
            data.reason,
            'executor'
        );
        
        const stepEl = document.getElementById(stepId);
        stepEl.classList.add(isValid ? 'completed' : 'warning');
        
        // 更新步骤序号样式
        const stepNumber = stepEl.querySelector('.step-number');
        if (stepNumber) {
            stepNumber.classList.add(isValid ? 'completed' : 'error');
        }
        
        this.scrollToBottom();
    }

    addReportStep(data) {
        const stepId = this.addWorkflowStep(
            'report', 
            '📄', 
            '报告生成完成', 
            '结构化报告已生成，点击下方按钮查看或导出',
            'reporter'
        );
        
        const stepEl = document.getElementById(stepId);
        const stepNumber = stepEl.querySelector('.step-number');
        if (stepNumber) {
            stepNumber.classList.add('completed');
        }
        
        // 保存报告内容供导出使用
        this.currentReportContent = data.content;
        this.currentReportTitle = data.title || '报告';
        
        // 添加可折叠的报告内容
        const formattedContent = this.formatReportContent(data.content);
        const detailsHtml = `
            <div class="step-details collapsed" id="${stepId}-details">
                <div class="report-content">${formattedContent}</div>
                <div class="report-actions">
                    <button class="report-action-btn" onclick="navigator.clipboard.writeText(\`${data.content.replace(/`/g, '\\`')}\`).then(() => alert('已复制到剪贴板'))">
                        📋 复制全文
                    </button>
                    <button class="report-action-btn export-btn" onclick="app.exportReport('txt')">
                        📝 导出TXT
                    </button>
                    <button class="report-action-btn export-btn" onclick="app.exportReport('markdown')">
                        📝 导出Markdown
                    </button>
                    <button class="report-action-btn export-btn" onclick="app.exportReport('word')">
                        📄 导出Word
                    </button>
                    <button class="report-action-btn export-btn" onclick="app.exportReport('pdf')">
                        📕 导出PDF
                    </button>
                </div>
            </div>
            <button class="step-toggle" onclick="this.classList.toggle('expanded'); document.getElementById('${stepId}-details').classList.toggle('collapsed')">
                <span>查看报告</span>
                <span class="step-toggle-icon">▼</span>
            </button>
        `;
        
        stepEl.insertAdjacentHTML('beforeend', detailsHtml);
        this.scrollToBottom();
    }

    // 导出报告方法
    async exportReport(format) {
        if (!this.currentReportContent) {
            alert('没有可导出的报告内容');
            return;
        }
        
        try {
            const response = await fetch('http://localhost:8000/api/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    content: this.currentReportContent,
                    format: format,
                    title: this.currentReportTitle
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || '导出失败');
            }
            
            // 获取文件名
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `report.${format === 'word' ? 'docx' : format === 'markdown' ? 'md' : format}`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename=(.+)/);
                if (match) {
                    filename = match[1];
                }
            }
            
            // 下载文件
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('导出失败:', error);
            alert('导出失败: ' + error.message);
        }
    }

    addErrorStep(title, message) {
        const stepId = this.addWorkflowStep('error', '❌', title, message, 'reporter');
        const stepEl = document.getElementById(stepId);
        const stepNumber = stepEl.querySelector('.step-number');
        if (stepNumber) {
            stepNumber.classList.add('error');
        }
        stepEl.classList.add('error');
        this.scrollToBottom();
    }

    // ========== 报告内容格式化 ==========

    formatReportContent(content) {
        if (!content) return '';
        
        // 处理内容：先标准化换行符
        let text = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // 关键修复：在Markdown标题前强制插入换行符
        text = text.replace(/\s*(#{1,4}\s+[^#]+?)(?=\s*#{1,4}\s+|$)/g, '\n\n$1\n\n');
        
        // 清理多余的换行
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        
        // 按双换行分割成段落
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
        
        // 处理每个段落
        const formattedBlocks = paragraphs.map(para => {
            const trimmed = para.trim();
            
            // 一级标题 # 
            if (trimmed.match(/^#\s+/)) {
                return '<h1 class="report-h1">📋 ' + trimmed.replace(/^#\s+/, '') + '</h1>';
            }
            // 二级标题 ## 
            if (trimmed.match(/^##\s+/)) {
                return '<h2 class="report-h2">📌 ' + trimmed.replace(/^##\s+/, '') + '</h2>';
            }
            // 三级标题 ### 
            if (trimmed.match(/^###\s+/)) {
                return '<h3 class="report-h3">🔹 ' + trimmed.replace(/^###\s+/, '') + '</h3>';
            }
            // 四级标题 #### 
            if (trimmed.match(/^####\s+/)) {
                return '<h4 class="report-h4">🔸 ' + trimmed.replace(/^####\s+/, '') + '</h4>';
            }
            
            // 检测并处理列表项
            if (trimmed.includes('* ') || trimmed.includes('- ')) {
                const items = trimmed.split(/\s*[*\-]\s+/).filter(item => item.trim());
                if (items.length > 1 || (items.length === 1 && trimmed.match(/^[*\-]\s/))) {
                    return '<ul class="report-ul">' + 
                        items.map(item => '<li class="report-li">✅ ' + this.formatInline(item.trim()) + '</li>').join('') + 
                        '</ul>';
                }
            }
            
            // 数字列表
            if (trimmed.match(/^\d+\.\s/)) {
                const lines = trimmed.split('\n').filter(l => l.trim());
                const items = lines.filter(l => l.match(/^\d+\.\s/));
                if (items.length > 0) {
                    return '<ol class="report-ol-list">' + 
                        items.map((item, idx) => {
                            const text = item.replace(/^\d+\.\s*/, '');
                            return '<li class="report-ol"><span class="ol-number">' + (idx + 1) + '</span> ' + this.formatInline(text) + '</li>';
                        }).join('') + 
                        '</ol>';
                }
            }
            
            // 普通段落
            const sentences = trimmed.split(/(?<=[。！？.!?])\s+/).filter(s => s.trim());
            if (sentences.length > 1) {
                return '<p class="report-p">' + sentences.map(s => this.formatInline(s.trim())).join('<br>') + '</p>';
            }
            
            return '<p class="report-p">' + this.formatInline(trimmed) + '</p>';
        });
        
        return formattedBlocks.join('\n');
    }
    
    formatInline(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>');
    }

    // ========== 状态和时间管理 ==========

    updateStatus(status, text) {
        this.statusDot.className = `status-dot ${status}`;
        this.statusText.textContent = text;
    }

    startTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            this.processingTime++;
            this.updateTimerDisplay();
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        const minutes = Math.floor(this.processingTime / 60);
        const seconds = this.processingTime % 60;
        this.timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (minutes > 0) {
            return `${minutes}分${secs}秒`;
        }
        return `${secs}秒`;
    }

    scrollToBottom() {
        const rightPanel = document.querySelector('.right-panel');
        if (rightPanel) {
            rightPanel.scrollTop = rightPanel.scrollHeight;
        }
        if (this.workflowCanvas) {
            this.workflowCanvas.scrollTop = this.workflowCanvas.scrollHeight;
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
