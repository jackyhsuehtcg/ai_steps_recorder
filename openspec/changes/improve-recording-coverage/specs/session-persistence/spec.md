## MODIFIED Requirements

### Requirement: Result Viewer 暫存交接

The system SHALL 在 one-time 模式錄製結束或 step-by-step 已產生程式碼時，把 session 寫入暫存 key 並開啟 result viewer 分頁；result viewer 在「程式碼產生完成」與「使用者離開頁面」兩個時機需主動清掉這些暫存 key 與對應的 progress key。

新增「清理時機」與「孤兒鍵清理」兩個 scenario；既有寫入流程不變。

#### Scenario: result viewer 完成生成時清理（更新後新增）

- **GIVEN** result viewer 進入「Generating」狀態，且 progress 達 100%
- **WHEN** `completeGeneration()` 被呼叫
- **THEN** 從 URL query 取出 `temp` 參數作為 tempKey
- **AND** 呼叫 `chrome.storage.local.remove([tempKey, 'progress_<sessionId>'])` 移除兩個 key
- **AND** remove 失敗時靜默 catch（避免影響主流程）

#### Scenario: result viewer beforeunload 時保險清理（更新後新增）

- **GIVEN** result viewer 已開啟
- **WHEN** 使用者關閉分頁或重整（觸發 `beforeunload`）
- **THEN** 同樣清理 tempKey 與 progress key
- **AND** 若已在 completeGeneration 清過，再清一次無害（chrome.storage remove 對不存在的 key 是 no-op）

#### Scenario: background 寫新 temp key 時清孤兒（更新後新增）

- **GIVEN** background 呼叫 `writeToTempFileAndOpenViewer`
- **WHEN** 寫入新的 `temp_session_<timestamp>`
- **THEN** 同時掃描 `chrome.storage.local` 中所有 `temp_session_*` 與 `progress_*` 鍵
- **AND** 對於 timestamp（key 名中的數字）超過 1 小時前的鍵，呼叫 remove 清除
- **AND** 此清理為 best-effort，掃描或刪除失敗時靜默 catch

#### Scenario: 寫入暫存 key（不變）

- **WHEN** `writeToTempFileAndOpenViewer(sessionData)` 被呼叫
- **THEN** 寫入 `chrome.storage.local`：
  - `temp_session_<timestamp>: <sessionData>`
  - `latest_temp_session: 'temp_session_<timestamp>'`

#### Scenario: 進度雙通道發送（不變）

- **WHEN** `notifyProgress(sessionId, progressData)` 被呼叫
- **THEN** 對所有開啟的 `result-viewer.html` 分頁發送 `progressUpdate` 訊息
- **AND** 同時寫入 `chrome.storage.local` 的 `progress_<sessionId>: { ...progressData, timestamp }`
