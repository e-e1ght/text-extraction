// 로판 AI (rofan.ai)
// 대화 페이지 HTML의 __NEXT_DATA__ 에 대화방 정보(oriChatData)와 최근 로그 일부가 들어 있다.
// 이전 로그 API: POST /api/chat/GetChatLogs { chatId, limit, beforeTimestamp? }
//   beforeTimestamp 를 빼면 최신 로그부터, 넣으면 그 시각보다 오래된 로그를 준다.
// 첫 대화 API: POST /api/chat/GetFirstChatLog { chatId, beforeCount, afterCount } → { success, logs }
//   그 뒤는 GetChatLogs { chatId, afterTimestamp, limit, isFromSpecialNavigation: true } 로 이어 받는다.
// 로그 한 개 = 한 턴: user_chat(유저) + bot_chat(캐릭터)
(() => {
  const PAGE_SIZE = 20; // 사이트가 쓰는 값과 같게
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 5000;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const util = window.chatExtractorUtil;

  function chatIdFromUrl() {
    const m = location.pathname.match(/\/chat\/([^/?#]+)/);
    const id = m && m[1].match(UUID_RE);
    if (!id) throw new Error('대화방을 찾지 못했습니다. 로판 AI 대화방 화면에서 실행해 주세요.');
    return id[0].toLowerCase();
  }

  function parseNextData(html) {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]) : null;
  }

  // 페이지 안 이동(SPA)으로 들어오면 DOM의 __NEXT_DATA__ 는 처음 연 방의 것일 수 있어서,
  // 현재 방과 다르면 페이지를 새로 받아 읽는다.
  async function loadPageProps(chatId) {
    const el = document.getElementById('__NEXT_DATA__');
    try {
      const props = el && JSON.parse(el.textContent)?.props?.pageProps;
      if (props?.chatId === chatId) return props;
    } catch {
      // 아래에서 다시 받는다
    }
    const res = await fetch(location.href, { credentials: 'include' });
    const props = parseNextData(await res.text())?.props?.pageProps;
    if (props?.chatId !== chatId) throw new Error('대화방 정보를 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
    return props;
  }

  // 응답이 배열이 아니라 { logs: [...] } 처럼 감싸져 오는 경우도 받아 준다
  function asLogs(data) {
    if (Array.isArray(data)) return data;
    for (const key of ['logs', 'data', 'chatLogs', 'items']) {
      if (Array.isArray(data?.[key])) return data[key];
    }
    return null;
  }

  const snippet = (data) => {
    try {
      return JSON.stringify(data).slice(0, 120);
    } catch {
      return String(data).slice(0, 120);
    }
  };

  async function postLogs(path, body) {
    const data = await util.fetchJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const logs = asLogs(data);
    if (!logs) throw new Error(`대화 기록 응답을 읽지 못했습니다: ${snippet(data)}`);
    return logs;
  }

  const byCreated = (a, b) => new Date(a.created) - new Date(b.created);

  // seen 에 새 로그를 넣고, 새로 들어온 개수를 돌려준다
  function addLogs(seen, logs) {
    let added = 0;
    for (const l of logs) {
      if (l?.log_id && !seen.has(l.log_id)) {
        seen.set(l.log_id, l);
        added++;
      }
    }
    return added;
  }

  // 방법 1: 최신 로그부터 beforeTimestamp 로 거슬러 올라간다 (사이트의 "이전 대화 불러오기")
  async function fetchBackward(chatId, seen, onProgress) {
    let page = await postLogs('/api/chat/GetChatLogs', { chatId, limit: PAGE_SIZE });
    for (let pages = 1; pages <= MAX_PAGES && addLogs(seen, page); pages++) {
      onProgress(`불러오는 중... ${seen.size}턴`);
      const oldest = [...seen.values()].sort(byCreated)[0];
      await util.sleep(PAGE_DELAY_MS);
      page = await postLogs('/api/chat/GetChatLogs', { chatId, limit: PAGE_SIZE, beforeTimestamp: oldest.created });
    }
  }

  // 방법 2: 첫 대화부터 afterTimestamp 로 내려온다 (사이트의 "첫 대화로 이동")
  async function fetchForward(chatId, seen, onProgress) {
    let page = await postLogs('/api/chat/GetFirstChatLog', { chatId, beforeCount: 0, afterCount: 10 });
    for (let pages = 1; pages <= MAX_PAGES && addLogs(seen, page); pages++) {
      onProgress(`불러오는 중... ${seen.size}턴`);
      const sorted = [...seen.values()].sort(byCreated);
      const newest = sorted[sorted.length - 1];
      await util.sleep(PAGE_DELAY_MS);
      page = await postLogs('/api/chat/GetChatLogs', {
        chatId,
        afterTimestamp: newest.created,
        limit: PAGE_SIZE,
        isFromSpecialNavigation: true,
      });
    }
  }

  async function fetchAllLogs(chatId, initialLogs, onProgress) {
    const seen = new Map();
    const errors = [];
    try {
      await fetchBackward(chatId, seen, onProgress);
    } catch (e) {
      errors.push(e);
    }
    // 거슬러 올라가기가 실패했으면 첫 대화부터 다시 받아 빈 곳을 채운다
    if (errors.length) {
      try {
        await fetchForward(chatId, seen, onProgress);
      } catch (e) {
        errors.push(e);
      }
    }
    // 페이지에 이미 들어 있던 최근 로그도 합친다 (먼저 넣으면 첫 페이지가 '새 로그 없음'으로 보여 멈춘다)
    addLogs(seen, initialLogs || []);
    if (errors.length === 2 && !seen.size) {
      const last = errors[errors.length - 1];
      if (last.status === 401 || last.status === 403) {
        throw new Error('대화 기록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.');
      }
      throw last;
    }
    return { logs: [...seen.values()].sort(byCreated), partial: errors.length === 2 };
  }

  // HTML 주석(<!-- OOC ... -->)은 그대로 두고, 넣을지 말지는 패널 옵션에서 정한다
  const clean = (text) => (text || '').trim();

  window.registerChatAdapter({
    id: 'rofan',
    name: '로판 AI',
    match: (loc) => /(^|\.)rofan\.ai$/.test(loc.hostname),

    async extract({ onProgress }) {
      onProgress('대화방 확인 중...');
      const chatId = chatIdFromUrl();
      const props = await loadPageProps(chatId);
      const chat = props.oriChatData || {};
      const charName = (chat.char || props.botDetail?.char || '').trim();
      const userName = (chat.user || props.botDetail?.user || '').trim();

      const { logs, partial } = await fetchAllLogs(chatId, props.initialChatLogs, onProgress);

      const messages = [];
      const greeting = chat.first_message || props.botDetail?.first_message;
      if (clean(greeting)) messages.push({ role: 'char', text: clean(greeting), greeting: true });
      for (const log of logs) {
        const q = clean(log.user_chat);
        if (q) messages.push({ role: 'user', text: q });
        const a = clean(log.bot_chat);
        if (a) messages.push({ role: 'char', text: a });
      }

      return {
        title: charName ? `${charName} 대화 기록` : '로판 AI 대화 기록',
        characterName: charName,
        userName,
        messages,
        warning: partial ? '일부 대화만 불러왔습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' : undefined,
      };
    },
  });
})();
