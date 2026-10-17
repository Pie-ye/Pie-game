const PROD_API_ORIGIN = 'https://coinpilet.win';
const PROD_CONTENT_ORIGIN = 'https://play.piea.uk';

// 本機或私有網段（含 Tailscale 的 100.64.0.0/10）才允許用網址參數覆寫 API／內容來源；正式網域不受影響。
function isLocalHost() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const m = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
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
