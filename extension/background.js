class BackgroundService {
  constructor() {
    this.recordingState = {
      isRecording: false,
      sessionId: null,
      settings: null,
      steps: [],
      tabId: null,
      accumulatedCode: null
    };
    this.pendingRestore = false;
    this.restoreAttempts = new Map();
    this.stepQueue = [];
    this.isProcessingQueue = false;
    this.arrivalSeq = 0;
    this.init();
  }

  init() {
    this.setupInstallListener();
    this.setupTabUpdateListener();
    this.setupMessageListener();
    this.setupStorageListener();
    this.setupTabListener();
  }

  setupInstallListener() {
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install') {
        this.setDefaultSettings();
      }
    });
  }

  async setDefaultSettings() {
    const defaultSettings = {
      recordMode: 'step-by-step',
      outputFormat: 'javascript',
      autoSave: true,
      maxSteps: 100,
      // New AI settings format
      provider: 'lmstudio',
      apiUrl: 'http://localhost:1234/v1/chat/completions',
      modelName: 'lm-studio',
      apiKey: '',
      temperature: 0.1,
      maxTokens: 2000
    };

    try {
      await chrome.storage.sync.set(defaultSettings);
    } catch (error) {
      console.error('Error saving default settings:', error);
    }
  }

  setupTabUpdateListener() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'loading' && this.recordingState.isRecording && this.recordingState.tabId === tabId) {
        this.pendingRestore = true;
      }
      
      if (changeInfo.status === 'complete' && tab.url) {
        if (this.recordingState.isRecording && this.recordingState.tabId === tabId) {
          setTimeout(() => this.restoreRecordingInTab(tabId), 1000);
        }
      }
    });
  }

  async ensureContentScriptReady(tabId, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'ensureRecorderReady' });
        if (response && response.ready) {
          return true;
        }
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
      }
    }
    
    console.warn('Content script not ready after retries for tab:', tabId);
    return false;
  }

  async restoreRecordingInTab(tabId) {
    const attempts = this.restoreAttempts.get(tabId) || 0;
    this.restoreAttempts.set(tabId, attempts + 1);
    
    if (attempts >= 5) {
      console.error(`Too many restore attempts for tab ${tabId}, giving up`);
      return false;
    }
    
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || tab.status !== 'complete') {
        setTimeout(() => this.restoreRecordingInTab(tabId), 2000);
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const isReady = await this.verifyScriptReady(tabId);
      if (!isReady) {
        console.error('Scripts not ready after injection');
        setTimeout(() => this.restoreRecordingInTab(tabId), 3000);
        return false;
      }
      
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Restore message timeout'));
        }, 15000);
        
        chrome.tabs.sendMessage(tabId, {
          action: 'restoreRecordingState',
          state: this.recordingState
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (response && response.success) {
        this.restoreAttempts.delete(tabId);
        this.pendingRestore = false;
        return true;
      } else {
        throw new Error('Restore returned unsuccessful response');
      }
      
    } catch (error) {
      console.error(`Restore attempt ${attempts + 1} failed:`, error.message);
      
      if (attempts < 4) {
        const delay = (attempts + 1) * 2000;
        setTimeout(() => this.restoreRecordingInTab(tabId), delay);
      } else {
        this.restoreAttempts.delete(tabId);
        this.pendingRestore = false;
        
        try {
          chrome.tabs.sendMessage(tabId, {
            action: 'showRestoreFailedNotification'
          });
        } catch (e) {
          console.error('Failed to send notification:', e);
        }
      }
      
      return false;
    }
  }
  
  async forceInjectScripts(tabId) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ['content.css']
      }).catch(e => console.warn('CSS injection warning:', e.message));
      
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-injector.js']
      });
      
    } catch (error) {
      console.error('Script injection failed:', error);
      throw error;
    }
  }
  
  async verifyScriptReady(tabId, maxAttempts = 5) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Verification timeout'));
          }, 3000);
          
          chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
        
        if (response && response.status === 'ok') {
          return true;
        }
      } catch (error) {
        if (i < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    
    console.error('Script verification failed after all attempts');
    return false;
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      switch (request.action) {
        case 'startRecording':
          {
            const tabId = request.tabId ?? sender.tab?.id ?? null;
            this.startRecording(request.settings, tabId).then(sendResponse);
          }
          return true;

        case 'stopRecording':
          this.stopRecording().then(sendResponse);
          return true;

        case 'getRecordingState':
          sendResponse({
            success: true,
            state: this.recordingState
          });
          break;

        case 'addStep':
          this.addStep(request.step, sender.tab.id);
          sendResponse({ success: true });
          break;

        case 'generatePlaywrightCode':
          this.handleGeneratePlaywrightCode(request).then(response => {
            sendResponse(response);
          }).catch(error => {
            console.error('Background error:', error);
            sendResponse({ success: false, error: error.message });
          });
          return true;

        case 'saveSession':
          this.saveSession(request.data).then(sendResponse);
          return true;

        case 'getHistory':
          this.getHistory().then(sendResponse);
          return true;

        case 'deleteSession':
          this.deleteSession(request.sessionId).then(sendResponse);
          return true;

        case 'exportSession':
          this.exportSession(request.sessionId, request.format).then(sendResponse);
          return true;

        case 'updateAccumulatedCode':
          this.updateAccumulatedCode(request.sessionId, request.code);
          sendResponse({ success: true });
          break;

        case 'ping':
          sendResponse({ status: 'ok', timestamp: Date.now() });
          break;

        default:
          sendResponse({ error: 'Unknown action' });
      }
    });
  }

  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
    });
  }

  setupTabListener() {
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      if (this.recordingState.isRecording && this.recordingState.tabId === tabId) {
        this.stopRecording();
      }
    });
  }

  async startRecording(settings, tabId) {
    try {
      // Hard reset any stale state before starting
      if (this.recordingState.isRecording) {
        console.warn('Stale recording detected. Forcing reset.');
        this.recordingState.isRecording = false;
        this.stepQueue = [];
        this.isProcessingQueue = false;
        this.arrivalSeq = 0;
      }

      this.recordingState = {
        isRecording: true,
        sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        settings: settings,
        steps: [],
        tabId: tabId,
        startTime: Date.now(),
        accumulatedCode: null
      };

      return { success: true, sessionId: this.recordingState.sessionId };
    } catch (error) {
      console.error('Error starting recording:', error);
      return { success: false, error: error.message };
    }
  }

  async stopRecording() {
    try {
      if (!this.recordingState.isRecording) {
        return { success: false, error: 'Not recording' };
      }

      // Get current LLM settings
      const llmSettings = await chrome.storage.sync.get(['provider', 'modelName']);
      
      const sessionData = {
        id: this.recordingState.sessionId,
        mode: this.recordingState.settings.recordMode,
        format: this.recordingState.settings.outputFormat,
        steps: this.recordingState.steps,
        startTime: this.recordingState.startTime,
        endTime: Date.now(),
        duration: Date.now() - this.recordingState.startTime,
        playwrightCode: this.recordingState.accumulatedCode || null,
        llmProvider: llmSettings.provider || 'lmstudio',
        llmModel: llmSettings.modelName || 'lm-studio'
      };

      // Save session first
      await this.saveSession(sessionData);

      if (this.recordingState.settings.recordMode === 'one-time' && this.recordingState.steps.length > 0) {
        // Open result viewer before processing for one-time mode
        await this.writeToTempFileAndOpenViewer(sessionData);
        
        sessionData.settings = this.recordingState.settings;
        await this.processBatch(sessionData);
        
        // Update the saved session with the generated code
        await this.saveSession(sessionData);
      } else if (this.recordingState.settings.recordMode === 'step-by-step' && this.recordingState.accumulatedCode) {
        sessionData.playwrightCode = this.recordingState.accumulatedCode;
        await this.saveSession(sessionData);
        await this.writeToTempFileAndOpenViewer(sessionData);
      }

      // Broadcast force reset to top frame to clear UI/state robustly
      try {
        if (this.recordingState.tabId != null) {
          await chrome.tabs.sendMessage(this.recordingState.tabId, { action: 'forceResetRecording' }, { frameId: 0 });
        }
      } catch (e) {
        console.warn('Failed to notify content to reset:', e?.message || e);
      }

      this.recordingState = {
        isRecording: false,
        sessionId: null,
        settings: null,
        steps: [],
        tabId: null,
        accumulatedCode: null
      };
      this.stepQueue = [];
      this.isProcessingQueue = false;
      this.arrivalSeq = 0;

      return { success: true, sessionId: sessionData.id };
    } catch (error) {
      console.error('Error stopping recording:', error);
      return { success: false, error: error.message };
    }
  }

  async writeToTempFileAndOpenViewer(sessionData) {
    try {
      const tempSessionKey = `temp_session_${Date.now()}`;
      await chrome.storage.local.set({
        [tempSessionKey]: sessionData,
        'latest_temp_session': tempSessionKey
      });

      const resultUrl = chrome.runtime.getURL(`result-viewer.html?sessionId=${sessionData.id}&temp=${tempSessionKey}`);
      
      await chrome.tabs.create({
        url: resultUrl,
        active: true
      });

      if (sessionData.playwrightCode) {
        await this.createDownloadableFile(sessionData);
      }

    } catch (error) {
      console.error('Error writing to temp file or opening viewer:', error);
      throw error;
    }
  }

  async createDownloadableFile(sessionData) {
    try {
      const format = sessionData.format || 'javascript';
      const extension = format === 'python' ? 'py' : 'js';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `playwright-test-${timestamp}.${extension}`;
      
      let fileContent = '';
      
      const header = ``;
      
      if (format === 'python') {
        fileContent = header.replace(/\/\//g, '#') + (sessionData.playwrightCode || '');
      } else {
        fileContent = header + (sessionData.playwrightCode || '');
      }

      const fileInfo = {
        filename: filename,
        content: fileContent,
        mimeType: 'text/plain',
        sessionId: sessionData.id,
        timestamp: Date.now()
      };

      await chrome.storage.local.set({
        [`downloadable_${sessionData.id}`]: fileInfo
      });

    } catch (error) {
      console.error('Error creating downloadable file:', error);
    }
  }

  addStep(step, tabId) {
    if (!this.recordingState.isRecording || this.recordingState.tabId !== tabId) {
      return;
    }

    const stepWithIndex = {
      ...step,
      stepIndex: this.recordingState.steps.length,
      canonicalTs: Date.now(),
      arrivalSeq: this.arrivalSeq++
    };
    this.recordingState.steps.push(stepWithIndex);

    try {
      // Update the visible counter in the top frame only
      chrome.tabs.sendMessage(this.recordingState.tabId, {
        action: 'updateStepCounter',
        count: this.recordingState.steps.length
      }, { frameId: 0 });
    } catch (e) {
      // ignore counter update errors
    }

    if (this.recordingState.settings.recordMode === 'step-by-step') {
      this.enqueueStep(stepWithIndex);
    }
  }

  enqueueStep(step) {
    this.stepQueue.push(step);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    if (!this.recordingState.isRecording) { this.stepQueue = []; return; }
    if (this.recordingState.settings.recordMode !== 'step-by-step') { this.stepQueue = []; return; }

    this.isProcessingQueue = true;
    try {
      while (this.stepQueue.length > 0 && this.recordingState.isRecording) {
        const nextStep = this.stepQueue.shift();
        if (!nextStep) break;
        try {
          const isFirstPlaywrightStep = !this.recordingState.accumulatedCode;
          const code = await this.generatePlaywrightCodeSingle(
            [nextStep],
            this.recordingState.settings.outputFormat,
            this.recordingState.settings.llmServer,
            isFirstPlaywrightStep
          );
          this.accumulateCodeInBackground(code, isFirstPlaywrightStep);
          try {
            await chrome.tabs.sendMessage(this.recordingState.tabId, {
              action: 'showCodeGenerated',
              code: code,
              isFirstStep: isFirstPlaywrightStep,
              stepCount: this.recordingState.steps.length
            });
          } catch (_) {}
        } catch (error) {
          console.error('Queue step generation error:', error);
          try {
            await chrome.tabs.sendMessage(this.recordingState.tabId, {
              action: 'showError',
              message: `LLM Error: ${error.message}`
            });
          } catch (_) {}
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }


  accumulateCodeInBackground(newCode, isFirstStep) {
    if (isFirstStep) {
      this.recordingState.accumulatedCode = newCode;
      return;
    }

    if (!this.recordingState.accumulatedCode) {
      console.warn('Background: No base framework to accumulate code into. Awaiting framework generation.');
      return;
    }

    const language = this.recordingState.settings.outputFormat;
    const accumulated = this.recordingState.accumulatedCode;
    let insertPoint;

    if (language === 'python') {
      insertPoint = accumulated.lastIndexOf('        await browser.close()');
      if (insertPoint === -1) insertPoint = accumulated.lastIndexOf('await browser.close()');
    } else if (language === 'pytest') {
      // For pytest, append new steps at the end of the test function to keep chronological order
      // This avoids re-inserting at the header which would reverse step order.
      insertPoint = accumulated.length;
    } else {
      insertPoint = accumulated.lastIndexOf('  await browser.close();');
      if (insertPoint === -1) insertPoint = accumulated.lastIndexOf('await browser.close();');
    }

    if (insertPoint !== -1) {
      const indent = language === 'python' ? '        ' : language === 'pytest' ? '    ' : '  ';
      const beforeClose = accumulated.substring(0, insertPoint);
      const afterClose = accumulated.substring(insertPoint);
      
      const newCodeLines = newCode.trim().split('\n');
      const indentedCode = newCodeLines.map(line => line.trim() ? indent + line.trim() : '').filter(Boolean).join('\n');
      
      this.recordingState.accumulatedCode = `${beforeClose}${indentedCode}\n${afterClose}`;
    } else {
      console.warn('Background: Could not find insertion point. Appending code at the end.');
      this.recordingState.accumulatedCode += `\n${newCode}`;
    }
  }

  async processSingleStep(step) {
    try {
      if (!this.recordingState.isRecording) return;

      const isFirstPlaywrightStep = this.recordingState.steps.length === 1 || !this.recordingState.accumulatedCode;

      const code = await this.generatePlaywrightCodeSingle(
        [step],
        this.recordingState.settings.outputFormat,
        this.recordingState.settings.llmServer,
        isFirstPlaywrightStep
      );

      this.accumulateCodeInBackground(code, isFirstPlaywrightStep);

      try {
        await chrome.tabs.sendMessage(this.recordingState.tabId, {
          action: 'showCodeGenerated',
          code: code,
          isFirstStep: isFirstPlaywrightStep,
          stepCount: this.recordingState.steps.length
        });
      } catch (e) {
      }

    } catch (error) {
      console.error('Error processing single step in background:', error);
      try {
        await chrome.tabs.sendMessage(this.recordingState.tabId, {
          action: 'showError',
          message: `LLM Error: ${error.message}`
        });
      } catch (e) {
      }
    }
  }

  updateAccumulatedCode(sessionId, code) {
    if (!this.recordingState.isRecording || this.recordingState.sessionId !== sessionId) {
      console.warn('Attempted to update accumulated code for inactive or different session');
      return;
    }

    this.recordingState.accumulatedCode = code;
  }

  async handleGeneratePlaywrightCode(request) {
    try {
      
      const code = await this.generatePlaywrightCodeBatch(
        request.steps,
        request.outputFormat,
        { llmServer: request.llmServer }
      );
      
      return {
        success: true,
        code: code
      };
      
    } catch (error) {
      console.error('Background Playwright generation failed:', error);
      const fallbackCode = this.generateFallbackCodeBatch(request.steps, request.outputFormat);
      return {
        success: true,
        code: fallbackCode,
        usedFallback: true,
        error: error.message
      };
    }
  }

  async generatePlaywrightCodeSingle(steps, outputFormat, llmServer, isFirstStep) {
    const isPytest = outputFormat === 'pytest';
    const language = outputFormat === 'python' || isPytest ? 'Python' : 'JavaScript';
    const step = steps[0];
    
    let prompt;
    const stepPayload = {
      type: step.type,
      tagName: step.tagName,
      url: step.url,
      value: step.value,
      text: step.text,
      label: step.label,
      attributes: step.attributes || {},
      inIframe: step.inIframe || false
    };
    
    if (isFirstStep) {
      const heading = isPytest
        ? `Generate a complete ${language} Playwright (pytest) test function using the sync API with a 'page' fixture.`
        : `Generate a complete ${language} Playwright code framework for the first recorded action.`;
      prompt = `${heading}

Action (JSON):\n${JSON.stringify(stepPayload, null, 2)}

Rules:
1. Use Playwright locator best practices, prefer in order: getByRole(name), getByLabel, getByPlaceholder, getByTestId, getByText.
2. If none of the above apply, use an XPath selector (prefix with xpath=). Only as a last resort, use a CSS selector. Never use nth-child unless absolutely necessary.
3. Use async/await API with proper waits (waitForLoadState where needed).
4. Return only runnable ${language} code, with NO comments or explanations.
5. If the action is inside an iframe (inIframe=true), use frameLocator('iframe[src*="<host>"]') or its Python equivalent to scope operations to that frame.

${isPytest ? `from playwright.sync_api import Page, expect

def test_ai_steps_recorder(page: Page):
    pass` : language === 'Python' ? `import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())` : `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  await browser.close();
})();`}
Generate the complete runnable code integrating the action using locator best practices.`;
    } else {
      const lineHeading = isPytest
        ? `Generate a single line of Python Playwright (pytest, sync API) code using the 'page' fixture`
        : `Generate a single line of ${language} Playwright code for this action using best-practice locators.`;
      prompt = `${lineHeading}.

Action (JSON):\n${JSON.stringify(stepPayload, null, 2)}

Rules:
1. Prefer: getByRole(name), getByLabel, getByPlaceholder, getByTestId, getByText.
2. If those are not applicable, use an XPath selector (xpath=...). Only if XPath is not possible, use CSS. Never use nth-child.
3. Return only ONE line of code with NO comments.`}

    const storedSettings = await chrome.storage.sync.get(['provider', 'apiUrl', 'modelName', 'apiKey', 'temperature', 'maxTokens']);
    const provider = storedSettings.provider || 'lmstudio';
    const apiUrl = storedSettings.apiUrl || 'http://localhost:1234/v1/chat/completions';
    const modelName = storedSettings.modelName || 'lm-studio';
    const apiKey = storedSettings.apiKey || '';
    const temperature = storedSettings.temperature || 0.1;

    // Only require API key for cloud providers
    const requiresKey = ['openai', 'gemini', 'anthropic'].includes(provider);
    if (requiresKey && !apiKey) {
      throw new Error(`API Key for ${provider} is not set. Please configure it in the extension settings.`);
    }

    let headers = { 'Content-Type': 'application/json' };
    let requestBody;

    switch (provider) {
      case 'openai':
      case 'lmstudio':
      case 'ollama':
        if (provider === 'openai' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider !== 'openai' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        requestBody = {
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: temperature,
          max_tokens: isFirstStep ? 1000 : 150,
          stream: false
        };
        break;
      case 'gemini':
        if (apiKey) {
          apiUrl = apiUrl.includes('?') ? `${apiUrl}&key=${apiKey}` : `${apiUrl}?key=${apiKey}`;
        }
        requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: isFirstStep ? 1000 : 150,
          },
        };
        break;
      case 'anthropic':
        if (apiKey) {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
        }
        requestBody = {
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: isFirstStep ? 1000 : 150,
          temperature: temperature,
        };
        break;
      default:
        throw new Error('Unsupported AI provider selected.');
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Could not read error text');
      throw new Error(`${provider} API request failed (${response.status}): ${errorText}`);
    }

    const raw = await this.readLLMContent(response, provider);
    return this.sanitizeGeneratedCode(raw, language);
  }

  async processBatch(sessionData) {
    try {
      // Send initial progress
      await this.notifyProgress(sessionData.id, {
        stage: 'Initializing',
        progress: 0,
        details: 'Preparing to generate Playwright code...'
      });

      const playwrightCode = await this.generatePlaywrightCodeBatch(
        sessionData.steps, 
        sessionData.format,
        sessionData.id
      );
      sessionData.playwrightCode = playwrightCode;

      // Send completion progress
      await this.notifyProgress(sessionData.id, {
        stage: 'Completed',
        progress: 100,
        details: 'Playwright code generation completed successfully!'
      });

    } catch (error) {
      console.error('Error in batch processing:', error);
      sessionData.processingError = error.message;
      
      // Send error progress
      await this.notifyProgress(sessionData.id, {
        stage: 'Error',
        progress: 100,
        details: 'Generation failed, using fallback code'
      });

      sessionData.playwrightCode = this.generateFallbackCodeBatch(sessionData.steps, sessionData.format);
    }
  }

  async generatePlaywrightCodeBatch(steps, format, sessionId = null) {
    const isPytest = format === 'pytest';
    const language = format === 'python' || isPytest ? 'Python' : 'JavaScript';

    // Progress: 10% - Analyzing steps
    if (sessionId) {
      await this.notifyProgress(sessionId, {
        stage: 'Analyzing',
        progress: 10,
        details: `Analyzing ${steps.length} recorded steps...`
      });
    }
    
    const richSteps = steps.map(step => ({
      type: step.type,
      tagName: step.tagName,
      url: step.url,
      value: step.value,
      text: step.text,
      label: step.label,
      attributes: step.attributes || {},
      inIframe: step.inIframe || false,
      timestamp: step.timestamp
    }));
    const mainUrl = (steps.find(s => s.type === 'navigation')?.value) || (steps[0]?.url) || '';

    const heading = isPytest
      ? `基於以下步驟，生成可用於 pytest 的 Python Playwright 測試（sync API，使用 page fixture），並使用最佳化定位語法：`
      : `基於以下網頁操作步驟（含元素屬性與可存取名稱），生成 ${language} Playwright 代碼，使用最佳化定位語法：`;
    const prompt = `${heading}

步驟（JSON）：\n${JSON.stringify(richSteps, null, 2)}

主頁面 URL：${mainUrl}

定位規則（重要，必須遵守）：
1. 依序偏好使用 locator：getByRole({ name }), getByLabel, getByPlaceholder, getByTestId, getByText。
2. 若上述皆不適用，改用 XPath 選擇器（以 xpath= 前綴）；只有在無法組出 XPath 時，才使用 CSS。禁止使用 nth-child（除非絕對必要）。
3. 使用現代 Playwright 語法（async/await）。
4. 第一個 URL 使用 page.goto() 並在必要時 waitForLoadState。
5. 僅回傳完整可執行代碼，不要任何解釋或註解。
6. 當步驟 inIframe=true（且步驟的 url 與主頁面不同）時，請使用 frameLocator('iframe[src*="<host>"]')（或 Python 等價 API）限定在該 iframe 內操作；<host> 請以該步驟 url 的網域關鍵字組成。

    請嚴格按照以下骨架回應：

    ${language === 'Python' ? isPytest ? `from playwright.sync_api import Page, expect

def test_ai_steps_recorder(page: Page):
    pass` : `import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())` : `
    const { chromium } = require('playwright');

    (async () => {
      const browser = await chromium.launch({ headless: false });
      const page = await browser.newPage();
      
      await browser.close();
    })();
    `}

要求：
1. 使用現代 Playwright 語法
2. 第一個 URL 使用 page.goto()
3. 添加適當的等待 (waitForLoadState)
4. 處理不同元素類型
5. 只返回代碼，不要解釋
6. 絕對不要在程式碼中包含任何註解

生成完整可執行的 ${language} 代碼：`;
    
    // Progress: 30% - Loading AI settings
    if (sessionId) {
      await this.notifyProgress(sessionId, {
        stage: 'Connecting',
        progress: 30,
        details: 'Loading AI model settings...'
      });
    }

    const storedSettings = await chrome.storage.sync.get(['provider', 'apiUrl', 'modelName', 'apiKey', 'temperature', 'maxTokens']);
    const provider = storedSettings.provider || 'lmstudio';
    const apiUrl = storedSettings.apiUrl || 'http://localhost:1234/v1/chat/completions';
    const modelName = storedSettings.modelName || 'lm-studio';
    const apiKey = storedSettings.apiKey || '';
    const temperature = storedSettings.temperature || 0.1;

    // Only require API key for cloud providers
    const requiresKey = ['openai', 'gemini', 'anthropic'].includes(provider);
    if (requiresKey && !apiKey) {
      throw new Error(`API Key for ${provider} is not set. Please configure it in the extension settings.`);
    }

    let headers = { 'Content-Type': 'application/json' };
    let requestBody;
    let finalApiUrl = apiUrl;

    switch (provider) {
      case 'openai':
      case 'lmstudio':
      case 'ollama':
        if (provider === 'openai' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        } else if (provider !== 'openai' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        requestBody = {
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: temperature,
          max_tokens: 2000,
          stream: false
        };
        break;
      case 'gemini':
        if (apiKey) {
          finalApiUrl = apiUrl.includes('?') ? `${apiUrl}&key=${apiKey}` : `${apiUrl}?key=${apiKey}`;
        }
        requestBody = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: 2000,
          },
        };
        break;
      case 'anthropic':
        if (apiKey) {
          headers['x-api-key'] = apiKey;
          headers['anthropic-version'] = '2023-06-01';
          headers['anthropic-dangerous-direct-browser-access'] = 'true';
        }
        requestBody = {
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2000,
          temperature: temperature,
        };
        break;
      default:
        throw new Error('Unsupported AI provider selected.');
    }

    if (!requestBody.messages || !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      throw new Error('Invalid messages array in background');
    }

    // Progress: 50% - Sending request to AI
    if (sessionId) {
      await this.notifyProgress(sessionId, {
        stage: 'Generating',
        progress: 50,
        details: `Sending request to ${provider}...`
      });
    }

    const response = await fetch(finalApiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    // Progress: 80% - Processing AI response
    if (sessionId) {
      await this.notifyProgress(sessionId, {
        stage: 'Processing',
        progress: 80,
        details: 'Processing AI response...'
      });
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '無法讀取錯誤');
      console.error('=== BACKGROUND LLM ERROR ===');
      console.error('Status:', response.status);
      console.error('Error text:', errorText);
      throw new Error(`${provider} 連接失敗 (${response.status}): ${errorText}`);
    }

    const raw = await this.readLLMContent(response, provider);
    return this.sanitizeGeneratedCode(raw, language);
  }

  async readLLMContent(response, provider) {
    try {
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      // Prefer JSON parse path first
      if (contentType.includes('application/json')) {
        const data = await response.json();
        const content = this.extractContentFromLLMJson(data, provider);
        if (content) return content.trim();
        throw new Error('JSON response missing content');
      }
      // If text/event-stream or unknown, try robust parsing
      const text = await response.text();
      // Try JSON straight from text
      try {
        const data = JSON.parse(text);
        const content = this.extractContentFromLLMJson(data, provider);
        if (content) return content.trim();
      } catch (_) {}
      // Try to parse SSE stream lines
      const content = this.extractContentFromSSE(text, provider);
      if (content) return content.trim();
      // As a last resort, return the raw text
      return text.trim();
    } catch (e) {
      // Last ditch fallback: attempt reader-based incremental read
      try {
        const reader = response.body?.getReader?.();
        if (!reader) throw e;
        const decoder = new TextDecoder();
        let full = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
        }
        full += decoder.decode();
        const content = this.extractContentFromSSE(full, provider) || this.tryJsonText(full, provider) || full;
        return content.trim();
      } catch (_) {
        throw e;
      }
    }
  }

  tryJsonText(text, provider) {
    try {
      const data = JSON.parse(text);
      return this.extractContentFromLLMJson(data, provider) || '';
    } catch (_) { return ''; }
  }

  extractContentFromLLMJson(data, provider) {
    try {
      switch (provider) {
        case 'openai':
        case 'lmstudio':
        case 'ollama':
          if (Array.isArray(data.choices) && data.choices.length > 0) {
            const c0 = data.choices[0];
            if (c0.message && typeof c0.message.content === 'string') return c0.message.content;
            if (typeof c0.text === 'string') return c0.text;
            if (c0.delta && typeof c0.delta.content === 'string') return c0.delta.content;
          }
          break;
        case 'gemini':
          if (Array.isArray(data.candidates) && data.candidates.length > 0) {
            const c0 = data.candidates[0];
            if (c0.content && Array.isArray(c0.content.parts) && c0.content.parts.length > 0) {
              if (typeof c0.content.parts[0].text === 'string') return c0.content.parts[0].text;
            }
          }
          break;
        case 'anthropic':
          if (Array.isArray(data.content) && data.content.length > 0) {
            if (typeof data.content[0].text === 'string') return data.content[0].text;
          }
          break;
      }
    } catch (_) {}
    return '';
  }

  extractContentFromSSE(text, provider) {
    const lines = text.split(/\r?\n/);
    let acc = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') break;
      try {
        const obj = JSON.parse(payload);
        switch (provider) {
          case 'openai':
        case 'lmstudio':
        case 'ollama':
            if (Array.isArray(obj.choices)) {
              for (const ch of obj.choices) {
                if (ch.delta && typeof ch.delta.content === 'string') acc += ch.delta.content;
                else if (ch.message && typeof ch.message.content === 'string') acc += ch.message.content;
                else if (typeof ch.text === 'string') acc += ch.text;
              }
            }
            break;
          case 'gemini':
            if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
              const c0 = obj.candidates[0];
              if (c0.content && Array.isArray(c0.content.parts) && c0.content.parts.length > 0) {
                if (typeof c0.content.parts[0].text === 'string') acc += c0.content.parts[0].text;
              }
            }
            break;
          case 'anthropic':
            if (obj.type === 'content_block_delta' && typeof obj.delta.text === 'string') {
              acc += obj.delta.text;
            } else if (obj.type === 'content_block_start' && typeof obj.content_block.text === 'string') {
              acc += obj.content_block.text;
            }
            break;
        }
      } catch (_) {
        // Non-JSON event lines are ignored
      }
    }
    return acc;
  }

  generateFallbackCodeBatch(steps, format) {
    const language = format;
    let code = '';
    if (language === 'python') {
      code = `import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
`;
    } else if (language === 'pytest') {
      code = `from playwright.sync_api import Page, expect

def test_ai_steps_recorder(page: Page):
`;
    } else {
      code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
`;
    }
    const firstStep = steps.find(s => s.url);
    if (firstStep) {
      if (language === 'python') {
        code += `        await page.goto("${firstStep.url}")
        await page.wait_for_load_state("networkidle")
        
`;
      } else if (language === 'pytest') {
        code += `    page.goto('${firstStep.url}')
    page.wait_for_load_state('networkidle')

`;
      } else {
        code += `  await page.goto('${firstStep.url}');
  await page.waitForLoadState('networkidle');
  
`;
      }
    }
    steps.forEach((step) => {
      const indent = language === 'python' ? '        ' : language === 'pytest' ? '    ' : '  ';
      const q = (s) => (language === 'python' || language === 'pytest' ? `"${s}"` : `'${s}'`);
      const txt = (s) => (s || '').toString().trim();
      const attrs = step.attributes || {};
      const label = txt(step.label) || txt(attrs['aria-label']) || '';
      const placeholder = txt(attrs['placeholder']) || '';
      const testId = txt(attrs['data-testid'] || attrs['data-test-id'] || attrs['data-test'] || attrs['data-qa']) || '';
      const text = txt(step.text) || '';
      const roleAttr = txt(attrs['role']) || '';
      const tag = (step.tagName || '').toLowerCase();
      const type = txt(attrs['type']) || '';

      const buildLocator = () => {
        if (step.type === 'navigation') return null;
        // Best-practice Playwright locators
        if (testId) return (language === 'python' || language === 'pytest') ? `page.get_by_test_id(${q(testId)})` : `page.getByTestId(${q(testId)})`;
        if (['input', 'textarea', 'select'].includes(tag)) {
          if (label) return (language === 'python' || language === 'pytest') ? `page.get_by_label(${q(label)})` : `page.getByLabel(${q(label)})`;
          if (placeholder) return (language === 'python' || language === 'pytest') ? `page.get_by_placeholder(${q(placeholder)})` : `page.getByPlaceholder(${q(placeholder)})`;
        }
        const name = label || text;
        if (['button'].includes(tag) || (tag === 'input' && ['button','submit','reset'].includes(type))) {
          if (name) return (language === 'python' || language === 'pytest') ? `page.get_by_role("button", name=${q(name)})` : `page.getByRole('button', { name: ${q(name)} })`;
        }
        if (tag === 'a') {
          if (name) return (language === 'python' || language === 'pytest') ? `page.get_by_role("link", name=${q(name)})` : `page.getByRole('link', { name: ${q(name)} })`;
        }
        if (roleAttr && name) {
          return (language === 'python' || language === 'pytest') ? `page.get_by_role(${q(roleAttr)}, name=${q(name)})` : `page.getByRole(${q(roleAttr)}, { name: ${q(name)} })`;
        }
        if (text) return (language === 'python' || language === 'pytest') ? `page.get_by_text(${q(text)})` : `page.getByText(${q(text)})`;

        // XPath fallback (if no specialized locator available)
        const idAttr = txt(attrs['id']) || '';
        const nameAttr = txt(attrs['name']) || '';
        const cls = txt(attrs['class']) || '';
        const classConds = cls ? cls.split(/\s+/).filter(Boolean).slice(0,2).map(c => `contains(@class,'${c}')`) : [];
        let conds = [];
        if (idAttr) conds.push(`@id='${idAttr}'`);
        if (nameAttr) conds.push(`@name='${nameAttr}'`);
        if (type) conds.push(`@type='${type}'`);
        if (placeholder) conds.push(`@placeholder='${placeholder}'`);
        conds = conds.concat(classConds);
        let xTag = tag || '*';
        let xpath = `//${xTag}${conds.length?`[${conds.join(' and ')}]`:''}`;
        if (!conds.length && text) xpath = `//${xTag}[normalize-space(.)='${text}']`;
        if (xpath) return `page.locator(${q('xpath=' + xpath)})`;

        // CSS last resort
        const sel = (step.selector || '').replace(/"/g, '\\"').replace(/'/g, "\\'");
        return `page.locator(${q(sel)})`;
      };

      const locator = buildLocator();
      switch (step.type) {
        case 'click': {
          if (!locator) break;
          const line = language === 'python' ? `await ${locator}.click()` : language === 'pytest' ? `${locator}.click()` : `await ${locator}.click();`;
          code += `${indent}${line}\n`;
          break;
        }
        case 'input':
        case 'change': {
          if (!step.value) break;
          const value = (step.value || '').toString();
          if (tag === 'select') {
            const line = language === 'python' ? `await ${locator}.select_option(${q(value)})` : language === 'pytest' ? `${locator}.select_option(${q(value)})` : `await ${locator}.selectOption(${q(value)});`;
            code += `${indent}${line}\n`;
          } else {
            const line = language === 'python' ? `await ${locator}.fill(${q(value)})` : language === 'pytest' ? `${locator}.fill(${q(value)})` : `await ${locator}.fill(${q(value)});`;
            code += `${indent}${line}\n`;
          }
          break;
        }
        case 'keydown': {
          if (step.value === 'Enter' && locator) {
            const line = language === 'python' ? `await ${locator}.press("Enter")` : language === 'pytest' ? `${locator}.press("Enter")` : `await ${locator}.press('Enter');`;
            code += `${indent}${line}\n`;
          }
          break;
        }
        case 'navigation': {
          if (step.value && step.value !== firstStep?.url) {
            if (language === 'python') {
              code += `${indent}await page.goto(${q(step.value)})\n`;
              code += `${indent}await page.wait_for_load_state("networkidle")\n`;
            } else if (language === 'pytest') {
              code += `${indent}page.goto(${q(step.value)})\n`;
              code += `${indent}page.wait_for_load_state('networkidle')\n`;
            } else {
              code += `${indent}await page.goto(${q(step.value)});\n`;
              code += `${indent}await page.waitForLoadState('networkidle');\n`;
            }
          }
          break;
        }
      }
    });

    if (language === 'python') {
      code += `        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())`;
    } else if (language === 'pytest') {
      // no trailer needed for pytest
      code += ``;
    } else {
      code += `
  await browser.close();
})();`;
    }
    return code;
  }

  sanitizeGeneratedCode(content, language) {
    try {
      let code = content;
      // Remove Markdown code fences and language hints
      code = code.replace(/```[a-zA-Z0-9_-]*\n?/g, '');
      code = code.replace(/```/g, '');
      // Remove stray HTML details/summary artifacts occasionally emitted by models
      code = code.replace(/<\/?details[^>]*>/g, '');
      code = code.replace(/<\/?summary[^>]*>/g, '');
      // Remove leading/trailing HTML pre/code wrappers if any
      code = code.replace(/<\/?(pre|code)[^>]*>/g, '');
      // Remove ZERO WIDTH chars
      code = code.replace(/[\u200B-\u200D\uFEFF]/g, '');
      // Remove LM streaming/channel markers like <|channel|>final, <|start|>, and stray block chars
      code = code.replace(/^\s*<\|[^|>]+\|>.*$/gm, '');
      code = code.replace(/<\|[^|>]+\|>/g, '');
      code = code.replace(/[▌]/g, '');
      // Trim stray lines that are just markdown remnants
      code = code.split('\n').filter(line => !/^\s*```/.test(line)).join('\n');
      // Collapse multiple blank lines
      code = code.replace(/\n{3,}/g, '\n\n');
      // Final trim
      code = code.trim();
      return code;
    } catch (e) {
      return content;
    }
  }

  async notifyProgress(sessionId, progressData) {
    try {
      // Send progress update to result viewer
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url && tab.url.includes('result-viewer.html')) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              action: 'progressUpdate',
              sessionId: sessionId,
              progress: progressData
            });
          } catch (e) {
            // Tab might not be ready to receive messages, ignore
          }
        }
      }
      
      // Also save progress to storage for result viewer to pick up
      await chrome.storage.local.set({
        [`progress_${sessionId}`]: {
          ...progressData,
          timestamp: Date.now()
        }
      });
      
    } catch (error) {
      console.error('Error notifying progress:', error);
    }
  }

  async saveSession(sessionData) {
    try {
      const sessionId = sessionData.id || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const sessionRecord = {
        ...sessionData,
        id: sessionId,
        createdAt: sessionData.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await chrome.storage.local.set({
        [sessionId]: sessionRecord
      });

      await this.updateSessionsList(sessionId);

      return { success: true, sessionId };
    } catch (error) {
      console.error('Error saving session:', error);
      return { success: false, error: error.message };
    }
  }

  async updateSessionsList(sessionId) {
    try {
      const result = await chrome.storage.local.get('sessionsList');
      const sessionsList = result.sessionsList || [];
      
      sessionsList.unshift(sessionId);
      
      if (sessionsList.length > 50) {
        const oldSessionIds = sessionsList.splice(50);
        for (const oldId of oldSessionIds) {
          await chrome.storage.local.remove(oldId);
        }
      }

      await chrome.storage.local.set({ sessionsList });
    } catch (error) {
      console.error('Error updating sessions list:', error);
    }
  }

  async getHistory() {
    try {
      const result = await chrome.storage.local.get('sessionsList');
      const sessionsList = result.sessionsList || [];
      
      const sessions = [];
      for (const sessionId of sessionsList) {
        try {
          const sessionResult = await chrome.storage.local.get(sessionId);
          if (sessionResult[sessionId]) {
            sessions.push(sessionResult[sessionId]);
          }
        } catch (error) {
          console.error('Error loading session:', sessionId, error);
        }
      }

      return { success: true, sessions };
    } catch (error) {
      console.error('Error getting history:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteSession(sessionId) {
    try {
      await chrome.storage.local.remove(sessionId);
      
      const result = await chrome.storage.local.get('sessionsList');
      const sessionsList = result.sessionsList || [];
      const updatedList = sessionsList.filter(id => id !== sessionId);
      await chrome.storage.local.set({ sessionsList: updatedList });

      return { success: true };
    } catch (error) {
      console.error('Error deleting session:', error);
      return { success: false, error: error.message };
    }
  }

  async exportSession(sessionId, format) {
    try {
      const result = await chrome.storage.local.get(sessionId);
      const session = result[sessionId];
      
      if (!session) {
        throw new Error('Session not found');
      }

      let content;
      let filename;
      
      if (format === 'json') {
        content = JSON.stringify(session, null, 2);
        filename = `ai-steps-${sessionId}.json`;
      } else if (format === 'playwright') {
        content = session.playwrightCode || 'No Playwright code generated';
        const ext = session.format === 'python' ? 'py' : 'js';
        filename = `playwright-test-${sessionId}.${ext}`;
      }

      return {
        success: true,
        content,
        filename,
        mimeType: format === 'json' ? 'application/json' : 'text/plain'
      };
    } catch (error) {
      console.error('Error exporting session:', error);
      return { success: false, error: error.message };
    }
  }
}

new BackgroundService();
