# 擴充功能協調 (Extension Orchestration) Specification

## Purpose

本 capability 涵蓋 Chrome Extension MV3 的「跨元件協調」邏輯：

1. **Manifest 與權限**：擴充功能對外宣告的 host_permissions、permissions、`<all_urls>` content script 注入。
2. **Service worker 生命週期**：背景服務的訊息路由、初始化、tab 事件監聽。
3. **Content script 注入引導**：每個 tab load 完成時自動初始化 `StepsRecorder` 實例。
4. **錄製中跨頁面導航的還原**：tab url 變更後重新注入腳本、ping 確認就緒、發送 `restoreRecordingState`、限制重試次數。
5. **Step 隊列**：把單步 LLM 呼叫序列化，避免並行請求；tab 關閉時自動停止錄製。
6. **訊息路由**：分發 popup / settings / history / result viewer / content script 之間所有 chrome.runtime 訊息。

範圍**不含**：訊息背後的具體業務邏輯（屬於各對應 capability）、UI 頁面渲染（屬於 [result-and-history-ui](../result-and-history-ui/spec.md)）。

## Requirements

### Requirement: Manifest 宣告

The system SHALL 在 `manifest.json` 中宣告 Manifest V3、所需權限、host permissions、content script 注入規則、background service worker 與 options page。

#### Scenario: Manifest version

- **WHEN** Chrome 載入擴充功能
- **THEN** `manifest.json` 的 `manifest_version` 為 `3`
- **AND** `name` 為 `AI Steps Recorder`
- **AND** `version` 為 `1.0.0`

#### Scenario: 權限清單

- **WHEN** Chrome 解析 manifest
- **THEN** `permissions` 包含：
  - `activeTab`、`storage`、`scripting`、`tabs`、`clipboardWrite`

#### Scenario: Host permissions

- **WHEN** Chrome 解析 manifest
- **THEN** `host_permissions` 包含：
  - `http://localhost:1234/*`（LM Studio 預設端點）
  - `http://localhost:11434/*`（Ollama 預設端點）
  - `https://api.openai.com/*`
  - `https://generativelanguage.googleapis.com/*`
  - `https://api.anthropic.com/*`
  - `http://*/*` 與 `https://*/*`（讓使用者可在任意網站錄製）

#### Scenario: Content script 注入規則

- **WHEN** Chrome 載入任一頁面
- **THEN** 依 `content_scripts` 規則注入 `content.js` + `content-injector.js` 與 `content.css`
- **AND** `matches: ['<all_urls>']`、`run_at: 'document_idle'`、`all_frames: true`、`match_about_blank: true`

#### Scenario: 背景服務與 options page

- **WHEN** Chrome 解析 manifest
- **THEN** `background.service_worker` 為 `background.js`
- **AND** `options_page` 為 `settings.html`
- **AND** `action.default_popup` 為 `popup.html`

### Requirement: 訊息路由

The system SHALL 在 service worker 啟動時註冊 `chrome.runtime.onMessage` 監聽器，依 `request.action` 路由至對應處理流程，並對 async 回應保持 listener 存活。

#### Scenario: 已知 action 路由

- **WHEN** background 收到訊息
- **THEN** 依 action 路由至：
  - `startRecording` → `startRecording(settings, tabId)` 並 async 回應
  - `stopRecording` → `stopRecording()` async 回應
  - `getRecordingState` → 同步回應 `{ success: true, state: <recordingState> }`
  - `addStep` → 同步呼叫 `addStep(step, sender.tab.id)` 後回應 `{ success: true }`
  - `generatePlaywrightCode` → `handleGeneratePlaywrightCode(request)` async 回應
  - `saveSession` / `getHistory` / `deleteSession` / `exportSession` → 對應流程 async 回應
  - `updateAccumulatedCode` → 同步更新並回應 `{ success: true }`
  - `ping` → 同步回應 `{ status: 'ok', timestamp: Date.now() }`
