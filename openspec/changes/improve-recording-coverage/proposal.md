## Why

針對錄製鏈做完一輪系統性 audit，發現 14 個會影響「錄製正確性」、「使用者隱私」、「selector 穩定度」、「使用者體驗」的 gap。其中：

- **正確性／隱私漏洞**（P1 紅色）：密碼明文外洩到 storage / LLM / 生成的腳本；Shadow DOM 內部互動完全抓不到；React/Vue 等框架的 hash class/id 被當穩定 selector 用，下次跑就失效；SPA route change 完全沒被記錄；雙擊與右鍵漏掉
- **能力 gap**（P2 黃色）：contenteditable 富文字編輯器抓不到值；步驟物件缺 boundingRect / scrollY，無法判斷是否要 scroll；錄製時的 selector 推導與最後生成 locator 的優先序脫鉤；同 host 多個 iframe 撞名；keydown 只認 Enter/Tab/Escape
- **UX / 健壯性**（P3 綠色）：工具列 Pause 按鈕是 stub；中日韓 IME 中間狀態會記到拼音；result viewer 開過後 `temp_session_*` / `progress_*` 鍵永遠不會被清理

修這些 gap 能讓本 extension 從「示範用」往「實際自動化測試生成器」靠近一步。

## What Changes

把 14 項變更包成單一變更，**任務分三 phase**，使用者可在每個 phase 結束做 Chrome 手測再進下一階段：

- **Phase 1（P1 紅色，5 項）**：敏感欄位 redact、Shadow DOM `composedPath()`、動態 id/class regex 過濾、SPA 導航偵測（patch History API + popstate/hashchange）、`dblclick` 與 `contextmenu` 事件
- **Phase 2（P2 黃色，5 項）**：contenteditable 值抓取、`boundingRect` / `scrollY` 入步驟、抽出共用 `pickLocatorHint()` 統一 selector 與 fallback locator 邏輯、iframe 同 host 用 `frameElement` 屬性區分、keydown 白名單擴大 + 修飾鍵組合
- **Phase 3（P3 綠色，3 項）**：Pause 真實作（取代既有 stub）、IME `compositionstart` / `compositionend` 處理、result viewer 完成後清掉 `temp_session_*` 與 `progress_*` 鍵

## Capabilities

### New Capabilities

無（皆為既有 capability 的擴充）。

### Modified Capabilities

- `interaction-recording`：新增敏感欄位遮蔽、Shadow DOM 偵測、SPA 導航、`dblclick`/`contextmenu`、contenteditable、`boundingRect`/`scrollY`、`frameAttributes`、keydown 擴大、IME 處理共 9 個 Requirement 變動
- `selector-generation`：新增動態 id/class 黑名單；`Requirement: CSS Selector 合成` 升級為 `Requirement: Locator Hint 推導`，引入 `pickLocatorHint` 共用 helper 概念；新增 Shadow DOM 元素辨識
- `recorder-overlay`：`Requirement: 工具列按鈕` 內 Pause scenario 從 stub 換成真實作
- `code-generation`：LLM prompt 加 redaction marker 處理與 scroll 提示；fallback locator 直接消費 `step.locatorHint` 不再重新推導；fallback 加 `dblclick` / `contextmenu` / `navigation` 三種動作型別
- `session-persistence`：`Requirement: Result Viewer 暫存交接` 加完成後清理 `temp_session_*` 與 `progress_*` scenario

## Impact

- **使用者**：
  - 密碼欄位錄出來的腳本中會看到 `await locator.fill('<REDACTED>')`，**執行前必須手動替換**。result viewer 與 README 會明示。
  - Shadow DOM 站、SPA、Material-UI 站等本來「錄到但生不出可用程式碼」的場景會明顯改善。
  - Chrome MV3 體感差異：錄製時若按 Pause，操作不會被記。
- **程式碼**：
  - `extension/content.js`（最大改動，~200 行新增）
  - `extension/background.js`（LLM prompt 段落 + fallback 加新 case）
  - `extension/result-viewer.js`（redaction 警告橫條 + 完成後清 storage 鍵）
  - `extension/README.md`（補充 `<REDACTED>` 替換說明）
- **規格文件**：5 個 capability spec 各有 delta，archive 後合併進主 specs。
- **不影響**：manifest 權限、popup / settings / history UI、provider catalog、code-generation 的整體 prompt 風格與 fallback 程式碼骨架。

## 已確認決策

- 單一變更、任務分 3 phase（不拆成 3 個變更）
- Redact 風格：純 placeholder `'<REDACTED>'`，生成的程式碼出現 `fill('<REDACTED>')`，使用者執行前手動替換
- Pause 真實作（不移除按鈕、不留 stub）
