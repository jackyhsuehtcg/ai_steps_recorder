class ResultViewer {
  constructor() {
    this.sessionData = null;
    this.isGenerating = false;
    this.progressInterval = null;
    this.init();
  }

  async init() {
    try {
      this.setupProgressListener();
      await this.loadSessionData();
      
      // Check if we need to show progress after loading session data
      this.checkAndShowProgress();
      
      this.renderSessionData();
    } catch (error) {
      console.error('Error initializing result viewer:', error);
      this.showError('Error loading recording result: ' + error.message);
    }
  }

  async loadSessionData() {
    // Get session ID from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('sessionId');
    
    if (!sessionId) {
      // If no sessionId, try to get the latest session
      const latestSession = await this.getLatestSession();
      if (latestSession) {
        this.sessionData = latestSession;
        return;
      }
      throw new Error('No session ID specified and no latest recording result found');
    }

    // 從 Chrome 存儲中獲取會話資料
    const result = await chrome.storage.local.get(sessionId);
    
    if (!result[sessionId]) {
      throw new Error('Cannot find specified recording session');
    }

    this.sessionData = result[sessionId];
  }

  async getLatestSession() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getHistory' });
      
      if (response.success && response.sessions && response.sessions.length > 0) {
        return response.sessions[0]; // Return the latest session
      }
      
      return null;
    } catch (error) {
      console.error('Error getting latest session:', error);
      return null;
    }
  }

  setupProgressListener() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'progressUpdate' && message.sessionId === this.sessionData?.id) {
        this.updateProgress(message.progress);
      }
    });
  }

  checkAndShowProgress() {
    console.log('Checking progress for session:', this.sessionData);
    
    // Check if we need to show progress (for one-time recording without code)
    if (this.sessionData && this.sessionData.mode === 'one-time' && !this.sessionData.playwrightCode) {
      console.log('Showing progress for one-time recording without code');
      this.showGenerating();
      this.startProgressPolling();
      return true;
    }
    
    return false;
  }

  startProgressPolling() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }

    this.progressInterval = setInterval(async () => {
      try {
        const progressKey = `progress_${this.sessionData.id}`;
        const result = await chrome.storage.local.get([progressKey]);
        if (result[progressKey]) {
          this.updateProgress(result[progressKey]);
        }

        // Also check for updated session data
        const sessionResult = await chrome.storage.local.get([this.sessionData.id]);
        if (sessionResult[this.sessionData.id] && sessionResult[this.sessionData.id].playwrightCode) {
          this.sessionData = sessionResult[this.sessionData.id];
          this.completeGeneration();
        }
      } catch (error) {
        console.error('Error polling progress:', error);
      }
    }, 1000);
  }

  showGenerating() {
    console.log('Showing generating progress...');
    document.getElementById('loading').style.display = 'none';
    document.getElementById('generating').style.display = 'block';
    document.getElementById('content').style.display = 'none';
    this.isGenerating = true;
  }

  updateProgress(progressData) {
    if (!this.isGenerating) return;

    const progressFill = document.getElementById('progressFill');
    const progressStage = document.getElementById('progressStage');
    const progressPercent = document.getElementById('progressPercent');
    const generateDetails = document.getElementById('generateDetails');

    if (progressFill) {
      progressFill.style.width = `${progressData.progress}%`;
    }
    if (progressStage) {
      progressStage.textContent = progressData.stage || 'Processing...';
    }
    if (progressPercent) {
      progressPercent.textContent = `${progressData.progress}%`;
    }
    if (generateDetails && progressData.details) {
      generateDetails.textContent = progressData.details;
    }

    // If progress is complete, wait a bit and then show results
    if (progressData.progress >= 100) {
      setTimeout(() => {
        this.completeGeneration();
      }, 1500);
    }
  }

  completeGeneration() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    this.isGenerating = false;
    document.getElementById('generating').style.display = 'none';
    this.renderSessionData();
  }

  renderSessionData() {
    // Don't render if we're currently generating
    if (this.isGenerating) {
      return;
    }
    
    document.getElementById('loading').style.display = 'none';
    document.getElementById('generating').style.display = 'none';
    
    if (!this.sessionData) {
      document.getElementById('emptyState').style.display = 'block';
      return;
    }

    document.getElementById('content').style.display = 'block';

    // Render session information
    this.renderSessionInfo();
    
    // Render Playwright code
    this.renderPlaywrightCode();
    
    // Render steps list
    this.renderStepsList();
  }

  renderSessionInfo() {
    const sessionInfo = this.sessionData;
    
    document.getElementById('sessionId').textContent = sessionInfo.id || 'N/A';
    document.getElementById('recordMode').textContent = this.getModeName(sessionInfo.mode);
    document.getElementById('outputFormat').textContent = this.getFormatName(sessionInfo.format);
    document.getElementById('stepsCount').textContent = sessionInfo.steps?.length || 0;
    
    if (sessionInfo.duration) {
      document.getElementById('duration').textContent = this.formatDuration(sessionInfo.duration);
    }
    
    if (sessionInfo.endTime) {
      document.getElementById('endTime').textContent = new Date(sessionInfo.endTime).toLocaleString('zh-TW');
    }
    
    // Display the LLM information
    document.getElementById('generatedUsing').textContent = this.getLLMDisplayName(sessionInfo.llmProvider, sessionInfo.llmModel);
  }

  renderPlaywrightCode() {
    const codeTextarea = document.getElementById('playwrightCode');
    
    if (this.sessionData.playwrightCode) {
      codeTextarea.value = this.sessionData.playwrightCode;
    } else {
      codeTextarea.placeholder = 'No Playwright code generated';
    }
  }

  renderStepsList() {
    const stepsContainer = document.getElementById('stepsList');
    
    if (!this.sessionData.steps || this.sessionData.steps.length === 0) {
      stepsContainer.innerHTML = '<div style="text-align: center; color: #6c757d; padding: 20px;">No recording steps</div>';
      return;
    }

    const stepsHTML = this.sessionData.steps.map((step, index) => {
      return `
        <div class="step-item">
          <div class="step-number">${index + 1}</div>
          <div class="step-details">
            <div class="step-type">${step.type}</div>
            <div class="step-description">${this.getStepDescription(step)}</div>
          </div>
        </div>
      `;
    }).join('');
    
    stepsContainer.innerHTML = stepsHTML;
  }

  getModeName(mode) {
    const modes = {
      'step-by-step': 'Step-by-Step Mode',
      'one-time': 'One-time Mode'
    };
    return modes[mode] || mode || 'Unknown';
  }

  getFormatName(format) {
    const formats = {
      'javascript': 'JavaScript',
      'python': 'Python',
      'pytest': 'Pytest'
    };
    return formats[format] || format || 'Unknown';
  }

  getLLMDisplayName(provider, model) {
    if (!provider) {
      return 'Unknown LLM';
    }

    const providerNames = {
      'lmstudio': 'LM Studio',
      'ollama': 'Ollama',
      'openai': 'OpenAI',
      'gemini': 'Google Gemini',
      'anthropic': 'Anthropic Claude'
    };

    const displayName = providerNames[provider] || provider;
    
    if (model && model !== 'lm-studio') {
      return `${displayName} (${model})`;
    }
    
    return displayName;
  }

  formatDuration(duration) {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  }

  getStepDescription(step) {
    let description = '';
    
    switch (step.type) {
      case 'click':
        description = `Click ${step.selector}`;
        if (step.text) {
          description += ` ("${step.text.substring(0, 30)}...")`;
        }
        break;
      case 'input':
      case 'change':
        description = `Input "${step.value}" in ${step.selector}`;
        break;
      case 'keydown':
        description = `Press ${step.value} key`;
        break;
      case 'navigation':
        description = `Navigate to ${step.url}`;
        break;
      case 'submit':
        description = `Submit form ${step.selector}`;
        break;
      default:
        description = `${step.type} operation`;
        if (step.selector) {
          description += ` on ${step.selector}`;
        }
    }
    
    return description;
  }

  showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    document.getElementById('error').textContent = message;
  }
}

