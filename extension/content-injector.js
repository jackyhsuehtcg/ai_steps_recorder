// Content Injector - 確保在每個頁面載入時都能正確初始化
(function() {
  'use strict';
  
  // 避免重複注入
  if (window.stepsRecorderInjected) {
    return;
  }
  
  window.stepsRecorderInjected = true;
  
  // 等待頁面完全載入
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeRecorder);
  } else {
    initializeRecorder();
  }
  
  function initializeRecorder() {
    console.log('Initializing StepsRecorder...');
    console.log('Current window.stepsRecorder:', !!window.stepsRecorder);
    
    // 總是創建新實例以確保狀態乾淨
    if (window.stepsRecorder) {
      console.log('Cleaning up existing StepsRecorder instance...');
      try {
        if (typeof window.stepsRecorder.forceCleanup === 'function') {
          window.stepsRecorder.forceCleanup();
        }
      } catch (error) {
        console.warn('Error during cleanup:', error);
      }
    }
    
    // 創建新的 StepsRecorder 實例
    try {
      window.stepsRecorder = new StepsRecorder();
      console.log('StepsRecorder initialized successfully');
      
      // 檢查是否需要恢復錄製狀態
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'getRecordingState' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Failed to check recording state:', chrome.runtime.lastError.message);
            return;
          }
          
          if (response && response.success && response.state.isRecording) {
            console.log('Background has active recording, restoring state...');
            window.stepsRecorder.restoreRecordingState(response.state).then(result => {
              console.log('Restore completed:', result);
            }).catch(error => {
              console.error('Restore failed:', error);
            });
          } else {
            console.log('No active recording to restore');
          }
        });
      }, 500);
      
    } catch (error) {
      console.error('Error initializing StepsRecorder:', error);
    }
  }
  
  // 監聽來自 background script 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ensureRecorderReady') {
      if (!window.stepsRecorder) {
        initializeRecorder();
      }
      sendResponse({ ready: !!window.stepsRecorder });
    } else if (request.action === 'ping') {
      // 簡單的 ping 測試，確認 content script 可達
      sendResponse({ status: 'ok', timestamp: Date.now() });
    }
  });
  
  // 定期檢查與 background script 的連線
  function checkConnection() {
    try {
      chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Background script connection lost:', chrome.runtime.lastError.message);
        }
      });
    } catch (error) {
      console.warn('Connection check failed:', error);
    }
  }
  
  // 每 30 秒檢查一次連線
  setInterval(checkConnection, 30000);
  
  // 立即檢查一次
  setTimeout(checkConnection, 1000);
  
})();