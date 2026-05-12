# AI Provider 整合 (AI Provider Integration) Specification

## Purpose

本 capability 涵蓋擴充功能與五個 LLM provider 之間的協定差異處理：

- **本地 provider**：LM Studio、Ollama
- **雲端 provider**：OpenAI、Google Gemini、Anthropic

責任包含：

1. 維護每個 provider 的 catalog（預設 URL、可選模型清單、預設模型、是否需要 API Key、`max_tokens` 參數名）。
2. 依 provider 組裝對應的請求 body 結構。
3. 套用對應的認證 header 或 URL 參數。
4. 解析 JSON 回應與 SSE 串流回應，從不同位置抽出文字內容。
5. 在設定頁提供連線測試（smoke test），驗證設定正確性。

範圍**不含**：用什麼 prompt 對 LLM 提問（屬於 [code-generation](../code-generation/spec.md)）、設定值的儲存（屬於 [session-persistence](../session-persistence/spec.md)）、設定頁面的表單渲染（屬於 [result-and-history-ui](../result-and-history-ui/spec.md)）。

## Requirements

### Requirement: Provider Catalog

The system SHALL 為每個支援的 provider 維護以下後設資料：`name`（顯示名）、`apiUrl`（預設端點）、`models`（可選模型清單）、`defaultModel`、`requiresKey`、`parameterName`（max-tokens 對應的欄位名）。

#### Scenario: LM Studio

- **WHEN** 使用者在設定頁選擇 LM Studio
- **THEN** catalog 提供：
  - `apiUrl: 'http://localhost:1234/v1/chat/completions'`
  - `models: ['lm-studio', 'llama-2-7b', 'llama-2-13b', 'codellama-7b']`
  - `defaultModel: 'lm-studio'`
  - `requiresKey: false`
  - `parameterName: 'max_tokens'`

#### Scenario: Ollama

- **WHEN** 使用者選擇 Ollama
- **THEN** catalog 提供：
  - `apiUrl: 'http://localhost:11434/v1/chat/completions'`
  - `models: ['llama3.2', 'llama3.1', 'llama2', 'codellama', 'mistral']`
  - `defaultModel: 'llama3.2'`
  - `requiresKey: false`
  - `parameterName: 'max_tokens'`

#### Scenario: OpenAI

- **WHEN** 使用者選擇 OpenAI
- **THEN** catalog 提供：
  - `apiUrl: 'https://api.openai.com/v1/chat/completions'`
  - `models: ['gpt-5', 'gpt-5-mini', 'gpt-4o']`
  - `defaultModel: 'gpt-5'`
  - `requiresKey: true`
  - `parameterName: 'max_completion_tokens'`

#### Scenario: Google Gemini

- **WHEN** 使用者選擇 Gemini
- **THEN** catalog 提供：
  - `apiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'`
  - `models: ['gemini-2.5-flash', 'gemini-2.5-pro']`
  - `defaultModel: 'gemini-2.5-flash'`
  - `requiresKey: true`
  - `parameterName: 'maxOutputTokens'`

#### Scenario: Anthropic

- **WHEN** 使用者選擇 Anthropic
- **THEN** catalog 提供：
  - `apiUrl: 'https://api.anthropic.com/v1/messages'`
  - `models: ['claude-4-sonnet-20250514', 'claude-3-7-sonnet-20250219']`
  - `defaultModel: 'claude-4-sonnet-20250514'`
  - `requiresKey: true`
  - `parameterName: 'max_tokens'`

### Requirement: API Key 強制檢查

The system SHALL 在發出任何 LLM 請求前，對 `requiresKey === true` 的 provider 檢查使用者是否已設定 API Key；缺少時拋出明確錯誤。

#### Scenario: 雲端 provider 缺少 Key

- **GIVEN** provider 為 `openai` / `gemini` / `anthropic`，且 `apiKey` 為空字串
- **WHEN** 嘗試發出 LLM 請求
- **THEN** 拋出錯誤 `API Key for <provider> is not set. Please configure it in the extension settings.`
- **AND** 不發出網路請求

#### Scenario: 本地 provider 不要求 Key

- **GIVEN** provider 為 `lmstudio` 或 `ollama`，`apiKey` 為空字串
- **WHEN** 發出 LLM 請求
- **THEN** 正常發出（沒有 Key 不阻擋）

### Requirement: 請求 Body 形狀

The system SHALL 為每個 provider 組裝對應的請求 body。

#### Scenario: OpenAI 相容（含 LM Studio / Ollama）

- **WHEN** provider 為 `openai` / `lmstudio` / `ollama`
- **THEN** body 為：
  ```json
  {
    "model": "<modelName>",
    "messages": [{ "role": "user", "content": "<prompt>" }],
    "temperature": <temperature>,
    "max_tokens": <maxTokens>,
    "stream": false
  }
  ```
- **AND** 設定頁的 `buildRequestBody` 會以 `provider.parameterName` 動態決定 token 欄位名（OpenAI 用 `max_completion_tokens`），而背景程式碼路徑統一使用 `max_tokens`

#### Scenario: Gemini

- **WHEN** provider 為 `gemini`
- **THEN** body 為：
  ```json
  {
    "contents": [{ "parts": [{ "text": "<prompt>" }] }],
    "generationConfig": {
      "temperature": <temperature>,
      "maxOutputTokens": <maxTokens>
    }
  }
  ```

#### Scenario: Anthropic

- **WHEN** provider 為 `anthropic`
- **THEN** body 為：
  ```json
  {
    "model": "<modelName>",
    "messages": [{ "role": "user", "content": "<prompt>" }],
    "max_tokens": <maxTokens>,
    "temperature": <temperature>
  }
  ```

