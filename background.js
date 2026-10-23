// 확장 아이콘 클릭 → 현재 탭에 추출 패널을 열고 닫는다.
const CONTENT_FILES = ['adapters/registry.js', 'adapters/caveduck.js', 'adapters/rofan.js', 'adapters/teapot.js', 'content.js'];

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
  } catch {
    // 확장 설치 전에 열어둔 탭이면 스크립트가 없으므로 지금 넣고 다시 시도
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' });
    } catch {
      // 지원하지 않는 사이트: 아이콘에 잠깐 표시
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#c92a2a' });
      await chrome.action.setBadgeText({ tabId: tab.id, text: '×' });
      setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 2000);
    }
  }
});
