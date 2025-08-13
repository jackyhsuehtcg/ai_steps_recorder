# Chrome Extension AI Steps Recorder - 任務拆解

## 專案目標
建立一個 Chrome Extension，錄製使用者在網站上的操作步驟，使用 LM Studio server 的 LLM 解析並產生 Playwright 腳本。

## 主要功能需求
- 錄製模式選擇：一次錄製 vs 逐步錄製
- 可拖移的錄製控制工具列
- 即時或批次 LLM 處理
- 支援 JavaScript/Python 格式輸出

## 任務拆解

### Phase 1: 基礎架構建立
- [ ] **Task 1.1**: 建立 Chrome Extension 基本結構
  - 創建 `manifest.json` (Manifest V3)
  - 設定權限和 content scripts
  - 建立基本資料夾結構

- [ ] **Task 1.2**: 建立 popup 介面
  - 創建 `popup.html` 和 `popup.css`
  - 實作 `popup.js` 基本邏輯
  - 設計錄製模式選擇 UI

- [ ] **Task 1.3**: 建立 content script 基礎
  - 創建 `content.js`
  - 實作與 popup 的訊息通訊
  - 建立基本的頁面注入機制

### Phase 2: 錄製系統實作
- [ ] **Task 2.1**: 實作可拖移工具列
  - 創建浮動工具列 HTML/CSS
  - 實作拖拽功能
  - 加入暫停/停止/錄製狀態顯示

- [ ] **Task 2.2**: 建立事件捕捉系統
  - 實作 DOM 事件監聽器 (click, input, scroll, etc.)
  - 記錄元素選擇器和操作類型
  - 處理動態內容和 iframe

- [ ] **Task 2.3**: 實作錄製資料結構
  - 設計操作步驟的資料格式
  - 實作時間戳記和序列化
  - 建立本地儲存機制

### Phase 3: LLM 整合
- [ ] **Task 3.1**: LM Studio 服務整合
  - 實作 API 通訊模組
  - 處理請求/回應格式
  - 錯誤處理和重試機制

- [ ] **Task 3.2**: 即時處理模式 (逐步錄製)
  - 實作即時 LLM 請求
  - 處理非同步回應
  - 優化請求頻率

- [ ] **Task 3.3**: 批次處理模式 (一次錄製)
  - 實作背景批次處理
  - 進度顯示和狀態更新
  - 處理大量資料的分批請求

### Phase 4: 腳本生成與輸出
- [ ] **Task 4.1**: Playwright 腳本生成
  - 實作 JavaScript 格式輸出
  - 實作 Python 格式輸出
  - 腳本格式化和最佳化

- [ ] **Task 4.2**: 腳本顯示介面
  - 建立腳本預覽視窗
  - 語法高亮顯示
  - 複製和下載功能

- [ ] **Task 4.3**: 匯出和分享功能
  - 檔案下載功能
  - 格式選擇 (JS/Python)
  - 腳本歷史紀錄

### Phase 5: 測試與優化
- [ ] **Task 5.1**: 功能測試
  - 不同網站相容性測試
  - 各種互動類型測試
  - 錯誤情況處理測試

- [ ] **Task 5.2**: 效能優化
  - 記憶體使用優化
  - 事件處理效能優化
  - LLM 請求優化

- [ ] **Task 5.3**: 使用者體驗優化
  - UI/UX 改善
  - 錯誤訊息優化
  - 使用說明和提示

## 技術規格

### 開發環境
- Chrome Extension Manifest V3
- Vanilla JavaScript (或 TypeScript)
- HTML5/CSS3
- LM Studio API 整合

### 關鍵技術
- **事件捕捉**: `addEventListener`, `MutationObserver`
- **元素選擇**: CSS 選擇器生成和優化
- **通訊**: Chrome Extension Message API
- **儲存**: Chrome Storage API
- **網路**: Fetch API 與 LM Studio 通訊

### 資料結構範例
```javascript
{
  "session_id": "uuid",
  "mode": "step-by-step|one-time",
  "steps": [
    {
      "timestamp": 1234567890,
      "type": "click|input|scroll",
      "selector": "#button-id",
      "value": "input value",
      "playwright_code": "await page.click('#button-id')"
    }
  ],
  "output_format": "javascript|python"
}
```

## 預期交付物
1. 完整的 Chrome Extension
2. 使用說明文件
3. 測試報告
4. 原始碼和註解