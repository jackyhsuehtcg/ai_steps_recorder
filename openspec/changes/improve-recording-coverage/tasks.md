## Phase 1（🔴 P1 紅色，正確性 / 隱私）

### 1.1 敏感欄位 redaction

- [ ] 1.1.1 `content.js`：`createStep` / `getElementValue` 加敏感欄位偵測 helper `isSensitiveField(element)`（type=password、autocomplete cc-* / *-password / one-time-code、name/aria-label 含 password|ssn|cvv|credit-card）
- [ ] 1.1.2 命中時 `step.value = '<REDACTED>'`、`step.redactedReason = 'password' | 'autocomplete' | 'name-heuristic'`
- [ ] 1.1.3 工具列徽章顯示「敏感欄位已遮蔽 N 個」（在 step counter 旁加一個小徽章 element）
- [ ] 1.1.4 `background.js` LLM prompt 加一句指示：「If a step value is the literal string `<REDACTED>`, emit `fill('<REDACTED>')` verbatim — do not invent a real password」
- [ ] 1.1.5 `background.js:generateFallbackCodeBatch`：value 是 `<REDACTED>` 時，仍生成 `fill('<REDACTED>')`（既有 `q(value)` 路徑就會處理，但要驗證引號正確）
- [ ] 1.1.6 `result-viewer.js`：偵測程式碼含 `<REDACTED>` 字串時顯示黃色警告橫條「⚠ 含 N 個敏感值佔位符，執行前請替換」
- [ ] 1.1.7 `extension/README.md`：補一段「敏感欄位處理」說明

### 1.2 Shadow DOM 透過 `composedPath()`

- [ ] 1.2.1 `content.js`：所有 event handler（handleEvent / handleKeyEvent / handleFocusOut / handleMouseMove / handleMouseDown / handleMouseUp / handleFocusIn）開頭把 `event.target` 改成 `(event.composedPath?.()[0]) || event.target`
- [ ] 1.2.2 `createStep`：若 `target.getRootNode() instanceof ShadowRoot`，加 `step.inShadowDom = true` 與 `step.shadowHost`（host 元素的 selector）

### 1.3 動態 class / id 過濾

- [ ] 1.3.1 `content.js` 加常數：
  - `DYNAMIC_ID_RE = /^(mui|headlessui|radix|chakra|ant)-|^:r\d+:|^_|-[0-9a-f]{6,}$|::/i`
  - `DYNAMIC_CLASS_RE = /^css-[0-9a-z]+$|^sc-[A-Za-z]+-\d+$|^Mui[A-Z]\w+-[a-z]+$|^_[A-Za-z]+_[0-9a-z]+$|-[0-9a-f]{6,}$/`
- [ ] 1.3.2 `generateSelector`：`element.id` 命中 `DYNAMIC_ID_RE` 時跳過 id 走下一階層
- [ ] 1.3.3 `generateSelector`：class 過濾時加 `&& !DYNAMIC_CLASS_RE.test(cls)` 條件
- [ ] 1.3.4 `getRelevantAttributes`：把 attrs.id / attrs.class 中命中黑名單的值移除（避免進 LLM prompt 後又被當穩定 anchor 用）

### 1.4 SPA 導航追蹤

- [ ] 1.4.1 `content.js` 加 `handleNavigation()` 方法（throttle 200ms），呼叫既有的 `addNavigationStep()`
- [ ] 1.4.2 `attachEventListeners`：在 top frame 註冊 `popstate` / `hashchange` listener，並 patch `history.pushState` / `history.replaceState`
- [ ] 1.4.3 `removeEventListeners`：unpatch History API、移除 popstate/hashchange listener
- [ ] 1.4.4 `restoreRecordingState`：還原時不對「自動觸發的這次導航」記步驟（既有 spec 已寫，但這次要實際確認 patch 還原邏輯不會誤觸）

### 1.5 加 `dblclick` 與 `contextmenu`

- [ ] 1.5.1 `content.js:attachEventListeners` 加 `'dblclick'` 與 `'contextmenu'` 事件監聽
- [ ] 1.5.2 `getElementValue`：`dblclick` / `contextmenu` 比照 `click` 處理
- [ ] 1.5.3 `handleEvent` 100ms 去重邏輯：當收到 `dblclick`，把前 200ms 內最近兩個 click 步驟標記為 ignore（從 `this.steps` 中移除，並 `arrivalSeq` 不收回）
- [ ] 1.5.4 `background.js:generateFallbackCodeBatch`：加 `case 'dblclick'` → `locator.dblclick()`、`case 'contextmenu'` → `locator.click({ button: 'right' })`
- [ ] 1.5.5 `background.js` LLM prompt 加一句：「For `dblclick`, use `locator.dblclick()`. For `contextmenu`, use `locator.click({ button: 'right' })`」

### Phase 1 驗證

- [ ] 1.V.1 `node --check extension/*.js` 全綠
- [ ] 1.V.2 `grep -E '<REDACTED>' extension/{content,background,result-viewer}.js` 三個檔案都有對應字串
- [ ] 1.V.3 Chrome 手測（5 個 scenario，照 plan 第「Phase 1 驗證」段）

---

## Phase 2（🟡 P2 黃色，能力 gap）

### 2.1 contenteditable 值抓取

- [ ] 2.1.1 `content.js:getElementValue`：對 `input` / `change` 事件，若 `element.isContentEditable`，回 `(element.innerText || '').trim().substring(0, 1000)`
- [ ] 2.1.2 `attachEventListeners`：對 contenteditable 元素也要監聽 `input` 事件（既有 `document.addEventListener('input', ..., true)` 已涵蓋，但要驗證 capture phase 抓得到）
- [ ] 2.1.3 `background.js` LLM prompt 加：「For contenteditable elements, prefer `locator.fill()` for plain text or `locator.pressSequentially()` if order matters」

