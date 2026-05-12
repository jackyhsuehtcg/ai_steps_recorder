// === Dynamic id / class blacklist (Phase 1.3) ===
// Frameworks that auto-generate hash-style identifiers; these IDs/classes
// change between builds and should never be used as stable selectors.
const DYNAMIC_ID_RE = /^(mui|headlessui|radix|chakra|ant)-|^:r\d+:|^_|-[0-9a-f]{6,}$|::/i;
const DYNAMIC_CLASS_RE = /^css-[0-9a-z]+$|^sc-[A-Za-z]+-\d+$|^Mui[A-Z]\w+-[a-z]+$|^_[A-Za-z]+_[0-9a-z]+$|-[0-9a-f]{6,}$/;

// === Sensitive field heuristics (Phase 1.1) ===
// Tokens used in the autocomplete attribute that mark a field as sensitive.
const SENSITIVE_AUTOCOMPLETE = new Set([
  'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year',
  'current-password', 'new-password', 'one-time-code'
]);
// Substrings in name/aria-label that strongly suggest sensitive data.
const SENSITIVE_NAME_RE = /password|ssn|cvv|credit-?card|creditcard/i;

// Returns 'password' | 'autocomplete' | 'name-heuristic' | null
function isSensitiveField(element) {
  try {
    if (!element || element.nodeType !== 1) return null;
    const tag = (element.tagName || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return null;

    const type = (element.getAttribute && element.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return 'password';

    const ac = (element.getAttribute && element.getAttribute('autocomplete') || '').toLowerCase().trim();
    if (ac && SENSITIVE_AUTOCOMPLETE.has(ac)) return 'autocomplete';

    const name = (element.getAttribute && element.getAttribute('name') || '').toLowerCase();
    const aria = (element.getAttribute && element.getAttribute('aria-label') || '').toLowerCase();
    if (SENSITIVE_NAME_RE.test(name) || SENSITIVE_NAME_RE.test(aria)) return 'name-heuristic';
  } catch (_) {}
  return null;
}

// Resolve the deepest target across Shadow DOM boundaries (Phase 1.2).
function deepestTarget(event) {
  try {
    if (event && typeof event.composedPath === 'function') {
      const path = event.composedPath();
      if (path && path.length > 0 && path[0] && path[0].nodeType === 1) {
        return path[0];
      }
    }
  } catch (_) {}
  return event && event.target;
}

// === Phase 2.3: shared locator hint helper ===
// Mirrors the priority order used by background.js fallback so the recorder and
// the code generator agree on how to address each element.
function pickLocatorHint(element, attrs, label, text) {
  try {
    const tag = (element.tagName || '').toLowerCase();
    const tx = (s) => (s == null ? '' : String(s)).trim();

    const testId = tx(attrs['data-testid'] || attrs['data-test-id'] || attrs['data-test'] || attrs['data-qa']);
    if (testId) return { strategy: 'testid', args: { value: testId } };

    const labelText = tx(label) || tx(attrs['aria-label']);
    const placeholder = tx(attrs['placeholder']);
    const textContent = tx(text);
    const role = tx(attrs['role']);
    const type = tx(attrs['type']);

    if (['input', 'textarea', 'select'].includes(tag) && labelText) {
      return { strategy: 'label', args: { text: labelText } };
    }
    if (['input', 'textarea', 'select'].includes(tag) && placeholder) {
      return { strategy: 'placeholder', args: { text: placeholder } };
    }

    const name = labelText || textContent;
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(type))) {
      if (name) return { strategy: 'role-name', args: { role: 'button', name } };
    }
    if (tag === 'a' && name) {
      return { strategy: 'role-name', args: { role: 'link', name } };
    }
    if (role && name) {
      return { strategy: 'role-name', args: { role, name } };
    }
    if (textContent) return { strategy: 'text', args: { text: textContent } };

    // XPath with conditions (not nth-child)
    const idAttr = tx(attrs['id']);
    const nameAttr = tx(attrs['name']);
    const cls = tx(attrs['class']);
    const classConds = cls
      ? cls.split(/\s+/).filter(Boolean).slice(0, 2).map(c => `contains(@class,'${c}')`)
      : [];
    const conds = [];
    if (idAttr) conds.push(`@id='${idAttr}'`);
    if (nameAttr) conds.push(`@name='${nameAttr}'`);
    if (type) conds.push(`@type='${type}'`);
    if (placeholder) conds.push(`@placeholder='${placeholder}'`);
    conds.push(...classConds);
    const xTag = tag || '*';
    let xpath = `//${xTag}${conds.length ? `[${conds.join(' and ')}]` : ''}`;
    if (!conds.length && textContent) xpath = `//${xTag}[normalize-space(.)='${textContent}']`;
    if (xpath !== `//${xTag}`) {
      return { strategy: 'xpath', args: { expression: xpath } };
    }

    // Last resort: code generation will fall through to step.selector
    return { strategy: 'css', args: {} };
  } catch (_) {
    return { strategy: 'css', args: {} };
  }
}

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
    this.lastEventType = '';
    this.lastInputTarget = null;
    this.lastRecordedValues = new WeakMap();
    this.inputIdleDelay = 1000; // less sensitive: wait longer before auto-capturing
    this.hoverOutline = null;
    this.hoverTarget = null;
    this.hoverColor = 'red';
    this.hoverRAF = null;
    this.isFrame = (function(){ try { return window.top !== window.self; } catch(e) { return true; } })();

    // Phase 1.1: count of redacted steps for toolbar badge
    this.redactedCount = 0;
    // Phase 1.4: SPA navigation tracking state
    this.navigationThrottleTimer = null;
    this.lastNavigationUrl = '';
    this.originalPushState = null;
    this.originalReplaceState = null;
    this.boundPopState = null;
    this.boundHashChange = null;
    // Phase 3.1: pause flag
    this.isPaused = false;
    // Phase 3.2: IME composition guard
    this.isComposing = false;

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
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 999999;
      background: #26262c; color: #c97474;
      border: 1px solid rgba(201, 116, 116, 0.5);
      border-left: 3px solid #c97474;
      padding: 14px 20px; border-radius: 10px;
      font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
      font-size: 13px; font-weight: 500;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      max-width: 420px; text-align: center;
    `;
    notification.innerHTML = `<div style="font-weight: 600;">🔧 Recording restore failed</div><div style="font-size: 11px; margin-top: 6px; opacity: 0.85; color: #9494a2;">Please restart recording or refresh the page</div>`;
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
        <div class="asr-toolbar-redacted" id="asr-redacted-badge" style="display:none;">⚠ Redacted <span id="asr-redacted-count">0</span></div>
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
    this.updateRedactedBadge();
  }

  addToolbarStyles() {
    if (document.getElementById('asr-toolbar-styles')) return;
    const styles = document.createElement('style');
    styles.id = 'asr-toolbar-styles';
    // Inlined Obsidian-Workshop theme colors (cannot reference design-tokens.css here)
    styles.textContent = `
      #ai-steps-recorder-toolbar {
        position: fixed; top: 20px; right: 20px; z-index: 999999;
        background: #26262c; color: #d4d4dc;
        border: 1px solid #48484f;
        border-radius: 10px; padding: 12px 14px;
        font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', 'Menlo', monospace;
        font-size: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 24px rgba(212,165,116,0.06);
        cursor: move; user-select: none; min-width: 260px;
      }
      .asr-toolbar-content { display: flex; flex-direction: column; gap: 8px; }
      .asr-toolbar-title {
        font-weight: 600; font-size: 12px; text-align: center;
        color: #d4a574; letter-spacing: 0.06em; text-transform: uppercase;
        padding-bottom: 6px; border-bottom: 1px solid #38383f;
      }
      .asr-toolbar-mode, .asr-toolbar-counter {
        font-size: 11px; text-align: center; color: #9494a2; letter-spacing: 0.04em;
      }
      .asr-toolbar-counter { color: #d4d4dc; font-weight: 500; }
      .asr-toolbar-redacted {
        font-size: 10px; text-align: center;
        background: rgba(201, 168, 108, 0.12); color: #c9a86c;
        border: 1px solid rgba(201, 168, 108, 0.3);
        padding: 3px 8px; border-radius: 6px;
        font-weight: 600; letter-spacing: 0.04em;
      }
      .asr-toolbar-paused {
        font-size: 10px; text-align: center;
        color: #c9a86c; background: rgba(201, 168, 108, 0.1);
        border: 1px solid rgba(201, 168, 108, 0.25);
        padding: 3px 6px; border-radius: 6px;
        font-weight: 600; letter-spacing: 0.06em;
      }
      .asr-toolbar-actions {
        display: flex; gap: 6px; justify-content: center;
        padding-top: 6px; border-top: 1px solid #38383f;
      }
      .asr-btn {
        padding: 6px 14px; border: 1px solid transparent; border-radius: 6px;
        font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
        font-size: 11px; font-weight: 500; letter-spacing: 0.02em;
        cursor: pointer; transition: all 160ms ease;
      }
      .asr-btn-pause {
        background: transparent; color: #9494a2; border-color: #48484f;
      }
      .asr-btn-pause:hover {
        background: #313138; color: #d4d4dc; border-color: #5a5a64;
      }
      .asr-btn-resume {
        background: #d4a574 !important; color: #1e1e22 !important;
        border-color: #d4a574 !important; font-weight: 600 !important;
      }
      .asr-btn-resume:hover {
        background: #ddb486 !important; border-color: #ddb486 !important;
      }
      .asr-btn-stop {
        background: transparent; color: #c97474;
        border-color: rgba(201, 116, 116, 0.4);
      }
      .asr-btn-stop:hover {
        background: rgba(201, 116, 116, 0.1); border-color: #c97474;
      }
      .asr-element-highlight {
        outline: 2px solid #d4a574 !important;
        outline-offset: 2px !important;
        position: relative !important;
      }
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
      'dblclick': (e) => this.handleEvent(e),         // Phase 1.5
      'contextmenu': (e) => this.handleEvent(e),       // Phase 1.5
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

    // Phase 1.4: SPA navigation tracking — only in top frame
    if (!this.isFrame) {
      this.boundPopState = () => this.handleNavigation();
      this.boundHashChange = () => this.handleNavigation();
      window.addEventListener('popstate', this.boundPopState, true);
      window.addEventListener('hashchange', this.boundHashChange, true);
      this.patchHistoryApi();
      this.lastNavigationUrl = window.location.href;
    }

    // Phase 3.2: IME composition listeners — applies to all frames
    this.boundCompositionStart = (e) => this.handleCompositionStart(e);
    this.boundCompositionEnd = (e) => this.handleCompositionEnd(e);
    document.addEventListener('compositionstart', this.boundCompositionStart, true);
    document.addEventListener('compositionend', this.boundCompositionEnd, true);
  }

  handleCompositionStart() {
    this.isComposing = true;
    // Cancel any pending idle flush — we'll re-flush after compositionend
    if (this.inputTimeout) {
      clearTimeout(this.inputTimeout);
      this.inputTimeout = null;
    }
  }

  handleCompositionEnd(event) {
    this.isComposing = false;
    if (!this.isRecording || this.isPaused) return;
    const target = deepestTarget(event);
    if (!target) return;
    // Record the final composed value as one input step
    this.recordStepForTarget('input', target, 'final');
  }

  handleKeyEvent(event) {
    if (!this.isRecording || this.isPaused) return;
    const target = deepestTarget(event);
    if (target && target.closest && target.closest('#ai-steps-recorder-toolbar')) return;

    // Phase 2.5: expanded keydown whitelist + modifier-combined recording
    const KEYDOWN_ALLOWED = new Set([
      'Enter', 'Tab', 'Escape',
      'Backspace', 'Delete', ' ', 'Spacebar',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'PageUp', 'PageDown', 'Home', 'End', 'F2'
    ]);
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    if (!KEYDOWN_ALLOWED.has(event.key) && !hasModifier) return;

    // Skip lone modifier keypresses (Control/Meta/Alt/Shift on their own)
    const modifierOnly = ['Control', 'Meta', 'Alt', 'Shift', 'OS'].includes(event.key);
    if (modifierOnly) return;

    // Build Playwright-compatible key string (e.g. "Control+S", "Meta+K", "Shift+Tab")
    let keyStr = event.key === ' ' ? 'Space' : event.key;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      const parts = [];
      if (event.ctrlKey) parts.push('Control');
      if (event.metaKey) parts.push('Meta');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      parts.push(keyStr);
      keyStr = parts.join('+');
    }

    // Forward to handleEvent via a delegating wrapper so composedPath() / target /
    // dedup logic continue to work; only event.key gets the combined string.
    const synthetic = {
      type: 'keydown',
      key: keyStr,
      target: event.target,
      composedPath: () => (event.composedPath ? event.composedPath() : [event.target])
    };
    this.handleEvent(synthetic);
  }

  removeEventListeners() {
    this.eventListeners.forEach(({ event, listener }) => document.removeEventListener(event, listener, true));
    this.eventListeners = [];
    clearTimeout(this.inputTimeout);
    this.inputTimeout = null;
    this.destroyHoverOutline();

    // Phase 1.4: tear down SPA navigation tracking
    if (this.boundPopState) {
      window.removeEventListener('popstate', this.boundPopState, true);
      this.boundPopState = null;
    }
    if (this.boundHashChange) {
      window.removeEventListener('hashchange', this.boundHashChange, true);
      this.boundHashChange = null;
    }
    this.unpatchHistoryApi();
    if (this.navigationThrottleTimer) {
      clearTimeout(this.navigationThrottleTimer);
      this.navigationThrottleTimer = null;
    }

    // Phase 3.2: tear down IME composition listeners
    if (this.boundCompositionStart) {
      document.removeEventListener('compositionstart', this.boundCompositionStart, true);
      this.boundCompositionStart = null;
    }
    if (this.boundCompositionEnd) {
      document.removeEventListener('compositionend', this.boundCompositionEnd, true);
      this.boundCompositionEnd = null;
    }
    this.isComposing = false;
  }

  // Phase 1.4: SPA navigation tracking
  patchHistoryApi() {
    if (this.originalPushState || this.originalReplaceState) return; // already patched
    try {
      this.originalPushState = history.pushState;
      this.originalReplaceState = history.replaceState;
      const self = this;
      history.pushState = function patchedPushState(...args) {
        const result = self.originalPushState.apply(history, args);
        self.handleNavigation();
        return result;
      };
      history.replaceState = function patchedReplaceState(...args) {
        const result = self.originalReplaceState.apply(history, args);
        self.handleNavigation();
        return result;
      };
    } catch (e) {
      console.warn('Failed to patch History API:', e);
      this.originalPushState = null;
      this.originalReplaceState = null;
    }
  }

  unpatchHistoryApi() {
    try {
      if (this.originalPushState) history.pushState = this.originalPushState;
      if (this.originalReplaceState) history.replaceState = this.originalReplaceState;
    } catch (e) {
      console.warn('Failed to unpatch History API:', e);
    }
    this.originalPushState = null;
    this.originalReplaceState = null;
  }

  handleNavigation() {
    if (!this.isRecording || this.isPaused || this.isFrame) return;
    if (this.navigationThrottleTimer) return; // already pending
    this.navigationThrottleTimer = setTimeout(() => {
      this.navigationThrottleTimer = null;
      const currentUrl = window.location.href;
      if (currentUrl === this.lastNavigationUrl) return;
      this.lastNavigationUrl = currentUrl;
      this.recordNavigationStep(currentUrl);
    }, 200);
  }

  recordNavigationStep(url) {
    const step = {
      timestamp: Date.now(),
      type: 'navigation',
      tagName: 'page',
      selector: 'page',
      value: url,
      text: document.title || '',
      label: '',
      attributes: {},
      viewport: { width: window.innerWidth, height: window.innerHeight },
      url,
      inIframe: false
    };
    this.steps.push(step);
    this.currentStep++;
    this.updateStepCounter();
    try {
      chrome.runtime.sendMessage({ action: 'addStep', step });
    } catch (e) {
      // ignore send errors
    }
  }

  handleEvent(event) {
    if (!this.isRecording || this.isPaused) return;
    // Phase 1.2: pierce Shadow DOM via composedPath
    const target = deepestTarget(event);
    if (target && target.closest && target.closest('#ai-steps-recorder-toolbar')) return;

    // Phase 3.2: ignore input events that fire during IME composition
    if (event.type === 'input' && this.isComposing) return;

    // Ignore 'change' on text-like inputs since we already handle 'input'
    if (event.type === 'change') {
      const tag = (target.tagName || '').toLowerCase();
      const type = (target.getAttribute && (target.getAttribute('type') || '').toLowerCase()) || '';
      const isTextual = tag === 'input' && !['checkbox','radio','file','range','color','date','datetime-local','month','time','week'].includes(type);
      if (isTextual || tag === 'textarea') {
        return; // prevent duplicate steps (we capture via 'input')
      }
    }

    // If an input is pending and a likely-submission/navigation event happens, flush immediately
    if (this.inputTimeout && (event.type === 'submit' || event.type === 'click' || (event.type === 'keydown' && event.key === 'Enter') || event.type === 'change')) {
      if (event.type === 'click') {
        // If the click is still within the same input, do not flush yet
        if (this.lastInputTarget && (target === this.lastInputTarget || (this.lastInputTarget.contains && this.lastInputTarget.contains(target)))) {
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
      clearTimeout(this.inputTimeout);
      this.lastInputTarget = target;
      this.inputTimeout = setTimeout(() => {
        this.recordStepForTarget('input', target, 'idle');
        this.inputTimeout = null;
      }, this.inputIdleDelay);
      return;
    }

    const now = Date.now();
    // Phase 1.5: dedup considers BOTH target and event.type so dblclick after click isn't swallowed
    if (target === this.lastEventTarget && event.type === this.lastEventType && (now - this.lastEventTimestamp) < 100) {
        console.log('Debouncing duplicate event');
        return;
    }

    // Phase 1.5: dblclick supersedes the preceding click(s) on the same target within 250ms
    if (event.type === 'dblclick') {
      this.supersedeRecentClicks(target, now, 250);
    }

    this.lastEventTarget = target;
    this.lastEventTimestamp = now;
    this.lastEventType = event.type;

    const step = this.createStep(event, target);
    if (!step) return;
    this.pushAndSendStep(step);
    this.highlightElement(target);
  }

  // Phase 1.5: walk back recent click steps on same target and remove them locally + on background
  supersedeRecentClicks(target, now, withinMs) {
    let removedCount = 0;
    while (this.steps.length > 0) {
      const last = this.steps[this.steps.length - 1];
      if (last.type !== 'click') break;
      if ((now - last.timestamp) > withinMs) break;
      // Compare by selector since we don't store target ref in step
      // (close-enough heuristic; combined with timing this rarely misfires)
      this.steps.pop();
      this.currentStep = Math.max(0, this.currentStep - 1);
      removedCount++;
      try {
        chrome.runtime.sendMessage({ action: 'removeRecentStep', reason: 'superseded-by-dblclick' });
      } catch (_) {}
      if (removedCount >= 2) break; // a single dblclick supersedes at most 2 preceding clicks
    }
    if (removedCount > 0) this.updateStepCounter();
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
    if (!this.isRecording || this.isPaused) return;
    const t = deepestTarget(event);
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

  createStep(event, precomputedTarget) {
    // Phase 1.2: deepest target (pierce Shadow DOM); precomputedTarget passed by handleEvent for reuse
    const target = precomputedTarget || deepestTarget(event);
    if (!target || !target.tagName) return null;

    // Phase 1.1: sensitive field redaction
    const sensitiveReason = isSensitiveField(target);
    const value = sensitiveReason ? '<REDACTED>' : this.getElementValue(target, event);

    const text = target.textContent ? target.textContent.trim().substring(0, 100) : '';
    const label = this.getLabelText(target);
    const attributes = this.getRelevantAttributes(target);

    // Phase 2.2: visual position for scrollIntoView decisions
    let boundingRect = null;
    try {
      const rect = target.getBoundingClientRect();
      boundingRect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    } catch (_) {}

    const step = {
      timestamp: Date.now(),
      type: event.type,
      tagName: target.tagName.toLowerCase(),
      selector: this.generateSelector(target),
      value,
      text,
      label,
      attributes,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      boundingRect,
      scrollY: window.scrollY,
      pageHeight: document.documentElement ? document.documentElement.scrollHeight : 0,
      url: window.location.href,
      inIframe: window.top !== window.self,
      // Phase 2.3: shared locator-hint computed at recording time so background fallback can reuse
      locatorHint: pickLocatorHint(target, attributes, label, text)
    };

    if (sensitiveReason) {
      step.redactedReason = sensitiveReason;
      this.redactedCount++;
      this.updateRedactedBadge();
    }

    // Phase 1.2: Shadow DOM marking
    try {
      const root = typeof target.getRootNode === 'function' ? target.getRootNode() : null;
      if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host) {
        step.inShadowDom = true;
        step.shadowHost = this.generateSelector(root.host);
      }
    } catch (_) {}

    // Phase 2.4: iframe disambiguation via window.frameElement (same-origin only)
    if (step.inIframe) {
      try {
        const fe = window.frameElement;
        if (fe && fe.nodeType === 1) {
          const fa = {};
          ['id', 'name', 'title', 'src'].forEach(k => {
            const v = fe.getAttribute(k);
            if (v) fa[k] = v;
          });
          if (Object.keys(fa).length > 0) step.frameAttributes = fa;
        }
      } catch (_) {
        // cross-origin iframe — frameElement throws; silently skip
      }
    }

    return step;
  }

  generateSelector(element) {
    // Phase 1.3: skip dynamic / hash-style IDs that change between runs
    if (element.id && !DYNAMIC_ID_RE.test(element.id)) return `#${element.id}`;
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/)
        .filter(cls => cls.length > 0 && !cls.startsWith('asr-') && !DYNAMIC_CLASS_RE.test(cls))
        .slice(0, 3);
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
      case 'input': case 'change':
        // Phase 2.1: contenteditable elements expose text via innerText (no .value)
        if (element.isContentEditable) {
          return (element.innerText || '').trim().substring(0, 1000);
        }
        return element.value || '';
      case 'click':
      case 'dblclick':
      case 'contextmenu':
        return (element.type === 'checkbox' || element.type === 'radio') ? element.checked : element.textContent?.trim() || '';
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
    // Phase 1.3: drop dynamic id from attributes (avoid LLM anchoring on it)
    if (attrs.id && DYNAMIC_ID_RE.test(attrs.id)) delete attrs.id;
    if (element.className && typeof element.className === 'string') {
      // Phase 1.3: filter dynamic / hash-style classes from the class attribute string
      const stable = element.className.trim().split(/\s+/)
        .filter(cls => cls.length > 0 && !cls.startsWith('asr-') && !DYNAMIC_CLASS_RE.test(cls));
      if (stable.length > 0) attrs['class'] = stable.join(' ');
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

  // Phase 1.1: keep the redaction badge in sync with this.redactedCount
  updateRedactedBadge() {
    const badge = document.getElementById('asr-redacted-badge');
    const count = document.getElementById('asr-redacted-count');
    if (!badge || !count) return;
    if (this.redactedCount > 0) {
      count.textContent = this.redactedCount;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  highlightElement(element) {
    document.querySelectorAll('.asr-element-highlight').forEach(el => el.classList.remove('asr-element-highlight'));
    element.classList.add('asr-element-highlight');
    setTimeout(() => element.classList.remove('asr-element-highlight'), 1000);
  }

  togglePause() {
    // Phase 3.1: real Pause/Resume implementation
    if (!this.isRecording) return;
    this.isPaused = !this.isPaused;
    // If we paused mid-typing, drop the pending idle flush so resume doesn't fire stale value
    if (this.isPaused && this.inputTimeout) {
      clearTimeout(this.inputTimeout);
      this.inputTimeout = null;
    }
    this.updatePauseButton();
  }

  updatePauseButton() {
    if (!this.toolbar) return;
    const btn = this.toolbar.querySelector('#asr-pause-btn');
    if (!btn) return;
    if (this.isPaused) {
      btn.textContent = 'Resume';
      btn.classList.add('asr-btn-resume');
    } else {
      btn.textContent = 'Pause';
      btn.classList.remove('asr-btn-resume');
    }
    // Add a "Paused" label under the mode line
    const mode = this.toolbar.querySelector('.asr-toolbar-mode');
    if (mode) {
      let label = this.toolbar.querySelector('.asr-toolbar-paused');
      if (this.isPaused) {
        if (!label) {
          label = document.createElement('div');
          label.className = 'asr-toolbar-paused';
          label.textContent = '⏸ Paused';
          mode.parentElement.insertBefore(label, mode.nextSibling);
        }
      } else if (label) {
        label.remove();
      }
    }
  }

  showCodeNotification(message, type = 'success') {
    if (this.isFrame || !this.toolbar) return;

    const existingNotif = this.toolbar.querySelector('.asr-code-notification');
    existingNotif?.remove();

    const notification = document.createElement('div');
    notification.className = 'asr-code-notification';
    const isError = type === 'error';
    notification.style.cssText = `
      position: absolute;
      bottom: -42px;
      left: 0;
      right: 0;
      background: ${isError ? 'rgba(201, 116, 116, 0.16)' : 'rgba(127, 184, 138, 0.16)'};
      color: ${isError ? '#c97474' : '#7fb88a'};
      border: 1px solid ${isError ? 'rgba(201, 116, 116, 0.45)' : 'rgba(127, 184, 138, 0.45)'};
      padding: 8px 10px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', 'SF Mono', 'Consolas', monospace;
      font-size: 11px;
      font-weight: 500;
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
    this.isPaused = false;
    this.isComposing = false;
    this.removeToolbar();
    this.removeEventListeners();
    this.steps = [];
    this.currentStep = 0;
    this.redactedCount = 0;
    this.lastNavigationUrl = '';
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
    const t = deepestTarget(e);
    if (!t || this.isToolbarOrChild(t)) { this.hideHoverOutline(); return; }
    const target = this.getInteractiveTarget(t);
    this.hoverTarget = target;
    this.hoverColor = 'blue';
    this.ensureHoverOutline();
    this.queueReposition();
  }

  handleMouseDown(e) {
    if (!this.isRecording) return;
    const t = deepestTarget(e);
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
    const t = deepestTarget(e);
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
