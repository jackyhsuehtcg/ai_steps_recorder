## Why

把擴充功能對外的 LLM 接口縮減到「兩個 provider，各司其職」：

- **LM Studio**（local，OpenAI 相容）：對應「離線 / 自架 / 隱私要求高」的使用情境。LM Studio 與 Ollama 協定相同，使用者可把 LM Studio 的 API URL 欄位指向 `localhost:11434/v1/chat/completions` 即可繼續使用 Ollama 模型，因此 Ollama 不需獨立 catalog。
- **OpenRouter**（cloud aggregator）：用一把 Key 取得對 Anthropic / Google / OpenAI / Llama / DeepSeek 等多家模型的存取,取代直連 OpenAI / Gemini / Anthropic 三條獨立分支。

整併效果:

- 5 個 provider → 2 個。
- 3 條雲端程式碼分支(OpenAI / Gemini / Anthropic)→ 1 條 OpenAI 相容分支即可服務 LM Studio 與 OpenRouter。
- Manifest `host_permissions` 中對外 LLM 端點從 5 條縮成 2 條,安裝時的權限提示更短。

## What Changes

- **REMOVE**:Gemini / Anthropic / OpenAI / Ollama 共 4 個 provider 的所有支援(catalog、請求組裝、認證 header、JSON / SSE 解析、smoke test 解析、UI 顯示名、host permissions)。
- **ADD**:OpenRouter provider,採 OpenAI Chat Completions 相容協定,預設端點 `https://openrouter.ai/api/v1/chat/completions`,認證走 `Authorization: Bearer <apiKey>`,可選送 `HTTP-Referer` 與 `X-Title` 兩個歸因 header。
- **MIGRATE**:使用者既有設定若 `provider` 為 `gemini` / `anthropic` / `openai` / `ollama` 之一,下次開啟設定頁時系統 SHALL 自動切回預設 `lmstudio` 並以提示通知使用者。

## Capabilities

### New Capabilities

無(`openrouter` 屬於 `ai-provider-integration` 既有 capability 的擴充)。

### Modified Capabilities

- `ai-provider-integration`:移除 4 個 provider 的 catalog / request body / auth header / 回應解析 / smoke test;新增 OpenRouter;保留 `lmstudio` 作為唯一本地 OpenAI 相容入口。
- `extension-orchestration`:`host_permissions` 移除 `https://generativelanguage.googleapis.com/*`、`https://api.anthropic.com/*`、`https://api.openai.com/*`、`http://localhost:11434/*`,新增 `https://openrouter.ai/*`。
- `result-and-history-ui`:popup / history / result viewer / settings 四處 provider 顯示名映射收斂為 2 項;settings 頁 provider 下拉只剩 LM Studio / OpenRouter。

## Impact

- **使用者**:曾選 4 個被移除 provider 之一的使用者重啟後會被導回 LM Studio 預設並看到提示。
  - 仍想用 Ollama 的使用者:保留 LM Studio provider,把 API URL 改為 `http://localhost:11434/v1/chat/completions` 即可(協定 1:1 相容)。
  - 仍想用 OpenAI / Gemini / Anthropic 模型的使用者:改選 OpenRouter,輸入 OpenRouter Key,模型字串選 `openai/gpt-5` / `google/gemini-2.5-flash` / `anthropic/claude-sonnet-4` 等。
- **程式碼**:`extension/settings.js`、`extension/settings.html`、`extension/background.js`、`extension/manifest.json`、`extension/popup.js`、`extension/history.js`、`extension/result-viewer.js`。
- **規格文件**:`openspec/specs/ai-provider-integration/spec.md`、`openspec/specs/extension-orchestration/spec.md`、`openspec/specs/result-and-history-ui/spec.md`,並更新 `openspec/config.yaml` 的 provider 清單與 `openspec/README.md`。
- **不影響**:錄製器、selector 生成、code generation 規則式 fallback、session 儲存格式(既有 session record 中 `llmProvider` 字面值仍可顯示,只是字面值不會再被新錄製產生)。
