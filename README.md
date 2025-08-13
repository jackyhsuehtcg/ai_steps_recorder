# AI Steps Recorder

Record real user interactions in the browser and generate Playwright test scripts with the help of an AI model. This repository contains a Chrome/Chromium extension (Manifest V3) under the `extension/` folder.

中文說明在下方；欲看擴充功能內文文件，亦可參考 `extension/README.md`。

## Features
- Recording modes: Step‑by‑Step and One‑Time
- Generates Playwright scripts in JavaScript, Python, or Pytest
- Smart element targeting and common actions (click, input, keys, submit, navigation, scroll, etc.)
- Works across iframes; draggable in-page recorder controls
- History, settings, and result viewer pages with a clear progress bar for One‑Time mode
- Pluggable AI backends: LM Studio, Ollama, OpenAI, Google Gemini, Anthropic

## Install (Load Unpacked)
1. Clone the repo and open the folder:
   - `git clone https://github.com/jackyhsuehtcg/ai_steps_recorder.git`
   - `cd ai_steps_recorder/extension`
2. In Chrome/Chromium, go to `chrome://extensions/`.
3. Enable “Developer mode”.
4. Click “Load unpacked” and select the `extension` folder.

## Configure AI Provider
Open the extension’s “AI Settings” (options page) and set:
- Provider: LM Studio, Ollama, OpenAI, Google Gemini, or Anthropic
- API URL (examples)
  - LM Studio: `http://localhost:1234/v1/chat/completions`
  - Ollama: `http://localhost:11434/v1/chat/completions`
  - OpenAI: `https://api.openai.com/v1/chat/completions`
  - Gemini: `https://generativelanguage.googleapis.com/v1beta/models/...:generateContent`
  - Anthropic: `https://api.anthropic.com/v1/messages`
- Model name, Temperature, Max tokens, and API key (if required)

## Usage
1. Click the toolbar icon to open the popup.
2. Choose a Recording Mode:
   - Step‑by‑Step: streams each step to the AI and builds code in real‑time.
   - One‑Time: records all steps, then generates code once finished. A progress bar shows status.
3. Choose Output Format: JavaScript, Python, or Pytest.
4. Start Recording and interact with the page. Use the floating controls to pause/stop.
5. View results in the Result Viewer: copy or download the generated script; browse steps in History.

## Pages
- Popup: quick start, mode and format selection, current model info
- Settings: provider, endpoint, model, API key, generation parameters
- History: browse previous sessions
- Result Viewer: shows metadata, steps, code, and a full‑width, prominent progress bar in One‑Time mode

## Permissions
- `activeTab`, `scripting`, `tabs`: inject recorder and read page context as needed
- `storage`: store settings and recording sessions
- `clipboardWrite`: copy generated code
- Host permissions include localhost (LM Studio/Ollama) and major AI APIs

## Development
Project structure (simplified):
```
extension/
├── manifest.json
├── background.js           # Service worker
├── content.js              # Recorder/content script
├── content-injector.js     # UI injector
├── popup.html/.css/.js     # Popup UI
├── settings.html/.css/.js  # Options page
├── history.html/.css/.js   # Sessions list
└── result-viewer.html/.js  # Code + progress view
```
No build step is required. Edit files and reload the unpacked extension to test.

## Troubleshooting
- Cannot connect to AI: verify provider, endpoint URL, and API key (if needed)
- No steps recorded: reload the tab, ensure permissions, check DevTools console
- Unstable selectors or wrong code: try another model, simplify steps, or adjust temperature

---

# AI Steps Recorder（中文）

AI 協助的瀏覽器操作錄製工具，可將實際操作自動轉換為 Playwright 測試腳本。擴充功能原始碼位於 `extension/` 目錄，更多細節可參考 `extension/README.md`。

## 功能特色
- 錄製模式：逐步錄製、一次錄製
- 輸出格式：JavaScript、Python、Pytest（Playwright）
- 智慧選擇器與常見操作（點擊、輸入、鍵盤、提交、導航、滾動…）
- 支援 iframe，含可拖移控制列
- 歷史、設定、結果檢視頁面；一次錄製模式提供「全寬且更顯眼」的進度條
- 支援多家 AI：LM Studio、Ollama、OpenAI、Google Gemini、Anthropic

## 安裝（載入未封裝）
1. 下載專案並開啟資料夾：
   - `git clone https://github.com/jackyhsuehtcg/ai_steps_recorder.git`
   - `cd ai_steps_recorder/extension`
2. 開啟 Chrome 前往 `chrome://extensions/`
3. 開啟右上「開發人員模式」
4. 點「載入未封裝項目」，選擇 `extension` 資料夾

## 設定 AI
在「AI 設定」頁面填寫：
- 供應商：LM Studio / Ollama / OpenAI / Google Gemini / Anthropic
- API URL（例如）
  - LM Studio：`http://localhost:1234/v1/chat/completions`
  - Ollama：`http://localhost:11434/v1/chat/completions`
- 模型名稱、Temperature、Max tokens、API Key（如需）

## 使用流程
1. 點擊工具列圖示開啟彈出視窗
2. 選擇錄製模式：
   - 逐步錄製：即時將步驟送往 AI 生成代碼
   - 一次錄製：結束錄製後再產生代碼（頁面有全寬進度條顯示進度）
3. 選擇輸出格式（JavaScript / Python / Pytest）
4. 點「開始錄製」，在頁面上正常操作；使用懸浮工具列暫停/停止
5. 在結果檢視頁複製或下載代碼；也可到歷史頁瀏覽紀錄

## 權限說明
- `activeTab`、`scripting`、`tabs`：注入錄製器、存取必要的頁面資訊
- `storage`：儲存設定與錄製紀錄
- `clipboardWrite`：複製產生的代碼
- 主機權限包含本機端點與主流雲端 AI 服務

## 開發
不需建置流程，直接修改檔案並在擴充功能頁面重新載入即可。主要檔案：
- `background.js`、`content.js`、`popup.*`、`settings.*`、`history.*`、`result-viewer.*`

## 疑難排解
- 連線失敗：檢查供應商、端點 URL 與 API Key
- 未錄到步驟：重新整理分頁、確認權限、查看開發者工具
- 代碼不穩定：改用其他模型、調整操作步驟、降低 Temperature

> 備註：本專案不含授權聲明；如需授權條款請另行新增 LICENSE。
