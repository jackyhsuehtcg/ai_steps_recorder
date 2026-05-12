# OpenSpec — AI Steps Recorder

本目錄是 [AI Steps Recorder](../README.md) 的 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 規格快照，紀錄目前已實作的行為，作為日後變更的基準。

## 為什麼有這個目錄

- **可驗證的需求快照**：把分散在程式碼中的隱性行為轉成具名 Requirement / Scenario，未來改動時可逐項對照。
- **AI 協作的共同上下文**：當你請 AI 助手改功能時，可指定它讀對應的 `specs/<capability>/spec.md` 而不是整份原始碼。
- **變更紀錄的脊椎**：所有未來的功能新增、修改、移除走 `changes/<change-name>/` 流程，留下「為何改」的脈絡。

## 目錄結構

```
openspec/
├── config.yaml          # OpenSpec schema + 專案上下文 + 規則
├── README.md            # 本檔
├── changes/
│   └── archive/         # 歸檔已完成的變更（目前空）
├── explorations/        # 探索筆記（目前空）
└── specs/               # 八個 capability 的現況規格
    ├── interaction-recording/spec.md
    ├── selector-generation/spec.md
    ├── recorder-overlay/spec.md
    ├── code-generation/spec.md
    ├── ai-provider-integration/spec.md
    ├── session-persistence/spec.md
    ├── extension-orchestration/spec.md
    └── result-and-history-ui/spec.md
```

## 八個 Capability 一覽

| Capability | 一句話描述 | 主要來源檔案 |
|---|---|---|
| [interaction-recording](specs/interaction-recording/spec.md) | 捕捉瀏覽器互動並組成步驟紀錄，含 iframe 支援 | `extension/content.js` |
| [selector-generation](specs/selector-generation/spec.md) | 產生穩定的 CSS selector 與 locator 屬性 | `extension/content.js` |
| [recorder-overlay](specs/recorder-overlay/spec.md) | 錄製中頁面內 UI（懸浮工具列、hover 框、通知） | `extension/content.js`, `extension/content.css` |
| [code-generation](specs/code-generation/spec.md) | 將步驟轉成 Playwright 程式碼（JS / Python / Pytest） | `extension/background.js` |
| [ai-provider-integration](specs/ai-provider-integration/spec.md) | 對接 LM Studio / Ollama / OpenAI / Gemini / Anthropic | `extension/background.js`, `extension/settings.js` |
| [session-persistence](specs/session-persistence/spec.md) | 透過 chrome.storage 儲存設定、session、進度 | `extension/background.js` |
| [extension-orchestration](specs/extension-orchestration/spec.md) | service worker、訊息路由、注入、狀態還原 | `extension/background.js`, `extension/content-injector.js`, `extension/manifest.json` |
| [result-and-history-ui](specs/result-and-history-ui/spec.md) | 四個使用者頁面：popup / settings / history / result viewer | `extension/popup.*`, `extension/settings.*`, `extension/history.*`, `extension/result-viewer.*` |

## 規格寫法

每份 `specs/<capability>/spec.md` 都遵循 OpenSpec 標準骨架：

```markdown
# <Capability> Specification

## Purpose
（說明此 capability 的範圍與意圖）

## Requirements

### Requirement: <需求名稱>

The system SHALL <observable behavior 描述>。

#### Scenario: <情境名稱>
- **GIVEN** <前置條件>
- **WHEN** <觸發動作>
- **THEN** <預期結果>
- **AND** <附加斷言>
```

`SHALL` / `MUST` / `SHOULD` / `MAY` 沿用 RFC 2119；中文敘述可包覆其前後。

## 新增變更的流程

當你要對既有 capability 改行為，或新增 capability：

1. 在 `openspec/changes/<kebab-case-name>/` 下建立：
   - `proposal.md` — 為什麼改（Why）、要改什麼（What Changes）、影響哪些 capability（Capabilities / Impact）
   - `tasks.md` — 實作清單（用 `- [ ]` 勾選格式）
   - `design.md` — 技術決策、權衡（選用，但建議多 provider／跨平台改動都要寫）
   - `specs/<capability>/spec.md` — Delta spec，使用 `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` 三個區段
2. 變更落地後，把該 change 目錄移到 `openspec/changes/archive/`，並把 ADDED / MODIFIED 內容合併進對應的 `openspec/specs/<capability>/spec.md`。

## 驗證

可選擇安裝 [`@fission-ai/openspec`](https://www.npmjs.com/package/@fission-ai/openspec) 後執行：

```bash
npx openspec validate     # 檢查 schema 合規
npx openspec list         # 列出 capability 與作用中的變更
```

本專案不強制安裝 OpenSpec CLI；上述檔案結構即使單純以 markdown 閱讀也應自洽。
