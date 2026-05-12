# 錄製器頁面內 UI (Recorder Overlay) Specification

## Purpose

本 capability 涵蓋錄製進行中，content script 在被錄製頁面上**繪製的所有可見 UI**：

1. **懸浮工具列**（top frame only、可拖移、顯示模式 / 步驟數 / 暫停 / 停止按鈕）。
2. **互動元素 hover 與 focus 外框**（隨滑鼠移動或鍵盤焦點動態定位、紅／藍色狀態切換）。
3. **錄製事件後的瞬時通知**（步驟產生成功 / 錯誤訊息 / 還原失敗紅色橫條）。

範圍**不含**：事件捕捉與步驟組裝（屬於 [interaction-recording](../interaction-recording/spec.md)）、popup / settings / history / result viewer 四個正式 UI 頁面（屬於 [result-and-history-ui](../result-and-history-ui/spec.md)）。

## Requirements

### Requirement: 懸浮工具列只在 top frame 渲染

The system SHALL 僅在 top frame 中建立可見工具列；iframe 中的 content script 不渲染任何 DOM。

#### Scenario: top frame 顯示工具列

- **GIVEN** content script 在 top frame 執行（`window.top === window.self`）
- **WHEN** 收到 `startRecording`
- **THEN** 在 `document.body` 插入 `<div id="ai-steps-recorder-toolbar">`，包含：
  - 標題「🎬 Recording」
  - 模式文字（`Step-by-step Mode` 或 `Batch Mode`）
  - 步驟計數器 `Steps: 0`
  - Pause 按鈕、Stop 按鈕

#### Scenario: iframe 不顯示工具列

- **GIVEN** content script 在 iframe 中執行
- **WHEN** 收到 `startRecording`
- **THEN** 不插入工具列 DOM
- **AND** 不渲染任何 hover 框與通知

#### Scenario: 工具列樣式注入只一次

- **WHEN** 工具列被建立
- **THEN** 若 `<style id="asr-toolbar-styles">` 不存在則注入，存在則略過（避免重複）

### Requirement: 工具列可拖移定位

The system SHALL 使工具列可由使用者用滑鼠拖曳到任意位置；按鈕區（`.asr-btn`）的點擊不觸發拖曳。

#### Scenario: 拖曳工具列本體

- **GIVEN** 工具列已渲染在預設位置（top: 20px / right: 20px）
- **WHEN** 使用者在工具列非按鈕區按下滑鼠並移動
- **THEN** 工具列以 `transform: translate3d(...)` 跟隨游標移動
- **AND** 滑鼠放開後停在當前位置

#### Scenario: 點擊按鈕不觸發拖曳

- **WHEN** 使用者按下 Pause 或 Stop 按鈕
- **THEN** 不啟動拖曳邏輯，按鈕點擊事件正常觸發

### Requirement: 工具列按鈕

The system SHALL 提供 Pause 與 Stop 兩個按鈕。

#### Scenario: 點擊 Stop 按鈕

- **WHEN** 使用者點擊 Stop 按鈕
- **THEN** 觸發 `stopRecording()` 流程：移除工具列、移除事件監聽器、通知背景服務停止

#### Scenario: 步驟計數器即時更新

- **GIVEN** 正在錄製
- **WHEN** content script 收到 `{ action: 'updateStepCounter', count }`
- **THEN** 將 `#asr-step-counter` 文字更新為 `count` 值
- **AND** 同時更新內部 `currentStep` 狀態

### Requirement: 互動元素 hover 與 focus 外框

The system SHALL 為使用者目前 hover 或 focus 的可互動元素繪製可視外框，協助使用者確認即將被錄製的目標。

#### Scenario: 偵測可互動元素

- **WHEN** 滑鼠移動到某元素上
- **THEN** 該元素若為以下任一即視為可互動：
  - 標籤 `a` / `button` / `input` / `select` / `textarea` / `label` / `summary` / `details`
  - `contentEditable` 為 true
  - `role` 為 `button` / `link` / `checkbox` / `radio` / `menuitem` / `tab` / `switch` / `textbox` / `combobox`
  - 有 `tabindex >= 0`
  - 計算後的 CSS `cursor === 'pointer'`
