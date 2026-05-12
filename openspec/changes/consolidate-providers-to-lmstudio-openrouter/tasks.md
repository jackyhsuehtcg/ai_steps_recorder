## 1. 程式碼：Provider Catalog（settings.js）

- [x] 1.1 從 `providers` 物件移除 `gemini` 與 `anthropic` 兩個 key（前一階段完成）
- [ ] 1.2 從 `providers` 物件移除 `openai` 與 `ollama` 兩個 key
- [x] 1.3 新增 `openrouter` key（前一階段完成）
- [ ] 1.4 確認 `providers` 最終只剩 `lmstudio` 與 `openrouter` 兩個 key
- [ ] 1.5 `buildRequestBody` 與 `setAuthHeaders` 的 switch case 收斂為 `lmstudio | openrouter`

## 2. 程式碼：背景 LLM 呼叫（background.js）

- [ ] 2.1 `requiresKey` 字串陣列收斂為 `['openrouter']`（單一雲端 provider）
- [ ] 2.2 `generatePlaywrightCodeSingle` 與 `generatePlaywrightCodeBatch` 兩個 switch：
  - 移除 `case 'openai':` 與 `case 'ollama':`
  - 保留 `case 'lmstudio':` 與 `case 'openrouter':`
  - OpenRouter 仍設置 `HTTP-Referer` 與 `X-Title` 可選 header
- [ ] 2.3 `extractContentFromLLMJson` 與 `extractContentFromSSE` 兩處 switch：
  - 移除 `'openai'` 與 `'ollama'` 的 case
  - 保留 `'lmstudio'` 與 `'openrouter'` 的 case

## 3. 程式碼：Manifest 權限（manifest.json）

- [ ] 3.1 從 `host_permissions` 移除 `http://localhost:11434/*`（Ollama）與 `https://api.openai.com/*`（OpenAI）
- [ ] 3.2 host_permissions 最終只剩：`http://localhost:1234/*`（LM Studio）+ `https://openrouter.ai/*` + 通用 `http://*/*` / `https://*/*`

## 4. 程式碼：UI 顯示名映射

- [ ] 4.1 `popup.js` 的 `providerNames` 移除 `ollama` 與 `openai`，最終只剩 `lmstudio` 與 `openrouter`
- [ ] 4.2 `history.js` 的 `providerNames` 同上
- [ ] 4.3 `result-viewer.js` 的 `providerNames` 同上
- [ ] 4.4 `settings.html` 的 provider 下拉移除 `<option value="openai">` 與 `<option value="ollama">` 兩項

## 5. 程式碼：使用者既有設定遷移

- [x] 5.1 `settings.js` 的 `loadSettings()` 已偵測 `gemini` / `anthropic`（前一階段完成）
- [ ] 5.2 擴充偵測範圍為 `provider in ['gemini', 'anthropic', 'openai', 'ollama']`，全部統一降級為 `lmstudio`
- [ ] 5.3 提示訊息措辭依 provider 微調：「先前選用的 <Name> 已停止支援，已切回 LM Studio，請改選 OpenRouter 或調整 LM Studio 端點」

## 8. 程式碼：OpenRouter 模型欄位改為手動填入

OpenRouter 模型清單在 OpenRouter 平台上每週都有變動，固定下拉清單會過時。改為「文字輸入欄 + datalist 建議」讓使用者可自由填入任意 OpenRouter 支援的模型字串。

- [ ] 8.1 在 `providers.openrouter` catalog 加入 `freeFormModel: true` 旗標
- [ ] 8.2 把 catalog 中的 `models` 陣列重新解讀為「suggested 模型」（程式碼語意，而非新欄位名）
- [ ] 8.3 在 `updateProviderFields(providerId)` 中：
  - 若 `provider.freeFormModel === true`：把 modelName 欄位重建為 `<input type="text">` + `<datalist>` 建議清單，預填 `defaultModel`
  - 否則沿用既有 `<select>` 下拉行為（LM Studio 路徑不變）
- [ ] 8.4 切換 provider 時除了移除舊 modelName 元素，同時清掉殘留的 `<datalist>`，避免重複 ID
- [ ] 8.5 更新 modelName 欄位的 hint 文字：
  - OpenRouter：「輸入 OpenRouter 支援的模型字串，可從建議清單挑選或自由填寫（例如：`anthropic/claude-sonnet-4`）」
  - LM Studio：維持現有「選擇 LM Studio 模型」

## 6. OpenSpec 文件更新

- [ ] 6.1 將本變更目錄下三份 delta spec 合併進 `openspec/specs/<capability>/spec.md`
- [ ] 6.2 更新 `openspec/config.yaml` 的 `context:` 中 provider 清單為 LM Studio + OpenRouter
- [ ] 6.3 更新 `openspec/README.md`（若有提到）provider 清單
- [ ] 6.4 將本變更目錄移到 `openspec/changes/archive/`

## 7. 驗證

- [ ] 7.1 `grep -rn "case 'openai'\|case 'ollama'\|case 'gemini'\|case 'anthropic'" extension/` 應為 0 匹配
- [ ] 7.2 `manifest.json` 變更後重新載入 extension，確認 `chrome://extensions/` 上的權限列表不再含 OpenAI / Gemini / Anthropic / 任意 localhost:11434
- [ ] 7.3 在 LM Studio 與 OpenRouter 兩個 provider 之間切換並執行錄製驗證：
  - 設定頁的 connection test 對 OpenRouter 應回傳 `OK`
  - step-by-step 模式錄製單筆 click 應產生對應 Playwright 程式碼
  - one-time 模式錄製多步驟結束後應產生完整 script
- [ ] 7.4 載入帶 `provider: 'openai'` 或 `'ollama'` 的 storage（手動注入）後重啟，應自動降級為 LM Studio 並顯示提示
