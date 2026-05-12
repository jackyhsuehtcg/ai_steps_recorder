# 程式碼生成 (Code Generation) Specification

## Purpose

本 capability 涵蓋背景服務把錄到的步驟陣列轉成可執行 Playwright 程式碼的所有邏輯：

1. **逐步增量生成**（step-by-step 模式）：每錄到一步即送 LLM，產出單行或骨架，逐步累加進框架。
2. **批次生成**（one-time 模式）：錄製結束後把整段步驟送 LLM 一次產出完整腳本，並對外發出進度事件。
3. **Locator 優先順序提示**：在 prompt 中要求 LLM 優先使用 `getByRole` / `getByLabel` / `getByPlaceholder` / `getByTestId` / `getByText`，皆不適用才用 XPath，最後才用 CSS。
4. **輸出消毒**：去除 markdown fence、串流殘留、HTML 包覆、zero-width 字元等模型雜訊。
5. **失敗 fallback**：當 LLM 呼叫失敗時，根據步驟陣列以規則式合成可執行的 Playwright skeleton。
6. **三種輸出格式**：JavaScript（Node async IIFE）／ Python（async with playwright）／ Pytest（sync API + page fixture）。

範圍**不含**：實際的 HTTP 請求 / 認證 / 回應解析（屬於 [ai-provider-integration](../ai-provider-integration/spec.md)）、產出的程式碼如何持久化或顯示（屬於 [session-persistence](../session-persistence/spec.md) 與 [result-and-history-ui](../result-and-history-ui/spec.md)）。

## Requirements

### Requirement: 逐步增量生成（step-by-step 模式）

The system SHALL 在 step-by-step 模式下，每收到一筆新步驟即送 LLM 產生對應的 Playwright 片段，並依序累加進已存在的框架程式碼。

#### Scenario: 第一筆步驟產生完整框架

- **GIVEN** 錄製模式為 `step-by-step`，目前尚未產生任何程式碼
- **WHEN** 第一筆步驟入隊處理
- **THEN** 對 LLM 發出 prompt，要求產生「整段可執行的 ${language} Playwright 框架，整合該步驟」
- **AND** 將回傳結果作為 `accumulatedCode` 起始
- **AND** 通知 top frame `{ action: 'showCodeGenerated', stepCount: 1, isFirstStep: true }`

#### Scenario: 後續步驟產生單行程式碼

- **GIVEN** `accumulatedCode` 已存在
- **WHEN** 新步驟入隊處理
- **THEN** 對 LLM 發出 prompt，要求「只回傳一行對應動作的 Playwright code，不含註解」
- **AND** 將該行依語言用適當縮排（Python 8 空格 / Pytest 4 空格 / JavaScript 2 空格）插入既有框架

#### Scenario: 步驟序列化處理

- **WHEN** 多筆步驟連續到達
- **THEN** 透過 `stepQueue` 序列化處理，同時間最多一筆 LLM 請求進行中
- **AND** 隊列空時自動退出處理迴圈

#### Scenario: 錄製停止時清空待處理隊列

- **WHEN** 錄製被停止（`isRecording === false`）
- **THEN** 清空 `stepQueue`，不再處理任何尚未送 LLM 的步驟

#### Scenario: 步驟生成錯誤通知使用者

- **GIVEN** 正在處理隊列中的某筆步驟
- **WHEN** LLM 呼叫拋出例外
- **THEN** 透過 `chrome.tabs.sendMessage` 在 top frame 顯示 `LLM Error: <message>` 紅色通知
- **AND** 不中斷整體錄製，繼續處理隊列中下一筆步驟

### Requirement: 累加程式碼的插入位置

The system SHALL 把後續步驟程式碼插入框架中正確的位置，使輸出保持時序一致且可執行。

#### Scenario: JavaScript 在 `await browser.close();` 前插入

- **GIVEN** 累積程式碼為 JavaScript 框架
- **WHEN** 插入新片段
- **THEN** 找到最後一個 `await browser.close();`（含 2 空格縮排或無縮排），在該行之前以 2 空格縮排插入

#### Scenario: Python 在 `await browser.close()` 前插入

