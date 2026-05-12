## Context

`content.js` 是錄製鏈的單一入口，本變更主要把它從「示範等級的事件 hook」升級成「能應付主流框架網站的錄製器」。改動分布在四個區塊：

1. **隱私層**：在資料離開瀏覽器前 redact 敏感欄位
2. **DOM 層**：穿透 Shadow DOM、過濾框架 hash class/id、抓 contenteditable、抓 boundingRect
3. **事件層**：補足 dblclick/contextmenu/IME/SPA navigation、擴大 keydown 白名單
4. **介面層**：Pause 真實作、敏感值警告橫條、temp 鍵清理

`background.js` 主要是 LLM prompt 微調與 fallback 加新動作 case。`result-viewer.js` 是 UX 補強與 storage 衛生。

## Goals / Non-Goals

**Goals:**
- 錄出來的步驟能在主流現代網站（React / Vue / Web Components / SPA）產生可執行的 Playwright 程式碼
- 密碼等敏感欄位**絕不**以明文離開瀏覽器（不入 storage、不入 LLM、不入生成的腳本）
- selector 推導與 fallback locator 使用同一套優先序（單一事實來源）
- 維持既有錄製速度與互動性（不引入明顯延遲）

**Non-Goals:**
- 不支援 drag/drop/wheel/touch/pointer events（留給後續變更 `support-modern-pointer-events`）
- 不做步驟刪除 UI（留給後續變更 `step-editor-ui`）
- 不對 chrome.storage 做加密（只做欄位層級 redaction）
- 不改 LLM prompt 的整體風格與語言

## Decisions

### Decision 1：Redact 用純 placeholder `'<REDACTED>'`，不用環境變數

**Done after AskUserQuestion**

生成的 Playwright 程式碼出現 `await locator.fill('<REDACTED>')`，使用者執行前手動替換為真值。

**理由**：
- 簡單明確：使用者一眼看到「這裡是敏感值，必須改」
- 不引入 `process.env.X` 這個額外抽象（部分使用者用 Pytest 不熟 Node 環境變數）
- result viewer 加警告橫條提醒，README 也補一段說明

**捨棄的方案**：
- `process.env.PASSWORD` 風格 — 對 Pytest 使用者要改成 `os.getenv()`，多一層轉譯
- hash 化的 `process.env.SECRET_a3f2` — 變數名不直覺
- 客製 placeholder 字串可由使用者設定 — 過度設計

### Decision 2：Shadow DOM 用 `event.composedPath()[0]`，不嘗試完整穿透

`event.composedPath()` 在 capture phase 之前就已組裝好完整 path，第一個元素是真正被點的最深目標。Playwright 自家 locator（`getByRole` 等）已會自動 pierce shadow，所以**錄製器不需要產生 shadow-aware selector**，只需要：

1. 拿到對的 element 來抽屬性／文字／selector
2. 在 step 物件加 `inShadowDom: true` 與 host selector，讓 LLM 知道情境（debug 用）

**捨棄的方案**：
- 完整生成 shadow-aware CSS selector（如 `#host >>> .inner`）— Playwright 已內建處理，不需要
- 在 closed shadow root 內部主動注入監聽器 — 不可能（closed 就是 closed）

### Decision 3：動態 id/class 用 regex 黑名單，不用「stability score」

每個動態 pattern 有自己的特徵：
- `mui-12345` / `radix-:r1:` / `headlessui-portal-root` — 框架前綴 + 隨機後綴
- `css-1abc2def` / `sc-bdVaJa-0` — CSS-in-JS hash
- `MuiButton-root` 後接 `-mui12345` — 多片段 hash

regex 比通用「所有看起來像 hash 的字串都跳過」精準，不會誤殺 `bg-blue-500`、`btn-primary` 這類穩定 utility class。

**接受的代價**：黑名單需要維護。每年加一兩條新的（headlessui 改名了、新 framework 出現）。但這比訓練一個 ML 分類器簡單多了。

### Decision 4：SPA 導航用 patch History API，不用 navigation event API

