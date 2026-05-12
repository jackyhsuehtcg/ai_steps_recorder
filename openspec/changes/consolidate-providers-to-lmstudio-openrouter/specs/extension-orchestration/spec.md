## MODIFIED Requirements

### Requirement: Manifest 宣告

The system SHALL 在 `manifest.json` 中宣告 Manifest V3、所需權限、host permissions、content script 注入規則、background service worker 與 options page。

只有 host permissions 的雲端與本地 LLM 端點清單變更；其他子情境不變。

#### Scenario: Host permissions（更新後）

- **WHEN** Chrome 解析 manifest
- **THEN** `host_permissions` 包含：
  - `http://localhost:1234/*`（LM Studio 預設端點）
  - `https://openrouter.ai/*`（**ADDED**）
  - `http://*/*` 與 `https://*/*`（讓使用者可在任意網站錄製，亦涵蓋 Ollama 等其他本地端點若使用者手動切換 URL）
- **AND** 不再包含下列項目（**REMOVED**）：
  - `http://localhost:11434/*`（Ollama 預設端點）
  - `https://api.openai.com/*`
  - `https://generativelanguage.googleapis.com/*`
  - `https://api.anthropic.com/*`