- **GIVEN** 累積程式碼為 Python async 框架
- **WHEN** 插入新片段
- **THEN** 找到最後一個 `await browser.close()`（含 8 空格縮排或無縮排），在該行之前以 8 空格縮排插入

#### Scenario: Pytest 直接附加到尾端

- **GIVEN** 累積程式碼為 Pytest 框架
- **WHEN** 插入新片段
- **THEN** 直接以 4 空格縮排附加到字串尾端（保持時序，不重新插到 header）

#### Scenario: 找不到插入點時退到尾端

- **WHEN** 找不到 `browser.close` 字樣
- **THEN** 將片段以換行附加到 `accumulatedCode` 尾端，並在 console 警告

### Requirement: 批次生成（one-time 模式）

The system SHALL 在 one-time 模式錄製結束時，把整個步驟陣列送 LLM 一次產出完整腳本，並對外發出進度事件。

#### Scenario: 錄製結束觸發批次生成

- **GIVEN** 錄製模式為 `one-time`，且步驟陣列非空
- **WHEN** 使用者按下 Stop
- **THEN** 先儲存 session、開啟 result viewer 分頁
- **AND** 對 LLM 發出 prompt，要求基於整段步驟產生完整 ${language} Playwright 腳本
- **AND** 取得結果後 sanitize、寫回 session、再次儲存

#### Scenario: 進度事件序列

- **WHEN** 批次生成執行中
- **THEN** 依以下順序透過 `notifyProgress` 發出進度：
  - `Initializing` 0%（Preparing to generate Playwright code...）
  - `Analyzing` 10%（Analyzing N recorded steps...）
  - `Connecting` 30%（Loading AI model settings...）
  - `Generating` 50%（Sending request to <provider>...）
  - `Processing` 80%（Processing AI response...）
  - `Completed` 100%（Playwright code generation completed successfully!）

#### Scenario: 批次生成失敗使用 fallback

- **WHEN** 批次生成過程中拋出例外
- **THEN** 在 session 上記錄 `processingError`
- **AND** 發出 `Error` 100%（Generation failed, using fallback code）進度事件
- **AND** 改用規則式 fallback 合成程式碼，仍寫回 session

### Requirement: Locator 優先順序提示

The system SHALL 在所有送往 LLM 的 prompt 中，明確要求依序偏好以下 Playwright locator 策略，並禁止使用 `nth-child`（除非絕對必要）：

1. `getByRole({ name })`
2. `getByLabel`
3. `getByPlaceholder`
4. `getByTestId`
5. `getByText`
6. XPath（`xpath=` 前綴）
7. CSS（最後手段）

#### Scenario: prompt 內含 locator 規則

- **WHEN** 組裝任何 LLM prompt（單步或批次）
- **THEN** prompt 文字包含上述 7 級偏好順序，並指示「禁止使用 nth-child（除非絕對必要）」

#### Scenario: iframe 步驟提示 frameLocator

- **GIVEN** 步驟的 `inIframe === true` 且 url 與主頁面不同
- **WHEN** 組裝 prompt
- **THEN** 額外指示使用 `frameLocator('iframe[src*="<host>"]')`（或對應 Python API），其中 `<host>` 取自步驟 url 的網域關鍵字

### Requirement: 三種輸出格式骨架

The system SHALL 依使用者選擇的 `outputFormat` 產生對應語言的 Playwright 骨架。

#### Scenario: JavaScript 骨架

- **GIVEN** `outputFormat === 'javascript'`
- **WHEN** 產生第一筆程式碼或 fallback
- **THEN** 骨架為：
  ```javascript
  const { chromium } = require('playwright');

  (async () => {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await browser.close();
  })();
  ```

#### Scenario: Python async 骨架

- **GIVEN** `outputFormat === 'python'`
- **THEN** 骨架為：
  ```python
  import asyncio
  from playwright.async_api import async_playwright

  async def run():
      async with async_playwright() as p:
          browser = await p.chromium.launch(headless=False)
          page = await browser.new_page()

          await browser.close()

  if __name__ == "__main__":
      asyncio.run(run())
  ```

#### Scenario: Pytest sync 骨架

