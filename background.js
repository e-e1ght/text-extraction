// 확장 아이콘 클릭 → 현재 탭에 추출 패널을 열고 닫는다.
const CONTENT_FILES = ['adapters/registry.js', 'adapters/caveduck.js', 'adapters/rofan.js', 'adapters/teapot.js', 'adapters/elyn.js', 'adapters/crack.js', 'adapters/unichat.js', 'content.js'];

// 새 버전 알림: GitHub 의 manifest.json 버전과 설치된 버전을 비교한다 (자동 업데이트는 하지 않음)
const REPO_URL = 'https://github.com/e-e1ght/text-extraction';
const REMOTE_MANIFEST = 'https://raw.githubusercontent.com/e-e1ght/text-extraction/main/manifest.json';
const CHECK_ALARM = 'check-update';
const CHECK_INTERVAL_MIN = 24 * 60;
const RECHECK_MIN_MS = 30 * 60 * 1000; // 패널을 열 때는 30분에 한 번까지만 다시 확인

// "0.10.0" > "0.9.1" 처럼 숫자 단위로 비교
function isNewer(remote, local) {
  const a = String(remote).split('.').map(Number);
  const b = String(local).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

async function showUpdateBadge(hasUpdate) {
  await chrome.action.setBadgeBackgroundColor({ color: '#3b6ff0' });
  await chrome.action.setBadgeText({ text: hasUpdate ? 'NEW' : '' });
}

async function checkUpdate({ force = false } = {}) {
  const current = chrome.runtime.getManifest().version;
  const { updateInfo } = await chrome.storage.local.get('updateInfo');
  let latest = updateInfo?.latest;
  if (force || !updateInfo || Date.now() - updateInfo.checkedAt > RECHECK_MIN_MS) {
    try {
      const res = await fetch(REMOTE_MANIFEST, { cache: 'no-store' });
      if (res.ok) {
        latest = (await res.json()).version;
        await chrome.storage.local.set({ updateInfo: { latest, checkedAt: Date.now() } });
      }
    } catch {
      // 오프라인 등: 지난 확인 결과를 그대로 쓴다
    }
  }
  const hasUpdate = !!latest && isNewer(latest, current);
  await showUpdateBadge(hasUpdate);
  return { current, latest, hasUpdate, url: REPO_URL };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CHECK_ALARM, { periodInMinutes: CHECK_INTERVAL_MIN });
  checkUpdate({ force: true });
});
chrome.runtime.onStartup.addListener(() => checkUpdate({ force: true }));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) checkUpdate({ force: true });
});

// 패널이 열릴 때 물어본다
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req?.type !== 'check-update') return;
  checkUpdate().then(sendResponse, () => sendResponse(null));
  return true; // 비동기 응답
});

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
      // 지원하지 않는 사이트: 아이콘에 잠깐 표시 (끝나면 탭별 표시를 지워 NEW 배지가 다시 보이게)
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#c92a2a' });
      await chrome.action.setBadgeText({ tabId: tab.id, text: '×' });
      setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: null }), 2000);
    }
  }
});
