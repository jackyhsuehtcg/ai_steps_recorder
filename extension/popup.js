class PopupController {
  constructor() {
    this.initializeElements();
    this.bindEvents();
    this.loadSettings();
    this.updateStatus();
  }

  initializeElements() {
    this.startRecordingBtn = document.getElementById('startRecording');
    this.viewHistoryBtn = document.getElementById('viewHistory');
    this.openSettingsBtn = document.getElementById('openSettings');
    this.statusElement = document.getElementById('status');
    this.statusText = this.statusElement.querySelector('.status-text');
    this.currentProviderEl = document.getElementById('currentProvider');
    this.currentModelEl = document.getElementById('currentModel');
    
    this.recordModeRadios = document.querySelectorAll('input[name="recordMode"]');
    this.outputFormatRadios = document.querySelectorAll('input[name="outputFormat"]');
  }

  bindEvents() {
    this.startRecordingBtn.addEventListener('click', () => this.handleStartRecording());
    this.viewHistoryBtn.addEventListener('click', () => this.handleViewHistory());
    this.openSettingsBtn.addEventListener('click', () => this.handleOpenSettings());
    
    this.recordModeRadios.forEach(radio => {
      radio.addEventListener('change', () => this.saveSettings());
    });
    
    this.outputFormatRadios.forEach(radio => {
      radio.addEventListener('change', () => this.saveSettings());
    });
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get({
        recordMode: 'step-by-step',
        outputFormat: 'javascript',
        provider: 'lmstudio',
        modelName: 'lm-studio',
        apiUrl: 'http://localhost:1234/v1/chat/completions'
      });
      
      document.querySelector(`input[name="recordMode"][value="${result.recordMode}"]`).checked = true;
      const of = ['javascript','python','pytest'].includes(result.outputFormat) ? result.outputFormat : 'javascript';
      document.querySelector(`input[name="outputFormat"][value="${of}"]`).checked = true;
      
      // Update current LLM display
      this.updateCurrentLLMDisplay(result.provider, result.modelName);
    } catch (error) {
      console.error('Error loading settings:', error);
      this.currentProviderEl.textContent = 'Error loading settings';
      this.currentModelEl.textContent = '';
    }
  }

  async saveSettings() {
    const settings = {
      recordMode: document.querySelector('input[name="recordMode"]:checked').value,
      outputFormat: document.querySelector('input[name="outputFormat"]:checked').value
    };
    
    try {
      await chrome.storage.sync.set(settings);
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  async updateStatus() {
    try {
      // 首先檢查 background script 的錄製狀態
      const recordingStateResponse = await chrome.runtime.sendMessage({ action: 'getRecordingState' });
      
      if (recordingStateResponse?.success && recordingStateResponse.state?.isRecording) {
        this.setStatus('Recording...', 'recording');
        this.startRecordingBtn.textContent = 'Stop Recording';
        this.startRecordingBtn.classList.add('btn-danger');
        return;
      }
      
      // 如果 background script 沒有錄製狀態，檢查當前 tab 的 content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      
      if (!tab) {
        this.setStatus('Cannot get current page', 'error');
        return;
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
        
        if (response && response.isRecording) {
          this.setStatus('正在錄製中...', 'recording');
          this.startRecordingBtn.textContent = '停止錄製';
          this.startRecordingBtn.classList.add('btn-danger');
        } else {
          this.setStatus('Ready', 'ready');
          this.startRecordingBtn.textContent = 'Start Recording';
          this.startRecordingBtn.classList.remove('btn-danger');
        }
      } catch (error) {
        // Content script 可能尚未載入
        this.setStatus('Ready', 'ready');
        this.startRecordingBtn.textContent = 'Start Recording';
        this.startRecordingBtn.classList.remove('btn-danger');
      }
    } catch (error) {
      console.error('Error updating status:', error);
      this.setStatus('Ready', 'ready');
      this.startRecordingBtn.textContent = 'Start Recording';
      this.startRecordingBtn.classList.remove('btn-danger');
    }
  }

  setStatus(text, type = 'ready') {
    this.statusText.textContent = text;
    this.statusElement.className = `status ${type}`;
  }

  async handleStartRecording() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab) {
            this.setStatus('Cannot get current page', 'error');
            return;
        }

        await this.saveSettings();
        const settings = {
            recordMode: document.querySelector('input[name="recordMode"]:checked').value,
            outputFormat: document.querySelector('input[name="outputFormat"]:checked').value
        };

        const recordingStateResponse = await chrome.runtime.sendMessage({ action: 'getRecordingState' });

        if (recordingStateResponse?.success && recordingStateResponse.state?.isRecording) {
            // Currently recording, so stop it
            const stopResponse = await chrome.runtime.sendMessage({ action: 'stopRecording' });
            if (stopResponse?.success) {
                this.setStatus('Recording stopped', 'ready');
                this.startRecordingBtn.textContent = 'Start Recording';
                this.startRecordingBtn.classList.remove('btn-danger');
                // Notify content script to stop
                chrome.tabs.sendMessage(tab.id, { action: 'stopRecording' });
            } else {
                this.setStatus('Failed to stop recording', 'error');
            }
        } else {
            // Not recording, so start it
            const startResponse = await chrome.runtime.sendMessage({ action: 'startRecording', settings: settings, tabId: tab.id });
            if (startResponse?.success) {
                this.setStatus('Starting recording...', 'recording');
                this.startRecordingBtn.textContent = 'Stop Recording';
                this.startRecordingBtn.classList.add('btn-danger');
                // Notify content script to start
                chrome.tabs.sendMessage(tab.id, { action: 'startRecording', settings: settings });
            } else {
                this.setStatus('Failed to start recording', 'error');
            }
        }
    } catch (error) {
        console.error('Error handling recording:', error);
        this.setStatus(`Operation failed: ${error.message}`, 'error');
    }
}

  async handleViewHistory() {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
    } catch (error) {
      console.error('Error opening history:', error);
    }
  }

  async handleOpenSettings() {
    try {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    } catch (error) {
      console.error('Error opening settings:', error);
    }
  }

  updateCurrentLLMDisplay(provider, modelName) {
    const providerNames = {
      'lmstudio': 'LM Studio',
      'ollama': 'Ollama',
      'openai': 'OpenAI',
      'gemini': 'Google Gemini',
      'anthropic': 'Anthropic Claude'
    };

    const displayName = providerNames[provider] || provider;
    this.currentProviderEl.textContent = displayName;
    this.currentModelEl.textContent = modelName || 'Default model';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'statusUpdate') {
    const popup = window.popupController;
    if (popup) {
      popup.setStatus(request.status, request.type);
    }
  }
});
