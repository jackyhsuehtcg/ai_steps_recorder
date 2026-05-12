## MODIFIED Requirements

### Requirement: 工具列按鈕

The system SHALL 提供 Pause / Resume 切換按鈕與 Stop 按鈕；Pause 為實際暫停錄製事件捕捉的功能，不再是 stub。

僅 Pause 行為從 stub 換成真實作；Stop 與步驟計數器情境不變。

#### Scenario: 點擊 Pause 暫停錄製（更新後）

- **GIVEN** 正在錄製，且未暫停（`isPaused === false`）
- **WHEN** 使用者點擊 Pause 按鈕
- **THEN** 設 `isPaused = true`
- **AND** 後續所有事件 handler 的開頭判斷 `if (!isRecording || isPaused) return`，不產生步驟、不更新步驟計數
- **AND** 工具列 Pause 按鈕文字改為「Resume」、底色改為綠色（`#27ae60`）
- **AND** 工具列模式區下方加註「⏸ Paused」提示

#### Scenario: 點擊 Resume 恢復錄製（更新後新增）

- **GIVEN** 正在錄製，目前已暫停
- **WHEN** 使用者點擊 Resume 按鈕
- **THEN** 設 `isPaused = false`
- **AND** 工具列按鈕文字改回「Pause」、底色回到原本半透明白色
- **AND** 工具列模式區「⏸ Paused」提示移除

#### Scenario: stopRecording 重設 isPaused（更新後新增）

- **GIVEN** 錄製暫停中
- **WHEN** 使用者點擊 Stop 按鈕，或 background 送 `forceResetRecording`
- **THEN** `isPaused` 重設為 false
- **AND** 工具列被移除

#### Scenario: 點擊 Stop 按鈕（不變）

- **WHEN** 使用者點擊 Stop 按鈕
- **THEN** 觸發 `stopRecording()` 流程：移除工具列、移除事件監聽器、通知背景服務停止

#### Scenario: 步驟計數器即時更新（不變）

- **GIVEN** 正在錄製
- **WHEN** content script 收到 `{ action: 'updateStepCounter', count }`
- **THEN** 將 `#asr-step-counter` 文字更新為 `count` 值

## ADDED Requirements

### Requirement: 敏感欄位遮蔽徽章

The system SHALL 在工具列顯示一個小徽章，反映當前 session 已遮蔽幾個敏感欄位，提升使用者對隱私狀態的可見性。

#### Scenario: 累積遮蔽計數

- **GIVEN** 正在錄製
- **WHEN** 任何步驟被標為遮蔽（`step.redactedReason` 存在）
- **THEN** 工具列上的「⚠ 已遮蔽 N」徽章顯示，N 為當前 session 的遮蔽步驟總數
- **AND** N === 0 時徽章隱藏

#### Scenario: 徽章樣式與工具列協調

- **WHEN** 徽章顯示
- **THEN** 徽章與步驟計數器同列、字體 11px、底色橘黃（`rgba(243, 156, 18, 0.85)`）
- **AND** 不影響工具列拖曳行為（拖曳時 hover 過徽章仍能拖）
