## MODIFIED Requirements

### Requirement: Popup 顯示與設定保存

The system SHALL 在 popup 中顯示目前 provider/model、錄製模式 radio、輸出格式 radio、錄製狀態與按鈕；任何 radio 變更即時寫入 `chrome.storage.sync`。

僅「顯示目前 LLM」子情境的 provider 名稱對照表更新；其他情境不變。

#### Scenario: 顯示目前 LLM（更新後）

- **WHEN** popup 載入
- **THEN** 從 sync storage 讀取 `provider` 與 `modelName`
- **AND** 在頁面顯示 provider 的友善名稱：
  - `lmstudio` → `LM Studio`
  - `openrouter` → `OpenRouter`
  - 不再支援 `ollama` / `openai` / `gemini` / `anthropic`（**REMOVED**）
  - 任何不在上述列表的 `provider` 直接顯示原始字面值（後向相容歷史 session）
- **AND** 在下方顯示 modelName，缺值時顯示 `Default model`

### Requirement: Settings 表單

The system SHALL 在 settings 頁面提供 provider 下拉、API URL、模型名稱（依 provider 動態切換為下拉）、API Key、Temperature、Max Tokens 等欄位，並依 provider 屬性條件化顯示。

「切換 provider」子情境涉及的下拉選項清單更新；增補載入時的「降級偵測」子情境。

#### Scenario: 載入既有設定（更新後）

- **WHEN** settings 頁載入
- **THEN** 從 sync storage 讀取現有 settings
- **AND** 若 `provider` 為 `'gemini'` / `'anthropic'` / `'openai'` / `'ollama'` 之一，自動覆寫為 `'lmstudio'` 並寫回 storage
- **AND** 顯示一次性藍色 panel 提示，文字依舊 provider 微調（見 ai-provider-integration spec 「提示訊息依 provider 微調」）
- **AND** 依目前 `provider` 呼叫 `updateProviderFields(provider)` 更新欄位

#### Scenario: 切換 provider（更新後）

- **WHEN** 使用者改變 provider 下拉
- **THEN** provider 下拉只包含 2 個選項：LM Studio / OpenRouter
- **AND** API URL 欄位填入該 provider 預設端點
- **AND** modelName 欄位依 provider 的 `freeFormModel` 旗標決定渲染型別：
  - `freeFormModel: true`（OpenRouter）→ 重建為 `<input type="text">` + `<datalist>`，datalist 選項取自 `models`，input 預填 `defaultModel`，使用者可從建議挑選或自由輸入任意模型字串
  - `freeFormModel: false / 缺值`（LM Studio）→ 重建為 `<select>` 下拉，選項取自 `models`，預選 `defaultModel`
- **AND** 切換 provider 時清掉殘留的舊 `<datalist>` 元素，避免 ID 重複
- **AND** modelName 欄位下方的 hint 文字依旗標切換：
  - OpenRouter：「輸入 OpenRouter 支援的模型字串，可從建議清單挑選或自由填寫」
  - LM Studio：「選擇 LM Studio 模型」
- **AND** OpenRouter 的 `requiresKey` 為 true；LM Studio 的 `requiresKey` 為 false

### Requirement: History 列表

The system SHALL 在 history 頁面顯示所有 session 的卡片列表，依 `createdAt` 倒序排序，並支援搜尋與篩選。

僅「卡片內容」子情境的 LLM badge 名稱對照更新。

#### Scenario: 卡片內容（更新後）

- **WHEN** 渲染一筆 session 卡片
- **THEN** LLM badge 名稱對照：
  - `lmstudio` → `LM Studio`
  - `openrouter` → `OpenRouter`
  - 不再列在對照表中的 `ollama` / `openai` / `gemini` / `anthropic`：歷史紀錄的 badge 直接顯示原始 provider 字面值（**REMOVED 對照**）
- **AND** 模型名顯示去除 `claude-` / `gpt-` / `gemini-` 前綴與 `anthropic/` / `openai/` / `google/` / `meta-llama/` / `deepseek/` 等 OpenRouter prefix 的縮寫

### Requirement: Result Viewer 內容渲染

The system SHALL 在 session 資料就緒時顯示 metadata、生成程式碼、步驟列表。

僅「Session metadata」子情境的 LLM 顯示對照更新。

#### Scenario: Session metadata（更新後）

- **WHEN** 渲染 session
- **THEN** LLM 顯示對照：
  - `lmstudio` → `LM Studio`
  - `openrouter` → `OpenRouter`
  - 不再對應的 `ollama` / `openai` / `gemini` / `anthropic`：直接顯示原始字面值（後向相容）
- **AND** 顯示為 `<providerName> (<model>)`，當 model 為 `lm-studio` 時省略括號（既有規則不變）
