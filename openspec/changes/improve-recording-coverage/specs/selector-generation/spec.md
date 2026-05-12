## ADDED Requirements

### Requirement: 動態 id 過濾

The system SHALL 在合成 CSS selector 與抽取 attributes 時，偵測並排除框架自動產生的動態 id（如 Material-UI、Headless UI、Radix、Chakra、Ant Design 等的 hash id）。

#### Scenario: 動態 id 黑名單

- **GIVEN** 元素的 `id` 屬性匹配下列 regex 任一：
  - `^(mui|headlessui|radix|chakra|ant)-`（框架前綴）
  - `^:r\d+:`（React useId）
  - `^_`（私有底線開頭）
  - `-[0-9a-f]{6,}$`（hash 結尾）
  - `::`（雙冒號 selector）
- **WHEN** `generateSelector` 嘗試以 `#${id}` 為 selector
- **THEN** 跳過 id，繼續往 class → nth-child fallback 階層

#### Scenario: 穩定 id 仍優先

- **GIVEN** 元素 `id === 'login-button'`（不命中黑名單）
- **WHEN** 產生 selector
- **THEN** 回傳 `'#login-button'`（既有行為不變）

### Requirement: 動態 class 過濾

The system SHALL 排除 CSS-in-JS 與框架生成的 hash class，只把穩定 utility class 用於 selector 與 attributes。

#### Scenario: 動態 class 黑名單

- **GIVEN** 元素的某 class 匹配下列 regex 任一：
  - `^css-[0-9a-z]+$`（Emotion hash）
  - `^sc-[A-Za-z]+-\d+$`（styled-components）
  - `^Mui[A-Z]\w+-[a-z]+$`（Material-UI BEM-style）
  - `^_[A-Za-z]+_[0-9a-z]+$`（CSS Modules）
  - `-[0-9a-f]{6,}$`（一般 hash 結尾）
- **WHEN** `generateSelector` 或 `getRelevantAttributes` 處理 class 列表
- **THEN** 命中的 class 從候選名單移除
- **AND** 若移除後仍有穩定 class 可用，照常組成 `tagName.class1.class2` selector
- **AND** 若全部 class 都被排除，selector 退回 nth-child fallback

### Requirement: Shadow DOM 元素辨識

The system SHALL 在 selector 推導時偵測元素是否位於 Shadow DOM 內部，並在步驟物件中加註，協助下游 locator 策略選擇。

#### Scenario: 偵測 Shadow DOM

- **GIVEN** 元素的 `getRootNode()` 回傳 ShadowRoot 實例
- **WHEN** `createStep` 組裝步驟物件
- **THEN** `step.inShadowDom` 設為 `true`
- **AND** `step.shadowHost` 為 ShadowRoot.host 元素的 CSS selector（用同一套 generateSelector 邏輯產生）

#### Scenario: 一般 DOM 不加註

- **GIVEN** 元素 `getRootNode()` 回傳 Document
- **WHEN** 組裝步驟
- **THEN** 不存在 `step.inShadowDom` 與 `step.shadowHost`

### Requirement: Locator Hint 推導

The system SHALL 為每個步驟產生結構化的 `locatorHint` 物件，描述推薦的 Playwright locator 策略；推導邏輯需與 code-generation 的 fallback 共用同一套優先序。

#### Scenario: locatorHint 物件結構

- **WHEN** 為某元素推導 locator
- **THEN** 回傳 `{ strategy, args, fallbackCss }`
- **AND** `strategy` 為以下其中之一（由優先序決定）：
  - `'testid'`（args.value 為 testid 字串）
  - `'label'`（args.text）
  - `'placeholder'`（args.text）
  - `'role-name'`（args.role, args.name）
  - `'text'`（args.text）
  - `'xpath'`（args.expression）
  - `'css'`（args.selector）
- **AND** `fallbackCss` 永遠為 `generateSelector(element)` 結果（即使 strategy 不是 css）

#### Scenario: 優先序決定（與 code-generation fallback 一致）

- **WHEN** 推導 strategy
- **THEN** 依下列順序找第一個可用：
  1. `attributes` 含 `data-testid` / `data-test-id` / `data-test` / `data-qa` 任一 → `testid`
  2. tag 為 `input` / `textarea` / `select` 且 `label` 非空 → `label`
  3. tag 為 `input` / `textarea` / `select` 且 `placeholder` 非空 → `placeholder`
  4. tag 為 `button` / `<input type=button|submit|reset>` / `a` 且有 name（label or text） → `role-name`
  5. `attributes.role` 非空且有 name → `role-name`
  6. `text` 非空 → `text`
  7. 否則組 XPath（`id` / `name` / `type` / `placeholder` / 前 2 個穩定 class 條件式）→ `xpath`
  8. 最後退回 CSS selector（`generateSelector` 結果）→ `css`

#### Scenario: 步驟物件帶 locatorHint

- **WHEN** `createStep` 組裝步驟
- **THEN** `step.locatorHint = pickLocatorHint(target, attrs, label, text)`
- **AND** code-generation 的 fallback 路徑直接消費 `step.locatorHint`，不重新推導
