// 티팟 (teapotchat.com)
// 대화는 Firebase Firestore 에 있다 (사이트는 실시간 연결로 받아서 Network 탭 검색에 안 잡힌다).
//   대화방: users/{uid}/chats/{chatId}  → oc_name(캐릭터), start_setting.start_message(첫 인사말)
//   메시지: users/{uid}/chats/{chatId}/messages  (is_deleted == false, time_created 순)
//     user_chat(유저) + llm_response[response_idx].response(캐릭터, 문자열 또는 문자열 배열)
// 로그인 토큰은 사이트가 IndexedDB(firebaseLocalStorageDb)에 저장해 둔 것을 읽어서
// Firestore REST API 에만 보낸다.
(() => {
  const PROJECT = 'chat-ai-7a275';
  const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const PAGE_SIZE = 200; // 사이트가 전체 메시지를 받을 때 쓰는 값과 같게
  const PAGE_DELAY_MS = 300;
  const MAX_PAGES = 1000;
  const util = window.chatExtractorUtil;

  function chatIdFromUrl() {
    const m = location.pathname.match(/\/chat\/([A-Za-z0-9_-]+)/);
    if (!m || m[1] === 'new') throw new Error('대화방을 찾지 못했습니다. 티팟 대화방 화면에서 실행해 주세요.');
    return m[1];
  }

  // 사이트(Firebase Auth)가 저장해 둔 로그인 정보
  async function loadAuth() {
    const rows = await new Promise((resolve) => {
      const req = indexedDB.open('firebaseLocalStorageDb');
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const all = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
          all.onsuccess = () => resolve(all.result || []);
          all.onerror = () => resolve([]);
        } catch {
          resolve([]);
        } finally {
          db.close();
        }
      };
    });
    const user = rows.map((r) => r?.value).find((v) => v?.uid && v?.stsTokenManager?.accessToken);
    if (!user) throw new Error('로그인 정보를 찾지 못했습니다. 티팟에 로그인해 주세요.');
    // 토큰은 1시간짜리라 오래 열어둔 탭이면 만료됐을 수 있다 (새로고침하면 사이트가 갱신한다)
    if (user.stsTokenManager.expirationTime && user.stsTokenManager.expirationTime < Date.now() + 60_000) {
      throw new Error('로그인이 만료됐습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
    }
    return { uid: user.uid, token: user.stsTokenManager.accessToken };
  }

  // Firestore REST 값 → 일반 JS 값
  function decode(v) {
    if (!v || typeof v !== 'object') return v;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('nullValue' in v) return null;
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
    if ('mapValue' in v) return decodeFields(v.mapValue.fields);
    return undefined;
  }
  const decodeFields = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([k, x]) => [k, decode(x)]));

  async function firestore(url, auth, body) {
    try {
      return await util.fetchJson(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${auth.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit',
      });
    } catch (e) {
      if (e.status === 401 || e.status === 403) {
        throw new Error('대화 기록을 불러오지 못했습니다. 페이지를 새로고침하거나 로그인 상태를 확인해 주세요.');
      }
      throw e;
    }
  }

  async function fetchAllMessages(auth, chatPath, onProgress) {
    const all = [];
    let cursor = null;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const query = {
        from: [{ collectionId: 'messages' }],
        // 사이트와 같은 조건이어야 보안 규칙을 통과한다
        where: { fieldFilter: { field: { fieldPath: 'is_deleted' }, op: 'EQUAL', value: { booleanValue: false } } },
        orderBy: [
          { field: { fieldPath: 'time_created' }, direction: 'ASCENDING' },
          { field: { fieldPath: '__name__' }, direction: 'ASCENDING' },
        ],
        limit: PAGE_SIZE,
      };
      if (cursor) query.startAt = { values: cursor, before: false };
      const rows = await firestore(`${DOCS}/${chatPath}:runQuery`, auth, { structuredQuery: query });
      const docs = rows.map((r) => r.document).filter(Boolean);
      all.push(...docs);
      onProgress(`불러오는 중... ${all.length}턴`);
      if (docs.length < PAGE_SIZE) break;
      const last = docs[docs.length - 1];
      cursor = [last.fields.time_created, { referenceValue: last.name }];
      await util.sleep(PAGE_DELAY_MS);
    }
    return all.map((d) => decodeFields(d.fields));
  }

  // 화면에 선택된 답변 (재생성한 답변이 여러 개면 response_idx 번째)
  function responseText(msg) {
    const list = Array.isArray(msg.llm_response) ? msg.llm_response : [];
    const picked = list[msg.response_idx ?? 0] || list[0];
    const r = picked?.response;
    return util.stripImageTags(Array.isArray(r) ? r.join('') : r);
  }

  window.registerChatAdapter({
    id: 'teapot',
    name: '티팟',
    match: (loc) => /(^|\.)teapotchat\.com$/.test(loc.hostname),

    async extract({ onProgress }) {
      onProgress('대화방 확인 중...');
      const chatId = chatIdFromUrl();
      const auth = await loadAuth();
      const chatPath = `users/${auth.uid}/chats/${chatId}`;
      const chat = decodeFields((await firestore(`${DOCS}/${chatPath}`, auth)).fields);
      const charName = (chat.oc_name || chat.chat_name || '').trim();

      const rows = await fetchAllMessages(auth, chatPath, onProgress);

      const messages = [];
      const greeting = util.stripImageTags(chat.start_setting?.start_message);
      if (greeting) messages.push({ role: 'char', text: greeting, greeting: true });
      for (const msg of rows) {
        const q = util.stripImageTags(msg.user_chat);
        if (q) messages.push({ role: 'user', text: q });
        const a = responseText(msg);
        if (a) messages.push({ role: 'char', text: a });
      }

      return {
        title: charName ? `${charName} 대화 기록` : '티팟 대화 기록',
        characterName: charName,
        userName: '',
        messages,
      };
    },
  });
})();
