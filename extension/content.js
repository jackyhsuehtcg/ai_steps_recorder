class StepsRecorder {
  constructor() {
    this.isRecording = false;
    this.recordingMode = 'step-by-step';
    this.steps = [];
    this.currentStep = 0;
    this.toolbar = null;
    this.eventListeners = [];
    this.lastEventTarget = null;
    this.lastEventTimestamp = 0;
    this.lastInputTarget = null;
    this.lastRecordedValues = new WeakMap();
    this.inputIdleDelay = 1000; // less sensitive: wait longer before auto-capturing
    this.hoverOutline = null;
    this.hoverTarget = null;
    this.hoverColor = 'red';
    this.hoverRAF = null;
    this.isFrame = (function(){ try { return window.top !== window.self; } catch(e) { return true; } })();
    
    this.init();
  }

  init() {
    this.setupMessageListener();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('Content script received message:', request.action);
      // Ensure only the top frame handles global recording controls/status
      if (this.isFrame && (request.action === 'toggleRecording' || request.action === 'stopRecording' || request.action === 'getStatus')) {
        return; // ignore in iframes so top frame responds
      }
      
      switch (request.action) {
        case 'getStatus':
          sendResponse({ isRecording: this.isRecording });
          break;
        case 'updateStepCounter':
          if (!this.isFrame && this.toolbar) {
            const newCount = Number(request.count) || 0;
            this.currentStep = newCount;
            this.updateStepCounter();
          }
          sendResponse({ success: true });
          break;
          
        case 'startRecording':
          this.startRecording(request.settings).then(() => {
            sendResponse({ success: true, isRecording: this.isRecording });
          }).catch(error => {
            console.error('Start recording failed:', error);
            sendResponse({ success: false, error: error.message });
          });
          return true;

        case 'forceResetRecording':
          this.forceCleanup();
          sendResponse({ success: true });
          break;

        case 'toggleRecording':
          this.toggleRecording(request.settings).then(() => {
            sendResponse({ isRecording: this.isRecording });
          }).catch(error => {
            console.error('Toggle recording failed:', error);
            sendResponse({ isRecording: this.isRecording, error: error.message });
          });
          return true;
          
        case 'stopRecording':
          this.stopRecording().then(() => {
            sendResponse({ success: true });
          }).catch(error => {
            console.error('Stop recording failed:', error);
            sendResponse({ success: false, error: error.message });
          });
          return true;

        case 'restoreRecordingState':
          this.restoreRecordingState(request.state).then(result => {
            sendResponse(result);
          }).catch(error => {
            sendResponse({ success: false, error: error.message });
          });
          return true;

        case 'showCodeGenerated':
          this.showCodeNotification(`Step ${request.stepCount} code generated`);
          sendResponse({ success: true });
          break;

        case 'showError':
          this.showCodeNotification(request.message, 'error');
          sendResponse({ success: true });
          break;
          
        case 'showRestoreFailedNotification':
          this.showRestoreFailedNotification();
          sendResponse({ success: true });
          break;
          
        case 'ping':
          sendResponse({ status: 'ok', timestamp: Date.now(), recording: this.isRecording });
          break;
          
        default:
          sendResponse({ error: 'Unknown action' });
      }
    });
  }
  
  showRestoreFailedNotification() {
    if (this.isFrame) return;
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 999999; background: #e74c3c; color: white; padding: 15px 20px; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; font-weight: 500; box-shadow: 0 4px 20px rgba(0,0,0,0.3); max-width: 400px; text-align: center;
    `;
    notification.innerHTML = `<div>🔧 Recording restore failed</div><div style="font-size: 12px; margin-top: 8px; opacity: 0.9;">Please restart recording or refresh the page</div>`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 8000);
  }

  async toggleRecording(settings) {
    if (this.isRecording) {
      await this.stopRecording();
    } else {
      await this.startRecording(settings);
    }
  }

  async startRecording(settings) {
    this.recordingMode = settings.recordMode;
    this.isRecording = true;
    this.steps = [];
    this.currentStep = 0;
    
    if (!this.isFrame) this.createToolbar();
    this.attachEventListeners();
    console.log('AI Steps Recorder: Recording started in', this.recordingMode, 'mode');
  }

  async stopRecording() {
    this.isRecording = false;
    this.removeToolbar();
    this.removeEventListeners();
    await chrome.runtime.sendMessage({ action: 'stopRecording' });
    console.log('AI Steps Recorder: Recording stopped');
  }

  createToolbar() {
    if (this.isFrame) return; // do not render toolbar inside iframes
    if (this.toolbar) return;
    this.toolbar = document.createElement('div');
    this.toolbar.id = 'ai-steps-recorder-toolbar';
    this.toolbar.innerHTML = `
      <div class="asr-toolbar-content">
        <div class="asr-toolbar-title">🎬 Recording</div>
        <div class="asr-toolbar-mode">${this.recordingMode === 'step-by-step' ? 'Step-by-step' : 'Batch'} Mode</div>
        <div class="asr-toolbar-counter">Steps: <span id="asr-step-counter">0</span></div>
        <div class="asr-toolbar-actions">
          <button id="asr-pause-btn" class="asr-btn asr-btn-pause">Pause</button>
          <button id="asr-stop-btn" class="asr-btn asr-btn-stop">Stop</button>
        </div>
      </div>
    `;
    this.addToolbarStyles();
    document.body.appendChild(this.toolbar);
    this.makeToolbarDraggable();
    this.bindToolbarEvents();
  }

  addToolbarStyles() {
    if (document.getElementById('asr-toolbar-styles')) return;
    const styles = document.createElement('style');
    styles.id = 'asr-toolbar-styles';
    styles.textContent = `
      #ai-steps-recorder-toolbar { position: fixed; top: 20px; right: 20px; z-index: 999999; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); cursor: move; user-select: none; min-width: 280px; }
      .asr-toolbar-content { display: flex; flex-direction: column; gap: 8px; }
      .asr-toolbar-title { font-weight: 600; font-size: 14px; text-align: center; }
      .asr-toolbar-mode, .asr-toolbar-counter { font-size: 11px; text-align: center; opacity: 0.9; }
      .asr-toolbar-actions { display: flex; gap: 8px; justify-content: center; }
      .asr-btn { padding: 6px 12px; border: none; border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
      .asr-btn-pause { background: rgba(255,255,255,0.2); color: white; }
      .asr-btn-pause:hover { background: rgba(255,255,255,0.3); }
      .asr-btn-stop { background: #e74c3c; color: white; }
      .asr-btn-stop:hover { background: #c0392b; }
      .asr-element-highlight { outline: 2px solid #3498db !important; outline-offset: 2px !important; position: relative !important; }
    `;
    document.head.appendChild(styles);
  }

  makeToolbarDraggable() {
    let isDragging = false, currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;
    const dragStart = (e) => {
      if (e.target.classList.contains('asr-btn')) return;
      initialX = (e.type === 'touchstart' ? e.touches[0].clientX : e.clientX) - xOffset;
      initialY = (e.type === 'touchstart' ? e.touches[0].clientY : e.clientY) - yOffset;
      if (e.target === this.toolbar || this.toolbar.contains(e.target)) isDragging = true;
    };
    const dragEnd = () => { isDragging = false; };
    const drag = (e) => {
      if (isDragging) {
        e.preventDefault();
        currentX = (e.type === 'touchmove' ? e.touches[0].clientX : e.clientX) - initialX;
        currentY = (e.type === 'touchmove' ? e.touches[0].clientY : e.clientY) - initialY;
        xOffset = currentX;
        yOffset = currentY;
        this.toolbar.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      }
    };
    this.toolbar.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
  }

  bindToolbarEvents() {
    this.toolbar.querySelector('#asr-pause-btn').addEventListener('click', () => this.togglePause());
    this.toolbar.querySelector('#asr-stop-btn').addEventListener('click', () => this.stopRecording());
  }

  removeToolbar() {
    this.toolbar?.remove();
    this.toolbar = null;
    document.getElementById('asr-toolbar-styles')?.remove();
  }

  attachEventListeners() {
    const events = {
      'click': (e) => this.handleEvent(e),
      'input': (e) => this.handleEvent(e),
      'change': (e) => this.handleEvent(e),
      'keydown': (e) => this.handleKeyEvent(e),
      'submit': (e) => this.handleEvent(e)
    };
    Object.entries(events).forEach(([event, listener]) => {
      document.addEventListener(event, listener, true);
      this.eventListeners.push({ event, listener });
    });
    // Capture when leaving an input/textarea
    const focusoutListener = (e) => this.handleFocusOut(e);
    document.addEventListener('focusout', focusoutListener, true);
    this.eventListeners.push({ event: 'focusout', listener: focusoutListener });

    // Hover preview listeners
    const mouseMoveListener = (e) => this.handleMouseMove(e);
    const mouseDownListener = (e) => this.handleMouseDown(e);
    const mouseUpListener = (e) => this.handleMouseUp(e);
    const focusInListener = (e) => this.handleFocusIn(e);
    const scrollListener = () => this.repositionHoverOutline();
    const resizeListener = () => this.repositionHoverOutline();
    document.addEventListener('mousemove', mouseMoveListener, true);
    document.addEventListener('mousedown', mouseDownListener, true);
    document.addEventListener('mouseup', mouseUpListener, true);
    document.addEventListener('focusin', focusInListener, true);
    window.addEventListener('scroll', scrollListener, true);
    window.addEventListener('resize', resizeListener, true);
    this.eventListeners.push({ event: 'mousemove', listener: mouseMoveListener });
    this.eventListeners.push({ event: 'mousedown', listener: mouseDownListener });
    this.eventListeners.push({ event: 'mouseup', listener: mouseUpListener });
    this.eventListeners.push({ event: 'focusin', listener: focusInListener });
    this.eventListeners.push({ event: 'scroll', listener: scrollListener });
    this.eventListeners.push({ event: 'resize', listener: resizeListener });
  }

  handleKeyEvent(event) {
    if (!this.isRecording || event.target.closest('#ai-steps-recorder-toolbar')) return;
    if (['Enter', 'Tab', 'Escape'].includes(event.key)) {
      this.handleEvent(event);
    }
  }

  removeEventListeners() {
    this.eventListeners.forEach(({ event, listener }) => document.removeEventListener(event, listener, true));
    this.eventListeners = [];
    clearTimeout(this.inputTimeout);
    this.inputTimeout = null;
    this.destroyHoverOutline();
  }

  handleEvent(event) {
    if (!this.isRecording || event.target.closest('#ai-steps-recorder-toolbar')) return;

    // Ignore 'change' on text-like inputs since we already handle 'input'
    if (event.type === 'change') {
      const tag = (event.target.tagName || '').toLowerCase();
      const type = (event.target.getAttribute && (event.target.getAttribute('type') || '').toLowerCase()) || '';
      const isTextual = tag === 'input' && !['checkbox','radio','file','range','color','date','datetime-local','month','time','week'].includes(type);
      if (isTextual || tag === 'textarea') {
        return; // prevent duplicate steps (we capture via 'input')
      }
    }

    // If an input is pending and a likely-submission/navigation event happens, flush immediately
    if (this.inputTimeout && (event.type === 'submit' || event.type === 'click' || (event.type === 'keydown' && event.key === 'Enter') || event.type === 'change')) {
      if (event.type === 'click') {
        // If the click is still within the same input, do not flush yet
        if (this.lastInputTarget && (event.target === this.lastInputTarget || (this.lastInputTarget.contains && this.lastInputTarget.contains(event.target)))) {
          // let the debounce continue
        } else {
          clearTimeout(this.inputTimeout);
          this.inputTimeout = null;
          if (this.lastInputTarget && document.contains(this.lastInputTarget)) {
            this.recordStepForTarget('input', this.lastInputTarget, 'final');
          }
        }
      } else {
        clearTimeout(this.inputTimeout);
        this.inputTimeout = null;
        if (this.lastInputTarget && document.contains(this.lastInputTarget)) {
          this.recordStepForTarget('input', this.lastInputTarget, 'final');
        }
      }
    }

    // Debounce noisy input typing into a single step
    if (event.type === 'input') {
      const target = event.target;
      clearTimeout(this.inputTimeout);
      this.lastInputTarget = target;
      this.inputTimeout = setTimeout(() => {
        this.recordStepForTarget('input', target, 'idle');
        this.inputTimeout = null;
      }, this.inputIdleDelay);
      return;
    }

    const now = Date.now();
    if (event.target === this.lastEventTarget && (now - this.lastEventTimestamp) < 100) {
        console.log('Debouncing duplicate event');
        return;
    }
    this.lastEventTarget = event.target;
    this.lastEventTimestamp = now;
    
    const step = this.createStep(event);
    if (!step) return;
    this.pushAndSendStep(step);
    this.highlightElement(event.target);
  }

  recordStepForTarget(type, target, reason = 'final') {
    if (!this.isRecording) return;
    const syntheticEvent = { type, target };
    const step = this.createStep(syntheticEvent);
    if (!step) return;
    // Dedupe: do not record if value hasn't changed from last recorded value
    const tag = (target.tagName || '').toLowerCase();
    if (type === 'input' && (tag === 'input' || tag === 'textarea')) {
      const curVal = target.value || '';
      const prevVal = this.lastRecordedValues.get(target) || '';
      // For idle flush, avoid capturing very short values (likely incomplete)
      const minLen = 3;
      if (reason === 'idle' && curVal.length < minLen) return;
      if (curVal === prevVal) return;
      this.lastRecordedValues.set(target, curVal);
    }
    this.pushAndSendStep(step);
    this.highlightElement(target);
  }

  pushAndSendStep(step) {
    this.steps.push(step);
    this.currentStep++;
    this.updateStepCounter();
    try {
      chrome.runtime.sendMessage({ action: 'addStep', step });
    } catch (e) {
      // ignore send errors
    }
  }

  handleFocusOut(event) {
    if (!this.isRecording) return;
    const t = event.target;
    if (!t) return;
    const tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      // On leaving the field, record final value if changed
      if (this.inputTimeout) {
        clearTimeout(this.inputTimeout);
        this.inputTimeout = null;
      }
      this.recordStepForTarget('input', t, 'final');
    }
  }

  createStep(event) {
    const target = event.target;
    return {
      timestamp: Date.now(),
      type: event.type,
      tagName: target.tagName.toLowerCase(),
      selector: this.generateSelector(target),
      value: this.getElementValue(target, event),
      text: target.textContent?.trim().substring(0, 100),
      label: this.getLabelText(target),
      attributes: this.getRelevantAttributes(target),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url: window.location.href,
      inIframe: window.top !== window.self
    };
  }

  generateSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(cls => !cls.startsWith('asr-') && cls.length > 0).slice(0, 3);
      if (classes.length > 0) return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
    }
    const parent = element.parentElement;
    if (parent) {
      const index = Array.from(parent.children).indexOf(element);
      return `${this.generateSelector(parent)} > ${element.tagName.toLowerCase()}:nth-child(${index + 1})`;
    }
    return element.tagName.toLowerCase();
  }

  getElementValue(element, event) {
    switch (event.type) {
      case 'input': case 'change': return element.value || '';
      case 'click': return (element.type === 'checkbox' || element.type === 'radio') ? element.checked : element.textContent?.trim() || '';
      case 'keydown': return event.key;
      default: return '';
    }
  }

  getRelevantAttributes(element) {
    const attrs = {};
    const keys = [
      'id',
      'type',
      'name',
      'placeholder',
      'aria-label',
      'title',
      'role',
      'data-testid',
      'data-test-id',
      'data-test',
      'data-qa'
    ];
    keys.forEach(attr => {
      if (element.hasAttribute && element.hasAttribute(attr)) attrs[attr] = element.getAttribute(attr);
    });
    if (element.className && typeof element.className === 'string') {
      attrs['class'] = element.className.trim();
    }
    return attrs;
  }

  getLabelText(element) {
    try {
      // Associated <label for="...">
      if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        const text = label?.textContent?.trim();
        if (text) return text.substring(0, 120);
      }
      // Wrapped by <label>
      const wrappingLabel = element.closest ? element.closest('label') : null;
      const wrapText = wrappingLabel?.textContent?.trim();
      if (wrapText) return wrapText.substring(0, 120);
      // aria-label fallback
      if (element.getAttribute) {
        const aria = element.getAttribute('aria-label');
        if (aria) return aria.substring(0, 120);
        const title = element.getAttribute('title');
        if (title) return title.substring(0, 120);
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) return placeholder.substring(0, 120);
      }
    } catch (e) {}
    return '';
  }

  updateStepCounter() {
    const counter = document.getElementById('asr-step-counter');
    if (counter) counter.textContent = this.currentStep;
  }

  highlightElement(element) {
    document.querySelectorAll('.asr-element-highlight').forEach(el => el.classList.remove('asr-element-highlight'));
    element.classList.add('asr-element-highlight');
    setTimeout(() => element.classList.remove('asr-element-highlight'), 1000);
  }

  togglePause() {
    console.log('Pause toggle - to be implemented');
  }

  showCodeNotification(message, type = 'success') {
    if (this.isFrame || !this.toolbar) return;

    const existingNotif = this.toolbar.querySelector('.asr-code-notification');
    existingNotif?.remove();

    const notification = document.createElement('div');
    notification.className = 'asr-code-notification';
    notification.style.cssText = `
      position: absolute;
      bottom: -40px;
      left: 0;
      right: 0;
      background: ${type === 'error' ? 'rgba(231, 76, 60, 0.9)' : 'rgba(39, 174, 96, 0.9)'};
      color: white;
      padding: 8px;
      border-radius: 6px;
      font-size: 11px;
      text-align: center;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      z-index: -1;
    `;
    notification.textContent = message;
    
    this.toolbar.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = 1;
      notification.style.transform = 'translateY(0)';
    }, 10);

    setTimeout(() => {
      notification.style.opacity = 0;
      notification.style.transform = 'translateY(10px)';
      setTimeout(() => notification.remove(), 300);
    }, 2700);
  }

  async restoreRecordingState(state) {
    if (!state.isRecording) return { success: false, reason: 'Not recording' };
    console.log('\n=== CONTENT SCRIPT RESTORING RECORDING STATE ===');
    try {
      this.forceCleanup();
      await this.waitForDOMReady();
      this.isRecording = true;
      this.sessionId = state.sessionId;
      this.recordingMode = state.settings?.recordMode || 'step-by-step';
      this.steps = [...(state.steps || [])];
      this.currentStep = this.steps.length;
      await this.rebuildInterface();
      // Do not record automatic page navigations on restore
      console.log('=== CONTENT SCRIPT RESTORE COMPLETE ===');
      return { success: true };
    } catch (error) {
      console.error('\n=== CONTENT SCRIPT RESTORE FAILED ===', error);
      this.forceCleanup();
      return { success: false, error: error.message };
    }
  }
  
  forceCleanup() {
    this.isRecording = false;
    this.removeToolbar();
    this.removeEventListeners();
    this.steps = [];
    this.currentStep = 0;
  }

  ensureHoverOutline() {
    if (this.hoverOutline) return;
    const el = document.createElement('div');
    el.id = 'asr-hover-outline';
    el.setAttribute('data-color', this.hoverColor);
    document.documentElement.appendChild(el);
    this.hoverOutline = el;
  }

  destroyHoverOutline() {
    if (this.hoverOutline) {
      this.hoverOutline.remove();
      this.hoverOutline = null;
    }
    this.hoverTarget = null;
    this.hoverColor = 'red';
    if (this.hoverRAF) cancelAnimationFrame(this.hoverRAF);
    this.hoverRAF = null;
  }

  isToolbarOrChild(el) {
    const toolbar = document.getElementById('ai-steps-recorder-toolbar');
    return !!(toolbar && (el === toolbar || (toolbar.contains && toolbar.contains(el))));
  }

  isInteractive(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    if (['a','button','input','select','textarea','label','summary','details'].includes(tag)) return true;
    if (el.isContentEditable) return true;
    const role = el.getAttribute('role');
    if (role && ['button','link','checkbox','radio','menuitem','tab','switch','textbox','combobox'].includes(role)) return true;
    const tabindex = el.getAttribute('tabindex');
    if (tabindex && parseInt(tabindex, 10) >= 0) return true;
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return true;
    return false;
  }

  getInteractiveTarget(el) {
    let cur = el;
    for (let i = 0; i < 4 && cur; i++) {
      if (this.isInteractive(cur)) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  handleMouseMove(e) {
    if (!this.isRecording) return;
    const t = e.target;
    if (!t || this.isToolbarOrChild(t)) { this.hideHoverOutline(); return; }
    const target = this.getInteractiveTarget(t);
    this.hoverTarget = target;
    this.hoverColor = 'blue';
    this.ensureHoverOutline();
    this.queueReposition();
  }

  handleMouseDown(e) {
    if (!this.isRecording) return;
    const t = e.target;
    if (!t || this.isToolbarOrChild(t)) return;
    this.hoverTarget = this.getInteractiveTarget(t);
    this.hoverColor = 'red';
    this.ensureHoverOutline();
    this.queueReposition();
  }

  handleMouseUp(e) {
    if (!this.isRecording) return;
    this.hoverColor = 'red';
    if (this.hoverTarget) this.queueReposition();
  }

  handleFocusIn(e) {
    if (!this.isRecording) return;
    const t = e.target;
    if (!t || this.isToolbarOrChild(t)) return;
    if (this.isInteractive(t)) {
      this.hoverTarget = t;
      this.hoverColor = 'blue';
      this.ensureHoverOutline();
      this.queueReposition();
    }
  }

  queueReposition() {
    if (this.hoverRAF) cancelAnimationFrame(this.hoverRAF);
    this.hoverRAF = requestAnimationFrame(() => this.repositionHoverOutline());
  }

  repositionHoverOutline() {
    if (!this.hoverOutline || !this.hoverTarget || !document.contains(this.hoverTarget)) { this.hideHoverOutline(); return; }
    const rect = this.hoverTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { this.hideHoverOutline(); return; }
    this.hoverOutline.style.left = `${rect.left}px`;
    this.hoverOutline.style.top = `${rect.top}px`;
    this.hoverOutline.style.width = `${rect.width}px`;
    this.hoverOutline.style.height = `${rect.height}px`;
    this.hoverOutline.setAttribute('data-color', this.hoverColor);
    this.hoverOutline.style.opacity = '1';
  }

  hideHoverOutline() {
    if (this.hoverOutline) this.hoverOutline.style.opacity = '0';
  }
  
  async waitForDOMReady() {
    return new Promise(resolve => {
      if (document.readyState === 'complete') return resolve();
      const handler = () => { window.removeEventListener('load', handler); resolve(); };
      window.addEventListener('load', handler, { once: true });
      setTimeout(resolve, 5000); // Timeout fallback
    });
  }
  
  async rebuildInterface() {
    this.removeToolbar();
    if (!this.isFrame) this.createToolbar();
    this.attachEventListeners();
    this.updateStepCounter();
  }
  
  async addNavigationStep() {
    const navigationStep = {
      timestamp: Date.now(), type: 'navigation', tagName: 'page', selector: 'page', value: window.location.href, text: document.title || '', attributes: {}, viewport: { width: window.innerWidth, height: window.innerHeight }, url: window.location.href
    };
    this.steps.push(navigationStep);
    this.currentStep++;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Sync navigation step timeout')), 2000);
        chrome.runtime.sendMessage({ action: 'addStep', step: navigationStep }, (response) => {
          clearTimeout(timeout);
          chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(response);
        });
      });
    } catch (error) {
      console.error('Failed to sync navigation step:', error);
    }
    this.updateStepCounter();
    return navigationStep;
  }
}
