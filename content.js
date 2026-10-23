// 확장 아이콘을 누르면 현재 페이지 위에 추출 패널을 띄운다.
// 패널은 Shadow DOM 안에 그려서 사이트 CSS와 서로 간섭하지 않게 한다.

function formatTranscript(result, options) {
  const userName = (options.userName || '').trim() || result.userName || '나';
  const charOverride = (options.charName || '').trim();
  const charName = charOverride || result.characterName || '캐릭터';

  const replacePlaceholders = (text) =>
    options.replacePlaceholders
      ? text.replace(/\{\{\s*user\s*\}\}/gi, userName).replace(/\{\{\s*char\s*\}\}/gi, charName)
      : text;

  // 사이트 화면에 보이지 않는 HTML 주석(<!-- ... -->)
  const stripComments = (text) => (options.includeComments ? text : text.replace(/<!--[\s\S]*?-->/g, ''));

  const lines = [];
  lines.push(`# ${charOverride ? `${charOverride} 대화 기록` : result.title || charName}`);
  lines.push(`# 추출일: ${new Date().toLocaleString('ko-KR')}`);
  const shown = result.messages
    .filter((msg) => !msg.greeting || options.includeGreeting)
    .map((msg) => ({ ...msg, text: stripComments(msg.text).trim() }))
    .filter((msg) => msg.text); // 주석만 있던 메시지는 뺀다
  lines.push(`# 메시지 수: ${shown.length}`);
  lines.push('');

  for (const msg of shown) {
    const name = msg.role === 'user' ? userName : charOverride || msg.name || charName;
    lines.push(`[${name}]`);
    lines.push(replacePlaceholders(msg.text));
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

// 패널 글꼴: 프리젠테이션(Freesentation). Shadow DOM 안의 @font-face 는 적용되지 않아서
// 파일을 직접 받아 document.fonts 에 넣는다 (사이트 CSP 와 상관없이 동작).
const FONT_FAMILY = 'ChatExtractorPresentation';
const FONT_BASE = 'https://cdn.jsdelivr.net/gh/projectnoonnu/2404@1.0/';
const FONT_FILES = {
  400: 'Freesentation-4Regular',
  500: 'Freesentation-5Medium',
  600: 'Freesentation-6SemiBold',
  700: 'Freesentation-7Bold',
};
let fontsLoaded = false;

function loadPanelFonts() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  for (const [weight, file] of Object.entries(FONT_FILES)) {
    fetch(`${FONT_BASE}${file}.woff2`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(res.status)))
      .then((buf) => document.fonts.add(new FontFace(FONT_FAMILY, buf, { weight })))
      .catch(() => {}); // 못 받으면 기본 글꼴로 보인다
  }
}

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    --bg: #fafbfe; --card: #ffffff; --line: #e2e7f0; --text: #1f2633; --muted: #7c8696;
    --accent: #3b6ff0; --accent-2: #5aa7f5; --accent-soft: #eaf1fe;
    --error: #d6455d; --error-soft: #fdecef; --ok: #3f9c76; --ok-soft: #e9f6f0;
    position: fixed; top: 16px; right: 16px; z-index: 2147483647;
    width: 300px; box-sizing: border-box; padding: 18px;
    font: 400 14px/1.5 '${FONT_FAMILY}', system-ui, 'Malgun Gothic', sans-serif;
    color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: 20px;
    box-shadow: 0 2px 6px rgba(30, 45, 80, .06), 0 18px 48px rgba(30, 45, 80, .16);
    animation: pop .18s ease-out;
  }
  @media (prefers-color-scheme: dark) {
    .panel {
      --bg: #1b1e25; --card: #232731; --line: #343a47; --text: #e9edf4; --muted: #98a1b0;
      --accent-soft: #24304a; --error: #f0738a; --error-soft: #3b2529; --ok: #6cc9a1; --ok-soft: #233630;
      box-shadow: 0 18px 48px rgba(0, 0, 0, .5);
    }
  }
  @keyframes pop { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
  * { box-sizing: border-box; font-family: inherit; }

  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .logo {
    flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    font-size: 13px; font-weight: 700; overflow: hidden;
  }
  .logo.has-icon { background: #fff; border: 1px solid var(--line); }
  .logo img { width: 22px; height: 22px; object-fit: contain; }
  .titles { flex: 1; min-width: 0; }
  h1 { margin: 0; font-size: 17px; font-weight: 700; line-height: 1.3; }
  .site { margin: 0; font-size: 12px; color: var(--muted); }
  .close {
    all: unset; flex: none; display: grid; place-items: center; width: 28px; height: 28px;
    border-radius: 9px; cursor: pointer; color: var(--muted); font-size: 18px; line-height: 1;
  }
  .close:hover { background: var(--accent-soft); color: var(--text); }

  .group { margin: 0 0 12px; padding: 12px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
  .group-title { margin: 0 0 4px; font-size: 12px; font-weight: 600; color: var(--muted); }

  .field { display: block; }
  .field + .field { margin-top: 10px; }
  .field span { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; margin-bottom: 5px; font-weight: 500; }
  .field small { font-size: 11px; font-weight: 400; color: var(--muted); }
  .field input {
    width: 100%; padding: 8px 11px; font-size: 14px; color: var(--text);
    background: var(--bg); border: 1px solid var(--line); border-radius: 10px; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .field input::placeholder { color: var(--muted); opacity: .7; }
  .field input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

  .toggle { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 0; cursor: pointer; }
  .toggle + .toggle { border-top: 1px dashed var(--line); }
  .toggle code { font-family: inherit; font-size: 12px; padding: 0 4px; border-radius: 5px; background: var(--accent-soft); }
  .toggle input {
    appearance: none; flex: none; position: relative; width: 36px; height: 21px; margin: 0;
    border-radius: 999px; background: var(--line); cursor: pointer; transition: background .18s;
  }
  .toggle input::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 15px; height: 15px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform .18s;
  }
  .toggle input:checked { background: var(--accent); }
  .toggle input:checked::after { transform: translateX(15px); }
  .toggle input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .go {
    all: unset; display: block; box-sizing: border-box; width: 100%; padding: 12px;
    text-align: center; border-radius: 13px; cursor: pointer;
    background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #fff;
    font-size: 15px; font-weight: 600; box-shadow: 0 6px 16px rgba(59, 111, 240, .32);
    transition: transform .12s, box-shadow .12s, filter .12s;
  }
  .go:hover { filter: brightness(1.04); box-shadow: 0 8px 20px rgba(59, 111, 240, .4); }
  .go:active { transform: translateY(1px); }
  .go:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .go[disabled] { background: var(--line); color: var(--muted); box-shadow: none; cursor: default; filter: none; }

  .status {
    margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; font-size: 13px;
    white-space: pre-wrap; word-break: break-all; background: var(--accent-soft);
  }
  .status:empty { display: none; }
  .status.done { background: var(--ok-soft); color: var(--ok); }
  .status.error { background: var(--error-soft); color: var(--error); }

  .update {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: -4px 0 12px; padding: 9px 12px; border-radius: 12px; font-size: 13px;
    background: var(--accent-soft); color: var(--text);
  }
  .update[hidden] { display: none; }
  .update b { color: var(--accent); font-weight: 600; }
  .update a {
    flex: none; padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 600;
    color: #fff; background: var(--accent); text-decoration: none;
  }
  .update a:hover { filter: brightness(1.06); }
`;

const PANEL_HTML = `
  <div class="panel">
    <div class="head">
      <div class="logo">txt</div>
      <div class="titles">
        <h1>대화 txt 추출</h1>
        <p class="site"></p>
      </div>
      <button class="close" title="닫기 (Esc)">×</button>
    </div>
    <div class="update" hidden>
      <span>새 버전 <b class="update-ver"></b>이 나왔어요</span>
      <a class="update-link" target="_blank" rel="noopener">GitHub 열기</a>
    </div>
    <div class="group">
      <label class="field">
        <span>내 이름 <small>비우면 사이트 정보 또는 "나"</small></span>
        <input data-opt="userName" type="text" placeholder="예: 아린">
      </label>
      <label class="field">
        <span>캐릭터 이름 <small>비우면 사이트의 캐릭터 이름</small></span>
        <input data-opt="charName" data-nosave type="text" placeholder="예: 레온">
      </label>
    </div>
    <div class="group">
      <p class="group-title">옵션</p>
      <label class="toggle"><span>첫 인사말 포함</span><input data-opt="includeGreeting" type="checkbox" checked></label>
      <label class="toggle"><span><code>{{user}}</code> <code>{{char}}</code> 이름으로 바꾸기</span><input data-opt="replacePlaceholders" type="checkbox" checked></label>
      <label class="toggle"><span>주석 <code>&lt;!-- --&gt;</code> 포함하기</span><input data-opt="includeComments" type="checkbox"></label>
      <label class="toggle"><span>메시지 사이 구분선 <code>-----</code></span><input data-opt="useSeparator" type="checkbox"></label>
    </div>
    <button class="go">이 대화방 추출하기</button>
    <p class="status"></p>
  </div>
`;

// 헤더 로고 자리에 지금 사이트의 아이콘(파비콘)을 띄운다. 못 불러오면 "txt" 그대로 둔다.
function siteIconUrls() {
  const links = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
    .map((l) => ({ href: l.href, size: parseInt((l.getAttribute('sizes') || '').split('x')[0], 10) || 0, svg: /svg/.test(l.type) }))
    .filter((l) => l.href);
  // 선명하게 보이도록 svg → 큰 크기 순으로 고르고, 마지막에 /favicon.ico
  links.sort((a, b) => b.svg - a.svg || b.size - a.size);
  return [...new Set([...links.map((l) => l.href), `${location.origin}/favicon.ico`])];
}

function showSiteIcon(logo) {
  const urls = siteIconUrls();
  const img = document.createElement('img');
  img.alt = '';
  let i = 0;
  img.onload = () => {
    logo.textContent = '';
    logo.classList.add('has-icon');
    logo.appendChild(img);
  };
  img.onerror = () => {
    if (++i < urls.length) img.src = urls[i];
  };
  img.src = urls[0];
}

let panelHost = null;

function createPanel() {
  const host = document.createElement('div');
  host.id = 'chat-extractor-panel';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${PANEL_CSS}</style>${PANEL_HTML}`;
  loadPanelFonts();

  const $ = (sel) => root.querySelector(sel);
  const optInputs = [...root.querySelectorAll('[data-opt]')];
  // 캐릭터 이름은 대화방마다 다르므로 저장하지 않는다
  const savedInputs = optInputs.filter((el) => !('nosave' in el.dataset));
  const status = $('.status');
  const goBtn = $('.go');
  $('.site').textContent = window.findChatAdapter(location)?.name || '지원하지 않는 사이트';
  showSiteIcon($('.logo'));

  // GitHub 에 새 버전이 올라왔으면 안내와 링크를 띄운다
  chrome.runtime
    .sendMessage({ type: 'check-update' })
    .then((info) => {
      if (!info?.hasUpdate) return;
      $('.update-ver').textContent = `v${info.latest}`;
      $('.update-link').href = info.url;
      $('.update').hidden = false;
    })
    .catch(() => {});

  // kind: '' (진행 중) | 'done' | 'error'
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = kind ? `status ${kind}` : 'status';
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

  const readSaved = () =>
    Object.fromEntries(savedInputs.map((el) => [el.dataset.opt, el.type === 'checkbox' ? el.checked : el.value]));

  chrome.storage.local.get(savedInputs.map((el) => el.dataset.opt)).then((saved) => {
    for (const el of savedInputs) {
      const v = saved[el.dataset.opt];
      if (v === undefined) continue;
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
  });
  for (const el of savedInputs) el.addEventListener('change', () => chrome.storage.local.set(readSaved()));

  $('.close').addEventListener('click', closePanel);

  goBtn.addEventListener('click', async () => {
    const adapter = window.findChatAdapter(location);
    if (!adapter) {
      setStatus('이 페이지는 지원하지 않는 사이트입니다.', 'error');
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
      const name = (options.charName || '').trim() || result.characterName || adapter.name;
      const filename = `${safeFilename(name)}_${date}.txt`;
      downloadText(formatTranscript(result, options), filename);
      const warning = result.warning ? `\n${result.warning}` : '';
      setStatus(`완료: 메시지 ${result.messages.length}개 → ${filename}${warning}`, result.warning ? 'error' : 'done');
    } catch (e) {
      setStatus(e.message || String(e), 'error');
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
