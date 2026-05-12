## ADDED Requirements

### Requirement: 敏感欄位遮蔽

The system SHALL 在錄製階段就把敏感欄位的輸入值替換為 placeholder 字串，使密碼、信用卡號等資訊不會以明文進入 step、storage、LLM、生成的程式碼。

#### Scenario: 密碼欄位自動遮蔽

- **GIVEN** 使用者在 `<input type="password">` 中輸入文字
- **WHEN** 該步驟被產生
- **THEN** `step.value` 被設為字串 `'<REDACTED>'`
- **AND** `step.redactedReason` 被設為 `'password'`
- **AND** 元素本身的真實值不出現在任何送往 background 或 storage 的物件中

#### Scenario: autocomplete 命中時遮蔽

- **GIVEN** 元素的 `autocomplete` 屬性為 `cc-number` / `cc-csc` / `cc-exp` / `current-password` / `new-password` / `one-time-code` 之一
- **WHEN** 該欄位被輸入
- **THEN** `step.value === '<REDACTED>'`
- **AND** `step.redactedReason === 'autocomplete'`

#### Scenario: name / aria-label heuristic 命中時遮蔽

- **GIVEN** 元素的 `name` 或 `aria-label` 屬性（小寫比對）含有 `password` / `ssn` / `cvv` / `credit-card` / `creditcard` 子字串
- **WHEN** 該欄位被輸入
- **THEN** `step.value === '<REDACTED>'`
- **AND** `step.redactedReason === 'name-heuristic'`

#### Scenario: 工具列徽章顯示遮蔽計數

- **GIVEN** 錄製進行中，已遮蔽 N 個步驟（N > 0）
- **WHEN** 工具列重繪
- **THEN** 在步驟計數器旁顯示「⚠ 已遮蔽 N」徽章

### Requirement: SPA 導航偵測

The system SHALL 在錄製進行中監聽 SPA 內部的 URL 變更（History API、popstate、hashchange），並產生 `type: 'navigation'` 步驟。

#### Scenario: pushState 觸發導航步驟

- **GIVEN** 正在 top frame 錄製
- **WHEN** 頁面程式碼呼叫 `history.pushState(state, title, url)`
- **THEN** 200ms throttle 後產生一筆 `type: 'navigation'` 步驟，`value` 為新的 `window.location.href`
- **AND** 該步驟透過 `addStep` 送回 background

#### Scenario: replaceState 觸發導航步驟

- **WHEN** 頁面程式碼呼叫 `history.replaceState(state, title, url)`
- **THEN** 同 pushState scenario

#### Scenario: popstate 與 hashchange

- **WHEN** 使用者按瀏覽器上一頁／下一頁，或 URL hash 變化
- **THEN** 產生 `type: 'navigation'` 步驟

#### Scenario: 錄製結束還原 History API

- **GIVEN** 錄製進行中時 `history.pushState` 已被 patch
- **WHEN** 錄製停止（`stopRecording` 或 `forceCleanup`）
- **THEN** `history.pushState` 與 `history.replaceState` 還原為原始 reference

#### Scenario: 跨頁面導航還原時不重複記

- **GIVEN** 錄製跨頁面導航重啟（`restoreRecordingState`）
- **WHEN** 新頁面載入完成觸發 popstate / hashchange
- **THEN** 不產生額外的 navigation 步驟（避免重複記錄這次自動還原）

### Requirement: IME composition 處理

The system SHALL 在中日韓 IME 輸入過程中，忽略 `input` 事件的中間 composition 狀態，僅在 composition 結束時記錄最終值。

#### Scenario: composition 進行中略過 input

- **GIVEN** 使用者在文字欄位開啟注音／拼音 IME
- **WHEN** IME 觸發 `compositionstart`
- **THEN** 後續所有 `input` 事件直到 `compositionend` 之間，皆不記步驟也不啟動 idle debounce

#### Scenario: composition 結束記最終值

- **WHEN** IME 觸發 `compositionend`
- **THEN** 立即把該欄位當下值記為一筆 `input` 步驟（reason='final'）
- **AND** 後續輸入恢復正常 1s idle debounce 行為

## MODIFIED Requirements

### Requirement: DOM 事件捕捉

The system SHALL 在錄製期間以 capture phase 監聽 `click`、`dblclick`、`contextmenu`、`input`、`change`、`submit`、`keydown` 事件，並對每個有效事件產生一筆步驟紀錄。

#### Scenario: 捕捉雙擊（更新後新增）

- **GIVEN** 正在錄製
- **WHEN** 使用者在某元素上雙擊
- **THEN** 產生一筆 `type: 'dblclick'` 步驟
- **AND** 把前 200ms 內、同一 target 的最近兩個 `click` 步驟標為 superseded（從 `recordingState.steps` 移除，避免重複）

