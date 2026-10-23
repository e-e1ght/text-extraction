// 크랙 (crack.wrtn.ai)
// 대화방 주소: /stories/{스토리id}/episodes/{대화id}
// API: https://crack-api.wrtn.ai  (로그인 토큰은 access_token 쿠키, 사이트처럼 Bearer 로 보낸다)
//   대화방: GET /crack-gen/v3/chats/{대화id} → data.story.name(캐릭터), data.title
//   메시지: GET /crack-gen/v3/chats/{대화id}/messages?limit=N[&cursor=...]
//     → data.messages: 최신부터, role(user|assistant) + content. data.hasNext / data.nextCursor 로 이어 받는다.
//     가장 오래된 assistant 메시지가 첫 인사말이다.
(() => {
  const API = 'https://crack-api.wrtn.ai';
  const PAGE_SIZE = 50;
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 2000;
  const util = window.chatExtractorUtil;

  function chatIdFromUrl() {
    const m = location.pathname.match(/\/episodes\/([0-9a-f]{24})/i);
    if (!m) throw new Error('대화방을 찾지 못했습니다. 크랙 대화방 화면에서 실행해 주세요.');
    return m[1];
  }

  function accessToken() {
    const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
    if (!m) throw new Error('로그인 정보를 찾지 못했습니다. 크랙에 로그인해 주세요.');
    return decodeURIComponent(m[1]);
  }

  async function api(path) {
    try {
      const res = await util.fetchJson(`${API}${path}`, {
        headers: { Authorization: `Bearer ${accessToken()}` },
        credentials: 'omit',
      });
      return res?.data;
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        throw new Error('대화 기록을 불러오지 못했습니다. 페이지를 새로고침하거나 로그인 상태를 확인해 주세요.');
      }
      throw e;
    }
  }

  async function fetchAllMessages(chatId, onProgress) {
    const all = [];
    const seen = new Set();
    let cursor = null;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (cursor) qs.set('cursor', cursor);
      const data = await api(`/crack-gen/v3/chats/${chatId}/messages?${qs}`);
      const fresh = (data?.messages || []).filter((m) => m?._id && !seen.has(m._id));
      if (!fresh.length) break; // 같은 메시지가 다시 오면 끝 (무한 루프 방지)
      for (const m of fresh) {
        seen.add(m._id);
        all.push(m);
      }
      onProgress(`불러오는 중... 메시지 ${all.length}개`);
      if (!data.hasNext || !data.nextCursor) break;
      cursor = data.nextCursor;
      await util.sleep(PAGE_DELAY_MS);
    }
    return all.reverse(); // 오래된 순으로
  }

  // 본문 속 이미지(마크다운 ![이름](주소))와 이미지 표시는 txt 에서 뺀다
  const clean = (text) => util.stripImageTags((text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, ''));

  window.registerChatAdapter({
    id: 'crack',
    name: '크랙',
    match: (loc) => loc.hostname === 'crack.wrtn.ai',

    async extract({ onProgress }) {
      onProgress('대화방 확인 중...');
      const chatId = chatIdFromUrl();
      const chat = await api(`/crack-gen/v3/chats/${chatId}`);
      const charName = (chat?.story?.name || chat?.title || '').trim();

      const rows = await fetchAllMessages(chatId, onProgress);

      const messages = [];
      rows.forEach((m, i) => {
        const text = clean(m.content);
        if (!text) return;
        if (m.role === 'user') messages.push({ role: 'user', text });
        else messages.push({ role: 'char', text, greeting: i === 0 });
      });

      return {
        title: charName ? `${charName} 대화 기록` : '크랙 대화 기록',
        characterName: charName,
        userName: '',
        messages,
      };
    },
  });
})();
