/**
 * FlowAgent - 多轮对话增强版前端应用
 * 支持：追问、修改、补充、会话管理
 */

class SSEClient {
    constructor() {
        this.eventSource = null;
        this.isConnected = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 2000;
        this.isAborted = false;  // 新增：中断标志
        this.isCompleted = false; // 新增：任务完成标志
    }

    abort() {
        // 中断当前连接
        this.isAborted = true;
        this.isCompleted = true; // 标记为完成，防止重连
        this.retryCount = this.maxRetries; // 重置重试计数，防止重连
        this.errorHandled = true; // 标记错误已处理
        this.disconnect();
        console.log('SSE连接已中断');
    }

    connect(query, callbacks, options = {}) {
        // 如果已有连接，先完全断开
        if (this.eventSource) {
            this.abort();
        }
        
        // 重置标志
        this.isAborted = false;
        this.isCompleted = false;
        this.retryCount = 0;
        this.errorHandled = false;

        const { conversationId, operationType, selectedText, position } = options;
        
        // 构建URL参数
        const params = new URLSearchParams({ query });
        if (conversationId) params.append('conversation_id', conversationId);
        if (operationType) params.append('operation_type', operationType);
        if (selectedText) params.append('selected_text', selectedText);
        if (position) params.append('position', position);
        
        const url = `http://localhost:8000/api/stream?${params.toString()}`;
        console.log('连接URL:', url);
        
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
            
            // 如果是主动中断，不触发错误回调和重连
            if (this.isAborted) {
                console.log('连接被主动中断，不进行重连');
                return;
            }
            
            // 如果任务已完成，不重连（服务器已返回错误或结束）
            if (this.isCompleted) {
                console.log('任务已完成，不进行重连');
                this.disconnect();
                return;
            }

            // 达到最大重试次数，不再重连
            if (this.retryCount >= this.maxRetries) {
                console.log('达到最大重试次数，不再重连');
                // 触发错误回调
                if (callbacks.onError) callbacks.onError(error);
                this.disconnect();
                return;
            }

            // 只有在连接意外断开且未达到最大重试次数时才重连
            this.retryCount++;
            console.log(`尝试重连 (${this.retryCount}/${this.maxRetries})...`);
            setTimeout(() => {
                this.connect(query, callbacks, options);
            }, this.retryDelay);
        };

        this.setupEventListeners(callbacks);
    }

    setupEventListeners(callbacks) {
        if (!this.eventSource) {
            console.error('setupEventListeners: eventSource 为 null');
            return;
        }
        
        // 事件类型到回调名称的映射
        const eventTypeMap = {
            'start': 'start',
            'planner_update': 'plannerUpdate',
            'search_result': 'searchResult',
            'verification_feedback': 'verificationFeedback',
            'retry_trigger': 'retryTrigger',
            'final_report': 'finalReport',
            'answer': 'answer',
            'error': 'error',
            'end': 'end'
        };
        
        console.log('setupEventListeners: 开始设置事件监听');
        
        Object.keys(eventTypeMap).forEach(eventType => {
            const callbackName = eventTypeMap[eventType];
            console.log(`setupEventListeners: 设置 ${eventType} -> ${callbackName}`);
            this.eventSource.addEventListener(eventType, (event) => {
                try {
                    const data = JSON.parse(event.data);
                    console.log(`收到事件: ${eventType}, 回调: ${callbackName}`, data);
                    if (callbacks[callbackName]) {
                        callbacks[callbackName](data);
                    } else {
                        console.warn(`回调 ${callbackName} 不存在`);
                    }
                } catch (error) {
                    console.error(`解析${eventType}事件数据失败:`, error);
                }
            });
        });
        
        console.log('setupEventListeners: 事件监听设置完成');
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

class ConversationManager {
    constructor() {
        this.storageKey = 'flowagent_conversations';
        this.currentConversationId = null;
        this.conversations = this.loadFromStorage();
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem(this.storageKey);
            return data ? JSON.parse(data) : {};
        } catch (e) {
            console.error('加载会话失败:', e);
            return {};
        }
    }

    saveToStorage() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.conversations));
        } catch (e) {
            console.error('保存会话失败:', e);
        }
    }

    createConversation(title) {
        const id = 'conv_' + Date.now().toString(36);
        const conversation = {
            id,
            title: title.slice(0, 30) + (title.length > 30 ? '...' : ''),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            currentReport: '',
            reportVersions: []
        };
        this.conversations[id] = conversation;
        this.saveToStorage();
        return conversation;
    }

    getConversation(id) {
        return this.conversations[id];
    }

    updateConversation(id, updates) {
        if (this.conversations[id]) {
            this.conversations[id] = { ...this.conversations[id], ...updates, updatedAt: new Date().toISOString() };
            this.saveToStorage();
        }
    }

    addMessage(conversationId, message) {
        const conversation = this.conversations[conversationId];
        if (conversation) {
            conversation.messages.push({
                ...message,
                id: 'msg_' + Date.now().toString(36),
                timestamp: new Date().toISOString()
            });
            // 限制消息数量（最多保留20条）
            if (conversation.messages.length > 20) {
                conversation.messages = conversation.messages.slice(-20);
            }
            this.saveToStorage();
        }
    }

    updateReport(conversationId, report, operationType = 'generate') {
        const conversation = this.conversations[conversationId];
        if (conversation) {
            // 保存旧版本
            if (conversation.currentReport) {
                conversation.reportVersions.push({
                    content: conversation.currentReport,
                    timestamp: new Date().toISOString(),
                    operation: operationType
                });
                // 限制版本数量
                if (conversation.reportVersions.length > 5) {
                    conversation.reportVersions = conversation.reportVersions.slice(-5);
                }
            }
            conversation.currentReport = report;
            this.saveToStorage();
        }
    }

    deleteConversation(id) {
        delete this.conversations[id];
        this.saveToStorage();
    }

    listConversations() {
        return Object.values(this.conversations)
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }

    setCurrentConversation(id) {
        this.currentConversationId = id;
    }

    getCurrentConversation() {
        return this.currentConversationId ? this.conversations[this.currentConversationId] : null;
    }
}