Chrome 的 [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API) 還沒被全部瀏覽器支援，且 patch History API 是業界事實標準（單元測試框架 / 錄製工具普遍這樣做）。

**注意點**：
- patch 必須能在 `removeEventListeners` 還原（避免錄製結束後仍留下 patched function）
- patch 需 idempotent：避免錄製中途被擴充功能 reload 又 re-attach 造成 double-patch

### Decision 5：dblclick 與 click 共存的去重策略

瀏覽器在 dblclick 之前會發兩個 click。如果只記 dblclick 而忽略 click，使用者「我點了兩次」的意圖丟失；如果都記，會有 click+click+dblclick 三個重複步驟。

**做法**：
- 預設記 click（既有行為）
- 收到 `dblclick` 時，從 `this.steps` 中倒序找最近 200ms 內、同 target 的兩個 click 步驟，標記為要從 `recordingState.steps` 移除（透過送 background 一個 `removeSteps` 訊息，或在 step.value 上加 `_supersededByDblclick: true` 讓 background 過濾掉）

**捨棄的方案**：
- 全用 `setTimeout(..., 300)` 延遲記 click — 增加延遲、影響其他流程
- 只記 dblclick 不記 click — 失去單擊本身的語意

採用前者：先發 click 步驟，dblclick 進來時透過新訊息 `supersedeStepsByTarget` 通知 background 把最近兩個移除。

### Decision 6：boundingRect 與 scrollY 進步驟物件，不再生成腳本時即時抓

step 物件已往 background 送，但 LLM 不知道使用者錄製當下元素相對視窗的位置。把這個資訊在錄製當下抓進 step，讓 LLM prompt 可據以決定要不要插 `scrollIntoViewIfNeeded()`。

**Trade-off**：每筆 step 物件多 ~80 byytes（4 個 number + scrollY + pageHeight），50 筆 session 多 ~4KB。可接受。

### Decision 7：`pickLocatorHint` 抽出來放在 `content.js`（非另開檔）

考慮過抽到獨立檔（`extension/lib/locator.js`）然後 background 與 content 都引用。但：
- Chrome MV3 service worker 不能直接 `import` 一般檔（需用 ES module + manifest type module）
- background 是 service worker，content 是 isolated world，跨檔共用 helper 需要 build step
- 本專案無 build step

**做法**：把 helper 函式放 `content.js` 內，但**讓計算結果隨 step 物件流到 background**。background 拿到 step.locatorHint 直接用，不重新計算。

如果未來真要共用，再加一層 build step 也不晚。

## Risks / Trade-offs

- **Risk: Shadow DOM 穿透造成 selector 對不齊原本網頁 DOM 結構**
  - 緩解：`step.inShadowDom` 標記讓 fallback 路徑能感知；Playwright 的 locator 自動處理 piercing
- **Risk: History API patch 與其他擴充功能衝突**
  - 緩解：patch 前先存原 reference；`removeEventListeners` 還原。錄製週期外完全不 patch
- **Risk: 敏感欄位 heuristic 誤殺非敏感欄位（如名為 password 但其實是 password 提示輸入框）**
  - 緩解：`type !== 'password'` 的欄位走 heuristic 命中時，仍記 `redactedReason: 'name-heuristic'`，使用者可從 step 物件辨認出「這是 heuristic 決定的」
- **Risk: dblclick 補償邏輯把不該移的 click 移掉**
  - 緩解：限制 200ms 內、同 target、最近 2 筆才移；其他不動
- **Trade-off: 步驟物件變大**
  - 既有 ~500 byte/step → 預估 ~700 byte/step（多了 boundingRect、locatorHint、可能的 frameAttributes/shadowHost）。50 筆 session 從 25KB 變 35KB，仍遠低於 chrome.storage.local 配額（10MB+）
- **Trade-off: 錄製時的計算多了**
  - 每個 event 多跑一次 `composedPath`、`isSensitiveField`、`pickLocatorHint`、`getBoundingClientRect`。但這些都是 O(1) 或近 O(1) DOM 操作，對使用者互動幾乎無感（< 1ms）
