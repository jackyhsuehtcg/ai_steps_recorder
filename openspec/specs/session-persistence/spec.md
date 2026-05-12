# 設定與 Session 持久化 (Session Persistence) Specification

## Purpose

本 capability 涵蓋擴充功能在 `chrome.storage` 上的所有讀寫，分為兩個區塊：

1. **使用者設定**（`chrome.storage.sync`）：provider / apiUrl / modelName / apiKey / temperature / maxTokens / recordMode / outputFormat / autoSave / maxSteps，會在 Chrome 帳號間自動同步。
2. **錄製紀錄與暫存**（`chrome.storage.local`）：完成錄製的 session 物件、有上限的 `sessionsList` 索引、開啟 result viewer 用的 `temp_session_*`、批次生成進度的 `progress_*`、可下載檔案的 `downloadable_*`。

責任也包含安裝時種下預設設定、session 上限裁切、依 ID 查詢 / 刪除、與匯出（JSON 完整紀錄或純 Playwright 程式碼）。

範圍**不含**：`chrome.storage` 以外的瀏覽器互動（屬於 [extension-orchestration](../extension-orchestration/spec.md)）、設定頁與歷史頁的 UI（屬於 [result-and-history-ui](../result-and-history-ui/spec.md)）、進度事件的產生位置（屬於 [code-generation](../code-generation/spec.md)）。

## Requirements

### Requirement: 安裝時種下預設設定

The system SHALL 在擴充功能首次安裝時把預設值寫入 `chrome.storage.sync`，並在使用者未自訂時提供合理的開箱體驗。

#### Scenario: 安裝事件觸發

- **GIVEN** 使用者剛安裝擴充功能
- **WHEN** `chrome.runtime.onInstalled` 事件 reason 為 `install`
- **THEN** 將以下預設值寫入 `chrome.storage.sync`：
  - `recordMode: 'step-by-step'`
  - `outputFormat: 'javascript'`
  - `autoSave: true`
  - `maxSteps: 100`
  - `provider: 'lmstudio'`
  - `apiUrl: 'http://localhost:1234/v1/chat/completions'`
  - `modelName: 'lm-studio'`
  - `apiKey: ''`
  - `temperature: 0.1`
  - `maxTokens: 2000`

#### Scenario: 升級不覆蓋既有設定

- **WHEN** `chrome.runtime.onInstalled` 事件 reason 不是 `install`（例如 `update`）
- **THEN** 不執行 `setDefaultSettings`（保留使用者既有設定）

### Requirement: 使用者設定的存放位置

The system SHALL 把使用者層級設定統一放在 `chrome.storage.sync`，把 session 相關資料放在 `chrome.storage.local`。

#### Scenario: 設定讀取

- **WHEN** 任何頁面或背景流程需要 `provider` / `apiUrl` / `modelName` / `apiKey` / `temperature` / `maxTokens` / `recordMode` / `outputFormat`
- **THEN** 從 `chrome.storage.sync` 讀取
- **AND** 缺鍵時退回對應預設值（如 `provider` 缺則用 `'lmstudio'`、`apiUrl` 缺則用 `'http://localhost:1234/v1/chat/completions'` 等）

#### Scenario: 設定寫入

- **WHEN** 設定頁儲存表單
- **THEN** 統一寫入 `chrome.storage.sync`
- **AND** 不在 `chrome.storage.local` 留任何設定鏡射

### Requirement: Session 紀錄存放與 ID

The system SHALL 把每筆完成錄製的 session 以「`<sessionId>` 為 key」寫入 `chrome.storage.local`，並維護 `sessionsList` 陣列作為依時間排序的索引。

#### Scenario: Session ID 格式

- **WHEN** 開始一次錄製
- **THEN** 產生 ID `session_<timestamp>_<random9chars>`（例：`session_1714999999999_abc123def`）

#### Scenario: Session 物件至少含欄位

- **WHEN** 錄製結束寫入 session
- **THEN** 物件至少包含：
  - `id`、`mode`（`step-by-step`/`one-time`）、`format`（`javascript`/`python`/`pytest`）
  - `steps`（步驟陣列，每筆含 `interaction-recording` 規範的所有欄位）
  - `startTime`、`endTime`、`duration`
  - `playwrightCode`（生成的程式碼，可為 null）
  - `llmProvider`、`llmModel`（從 sync storage 即時讀取）
  - `createdAt`、`updatedAt`（ISO 字串）

#### Scenario: 寫入到對應 key

- **WHEN** `saveSession(sessionData)` 被呼叫
- **THEN** 以 `sessionId` 為 key 寫入 `chrome.storage.local`
- **AND** 同時呼叫 `updateSessionsList(sessionId)` 更新索引

### Requirement: Session 索引上限 50 筆

The system SHALL 限制 `sessionsList` 最多保留 50 筆，超過時刪除最舊的紀錄與其對應 storage 物件。

#### Scenario: 新增 session 加到索引前端

- **WHEN** `updateSessionsList(sessionId)` 被呼叫
- **THEN** 把 `sessionId` `unshift` 到 `sessionsList` 陣列前端

#### Scenario: 超過 50 筆裁切

