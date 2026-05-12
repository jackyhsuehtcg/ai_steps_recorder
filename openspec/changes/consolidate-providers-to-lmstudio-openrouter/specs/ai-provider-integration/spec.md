## REMOVED Requirements

### Requirement: Provider Catalog（Gemini / Anthropic / OpenAI / Ollama 子情境）

**Reason for removal:** 雲端 provider 統一改由 OpenRouter 聚合；本地 Ollama 因與 LM Studio 協定相同改為由 LM Studio provider 欄位代表。catalog 不再列出這 4 項。

該 requirement 整體保留（仍描述 Provider Catalog 的存在與必填欄位），但下列 scenarios 移除：
- `Scenario: Ollama`
- `Scenario: OpenAI`
- `Scenario: Google Gemini`
- `Scenario: Anthropic`

### Requirement: 請求 Body 形狀（移除 4 個 provider 子情境）

**Reason for removal:** 4 個 provider 移除後，背景與設定頁的 switch 不再需要為其組裝 body。

下列 scenarios 移除：
- `Scenario: OpenAI 相容（含 LM Studio / Ollama）` 的 OpenAI / Ollama 描述
- `Scenario: Gemini`
- `Scenario: Anthropic`

### Requirement: 認證標頭與 URL 參數（移除 4 個 provider 子情境）

**Reason for removal:** OpenAI 自家 Bearer 與 Ollama 無 Key 分支隨 provider 一併移除；Gemini 的 URL `?key=` 與 Anthropic 的 3 組 header 同樣移除。

下列 scenarios 移除：
- `Scenario: OpenAI / LM Studio / Ollama 用 Bearer` 的 OpenAI / Ollama 部分
- `Scenario: Gemini 用 URL 查詢參數`
- `Scenario: Anthropic 用三個 header`

### Requirement: 回應內容解析（移除 4 個 provider 子情境）

**Reason for removal:** 不再對應的 JSON 結構解析路徑。

下列 scenarios 移除：
- `Scenario: OpenAI 相容 JSON 結構` 的 OpenAI / Ollama 描述
- `Scenario: Gemini JSON 結構`
- `Scenario: Anthropic JSON 結構`

### Requirement: SSE 串流解析（移除 4 個 provider 子情境）

**Reason for removal:** 不再對應的串流格式分支。

`Scenario: 解析 SSE 行` 中對 `openai` / `ollama` / `gemini` / `anthropic` 的 case 列表移除。

### Requirement: 連線測試（smoke test）（移除 4 個 provider 子情境）

**Reason for removal:** 設定頁不再支援這 4 個 provider，連帶其 smoke test 解析。

`Scenario: 測試成功` 中對 `openai` / `ollama` / `gemini` / `anthropic` 的 JSON 結構解析分支移除。

## ADDED Requirements

### Requirement: OpenRouter Provider 支援

The system SHALL 支援 OpenRouter 作為唯一雲端 LLM 聚合 provider，採 OpenAI Chat Completions 相容協定。

#### Scenario: OpenRouter Catalog

- **WHEN** 使用者在設定頁選擇 OpenRouter
- **THEN** catalog 提供：
  - `name: 'OpenRouter'`
  - `apiUrl: 'https://openrouter.ai/api/v1/chat/completions'`
  - `models`: 建議模型字串清單（**作為 datalist 建議使用，非限制使用者只能填這些值**），包含 Claude / GPT / Gemini / Llama / DeepSeek 系列
  - `defaultModel`: Claude Sonnet 系列其中一個（作為輸入欄預填值）
  - `requiresKey: true`
  - `parameterName: 'max_tokens'`
  - `freeFormModel: true`（指示 UI 把 modelName 欄位渲染為 `<input>` + `<datalist>` 而非 `<select>`）

#### Scenario: 請求 Body 與 LM Studio 共用形狀

- **WHEN** provider 為 `openrouter`
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
- **AND** body 形狀與 LM Studio 完全一致（同分支處理）

#### Scenario: 認證走 Bearer

- **GIVEN** provider 為 `openrouter`，`apiKey` 非空
- **WHEN** 發出請求
- **THEN** 設定 `Authorization: Bearer <apiKey>` header

#### Scenario: 可選歸因 header

