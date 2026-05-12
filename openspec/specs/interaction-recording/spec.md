# 互動錄製 (Interaction Recording) Specification

## Purpose

本 capability 涵蓋使用者啟動錄製後，如何捕捉瀏覽器頁面上的互動（click / input / change / submit / keydown / navigation），把每個動作組成步驟紀錄並送回背景服務。同時負責跨頁面導航時的錄製狀態還原、輸入去抖／去重、以及 iframe 與 top frame 的角色分工。

範圍**不含**：可見的工具列／hover 框 UI（屬於 [recorder-overlay](../recorder-overlay/spec.md)）、CSS selector 與 locator 屬性的合成（屬於 [selector-generation](../selector-generation/spec.md)）、訊息路由與 service worker 生命週期（屬於 [extension-orchestration](../extension-orchestration/spec.md)）。

## Requirements

### Requirement: 錄製生命週期管理

The system SHALL 在收到 `startRecording` / `stopRecording` 訊息時建立或結束錄製狀態，並在成功時回應 `{ success: true }`。

#### Scenario: 開始錄製

- **GIVEN** 目前不在錄製中
- **WHEN** content script 收到 `{ action: 'startRecording', settings: { recordMode } }` 訊息
- **THEN** 將 `isRecording` 設為 `true`，並依 `settings.recordMode` 設定錄製模式（`step-by-step` 或 `one-time`）
- **AND** 清空既有的步驟陣列與步驟計數
- **AND** 在非 iframe 環境下建立懸浮工具列
- **AND** 開始監聽 DOM 事件
- **AND** 回應 `{ success: true, isRecording: true }`

#### Scenario: 停止錄製

- **GIVEN** 目前正在錄製中
- **WHEN** content script 收到 `{ action: 'stopRecording' }` 訊息或使用者點擊工具列 Stop 按鈕
- **THEN** 將 `isRecording` 設為 `false`
- **AND** 移除工具列與所有事件監聽器
- **AND** 透過 `chrome.runtime.sendMessage({ action: 'stopRecording' })` 通知背景服務
- **AND** 回應 `{ success: true }`

#### Scenario: 強制重置

- **WHEN** content script 收到 `{ action: 'forceResetRecording' }` 訊息
- **THEN** 立即清除 `isRecording`、工具列、事件監聽器、步驟陣列、步驟計數
- **AND** 即使不在錄製狀態下也應安全執行

### Requirement: DOM 事件捕捉

The system SHALL 在錄製期間以 capture phase 監聽 `click` / `input` / `change` / `submit` / `keydown` 事件，並對每個有效事件產生一筆步驟紀錄。

#### Scenario: 捕捉一般點擊

- **GIVEN** 正在錄製
- **WHEN** 使用者點擊頁面上一個非工具列元素
- **THEN** 產生一筆步驟，`type = 'click'`，`value` 為元素的 `textContent`（按鈕 / 連結）或 `checked` 狀態（checkbox / radio）
- **AND** 透過 `chrome.runtime.sendMessage({ action: 'addStep', step })` 送回背景服務

#### Scenario: 過濾錄製器自身工具列

- **GIVEN** 正在錄製
- **WHEN** 觸發事件的 target 位於 `#ai-steps-recorder-toolbar` 內或其子元素
- **THEN** 不產生任何步驟（避免錄製到操作工具列本身的動作）

#### Scenario: 限制 keydown 種類

- **GIVEN** 正在錄製
- **WHEN** 使用者按下 `Enter` / `Tab` / `Escape` 以外的按鍵
- **THEN** 不產生 keydown 步驟（僅這三個鍵會被錄製）

### Requirement: 輸入去抖與去重

The system SHALL 對 `<input>` / `<textarea>` 上的連續 `input` 事件做合併，避免每個按鍵都產生一筆步驟。

#### Scenario: 閒置 1 秒後自動寫入

- **GIVEN** 正在錄製，使用者在文字輸入欄連續打字
- **WHEN** 距最後一次 `input` 事件已過 1000 毫秒
- **THEN** 將該欄位當下值組成一筆 `input` 步驟並送出
- **AND** 但若值的長度小於 3，視為尚未完成輸入，不送出（`reason='idle'` 的最低長度限制）

#### Scenario: 失焦時立即寫入

- **GIVEN** 正在錄製，文字輸入欄有未送出的待處理輸入
- **WHEN** 該欄位 `focusout`
- **THEN** 取消閒置計時器，立即將當下值送出為 `input` 步驟
- **AND** 若值與「上次已送出值」相同則略過

#### Scenario: 提交或 Enter 觸發即時寫入