### 2.2 boundingRect 與 scrollY

- [ ] 2.2.1 `content.js:createStep` 加欄位：
  - `boundingRect: { top, left, width, height }`（從 `getBoundingClientRect()`）
  - `scrollY: window.scrollY`
  - `pageHeight: document.documentElement.scrollHeight`
- [ ] 2.2.2 `background.js` LLM prompt 加：「If a step's boundingRect.top is greater than its viewport height OR scrollY > 0, prepend `await locator.scrollIntoViewIfNeeded()` before the action」
- [ ] 2.2.3 `background.js:generateFallbackCodeBatch`：偵測同條件時也插入 `scrollIntoViewIfNeeded()`

### 2.3 統一 selector 與 locator 推導

- [ ] 2.3.1 抽出共用 helper `pickLocatorHint(element, attrs, label, text)`，回傳 `{ strategy, args, fallbackCss }`
- [ ] 2.3.2 此 helper 放在 `content.js` 內（不另立檔案，避免 import 複雜度），background 透過 step 物件消費結果
- [ ] 2.3.3 `content.js:createStep` 多帶 `locatorHint = pickLocatorHint(...)`
- [ ] 2.3.4 `background.js:generateFallbackCodeBatch:buildLocator` 改為直接讀 `step.locatorHint`，找不到才退回 step.selector
- [ ] 2.3.5 `background.js` LLM prompt 改為說明：「each step已附 step.locatorHint 表示推薦 locator 策略」（簡化 prompt）

### 2.4 iframe 同 host 區分

- [ ] 2.4.1 `content.js`：在 iframe 環境試取 `window.frameElement`（同 origin 才能取）
- [ ] 2.4.2 若取得，`createStep` 加 `step.frameAttributes = { id, name, title, src }`
- [ ] 2.4.3 `background.js` LLM prompt：對含 `frameAttributes` 的步驟，優先用 `frameLocator('iframe[name="..."]')` / `[title]` / `[id]`，URL 比對作為 fallback

### 2.5 keydown 涵蓋面擴大

- [ ] 2.5.1 `content.js:handleKeyEvent` 白名單擴大為：Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, PageUp, PageDown, Home, End, F2
- [ ] 2.5.2 偵測修飾鍵：`event.ctrlKey || event.metaKey || event.altKey` 為 true 時無條件記錄，並組合 step.value（如 `'Control+S'`、`'Meta+K'`）
- [ ] 2.5.3 `background.js:generateFallbackCodeBatch:case 'keydown'` 處理組合鍵字串，產出對應 `keyboard.press()` 呼叫
- [ ] 2.5.4 LLM prompt：說明 `step.value` 可能是組合鍵字串，請直接傳給 `keyboard.press()`

### Phase 2 驗證

- [ ] 2.V.1 `node --check extension/*.js` 全綠
- [ ] 2.V.2 Chrome 手測（4 個 scenario，照 plan）

---

## Phase 3（🟢 P3 綠色，UX / 健壯性）

### 3.1 Pause 真實作

- [ ] 3.1.1 `content.js` 加 `this.isPaused = false`，在 constructor 初始化
- [ ] 3.1.2 所有 event handler 開頭從 `if (!this.isRecording) return` 改為 `if (!this.isRecording || this.isPaused) return`
- [ ] 3.1.3 `togglePause()` 真實作：切換 `isPaused`，呼叫 `updatePauseButton()`
- [ ] 3.1.4 `updatePauseButton()`：若 `isPaused === true`，按鈕文字改為「Resume」、底色改為綠色（`#27ae60`）；否則回到「Pause」與半透明白色
- [ ] 3.1.5 `forceCleanup` / `stopRecording`：把 `isPaused` 重設為 false

### 3.2 IME composition handling

- [ ] 3.2.1 `content.js` 加 `this.isComposing = false`
- [ ] 3.2.2 `attachEventListeners` 註冊 `compositionstart` 與 `compositionend`
- [ ] 3.2.3 `compositionstart`：設 `this.isComposing = true`、清掉 `inputTimeout`（避免 IME 中觸發 idle flush）
- [ ] 3.2.4 `compositionend`：設 `this.isComposing = false`、立刻 `recordStepForTarget('input', e.target, 'final')` 寫入最終值
- [ ] 3.2.5 `handleEvent`：若 `event.type === 'input' && this.isComposing`，直接 return（不啟動 idle 計時）

### 3.3 temp_* / progress_* 鍵清理

- [ ] 3.3.1 `result-viewer.js:completeGeneration` 結束時 `chrome.storage.local.remove([tempKey, 'progress_<id>'])`
- [ ] 3.3.2 `result-viewer.js` 註冊 `window.addEventListener('beforeunload', ...)` 保險再清一次
- [ ] 3.3.3 額外：`background.js:writeToTempFileAndOpenViewer` 寫入時記錄 timestamp，下次再寫時清掉超過 1 小時的 stale `temp_session_*`（防止 result viewer 沒成功開的孤兒鍵）

### Phase 3 驗證

- [ ] 3.V.1 `node --check extension/*.js` 全綠
- [ ] 3.V.2 Chrome 手測：Pause/Resume、注音輸入、Application 分頁觀察 storage 鍵

---

## 收尾（三 phase 全部完成後）

- [ ] 4.1 把 5 份 delta spec 合併進主 `openspec/specs/<capability>/spec.md`
- [ ] 4.2 更新 `openspec/config.yaml`（若有需要）
- [ ] 4.3 把整個變更目錄移到 `openspec/changes/archive/`
- [ ] 4.4 簡短更新 `openspec/README.md`（提到 capability 內容變動）