- **GIVEN** provider 為 `openrouter`
- **WHEN** 發出請求
- **THEN** 額外設定下列 header：
  - `HTTP-Referer: chrome-extension://<chrome.runtime.id>`
  - `X-Title: AI Steps Recorder`
- **AND** 兩個 header 缺值或請求失敗時不阻擋主流程

#### Scenario: 回應與 LM Studio 同結構

- **WHEN** provider 為 `openrouter` 且回應為 JSON
- **THEN** 抽取 `data.choices[0].message.content`（與 LM Studio 同分支）

#### Scenario: SSE 串流與 LM Studio 同結構

- **WHEN** provider 為 `openrouter` 且回應為 SSE
- **THEN** 累積 `choices[].delta.content`、`choices[].message.content`、`choices[].text`（與 LM Studio 同分支）

#### Scenario: 連線測試

- **WHEN** 使用者在設定頁對 OpenRouter 點擊測試按鈕
- **THEN** 以 prompt `測試連接：請回應 'OK'` 與 `max_tokens: 50` 發出請求
- **AND** 從 `data.choices[0].message.content` 抽出 `responseContent`
- **AND** 顯示綠色 panel `✅ 連接測試成功！` 與 `回應：<responseContent>`

### Requirement: 既有舊 provider 設定降級

The system SHALL 在偵測到使用者既有設定的 `provider` 為 `'gemini'` / `'anthropic'` / `'openai'` / `'ollama'` 任一時，自動降級為預設 `lmstudio` 並一次性通知使用者，提示文字依舊 provider 微調。

#### Scenario: 設定頁載入時降級

- **GIVEN** `chrome.storage.sync` 中既有 `provider` 為 4 個被移除 provider 之一
- **WHEN** 設定頁 `loadSettings()` 執行
- **THEN** 把 `currentSettings` 的 `provider` 覆寫為 `'lmstudio'`、`apiUrl` 改為 `'http://localhost:1234/v1/chat/completions'`、`modelName` 改為 `'lm-studio'`
- **AND** 將降級後的設定寫回 `chrome.storage.sync`
- **AND** 在頁面頂端顯示一次性藍色 panel

#### Scenario: 提示訊息依 provider 微調

- **GIVEN** 觸發降級
- **WHEN** 顯示提示
- **THEN** 對 `gemini` / `anthropic` / `openai`：「先前選用的 <Name> 已停止支援，已切回 LM Studio，請改選 OpenRouter 或其他 provider」
- **AND** 對 `ollama`：「先前選用的 Ollama 已停止支援，已切回 LM Studio。如要繼續使用 Ollama，請保留 LM Studio provider 並把 API URL 改為 `http://localhost:11434/v1/chat/completions`」

#### Scenario: Popup 顯示遇到未知 provider

- **GIVEN** `chrome.storage.sync` 中 `provider` 不在已知 2 個（`lmstudio` / `openrouter`）內
- **WHEN** popup 渲染目前 LLM 區塊
- **THEN** provider 名稱直接顯示原始字面值（避免崩潰，並後向相容歷史 session）
- **AND** modelName 缺值時顯示 `Default model`

## MODIFIED Requirements

### Requirement: API Key 強制檢查

The system SHALL 在發出任何 LLM 請求前，對 `requiresKey === true` 的 provider 檢查使用者是否已設定 API Key；缺少時拋出明確錯誤。

#### Scenario: 雲端 provider 缺少 Key（更新後）

- **GIVEN** provider 為 `openrouter`，且 `apiKey` 為空字串
- **WHEN** 嘗試發出 LLM 請求
- **THEN** 拋出錯誤 `API Key for openrouter is not set. Please configure it in the extension settings.`
- **AND** 不發出網路請求

#### Scenario: 本地 provider 不要求 Key（不變）

- **GIVEN** provider 為 `lmstudio`，`apiKey` 為空字串
- **WHEN** 發出 LLM 請求
- **THEN** 正常發出（沒有 Key 不阻擋）

### Requirement: 不支援的 provider

The system SHALL 把 catalog 之外的 provider 視為錯誤組態。

#### Scenario: 不支援的 provider（更新後）

- **WHEN** provider 不在 2 個支援列表（`lmstudio` / `openrouter`）中
- **THEN** 拋出 `Unsupported AI provider selected.`
