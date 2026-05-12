# 結果與歷史 UI (Result and History UI) Specification

## Purpose

本 capability 涵蓋擴充功能對使用者直接可見的四個介面頁面：

1. **Popup**（`popup.html`）：點擊瀏覽器工具列圖示開啟，提供模式／格式選擇、目前 LLM 顯示、開始／停止錄製、跳轉到設定與歷史。
2. **Settings**（`settings.html`，options page）：AI provider 與模型設定、API URL / Key、Temperature / max tokens、連線測試。
3. **History**（`history.html`）：歷次 session 列表、篩選與搜尋、檢視程式碼、匯出 JSON、刪除。
4. **Result Viewer**（`result-viewer.html`）：單筆 session 的 metadata、步驟列表、生成程式碼顯示、one-time 模式進度條、複製／下載／匯出。

範圍**不含**：頁面內 UI 邏輯背後的訊息處理（屬於 [extension-orchestration](../extension-orchestration/spec.md)）、provider catalog 與測試請求協定（屬於 [ai-provider-integration](../ai-provider-integration/spec.md)）、storage 結構（屬於 [session-persistence](../session-persistence/spec.md)）、錄製器內 UI（屬於 [recorder-overlay](../recorder-overlay/spec.md)）。

## Requirements

### Requirement: Popup 顯示與設定保存

The system SHALL 在 popup 中顯示目前 provider/model、錄製模式 radio、輸出格式 radio、錄製狀態與按鈕；任何 radio 變更即時寫入 `chrome.storage.sync`。

#### Scenario: 顯示目前 LLM

- **WHEN** popup 載入
- **THEN** 從 sync storage 讀取 `provider` 與 `modelName`
- **AND** 在頁面顯示 provider 的友善名稱（LM Studio / Ollama / OpenAI / Google Gemini / Anthropic Claude）
- **AND** 在下方顯示 modelName，缺值時顯示 `Default model`

#### Scenario: 模式 / 格式 radio 即時保存

- **WHEN** 使用者切換 `recordMode` 或 `outputFormat` radio
- **THEN** 立即將兩者寫回 `chrome.storage.sync`（`{ recordMode, outputFormat }`）

#### Scenario: 預設值與相容性處理

- **WHEN** 從 storage 讀到的 `outputFormat` 不在 `['javascript','python','pytest']` 中
- **THEN** 使用 `'javascript'` 作為預設值（保留向前相容）

### Requirement: Popup 錄製狀態同步

The system SHALL 在 popup 開啟時查詢目前錄製狀態並切換按鈕文字與顏色；點擊按鈕觸發開始或停止流程。

#### Scenario: popup 開啟時查詢狀態

- **WHEN** popup 載入
- **THEN** 先送 `getRecordingState` 給背景服務
- **AND** 若回應顯示正在錄製，將按鈕文字改為「Stop Recording」加上 `btn-danger` class、狀態文字「Recording...」
- **AND** 否則進一步對 active tab 送 `getStatus`，若 content script 顯示錄製中也視為錄製中
- **AND** 兩者都顯示未錄製時，按鈕為「Start Recording」、狀態「Ready」

#### Scenario: 切換錄製

- **WHEN** 使用者點擊主按鈕
- **THEN** 先儲存當前 radio 設定
- **AND** 查詢背景錄製狀態：
  - 若正在錄製 → 對背景送 `stopRecording`，並對 active tab 送 `stopRecording` 通知 content script
  - 若未錄製 → 對背景送 `startRecording { settings, tabId }`，並對 active tab 送 `startRecording { settings }`
- **AND** 依結果更新狀態文字與按鈕樣式

#### Scenario: 開啟設定／歷史

- **WHEN** 使用者點擊「History」按鈕
- **THEN** 開新分頁 `chrome.runtime.getURL('history.html')`
- **WHEN** 使用者點擊「Settings」按鈕
- **THEN** 開新分頁 `chrome.runtime.getURL('settings.html')`

### Requirement: Settings 表單

The system SHALL 在 settings 頁面提供 provider 下拉、API URL、模型名稱（依 provider 動態切換為下拉）、API Key、Temperature、Max Tokens 等欄位，並依 provider 屬性條件化顯示。

#### Scenario: 載入既有設定

- **WHEN** settings 頁載入
- **THEN** 從 sync storage 讀取現有 settings 並填入表單
- **AND** 依目前 `provider` 呼叫 `updateProviderFields(provider)` 更新 API URL 預填、模型下拉內容、API Key 是否必填

#### Scenario: 切換 provider

- **WHEN** 使用者改變 provider 下拉
- **THEN** API URL 欄位填入該 provider 預設端點
- **AND** modelName 欄位重建為下拉選單，選項為該 provider 的 `models`，預選 `defaultModel`
- **AND** 模型 hint 文字改為「選擇 <providerName> 模型」
- **AND** 若 provider `requiresKey`，API Key 欄位 `required = true`、hint 為「<providerName> API Key (必填)」、label 加 `*`
- **AND** 否則 `required = false`，hint 為「<providerName> API Key (選填，本地服務通常不需要)」

#### Scenario: 即時 URL 驗證

