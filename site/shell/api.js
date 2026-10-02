import { API_ORIGIN, USE_MOCK } from './config.js';
import { mockRequest } from './dev-mock.js';

let csrfToken = null;
let session = null; // { user, balance, playMoney }
let unauthorizedHandler = null;

export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

export function getCsrfToken() {
  return csrfToken;
}

export function getSession() {
  return session;
}

export function getUser() {
  return session && session.user ? session.user : null;
}

export function getBalance() {
  return session ? Number(session.balance) || 0 : 0;
}

export function setBalance(n) {
  if (!session) session = { user: null, balance: 0 };
  session.balance = Number(n) || 0;
}

export function applyAuthPayload(payload) {
  if (!payload) return;
  if (payload.csrfToken) csrfToken = payload.csrfToken;
  const user = payload.user || null;
  const balance = payload.balance != null ? Number(payload.balance) : (session ? session.balance : 0);
  const playMoney = payload.playMoney != null ? Boolean(payload.playMoney) : Boolean(session && session.playMoney);
  session = user ? { user, balance, playMoney } : null;
  if (!user) csrfToken = payload.csrfToken || csrfToken;
}

export function clearAuth() {
  session = null;
  csrfToken = null;
}

export function casinoRoundId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function notifyUnauthorized() {
  clearAuth();
  if (typeof unauthorizedHandler === 'function') unauthorizedHandler();
}

// 跨站 API 最久等多久：網路卡住時要能回報錯誤，不能讓畫面永遠停在「載入中」。
const REQUEST_TIMEOUT_MS = 15000;
// GET 遇到網路錯誤（不是 HTTP 錯誤）重試一次：手機換網路、tunnel 重連時常見的瞬斷。
const GET_RETRY_DELAY_MS = 300;
// 預取的結果只給接下來這一次同路徑的 GET 用，放太久就作廢。
const PREFETCH_TTL_MS = 10000;

const prefetched = new Map();

function failure(aborted, timedOut = false) {
  let error = '連線失敗，請檢查網路後重試';
  if (aborted) error = '請求已取消';
  else if (timedOut) error = '連線逾時，請稍後重試';
  return {
    response: { ok: false, status: 0, aborted },
    payload: { error },
  };
}

function delay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** 真正打 fetch：處理逾時、網路錯誤重試，回傳 { response, payload }，不做任何登入狀態副作用。 */
async function send(path, { method, headers, body, signal }) {
  const attempts = method === 'GET' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal && signal.aborted) return failure(true);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', forwardAbort, { once: true });
    let response;
    try {
      response = await fetch(`${API_ORIGIN}${path}`, {
        method,
        headers,
        credentials: 'include',
        body: method === 'GET' ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch (_) {
        payload = {};
      }
      return { response, payload };
    } catch (_) {
      if (signal && signal.aborted) return failure(true);
      if (timedOut || attempt + 1 >= attempts) return failure(false, timedOut);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', forwardAbort);
    }
    await delay(GET_RETRY_DELAY_MS, signal);
  }
  return failure(false);
}

/**
 * 先發出一個之後一定會打的 GET（例如官方遊戲掛載後第一個設定請求），
 * 讓它跟模組下載同時跑。接下來第一次同路徑的 api() GET 會直接拿這個結果。
 */
export function prefetch(path) {
  if (USE_MOCK) return;
  const existing = prefetched.get(path);
  if (existing && Date.now() - existing.at < PREFETCH_TTL_MS) return;
  prefetched.set(path, {
    at: Date.now(),
    promise: send(path, { method: 'GET', headers: {}, body: undefined, signal: undefined }),
  });
}

function takePrefetched(path) {
  const entry = prefetched.get(path);
  if (!entry) return null;
  prefetched.delete(path);
  if (Date.now() - entry.at >= PREFETCH_TTL_MS) return null;
  return entry.promise;
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(failure(true));
  return new Promise((resolve) => {
    const onAbort = () => resolve(failure(true));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((result) => {
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    });
  });
}

export async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  let body = opts.body;
  const silent401 = Boolean(opts.silent401);
  const skipAuthClear = Boolean(opts.skipAuthClear);
  if (method !== 'GET' && body == null) body = {};

  if (USE_MOCK) {
    let result;
    try {
      result = await mockRequest(path, { method, body, signal: opts.signal });
    } catch (err) {
      return failure(Boolean(err && err.name === 'AbortError'));
    }
    if (result.response.status === 401 && !skipAuthClear) {
      if (!silent401) notifyUnauthorized();
      else clearAuth();
    }
    return result;
  }

  const headers = Object.assign({}, opts.headers || {});
  if (method !== 'GET' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const early = method === 'GET' && !opts.headers ? takePrefetched(path) : null;
  const result = early
    ? await waitWithSignal(early, opts.signal)
    : await send(path, { method, headers, body, signal: opts.signal });
  const { response, payload } = result;
  if (!response.ok && response.status === 0) return result;

  if (payload && payload.csrfToken) csrfToken = payload.csrfToken;

  if (response.status === 401 && !skipAuthClear) {
    if (!silent401) notifyUnauthorized();
    else clearAuth();
  }

  return { response, payload };
}

// skipAuthClear 只留給三種請求：登入（401＝帳密錯誤，錯誤訊息在表單內顯示）、
// 登出（本函式自己清本地狀態）、大廳的 GET /api/casino/community（未登入也要能逛）。
// 其他需要登入的請求遇 401 一律清本地狀態並叫出登入框。
export async function login(username, password) {
  const { response, payload } = await api('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    skipAuthClear: true,
  });
  if (response.ok) {
    applyAuthPayload(payload);
    const sess = await fetchSession();
    if (!sess && payload.user) {
      applyAuthPayload({ user: payload.user, csrfToken: payload.csrfToken, balance: 0 });
    }
  }
  return { response, payload };
}

export async function logout() {
  const { response, payload } = await api('/api/auth/logout', {
    method: 'POST',
    body: {},
    skipAuthClear: true,
  });
  // 不論伺服器怎麼回（200／401／403／500／斷線）本機一律登出。
  clearAuth();
  return { response, payload };
}

export async function fetchSession() {
  // session 探測本身就是用來判斷有沒有登入的，401 只代表訪客：清狀態但不叫登入框。
  const { response, payload } = await api('/api/casino/session', { silent401: true });
  if (response.ok && payload) {
    applyAuthPayload(payload);
    return session;
  }
  if (response.status === 401) clearAuth();
  return null;
}

export async function fetchHistory(game, { limit = 20, gameId } = {}) {
  const params = new URLSearchParams();
  params.set('game', game);
  params.set('limit', String(limit));
  if (gameId) params.set('gameId', gameId);
  return api(`/api/casino/history?${params.toString()}`);
}

export async function fetchCommunity() {
  // 大廳清單：訪客也會打，401 不清狀態也不導向。
  return api('/api/casino/community', { silent401: true, skipAuthClear: true });
}

export async function playCommunity(id, { choice, bet, clientRoundId, signal } = {}) {
  return api(`/api/casino/community/${encodeURIComponent(id)}/play`, {
    method: 'POST',
    body: { choice, bet, clientRoundId },
    signal,
  });
}

export async function playTicket(gameId, opts = {}) {
  return api('/api/casino/play-ticket', {
    method: 'POST',
    body: { gameId },
    signal: opts.signal,
  });
}
