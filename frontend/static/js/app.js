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
        this.initElements();
        this.bindEvents();
    }

    initElements() {
        // 顶部状态栏
        this.statusBadge = document.getElementById('statusBadge');
        this.statusDot = this.statusBadge.querySelector('.status-dot');
        this.statusText = this.statusBadge.querySelector('.status-text');
        this.timer = document.getElementById('timer');
        
        // 左侧任务工作台
        this.queryInput = document.getElementById('queryInput');
        this.charCount = document.getElementById('charCount');
        this.charCountContainer = this.charCount.parentElement;
        this.submitBtn = document.getElementById('submitBtn');
        
        // 右侧智能流程画布
        this.workflowCanvas = document.getElementById('workflowCanvas');
        this.emptyState = document.getElementById('emptyState');
        this.workflowNodes = document.getElementById('workflowNodes');
    }

    bindEvents() {
        this.queryInput.addEventListener('input', () => this.updateCharCount());
        this.submitBtn.addEventListener('click', () => this.handleSubmit());
    }

    updateCharCount() {
        const count = this.queryInput.value.length;
        this.charCount.textContent = count;
        
        if (count > 500) {
            this.charCountContainer.classList.add('exceeded');
        } else {
            this.charCountContainer.classList.remove('exceeded');
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
        
        // 更新状态
        this.updateStatus('working', '智能规划中...');
        this.startTimer();
        this.submitBtn.disabled = true;
        this.submitBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">处理中...</span>';
        
        // 清空画布
        this.workflowNodes.innerHTML = '';
        this.emptyState.style.display = 'none';
        
        // 添加加载节点
        this.addLoadingNode('正在启动工作流...');
        
        const callbacks = {
            onOpen: () => {
                console.log('开始处理任务');
                // 移除加载节点
                this.removeLoadingNode();
            },
            onError: (error) => {
                this.removeLoadingNode();
                this.addErrorNode('连接失败', '网络波动或服务器暂不可用');
                this.endProcessing();
            },
            start: (data) => {
                console.log('收到开始事件:', data);
                // 移除加载节点
                this.removeLoadingNode();
                this.updateStatus('working', '开始处理任务...');
            },
            planner_update: (data) => {
                this.removeLoadingNode();
                this.addPlannerNode(data);
            },
            search_result: (data) => {
                this.addSearchNode(data);
            },
            verification_feedback: (data) => {
                this.addVerificationNode(data);
            },
            retry_trigger: (data) => {
                console.log('收到重试事件:', data);
                // 不再显示重试节点，直接等待报告生成
            },
            final_report: (data) => {
                this.addReportNode(data);
                this.updateStatus('completed', '报告已生成 ✅');
                this.endProcessing();
                this.showNotification('任务处理完成', 'success');
            },
            error: (data) => {
                this.removeLoadingNode();
                this.addErrorNode('处理失败', data.message || '未知错误');
                this.endProcessing();
                this.showNotification('任务处理失败', 'error');
            },
            end: (data) => {
                console.log('收到结束事件:', data);
                // 处理结束事件
            }
        };

        this.sseClient.connect(query, callbacks);
    }

    endProcessing() {
        this.isProcessing = false;
        this.stopTimer();
        this.submitBtn.disabled = false;
        this.submitBtn.innerHTML = '<span class="btn-icon">🚀</span><span class="btn-text">生成报告</span>';
        this.sseClient.disconnect();
    }

    showNotification(message, type) {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // 添加到页面
        document.body.appendChild(notification);
        
        // 显示通知
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        // 3秒后隐藏通知
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    addLoadingNode(message) {
        const node = this.createNode('⏳ 处理中');
        const content = document.createElement('div');
        content.className = 'node-content';
        content.innerHTML = `
            <div class="loading-spinner"></div>
            <p>${message}</p>
        `;
        node.appendChild(content);
        node.id = 'loading-node';
        this.workflowNodes.appendChild(node);
        this.scrollToBottom();
    }

    removeLoadingNode() {
        const loadingNode = document.getElementById('loading-node');
        if (loadingNode) {
            loadingNode.remove();
        }
    }

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

    addPlannerNode(data) {
        const node = this.createNode('🧠 [Planner] 任务规划');
        const content = document.createElement('div');
        content.className = 'node-content';
        
        const planList = data.plan.map((step, index) => `<li>${index + 1}. ${step}</li>`).join('');
        
        content.innerHTML = `
            <p>✓ 拆解为 ${data.plan.length} 个步骤：</p>
            <ul class="plan-list">${planList}</ul>
        `;
        
        node.appendChild(content);
        this.workflowNodes.appendChild(node);
        this.scrollToBottom();
    }

    addSearchNode(data) {
        const node = this.createNode('🔍 [Executor] 信息执行');
        const content = document.createElement('div');
        content.className = 'node-content';
        
        content.innerHTML = `
            <div class="search-item">
                <div class="search-query">🌐 搜索：${data.query}</div>
                <div class="search-snippet">${data.snippet}</div>
            </div>
        `;
        
        node.appendChild(content);
        this.workflowNodes.appendChild(node);
        this.scrollToBottom();
    }

    addVerificationNode(data) {
        const node = this.createNode('✅ [Verifier] 质量校验');
        const content = document.createElement('div');
        content.className = 'node-content';
        
        const statusClass = data.is_valid ? 'valid' : 'invalid';
        const statusText = data.is_valid ? '✓ 验证通过' : '⚠️ 验证失败';
        
        content.innerHTML = `
            <div class="verification-status ${statusClass}">
                ${statusText}
            </div>
            <p>${data.reason}</p>
            ${data.is_valid ? '<div class="progress-bar"><div class="progress-fill" style="width: 100%"></div></div>' : ''}
        `;
        
        node.appendChild(content);
        
        if (!data.is_valid) {
            node.classList.add('shaking');
        }
        
        this.workflowNodes.appendChild(node);
        this.scrollToBottom();
    }

    addReportNode(data) {
        const node = this.createNode('📄 [Final Report] 生成报告');
        const content = document.createElement('div');
        content.className = 'node-content';
        
        content.innerHTML = `
            <div class="report-content">${data.content}</div>
            <div class="report-actions">
                <button class="report-action-btn copy-btn">复制</button>
                <button class="report-action-btn export-btn">导出TXT</button>
            </div>
        `;
        
        node.appendChild(content);
        this.workflowNodes.appendChild(node);
        
        // 绑定复制和导出按钮事件
        const copyBtn = content.querySelector('.copy-btn');
        const exportBtn = content.querySelector('.export-btn');
        
        copyBtn.addEventListener('click', () => this.copyReport(data.content, copyBtn));
        exportBtn.addEventListener('click', () => this.exportReport(data.content));
        
        this.scrollToBottom();
    }

    addErrorNode(title, message) {
        const node = this.createNode('❌ 错误');
        const content = document.createElement('div');
        content.className = 'node-content';
        
        content.innerHTML = `
            <p>${title}</p>
            <div class="error-message">
                <span>🔄</span>
                ${message}
            </div>
            <button class="retry-btn">重试</button>
        `;
        
        node.appendChild(content);
        this.workflowNodes.appendChild(node);
        
        // 绑定重试按钮事件
        const retryBtn = content.querySelector('.retry-btn');
        retryBtn.addEventListener('click', () => {
            const query = this.queryInput.value.trim();
            if (query) {
                this.startProcessing(query);
            }
        });
        
        this.scrollToBottom();
    }

    addRetryNode(data) {
        const node = this.createNode('🔄 重试');
        const content = document.createElement('div');
        content.className = 'node-content';
        
        content.innerHTML = `
            <p>验证失败，正在重新规划...</p>
            <div class="retry-info">
                <span>重试次数: ${data.retry_count}</span>
                <span>${data.message}</span>
            </div>
        `;
        
        node.appendChild(content);
        this.workflowNodes.appendChild(node);
        this.scrollToBottom();
    }

    createNode(title) {
        const node = document.createElement('div');
        node.className = 'workflow-node entering';
        node.id = `node-${this.currentNodeId++}`;
        
        const timestamp = new Date().toLocaleTimeString();
        
        const header = document.createElement('div');
        header.className = 'node-header';
        header.innerHTML = `
            <div class="node-title">${title}</div>
            <div class="node-timestamp">${timestamp}</div>
        `;
        
        node.appendChild(header);
        
        // 添加活跃状态
        setTimeout(() => {
            node.classList.add('active');
            // 移除其他节点的活跃状态
            const allNodes = this.workflowNodes.querySelectorAll('.workflow-node');
            allNodes.forEach(n => {
                if (n !== node) {
                    n.classList.remove('active');
                }
            });
        }, 100);
        
        return node;
    }

    copyReport(content, button) {
        navigator.clipboard.writeText(content).then(() => {
            const originalText = button.textContent;
            button.textContent = '✓ 已复制';
            button.classList.add('copied');
            
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('复制失败:', err);
            alert('复制失败，请手动复制');
        });
    }

    exportReport(content) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${new Date().getTime()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    scrollToBottom() {
        // 滚动到右侧面板的底部
        const rightPanel = document.querySelector('.right-panel');
        if (rightPanel) {
            rightPanel.scrollTop = rightPanel.scrollHeight;
        }
        // 同时滚动到工作流画布的底部
        if (this.workflowCanvas) {
            this.workflowCanvas.scrollTop = this.workflowCanvas.scrollHeight;
        }
    }


}

document.addEventListener('DOMContentLoaded', () => {
    new App();
});
