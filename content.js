// 확장 아이콘을 누르면 현재 페이지 위에 추출 패널을 띄운다.
// 패널은 Shadow DOM 안에 그려서 사이트 CSS와 서로 간섭하지 않게 한다.

function formatTranscript(result, options) {
  const userName = (options.userName || '').trim() || result.userName || '나';
  const charName = result.characterName || '캐릭터';

  const replacePlaceholders = (text) =>
    options.replacePlaceholders
      ? text.replace(/\{\{\s*user\s*\}\}/gi, userName).replace(/\{\{\s*char\s*\}\}/gi, charName)
      : text;

  const lines = [];
  lines.push(`# ${result.title || charName}`);
  lines.push(`# 추출일: ${new Date().toLocaleString('ko-KR')}`);
  lines.push(`# 메시지 수: ${result.messages.length}`);
  lines.push('');

  for (const msg of result.messages) {
    if (msg.greeting && !options.includeGreeting) continue;
    const name = msg.role === 'user' ? userName : msg.name || charName;
    lines.push(`[${name}]`);
    lines.push(replacePlaceholders(msg.text.trim()));
    lines.push('');
    if (options.separator) lines.push(options.separator, '');
  }
  return lines.join('\n');
}

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80) || 'chat';
}

function downloadText(text, filename) {
  const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 280px; box-sizing: border-box; padding: 14px;
    font: 13px/1.5 system-ui, "Malgun Gothic", sans-serif; color: #222;
    background: #fff; border: 1px solid #ddd; border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0,0,0,.18);
  }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  h1 { font-size: 15px; margin: 0; }
  .close { all: unset; cursor: pointer; font-size: 18px; line-height: 1; padding: 2px 6px; color: #888; }
  .close:hover { color: #222; }
  .field { display: block; margin-bottom: 10px; }
  .field span { display: block; margin-bottom: 4px; }
  .field small { color: #888; }
  .field input {
    width: 100%; box-sizing: border-box; padding: 6px 8px;
    border: 1px solid #ccc; border-radius: 6px; font: inherit; color: inherit; background: #fff;
  }
  .check { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; cursor: pointer; }
  .go {
    all: unset; display: block; box-sizing: border-box; width: 100%; margin-top: 10px; padding: 9px;
    text-align: center; border-radius: 6px; background: #3b5bdb; color: #fff; font-weight: 600; cursor: pointer;
  }
  .go[disabled] { background: #999; cursor: default; }
  .status { min-height: 1.5em; margin: 10px 0 0; white-space: pre-wrap; }
  .status.error { color: #c92a2a; }
`;

const PANEL_HTML = `
  <div class="panel">
    <div class="head">
      <h1>대화 txt 추출</h1>
      <button class="close" title="닫기">×</button>
    </div>
    <label class="field">
      <span>내 이름 <small>(비우면 사이트 정보 또는 "나")</small></span>
      <input data-opt="userName" type="text" placeholder="예: 아린">
    </label>
    <label class="check"><input data-opt="includeGreeting" type="checkbox" checked> 첫 인사말 포함</label>
    <label class="check"><input data-opt="replacePlaceholders" type="checkbox" checked> {{user}} / {{char}}를 이름으로 바꾸기</label>
    <label class="check"><input data-opt="useSeparator" type="checkbox"> 메시지 사이에 구분선(-----) 넣기</label>
    <button class="go">이 대화방 추출하기</button>
    <p class="status"></p>
  </div>
`;

let panelHost = null;

function createPanel() {
  const host = document.createElement('div');
  host.id = 'chat-extractor-panel';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${PANEL_CSS}</style>${PANEL_HTML}`;

  const $ = (sel) => root.querySelector(sel);
  const optInputs = [...root.querySelectorAll('[data-opt]')];
  const status = $('.status');
  const goBtn = $('.go');

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.className = isError ? 'status error' : 'status';
  };

  const readOptions = () =>
    Object.fromEntries(optInputs.map((el) => [el.dataset.opt, el.type === 'checkbox' ? el.checked : el.value]));

  // 사이트 단축키가 패널 입력을 가로채지 않도록
  for (const type of ['keydown', 'keyup', 'keypress']) {
    root.addEventListener(type, (e) => {
      e.stopPropagation();
      if (type === 'keydown' && e.key === 'Escape') closePanel();
    });
  }

  chrome.storage.local.get(optInputs.map((el) => el.dataset.opt)).then((saved) => {
    for (const el of optInputs) {
      const v = saved[el.dataset.opt];
      if (v === undefined) continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
  });
  for (const el of optInputs) el.addEventListener('change', () => chrome.storage.local.set(readOptions()));

  $('.close').addEventListener('click', closePanel);

  goBtn.addEventListener('click', async () => {
    const adapter = window.findChatAdapter(location);
    if (!adapter) {
      setStatus('이 페이지는 지원하지 않는 사이트입니다.', true);
      return;
    }
    const opts = readOptions();
    const options = { ...opts, separator: opts.useSeparator ? '-----' : '' };

    goBtn.disabled = true;
    setStatus('추출 중...');
    try {
      const result = await adapter.extract({ onProgress: (t) => setStatus(t) });
      if (!result.messages.length) throw new Error('추출할 메시지가 없습니다.');
      const date = new Date().toISOString().slice(0, 10);
      const filename = `${safeFilename(result.characterName || adapter.name)}_${date}.txt`;
      downloadText(formatTranscript(result, options), filename);
      setStatus(`완료: 메시지 ${result.messages.length}개 → ${filename}`);
    } catch (e) {
      setStatus(e.message || String(e), true);
    } finally {
      goBtn.disabled = false;
    }
  });

  document.documentElement.appendChild(host);
  return host;
}

function closePanel() {
  if (panelHost) panelHost.style.display = 'none';
}

function togglePanel() {
  if (!panelHost || !panelHost.isConnected) {
    panelHost = createPanel();
    return;
  }
  panelHost.style.display = panelHost.style.display === 'none' ? '' : 'none';
}

if (!window.__chatExtractorLoaded) {
  window.__chatExtractorLoaded = true;
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req?.type !== 'toggle-panel') return;
    togglePanel();
    sendResponse({ ok: true });
  });
}
