# AI Steps Recorder Chrome Extension

一個強大的 Chrome 擴充功能，可以錄製使用者在網站上的操作步驟，並使用 AI（LM Studio 或 OpenRouter）自動產生對應的 Playwright 測試腳本。

## 功能特色

### 🎬 錄製模式
- **逐步錄製模式**: 即時將每個操作傳送給 AI 處理，立即產生對應的 Playwright 代碼
- **一次錄製模式**: 記錄所有操作後批次處理，適合處理有即時性要求的網頁

### 🚀 智能化功能
- 自動偵測 DOM 元素並產生最佳的選擇器
- 支援多種互動類型：點擊、輸入、鍵盤操作、表單提交等
- 智能處理動態內容和 iframe
- 可拖移的錄製控制工具列

### 💻 多格式輸出
- **JavaScript**: 產生 Playwright for Node.js 腳本
- **Python**: 產生 Playwright for Python 腳本
- 支援匯出為檔案或複製到剪貼板

### 🔗 AI Provider 整合
- **LM Studio**（本地，OpenAI 相容）：與本地 LM Studio 伺服器整合；也可把 API URL 改指向其他 OpenAI 相容本地端點（例如 Ollama）
- **OpenRouter**（雲端聚合）：一把 API Key 路由到 Claude / GPT / Gemini / Llama / DeepSeek 等多家模型；模型名稱欄位為自由文字輸入（含建議下拉），可填入任何 OpenRouter 支援的模型字串
- 兩個 provider 共用同一條 OpenAI Chat Completions 程式碼路徑
- 智能重試和錯誤處理機制

## 安裝方法

### 1. 下載擴充功能
```bash
git clone <repository-url>
cd ai_steps_recorder/extension
```

### 2. 載入到 Chrome
1. 開啟 Chrome 瀏覽器
2. 前往 `chrome://extensions/`
3. 開啟右上角的「開發人員模式」
4. 點擊「載入未封裝項目」
5. 選擇 `extension` 資料夾

### 3. 設定 AI Provider

擇一即可。可在「AI 設定」頁面隨時切換。

