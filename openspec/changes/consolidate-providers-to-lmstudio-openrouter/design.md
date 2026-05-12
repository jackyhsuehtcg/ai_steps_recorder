## Context

原本 `ai-provider-integration` capability 支援 5 個 provider:LM Studio、Ollama、OpenAI、Gemini、Anthropic。背景程式碼為每個雲端 provider 各自維護 request body、auth header、JSON 解析、SSE 解析四條分支;`host_permissions` 也對應列出五個雲端端點。

本次變更把 provider 收斂為 2 個:

- **LM Studio**:本地 OpenAI 相容入口。Ollama 被移除但其協定 1:1 與 LM Studio 相同,使用者只要把 LM Studio 的 API URL 改指 `localhost:11434/v1/chat/completions` 即可繼續使用 Ollama 模型。
- **OpenRouter**:雲端聚合入口。OpenAI / Anthropic / Gemini 三家模型透過 OpenRouter 一把 Key 即可使用,不需直連各家 API。

## Goals / Non-Goals

**Goals:**
- 把 5 個 provider 簡化為 2 個,所有對外流量都走 OpenAI Chat Completions 相容協定。
- 雲端流量集中到 OpenRouter 一個 host(`https://openrouter.ai/*`)。
- 既有使用者升級時不會卡死:偵測到舊 `provider` 自動降級到 LM Studio 預設並提示。
- OpenSpec 規格與 host_permissions 同步更新。

**Non-Goals:**
- 不為 OpenRouter 額外設計模型搜尋 / 計價 / route preference 等進階功能。
- 不保留 Gemini / Anthropic / OpenAI / Ollama 設定值的「未來可重新啟用」開關;移除即移除。
- 不對歷史 session 中已存的 `llmProvider` 字面值做改寫(僅顯示時退到 fallback)。
- 不把 `lmstudio` 重新命名為 `local` 或類似的通稱;雖然其實它現在等同任何 OpenAI 相容本地端點,但保留現有名稱避免雙重 migration。

## Decisions

### Decision 1:LM Studio 與 OpenRouter 共用同一條程式碼分支

兩者都是 OpenAI Chat Completions 1:1 相容(`/v1/chat/completions`、`messages`、`max_tokens`、Bearer auth、`choices[0].message.content`、SSE delta 串流)。

**做法**:`background.js` 與 `settings.js` 的 switch case 把 `'lmstudio'` 與 `'openrouter'` 放在同一分支。對 `'openrouter'` 額外設置可選 `HTTP-Referer` + `X-Title` header。

**理由**:既然協定一致就不該人為製造分支;唯一差別是「是否需要 API Key」與「是否帶歸因 header」,用一兩個 if 就能處理。

### Decision 2:requiresKey 收斂為 OpenRouter 唯一一個

- `lmstudio`:本地服務,使用者多半未設 Key,不檢查。
- `openrouter`:雲端服務,所有請求都需 Key。

陣列從 `['openai', 'gemini', 'anthropic']` → `['openrouter']`。

### Decision 3:Ollama 使用者改用 LM Studio 欄位

Ollama 與 LM Studio 都是本地 OpenAI 相容伺服器,使用者只需把 LM Studio provider 的 API URL 改成 `http://localhost:11434/v1/chat/completions` 即可。

**做法**:在 settings.js 的 `loadSettings` migration 提示中,對 `provider === 'ollama'` 額外提示「想繼續用 Ollama,請保留 LM Studio provider 並把 API URL 改為 `http://localhost:11434/v1/chat/completions`」。

**Trade-off**:UI 上不再有 Ollama 標籤,使用者需理解「LM Studio 其實是任意 OpenAI 相容本地端點」。文件(README、settings 頁 hint)會同步說明。

### Decision 4:host_permissions 收斂為 2 個 LLM 端點

從:
- `http://localhost:1234/*`(LM Studio)
- `http://localhost:11434/*`(Ollama)
- `https://api.openai.com/*`
- `https://generativelanguage.googleapis.com/*`
- `https://api.anthropic.com/*`
- `http://*/*` / `https://*/*`(任意網站錄製需要)

收斂為:
- `http://localhost:1234/*`(LM Studio 預設)
- `https://openrouter.ai/*`
- `http://*/*` / `https://*/*`

**注意**:Ollama 預設端點 `localhost:11434` 從 host_permissions 移除後,使用者要連 Ollama 仍可運作,因為通用 `http://*/*` 已涵蓋 localhost。但 `manifest.json` 顯式列出 `localhost:1234` 是給 Chrome `chrome://extensions/` 顯示用,使用者看到清單就知道「這是 LM Studio」。

### Decision 5:OpenRouter 模型欄位改為自由填入(input + datalist)

OpenRouter 平台模型清單每週都在變,寫死下拉清單會過時。但完全去除建議又少了 onboarding 友善度。

**做法**:OpenRouter catalog 加 `freeFormModel: true` 旗標;`updateProviderFields` 在這個旗標為真時把 modelName 欄位渲染為 `<input type="text" list="...">` + `<datalist>`,選項取自原本的 `models` 陣列(語意改為「建議清單」)。LM Studio 仍維持 `<select>` 下拉。

**理由**:
- 自由文字輸入 → 使用者隨時可填入 OpenRouter 新上架的模型,不需等 catalog 更新。
- datalist 建議清單 → 不熟悉 OpenRouter model id 命名(`<provider>/<model-name>`)的使用者仍有 5–8 個常見模型可選,不影響 onboarding。
- 旗標在 catalog 而非寫死於 UI 邏輯 → 未來若再有 provider 也想走自由填入,只要加 `freeFormModel: true` 即可。

### Decision 6:遷移採「靜默降級到 LM Studio + 一次性提示」

不嘗試自動把舊 provider 改寫為 OpenRouter(key 與 model 字串都不同),而是:

- `settings.js` 載入時偵測 `provider in ['gemini', 'anthropic', 'openai', 'ollama']` → 直接覆蓋為 `lmstudio` 預設值並寫回 storage。
- 載入後在頁面頂端顯示一次性藍色 panel,訊息依舊 provider 微調:
  - `gemini` / `anthropic` / `openai`:「先前選用的 <Name> 已停止支援,已切回 LM Studio,請改選 OpenRouter 或其他 provider」
  - `ollama`:「先前選用的 Ollama 已停止支援,已切回 LM Studio。如要繼續使用 Ollama,請保留 LM Studio provider 並把 API URL 改為 `http://localhost:11434/v1/chat/completions`」

**理由**:LM Studio 預設(local、無 Key)是最安全的 fallback;訊息中明示替代路徑讓使用者自行決定下一步。

## Risks / Trade-offs

- **風險:現有 Ollama 使用者升級後看不到 Ollama 標籤,可能誤以為失去支援**
  - 緩解:遷移提示明示替代路徑;README 與 settings 頁 hint 補充說明。
- **風險:現有 OpenAI 使用者升級後需重新註冊 OpenRouter 帳號**
  - 緩解:遷移提示明示「請改選 OpenRouter」;OpenRouter 也接受 OpenAI 自家 Key 透過 `BYO Key` 機制使用,使用者可重用既有 OpenAI Key。
- **Trade-off:單點失效風險集中到 OpenRouter**
  - OpenRouter 中斷時所有雲端模型都無法使用;但本 extension 仍能切到 LM Studio 本地路徑,不會完全失效。
- **Trade-off:Ollama 與 LM Studio UI 標籤合一**
  - 不熟悉的使用者可能不知道 LM Studio 欄位也能配 Ollama;靠 hint + README 說明補足。