- **GIVEN** `outputFormat === 'pytest'`
- **THEN** 骨架為：
  ```python
  from playwright.sync_api import Page, expect

  def test_ai_steps_recorder(page: Page):
      pass
  ```

### Requirement: 輸出消毒

The system SHALL 對所有 LLM 回傳內容執行消毒，移除非程式碼雜訊。

#### Scenario: 移除 markdown 程式碼框

- **WHEN** LLM 回傳含 ` ```javascript` 或 ` ``` `
- **THEN** 移除所有 ` ```<lang>?\n?` 開頭與結尾標記

#### Scenario: 移除 LM 串流標記

- **WHEN** LLM 回傳含 `<|channel|>final` / `<|start|>` / `<|...|>` 等串流通道標記
- **THEN** 移除所有 `<|...|>` 標記與整行只有此類標記的內容
- **AND** 移除 `▌` 這類游標殘留字元

#### Scenario: 移除 HTML 包覆

- **WHEN** LLM 回傳含 `<details>` / `<summary>` / `<pre>` / `<code>` 標籤
- **THEN** 移除這些標籤的開閉，但保留內容文字

#### Scenario: 移除零寬字元

- **WHEN** LLM 回傳含 zero-width 字元（U+200B、U+200C、U+200D、U+FEFF）
- **THEN** 全部移除

#### Scenario: 折疊多餘空行

- **WHEN** 結果中有 3 個以上連續換行
- **THEN** 折疊為兩個換行

#### Scenario: 消毒例外不影響輸出

- **WHEN** sanitize 過程拋出例外
- **THEN** 退回原始未消毒內容（不要因為消毒而丟失整段程式碼）

### Requirement: 失敗 fallback 規則式生成

The system SHALL 在 LLM 呼叫失敗時，依步驟陣列規則式合成可執行的 Playwright 骨架，使使用者仍能取得可用程式碼。

#### Scenario: fallback 觸發條件

- **WHEN** `handleGeneratePlaywrightCode` 流程中 LLM 請求拋出任何例外
- **THEN** 改用 `generateFallbackCodeBatch(steps, format)` 產生程式碼
- **AND** 回應 `{ success: true, code, usedFallback: true, error: <message> }`

#### Scenario: fallback 起始 navigate

- **GIVEN** 步驟陣列中第一筆有 `url`
- **WHEN** 產生 fallback 程式碼
- **THEN** 在骨架建立 `page` 之後加入 `page.goto(<url>)` 與 `waitForLoadState('networkidle')`

#### Scenario: fallback locator 推導順序

- **WHEN** 為某步驟挑選 locator
- **THEN** 依以下優先序推導：
  1. 若 `attributes.data-testid` 等 test-id 家族屬性存在 → `getByTestId`
  2. 若 tag 為 `input` / `textarea` / `select` 且有 `label` → `getByLabel`
  3. 若 tag 為 `input` / `textarea` / `select` 且有 `placeholder` → `getByPlaceholder`
  4. 若 tag 為 `button` 或 `<input type="button|submit|reset">` 且有 `label`/`text` → `getByRole('button', { name })`
  5. 若 tag 為 `a` 且有 `name` → `getByRole('link', { name })`
  6. 若 `attributes.role` 存在且有 `name` → `getByRole(role, { name })`
  7. 若有 `text` → `getByText`
  8. 否則組 XPath（含 `id`/`name`/`type`/`placeholder`/`class` 條件，class 取前 2 個）
  9. 最後退回 CSS selector（`page.locator(<selector>)`）

#### Scenario: fallback 對應動作類型

- **WHEN** 處理某步驟
- **THEN** 依 `step.type` 對應 Playwright 方法：
  - `click` → `<locator>.click()`
  - `input` / `change` 且 tag 為 `select` → `<locator>.selectOption(value)`（JS）／ `select_option`（Python）
  - `input` / `change` 其他 → `<locator>.fill(value)`
  - `keydown` 且 `value === 'Enter'` → `<locator>.press('Enter')`
  - `navigation` 且 url 與第一個 url 不同 → `page.goto(url)` 加上 `waitForLoadState('networkidle')`
- **AND** 不識別的 step.type 跳過不產出