#### 選項 A：LM Studio（本地）
1. 下載並安裝 [LM Studio](https://lmstudio.ai/)
2. 載入一個適合的語言模型（建議使用 Code 相關模型）
3. 啟動本地伺服器（預設端點：`http://localhost:1234/v1/chat/completions`）
4. 在「AI 設定」頁選擇 LM Studio，從模型下拉中挑選已載入的模型；不需 API Key

> 想用 Ollama 也可以——選擇 LM Studio provider，把 API URL 改成 `http://localhost:11434/v1/chat/completions` 即可（兩者協定 1:1 相容）。

#### 選項 B：OpenRouter（雲端）
1. 在 [OpenRouter](https://openrouter.ai/) 註冊並取得 API Key
2. 在「AI 設定」頁選擇 OpenRouter
3. API URL 自動填入 `https://openrouter.ai/api/v1/chat/completions`
4. 模型名稱欄位是自由文字輸入欄：可從建議清單挑選（如 `anthropic/claude-sonnet-4`、`openai/gpt-5`、`google/gemini-2.5-flash`）或自由填入任何 OpenRouter 支援的模型字串
5. 填入 API Key 後可按「測試連接」驗證

## 使用方法

### 開始錄製
1. 點擊瀏覽器工具列中的 🎬 圖示
2. 選擇錄製模式：
   - **逐步錄製**: 適合簡單操作，即時產生代碼
   - **一次錄製**: 適合複雜流程，完成後批次處理
3. 選擇輸出格式（JavaScript / Python / Pytest）
4. 確認 AI Provider 連線設定已完成（LM Studio 本地伺服器運作中，或 OpenRouter Key 已填入）
5. 點擊「開始錄製」

### 錄製過程中
- 在網頁上正常操作（點擊、輸入、滑動等）
- 可拖移右上角的控制工具列到任意位置
- 使用「暫停」按鈕暫停錄製
- 使用「停止」按鈕結束錄製

### 查看結果
1. 錄製完成後，點擊「查看歷史」
2. 在歷史頁面中查看所有錄製記錄
3. 點擊「查看代碼」預覽生成的 Playwright 腳本
4. 使用「複製」或「下載」功能獲取代碼

## 支援的操作類型

### 滑鼠操作
- 點擊 (click)
- 雙擊 (dblclick)
- 右鍵點擊 (contextmenu)
- 滑鼠懸停 (hover)

### 鍵盤操作
- 文字輸入 (input)
- 按鍵操作 (keydown)
- 表單提交 (submit)

### 表單操作
- 文字欄位輸入
- 下拉選單選擇
- 核取方塊和選項按鈕
- 檔案上傳

### 頁面操作
- 頁面滾動
- 頁面導航
- 彈出視窗處理

## 生成的代碼範例

### JavaScript (Playwright)
```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('https://example.com');
  await page.click('#login-button');
  await page.fill('#username', 'testuser');
  await page.fill('#password', 'testpass');
  await page.press('#password', 'Enter');
  
  await browser.close();
})();
```

### Python (Playwright)
```python
import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        await page.goto('https://example.com')
        await page.click('#login-button')
        await page.fill('#username', 'testuser')
        await page.fill('#password', 'testpass')
        await page.press('#password', 'Enter')
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
```

## 設定選項

### AI Provider 設定（共通）
- **API URL**：對應 provider 的 chat completions 端點
- **API Key**：OpenRouter 必填；LM Studio 不需要
- **模型名稱**：LM Studio 為下拉選單；OpenRouter 為自由文字輸入欄（含 datalist 建議）
- **Temperature**：控制代碼生成的創造性（建議：0.1–0.3）
- **Max Tokens**：單次回應上限（預設：2000）

### LM Studio（本地）
- **預設端點**：`http://localhost:1234/v1/chat/completions`
- **模型選擇**：在 LM Studio 中載入並啟動模型，extension 透過下拉選單顯示
- **指向 Ollama**：把 API URL 改為 `http://localhost:11434/v1/chat/completions` 即可

### OpenRouter（雲端）
- **預設端點**：`https://openrouter.ai/api/v1/chat/completions`
- **可選 header**：extension 會自動帶上 `HTTP-Referer: chrome-extension://<id>` 與 `X-Title: AI Steps Recorder` 給 OpenRouter dashboard 顯示用
- **模型字串格式**：`<provider>/<model-name>`，例如 `anthropic/claude-sonnet-4`

### 錄製設定
- **最大步驟數**：單次錄製的最大步驟限制（預設：100）
- **自動儲存**：是否自動儲存錄製記錄
- **元素高亮**：錄製時是否高亮顯示互動元素

## 敏感欄位處理（重要）

為避免密碼／信用卡號等資訊以明文進入儲存空間、LLM 請求、或最終生成的 Playwright 腳本，錄製器在偵測到下列任一條件時會把欄位值替換為佔位符 `<REDACTED>`：

- `<input type="password">`
- `autocomplete` 為 `cc-number` / `cc-csc` / `cc-exp` / `current-password` / `new-password` / `one-time-code` 等敏感 token
- `name` 或 `aria-label` 屬性含有 `password`、`ssn`、`cvv`、`credit-card` / `creditcard` 子字串

當錄製到敏感欄位時，工具列會顯示「⚠ 已遮蔽 N」徽章，結果頁的程式碼區也會出現黃色提示橫條。生成的 Playwright 腳本中，對應的程式碼長這樣：

```js
await page.getByLabel('Password').fill('<REDACTED>');
```

**執行測試前**，請手動把 `'<REDACTED>'` 字串替換為：

- 直接寫入真實值（**不建議**）
- 從環境變數讀取：JS 用 `process.env.PASSWORD`、Python 用 `os.getenv('PASSWORD')`
- 從測試資料檔案讀取（fixtures、json）

腳本中 step.value 與 history session JSON 都不會儲存真實密碼。

## 故障排除

### 常見問題

#### 1. AI Provider 連線失敗
- LM Studio：確認 LM Studio 伺服器是否正在執行、API URL 是否正確、防火牆有無擋掉
- OpenRouter：確認 API Key 是否正確且有可用餘額；可在「AI 設定」頁按「測試連接」快速驗證
- 共通：用「測試連接」按鈕看 HTTP 狀態碼與錯誤訊息

#### 2. 錄製沒有反應
- 重新整理頁面並重試
- 檢查控制台是否有錯誤訊息
- 確認擴充功能權限已正確設定

#### 3. 生成的代碼不正確
- 換一個模型試試（LM Studio 換模型，或 OpenRouter 換 model 字串）
- 調整錄製步驟，確保操作清晰明確
- 降低 Temperature（建議 0.1）讓輸出更穩定
- 檢查元素選擇器是否穩定

#### 4. 無法在某些網站使用
- 某些網站可能有嚴格的 CSP 政策
- 嘗試在隱身模式中測試
- 檢查網站是否阻止擴充功能

### 效能最佳化

#### 錄製效能
- 避免在複雜頁面上進行過長時間的錄製
- 定期清理歷史記錄以節省儲存空間
- 在「一次錄製」模式中限制步驟數量

#### LLM 處理效能
- 使用較輕量的模型以加快處理速度（LM Studio 用較小模型；OpenRouter 改用較快的 `*-flash` / `*-mini` 系列）
- 批次處理時分段傳送大量步驟
- 調整溫度參數以平衡速度與品質
- 雲端流量首選 LM Studio 本地路徑可降低延遲與成本

## 開發相關

### 專案結構
```
extension/
├── manifest.json          # 擴充功能配置
├── popup.html/css/js      # 彈出視窗界面
├── content.js/css         # 內容腳本
├── background.js          # 背景服務
├── history.html/css/js    # 歷史記錄頁面
└── icons/                 # 圖示資源
```

### 技術棧
- **Chrome Extension API**：Manifest V3
- **前端技術**：HTML5、CSS3、Vanilla JavaScript
- **儲存**：Chrome Storage API
- **網路通訊**：Fetch API
- **AI 整合**：OpenAI Chat Completions 相容協定（LM Studio 與 OpenRouter 共用同一條程式碼路徑）

### 擴展開發
歡迎貢獻代碼和功能改進！主要的擴展方向：
- 支援更多元素選擇器策略
- 增加視覺化步驟編輯功能
- 支援測試用例驗證和執行
- 模型選擇 / Prompt 範本管理介面

## 版本歷史

### v1.0.0
- 基本錄製功能
- LM Studio 與 OpenRouter 整合（皆走 OpenAI Chat Completions 相容協定）
- 雙模式錄製支援
- JavaScript / Python / Pytest 輸出
- 歷史記錄管理

## 授權條款

本專案採用 MIT 授權條款，詳見 LICENSE 檔案。

## 支援與回饋

如有問題或建議，歡迎透過以下方式聯繫：
- GitHub Issues
- Email: [your-email@example.com]

---

**注意**: 本工具僅供測試和開發使用，請勿用於未經授權的網站自動化操作。