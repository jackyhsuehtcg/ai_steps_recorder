# 選擇器生成 (Selector Generation) Specification

## Purpose

本 capability 負責在錄製時為每個被互動的 DOM 元素產生「足以日後在 Playwright 中重新定位該元素」的識別資訊：

1. **CSS selector**：作為 fallback 使用的字串選擇器。
2. **可作 locator 的屬性集合**：`id` / `name` / `type` / `placeholder` / `aria-label` / `title` / `role` / `data-testid` 家族 / `class`。
3. **Accessible label**：以多種策略從 DOM 解析出最具語意的標籤文字。

下游的 [code-generation](../code-generation/spec.md) 會依據這些資訊優先選用 `getByRole` / `getByLabel` / `getByPlaceholder` / `getByTestId` / `getByText` 等定位器，僅在皆不適用時才退回 XPath 或 CSS。

範圍**不含**：實際把這些屬性轉成 Playwright locator 字串（屬於 [code-generation](../code-generation/spec.md)）、事件捕捉與步驟資料結構（屬於 [interaction-recording](../interaction-recording/spec.md)）。

## Requirements

### Requirement: CSS Selector 合成

The system SHALL 為每個元素產生一個 CSS selector 字串，依以下優先順序：`#id` → `tag.class1.class2.class3`（最多 3 個 class）→ 父層 selector + `> tag:nth-child(n)` 遞迴。

#### Scenario: 元素有 id

- **GIVEN** 元素 `el.id === 'login-btn'`
- **WHEN** 產生 selector
- **THEN** 回傳 `'#login-btn'`

#### Scenario: 元素有 class（無 id）

- **GIVEN** 元素 `<button class="btn primary large">`，無 id
- **WHEN** 產生 selector
- **THEN** 回傳 `'button.btn.primary.large'`
- **AND** 若 class 數量超過 3，僅取前 3 個

#### Scenario: 過濾錄製器自身 class

- **GIVEN** 元素具有 class `asr-element-highlight other-class`
- **WHEN** 產生 selector
- **THEN** 過濾掉以 `asr-` 開頭的 class，只保留 `other-class`

#### Scenario: 元素無 id 也無 class

- **GIVEN** 元素是某 `<div>` 的第 3 個子元素，無 id 也無 class
- **WHEN** 產生 selector
- **THEN** 遞迴呼叫父層 selector，回傳形如 `<父層 selector> > div:nth-child(3)`

#### Scenario: 根元素 fallback

- **GIVEN** 元素無父元素（例如 `<html>`）
- **WHEN** 產生 selector
- **THEN** 回傳該元素 tagName 的小寫字串（如 `'html'`）

### Requirement: 可作 locator 的屬性集合

The system SHALL 從元素抓取下列指定屬性，組成 `attributes` 物件供 locator 推論使用。

#### Scenario: 標準屬性集合

- **WHEN** 為元素抓取屬性
- **THEN** 若元素有以下屬性則記錄其值：
  - `id`
  - `type`
  - `name`
  - `placeholder`
  - `aria-label`
  - `title`
  - `role`
  - `data-testid`
  - `data-test-id`
  - `data-test`
  - `data-qa`
- **AND** 若元素 `className` 為非空字串，加入 `class`（trim 後的完整字串）

#### Scenario: 缺失屬性不出現

- **GIVEN** 元素只有 `id` 與 `name`，沒有其他屬性
- **WHEN** 抓取屬性
- **THEN** `attributes` 物件只有 `id`、`name`、（若有）`class` 三個 key，不存在 `placeholder` / `aria-label` 等 undefined 鍵

### Requirement: Accessible label 解析

The system SHALL 為每個元素解析最具語意的 label 文字，依以下優先順序：`<label for="...">` 關聯 → 包覆的 `<label>` → `aria-label` → `title` → `placeholder`。回傳值最長 120 字元。

#### Scenario: 透過 `<label for>` 關聯

- **GIVEN** 元素 `el.id === 'email'`，頁面上有 `<label for="email">Email Address</label>`
- **WHEN** 解析 label
- **THEN** 回傳 `'Email Address'`

#### Scenario: 包覆於 `<label>` 中

- **GIVEN** 元素是 `<label>Username <input></label>` 中的 `<input>`
- **WHEN** 解析 label
- **THEN** 回傳 `'Username'`（label 的 textContent）

#### Scenario: 退回 aria-label

- **GIVEN** 元素 `<button aria-label="Close dialog">×</button>`，無關聯 label
- **WHEN** 解析 label
- **THEN** 回傳 `'Close dialog'`

#### Scenario: 退回 title

- **GIVEN** 元素只有 `title` 屬性，無 label 也無 aria-label
- **WHEN** 解析 label
- **THEN** 回傳 `title` 的值

#### Scenario: 退回 placeholder

- **GIVEN** 元素 `<input placeholder="Search...">`，無前述任何屬性
- **WHEN** 解析 label
- **THEN** 回傳 `'Search...'`

#### Scenario: 截斷過長文字

- **GIVEN** 任何來源解析到的 label 文字長度超過 120 字元
- **WHEN** 回傳結果
- **THEN** 截斷到前 120 字元

#### Scenario: 全部來源皆無

- **GIVEN** 元素無 id、無包覆 label、無 aria-label / title / placeholder
- **WHEN** 解析 label
- **THEN** 回傳空字串 `''`