#### Scenario: 不支援的 provider

- **WHEN** provider 不在 5 個支援列表中
- **THEN** 拋出 `Unsupported AI provider selected.`

### Requirement: 認證標頭與 URL 參數

The system SHALL 依 provider 套用對應的認證方式。

#### Scenario: OpenAI / LM Studio / Ollama 用 Bearer

- **GIVEN** provider 為 `openai` / `lmstudio` / `ollama`，且 `apiKey` 非空
- **WHEN** 發出請求
- **THEN** 設定 `Authorization: Bearer <apiKey>` header

#### Scenario: Gemini 用 URL 查詢參數

- **GIVEN** provider 為 `gemini`，且 `apiKey` 非空
- **WHEN** 發出請求
- **THEN** 將 `?key=<apiKey>` 附加到 URL（若 URL 已含 `?` 則改用 `&`）
- **AND** 不設定 `Authorization` header

#### Scenario: Anthropic 用三個 header

- **GIVEN** provider 為 `anthropic`，且 `apiKey` 非空
- **WHEN** 發出請求
- **THEN** 設定下列 header：
  - `x-api-key: <apiKey>`
  - `anthropic-version: 2023-06-01`
  - `anthropic-dangerous-direct-browser-access: true`

### Requirement: 回應內容解析

The system SHALL 從每個 provider 的 JSON 回應結構抽出文字內容。

#### Scenario: OpenAI 相容 JSON 結構

- **WHEN** provider 為 `openai` / `lmstudio` / `ollama` 且回應為 JSON
- **THEN** 依以下優先序抽取：
  1. `data.choices[0].message.content`
  2. `data.choices[0].text`
  3. `data.choices[0].delta.content`
- **AND** 找不到任一欄位時視為解析失敗

#### Scenario: Gemini JSON 結構

- **WHEN** provider 為 `gemini` 且回應為 JSON
- **THEN** 抽取 `data.candidates[0].content.parts[0].text`

#### Scenario: Anthropic JSON 結構

- **WHEN** provider 為 `anthropic` 且回應為 JSON
- **THEN** 抽取 `data.content[0].text`

#### Scenario: 非 OK 回應拋錯

- **WHEN** HTTP 狀態碼不是 2xx
- **THEN** 讀取錯誤文字（無法讀取時填預設訊息）並拋出 `<provider> 連接失敗 (<status>): <errorText>`（批次路徑）或 `<provider> API request failed (<status>): <errorText>`（單步路徑）

### Requirement: SSE 串流解析

The system SHALL 在回應 Content-Type 非 JSON、或 JSON 解析失敗時，嘗試以 Server-Sent Events 格式解析，逐行累積文字內容。

#### Scenario: 解析 SSE 行

- **WHEN** 回應內含以 `data: ` 開頭的多行
- **THEN** 對每行：
  - 若 payload 為 `[DONE]` 則停止累積
  - 否則 JSON.parse payload
  - 對 `openai` / `lmstudio` / `ollama`：累積 `choices[].delta.content`、`choices[].message.content`、`choices[].text`
  - 對 `gemini`：累積 `candidates[0].content.parts[0].text`
  - 對 `anthropic`：累積 `content_block_delta.delta.text` 與 `content_block_start.content_block.text`

#### Scenario: 兩階段 fallback

- **WHEN** Content-Type 為 JSON 解析正常
- **THEN** 直接走 JSON 路徑
- **AND** 若 Content-Type 非 JSON，先嘗試 `JSON.parse(text)`，失敗再嘗試 SSE 解析
- **AND** 若兩者都失敗，最終回傳 trim 後的原始文字

#### Scenario: 串流 reader 兜底

- **WHEN** 上述路徑全部拋例外
- **THEN** 嘗試以 `response.body.getReader()` 增量讀取整段 body 後，再用 SSE 或 JSON 解析
- **AND** 若仍失敗，重新拋出原始例外

### Requirement: 連線測試（smoke test）

The system SHALL 在設定頁提供「測試連接」按鈕，使用使用者目前填入的設定向 provider 發出小型請求，並依 provider 解析回應。

#### Scenario: 測試請求內容

- **WHEN** 使用者點擊測試按鈕
- **THEN** 使用 prompt `測試連接：請回應 'OK'` 與 maxTokens=50
- **AND** 依 provider 組裝對應 body 與 headers
- **AND** 對 Gemini 把 `?key=<apiKey>` 加到 URL

#### Scenario: 測試成功

- **WHEN** 收到 2xx 回應
- **THEN** 從對應 provider 的 JSON 結構抽出 `responseContent`
- **AND** 在頁面顯示綠色 panel：`✅ 連接測試成功！` 與 `回應：<responseContent>`
- **AND** 5 秒後自動隱藏成功訊息

#### Scenario: 測試失敗

- **WHEN** 拋出例外或 HTTP 非 2xx
- **THEN** 在頁面顯示紅色 panel：`❌ 連接測試失敗：<message>`
- **AND** 若例外為 `TypeError` 含 `fetch` 字樣，顯示「無法連接到伺服器，請檢查 URL 是否正確且伺服器正在運行」
- **AND** 失敗訊息不自動隱藏（讓使用者看清楚）

#### Scenario: 測試期間鎖按鈕

- **WHEN** 測試進行中
- **THEN** 按鈕文字改為「🔄 測試中...」並 `disabled`
- **AND** 完成或失敗後恢復原始文字與狀態