- **WHEN** 使用者輸入 API URL 字串
- **THEN** 嘗試 `new URL(value)`；若拋例外且輸入非空，設定 `customValidity` 為「請輸入有效的 URL 格式」
- **AND** 通過驗證或欄位空白時清除 `customValidity`

#### Scenario: 儲存表單

- **WHEN** 使用者送出 form
- **THEN** 取出 `provider` / `apiUrl` / `modelName`（缺值用 `'lm-studio'`）/ `apiKey` / `temperature`（缺值用 `0.1`）/ `maxTokens`（缺值用 `2000`）
- **AND** 先驗證 `apiUrl` 為有效 URL，無效時顯示「請輸入有效的 API URL」紅色 panel 並中止
- **AND** 寫入 `chrome.storage.sync`
- **AND** 顯示綠色 panel「設定已成功儲存！」

#### Scenario: 連線測試

- **WHEN** 使用者點擊測試按鈕
- **THEN** 觸發 [ai-provider-integration](../ai-provider-integration/spec.md) 中規範的 smoke test 流程
- **AND** 測試期間鎖定按鈕、顯示「🔄 測試中...」
- **AND** 完成後依結果顯示成功或失敗 panel

### Requirement: History 列表

The system SHALL 在 history 頁面顯示所有 session 的卡片列表，依 `createdAt` 倒序排序，並支援搜尋與篩選。

#### Scenario: 載入並排序

- **WHEN** history 頁載入
- **THEN** 對背景送 `getHistory` 取得 sessions
- **AND** 以 `createdAt` 降冪排序（新→舊）
- **AND** 若清單為空顯示空狀態提示，否則渲染卡片

#### Scenario: 卡片內容

- **WHEN** 渲染一筆 session 卡片
- **THEN** 卡片至少包含：
  - `session.id` 與本地化日期時間（`zh-TW`）
  - 模式 badge：`Step-by-Step` 或 `One-time`
  - 格式 badge：`Python` 或 `JavaScript`（若 format 為其他值則顯示原始字串）
  - 步驟數 badge：`<n> steps`
  - LLM badge：友善 provider 名稱（搭配縮寫模型名，如 `Claude (4-sonnet-20250514)`）
  - 第一步驟的 url（作為錄製目標頁面提示）
  - 動作按鈕：View Code / Show Steps / Export JSON / Delete
  - 預設顯示前 5 筆步驟摘要（`type` + `selector` + `value`），多於 5 筆時顯示「... N more steps」

#### Scenario: 搜尋與篩選

- **WHEN** 使用者輸入搜尋字、切換模式或格式下拉
- **THEN** 過濾條件：
  - 搜尋字（小寫不區分大小寫）符合 `session.id` 或任一步驟的 `url`
  - 模式下拉值符合 `session.mode`（空值不過濾）
  - 格式下拉值符合 `session.format`（空值不過濾）
- **AND** 即時重新渲染卡片列表

#### Scenario: 展開步驟預覽

- **WHEN** 使用者點擊「Show Steps」按鈕
- **THEN** 切換該卡片步驟區的 `expanded` class，顯示完整步驟（不再限制 5 筆）

### Requirement: History 操作

The system SHALL 在 history 卡片上提供 View Code / Export JSON / Delete 等操作，搭配確認、複製與下載。

#### Scenario: 檢視程式碼 modal

- **WHEN** 使用者點擊「View Code」按鈕
- **THEN** 開啟全螢幕 modal 顯示 session 的 `playwrightCode`
- **AND** 若程式碼缺失，顯示佔位文字「`// No Playwright code generated // May be due to recording errors or incomplete processing`」
- **AND** 點擊 modal 外部或 X 按鈕關閉 modal

#### Scenario: 複製程式碼到剪貼簿

- **WHEN** 使用者在 modal 內點擊「Copy Code」按鈕
- **THEN** 優先使用 `navigator.clipboard.writeText`
- **AND** 失敗時退到 `execCommand('copy')` + 暫時 textarea 的 fallback
- **AND** 成功後按鈕文字改為「Copied!」1.5 秒
- **AND** 兩種途徑都失敗時顯示紅色通知「Copy failed, please manually copy the code」

#### Scenario: 下載程式碼

- **WHEN** 使用者在 modal 內點擊「Download Code」
- **THEN** 用 textarea 內容建立 Blob，副檔名依 session.format 決定（`python` → `.py`，否則 `.js`）
- **AND** 檔名為 `playwright-<sessionId>.<ext>`

#### Scenario: 匯出 JSON

- **WHEN** 使用者點擊「Export JSON」
- **THEN** 對背景送 `exportSession { sessionId, format: 'json' }`
- **AND** 從回應的 `{ content, filename, mimeType }` 建立 Blob 並觸發下載

#### Scenario: 刪除 session

- **WHEN** 使用者點擊「Delete」
- **THEN** 跳出確認對話框「Are you sure you want to delete this recording? This operation cannot be undone.」
- **AND** 確認後對背景送 `deleteSession { sessionId }`
- **AND** 成功後從本地陣列移除該筆並重新渲染、顯示綠色「Recording deleted」通知