- **AND** 若當前元素本身不可互動，向上沿著 `parentElement` 最多檢查 4 層找最近的可互動祖先

#### Scenario: hover 顯示藍色外框

- **GIVEN** 正在錄製
- **WHEN** 滑鼠移動到可互動元素上
- **THEN** 在 `<html>` 上插入或更新 `<div id="asr-hover-outline">`
- **AND** 設置 `data-color="blue"`
- **AND** 透過 `getBoundingClientRect()` 對齊到目標元素位置

#### Scenario: mousedown 切換為紅色外框

- **GIVEN** hover 外框已顯示
- **WHEN** 使用者在元素上按下滑鼠（mousedown）
- **THEN** 將 `data-color` 改為 `red`，繼續顯示外框

#### Scenario: 鍵盤 focus 顯示藍色外框

- **WHEN** 任何可互動元素獲得 focus（focusin 事件）且不在工具列內
- **THEN** 在該元素上顯示藍色外框

#### Scenario: 滾動或視窗大小變化時重新定位

- **GIVEN** 外框已顯示
- **WHEN** 觸發 `scroll` 或 `resize` 事件
- **THEN** 透過 requestAnimationFrame 重新計算並更新外框位置

#### Scenario: 目標離開 DOM 或不可見時隱藏

- **WHEN** 重新定位時偵測到目標已不在 `document` 中，或 `getBoundingClientRect()` 寬高 ≤ 0
- **THEN** 將外框 `opacity` 設為 0（隱藏但保留節點）

#### Scenario: 工具列上方不顯示外框

- **WHEN** 滑鼠移動到工具列或其子元素上
- **THEN** 隱藏外框（不要把工具列自己框起來）

#### Scenario: 停止錄製時銷毀外框

- **WHEN** 錄製結束或執行 `forceCleanup()`
- **THEN** 移除 `#asr-hover-outline` 節點、取消任何 `requestAnimationFrame`、重設 `hoverTarget` 為 null

### Requirement: 點擊元素的瞬時高亮

The system SHALL 為剛被錄製的元素加上短暫高亮 outline，作為「已錄到」的視覺回饋。

#### Scenario: 1 秒後自動清除高亮

- **WHEN** 一筆步驟被錄製
- **THEN** 在目標元素加上 `class="asr-element-highlight"`（藍色 2px outline）
- **AND** 移除頁面上其他元素的同名 class
- **AND** 1000 毫秒後移除該 class

### Requirement: 工具列下方瞬時通知

The system SHALL 在工具列下方顯示短暫通知，反映背景服務送來的步驟產生成功或錯誤訊息。

#### Scenario: 步驟程式碼產生成功

- **GIVEN** top frame 工具列存在
- **WHEN** 收到 `{ action: 'showCodeGenerated', stepCount: N }`
- **THEN** 在工具列下方顯示綠色橫條 `Step N code generated`
- **AND** 約 0.3 秒淡入、停留約 2.4 秒、再淡出 0.3 秒

#### Scenario: LLM 錯誤訊息

- **WHEN** 收到 `{ action: 'showError', message }`
- **THEN** 在工具列下方顯示紅色橫條，內容為 `message`
- **AND** 同樣以淡入淡出方式顯示，總時長約 3 秒

#### Scenario: 同時只顯示一條通知

- **WHEN** 一條通知尚未消失，又收到新通知
- **THEN** 移除舊通知再渲染新通知

#### Scenario: iframe 中不顯示通知

- **WHEN** 在 iframe 環境收到 `showCodeGenerated` 或 `showError`
- **THEN** 不渲染任何通知（這些訊息由 top frame 處理）

### Requirement: 還原失敗的全頁通知

The system SHALL 在背景服務通知錄製還原失敗時，於頁面頂端中央顯示獨立紅色橫條，與工具列通知不同層級。

#### Scenario: 還原失敗橫條

- **WHEN** content script 收到 `{ action: 'showRestoreFailedNotification' }` 且在 top frame
- **THEN** 在頁面頂端中央顯示紅色 panel：
  - 第一行「🔧 Recording restore failed」
  - 第二行「Please restart recording or refresh the page」
- **AND** 8 秒後自動移除
