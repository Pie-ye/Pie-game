const PROD_API_ORIGIN = 'https://coinpilet.win';
const PROD_CONTENT_ORIGIN = 'https://play.piea.uk';

function isLocalHost() {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function stripSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readOverride(param, storageKey, fallback) {
  if (!isLocalHost()) return fallback;
  const params = new URLSearchParams(location.search);
  if (params.has(param)) {
    const value = stripSlash(params.get(param) || '');
    try {
      sessionStorage.setItem(storageKey, value);
    } catch (_) {
      /* sessionStorage 可能被關掉 */
    }
    return value || fallback;
  }
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) return stripSlash(stored);
  } catch (_) {
    /* ignore */
  }
  return fallback;
}

export const LOCAL_HOST = isLocalHost();
export const API_ORIGIN = readOverride('api', 'pg_api', PROD_API_ORIGIN);
export const CONTENT_ORIGIN = readOverride('content', 'pg_content', PROD_CONTENT_ORIGIN);
export const USE_MOCK = LOCAL_HOST && new URLSearchParams(location.search).get('mock') === '1';
export const REGISTER_URL = `${API_ORIGIN}/`;