- **AND** 對所有需要 async 處理的 action 回傳 `true` 以保持 sendResponse 通道

#### Scenario: 未知 action

- **WHEN** 收到未知的 action
- **THEN** 回應 `{ error: 'Unknown action' }`

### Requirement: Tab 生命週期協同

The system SHALL 監聽 `chrome.tabs.onUpdated` 與 `chrome.tabs.onRemoved`，在錄製 tab 發生變化時觸發還原或停止流程。

#### Scenario: 錄製 tab 開始載入新頁

- **GIVEN** 正在錄製 tab T
- **WHEN** tab T 觸發 `onUpdated` 且 `changeInfo.status === 'loading'`
- **THEN** 設定 `pendingRestore = true`（標示頁面正在載入，等 complete 後嘗試還原）

#### Scenario: 錄製 tab 載入完成

- **GIVEN** 正在錄製 tab T
- **WHEN** tab T 觸發 `onUpdated` 且 `changeInfo.status === 'complete'` 並含 `tab.url`
- **THEN** 1 秒後呼叫 `restoreRecordingInTab(tabId)` 嘗試還原錄製

#### Scenario: 錄製 tab 被關閉

- **GIVEN** 正在錄製 tab T
- **WHEN** tab T 觸發 `onRemoved`
- **THEN** 呼叫 `stopRecording()` 結束目前 session（含儲存）

### Requirement: Content Script 注入引導

The system SHALL 透過 `content-injector.js` 在每個 frame 啟動時建立 `StepsRecorder` instance，必要時清理舊 instance。

#### Scenario: 首次注入

- **GIVEN** 頁面剛載入，`window.stepsRecorderInjected` 未定義
- **WHEN** `content-injector.js` 執行
- **THEN** 設置 `window.stepsRecorderInjected = true`
- **AND** 等 `DOMContentLoaded`（若還在 loading）後建立 `window.stepsRecorder = new StepsRecorder()`

#### Scenario: 重複注入時清理舊實例

- **GIVEN** 頁面已存在 `window.stepsRecorder`
- **WHEN** 注入器再次執行（如手動 `executeScript`）
- **THEN** 對舊 instance 呼叫 `forceCleanup()`（若該方法存在）
- **AND** 建立新的 `StepsRecorder` 取代

#### Scenario: 啟動後查詢錄製狀態

- **WHEN** 新 instance 建立完成
- **THEN** 500ms 後對背景服務發送 `{ action: 'getRecordingState' }`
- **AND** 若回應顯示正在錄製，呼叫 `restoreRecordingState(state)` 接管錄製

#### Scenario: ensureRecorderReady 訊息

- **WHEN** 收到 `{ action: 'ensureRecorderReady' }`
- **THEN** 若 `window.stepsRecorder` 不存在則初始化
- **AND** 回應 `{ ready: !!window.stepsRecorder }`

#### Scenario: 連線檢查心跳

- **WHEN** content-injector 載入完成
- **THEN** 1 秒後對背景服務發送一次 `ping`
- **AND** 之後每 30 秒發送一次 `ping`
- **AND** 連線中斷時記 console 警告（不採取其他動作）

### Requirement: 跨頁面導航的錄製還原

The system SHALL 在錄製 tab 載入新頁後，重試還原直到成功或達上限。

#### Scenario: 還原前確認 tab 完成載入

- **WHEN** `restoreRecordingInTab(tabId)` 被呼叫
- **THEN** 先 `chrome.tabs.get(tabId)` 確認 `tab.status === 'complete'`
- **AND** 若尚未完成，2 秒後重試（不算入 attempts）

#### Scenario: 確認 content script 就緒

