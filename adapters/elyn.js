// 엘린 (elyn.ai)
// API: https://api.elyn.ai/api/v1  (로그인 토큰은 elyn-access-token 쿠키, 사이트처럼 Bearer 로 보낸다)
//   대화방: GET /sessions/{세션UUID} → sessions[0]: character(name, firstMessage), persona(name), selectedFirstMessageIndex
//   대화:   GET /sessions/{세션UUID}/chats?only_activated=true&num_latest_depth=N[&before_depth=D]
//     → chats: 최신 depth 부터. 한 항목 = 한 턴: user_message(유저) + assistant_message(캐릭터, 교정 반영된 본문)
(() => {
  const API = 'https://api.elyn.ai/api/v1';
  const API_KEY = 'lynn+go!'; // 사이트 코드에 들어 있는 공개 값 (x-lynn-api-key)
  const PAGE_SIZE = 50;
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 2000;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const util = window.chatExtractorUtil;

  function sessionIdFromUrl() {
    const m = location.pathname.match(/\/chat\/([^/?#]+)/);
    const id = m && m[1].match(UUID_RE);
    if (!id) throw new Error('대화방을 찾지 못했습니다. 엘린 대화방 화면에서 실행해 주세요.');
    return id[0].toLowerCase();
  }

  function accessToken() {
    const m = document.cookie.match(/(?:^|;\s*)elyn-access-token=([^;]+)/);
    if (!m) throw new Error('로그인 정보를 찾지 못했습니다. 엘린에 로그인해 주세요.');
    return decodeURIComponent(m[1]);
  }

  async function api(path) {
    try {
      return await util.fetchJson(`${API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken()}`, 'x-lynn-api-key': API_KEY },
        credentials: 'omit',
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        throw new Error('대화 기록을 불러오지 못했습니다. 페이지를 새로고침하거나 로그인 상태를 확인해 주세요.');
      }
      throw e;
    }
  }

  async function fetchAllChats(sid, onProgress) {
    const byDepth = new Map();
    let before = null;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const qs = new URLSearchParams({ only_activated: 'true', num_latest_depth: String(PAGE_SIZE) });
      if (before !== null) qs.set('before_depth', String(before));
      const chats = (await api(`/sessions/${sid}/chats?${qs}`))?.chats || [];
      const fresh = chats.filter((c) => typeof c?.depth === 'number' && !byDepth.has(c.depth));
      if (!fresh.length) break; // 같은 턴이 다시 오면 끝 (무한 루프 방지)
      for (const c of fresh) byDepth.set(c.depth, c);
      onProgress(`불러오는 중... ${byDepth.size}턴`);
      before = Math.min(...byDepth.keys());
      if (before <= 0) break;
      await util.sleep(PAGE_DELAY_MS);
    }
    return [...byDepth.values()].sort((a, b) => a.depth - b.depth);
  }

  // 대화방에서 고른 첫 메시지 (한국어 우선)
  function pickGreeting(session) {
    const list = session.character?.firstMessage || [];
    const entry = list.find((f) => f?.locale === 'ko') || list[0];
    return entry?.messages?.[session.selectedFirstMessageIndex ?? 0] || '';
  }

  window.registerChatAdapter({
    id: 'elyn',
    name: '엘린',
    match: (loc) => /(^|\.)elyn\.ai$/.test(loc.hostname),

    async extract({ onProgress }) {
      onProgress('대화방 확인 중...');
      const sid = sessionIdFromUrl();
      const session = (await api(`/sessions/${sid}`))?.sessions?.find((s) => s?.id === sid);
      if (!session) throw new Error('대화방 정보를 읽지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
      const charName = (session.character?.name || session.name || '').trim();
      const userName = (session.persona?.name || '').trim();

      const chats = await fetchAllChats(sid, onProgress);

      const messages = [];
      const greeting = util.stripImageTags(pickGreeting(session));
      if (greeting) messages.push({ role: 'char', text: greeting, greeting: true });
      for (const c of chats) {
        const q = util.stripImageTags(c.user_message);
        if (q) messages.push({ role: 'user', text: q });
        const a = util.stripImageTags(c.assistant_message);
        if (a) messages.push({ role: 'char', text: a });
      }

      return {
        title: charName ? `${charName} 대화 기록` : '엘린 대화 기록',
        characterName: charName,
        userName,
        messages,
      };
    },
  });
})();