// Global functions
async function copyCode() {
  const codeTextarea = document.getElementById('playwrightCode');
  const copyBtn = document.querySelector('.copy-btn');

  const code = codeTextarea?.value || '';
  if (!code) {
    alert('No code to copy');
    return;
  }

  const setCopied = () => {
    if (!copyBtn) return;
    const restoreTo = 'Copy Code';
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = restoreTo;
      copyBtn.classList.remove('copied');
    }, 2000);
  };

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      setCopied();
      return;
    }
    throw new Error('Clipboard API not available');
  } catch (error) {
    console.warn('Clipboard API copy failed, using fallback:', error?.message || error);
  }

  // Fallback: use temporary textarea + execCommand
  try {
    const temp = document.createElement('textarea');
    temp.value = code;
    temp.setAttribute('readonly', '');
    temp.style.position = 'fixed';
    temp.style.top = '-9999px';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(temp);
    if (ok) {
      setCopied();
    } else {
      throw new Error('execCommand copy returned false');
    }
  } catch (fallbackError) {
    console.error('Fallback copy failed:', fallbackError);
    alert('Copy failed, please manually select and copy the code');
  }
}

function downloadCode() {
  const viewer = window.resultViewer;
  if (!viewer || !viewer.sessionData) {
    alert('No code to download');
    return;
  }

  const code = viewer.sessionData.playwrightCode;
  if (!code) {
    alert('No generated code to download');
    return;
  }

  const format = viewer.sessionData.format || 'javascript';
  const extension = format === 'python' ? 'py' : 'js';
  const filename = `playwright-test-${Date.now()}.${extension}`;
  
  const blob = new Blob([code], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSession() {
  const viewer = window.resultViewer;
  if (!viewer || !viewer.sessionData) {
    alert('No session data to export');
    return;
  }

  const sessionData = JSON.stringify(viewer.sessionData, null, 2);
  const filename = `ai-steps-session-${Date.now()}.json`;
  
  const blob = new Blob([sessionData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  window.resultViewer = new ResultViewer();
  const $ = (sel) => document.querySelector(sel);

  const bind = (sel, handler) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); handler(e); });
  };

  bind('#copyCodeBtn', () => copyCode());
  bind('#downloadCodeBtn', () => downloadCode());
  bind('#exportSessionBtn', () => exportSession());
  bind('#closeViewerBtn', () => window.close());
});

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
  // Ctrl+C / Cmd+C copy code
  if ((event.ctrlKey || event.metaKey) && event.key === 'c' && event.target.id === 'playwrightCode') {
    copyCode();
    event.preventDefault();
  }
  
  // Ctrl+S / Cmd+S download code
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    downloadCode();
    event.preventDefault();
  }
  
  // Escape close window
  if (event.key === 'Escape') {
    window.close();
  }
});
