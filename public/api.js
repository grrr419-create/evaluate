/* Opaque sessions stay in this tab; a random browser token limits repeat participation. */
export function createApi(environment = globalThis) {
  let endpoint = '',
    session = '',
    storageKey = '',
    ready = false;
  const failure = (message, status = 503) => Object.assign(new Error(message), { status });
  async function init(role) {
    const response = await environment.fetch('./config.json', { cache: 'no-store' });
    if (!response.ok) throw failure('연결 설정을 불러오지 못했습니다.');
    const config = await response.json();
    const localPreview =
      typeof config.apiUrl === 'string' &&
      ['127.0.0.1', 'localhost'].includes(environment.location.hostname) &&
      config.apiUrl === environment.location.origin + '/api-gateway';
    if (
      !localPreview &&
      (typeof config.apiUrl !== 'string' ||
        !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/evaluate$/.test(config.apiUrl))
    )
      throw failure('평가 서버 연결을 준비 중입니다.');
    endpoint = config.apiUrl;
    storageKey = 'evaluate-session:' + endpoint + ':' + role;
    try {
      session = environment.sessionStorage.getItem(storageKey) || '';
    } catch {
      session = '';
    }
    ready = true;
  }
  async function request(route, body = {}) {
    if (!ready) throw failure('평가 서버 연결을 준비 중입니다.');
    if (route === '/api/evaluate/login') {
      let device;
      try {
        const key = 'evaluate-browser:' + endpoint;
        device = environment.localStorage.getItem(key);
        if (!/^[0-9a-f]{64}$/.test(device || '')) {
          device = Array.from(environment.crypto.getRandomValues(new Uint8Array(32)), (n) =>
            n.toString(16).padStart(2, '0'),
          ).join('');
          environment.localStorage.setItem(key, device);
        }
        if (environment.localStorage.getItem(key) !== device) throw new Error('Storage unavailable');
      } catch {
        throw failure('중복 참여 확인을 위해 브라우저의 사이트 데이터 저장을 허용해 주세요.', 400);
      }
      body = { device };
    }
    if (!route.endsWith('/login') && !session) throw failure('로그인이 필요합니다.', 401);
    let response;
    try {
      response = await environment.fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route, body, session }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw failure('서버에 연결하지 못했습니다. 인터넷 연결을 확인한 후 다시 시도해 주세요.');
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw failure('서버 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (!response.ok) {
      if (response.status === 401 && !route.endsWith('/login')) {
        session = '';
        try {
          environment.sessionStorage.removeItem(storageKey);
        } catch {}
      }
      throw failure(data.error || '처리에 실패했습니다.', response.status);
    }
    if (route.endsWith('/login')) {
      session = data.session;
      try {
        environment.sessionStorage.setItem(storageKey, session);
      } catch {}
      delete data.session;
    }
    if (route.endsWith('/logout')) {
      session = '';
      try {
        environment.sessionStorage.removeItem(storageKey);
      } catch {}
    }
    return data;
  }
  return { init, request };
}