- **GIVEN** 正在錄製，文字輸入欄有未送出的待處理輸入
- **WHEN** 發生 `submit` 事件、`Enter` keydown，或使用者點到該欄位以外的元素
- **THEN** 取消閒置計時器，立即將當下值送出為 `input` 步驟，再處理當前事件

#### Scenario: 過濾 textual `change` 事件

- **GIVEN** 正在錄製
- **WHEN** `<input type="text">` / `<input>`（無 type）／ `<textarea>` 觸發 `change` 事件
- **THEN** 略過該事件（避免與 `input` 事件產生重複步驟）
- **AND** 但 checkbox / radio / file / range / color / date 等非文字 input 的 `change` 事件仍會被錄製

### Requirement: 重複事件去重

The system SHALL 對非 input 類事件實施 100 毫秒短期去重，避免框架重派事件造成同一筆步驟重複。

#### Scenario: 100 毫秒內相同 target 重複事件

- **GIVEN** 正在錄製
- **WHEN** 距上一筆已記錄事件不到 100 毫秒，且 target 為同一 DOM 元素
- **THEN** 不產生新步驟（視為重複事件）

### Requirement: 步驟資料結構

The system SHALL 為每筆事件組裝包含時間、元素資訊、頁面上下文的步驟物件。

#### Scenario: 步驟必含欄位

- **WHEN** 任何事件被錄製為步驟
- **THEN** 步驟物件至少包含以下欄位：
  - `timestamp`（毫秒）
  - `type`（事件類型：click / input / change / submit / keydown / navigation）
  - `tagName`（小寫元素名）
  - `selector`（由 [selector-generation](../selector-generation/spec.md) 產生）
  - `value`（依事件類型決定：input 取 `element.value`；click 取 textContent 或 checked；keydown 取 `event.key`）
  - `text`（`textContent` 前 100 字）
  - `label`（accessible label，由 [selector-generation](../selector-generation/spec.md) 產生）
  - `attributes`（id / type / name / placeholder / aria-label / title / role / data-testid 家族 / class）
  - `viewport`（`{ width, height }`）
  - `url`（`window.location.href`）
  - `inIframe`（`window.top !== window.self`）

#### Scenario: 背景服務補充編號

- **GIVEN** content script 已送出步驟物件
- **WHEN** background service 收到該步驟並屬於目前錄製 tab
- **THEN** 在儲存前補上 `stepIndex`（陣列順序）、`canonicalTs`（送達時間）、`arrivalSeq`（單調遞增序號）

### Requirement: iframe 與 top frame 角色分工

The system SHALL 確保只有 top frame 持有工具列與全域控制，但所有 frame 都能錄製互動。

#### Scenario: iframe 中忽略全域控制訊息

- **GIVEN** content script 在一個 iframe 中執行（`window.top !== window.self`）
- **WHEN** 收到 `toggleRecording` / `stopRecording` / `getStatus` 訊息
- **THEN** 直接 return，不回應（讓 top frame 處理）

#### Scenario: iframe 中錄製事件

- **GIVEN** 正在錄製，content script 在某 iframe 中執行
- **WHEN** 使用者在該 iframe 內點擊或輸入
- **THEN** 仍可組成步驟並透過 `addStep` 送回背景服務
- **AND** 步驟物件的 `inIframe` 為 `true`

#### Scenario: iframe 中不渲染工具列

- **GIVEN** content script 在某 iframe 中執行
- **WHEN** 收到 `startRecording`
- **THEN** 不建立工具列 DOM，但仍開始監聽事件

### Requirement: 跨頁面導航時的錄製還原

The system SHALL 在錄製中的 tab 發生頁面導航後，重新接管錄製狀態，使後續操作仍能被錄製。

#### Scenario: 頁面重新載入後還原

- **GIVEN** 正在錄製某 tab，使用者點擊連結觸發頁面導航
- **WHEN** 新頁面 `load` 完成，背景服務送來 `restoreRecordingState` 訊息
- **THEN** content script 先強制清理舊 instance 的工具列與監聽器
- **AND** 等待 DOM ready（最多 5 秒 timeout）
- **AND** 還原 `isRecording = true`、`sessionId`、`recordingMode`、`steps` 陣列、`currentStep`
- **AND** 重建工具列與事件監聽器
- **AND** 不為這次自動導航額外產生 navigation 步驟
- **AND** 回應 `{ success: true }`

#### Scenario: 還原失敗時通知使用者

- **GIVEN** 背景服務嘗試還原錄製狀態
- **WHEN** 連續 5 次嘗試後仍失敗
- **THEN** 在 top frame 顯示「Recording restore failed / Please restart recording or refresh the page」紅色通知條 8 秒
- **AND** 放棄該 tab 的還原嘗試