### Requirement: Result Viewer 載入

The system SHALL 在 result viewer 開啟時依 URL 參數或最新 session 取得資料，並依模式決定是否進入產生中狀態。

#### Scenario: 從 URL 參數載入

- **WHEN** 開啟 `result-viewer.html?sessionId=<id>`
- **THEN** 從 `chrome.storage.local` 讀取對應 session
- **AND** 找不到時顯示錯誤「Cannot find specified recording session」

#### Scenario: 缺 URL 參數時退到最新 session

- **WHEN** URL 沒有 `sessionId` 參數
- **THEN** 對背景送 `getHistory` 取最新一筆 session
- **AND** 若仍無資料，顯示錯誤「No session ID specified and no latest recording result found」

#### Scenario: one-time 模式的進度狀態

- **GIVEN** session.mode 為 `one-time` 且 `playwrightCode` 缺失
- **WHEN** 頁面載入
- **THEN** 顯示「Generating」區塊（含全寬進度條、stage 文字、百分比、details 文字）
- **AND** 開始進度輪詢

### Requirement: Result Viewer 進度同步

The system SHALL 同時透過訊息事件與 storage 輪詢取得批次生成進度，並在進度達 100% 時顯示完整結果。

#### Scenario: 訊息更新進度

- **WHEN** 收到 `{ action: 'progressUpdate', sessionId, progress }` 訊息且 sessionId 相符
- **THEN** 更新 progress fill 寬度、stage 文字、百分比文字、details 文字

#### Scenario: 每秒輪詢 storage

- **WHEN** 進入「Generating」狀態
- **THEN** 每 1000 毫秒讀取一次 `progress_<sessionId>` 與 `<sessionId>` 兩個 key
- **AND** 進度資料存在時更新 UI
- **AND** session 的 `playwrightCode` 出現後呼叫 `completeGeneration()`

#### Scenario: 進度達 100% 後切換顯示

- **WHEN** 進度資料的 `progress >= 100`
- **THEN** 1.5 秒後執行 `completeGeneration()`：清除輪詢、隱藏「Generating」區塊、渲染 session 內容區

### Requirement: Result Viewer 內容渲染

The system SHALL 在 session 資料就緒時顯示 metadata、生成程式碼、步驟列表。

#### Scenario: Session metadata

- **WHEN** 渲染 session
- **THEN** 顯示：
  - `sessionId`、`recordMode`（友善名）、`outputFormat`（友善名）
  - 步驟數
  - 持續時間（`Xm Ys` 或 `Ys`，依分鐘是否 > 0）
  - 結束時間（`zh-TW` 本地化）
  - LLM 顯示（`<providerName> (<model>)`，當 model 為 `lm-studio` 時省略括號）

#### Scenario: 程式碼區

- **WHEN** session.playwrightCode 存在
- **THEN** 將其填入 read-only textarea
- **AND** 缺值時 textarea placeholder 為「No Playwright code generated」

#### Scenario: 步驟列表描述

- **WHEN** 渲染步驟列表
- **THEN** 對每筆步驟依 type 顯示描述：
  - `click` → `Click <selector>`，含 text 時加上「(\"<前 30 字>...\")」
  - `input` / `change` → `Input "<value>" in <selector>`
  - `keydown` → `Press <value> key`
  - `navigation` → `Navigate to <url>`
  - `submit` → `Submit form <selector>`
  - 其他 → `<type> operation` 或 `<type> operation on <selector>`

### Requirement: Result Viewer 操作與快捷鍵

The system SHALL 在 result viewer 提供 Copy / Download / Export Session / Close 按鈕，並支援 Ctrl/Cmd+C、Ctrl/Cmd+S、Esc 快捷鍵。

#### Scenario: 複製程式碼按鈕

- **WHEN** 使用者點擊 Copy 按鈕
- **THEN** 與 history 同樣優先使用 `navigator.clipboard.writeText`，失敗退到暫時 textarea + `execCommand('copy')`
- **AND** 兩者皆失敗時 alert「Copy failed, please manually select and copy the code」
- **AND** 成功時按鈕文字改為「Copied!」並加 `copied` class，2 秒後恢復

#### Scenario: 下載程式碼按鈕

- **WHEN** 使用者點擊 Download 按鈕
- **THEN** 用 `playwrightCode` 建立 Blob，檔名為 `playwright-test-<timestamp>.<ext>`，副檔名 `python` → `.py`、否則 `.js`

#### Scenario: 匯出整個 session

- **WHEN** 使用者點擊 Export Session 按鈕
- **THEN** 將 session 物件 JSON.stringify 為 2 空格縮排
- **AND** 用 Blob 觸發下載 `ai-steps-session-<timestamp>.json`

#### Scenario: 鍵盤快捷鍵

- **WHEN** focus 在 `#playwrightCode` 上按 Ctrl/Cmd+C
- **THEN** 執行 `copyCode()` 並阻止預設行為
- **WHEN** 任意處按 Ctrl/Cmd+S
- **THEN** 執行 `downloadCode()` 並阻止預設行為
- **WHEN** 按 Esc 鍵
- **THEN** 關閉視窗（`window.close()`）
