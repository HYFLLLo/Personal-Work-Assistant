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

        const { conversationId, operationType, selectedText, position, templateId, documentId } = options;
        
        // 构建URL参数
        const params = new URLSearchParams({ query });
        if (conversationId) params.append('conversation_id', conversationId);
        if (operationType) params.append('operation_type', operationType);
        if (selectedText) params.append('selected_text', selectedText);
        if (position) params.append('position', position);
        if (templateId) params.append('template_id', templateId);
        if (documentId) params.append('document_id', documentId);
        
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
            'intent_analysis': 'intentAnalysis',
            'kb_evaluation': 'kbEvaluation',
            'user_confirmation_required': 'userConfirmationRequired',
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

    restoreConversation(item) {
        if (item && item.id) {
            this.conversations[item.id] = {
                id: item.id,
                title: item.query,
                currentReport: item.report,
                updatedAt: item.timestamp,
                messages: item.messages || []
            };
            this.saveToStorage();
        }
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

        // API基础URL
        this.API_BASE = 'http://localhost:8000/api';

        // 多轮对话状态
        this.chatMode = false; // 是否进入对话模式
        this.selectedText = ''; // 当前选中的文本
        this.operationType = 'generate'; // 当前操作类型

        // v5.0: 用户确认状态
        this.hasUserConfirmed = false; // 是否已经确认过
        this.userConfirmationResult = null; // 用户确认结果
        
        this.initElements();
        this.createHistoryModal();
        this.createChatModal();
        this.bindEvents();
        this.loadHistory();
        this.renderConversationList();
        this.restoreLastConversation();
        this.initTemplateSelector();
        
        // v6.0: 检查并恢复中断的工作流
        this.checkAndRestoreInterruptedWorkflow();
        
        // 监听页面可见性变化，处理用户返回
        this.setupVisibilityChangeHandler();
    }
    
    // v6.0: 设置页面可见性变化处理器
    setupVisibilityChangeHandler() {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                // 页面变为可见时，检查是否有中断的工作流
                this.checkAndRestoreInterruptedWorkflow();
            }
        });
    }
    
    // v6.0: 检查并恢复中断的工作流
    checkAndRestoreInterruptedWorkflow() {
        console.log('检查中断的工作流...');
        
        // 首先尝试从 sessionStorage 获取，如果没有则尝试 localStorage
        let interruptedWorkflow = sessionStorage.getItem('interruptedWorkflow');
        let source = 'sessionStorage';
        
        if (!interruptedWorkflow) {
            interruptedWorkflow = localStorage.getItem('interruptedWorkflow_backup');
            source = 'localStorage';
        }
        
        console.log(`从 ${source} 获取工作流状态:`, interruptedWorkflow ? '存在' : '不存在');
        
        if (interruptedWorkflow) {
            try {
                const workflowState = JSON.parse(interruptedWorkflow);
                console.log('解析后的工作流状态:', workflowState);
                
                // 验证状态是否有效
                if (!workflowState.queryInput && !workflowState.isProcessing) {
                    console.log('工作流状态无效，跳过恢复');
                    this.clearWorkflowStorage();
                    return;
                }
                
                // 显示恢复提示并恢复工作流
                this.showWorkflowRestoreNotification(workflowState);
            } catch (error) {
                console.error('恢复工作流状态失败:', error);
                this.clearWorkflowStorage();
            }
        } else {
            console.log('没有中断的工作流需要恢复');
        }
    }
    
    // v6.0: 清除工作流存储
    clearWorkflowStorage() {
        sessionStorage.removeItem('interruptedWorkflow');
        localStorage.removeItem('interruptedWorkflow_backup');
    }
    
    // v6.0: 显示工作流恢复提示
    showWorkflowRestoreNotification(workflowState) {
        // 创建恢复提示弹窗
        const notification = document.createElement('div');
        notification.className = 'workflow-restore-notification';
        notification.innerHTML = `
            <div class="workflow-restore-content">
                <div class="workflow-restore-icon">🔄</div>
                <div class="workflow-restore-text">
                    <div class="workflow-restore-title">工作流被中断，恢复工作流中...</div>
                    <div class="workflow-restore-detail">正在恢复您离开前的任务状态</div>
                </div>
                <div class="workflow-restore-spinner"></div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // 2秒后自动恢复工作流
        setTimeout(async () => {
            await this.restoreWorkflowState(workflowState);
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 500);
        }, 2000);
    }
    
    // v6.0: 恢复工作流状态
    async restoreWorkflowState(state) {
        console.log('恢复工作流状态:', state);
        
        // 恢复输入内容
        if (state.queryInput && this.queryInput) {
            this.queryInput.value = state.queryInput;
            this.updateCharCount();
        }
        
        // 恢复模板选择
        if (state.selectedTemplate) {
            this.selectedTemplate = state.selectedTemplate;
            const templateNameEl = document.getElementById('selectedTemplateName');
            if (templateNameEl) {
                templateNameEl.textContent = state.selectedTemplate.name || '不使用模板';
            }
        }
        
        // 恢复文档选择
        if (state.selectedDocument) {
            this.selectedDocument = state.selectedDocument;
            const documentNameEl = document.getElementById('selectedDocumentName');
            if (documentNameEl) {
                documentNameEl.textContent = state.selectedDocument.filename || '不使用文档';
            }
        }
        
        // 恢复工作流数据
        if (state.workflowData) {
            this.workflowData = state.workflowData;
        }
        
        // 恢复完成后清除存储
        this.clearWorkflowStorage();
        console.log('工作流状态恢复完成，已清除存储');
        
        // 恢复会话ID
        if (state.conversationId) {
            this.conversationManager.setCurrentConversation(state.conversationId);
        }
        
        // 恢复工作流显示（显示保存时的步骤）
        this.restoreWorkflowDisplay(state);
        
        // 重新连接 SSE 获取后续事件（动态继续）
        if (state.conversationId && state.queryInput) {
            console.log('重新连接 SSE 继续工作流...');
            // 延迟一点再连接，确保 DOM 已更新
            setTimeout(() => {
                this.reconnectToWorkflow(state);
            }, 500);
        }
    }
    
    // v6.0: 重新连接到工作流获取后续事件
    reconnectToWorkflow(state) {
        if (!state.conversationId || !state.queryInput) {
            console.log('无法重新连接：缺少会话ID或查询内容');
            return;
        }
        
        console.log('重新连接到工作流:', state.conversationId);
        
        // 设置处理状态（与 handleSubmit 保持一致）
        this.isProcessing = true;
        this.processingTime = 0;
        this.updateSubmitButtonState();
        this.startTimer();
        this.showStatus('processing', '恢复连接中...');
        
        // 使用与 handleSubmit 相同的 callbacks 重新连接
        this.connectWorkflowStream(state.queryInput, state.conversationId);
    }
    
    // v6.0: 重新启动工作流
    restartWorkflow(state) {
        // 显示恢复提示
        this.showStatus('processing', '恢复任务中...');
        
        // 重新提交查询
        setTimeout(() => {
            this.connectWorkflowStream(state.queryInput, state.conversationId);
        }, 1000);
    }
    
    // v6.0: 连接工作流流（使用 handleSubmit 相同的 callbacks）
    connectWorkflowStream(query, conversationId) {
        console.log('连接工作流流:', { query: query.substring(0, 50), conversationId });
        
        const callbacks = {
            onOpen: () => {
                console.log('SSE连接已建立');
                this.updateStatus('processing', '处理中...');
            },
            start: (data) => {
                console.log('开始处理:', data);
            },
            // v5.0: 意图识别回调
            intentAnalysis: (data) => {
                console.log('意图识别完成:', data);
                this.addWorkflowStep('intent', '🔍', '意图识别', `识别到意图: ${data.intent_type || '报告生成'}`, 'intent');
            },
            // v5.0: 知识库评估回调
            kbEvaluation: (data) => {
                console.log('知识库评估完成:', data);
                const levelText = {
                    'sufficient': '内容充足',
                    'insufficient': '内容不足',
                    'irrelevant': '内容不相关'
                };
                this.addWorkflowStep('kb', '📚', '知识库评估', `评估结果: ${levelText[data.sufficiency_level] || '未知'}`, 'kb');
            },
            // v5.0: 用户确认请求回调
            userConfirmationRequired: async (data) => {
                console.log('需要用户确认:', data);
                this.addWorkflowStep('confirm', '❓', '等待确认', '需要您确认是否进行搜索', 'confirm');
                
                const confirmed = await this.showConfirmationModal(data.prompt || '是否需要通过搜索获取更多信息？');
                console.log('用户选择:', confirmed ? '搜索' : '不搜索');
                
                this.hasUserConfirmed = true;
                this.userConfirmationResult = confirmed;
                
                // 更新步骤状态
                const confirmStep = document.querySelector('.workflow-step[data-type="confirm"]');
                if (confirmStep) {
                    const statusIcon = confirmStep.querySelector('.status-icon');
                    if (statusIcon) {
                        statusIcon.textContent = confirmed ? '✓' : '✗';
                    }
                    confirmStep.classList.add('completed');
                }
                
                // 发送确认结果到后端
                if (conversationId) {
                    try {
                        await fetch('http://localhost:8000/api/confirm', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ confirmed, conversation_id: conversationId })
                        });
                        console.log('确认结果已发送到后端');
                    } catch (error) {
                        console.error('发送确认结果失败:', error);
                    }
                }
            },
            plannerUpdate: (data) => {
                console.log('plannerUpdate 回调被调用:', data);
                this.workflowData.planner = data;
                if (data && data.plan && Array.isArray(data.plan)) {
                    this.addPlannerStep(data);
                    this.addTransitionStep('planner', 'executor');
                }
            },
            searchResult: (data) => {
                console.log('searchResult 回调被调用:', data);
                this.workflowData.searches.push(data);
                if (data && data.query) {
                    this.addSearchStep(data);
                }
            },
            verificationFeedback: (data) => {
                this.workflowData.verifications.push(data);
                this.addVerificationStep(data);
                this.addTransitionStep('verifier', 'reporter');
            },
            retryTrigger: (data) => {
                this.addRetryStep(data);
            },
            finalReport: (data) => {
                console.log('finalReport 回调被调用:', data);
                if (data && data.content) {
                    this.workflowData.report = data.content;
                    this.clearWorkflow();
                    this.addReportStep(data);
                    this.showChatInput();
                    
                    if (conversationId) {
                        this.conversationManager.updateReport(conversationId, data.content, 'generate');
                        this.conversationManager.addMessage(conversationId, {
                            role: 'assistant',
                            content: data.content,
                            type: 'report'
                        });
                    }
                }
            },
            error: (data) => {
                console.error('错误:', data);
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
                this.sseClient.isCompleted = true;
                this.updateSubmitButtonState();
                this.stopTimer();
                this.updateStatus('completed', '已完成');
                this.saveToHistory();
            }
        };
        
        // 连接SSE
        if (!this.sseClient) {
            console.error('sseClient 为 null');
            return;
        }
        
        this.sseClient.connect(query, callbacks, {
            operationType: 'generate',
            conversationId: conversationId,
            templateId: this.currentTemplateId,
            documentId: this.currentDocumentId
        });
    }
    
    // v6.0: 恢复工作流显示（不重新执行）
    restoreWorkflowDisplay(state) {
        console.log('恢复工作流显示:', state);
        
        // 首先隐藏空状态
        if (this.emptyState) {
            this.emptyState.style.display = 'none';
        }
        if (this.workflowNodes) {
            this.workflowNodes.style.display = 'flex';
        }
        
        // 清空工作流节点但不清空数据（保留currentStepId用于正确编号）
        if (this.workflowNodes) {
            this.workflowNodes.innerHTML = '';
        }
        this.currentNodeId = 0;
        this.currentStepId = 0;
        
        // 如果有工作流步骤，重新渲染
        if (state.workflowSteps && state.workflowSteps.length > 0) {
            console.log(`恢复 ${state.workflowSteps.length} 个工作流步骤`);
            state.workflowSteps.forEach((step, index) => {
                console.log(`恢复步骤 ${index + 1}:`, step);
                // 注意：addWorkflowStep 参数顺序：type, icon, title, content, nodeType
                // 保存时存储的是 description，对应 content 参数
                this.addWorkflowStep(step.type, step.icon, step.title, step.description || step.content || '', step.stage);
            });
        } else {
            console.log('没有工作流步骤需要恢复');
        }
        
        // 如果有报告，显示报告
        if (state.workflowData?.report) {
            console.log('恢复报告显示');
            this.addReportStep({ content: state.workflowData.report });
        }
    }
    
    // v6.0: 保存当前工作流状态
    saveWorkflowState() {
        if (!this.isProcessing && !this.queryInput?.value) {
            return; // 没有正在处理的工作流，不保存
        }
        
        const workflowSteps = [];
        const stepElements = document.querySelectorAll('.workflow-step');
        stepElements.forEach(el => {
            const type = el.dataset.type;
            const icon = el.querySelector('.step-icon')?.textContent || '';
            const title = el.querySelector('.step-title')?.textContent || '';
            const description = el.querySelector('.step-description')?.textContent || '';
            const stage = el.dataset.stage;
            workflowSteps.push({ type, icon, title, description, stage });
        });
        
        const state = {
            queryInput: this.queryInput?.value || '',
            selectedTemplate: this.selectedTemplate || null,
            selectedDocument: this.selectedDocument || null,
            workflowData: this.workflowData,
            isProcessing: this.isProcessing,
            conversationId: this.conversationManager.currentConversationId,
            operationType: this.operationType,
            workflowSteps: workflowSteps,
            timestamp: Date.now()
        };
        
        try {
            const stateJson = JSON.stringify(state);
            // 同时保存到 sessionStorage 和 localStorage 以确保可靠性
            sessionStorage.setItem('interruptedWorkflow', stateJson);
            localStorage.setItem('interruptedWorkflow_backup', stateJson);
            console.log('工作流状态已保存:', {
                queryInput: state.queryInput.substring(0, 50) + '...',
                isProcessing: state.isProcessing,
                workflowStepsCount: state.workflowSteps.length,
                timestamp: state.timestamp
            });
            
            // 验证保存是否成功
            const saved = sessionStorage.getItem('interruptedWorkflow');
            const savedBackup = localStorage.getItem('interruptedWorkflow_backup');
            if (saved && savedBackup) {
                console.log('验证：状态已保存到 sessionStorage 和 localStorage');
            } else {
                console.error('验证失败：状态保存不完整', { session: !!saved, local: !!savedBackup });
            }
        } catch (error) {
            console.error('保存工作流状态失败:', error);
        }
    }
    
    // v6.0: 显示保存并跳转提示
    showSaveAndRedirectNotification(targetUrl) {
        const notification = document.createElement('div');
        notification.className = 'workflow-save-notification';
        notification.innerHTML = `
            <div class="workflow-save-content">
                <div class="workflow-save-icon">💾</div>
                <div class="workflow-save-text">
                    <div class="workflow-save-title">正在保存工作流状态...</div>
                    <div class="workflow-save-detail">任务进度已保存，返回后可自动恢复</div>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // 1秒后跳转到知识库页面
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => {
                notification.remove();
                window.location.href = targetUrl;
            }, 300);
        }, 1000);
    }

    restoreLastConversation() {
        // 自动恢复最近的会话（仅设置ID，不加载内容到画布）
        const conversations = this.conversationManager.listConversations();
        if (conversations.length > 0) {
            const lastConversation = conversations[0];
            this.conversationManager.setCurrentConversation(lastConversation.id);
            console.log('自动恢复最近会话:', lastConversation.id);
            // 注意：不自动加载报告内容，保持画布为空状态
            // 用户可以通过点击历史记录来查看之前的报告
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

        // 知识库按钮
        this.knowledgeBaseBtn = document.getElementById('knowledgeBaseBtn');

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
        this.historyModalCount = document.getElementById('historyModalCount');
        this.historySearchInput = document.getElementById('historySearchInput');
        this.historySearchClear = document.getElementById('historySearchClear');
        
        // 搜索功能
        if (this.historySearchInput) {
            this.historySearchInput.addEventListener('input', (e) => {
                this.filterHistory(e.target.value);
                this.toggleSearchClearBtn(e.target.value);
            });
        }
        
        if (this.historySearchClear) {
            this.historySearchClear.addEventListener('click', () => {
                this.historySearchInput.value = '';
                this.filterHistory('');
                this.toggleSearchClearBtn('');
                this.historySearchInput.focus();
            });
        }
        
        this.reportModal = document.getElementById('reportModal');
        this.reportModalOverlay = document.getElementById('reportModalOverlay');
        this.reportModalClose = document.getElementById('reportModalClose');
        this.reportModalTitle = document.getElementById('reportModalTitle');
        this.reportModalBody = document.getElementById('reportModalBody');
        this.reportModalCopy = document.getElementById('reportModalCopy');
        this.reportModalExport = document.getElementById('reportModalExport');
        
        this.currentReportContent = '';
        
        // 删除功能相关元素
        this.deleteConfirmModal = document.getElementById('deleteConfirmModal');
        this.deleteCancelBtn = document.getElementById('deleteCancelBtn');
        this.deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
        this.undoToast = document.getElementById('undoToast');
        this.undoBtn = document.getElementById('undoBtn');
        
        // 删除相关状态
        this.pendingDeleteId = null;
        this.pendingDeleteElement = null;
        this.deletedItem = null;
        this.deletedItemIndex = null;
        this.undoTimeout = null;
        
        // 初始化删除功能事件
        this.initDeleteEvents();
        
        // v5.0: 初始化确认对话框
        this.initConfirmationModal();
    }

    // 初始化删除功能事件
    initDeleteEvents() {
        if (this.deleteCancelBtn) {
            this.deleteCancelBtn.addEventListener('click', () => this.closeDeleteModal());
        }
        if (this.deleteConfirmBtn) {
            this.deleteConfirmBtn.addEventListener('click', () => this.confirmDelete());
        }
        if (this.deleteConfirmModal) {
            this.deleteConfirmModal.addEventListener('click', (e) => {
                if (e.target === this.deleteConfirmModal) {
                    this.closeDeleteModal();
                }
            });
        }
        if (this.undoBtn) {
            this.undoBtn.addEventListener('click', () => this.undoDelete());
        }
    }

    // 显示删除确认对话框
    showDeleteConfirm(id, element) {
        this.pendingDeleteId = id;
        this.pendingDeleteElement = element;
        this.deleteConfirmModal.classList.add('show');
    }

    // 关闭删除确认对话框
    closeDeleteModal() {
        this.deleteConfirmModal.classList.remove('show');
        this.pendingDeleteId = null;
        this.pendingDeleteElement = null;
    }

    // 确认删除
    async confirmDelete() {
        if (!this.pendingDeleteId || !this.pendingDeleteElement) {
            this.closeDeleteModal();
            return;
        }

        const id = this.pendingDeleteId;
        const element = this.pendingDeleteElement;

        // 获取当前历史记录
        const history = this.getHistory();
        const index = history.findIndex(h => h.id === id);

        if (index === -1) {
            this.closeDeleteModal();
            return;
        }

        // 保存被删除的项目用于撤销
        this.deletedItem = history[index];
        this.deletedItemIndex = index;

        // 立即关闭确认对话框
        this.closeDeleteModal();

        // 添加删除动画
        element.classList.add('deleting');

        // 等待动画完成
        await new Promise(resolve => setTimeout(resolve, 600));

        // 使用 conversationManager 删除对话
        this.conversationManager.deleteConversation(id);

        // 同步删除到后端
        try {
            await this.syncDeleteToBackend(this.deletedItem);
        } catch (error) {
            console.error('同步删除到后端失败:', error);
        }

        // 重新渲染
        this.renderHistoryList();
        this.updateHistoryCount();

        // 关闭确认对话框
        this.closeDeleteModal();

        // 显示撤销提示
        this.showUndoToast();
    }

    // 同步删除到后端
    async syncDeleteToBackend(item) {
        if (item.conversation_id) {
            const response = await fetch(`http://localhost:8000/api/conversations/${item.conversation_id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('后端删除失败');
            }
        }
    }

    // 显示撤销提示
    showUndoToast() {
        this.undoToast.classList.add('show');

        // 清除之前的定时器
        if (this.undoTimeout) {
            clearTimeout(this.undoTimeout);
        }

        // 5秒后自动隐藏
        this.undoTimeout = setTimeout(() => {
            this.hideUndoToast();
            this.deletedItem = null;
            this.deletedItemIndex = null;
        }, 5000);
    }

    // 隐藏撤销提示
    hideUndoToast() {
        this.undoToast.classList.remove('show');
    }

    // 撤销删除
    async undoDelete() {
        if (!this.deletedItem || this.deletedItemIndex === null) {
            this.hideUndoToast();
            return;
        }

        // 使用 conversationManager 恢复对话
        this.conversationManager.restoreConversation(this.deletedItem);

        // 同步恢复到后端
        try {
            await this.syncUndoToBackend(this.deletedItem);
        } catch (error) {
            console.error('同步恢复到后端失败:', error);
        }

        // 重新渲染
        this.renderHistoryList();
        this.updateHistoryCount();

        // 隐藏撤销提示
        this.hideUndoToast();

        // 清空已删除项目
        this.deletedItem = null;
        this.deletedItemIndex = null;
    }

    // 同步恢复到后端
    async syncUndoToBackend(item) {
        if (item.conversation_id) {
            const response = await fetch('http://localhost:8000/api/conversations/restore', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(item)
            });

            if (!response.ok) {
                throw new Error('后端恢复失败');
            }
        }
    }

    // v5.0: 初始化确认对话框
    initConfirmationModal() {
        this.confirmationModal = document.getElementById('confirmationModal');
        this.confirmationModalOverlay = document.getElementById('confirmationModalOverlay');
        this.confirmationYesBtn = document.getElementById('confirmationYesBtn');
        this.confirmationNoBtn = document.getElementById('confirmationNoBtn');
        this.confirmationMessage = document.getElementById('confirmationMessage');
        
        // 绑定确认对话框事件
        this.confirmationYesBtn.addEventListener('click', () => {
            this.handleConfirmation(true);
        });
        
        this.confirmationNoBtn.addEventListener('click', () => {
            this.handleConfirmation(false);
        });
        
        this.confirmationModalOverlay.addEventListener('click', () => {
            // 点击遮罩层不关闭，必须做出选择
        });
        
        // 等待确认的Promise解析函数
        this.confirmationResolve = null;
    }
    
    // v5.0: 显示确认对话框
    showConfirmationModal(message) {
        return new Promise((resolve) => {
            this.confirmationMessage.textContent = message;
            this.confirmationModal.style.display = 'flex';
            this.confirmationResolve = resolve;
        });
    }
    
    // v5.0: 隐藏确认对话框
    hideConfirmationModal() {
        this.confirmationModal.style.display = 'none';
    }
    
    // v5.0: 处理用户确认选择
    async handleConfirmation(confirmed) {
        this.hideConfirmationModal();
        
        if (this.confirmationResolve) {
            this.confirmationResolve(confirmed);
            this.confirmationResolve = null;
        }
        
        // 发送确认结果到后端
        const conversation = this.conversationManager.getCurrentConversation();
        if (conversation) {
            try {
                await fetch('http://localhost:8000/api/confirm', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        confirmed: confirmed,
                        conversation_id: conversation.id
                    })
                });
            } catch (error) {
                console.error('发送确认结果失败:', error);
            }
        }
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
        
        // 知识库按钮事件
        if (this.knowledgeBaseBtn) {
            this.knowledgeBaseBtn.addEventListener('click', () => this.openKnowledgeBaseModal());
        }
        
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
            position: this.operationType === 'supplement' ? '指定位置' : null,
            templateId: this.currentTemplateId,
            documentId: this.currentDocumentId
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
            this.workflowNodes.style.display = 'flex';
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
                    }
                }
            },
            // v5.0: 意图识别回调
            intentAnalysis: (data) => {
                console.log('意图识别完成:', data);
                this.addWorkflowStep('intent', '🔍', '意图识别', `识别到意图: ${data.intent_type || '报告生成'}`, 'intent');
            },
            // v5.0: 知识库评估回调
            kbEvaluation: (data) => {
                console.log('知识库评估完成:', data);
                const levelText = {
                    'sufficient': '内容充足',
                    'insufficient': '内容不足',
                    'irrelevant': '内容不相关'
                };
                this.addWorkflowStep('kb', '📚', '知识库评估', `评估结果: ${levelText[data.sufficiency_level] || '未知'}`, 'kb');
            },
            // v5.0: 用户确认请求回调
            userConfirmationRequired: async (data) => {
                console.log('需要用户确认:', data);

                // 添加等待确认步骤到工作流
                this.addWorkflowStep('confirm', '❓', '等待确认', '需要您确认是否进行搜索', 'confirm');

                // 显示确认对话框并等待用户选择
                const confirmed = await this.showConfirmationModal(data.prompt || '是否需要通过搜索获取更多信息？');
                console.log('用户选择:', confirmed ? '搜索' : '不搜索');

                // 标记已经确认过
                this.hasUserConfirmed = true;
                this.userConfirmationResult = confirmed;

                // 更新步骤状态
                const confirmStep = document.querySelector('.workflow-step[data-type="confirm"]');
                if (confirmStep) {
                    const statusIcon = confirmStep.querySelector('.status-icon');
                    if (statusIcon) {
                        statusIcon.textContent = confirmed ? '✓' : '✗';
                    }
                    confirmStep.classList.add('completed');
                }

                // 发送确认结果到后端
                const conversation = this.conversationManager.getCurrentConversation();
                if (conversation) {
                    try {
                        await fetch('http://localhost:8000/api/confirm', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                confirmed: confirmed,
                                conversation_id: conversation.id
                            })
                        });
                        console.log('确认结果已发送到后端');
                    } catch (error) {
                        console.error('发送确认结果失败:', error);
                    }
                }

                // 如果用户选择搜索，继续等待后续事件
                // 如果用户选择不搜索，等待final_report事件
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
            operationType: 'generate',
            templateId: this.currentTemplateId,
            documentId: this.currentDocumentId
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

        // v5.0: 重置用户确认状态
        this.hasUserConfirmed = false;
        this.userConfirmationResult = null;
        
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
        
        // 切换图标显示：等待状态显示静态图标，处理中显示旋转动画
        const idleIcon = this.statusIconWrapper?.querySelector('.idle-icon');
        const spinner = this.statusIconWrapper?.querySelector('.status-spinner');
        
        if (idleIcon && spinner) {
            if (status === 'processing' || status === 'working') {
                idleIcon.style.display = 'none';
                spinner.style.display = 'block';
            } else {
                idleIcon.style.display = 'block';
                spinner.style.display = 'none';
            }
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
        copyBtn.setAttribute('data-action', 'copy');
        copyBtn.innerHTML = '<span>📋 复制全文</span>';
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(data.content).then(() => alert('已复制到剪贴板'));
        };
        
        // 导出 TXT 按钮
        const exportTxtBtn = document.createElement('button');
        exportTxtBtn.className = 'report-action-btn export-btn';
        exportTxtBtn.setAttribute('data-format', 'txt');
        exportTxtBtn.innerHTML = '<span>📝 导出TXT</span>';
        exportTxtBtn.onclick = () => this.exportReport('txt');
        
        // 导出 Markdown 按钮
        const exportMdBtn = document.createElement('button');
        exportMdBtn.className = 'report-action-btn export-btn';
        exportMdBtn.setAttribute('data-format', 'markdown');
        exportMdBtn.innerHTML = '<span>📝 导出Markdown</span>';
        exportMdBtn.onclick = () => this.exportReport('markdown');
        
        // 导出 Word 按钮
        const exportWordBtn = document.createElement('button');
        exportWordBtn.className = 'report-action-btn export-btn';
        exportWordBtn.setAttribute('data-format', 'word');
        exportWordBtn.innerHTML = '<span>📄 导出Word</span>';
        exportWordBtn.onclick = () => this.exportReport('word');
        
        // 导出 PDF 按钮
        const exportPdfBtn = document.createElement('button');
        exportPdfBtn.className = 'report-action-btn export-btn';
        exportPdfBtn.setAttribute('data-format', 'pdf');
        exportPdfBtn.innerHTML = '<span>📕 导出PDF</span>';
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
        
        // 计算预估阅读时间（按每分钟300字计算）
        const estimatedTime = Math.ceil(wordCount / 300);
        
        // 记录报告生成时间，用于动态计时
        const reportGeneratedAt = Date.now();
        
        overviewDiv.innerHTML = `
            <div class="report-overview-title">📊 报告概览</div>
            <div class="report-overview-stats">
                <div class="report-stat">
                    <span>📝</span>
                    <span>字数：<span class="report-stat-value">${wordCount.toLocaleString()}</span></span>
                </div>
                <div class="report-stat">
                    <span>⏱️</span>
                    <span>预估阅读：<span class="report-stat-value">${estimatedTime}分钟</span></span>
                </div>
                <div class="report-stat">
                    <span>👁️</span>
                    <span>已读时长：<span class="report-stat-value" id="reading-timer">0秒</span></span>
                </div>
            </div>
        `;
        
        // 启动动态计时器
        const timerElement = overviewDiv.querySelector('#reading-timer');
        if (timerElement) {
            this.startReadingTimer(timerElement, reportGeneratedAt);
        }
        
        return overviewDiv;
    }
    
    startReadingTimer(timerElement, startTime) {
        // 清除之前的计时器（如果存在）
        if (this.readingTimerInterval) {
            clearInterval(this.readingTimerInterval);
        }
        
        const updateTimer = () => {
            const elapsed = Date.now() - startTime;
            const seconds = Math.floor(elapsed / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            let timeText;
            if (hours > 0) {
                timeText = `${hours}小时${minutes % 60}分钟`;
            } else if (minutes > 0) {
                timeText = `${minutes}分钟${seconds % 60}秒`;
            } else {
                timeText = `${seconds}秒`;
            }
            
            timerElement.textContent = timeText;
        };
        
        // 立即更新一次
        updateTimer();
        
        // 每秒更新
        this.readingTimerInterval = setInterval(updateTimer, 1000);
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
        // 首先转义 HTML 特殊字符
        let formatted = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // 处理 Markdown 标题样式
        // H1: # 标题
        formatted = formatted.replace(/^# (.+)$/gm, '<h1 class="report-h1">$1</h1>');
        // H2: ## 标题
        formatted = formatted.replace(/^## (.+)$/gm, '<h2 class="report-h2">$1</h2>');
        // H3: ### 标题
        formatted = formatted.replace(/^### (.+)$/gm, '<h3 class="report-h3">$1</h3>');
        // H4: #### 标题
        formatted = formatted.replace(/^#### (.+)$/gm, '<h4 class="report-h4">$1</h4>');
        
        // 处理列表项
        formatted = formatted.replace(/^- (.+)$/gm, '<li class="report-list-item">$1</li>');
        formatted = formatted.replace(/^\* (.+)$/gm, '<li class="report-list-item">$1</li>');
        formatted = formatted.replace(/^\d+\. (.+)$/gm, '<li class="report-list-item">$1</li>');
        
        // 处理换行符
        formatted = formatted.replace(/\n/g, '<br>');
        
        return formatted;
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
                this.workflowNodes.style.display = 'flex';
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

    // ========== 知识库模态框方法 ==========
    initKnowledgeBaseModal() {
        // 知识库模态框元素
        this.kbModal = document.getElementById('kbModal');
        this.kbModalOverlay = document.getElementById('kbModalOverlay');
        this.kbModalClose = document.getElementById('kbModalClose');
        this.kbTotalDocs = document.getElementById('kbTotalDocs');
        this.kbCompletedDocs = document.getElementById('kbCompletedDocs');
        this.kbTotalChunks = document.getElementById('kbTotalChunks');
        this.kbUploadArea = document.getElementById('kbUploadArea');
        this.kbFileInput = document.getElementById('kbFileInput');
        this.kbUploadProgress = document.getElementById('kbUploadProgress');
        this.kbProgressFill = document.getElementById('kbProgressFill');
        this.kbProgressText = document.getElementById('kbProgressText');
        this.kbDocumentList = document.getElementById('kbDocumentList');

        // 知识库状态
        this.kbDocuments = [];
        this.kbCurrentFilter = 'all';

        // 文件类型图标映射
        this.kbFileIcons = {
            'txt': '📄',
            'md': '📝',
            'doc': '📘',
            'docx': '📘',
            'xls': '📊',
            'xlsx': '📊',
            'ppt': '📽️',
            'pptx': '📽️',
            'pdf': '📕'
        };

        // 状态文本映射
        this.kbStatusText = {
            'pending': '待处理',
            'processing': '处理中',
            'completed': '已完成',
            'failed': '失败'
        };

        // 绑定知识库事件
        this.bindKnowledgeBaseEvents();
    }

    bindKnowledgeBaseEvents() {
        // 关闭按钮事件
        if (this.kbModalClose) {
            this.kbModalClose.addEventListener('click', () => this.closeKnowledgeBaseModal());
        }
        if (this.kbModalOverlay) {
            this.kbModalOverlay.addEventListener('click', () => this.closeKnowledgeBaseModal());
        }

        // 上传区域事件
        if (this.kbUploadArea && this.kbFileInput) {
            this.kbUploadArea.addEventListener('click', () => this.kbFileInput.click());

            this.kbUploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.kbUploadArea.classList.add('dragover');
            });

            this.kbUploadArea.addEventListener('dragleave', () => {
                this.kbUploadArea.classList.remove('dragover');
            });

            this.kbUploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                this.kbUploadArea.classList.remove('dragover');
                this.handleKBFiles(e.dataTransfer.files);
            });

            this.kbFileInput.addEventListener('change', (e) => {
                this.handleKBFiles(e.target.files);
            });
        }

        // 过滤标签事件
        const filterTabs = document.querySelectorAll('.kb-filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                filterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.kbCurrentFilter = tab.dataset.filter;
                this.renderKBDocuments();
            });
        });

        // ESC键关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.kbModal?.classList.contains('show')) {
                this.closeKnowledgeBaseModal();
            }
        });
    }

    openKnowledgeBaseModal() {
        if (!this.kbModal) {
            this.initKnowledgeBaseModal();
        }
        if (this.kbModal) {
            this.kbModal.classList.add('show');
            this.knowledgeBaseBtn?.classList.add('active');
            this.loadKBDocuments();
            this.loadKBStats();
        }
    }

    closeKnowledgeBaseModal() {
        if (this.kbModal) {
            this.kbModal.classList.remove('show');
            this.knowledgeBaseBtn?.classList.remove('active');
            this.knowledgeBaseBtn?.focus();
        }
    }

    async loadKBDocuments() {
        try {
            const response = await fetch(`${this.API_BASE}/knowledge-base/documents`);
            const data = await response.json();
            this.kbDocuments = data.documents || [];
            this.renderKBDocuments();
            this.updateKBStatsFromDocuments();
        } catch (error) {
            console.error('加载文档失败:', error);
            this.showToast('加载文档列表失败', 'error');
        }
    }

    async loadKBStats() {
        try {
            const response = await fetch(`${this.API_BASE}/knowledge-base/stats`);
            if (response.ok) {
                const data = await response.json();
                this.animateKBStatValue('kbTotalDocs', data.total_documents || 0);
                this.animateKBStatValue('kbCompletedDocs', data.completed_documents || 0);
                this.animateKBStatValue('kbTotalChunks', data.vector_store?.total_chunks || 0);
            }
        } catch (error) {
            console.log('使用文档数据计算统计');
        }
    }

    updateKBStatsFromDocuments() {
        const totalDocs = this.kbDocuments.length;
        const completedDocs = this.kbDocuments.filter(doc => doc.status === 'completed').length;
        const totalChunks = this.kbDocuments.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0);

        this.animateKBStatValue('kbTotalDocs', totalDocs);
        this.animateKBStatValue('kbCompletedDocs', completedDocs);
        this.animateKBStatValue('kbTotalChunks', totalChunks);
    }

    animateKBStatValue(elementId, newValue) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const oldValue = parseInt(element.textContent) || 0;
        if (oldValue === newValue) return;

        element.classList.add('updated');
        const duration = 500;
        const startTime = performance.now();

        const updateNumber = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const currentValue = Math.round(oldValue + (newValue - oldValue) * easeOutQuart);
            element.textContent = currentValue;

            if (progress < 1) {
                requestAnimationFrame(updateNumber);
            } else {
                element.textContent = newValue;
                setTimeout(() => element.classList.remove('updated'), 300);
            }
        };

        requestAnimationFrame(updateNumber);
    }

    renderKBDocuments() {
        if (!this.kbDocumentList) return;

        let filteredDocs = this.kbDocuments;
        if (this.kbCurrentFilter !== 'all') {
            filteredDocs = this.kbDocuments.filter(doc => doc.status === this.kbCurrentFilter);
        }

        if (filteredDocs.length === 0) {
            this.kbDocumentList.innerHTML = `
                <div class="kb-empty-state">
                    <div class="kb-empty-icon">📭</div>
                    <div class="kb-empty-text">${this.kbCurrentFilter === 'all' ? '暂无文档，请上传文件' : '该状态下暂无文档'}</div>
                </div>
            `;
            return;
        }

        this.kbDocumentList.innerHTML = filteredDocs.map(doc => `
            <div class="kb-document-card ${doc.status}">
                <div class="kb-doc-icon">${this.kbFileIcons[doc.file_type] || '📄'}</div>
                <div class="kb-doc-info">
                    <div class="kb-doc-name">${doc.filename}</div>
                    <div class="kb-doc-meta">
                        ${this.formatKBFileSize(doc.file_size)} · 
                        ${doc.word_count || 0} 字 · 
                        ${new Date(doc.created_at).toLocaleDateString()}
                        ${doc.chunk_count ? `· ${doc.chunk_count} 个片段` : ''}
                    </div>
                </div>
                <div class="kb-doc-status ${doc.status}">${this.kbStatusText[doc.status]}</div>
                <div class="kb-doc-actions">
                    <button class="kb-action-btn view" onclick="app.viewKBDocument('${doc.document_id}')">查看</button>
                    <button class="kb-action-btn delete" onclick="app.deleteKBDocument('${doc.document_id}')">删除</button>
                </div>
            </div>
        `).join('');
    }

    async handleKBFiles(files) {
        if (!this.kbUploadProgress || !this.kbProgressFill || !this.kbProgressText) return;

        this.kbUploadProgress.classList.add('active');

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const progress = ((i + 1) / files.length) * 100;

            this.kbProgressFill.style.width = `${progress}%`;
            this.kbProgressText.textContent = `正在上传 ${file.name} (${i + 1}/${files.length})`;

            try {
                await this.uploadKBFile(file);
            } catch (error) {
                this.showToast(`上传失败: ${file.name}`, 'error');
            }
        }

        setTimeout(() => {
            this.kbUploadProgress.classList.remove('active');
            this.kbProgressFill.style.width = '0%';
            this.loadKBDocuments();
        }, 1000);
    }

    async uploadKBFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${this.API_BASE}/knowledge-base/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '上传失败');
        }

        this.showToast(`上传成功: ${file.name}`, 'success');
        return await response.json();
    }

    async viewKBDocument(docId) {
        try {
            const response = await fetch(`${this.API_BASE}/knowledge-base/documents/${docId}`);
            const doc = await response.json();

            // 创建查看文档的模态框
            const modal = document.createElement('div');
            modal.className = 'kb-modal show';
            modal.style.zIndex = '300';
            modal.innerHTML = `
                <div class="kb-modal-overlay" onclick="this.parentElement.remove()"></div>
                <div class="kb-modal-content" style="max-width: 800px;">
                    <div class="kb-modal-header">
                        <div class="kb-modal-title">
                            <span class="kb-modal-icon">📄</span>
                            <h3>${doc.filename}</h3>
                        </div>
                        <button class="kb-modal-close" onclick="this.closest('.kb-modal').remove()">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>
                    <div class="kb-modal-body">
                        <div style="margin-bottom: 20px; font-family: 'Roboto Mono', monospace; font-size: 13px; line-height: 1.8;">
                            <div style="margin-bottom: 10px;"><strong style="color: var(--cyber-blue, #0A84FF);">文件类型:</strong> ${doc.file_type}</div>
                            <div style="margin-bottom: 10px;"><strong style="color: var(--cyber-blue, #0A84FF);">文件大小:</strong> ${this.formatKBFileSize(doc.file_size)}</div>
                            <div style="margin-bottom: 10px;"><strong style="color: var(--cyber-blue, #0A84FF);">状态:</strong> <span class="kb-doc-status ${doc.status}">${this.kbStatusText[doc.status]}</span></div>
                            <div style="margin-bottom: 10px;"><strong style="color: var(--cyber-blue, #0A84FF);">字数:</strong> ${doc.word_count || 0}</div>
                            <div style="margin-bottom: 10px;"><strong style="color: var(--cyber-blue, #0A84FF);">片段数:</strong> ${doc.chunk_count || 0}</div>
                            <div style="margin-bottom: 10px;"><strong style="color: var(--cyber-blue, #0A84FF);">上传时间:</strong> ${new Date(doc.created_at).toLocaleString()}</div>
                        </div>
                        ${doc.content_preview ? `
                            <div style="margin-top: 20px;">
                                <strong style="color: var(--cyber-blue, #0A84FF);">内容预览:</strong>
                                <pre style="background: rgba(10, 132, 255, 0.05); padding: 20px; border-radius: 8px; margin-top: 10px; max-height: 300px; overflow-y: auto; white-space: pre-wrap; border: 1px solid rgba(10, 132, 255, 0.2); font-family: 'Roboto Mono', monospace; font-size: 12px; line-height: 1.6; color: rgba(255, 255, 255, 0.8);">${doc.content_preview}</pre>
                            </div>
                        ` : ''}
                        ${doc.error_message ? `
                            <div style="margin-top: 20px; color: #ff4d4d;">
                                <strong>错误信息:</strong> ${doc.error_message}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        } catch (error) {
            this.showToast('加载文档详情失败', 'error');
        }
    }

    async deleteKBDocument(docId) {
        if (!confirm('确定要删除这个文档吗？')) return;

        try {
            const response = await fetch(`${this.API_BASE}/knowledge-base/documents/${docId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showToast('文档已删除', 'success');
                this.kbDocuments = this.kbDocuments.filter(doc => doc.document_id !== docId);
                this.renderKBDocuments();
                this.updateKBStatsFromDocuments();
            } else {
                throw new Error('删除失败');
            }
        } catch (error) {
            this.showToast('删除文档失败', 'error');
        }
    }

    formatKBFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // ========== 知识库模态框方法结束 ==========

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

    renderHistoryList(filterText = '') {
        const history = this.getHistory();
        
        // 更新计数显示
        if (this.historyModalCount) {
            this.historyModalCount.textContent = history.length;
        }
        
        // 过滤历史记录
        const filteredHistory = filterText 
            ? history.filter(item => item.query.toLowerCase().includes(filterText.toLowerCase()))
            : history;
        
        if (filteredHistory.length === 0) {
            this.historyModalBody.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon">📝</div>
                    <div class="history-empty-text">${filterText ? '未找到匹配的记录' : '暂无历史记录'}</div>
                </div>
            `;
            return;
        }
        
        this.historyModalBody.innerHTML = `
            <div class="history-list">
                ${filteredHistory.map(item => {
                    const date = new Date(item.timestamp);
                    const timeStr = date.toLocaleString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    const statusText = item.status === 'completed' ? '已完成' : '失败';
                    const icon = item.status === 'completed' ? '✅' : '❌';
                    
                    // 截取报告内容预览（前300个字符）
                    const reportPreview = item.report 
                        ? (item.report.length > 300 ? item.report.substring(0, 300) + '...' : item.report)
                        : '暂无报告内容';
                    
                    return `
                        <div class="history-item expanded ${filterText ? 'highlighted' : ''}" data-id="${item.id}" tabindex="0" role="button">
                            <div class="history-item-header">
                                <div class="history-item-icon">${icon}</div>
                                <div class="history-item-content">
                                    <div class="history-item-query">${this.escapeHtml(item.query)}</div>
                                    <div class="history-item-meta">
                                        <div class="history-item-time">${timeStr}</div>
                                        <div class="history-item-status ${item.status}">${statusText}</div>
                                    </div>
                                </div>
                                <div class="history-item-actions">
                                    <button class="history-delete-btn" data-id="${item.id}" title="删除记录">
                                        <svg viewBox="0 0 24 24">
                                            <polyline points="3 6 5 6 21 6"></polyline>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                            <line x1="10" y1="11" x2="10" y2="17"></line>
                                            <line x1="14" y1="11" x2="14" y2="17"></line>
                                        </svg>
                                    </button>
                                </div>
                                <div class="history-item-expand" title="点击收起">
                                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M18 15l-6-6-6 6"/>
                                    </svg>
                                </div>
                            </div>
                            <div class="history-item-report">
                                <div class="history-report-header">
                                    <div class="history-report-title">📄 报告内容</div>
                                    <div class="history-report-actions">
                                        <button class="history-report-btn" data-action="copy" data-id="${item.id}">复制</button>
                                        <button class="history-report-btn" data-action="export-txt" data-id="${item.id}">导出TXT</button>
                                        <button class="history-report-btn" data-action="export-md" data-id="${item.id}">导出MD</button>
                                        <button class="history-report-btn" data-action="export-word" data-id="${item.id}">导出Word</button>
                                        <button class="history-report-btn" data-action="export-pdf" data-id="${item.id}">导出PDF</button>
                                        <button class="history-collapse-btn" data-id="${item.id}" title="收起">
                                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M18 15l-6-6-6 6"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                                <div class="history-report-content">${this.escapeHtml(reportPreview)}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        // 添加点击头部展开/收起功能
        this.historyModalBody.querySelectorAll('.history-item-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // 如果点击的是按钮或删除按钮，不触发展开/收起
                if (e.target.closest('.history-report-btn') || e.target.closest('.history-collapse-btn') || e.target.closest('.history-delete-btn')) {
                    return;
                }
                
                const historyItem = header.closest('.history-item');
                if (historyItem) {
                    historyItem.classList.toggle('expanded');
                    
                    // 更新箭头方向
                    const expandBtn = header.querySelector('.history-item-expand');
                    if (expandBtn) {
                        const svg = expandBtn.querySelector('svg');
                        if (svg) {
                            if (historyItem.classList.contains('expanded')) {
                                svg.innerHTML = '<path d="M18 15l-6-6-6 6"/>';
                                expandBtn.setAttribute('title', '点击收起');
                            } else {
                                svg.innerHTML = '<path d="M6 9l6 6 6-6"/>';
                                expandBtn.setAttribute('title', '点击展开');
                            }
                        }
                    }
                }
            });
        });
        
        // 添加复制和导出按钮功能
        this.historyModalBody.querySelectorAll('.history-report-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                const item = history.find(h => h.id === id);
                
                if (item && item.report) {
                    if (action === 'copy') {
                        navigator.clipboard.writeText(item.report).then(() => {
                            this.showNotification('已复制到剪贴板', 'success');
                        });
                    } else if (action.startsWith('export-')) {
                        const format = action.replace('export-', '');
                        this.exportHistoryReport(item, format);
                    }
                }
            });
        });
        
        // 添加收起按钮功能
        this.historyModalBody.querySelectorAll('.history-collapse-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const historyItem = btn.closest('.history-item');
                if (historyItem) {
                    historyItem.classList.remove('expanded');
                    // 添加收起动画效果
                    historyItem.style.transition = 'all 0.3s ease';

                    // 更新箭头方向
                    const header = historyItem.querySelector('.history-item-header');
                    if (header) {
                        const expandBtn = header.querySelector('.history-item-expand');
                        if (expandBtn) {
                            const svg = expandBtn.querySelector('svg');
                            if (svg) {
                                svg.innerHTML = '<path d="M6 9l6 6 6-6"/>';
                                expandBtn.setAttribute('title', '点击展开');
                            }
                        }
                    }
                }
            });
        });

        // 添加删除按钮功能
        this.historyModalBody.querySelectorAll('.history-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const historyItem = btn.closest('.history-item');
                this.showDeleteConfirm(id, historyItem);
            });
        });
    }
    
    exportHistoryReport(item, format = 'md') {
        if (!item.report) return;
        
        const timestamp = new Date(item.timestamp).toLocaleDateString();
        const query = item.query.substring(0, 20);
        let blob, filename, mimeType;
        
        switch (format) {
            case 'txt':
                blob = new Blob([item.report], { type: 'text/plain;charset=utf-8' });
                filename = `报告_${query}_${timestamp}.txt`;
                mimeType = 'text/plain';
                break;
            case 'md':
                blob = new Blob([item.report], { type: 'text/markdown;charset=utf-8' });
                filename = `报告_${query}_${timestamp}.md`;
                mimeType = 'text/markdown';
                break;
            case 'word':
                // 创建简单的HTML格式，Word可以打开
                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${item.query}</title>
<style>
body { font-family: 'Microsoft YaHei', sans-serif; line-height: 1.6; padding: 40px; }
h1 { color: #333; border-bottom: 2px solid #1890ff; padding-bottom: 10px; }
h2 { color: #444; margin-top: 30px; }
h3 { color: #555; }
p { margin: 10px 0; }
ul, ol { margin: 10px 0; padding-left: 30px; }
li { margin: 5px 0; }
</style>
</head>
<body>
<h1>${item.query}</h1>
${item.report.replace(/\n/g, '<br>').replace(/#{1,6} (.+)/g, (match, title) => {
    const level = match.match(/#/g).length;
    return `<h${level}>${title}</h${level}>`;
})}
</body>
</html>`;
                blob = new Blob([htmlContent], { type: 'application/msword;charset=utf-8' });
                filename = `报告_${query}_${timestamp}.doc`;
                mimeType = 'application/msword';
                break;
            case 'pdf':
                // 使用浏览器打印功能生成PDF
                this.exportReportAsPDF(item);
                return;
            default:
                blob = new Blob([item.report], { type: 'text/plain;charset=utf-8' });
                filename = `报告_${query}_${timestamp}.txt`;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        this.showNotification(`报告已导出为 ${format.toUpperCase()} 格式`, 'success');
    }
    
    // PDF导出方法 - 使用浏览器打印功能
    exportReportAsPDF(item) {
        if (!item.report) return;
        
        const timestamp = new Date(item.timestamp).toLocaleDateString();
        const query = item.query.substring(0, 30);
        
        // 创建打印窗口
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            this.showNotification('请允许弹出窗口以导出PDF', 'error');
            return;
        }
        
        // 将Markdown转换为HTML
        const htmlContent = this.convertMarkdownToHTML(item.report, item.query);
        
        // 写入内容
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>${item.query}</title>
                <style>
                    @page {
                        size: A4;
                        margin: 20mm;
                    }
                    body {
                        font-family: 'Microsoft YaHei', 'SimSun', serif;
                        line-height: 1.8;
                        color: #333;
                        max-width: 210mm;
                        margin: 0 auto;
                        padding: 20px;
                    }
                    h1 {
                        color: #1a1a1a;
                        border-bottom: 3px solid #1890ff;
                        padding-bottom: 15px;
                        margin-bottom: 30px;
                        font-size: 24px;
                    }
                    h2 {
                        color: #2c2c2c;
                        margin-top: 30px;
                        margin-bottom: 15px;
                        font-size: 20px;
                        border-left: 4px solid #1890ff;
                        padding-left: 15px;
                    }
                    h3 {
                        color: #444;
                        margin-top: 25px;
                        margin-bottom: 12px;
                        font-size: 16px;
                    }
                    p {
                        margin: 12px 0;
                        text-align: justify;
                    }
                    ul, ol {
                        margin: 15px 0;
                        padding-left: 30px;
                    }
                    li {
                        margin: 8px 0;
                    }
                    strong {
                        color: #1a1a1a;
                    }
                    blockquote {
                        border-left: 4px solid #1890ff;
                        margin: 15px 0;
                        padding: 10px 20px;
                        background: #f5f5f5;
                        font-style: italic;
                    }
                    code {
                        background: #f0f0f0;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-family: 'Consolas', monospace;
                        font-size: 14px;
                    }
                    pre {
                        background: #f5f5f5;
                        padding: 15px;
                        border-radius: 5px;
                        overflow-x: auto;
                        border-left: 3px solid #1890ff;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 20px 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 12px;
                        text-align: left;
                    }
                    th {
                        background: #f5f5f5;
                        font-weight: bold;
                    }
                    .header-info {
                        text-align: center;
                        margin-bottom: 30px;
                        padding-bottom: 20px;
                        border-bottom: 1px solid #eee;
                    }
                    .header-info h1 {
                        border: none;
                        margin-bottom: 10px;
                    }
                    .meta-info {
                        color: #666;
                        font-size: 12px;
                    }
                    @media print {
                        body {
                            padding: 0;
                        }
                        .no-print {
                            display: none;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="header-info">
                    <h1>${item.query}</h1>
                    <div class="meta-info">
                        生成时间：${new Date(item.timestamp).toLocaleString()} | 
                        字数：${item.report.length}
                    </div>
                </div>
                ${htmlContent}
                <div class="no-print" style="margin-top: 50px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 5px;">
                    <p>请按 Ctrl+P (Windows) 或 Cmd+P (Mac) 打开打印对话框，选择"另存为PDF"即可导出</p>
                    <button onclick="window.print()" style="padding: 10px 30px; font-size: 16px; cursor: pointer; background: #1890ff; color: white; border: none; border-radius: 5px;">打开打印对话框</button>
                </div>
            </body>
            </html>
        `);
        
        printWindow.document.close();
        
        this.showNotification('PDF导出窗口已打开，请使用浏览器的打印功能保存为PDF', 'success');
    }
    
    // Markdown转HTML辅助方法
    convertMarkdownToHTML(markdown, title) {
        let html = markdown
            // 转义HTML特殊字符
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // 标题
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // 粗体和斜体
            .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // 代码块
            .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            // 行内代码
            .replace(/`(.+?)`/g, '<code>$1</code>')
            // 引用
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            // 无序列表
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            // 有序列表
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // 链接
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            // 段落（处理空行）
            .replace(/\n\n/g, '</p><p>')
            // 换行
            .replace(/\n/g, '<br>');
        
        // 包裹段落
        html = '<p>' + html + '</p>';
        
        // 修复列表结构
        html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
        
        return html;
    }
    
    filterHistory(searchText) {
        this.renderHistoryList(searchText);
    }
    
    toggleSearchClearBtn(value) {
        if (this.historySearchClear) {
            this.historySearchClear.style.display = value ? 'flex' : 'none';
        }
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

    // ========== 模板选择器功能 ==========
    
    // 初始化模板选择器
    initTemplateSelector() {
        this.templateSelector = document.getElementById('templateSelector');
        this.templateDropdown = document.getElementById('templateDropdown');
        this.templateCategories = document.getElementById('templateCategories');
        this.selectedTemplateName = document.getElementById('selectedTemplateName');
        this.currentTemplateId = 'general'; // 默认使用通用模板（不使用模板）
        
        // 初始化文档选择器
        this.documentSelector = document.getElementById('documentSelector');
        this.documentDropdown = document.getElementById('documentDropdown');
        this.documentCategories = document.getElementById('documentCategories');
        this.selectedDocumentName = document.getElementById('selectedDocumentName');
        this.currentDocumentId = null; // 默认不使用文档
        
        if (this.templateSelector) {
            // 点击外部关闭下拉框
            document.addEventListener('click', (e) => {
                if (this.templateSelector && !this.templateSelector.contains(e.target)) {
                    this.closeTemplateDropdown();
                }
                if (this.documentSelector && !this.documentSelector.contains(e.target)) {
                    this.closeDocumentDropdown();
                }
            });
            
            // 加载模板列表
            this.loadTemplates();
            
            // 加载文档列表
            this.loadDocuments();
        }
    }
    
    // 加载模板列表
    async loadTemplates() {
        if (!this.templateCategories) return;
        
        this.templateCategories.innerHTML = '<div class="template-loading">加载模板中...</div>';
        
        try {
            const response = await fetch('http://localhost:8000/api/templates');
            if (!response.ok) throw new Error('加载模板失败');
            
            const templates = await response.json();
            this.renderTemplates(templates);
        } catch (error) {
            console.error('加载模板失败:', error);
            this.templateCategories.innerHTML = `
                <div class="template-error">
                    加载模板失败
                    <button onclick="app.loadTemplates()">重试</button>
                </div>
            `;
        }
    }
    
    // 渲染模板列表
    renderTemplates(templates) {
        if (!this.templateCategories) return;
        
        // 按分类分组
        const categories = {};
        templates.forEach(template => {
            if (!categories[template.category]) {
                categories[template.category] = [];
            }
            categories[template.category].push(template);
        });
        
        // 渲染分类和模板
        this.templateCategories.innerHTML = Object.entries(categories).map(([category, items]) => `
            <div class="template-category">
                <div class="template-category-title">${category}</div>
                <div class="template-list">
                    ${items.map(template => `
                        <div class="template-item ${template.id === this.currentTemplateId ? 'active' : ''}" 
                             data-id="${template.id}" 
                             data-name="${template.name}"
                             title="${template.description}">
                            <span class="template-item-icon">${template.icon}</span>
                            <div class="template-item-info">
                                <div class="template-item-name">${template.name}</div>
                                <div class="template-item-desc">${template.description}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
        
        // 绑定模板点击事件
        this.templateCategories.querySelectorAll('.template-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectTemplate(item.dataset.id, item.dataset.name);
            });
        });
    }
    
    // 选择模板
    selectTemplate(templateId, templateName) {
        this.currentTemplateId = templateId;
        if (this.selectedTemplateName) {
            this.selectedTemplateName.textContent = templateName;
        }
        
        // 更新选中状态
        if (this.templateCategories) {
            this.templateCategories.querySelectorAll('.template-item').forEach(item => {
                item.classList.toggle('active', item.dataset.id === templateId);
            });
        }
        
        this.closeTemplateDropdown();
        console.log('已选择模板:', templateId, templateName);
    }
    
    // 切换下拉框显示/隐藏
    toggleTemplateDropdown() {
        if (!this.templateSelector || !this.templateDropdown) return;
        
        const isExpanded = this.templateSelector.classList.contains('expanded');
        
        if (isExpanded) {
            this.closeTemplateDropdown();
        } else {
            this.templateSelector.classList.add('expanded');
            this.templateDropdown.style.display = 'block';
        }
    }
    
    // 关闭下拉框
    closeTemplateDropdown() {
        if (this.templateSelector) {
            this.templateSelector.classList.remove('expanded');
        }
        if (this.templateDropdown) {
            this.templateDropdown.style.display = 'none';
        }
    }

    // ========== 文档选择器功能 ==========

    // 加载文档列表
    async loadDocuments() {
        if (!this.documentCategories) return;

        this.documentCategories.innerHTML = '<div class="template-loading">加载文档中...</div>';

        try {
            const response = await fetch('http://localhost:8000/api/knowledge-base/documents');
            if (!response.ok) throw new Error('加载文档失败');

            const data = await response.json();
            // API 返回 {documents: [...], total: ...} 格式
            const documents = data.documents || [];
            this.renderDocuments(documents);
        } catch (error) {
            console.error('加载文档失败:', error);
            this.documentCategories.innerHTML = `
                <div class="template-error">
                    加载文档失败
                    <button onclick="app.loadDocuments()">重试</button>
                </div>
            `;
        }
    }

    // 渲染文档列表
    renderDocuments(documents) {
        if (!this.documentCategories) return;

        // 添加"不使用文档"选项
        let html = `
            <div class="template-category">
                <div class="template-category-title">选项</div>
                <div class="template-item ${!this.currentDocumentId ? 'active' : ''}" data-id="" onclick="app.selectDocument('', '不使用文档')">
                    <div class="template-item-icon">🚫</div>
                    <div class="template-item-info">
                        <div class="template-item-name">不使用文档</div>
                        <div class="template-item-desc">基于网络搜索生成报告</div>
                    </div>
                </div>
            </div>
        `;

        // 只显示已完成的文档
        const completedDocs = documents.filter(doc => doc.status === 'completed');

        if (completedDocs.length > 0) {
            html += `
                <div class="template-category">
                    <div class="template-category-title">知识库文档 (${completedDocs.length})</div>
            `;

            completedDocs.forEach(doc => {
                html += `
                    <div class="template-item ${this.currentDocumentId === doc.document_id ? 'active' : ''}" data-id="${doc.document_id}" onclick="app.selectDocument('${doc.document_id}', '${doc.filename}')">
                        <div class="template-item-icon">📄</div>
                        <div class="template-item-info">
                            <div class="template-item-name">${doc.filename}</div>
                            <div class="template-item-desc">${doc.chunk_count} 个片段 · ${doc.file_size}</div>
                        </div>
                    </div>
                `;
            });

            html += '</div>';
        }

        this.documentCategories.innerHTML = html;
    }

    // 选择文档
    selectDocument(documentId, documentName) {
        this.currentDocumentId = documentId || null;
        if (this.selectedDocumentName) {
            this.selectedDocumentName.textContent = documentName || '不使用文档';
        }

        // 更新选中状态
        if (this.documentCategories) {
            this.documentCategories.querySelectorAll('.template-item').forEach(item => {
                item.classList.toggle('active', item.dataset.id === documentId);
            });
        }

        this.closeDocumentDropdown();
        console.log('已选择文档:', documentId, documentName);
    }

    // 切换文档下拉框
    toggleDocumentDropdown() {
        if (!this.documentSelector || !this.documentDropdown) return;

        const isExpanded = this.documentSelector.classList.contains('expanded');

        if (isExpanded) {
            this.closeDocumentDropdown();
        } else {
            this.documentSelector.classList.add('expanded');
            this.documentDropdown.style.display = 'block';
            // 重新加载文档列表
            this.loadDocuments();
        }
    }

    // 关闭文档下拉框
    closeDocumentDropdown() {
        if (this.documentSelector) {
            this.documentSelector.classList.remove('expanded');
        }
        if (this.documentDropdown) {
            this.documentDropdown.style.display = 'none';
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
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new App();
    initMatrixRain();
});

// 数字矩阵雨效果 - 柔和版
function initMatrixRain() {
    const container = document.getElementById('matrixRain');
    if (!container) return;

    // 清空现有内容
    container.innerHTML = '';

    // 简化字符集 - 仅使用数字和字母
    const chars = '0123456789ABCDEF';
    
    // 减少列数，增加间距
    const screenWidth = window.innerWidth;
    const columnWidth = 60; // 增加列间距
    const columns = Math.ceil(screenWidth / columnWidth);

    for (let i = 0; i < columns; i++) {
        const column = document.createElement('div');
        
        // 随机选择亮度级别
        const brightness = Math.random();
        let className = 'matrix-column';
        if (brightness > 0.85) {
            className += ' bright';
        } else if (brightness < 0.5) {
            className += ' dim';
        }
        
        column.className = className;
        column.style.left = `${(i / columns) * 100}%`;
        column.style.animationDelay = `${Math.random() * 15}s`;
        column.style.animationDuration = `${12 + Math.random() * 10}s`;
        
        // 生成随机长度的字符列 - 更短更柔和
        let text = '';
        const length = 8 + Math.floor(Math.random() * 12);
        for (let j = 0; j < length; j++) {
            text += chars[Math.floor(Math.random() * chars.length)] + '\n';
        }
        column.textContent = text;
        container.appendChild(column);
    }
}

// 窗口大小改变时重新初始化矩阵雨
window.addEventListener('resize', () => {
    clearTimeout(window.matrixResizeTimeout);
    window.matrixResizeTimeout = setTimeout(initMatrixRain, 300);
});