class App {
    constructor() {
        this.sseClient = new SSEClient();
        this.conversationManager = new ConversationManager();
        this.isProcessing = false;
        this.timerInterval = null;
        this.processingTime = 0;
        this.currentNodeId = 0;
        this.currentStepId = 0;
        this.workflowData = {
            planner: null,
            searches: [],
            verifications: [],
            report: null
        };
        
        // 多轮对话状态
        this.chatMode = false; // 是否进入对话模式
        this.selectedText = ''; // 当前选中的文本
        this.operationType = 'generate'; // 当前操作类型
        
        this.initElements();
        this.createHistoryModal();
        this.createChatModal();
        this.bindEvents();
        this.loadHistory();
        this.renderConversationList();
        this.restoreLastConversation();
    }

    restoreLastConversation() {
        // 自动恢复最近的会话
        const conversations = this.conversationManager.listConversations();
        if (conversations.length > 0) {
            const lastConversation = conversations[0];
            this.conversationManager.setCurrentConversation(lastConversation.id);
            console.log('自动恢复最近会话:', lastConversation.id);
        }
    }

    initElements() {
        // 顶部状态栏
        this.statusBadge = document.getElementById('statusBadge');
        this.statusDot = document.getElementById('statusDot');
        this.statusIconWrapper = document.getElementById('statusIconWrapper');
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
        
        // 停止按钮（初始隐藏）
        this.stopBtn = document.getElementById('stopBtn');

        // 右侧智能流程画布
        this.workflowCanvas = document.getElementById('workflowCanvas');
        this.emptyState = document.getElementById('emptyState');
        this.workflowNodes = document.getElementById('workflowNodes');
        
        // 对话相关元素
        this.conversationList = document.getElementById('conversationList');
        this.chatContainer = document.getElementById('chatContainer');
        this.chatInput = document.getElementById('chatInput');
        this.chatSendBtn = document.getElementById('chatSendBtn');
    }

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