#### Scenario: 捕捉右鍵（更新後新增）

- **WHEN** 使用者在某元素上按右鍵（contextmenu 事件）
- **THEN** 產生一筆 `type: 'contextmenu'` 步驟，`value` 為元素 `textContent`

#### Scenario: 過濾錄製器自身工具列（不變）

- **GIVEN** 正在錄製
- **WHEN** 觸發事件的 target 位於 `#ai-steps-recorder-toolbar` 內或其子元素，或 `#asr-hover-outline`
- **THEN** 不產生任何步驟

#### Scenario: 限制 keydown 種類（更新後擴大）

- **GIVEN** 正在錄製
- **WHEN** 使用者按鍵
- **THEN** 以下單鍵會被記錄：
  - `Enter`、`Tab`、`Escape`
  - `Backspace`、`Delete`、`Space`
  - `ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight`
  - `PageUp`、`PageDown`、`Home`、`End`、`F2`
- **AND** 任何按鍵 + 修飾鍵組合（`ctrlKey || metaKey || altKey === true`）皆會被記錄
- **AND** 其餘單鍵略過

#### Scenario: 修飾鍵組合 step.value 格式（更新後新增）

- **GIVEN** 使用者按下 `Cmd+S` / `Ctrl+K` / `Alt+F4` 等
- **WHEN** 該事件被記錄
- **THEN** `step.value` 為帶修飾鍵的 Playwright 標準字串（如 `'Meta+S'` / `'Control+K'` / `'Alt+F4'`，依 `event.ctrlKey/metaKey/altKey/shiftKey` 組合）

### Requirement: 步驟資料結構

The system SHALL 為每筆事件組裝包含時間、元素資訊、頁面上下文、視覺位置、locator hint 的步驟物件。

#### Scenario: 步驟必含欄位（更新後）

- **WHEN** 任何事件被錄製為步驟
- **THEN** 步驟物件至少包含以下欄位：
  - `timestamp`（毫秒）
  - `type`（事件類型：click / dblclick / contextmenu / input / change / submit / keydown / navigation）
  - `tagName`（小寫元素名）
  - `selector`（CSS selector，由 selector-generation capability 產生，作為 fallback）
  - `value`（依事件類型決定；敏感欄位為 `'<REDACTED>'`）
  - `redactedReason`（可選，僅在敏感欄位時存在）
  - `text`（`textContent` 前 100 字）
  - `label`（accessible label）
  - `attributes`（id / type / name / placeholder / aria-label / title / role / data-testid 家族 / class，已過濾動態 hash）
  - `viewport`（`{ width, height }`）
  - `boundingRect`（`{ top, left, width, height }`，從 `getBoundingClientRect()`）
  - `scrollY`（`window.scrollY`）
  - `pageHeight`（`document.documentElement.scrollHeight`）
  - `url`（`window.location.href`）
  - `inIframe`（`window.top !== window.self`）
  - `inShadowDom`（可選，當 target 位於 Shadow DOM 內為 `true`）
  - `shadowHost`（可選，當 `inShadowDom` 為 true 時，shadow host 元素的 selector）
  - `frameAttributes`（可選，僅在 iframe 同 origin 且取得 `window.frameElement` 時存在）
  - `locatorHint`（由 selector-generation 提供的結構化推薦 locator）

#### Scenario: contenteditable 取值（更新後新增）

- **GIVEN** 使用者在 `contenteditable` 元素中輸入文字
- **WHEN** 為該事件取 `step.value`
- **THEN** 回傳 `element.innerText` trim 後的前 1000 字（不取 `element.value`，因為 contenteditable 沒有該屬性）

#### Scenario: Shadow DOM target 解析（更新後新增）

- **GIVEN** 使用者點擊位於 Shadow DOM 內部的元素
- **WHEN** 事件 handler 取得 target
- **THEN** 用 `event.composedPath()[0]` 取得 shadow 內最深的真正目標
- **AND** 若 target 的 root node 為 ShadowRoot，於 step 物件加 `inShadowDom: true` 與 `shadowHost`（host 元素的 selector）

#### Scenario: iframe frameAttributes 補強（更新後新增）

- **GIVEN** content script 在 iframe 中執行
- **WHEN** 嘗試 `window.frameElement` 取得寄主 iframe
- **THEN** 同 origin 時 `frameElement` 可取，把 iframe 的 `id` / `name` / `title` / `src` 屬性組成 `step.frameAttributes`
- **AND** 跨 origin 時 `window.frameElement` 拋例外，靜默 catch 後不加 `frameAttributes`（仍保留 `inIframe: true` 與 step.url 給 LLM 推導 frameLocator）
