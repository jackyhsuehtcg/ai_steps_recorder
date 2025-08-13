class HistoryManager {
    constructor() {
        this.sessions = [];
        this.filteredSessions = [];
        this.currentModal = null;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadSessions();
    }

    bindEvents() {
        document.getElementById('searchInput').addEventListener('input', () => this.filterSessions());
        document.getElementById('modeFilter').addEventListener('change', () => this.filterSessions());
        document.getElementById('formatFilter').addEventListener('change', () => this.filterSessions());
        
        document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
        document.getElementById('copyCodeBtn').addEventListener('click', () => this.copyCode());
        document.getElementById('downloadCodeBtn').addEventListener('click', () => this.downloadCode());
        
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('codeModal');
            if (e.target === modal) {
                this.closeModal();
            }
        });
    }

    async loadSessions() {
        const loadingMessage = document.getElementById('loadingMessage');
        const emptyMessage = document.getElementById('emptyMessage');
        const sessionsList = document.getElementById('sessionsList');

        try {
            loadingMessage.style.display = 'block';
            
            const response = await chrome.runtime.sendMessage({ action: 'getHistory' });
            
            if (response.success) {
                this.sessions = response.sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                this.filteredSessions = [...this.sessions];
                
                if (this.sessions.length === 0) {
                    emptyMessage.style.display = 'block';
                    sessionsList.style.display = 'none';
                } else {
                    emptyMessage.style.display = 'none';
                    sessionsList.style.display = 'block';
                    this.renderSessions();
                }
            } else {
                throw new Error(response.error || 'Failed to load sessions');
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            this.showError('Error loading records');
        } finally {
            loadingMessage.style.display = 'none';
        }
    }

    renderSessions() {
        const sessionsList = document.getElementById('sessionsList');
        sessionsList.innerHTML = '';

        // Event delegation for action buttons
        if (!this._delegated) {
            sessionsList.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;
                const action = btn.dataset.action;
                const sid = btn.dataset.id;
                if (!action) return;
                e.preventDefault();
                e.stopPropagation();
                switch (action) {
                    case 'view-code':
                        return this.viewCode(sid);
                    case 'toggle-steps':
                        return this.toggleSteps(sid);
                    case 'export-json':
                        return this.exportSession(sid, 'json');
                    case 'delete':
                        return this.deleteSession(sid);
                }
            });
            this._delegated = true;
        }

        this.filteredSessions.forEach(session => {
            const sessionElement = this.createSessionElement(session);
            sessionsList.appendChild(sessionElement);
        });
    }

    createSessionElement(session) {
        const div = document.createElement('div');
        div.className = 'session-item';
        
        const createdAt = new Date(session.createdAt).toLocaleString('zh-TW');
        const stepsCount = session.steps ? session.steps.length : 0;
        const url = session.steps && session.steps.length > 0 ? session.steps[0].url : 'Unknown';
        
        div.innerHTML = `
            <div class="session-header">
                <div class="session-title">
                    <div class="session-id">${session.id}</div>
                    <div class="session-date">${createdAt}</div>
                </div>
                <div class="session-badges">
                    <span class="badge badge-mode">${session.mode === 'step-by-step' ? 'Step-by-Step' : 'One-time'}</span>
                    <span class="badge badge-format">${session.format === 'python' ? 'Python' : 'JavaScript'}</span>
                    <span class="badge badge-steps">${stepsCount} steps</span>
                    <span class="badge badge-llm">${this.getLLMBadgeText(session.llmProvider, session.llmModel)}</span>
                </div>
            </div>
            
            <div class="session-meta">
                <div class="session-url" title="${url}">${url}</div>
                <div class="session-actions">
                    <button class="btn btn-primary" data-action="view-code" data-id="${session.id}">View Code</button>
                    <button class="btn btn-secondary" data-action="toggle-steps" data-id="${session.id}">Show Steps</button>
                    <button class="btn btn-secondary" data-action="export-json" data-id="${session.id}">Export JSON</button>
                    <button class="btn btn-danger" data-action="delete" data-id="${session.id}">Delete</button>
                </div>
            </div>
            
            <div class="session-steps">
                <div class="steps-summary">Recorded ${stepsCount} operation steps</div>
                <div class="steps-preview" id="steps-${session.id}">
                    ${this.createStepsPreview(session.steps || [])}
                </div>
            </div>
        `;
        
        return div;
    }

    createStepsPreview(steps) {
        if (!steps || steps.length === 0) {
            return '<div class="step-item">No operation steps recorded</div>';
        }
        
        return steps.slice(0, 5).map(step => `
            <div class="step-item">
                <span class="step-type">${step.type}</span>
                <span class="step-selector">${step.selector}</span>
                ${step.value ? `<span class="step-value">${step.value}</span>` : ''}
            </div>
        `).join('') + (steps.length > 5 ? `<div class="step-item">... ${steps.length - 5} more steps</div>` : '');
    }

    getLLMBadgeText(provider, model) {
        if (!provider) {
            return 'Unknown LLM';
        }

        const providerNames = {
            'lmstudio': 'LM Studio',
            'ollama': 'Ollama',
            'openai': 'OpenAI',
            'gemini': 'Gemini',
            'anthropic': 'Claude'
        };

        const displayName = providerNames[provider] || provider;
        
        // For history list, show shorter names
        if (model && model !== 'lm-studio') {
            // Show abbreviated model names for space efficiency
            const shortModel = model.replace('claude-', '').replace('gpt-', '').replace('gemini-', '');
            return `${displayName} (${shortModel})`;
        }
        
        return displayName;
    }

    filterSessions() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const modeFilter = document.getElementById('modeFilter').value;
        const formatFilter = document.getElementById('formatFilter').value;

        this.filteredSessions = this.sessions.filter(session => {
            const matchesSearch = !searchTerm || 
                session.id.toLowerCase().includes(searchTerm) ||
                (session.steps && session.steps.some(step => 
                    step.url && step.url.toLowerCase().includes(searchTerm)
                ));
            
            const matchesMode = !modeFilter || session.mode === modeFilter;
            const matchesFormat = !formatFilter || session.format === formatFilter;
            
            return matchesSearch && matchesMode && matchesFormat;
        });

        this.renderSessions();
    }

    toggleSteps(sessionId) {
        const stepsElement = document.getElementById(`steps-${sessionId}`);
        const isExpanded = stepsElement.classList.contains('expanded');
        
        if (isExpanded) {
            stepsElement.classList.remove('expanded');
        } else {
            stepsElement.classList.add('expanded');
        }
    }

    async viewCode(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (!session) {
            this.showError('Recording not found');
            return;
        }

        const codeContent = document.getElementById('codeContent').querySelector('code');
        const modal = document.getElementById('codeModal');
        
        if (session.playwrightCode) {
            codeContent.textContent = session.playwrightCode;
        } else {
            codeContent.textContent = '// No Playwright code generated\n// May be due to recording errors or incomplete processing';
        }
        
        this.currentModal = session;
        modal.classList.add('show');
    }

    closeModal() {
        const modal = document.getElementById('codeModal');
        modal.classList.remove('show');
        this.currentModal = null;
    }

    async copyCode() {
        const codeContent = document.getElementById('codeContent').querySelector('code').textContent || '';
        const btn = document.getElementById('copyCodeBtn');
        const done = () => {
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; }, 1500);
        };
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(codeContent);
                done();
                return;
            }
            throw new Error('Clipboard API not available');
        } catch (err) {
            // Fallback
            try {
                const tmp = document.createElement('textarea');
                tmp.value = codeContent;
                tmp.setAttribute('readonly','');
                tmp.style.position = 'fixed'; tmp.style.top = '-9999px';
                document.body.appendChild(tmp);
                tmp.focus(); tmp.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(tmp);
                if (ok) { done(); return; }
                throw new Error('execCommand copy returned false');
            } catch (fallbackErr) {
                console.error('Copy failed:', fallbackErr);
                this.showError('Copy failed, please manually copy the code');
            }
        }
    }

    downloadCode() {
        if (!this.currentModal) return;
        
        const codeContent = document.getElementById('codeContent').querySelector('code').textContent;
        const extension = this.currentModal.format === 'python' ? 'py' : 'js';
        const filename = `playwright-${this.currentModal.id}.${extension}`;
        
        this.downloadFile(codeContent, filename, 'text/plain');
    }

    async deleteSession(sessionId) {
        if (!confirm('Are you sure you want to delete this recording? This operation cannot be undone.')) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({ 
                action: 'deleteSession', 
                sessionId 
            });
            
            if (response.success) {
                this.sessions = this.sessions.filter(s => s.id !== sessionId);
                this.filterSessions();
                this.showSuccess('Recording deleted');
            } else {
                throw new Error(response.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting session:', error);
            this.showError('Delete failed');
        }
    }

    async exportSession(sessionId, format) {
        try {
            const response = await chrome.runtime.sendMessage({ 
                action: 'exportSession', 
                sessionId,
                format 
            });
            
            if (response.success) {
                this.downloadFile(response.content, response.filename, response.mimeType);
                this.showSuccess('File downloaded');
            } else {
                throw new Error(response.error || 'Export failed');
            }
        } catch (error) {
            console.error('Error exporting session:', error);
            this.showError('Export failed');
        }
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;
        
        if (type === 'success') {
            notification.style.background = '#27ae60';
        } else if (type === 'error') {
            notification.style.background = '#e74c3c';
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

const historyManager = new HistoryManager();

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