    createChatModal() {
        // 创建对话操作浮动菜单
        this.chatActionsModal = document.createElement('div');
        this.chatActionsModal.className = 'chat-actions-modal';
        this.chatActionsModal.innerHTML = `
            <div class="chat-actions-overlay"></div>
            <div class="chat-actions-content">
                <div class="chat-actions-header">
                    <h3>对选中内容进行操作</h3>
                    <button class="chat-actions-close">&times;</button>
                </div>
                <div class="chat-actions-body">
                    <div class="selected-text-preview"></div>
                    <div class="chat-actions-buttons">
                        <button class="chat-action-btn" data-action="follow_up">
                            <span class="chat-action-icon">❓</span>
                            <span class="chat-action-text">追问</span>
                        </button>
                        <button class="chat-action-btn" data-action="modify">
                            <span class="chat-action-icon">✏️</span>
                            <span class="chat-action-text">修改</span>
                        </button>
                        <button class="chat-action-btn" data-action="supplement">
                            <span class="chat-action-icon">➕</span>
                            <span class="chat-action-text">补充</span>
                        </button>
                    </div>
                    <div class="chat-action-input-container" style="display: none;">
                        <textarea class="chat-action-input" placeholder="请输入您的要求..."></textarea>
                        <button class="chat-action-submit">发送</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.chatActionsModal);
        
        // 绑定事件
        this.chatActionsModal.querySelector('.chat-actions-close').addEventListener('click', () => {
            this.closeChatActionsModal();
        });
        this.chatActionsModal.querySelector('.chat-actions-overlay').addEventListener('click', () => {
            this.closeChatActionsModal();
        });
        
        // 操作按钮事件
        this.chatActionsModal.querySelectorAll('.chat-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.handleChatAction(action);
            });
        });
        
        // 提交按钮事件
        this.chatActionsModal.querySelector('.chat-action-submit').addEventListener('click', () => {
            this.submitChatAction();
        });
    }

    bindEvents() {
        this.queryInput.addEventListener('input', () => this.updateCharCount());
        this.submitBtn.addEventListener('click', () => this.handleSubmit());
        
        // 历史记录按钮事件
        this.historyBtn.addEventListener('click', () => this.openHistoryModal());
        
        // 停止按钮事件
        if (this.stopBtn) {
            this.stopBtn.addEventListener('click', () => this.stopTask());
        }
        
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
                this.closeChatActionsModal();
            }
        });
        
        // 预置问题点击事件
        this.bindPresetQuestions();
        
        // 文本选中事件（用于显示操作菜单）
        this.bindTextSelection();
        
        // 建议提示项点击事件
        this.bindSuggestionItems();
    }
    
    bindSuggestionItems() {
        const suggestionItems = document.querySelectorAll('.suggestion-item');
        suggestionItems.forEach(item => {
            item.addEventListener('click', () => {
                const suggestion = item.getAttribute('data-suggestion');
                const currentValue = this.queryInput.value;
                // 在光标位置插入建议
                const cursorPosition = this.queryInput.selectionStart;
                const newValue = currentValue.slice(0, cursorPosition) + 
                                (currentValue.length > 0 ? '，' : '') + 
                                suggestion + 
                                currentValue.slice(cursorPosition);
                this.queryInput.value = newValue;
                this.updateCharCount();
                this.queryInput.focus();
            });
        });
    }

    bindTextSelection() {
        // 监听报告内容的文本选中
        document.addEventListener('mouseup', (e) => {
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            
            // 检查是否选中了报告内容
            const reportContent = e.target.closest('.report-content, .step-details');
            if (selectedText && selectedText.length > 10 && reportContent) {
                this.selectedText = selectedText;
                this.showChatActionsModal(selectedText);
            }
        });
    }

    showChatActionsModal(selectedText) {
        const preview = this.chatActionsModal.querySelector('.selected-text-preview');
        preview.textContent = selectedText.slice(0, 100) + (selectedText.length > 100 ? '...' : '');
        
        this.chatActionsModal.classList.add('show');
        
        // 重置输入区域
        this.chatActionsModal.querySelector('.chat-action-input-container').style.display = 'none';
        this.chatActionsModal.querySelector('.chat-actions-buttons').style.display = 'flex';
    }

    closeChatActionsModal() {
        this.chatActionsModal.classList.remove('show');
        this.selectedText = '';
        // 注意：operationType 不在此处重置，由调用方控制
    }

    handleChatAction(action) {
        this.operationType = action;
        
        // 显示输入区域
        this.chatActionsModal.querySelector('.chat-actions-buttons').style.display = 'none';
        this.chatActionsModal.querySelector('.chat-action-input-container').style.display = 'block';
        
        const input = this.chatActionsModal.querySelector('.chat-action-input');
        const placeholders = {
            follow_up: '请输入您想追问的问题...',
            modify: '请输入修改要求，例如：增加更多数据支撑...',
            supplement: '请输入补充要求，例如：在结论部分增加风险提示...'
        };
        input.placeholder = placeholders[action] || '请输入您的要求...';
        input.focus();
    }

    submitChatAction() {
        const input = this.chatActionsModal.querySelector('.chat-action-input');
        const query = input.value.trim();
        
        if (!query) return;
        
        const conversation = this.conversationManager.getCurrentConversation();
        if (!conversation) {
            alert('请先创建一个任务');
            return;
        }
        
        // 保存当前选中的文本（因为closeChatActionsModal会清空它）
        const currentSelectedText = this.selectedText;
        
        // 关闭模态框
        this.closeChatActionsModal();
        
        // 清空输入
        input.value = '';
        
        // 恢复选中的文本（追问和修改都需要）
        if (currentSelectedText) {
            this.selectedText = currentSelectedText;
        }
        
        // 执行对话操作
        this.executeChatOperation(query, conversation.id);
        
        // 注意：selectedText会在executeChatOperation内部使用，不需要在这里清空
        // 清空操作在executeChatOperation的end回调中进行
    }

    executeChatOperation(query, conversationId) {
        this.isProcessing = true;
        this.processingTime = 0;
        this.updateSubmitButtonState();
        this.startTimer();
        
        // 隐藏空状态
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }
        
        // 添加用户消息到UI
        this.addChatMessage('user', query, this.operationType);

        // 添加生成中占位消息
        const loadingMessageId = this.addLoadingMessage();

        const callbacks = {
            onOpen: () => {
                console.log('对话连接已建立');
                this.updateStatus('processing', '处理中...');
            },
            start: (data) => {
                console.log('开始处理:', data);
            },
            answer: (data) => {
                // 移除生成中占位消息
                this.removeLoadingMessage(loadingMessageId);
                // 追问回答
                this.addChatMessage('assistant', data.content, 'answer');
                this.conversationManager.addMessage(conversationId, {
                    role: 'assistant',
                    content: data.content,
                    type: 'answer'
                });
            },
            finalReport: (data) => {
                // 移除生成中占位消息
                this.removeLoadingMessage(loadingMessageId);
                // 修改或补充后的报告
                this.workflowData.report = data.content;

                // 清空工作流画布，只显示新报告（保留对话历史）
                this.clearWorkflow(true);

                // 添加新报告步骤
                this.addReportStep(data);

                // 重新显示对话输入框
                this.showChatInput();

                this.conversationManager.updateReport(conversationId, data.content, this.operationType);
                this.conversationManager.addMessage(conversationId, {
                    role: 'assistant',
                    content: data.content,
                    type: 'report',
                    metadata: { operationType: this.operationType }
                });
            },
            error: (data) => {
                console.error('错误:', data);
                // 如果已经处理过错误，不再重复显示
                if (this.errorHandled) {
                    console.log('错误已处理，忽略重复错误');
                    return;
                }
                this.errorHandled = true;

                // 移除生成中占位消息
                this.removeLoadingMessage(loadingMessageId);

                this.addChatMessage('assistant', `错误：${data.message}`, 'error');

                // 立即中断连接，防止重连
                this.sseClient.abort();

                // 重置状态
                this.isProcessing = false;
                this.sseClient.isCompleted = true;
                this.updateSubmitButtonState();
                this.stopTimer();
                this.updateStatus('error', '处理失败');

                // 重置操作类型
                this.operationType = 'generate';
            },
            end: (data) => {
                console.log('处理完成');
                this.isProcessing = false;
                this.sseClient.isCompleted = true; // 标记任务完成，防止重连
                this.updateSubmitButtonState();
                this.stopTimer();
                this.updateStatus('completed', '已完成');
                
                // 清空选中的文本和操作类型
                this.selectedText = '';
                this.operationType = 'generate';
                
                // 保存到历史记录
                this.saveToHistory();
            }
        };
        
        // 连接SSE
        this.sseClient.connect(query, callbacks, {
            conversationId,
            operationType: this.operationType,
            selectedText: this.selectedText,
            position: this.operationType === 'supplement' ? '指定位置' : null
        });
    }

    addChatMessage(role, content, type) {
        // 如果没有聊天容器，创建一个
        if (!this.chatContainer) {
            this.createChatContainer();
        }
        
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${role} ${type}`;
        
        const typeLabels = {
            follow_up: '追问',
            modify: '修改',
            supplement: '补充',
            answer: '回答',
            report: '报告',
            error: '错误'
        };
        
        messageEl.innerHTML = `
            <div class="chat-message-header">
                <span class="chat-message-role">${role === 'user' ? '👤 用户' : '🤖 助手'}</span>
                ${typeLabels[type] ? `<span class="chat-message-type">${typeLabels[type]}</span>` : ''}
            </div>
            <div class="chat-message-content">${this.formatMessageContent(content)}</div>
        `;
        
        this.chatContainer.appendChild(messageEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    addLoadingMessage() {
        // 如果没有聊天容器，创建一个
        if (!this.chatContainer) {
            this.createChatContainer();
        }

        const messageId = 'loading-' + Date.now();
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message assistant loading';
        messageEl.id = messageId;

        messageEl.innerHTML = `
            <div class="chat-message-header">
                <span class="chat-message-role">🤖 助手</span>
                <span class="chat-message-type">生成中</span>
            </div>
            <div class="chat-message-content">
                <div class="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;

        this.chatContainer.appendChild(messageEl);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

        return messageId;
    }

    removeLoadingMessage(messageId) {
        if (!messageId) return;
        const loadingEl = document.getElementById(messageId);
        if (loadingEl && loadingEl.parentNode) {
            loadingEl.parentNode.removeChild(loadingEl);
        }
    }

    createChatContainer() {
        this.chatContainer = document.createElement('div');
        this.chatContainer.className = 'chat-container';
        this.chatContainer.id = 'chatContainer';
        
        // 插入到 workflowNodes 中，在输入框之前
        if (this.workflowNodes) {
            if (this.chatInputContainer && this.chatInputContainer.parentNode === this.workflowNodes) {
                // 如果输入框已存在，插入到输入框之前
                this.workflowNodes.insertBefore(this.chatContainer, this.chatInputContainer);
            } else {
                // 否则追加到末尾
                this.workflowNodes.appendChild(this.chatContainer);
            }
        }
    }

    showChatInput() {
        // 创建对话输入框容器
        if (!this.chatInputContainer) {
            this.chatInputContainer = document.createElement('div');
            this.chatInputContainer.className = 'chat-input-container';
            this.chatInputContainer.id = 'chatInputContainer';
            
            // 创建输入框
            this.chatInput = document.createElement('textarea');
            this.chatInput.className = 'chat-input';
            this.chatInput.id = 'chatInput';
            this.chatInput.placeholder = '对报告进行追问、修改或补充...';
            this.chatInput.rows = 3;
            
            // 创建操作按钮容器
            const btnContainer = document.createElement('div');
            btnContainer.className = 'chat-btn-container';
            
            // 追问按钮
            const followUpBtn = document.createElement('button');
            followUpBtn.className = 'chat-input-btn follow-up';
            followUpBtn.textContent = '💬 追问';
            followUpBtn.onclick = () => this.handleChatInputAction('follow_up');
            
            // 修改按钮
            const modifyBtn = document.createElement('button');
            modifyBtn.className = 'chat-input-btn modify';
            modifyBtn.textContent = '✏️ 修改';
            modifyBtn.onclick = () => {
                // 修改操作需要先选中文本
                alert('请先选中报告中的文本段落，再点击修改');
                // 滚动到报告区域
                const reportContent = document.querySelector('.report-content, .step-details');
                if (reportContent) {
                    reportContent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            };
            
            // 补充按钮
            const supplementBtn = document.createElement('button');
            supplementBtn.className = 'chat-input-btn supplement';
            supplementBtn.textContent = '➕ 补充';
            supplementBtn.onclick = () => this.handleChatInputAction('supplement');
            
            btnContainer.appendChild(followUpBtn);
            btnContainer.appendChild(modifyBtn);
            btnContainer.appendChild(supplementBtn);
            
            this.chatInputContainer.appendChild(this.chatInput);
            this.chatInputContainer.appendChild(btnContainer);
            
            // 插入到工作流画布中
            if (this.workflowNodes) {
                this.workflowNodes.appendChild(this.chatInputContainer);
            }
        }
        
        // 显示输入框
        this.chatInputContainer.style.display = 'block';
        
        // 清空输入框内容
        if (this.chatInput) {
            this.chatInput.value = '';
        }
        
        // 滚动到底部
        this.scrollToBottom();
    }

    handleChatInputAction(actionType) {
        const query = this.chatInput.value.trim();
        if (!query) {
            alert('请输入内容');
            return;
        }
        
        this.operationType = actionType;
        
        // 根据操作类型处理
        if (actionType === 'modify') {
            // 修改操作需要选中文本
            this.handleModifyOperation(query);
        } else if (actionType === 'supplement') {
            // 补充操作
            this.handleSupplementOperation(query);
        } else {
            // 追问操作
            this.handleFollowUpOperation(query);
        }
        
        // 清空输入框
        this.chatInput.value = '';
    }

    formatMessageContent(content) {
        // 简单的文本格式化
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    // 对话操作方法
    handleFollowUpOperation(query) {
        console.log('处理追问:', query);
        const conversationId = this.conversationManager.currentConversationId;
        if (!conversationId) {
            alert('请先创建一个会话');
            return;
        }
        this.executeChatOperation(query, conversationId);
    }

    handleModifyOperation(query) {
        console.log('处理修改:', query);
        // 修改操作需要选中文本
        if (!this.selectedText) {
            alert('请先选中要修改的文本段落');
            return;
        }
        const conversationId = this.conversationManager.currentConversationId;
        if (!conversationId) {
            alert('请先创建一个会话');
            return;
        }
        this.executeChatOperation(query, conversationId);
    }

    handleSupplementOperation(query) {
        console.log('处理补充:', query);
        const conversationId = this.conversationManager.currentConversationId;
        if (!conversationId) {
            alert('请先创建一个会话');
            return;
        }
        this.executeChatOperation(query, conversationId);
    }

    // 其余方法保持不变（从原app.js复制）
    bindPresetQuestions() {
        const presetItems = document.querySelectorAll('.preset-item');
        presetItems.forEach(item => {
            item.addEventListener('click', () => {
                const query = item.dataset.query;
                if (query) {
                    this.queryInput.value = query;
                    this.updateCharCount();
                    this.queryInput.focus();
                    this.queryInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
            
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

    updateCharCount() {
        const count = this.queryInput.value.length;
        this.charCount.textContent = `${count}/500`;
        
        if (count > 450) {
            this.charCount.classList.add('warning');
            this.charCountBar.classList.add('warning');
        } else {
            this.charCount.classList.remove('warning');
            this.charCountBar.classList.remove('warning');
        }
        
        const percentage = Math.min((count / 500) * 100, 100);
        this.charCountBar.style.width = `${percentage}%`;
        
        // 显示/隐藏建议提示
        this.updateSuggestionBox(count);
    }
    
    updateSuggestionBox(count) {
        const suggestionBox = document.getElementById('suggestionBox');
        if (!suggestionBox) return;
        
        // 当输入字符在10-100之间时显示建议
        if (count > 10 && count < 100) {
            suggestionBox.style.display = 'block';
        } else {
            suggestionBox.style.display = 'none';
        }
    }

    async handleSubmit() {
        const query = this.queryInput.value.trim();
        
        if (!query) {
            this.queryInput.focus();
            return;
        }
        
        if (this.isProcessing) {
            return;
        }
        
        this.isProcessing = true;
        this.processingTime = 0;
        this.updateSubmitButtonState();
        this.startTimer();
        
        // 创建新会话
        const conversation = this.conversationManager.createConversation(query);
        this.conversationManager.setCurrentConversation(conversation.id);
        this.renderConversationList();
        
        // 清空工作流画布
        console.log('handleSubmit: 调用 clearWorkflow');
        this.clearWorkflow();
        console.log('handleSubmit: clearWorkflow 完成, currentStepId=', this.currentStepId);
        
        // 隐藏空状态，显示工作流节点
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }
        if (this.workflowNodes) {
            this.workflowNodes.style.display = 'block';
        }
        
        // 清空输入框
        this.queryInput.value = '';
        this.updateCharCount();
        
        // 重置操作类型
        this.operationType = 'generate';
        
        const callbacks = {
            onOpen: () => {
                console.log('SSE连接已建立');
                this.updateStatus('processing', '处理中...');
            },
            start: (data) => {
                console.log('开始处理:', data);
                // 使用后端返回的 conversation_id 更新前端会话
                if (data && data.conversation_id) {
                    const backendConvId = data.conversation_id;
                    const currentConv = this.conversationManager.getCurrentConversation();
                    if (currentConv && currentConv.id !== backendConvId) {
                        console.log(`更新会话ID: ${currentConv.id} -> ${backendConvId}`);
                        // 删除前端创建的会话，使用后端返回的ID
                        delete this.conversationManager.conversations[currentConv.id];
                        currentConv.id = backendConvId;
                        this.conversationManager.conversations[backendConvId] = currentConv;
                        this.conversationManager.setCurrentConversation(backendConvId);
                        this.conversationManager.saveToStorage();
                        this.renderConversationList();
                    }
                }
            },
            plannerUpdate: (data) => {
                console.log('plannerUpdate 回调被调用:', data);
                this.workflowData.planner = data;
                if (data && data.plan && Array.isArray(data.plan)) {
                    this.addPlannerStep(data);
                    // 添加阶段切换过渡状态
                    this.addTransitionStep('planner', 'executor');
                } else {
                    console.error('plannerUpdate 数据格式错误:', data);
                }
            },
            searchResult: (data) => {
                console.log('searchResult 回调被调用:', data);
                this.workflowData.searches.push(data);
                if (data && data.query) {
                    this.addSearchStep(data);
                } else {
                    console.error('searchResult 数据格式错误:', data);
                }
            },
            verificationFeedback: (data) => {
                this.workflowData.verifications.push(data);
                this.addVerificationStep(data);
                // 添加阶段切换过渡状态
                this.addTransitionStep('verifier', 'reporter');
            },
            retryTrigger: (data) => {
                this.addRetryStep(data);
            },
            finalReport: (data) => {
                console.log('finalReport 回调被调用:', data);
                if (data && data.content) {
                    this.workflowData.report = data.content;
                    
                    // 清空工作流画布，只显示报告
                    this.clearWorkflow();
                    
                    // 添加报告步骤
                    this.addReportStep(data);
                    
                    // 显示对话输入框
                    this.showChatInput();
                    
                    // 保存到会话 - 使用当前会话ID
                    const currentId = this.conversationManager.currentConversationId;
                    if (currentId) {
                        this.conversationManager.updateReport(currentId, data.content, 'generate');
                        this.conversationManager.addMessage(currentId, {
                            role: 'assistant',
                            content: data.content,
                            type: 'report'
                        });
                    }
                } else {
                    console.error('finalReport 数据格式错误:', data);
                }
            },
            error: (data) => {
                console.error('错误:', data);
                // 如果连接已被中断，不显示错误消息
                if (this.sseClient.isAborted) {
                    console.log('连接已中断，忽略错误消息');
                    return;
                }
                this.addErrorStep(data);
                this.updateStatus('error', '处理失败');
            },
            end: (data) => {
                console.log('处理完成');
                this.isProcessing = false;
                this.sseClient.isCompleted = true; // 标记任务完成，防止重连
                this.updateSubmitButtonState();
                this.stopTimer();
                this.updateStatus('completed', '已完成');
                
                // 保存到历史记录
                this.saveToHistory();
            }
        };
        
        // 连接SSE - 首次生成不传 conversationId
        console.log('handleSubmit: 准备连接SSE');
        if (!this.sseClient) {
            console.error('handleSubmit: sseClient 为 null');
            return;
        }
        this.sseClient.connect(query, callbacks, {
            operationType: 'generate'
        });
    }

    clearWorkflow(keepChatHistory = false) {
        this.currentNodeId = 0;
        this.currentStepId = 0;
        this.workflowData = {
            planner: null,
            searches: [],
            verifications: [],
            report: null
        };
        
        // 清空工作流节点，但保留对话输入框
        if (this.workflowNodes) {
            // 保存对话相关元素
            const chatInputContainer = this.chatInputContainer;
            const chatContainer = this.chatContainer;
            
            // 清空工作流节点
            this.workflowNodes.innerHTML = '';
            
            // 如果对话消息容器存在且需要保留历史，重新添加回去
            if (chatContainer && keepChatHistory) {
                this.workflowNodes.appendChild(chatContainer);
            } else if (this.chatContainer) {
                // 否则清空对话消息
                this.chatContainer.innerHTML = '';
            }
            
            // 如果对话输入框存在，重新添加回去（保持显示状态）
            if (chatInputContainer) {
                this.workflowNodes.appendChild(chatInputContainer);
                // 不隐藏输入框，保持显示状态
            }
        }
        
        // 清空聊天容器（如果不需要保留历史）
        if (!keepChatHistory && this.chatContainer) {
            this.chatContainer.innerHTML = '';
        }
        
        console.log('clearWorkflow: 已清空工作流，currentStepId 重置为 0，保留历史:', keepChatHistory);
    }

    resetWorkflowDisplay() {
        // 重置显示状态
        if (this.emptyState) {
            this.emptyState.style.display = 'flex';
        }
        if (this.workflowNodes) {
            this.workflowNodes.style.display = 'none';
        }
    }

    updateSubmitButtonState() {
        if (this.isProcessing) {
            this.submitBtn.style.display = 'none';
            if (this.stopBtn) {
                this.stopBtn.style.display = 'flex';
            }
        } else {
            this.submitBtn.style.display = 'flex';
            if (this.stopBtn) {
                this.stopBtn.style.display = 'none';
            }
        }
    }

    stopTask() {
        // 中断当前任务
        if (this.sseClient) {
            this.sseClient.abort();
        }
        
        // 重置状态
        this.isProcessing = false;
        this.updateSubmitButtonState();
        this.stopTimer();
        this.updateStatus('idle', '已停止');
        
        // 清空选中的文本和操作类型
        this.selectedText = '';
        this.operationType = 'generate';
        
        // 添加停止提示
        this.addStopStep();
        
        console.log('任务已手动停止');
    }

    addStopStep() {
        const stepId = this.addWorkflowStep(
            'stop', 
            '🛑', 
            '任务已停止', 
            '用户手动中断了任务执行',
            'reporter'
        );
        
        const stepEl = document.getElementById(stepId);
        if (stepEl) {
            stepEl.classList.add('warning');
            
            const stepNumber = stepEl.querySelector('.step-number');
            if (stepNumber) {
                stepNumber.classList.add('error');
            }
        }
        
        this.scrollToBottom();
    }

    updateStatus(status, text) {
        const statusMap = {
            'processing': 'working',
            'completed': 'completed',
            'error': 'error',
            'idle': 'idle'
        };
        
        const statusClass = statusMap[status] || 'idle';
        
        // 更新旧版状态点（兼容）
        if (this.statusDot) {
            this.statusDot.className = `status-dot ${statusClass}`;
        }
        
        // 更新新版状态图标包装器
        if (this.statusIconWrapper) {
            this.statusIconWrapper.className = `status-icon-wrapper ${statusClass}`;
        }
        
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

    // 工作流步骤添加方法
    addWorkflowStep(type, icon, title, content, nodeType) {
        this.currentStepId++;
        const stepId = `step-${this.currentStepId}`;
        console.log(`addWorkflowStep: 创建步骤 ${this.currentStepId}, type=${type}`);
        
        const stepEl = document.createElement('div');
        stepEl.className = 'workflow-step';
        stepEl.id = stepId;
        
        stepEl.innerHTML = `
            <div class="step-header">
                <div class="step-number ${nodeType}">${this.currentStepId}</div>
                <div class="step-icon">${icon}</div>
                <div class="step-info">
                    <div class="step-title">${title}</div>
                    <div class="step-content">${content}</div>
                </div>
                <div class="step-status">
                    <span class="status-icon">⏳</span>
                </div>
            </div>
        `;
        
        if (this.workflowNodes) {
            this.workflowNodes.appendChild(stepEl);
        }
        
        this.scrollToBottom();
        return stepId;
    }

    addPlannerStep(data) {
        console.log('addPlannerStep 被调用:', data);
        const stepId = this.addWorkflowStep(
            'planner', 
            '📋', 
            '任务规划', 
            `已生成 ${data.plan.length} 个执行步骤`,
            'planner'
        );
        
        const stepEl = document.getElementById(stepId);
        if (!stepEl) {
            console.error('addPlannerStep: stepEl 为 null');
            return;
        }
        
        // 创建详情容器
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'step-details collapsed';
        detailsDiv.id = `${stepId}-details`;
        
        const planList = document.createElement('ul');
        planList.className = 'plan-list';
        
        data.plan.forEach((item, idx) => {
            const li = document.createElement('li');
            // 高亮关键词
            li.innerHTML = `${idx + 1}. ${this.highlightKeywords(item)}`;
            planList.appendChild(li);
        });
        
        detailsDiv.appendChild(planList);
        
        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'step-toggle';
        toggleBtn.innerHTML = '<span>查看详情</span><span class="step-toggle-icon">▼</span>';
        toggleBtn.onclick = function() {
            this.classList.toggle('expanded');
            detailsDiv.classList.toggle('collapsed');
        };
        
        stepEl.appendChild(detailsDiv);
        stepEl.appendChild(toggleBtn);
        
        this.scrollToBottom();
    }

    addSearchStep(data) {
        console.log('addSearchStep 被调用:', data);
        const stepId = this.addWorkflowStep(
            'search', 
            '🔍', 
            '信息检索', 
            `搜索：${data.query.substring(0, 50)}${data.query.length > 50 ? '...' : ''}`,
            'executor'
        );
        
        const stepEl = document.getElementById(stepId);
        if (!stepEl) {
            console.error('addSearchStep: stepEl 为 null');
            return;
        }
        
        // 创建详情容器
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'step-details collapsed';
        detailsDiv.id = `${stepId}-details`;
        
        const searchResultsDiv = document.createElement('div');
        searchResultsDiv.className = 'search-results';
        
        const searchItemDiv = document.createElement('div');
        searchItemDiv.className = 'search-item';
        
        const searchQueryDiv = document.createElement('div');
        searchQueryDiv.className = 'search-query';
        searchQueryDiv.textContent = data.query;
        
        const searchSnippetDiv = document.createElement('div');
        searchSnippetDiv.className = 'search-snippet';
        searchSnippetDiv.textContent = data.snippet;
        
        searchItemDiv.appendChild(searchQueryDiv);
        searchItemDiv.appendChild(searchSnippetDiv);
        searchResultsDiv.appendChild(searchItemDiv);
        detailsDiv.appendChild(searchResultsDiv);
        
        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'step-toggle';
        toggleBtn.innerHTML = '<span>查看结果</span><span class="step-toggle-icon">▼</span>';
        toggleBtn.onclick = function() {
            this.classList.toggle('expanded');
            detailsDiv.classList.toggle('collapsed');
        };
        
        stepEl.appendChild(detailsDiv);
        stepEl.appendChild(toggleBtn);
        
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
        if (stepEl) {
            stepEl.classList.add(isValid ? 'completed' : 'warning');
            
            const stepNumber = stepEl.querySelector('.step-number');
            if (stepNumber) {
                stepNumber.classList.add(isValid ? 'completed' : 'error');
            }
        }
        
        this.scrollToBottom();
    }

    addReportStep(data) {
        console.log('addReportStep 被调用:', data);
        const stepId = this.addWorkflowStep(
            'report', 
            '📄', 
            '报告生成完成', 
            '结构化报告已生成，点击下方按钮查看或导出',
            'reporter'
        );
        
        const stepEl = document.getElementById(stepId);
        if (!stepEl) {
            console.error('addReportStep: stepEl 为 null');
            return;
        }
        
        const stepNumber = stepEl.querySelector('.step-number');
        if (stepNumber) {
            stepNumber.classList.add('completed');
        }
        
        const formattedContent = this.formatReportContent(data.content);
        
        // 创建报告概览
        const overviewDiv = this.createReportOverview(data.content);
        
        // 创建报告内容容器
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'step-details collapsed';
        detailsDiv.id = `${stepId}-details`;
        
        const reportContentDiv = document.createElement('div');
        reportContentDiv.className = 'report-content';
        reportContentDiv.innerHTML = formattedContent;
        
        const reportActionsDiv = document.createElement('div');
        reportActionsDiv.className = 'report-actions';
        
        // 保存报告内容供导出使用
        this.currentReportContent = data.content;
        this.currentReportTitle = data.title || '报告';
        
        // 复制按钮
        const copyBtn = document.createElement('button');
        copyBtn.className = 'report-action-btn';
        copyBtn.textContent = '📋 复制全文';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(data.content).then(() => alert('已复制到剪贴板'));
        };
        
        // 导出 TXT 按钮
        const exportTxtBtn = document.createElement('button');
        exportTxtBtn.className = 'report-action-btn export-btn';
        exportTxtBtn.textContent = '� 导出TXT';
        exportTxtBtn.onclick = () => this.exportReport('txt');
        
        // 导出 Markdown 按钮
        const exportMdBtn = document.createElement('button');
        exportMdBtn.className = 'report-action-btn export-btn';
        exportMdBtn.textContent = '📝 导出Markdown';
        exportMdBtn.onclick = () => this.exportReport('markdown');
        
        // 导出 Word 按钮
        const exportWordBtn = document.createElement('button');
        exportWordBtn.className = 'report-action-btn export-btn';
        exportWordBtn.textContent = '📄 导出Word';
        exportWordBtn.onclick = () => this.exportReport('word');
        
        // 导出 PDF 按钮
        const exportPdfBtn = document.createElement('button');
        exportPdfBtn.className = 'report-action-btn export-btn';
        exportPdfBtn.textContent = '📕 导出PDF';
        exportPdfBtn.onclick = () => this.exportReport('pdf');
        
        reportActionsDiv.appendChild(copyBtn);
        reportActionsDiv.appendChild(exportTxtBtn);
        reportActionsDiv.appendChild(exportMdBtn);
        reportActionsDiv.appendChild(exportWordBtn);
        reportActionsDiv.appendChild(exportPdfBtn);
        
        detailsDiv.appendChild(reportContentDiv);
        detailsDiv.appendChild(reportActionsDiv);
        
        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'step-toggle';
        toggleBtn.innerHTML = '<span>查看报告</span><span class="step-toggle-icon">▼</span>';
        toggleBtn.onclick = function() {
            this.classList.toggle('expanded');
            detailsDiv.classList.toggle('collapsed');
        };
        
        stepEl.appendChild(overviewDiv);
        stepEl.appendChild(detailsDiv);
        stepEl.appendChild(toggleBtn);
        
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
    
    createReportOverview(content) {
        const overviewDiv = document.createElement('div');
        overviewDiv.className = 'report-overview';
        
        // 计算字数
        const charCount = content.length;
        const wordCount = content.replace(/\s/g, '').length;
        
        // 提取章节标题（匹配 ## 或 ### 开头的行）
        const chapterMatches = content.match(/^#{2,3}\s+.+$/gm) || [];
        const chapters = chapterMatches.map(ch => ch.replace(/^#{2,3}\s+/, '')).slice(0, 5);
        
        // 计算预估阅读时间（按每分钟300字计算）
        const readTime = Math.ceil(wordCount / 300);
        
        overviewDiv.innerHTML = `
            <div class="report-overview-title">📊 报告概览</div>
            <div class="report-overview-stats">
                <div class="report-stat">
                    <span>📝</span>
                    <span>字数：<span class="report-stat-value">${wordCount.toLocaleString()}</span></span>
                </div>
                <div class="report-stat">
                    <span>⏱️</span>
                    <span>阅读时间：<span class="report-stat-value">${readTime}分钟</span></span>
                </div>
                <div class="report-stat">
                    <span>📑</span>
                    <span>章节：<span class="report-stat-value">${chapters.length}</span></span>
                </div>
            </div>
            ${chapters.length > 0 ? `
            <div class="report-chapters">
                ${chapters.map(ch => `<div class="report-chapter-item">${ch}</div>`).join('')}
            </div>
            ` : ''}
        `;
        
        return overviewDiv;
    }
    
    highlightKeywords(text) {
        // 定义需要高亮的关键词列表
        const keywords = [
            // 搜索相关
            { word: /搜索/g, class: 'keyword-search' },
            { word: /查询/g, class: 'keyword-search' },
            { word: /检索/g, class: 'keyword-search' },
            { word: /查找/g, class: 'keyword-search' },
            // 分析相关
            { word: /分析/g, class: 'keyword-analyze' },
            { word: /研究/g, class: 'keyword-analyze' },
            { word: /评估/g, class: 'keyword-analyze' },
            { word: /比较/g, class: 'keyword-analyze' },
            // 收集相关
            { word: /收集/g, class: 'keyword-collect' },
            { word: /获取/g, class: 'keyword-collect' },
            { word: /整理/g, class: 'keyword-collect' },
            { word: /汇总/g, class: 'keyword-collect' },
            // 验证相关
            { word: /验证/g, class: 'keyword-verify' },
            { word: /核实/g, class: 'keyword-verify' },
            { word: /确认/g, class: 'keyword-verify' },
            { word: /检查/g, class: 'keyword-verify' },
            // 报告相关
            { word: /报告/g, class: 'keyword-report' },
            { word: /撰写/g, class: 'keyword-report' },
            { word: /编写/g, class: 'keyword-report' },
            { word: /生成/g, class: 'keyword-report' }
        ];
        
        let highlightedText = text;
        keywords.forEach(({ word, class: className }) => {
            highlightedText = highlightedText.replace(word, match => 
                `<span class="${className}">${match}</span>`
            );
        });
        
        return highlightedText;
    }

    addRetryStep(data) {
        const stepId = this.addWorkflowStep(
            'retry', 
            '🔄', 
            '重新规划', 
            `第 ${data.retry_count} 次重试`,
            'planner'
        );
        
        const stepEl = document.getElementById(stepId);
        if (stepEl) {
            stepEl.classList.add('warning');
        }
        this.scrollToBottom();
    }
    
    addTransitionStep(fromStage, toStage) {
        // 阶段名称映射
        const stageNames = {
            'planner': '任务规划',
            'executor': '信息检索',
            'verifier': '验证评估',
            'reporter': '报告生成'
        };

        const fromName = stageNames[fromStage] || fromStage;
        const toName = stageNames[toStage] || toStage;

        const stepId = this.addWorkflowStep(
            'transition',
            '➡️',
            '阶段切换',
            `从「${fromName}」进入「${toName}」<span class="transition-loading"></span>`,
            'transition'
        );

        const stepEl = document.getElementById(stepId);
        if (stepEl) {
            stepEl.classList.add('transition-step');

            // 添加阶段切换动画
            const stepNumber = stepEl.querySelector('.step-number');
            if (stepNumber) {
                stepNumber.classList.add('transition');
            }

            // 3秒后自动标记为完成
            setTimeout(() => {
                if (stepNumber) {
                    stepNumber.classList.add('completed');
                    stepNumber.classList.remove('transition');
                }
                const statusIcon = stepEl.querySelector('.status-icon');
                if (statusIcon) {
                    statusIcon.textContent = '✓';
                }
                // 移除加载动画
                const loadingEl = stepEl.querySelector('.transition-loading');
                if (loadingEl) {
                    loadingEl.remove();
                }
            }, 2000);
        }

        this.scrollToBottom();
    }

    addErrorStep(data) {
        const stepId = this.addWorkflowStep(
            'error', 
            '❌', 
            '处理失败', 
            data.message || '未知错误',
            'reporter'
        );
        
        const stepEl = document.getElementById(stepId);
        if (stepEl) {
            stepEl.classList.add('error');
            
            const stepNumber = stepEl.querySelector('.step-number');
            if (stepNumber) {
                stepNumber.classList.add('error');
            }
        }
        
        this.scrollToBottom();
    }

    formatReportContent(content) {
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }

    // 会话列表渲染
    renderConversationList() {
        const conversations = this.conversationManager.listConversations();
        
        // 更新历史记录计数
        if (this.historyCount) {
            this.historyCount.textContent = conversations.length;
            this.historyCount.style.display = conversations.length > 0 ? 'inline-block' : 'none';
        }
        
        if (!this.conversationList) return;
        
        if (conversations.length === 0) {
            this.conversationList.innerHTML = '<div class="conversation-empty">暂无会话</div>';
            return;
        }
        
        this.conversationList.innerHTML = conversations.map(conv => `
            <div class="conversation-item ${conv.id === this.conversationManager.currentConversationId ? 'active' : ''}" 
                 data-id="${conv.id}">
                <div class="conversation-title">${this.escapeHtml(conv.title)}</div>
                <div class="conversation-meta">
                    <span>${new Date(conv.updatedAt).toLocaleDateString()}</span>
                    <button class="conversation-delete" data-id="${conv.id}">🗑️</button>
                </div>
            </div>
        `).join('');
        
        // 绑定点击事件
        this.conversationList.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('conversation-delete')) {
                    this.loadConversation(item.dataset.id);
                }
            });
        });
        
        // 绑定删除事件
        this.conversationList.querySelectorAll('.conversation-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteConversation(btn.dataset.id);
            });
        });
    }

    loadConversation(id) {
        const conversation = this.conversationManager.getConversation(id);
        if (!conversation) return;
        
        this.conversationManager.setCurrentConversation(id);
        this.renderConversationList();
        
        // 加载会话内容到UI
        this.clearWorkflow();
        
        if (conversation.currentReport) {
            if (this.emptyState) {
                this.emptyState.style.display = 'none';
            }
            if (this.workflowNodes) {
                this.workflowNodes.style.display = 'block';
            }
            this.addReportStep({ content: conversation.currentReport });
        }
        
        // 加载消息历史
        conversation.messages.forEach(msg => {
            if (msg.type === 'report') {
                this.addReportStep({ content: msg.content });
            } else {
                this.addChatMessage(msg.role, msg.content, msg.type);
            }
        });
    }

    deleteConversation(id) {
        if (confirm('确定要删除这个会话吗？')) {
            this.conversationManager.deleteConversation(id);
            this.renderConversationList();
            
            if (this.conversationManager.currentConversationId === id) {
                this.clearWorkflow();
                if (this.emptyState) {
                    this.emptyState.style.display = 'flex';
                }
            }
        }
    }

    // 历史记录方法（保持兼容）
    loadHistory() {
        // 从LocalStorage加载旧格式历史记录并迁移
        try {
            const oldHistory = localStorage.getItem('flowagent_history');
            if (oldHistory) {
                const history = JSON.parse(oldHistory);
                // 迁移到新的会话格式
                history.forEach(item => {
                    if (item.report) {
                        const conv = this.conversationManager.createConversation(item.query);
                        this.conversationManager.updateReport(conv.id, item.report, 'generate');
                    }
                });
                // 清除旧格式
                localStorage.removeItem('flowagent_history');
                this.renderConversationList();
            }
        } catch (e) {
            console.error('迁移历史记录失败:', e);
        }
    }

    saveToHistory() {
        // 已在ConversationManager中自动保存
        this.renderConversationList();
    }

    getHistory() {
        return this.conversationManager.listConversations().map(conv => ({
            id: conv.id,
            query: conv.title,
            report: conv.currentReport,
            timestamp: conv.updatedAt,
            status: conv.currentReport ? 'completed' : 'failed'
        }));
    }

    // 模态框方法
    openHistoryModal() {
        if (this.historyModal) {
            this.renderHistoryList();
            this.historyModal.classList.add('show');
            this.historyBtn.classList.add('active');
            this.historyModalClose.focus();
        }
    }

    closeHistoryModal() {
        if (this.historyModal) {
            this.historyModal.classList.remove('show');
            this.historyBtn.classList.remove('active');
            this.historyBtn.focus();
        }
    }

    openReportModal(item) {
        if (this.reportModal) {
            this.reportModalTitle.textContent = item.query;
            this.reportModalBody.innerHTML = this.formatReportContent(item.report);
            this.currentReportContent = item.report;
            this.currentReportTitle = item.query || '报告';
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
        
        this.historyModalBody.querySelectorAll('.history-list-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                const item = history.find(h => h.id === id);
                if (item) {
                    this.openReportModal(item);
                }
            });
        });
    }

    copyCurrentReport() {
        if (this.currentReportContent) {
            navigator.clipboard.writeText(this.currentReportContent).then(() => {
                alert('已复制到剪贴板');
            });
        }
    }

    exportCurrentReport() {
        if (this.currentReportContent) {
            const blob = new Blob([this.currentReportContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `report_${Date.now()}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
