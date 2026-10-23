// 케이브덕 (caveduck.io)
// 대화 기록 API: GET /api/chat/sessions/{세션UUID}/chats
//   첫 페이지: ?page_size=N            → 최신 턴부터
//   다음 페이지: &chat_id={가장 오래된 턴 id}&direction=older  (has_next 가 true 인 동안)
// 한 항목(chat) = 한 턴: content.data.query(유저) + content.data.answer(캐릭터), 언어별 {ko, en}
(() => {
  const API = 'https://caveduck.io/api/';
  const PAGE_SIZE = 50;
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 2000;
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const util = window.chatExtractorUtil;

  function chatsUrl(sessionUuid, params) {
    const qs = new URLSearchParams({ page_size: String(PAGE_SIZE), ...params });
    return `${API}chat/sessions/${sessionUuid}/chats?${qs}`;
  }

  // 언어별 텍스트 중 우선순위대로 비어 있지 않은 것을 고른다
  function pickLang(obj, prefer) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    for (const lang of prefer) {
      if (lang && typeof obj[lang] === 'string' && obj[lang].trim()) return obj[lang];
    }
    return Object.values(obj).find((v) => typeof v === 'string' && v.trim()) || '';
  }

  // URL에 들어 있는 UUID 중 실제 대화 세션인 것을 찾는다.
  // 나머지 UUID는 캐릭터 UUID일 수 있으므로 같이 돌려준다.
  async function resolveSession() {
    const candidates = [...new Set((location.href.match(UUID_RE) || []).map((s) => s.toLowerCase()))];
    for (const uuid of candidates) {
      try {
        const first = await util.fetchJson(chatsUrl(uuid, {}));
        if (Array.isArray(first?.chats)) return { uuid, first, otherUuids: candidates.filter((c) => c !== uuid) };
      } catch {
        // 세션 UUID가 아니면 다음 후보
      }
    }
    throw new Error('대화방을 찾지 못했습니다. 케이브덕 대화방 화면에서 실행해 주세요.');
  }

  async function fetchAllChats(uuid, first, onProgress) {
    const all = [...first.chats];
    let page = first;
    let pages = 1;
    while (page.has_next && page.chats.length && pages < MAX_PAGES) {
      const oldestId = page.chats[page.chats.length - 1].id;
      await util.sleep(PAGE_DELAY_MS);
      page = await util.fetchJson(chatsUrl(uuid, { chat_id: String(oldestId), direction: 'older' }));
      // 이미 받은 턴이 다시 오면 중단 (무한 루프 방지)
      const fresh = page.chats.filter((c) => !all.some((a) => a.id === c.id));
      if (!fresh.length) break;
      all.push(...fresh);
      pages++;
      onProgress(`불러오는 중... ${all.length}턴`);
    }
    return all.reverse(); // 오래된 순으로
  }

  // 유저 본인으로 보이는 이름인지 ({{user}}, 또는 페르소나 이름과 겹침: "양위천" ↔ "위천")
  function isUserName(name, userName) {
    if (/\{\{\s*user\s*\}\}/i.test(name)) return true;
    if (!userName) return false;
    const a = name.replace(/\s/g, '');
    const b = userName.replace(/\s/g, '');
    return a.includes(b) || b.includes(a);
  }

  // 모든 턴의 environment_state.characters 에서, 유저를 뺀 가장 비중 높은 인물을 세어
  // 가장 자주 주인공 자리에 나온 이름을 고른다
  function mainEnvCharacter(chats, userName) {
    const counts = new Map();
    for (const chat of chats) {
      const chars = (chat?.content?.data?.environment_state?.characters || []).filter(
        (c) => c?.name && !isUserName(c.name, userName)
      );
      if (!chars.length) continue;
      chars.sort((a, b) => (b.importance || 0) - (a.importance || 0));
      counts.set(chars[0].name, (counts.get(chars[0].name) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }

  function toMessages(chats) {
    const messages = [];
    let speakerName = '';
    const characterUuids = new Set();

    for (const chat of chats) {
      const d = chat?.content?.data;
      if (!d) continue;

      const answerLangs = [d.fixed_by_user && d.fixed_lang, d.lang_llm_out, d.user_lang, d.lang_llm_in, 'ko'];
      const queryLangs = [d.lang_llm_in, d.user_lang, d.lang_llm_out, 'ko'];
      const speakerObj = d.structured_answer?.find((s) => s?.speaker?.type === 'char')?.speaker;
      const speaker = speakerObj?.name;
      if (speaker && !speakerName) speakerName = speaker;
      if (speakerObj?.character_uuid) characterUuids.add(speakerObj.character_uuid);

      const query = pickLang(d.query, queryLangs);
      if (!d.greeting && query.trim() && query.trim() !== '...') {
        messages.push({ role: 'user', text: query });
      }

      const answer = pickLang(d.answer, answerLangs);
      if (answer.trim()) {
        messages.push({ role: 'char', name: speaker || undefined, text: answer, greeting: !!d.greeting });
      }
    }
    return { messages, speakerName, characterUuids: [...characterUuids] };
  }

  // 내 페르소나 이름 (대화방마다 다를 수 있음)
  async function fetchUserName(sessionUuid) {
    try {
      const info = await util.fetchJson(`${API}chat/chat-session/asker-info/${sessionUuid}`);
      return (info?.asker_name || '').trim();
    } catch {
      return '';
    }
  }

  // 캐릭터 정보 API: GET /api/character/{캐릭터UUID} → { name, details: { char_name } }
  async function fetchCharacterName(uuids) {
    for (const uuid of uuids) {
      try {
        const ch = await util.fetchJson(`${API}character/${uuid}?locale=ko`);
        const name = (ch?.details?.char_name || ch?.name || '').trim();
        if (name) return name;
      } catch {
        // 캐릭터 UUID가 아니면 다음 후보
      }
    }
    return '';
  }

  window.registerChatAdapter({
    id: 'caveduck',
    name: '케이브덕',
    match: (loc) => /(^|\.)caveduck\.io$/.test(loc.hostname),

    async extract({ onProgress }) {
      onProgress('대화방 확인 중...');
      const { uuid, first, otherUuids } = await resolveSession();
      const chats = await fetchAllChats(uuid, first, onProgress);
      const { messages, speakerName, characterUuids } = toMessages(chats);
      const userName = await fetchUserName(uuid);

      // 캐릭터 이름 우선순위: 대화 속 화자 이름 → 캐릭터 정보 API → 장면 상태의 주요 인물
      // (대화방 제목은 유저가 바꿀 수 있으므로 쓰지 않는다)
      const charName =
        speakerName ||
        (await fetchCharacterName([...characterUuids, ...otherUuids])) ||
        mainEnvCharacter(chats, userName);
      return {
        title: charName ? `${charName} 대화 기록` : '케이브덕 대화 기록',
        characterName: charName,
        userName,
        messages,
      };
    },
  });
})();
