## MODIFIED Requirements

### Requirement: Locator 優先順序提示

The system SHALL 在送往 LLM 的 prompt 中，要求 LLM 優先使用 `step.locatorHint` 推薦的策略，並在敏感值與需要捲動到視窗的情境補上對應規則。

僅 prompt 內容變更，禁用 nth-child 與 frameLocator 處理規則保留。

#### Scenario: prompt 內含 step.locatorHint 使用說明（更新後）

- **WHEN** 組裝任何 LLM prompt（單步或批次）
- **THEN** prompt 文字包含：
  - 「Each step has a `locatorHint = { strategy, args, fallbackCss }` describing the recommended locator strategy. Prefer the strategy in `locatorHint.strategy`. Use `fallbackCss` only if the strategy isn't viable.」
  - 既有的 7 級偏好順序與「禁止使用 nth-child」說明保留

#### Scenario: redaction marker 處理規則（更新後新增）

- **WHEN** 組裝 prompt
- **THEN** 加入指示：「If a step value is the literal string `<REDACTED>`, emit `await locator.fill('<REDACTED>')` verbatim — do not invent a real password or call any environment variable.」

#### Scenario: scrollIntoView 提示（更新後新增）

- **WHEN** 組裝 prompt
- **THEN** 加入指示：「If a step's `boundingRect.top` exceeds its `viewport.height`, OR `scrollY > 0`, prepend `await locator.scrollIntoViewIfNeeded()` before the action.」

#### Scenario: dblclick / contextmenu 動作對應（更新後新增）

- **WHEN** 組裝 prompt
- **THEN** 加入指示：「For `dblclick`, use `locator.dblclick()`. For `contextmenu`, use `locator.click({ button: 'right' })`.」

#### Scenario: navigation 步驟對應（更新後新增）

- **WHEN** 組裝 prompt
- **THEN** 加入指示：「For `type: 'navigation'`, use `await page.goto(step.value)` only if it differs from the prior page URL; otherwise use `await page.waitForURL(step.value)` to assert SPA route change.」

#### Scenario: keydown 組合鍵（更新後新增）

- **WHEN** 組裝 prompt
- **THEN** 加入指示：「For `keydown`, `step.value` may contain modifier-combined string like `'Control+S'` or `'Meta+K'`. Pass it directly to `keyboard.press(step.value)` without splitting.」

#### Scenario: contenteditable fill 提示（更新後新增）

- **WHEN** 組裝 prompt
- **THEN** 加入指示：「If a step targets a `contenteditable` element (heuristically: tagName not in input/textarea/select but `value` is non-empty), use `locator.fill(step.value)` for plain text or `locator.pressSequentially(step.value)` if input order matters.」

### Requirement: 失敗 fallback 規則式生成

The system SHALL 在 LLM 呼叫失敗時，依步驟陣列規則式合成可執行的 Playwright skeleton；fallback locator 推導**直接消費 `step.locatorHint`**，不再重複推導。

#### Scenario: fallback locator 來源（更新後）

- **WHEN** 為某步驟挑選 fallback locator 字串
- **THEN** 優先使用 `step.locatorHint`：
  - `strategy === 'testid'` → `getByTestId(args.value)`
  - `strategy === 'label'` → `getByLabel(args.text)`
  - `strategy === 'placeholder'` → `getByPlaceholder(args.text)`
  - `strategy === 'role-name'` → `getByRole(args.role, { name: args.name })`
  - `strategy === 'text'` → `getByText(args.text)`
  - `strategy === 'xpath'` → `locator('xpath=' + args.expression)`
  - `strategy === 'css'` → `locator(args.selector)`
- **AND** 若 `step.locatorHint` 不存在（舊 session），退回既有的內建推導路徑（向前相容）

#### Scenario: fallback 對應動作類型（更新後擴大）

- **WHEN** 處理某步驟
- **THEN** 依 `step.type` 對應 Playwright 方法：
  - `click` → `<locator>.click()`
  - `dblclick` → `<locator>.dblclick()`（**ADDED**）
  - `contextmenu` → `<locator>.click({ button: 'right' })`（**ADDED**）
  - `input` / `change` 且 tag 為 `select` → `<locator>.selectOption(value)`
  - `input` / `change` 其他 → `<locator>.fill(value)`（value 為 `<REDACTED>` 時直接保留 placeholder）
  - `keydown` → `<locator>.press(value)`（value 可能為組合鍵字串如 `'Meta+S'`）
  - `navigation` → `page.goto(value)` 或 `page.waitForURL(value)`（依是否與第一個 url 相同決定）
  - `submit` → `<locator>.click()`（既有行為）
- **AND** 不識別的 `step.type` 跳過不產出
