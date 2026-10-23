// 유니챗 (univers.chat)
// 대화방 주소: /play/{세션UUID}
// API (같은 사이트, 로그인 쿠키로 동작): GET /api/ai/play/chat?sessionId={세션UUID}&limit=N[&before={가장 오래된 메시지 id}]
//   → messages: 오래된 순(sequence), role(user|assistant) + content, is_selected(재생성 중 고른 답변)
//     hasMore 가 true 면 before 로 더 오래된 메시지를 받는다. sequence 0 은 첫 인사말.
//   → characterCard.name(캐릭터), personaName(내 이름)
(() => {
  const PAGE_SIZE = 50;
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 2000;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const util = window.chatExtractorUtil;

  function sessionIdFromUrl() {
    const m = location.pathname.match(/\/play\/([^/?#]+)/);
    const id = m && m[1].match(UUID_RE);
    if (!id) throw new Error('대화방을 찾지 못했습니다. 유니챗 대화방 화면에서 실행해 주세요.');
    return id[0].toLowerCase();
  }

  async function fetchPage(sid, before) {
    const qs = new URLSearchParams({ sessionId: sid, limit: String(PAGE_SIZE) });
    if (before) qs.set('before', before);
    try {
      return await util.fetchJson(`/api/ai/play/chat?${qs}`);
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        throw new Error('대화 기록을 불러오지 못했습니다. 로그인 상태를 확인해 주세요.');
      }
      throw e;
    }
  }

  async function fetchAll(sid, onProgress) {
    const first = await fetchPage(sid);
    const byId = new Map();
    let page = first;
    for (let pages = 1; pages <= MAX_PAGES; pages++) {
      const msgs = page?.messages || [];
      const before = byId.size;
      for (const m of msgs) if (m?.id) byId.set(m.id, m);
      onProgress(`불러오는 중... 메시지 ${byId.size}개`);
      // 더 없거나, 같은 메시지만 다시 오면 끝 (무한 루프 방지)
      if (!page?.hasMore || !msgs.length || byId.size === before) break;
      const chosen = msgs.filter((m) => m.is_selected !== false);
      const oldest = (chosen.length ? chosen : msgs).reduce((a, b) => ((b.sequence ?? 0) < (a.sequence ?? 0) ? b : a));
      await util.sleep(PAGE_DELAY_MS);
      page = await fetchPage(sid, oldest.id);
    }
    const messages = [...byId.values()]
      .filter((m) => m.is_selected !== false)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
    return { info: first, messages };
  }

  window.registerChatAdapter({
    id: 'unichat',
    name: '유니챗',
    match: (loc) => /(^|\.)univers\.chat$/.test(loc.hostname),

    async extract({ onProgress }) {
      onProgress('대화방 확인 중...');
      const sid = sessionIdFromUrl();
      const { info, messages: rows } = await fetchAll(sid, onProgress);
      const charName = (info?.characterCard?.name || '').trim();
      const userName = (info?.personaName || info?.personaData?.name || '').trim();

      const messages = [];
      rows.forEach((m, i) => {
        const text = util.stripImageTags(m.content);
        if (!text) return;
        if (m.role === 'user') messages.push({ role: 'user', text });
        else messages.push({ role: 'char', text, greeting: i === 0 && m.sequence === 0 });
      });

      return {
        title: charName ? `${charName} 대화 기록` : '유니챗 대화 기록',
        characterName: charName,
        userName,
        messages,
      };
    },
  });
})();