- **WHEN** `sessionsList.length > 50`
- **THEN** 把超過的 ID 從陣列尾端移除
- **AND** 對每個被移除的 ID 呼叫 `chrome.storage.local.remove(id)` 清除實際 session 資料

### Requirement: 依 ID 讀取與刪除

The system SHALL 支援讀取單一 session 與刪除單一 session 並更新索引。

#### Scenario: 取得歷史清單

- **WHEN** `getHistory()` 被呼叫
- **THEN** 讀取 `sessionsList`
- **AND** 對每個 ID 從 storage 讀回完整 session 物件
- **AND** 回應 `{ success: true, sessions: [...] }`
- **AND** 任一 session 讀取失敗只記 console error，不中斷整體回應

#### Scenario: 刪除指定 session

- **WHEN** `deleteSession(sessionId)` 被呼叫
- **THEN** 從 `chrome.storage.local` 移除該 key
- **AND** 從 `sessionsList` 過濾掉該 ID 並寫回
- **AND** 回應 `{ success: true }`

### Requirement: Session 匯出

The system SHALL 支援將指定 session 匯出為 JSON 完整紀錄或純 Playwright 程式碼，並回傳對應檔名與 MIME type。

#### Scenario: JSON 匯出

- **WHEN** `exportSession(sessionId, 'json')` 被呼叫
- **THEN** 取出整個 session 物件並 `JSON.stringify` 為 2 空格縮排
- **AND** 回應 `{ success: true, content, filename: 'ai-steps-<sessionId>.json', mimeType: 'application/json' }`

#### Scenario: Playwright 原始碼匯出

- **WHEN** `exportSession(sessionId, 'playwright')` 被呼叫
- **THEN** 取出 `session.playwrightCode`（若為空則填 `'No Playwright code generated'`）
- **AND** 副檔名依 `session.format` 決定：`python` → `py`、否則 → `js`
- **AND** 回應 `{ success: true, content, filename: 'playwright-test-<sessionId>.<ext>', mimeType: 'text/plain' }`

#### Scenario: 找不到 session

- **WHEN** 給定的 sessionId 在 storage 中不存在
- **THEN** 回應 `{ success: false, error: 'Session not found' }`

### Requirement: Result Viewer 暫存交接

The system SHALL 在 one-time 模式錄製結束或 step-by-step 已產生程式碼時，把 session 寫入暫存 key 並開啟 result viewer 分頁。

#### Scenario: 寫入暫存 key

- **WHEN** `writeToTempFileAndOpenViewer(sessionData)` 被呼叫
- **THEN** 寫入 `chrome.storage.local`：
  - `temp_session_<timestamp>: <sessionData>`
  - `latest_temp_session: 'temp_session_<timestamp>'`

#### Scenario: 開啟 result viewer

- **WHEN** 暫存寫入後
- **THEN** 開啟新分頁 URL `result-viewer.html?sessionId=<id>&temp=<tempKey>`
- **AND** `active: true`

#### Scenario: 已有程式碼時建立可下載檔

- **WHEN** session 已含 `playwrightCode`
- **THEN** 額外建立 `downloadable_<sessionId>` key，內容包含：
  - `filename: 'playwright-test-<isoTimestamp>.<ext>'`
  - `content`（程式碼，python 格式時將 `//` 註解前綴改為 `#`）
  - `mimeType: 'text/plain'`
  - `sessionId`、`timestamp`

### Requirement: 批次生成進度暫存

The system SHALL 在批次生成過程把進度寫到 `progress_<sessionId>` key，使 result viewer 即使分頁尚未準備好接收訊息也能讀到目前進度。

#### Scenario: 進度雙通道發送

- **WHEN** `notifyProgress(sessionId, progressData)` 被呼叫
- **THEN** 對所有開啟的 `result-viewer.html` 分頁發送 `{ action: 'progressUpdate', sessionId, progress: progressData }` 訊息
- **AND** 同時寫入 `chrome.storage.local`：`progress_<sessionId>: { ...progressData, timestamp: Date.now() }`

#### Scenario: 訊息發送失敗不阻擋

- **WHEN** 某分頁 sendMessage 失敗
- **THEN** 略過該分頁，繼續處理其他分頁與 storage 寫入（不拋例外）

### Requirement: 錄製狀態的記憶體生命週期

The system SHALL 把當前錄製狀態保存在 service worker 記憶體（不寫入 storage），錄製結束後清空為初始值。

#### Scenario: stopRecording 後重置

- **WHEN** `stopRecording()` 完成且 session 已儲存
- **THEN** 將 `recordingState` 重設為：
  ```
  { isRecording: false, sessionId: null, settings: null, steps: [], tabId: null, accumulatedCode: null }
  ```
- **AND** 清空 `stepQueue`、把 `isProcessingQueue` 設為 false、`arrivalSeq` 歸零

#### Scenario: stale state 自動清理

- **WHEN** `startRecording()` 開始時偵測到 `recordingState.isRecording === true`（service worker 殘留狀態）
- **THEN** 強制重設旗標、清空 `stepQueue`、把 `arrivalSeq` 歸零後再建立新 session