- **GIVEN** tab 已完成載入
- **WHEN** 進入還原流程
- **THEN** 額外等待 1 秒
- **AND** 透過 `verifyScriptReady(tabId)` 對 tab 發送 `ping` 訊息，最多 5 次（每次間隔 1s/2s/3s/4s/5s）
- **AND** 任一次得到 `{ status: 'ok' }` 即視為就緒
- **AND** 若 5 次都失敗，3 秒後再呼叫整體還原流程

#### Scenario: 發送 restoreRecordingState 訊息

- **GIVEN** content script 已就緒
- **WHEN** 嘗試還原
- **THEN** 發送 `{ action: 'restoreRecordingState', state: <recordingState> }` 訊息，timeout 15 秒
- **AND** 收到 `{ success: true }` 回應後，從 `restoreAttempts` 中移除該 tab、把 `pendingRestore` 設為 false

#### Scenario: 重試上限

- **WHEN** 同一 tab 還原嘗試已達 5 次仍失敗
- **THEN** 從 `restoreAttempts` 中移除該 tab、`pendingRestore` 設為 false
- **AND** 對 tab 發送 `{ action: 'showRestoreFailedNotification' }` 通知使用者
- **AND** 不再嘗試該 tab 的還原

#### Scenario: 中間嘗試以指數退避

- **WHEN** 嘗試 1～4 次失敗
- **THEN** 以 `(attempts + 1) * 2000ms` 延遲後重試（即 2s / 4s / 6s / 8s）

### Requirement: 強制注入腳本

The system SHALL 在需要重新注入時，對 tab 依序注入 CSS、`content.js`、`content-injector.js`。

#### Scenario: 注入順序

- **WHEN** `forceInjectScripts(tabId)` 被呼叫
- **THEN** 先 `chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] })`（失敗只 console 警告，不拋）
- **AND** 接著 `chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })`
- **AND** 最後 `chrome.scripting.executeScript({ target: { tabId }, files: ['content-injector.js'] })`
- **AND** JS 注入失敗時拋例外（讓上層流程處理）

### Requirement: 步驟隊列

The system SHALL 把 step-by-step 模式下的單步 LLM 呼叫透過隊列序列化，避免同時間多筆請求並發。

#### Scenario: 單一處理迴圈

- **GIVEN** `stepQueue` 有待處理步驟
- **WHEN** `processQueue()` 被呼叫
- **THEN** 若 `isProcessingQueue` 已為 true 則直接 return
- **AND** 否則設為 true 進入 while 迴圈，逐筆 shift 並 await LLM 處理
- **AND** 迴圈結束時把 `isProcessingQueue` 設回 false

#### Scenario: 錄製停止時清空

- **WHEN** 處理迴圈中偵測到 `recordingState.isRecording === false`
- **THEN** 清空 `stepQueue` 並退出迴圈

#### Scenario: 模式不符時跳出

- **WHEN** 處理迴圈中偵測到 `recordingState.settings.recordMode !== 'step-by-step'`
- **THEN** 清空 `stepQueue` 並退出迴圈

#### Scenario: 步驟入隊條件

- **WHEN** `addStep(step, tabId)` 收到步驟
- **THEN** 若 `tabId` 與 `recordingState.tabId` 不符或非錄製中則略過
- **AND** 否則補上 `stepIndex` / `canonicalTs` / `arrivalSeq` 推入 `recordingState.steps`
- **AND** 同步發送 `updateStepCounter` 給 top frame
- **AND** 模式為 `step-by-step` 時推入 `stepQueue` 並啟動處理迴圈

### Requirement: 停止錄製時通知 content script

The system SHALL 在停止錄製時對錄製 tab 的 top frame 發送 `forceResetRecording`，確保即使訊息流程亂序也能清乾淨頁面狀態。

#### Scenario: 廣播 forceResetRecording

- **WHEN** `stopRecording()` 完成 session 儲存
- **THEN** 對 `recordingState.tabId` 的 frameId 0 發送 `{ action: 'forceResetRecording' }`
- **AND** 即使該訊息發送失敗也不阻擋停止流程（記 console 警告）
