// 사이트별 어댑터 등록소.
// 어댑터 형식:
// {
//   id, name,
//   match(location) -> boolean,
//   extract({ onProgress }) -> Promise<{
//     characterName, userName, title,
//     messages: [{ role: 'user' | 'char', name?, text }]
//   }>
// }
window.__chatExtractorAdapters = window.__chatExtractorAdapters || [];

window.registerChatAdapter = function (adapter) {
  window.__chatExtractorAdapters.push(adapter);
};

window.findChatAdapter = function (loc) {
  return window.__chatExtractorAdapters.find((a) => a.match(loc)) || null;
};

// 공통 유틸
window.chatExtractorUtil = {
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  // 429(요청 제한) 응답이면 잠시 기다렸다가 다시 시도
  async fetchJson(url, init = {}, retries = 4) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { credentials: 'include', ...init });
      if (res.status === 429 && attempt < retries) {
        const reset = Number(res.headers.get('Retry-After') || res.headers.get('Ratelimit-Reset'));
        await this.sleep((Number.isFinite(reset) && reset > 0 ? reset : 2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} (${url})`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }
  },
};
