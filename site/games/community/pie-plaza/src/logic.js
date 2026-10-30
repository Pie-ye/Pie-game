// 純函式：移動、朝向、聊天訊息檢查、外觀顏色。不碰 DOM，node 可直接測試。
// 座標一律是「原生像素」（1 格 = 16 px），畫面再整數倍放大。
export const TILE = 16;
export const SCALE = 2;
export const VIEW = { w: 30, h: 18 };                 // 鏡頭範圍（格）
export const CHAT_MAX = 120;
export const CHAT_GAP_MS = 800;
export const LOG_MAX = 80;
export const SPEED = 64;
export const HEAR_DIST = 220;
export const DIRS = { down: 0, up: 1, left: 2, right: 3 };
export const DIR_VEC = [[0, 1], [0, -1], [-1, 0], [1, 0]];

/** 走到 (nx,ny)；被擋住時沿單一軸滑行。blocked(x,y) 由地圖提供。 */
function slide(p, nx, ny, blocked) {
  if (!blocked(nx, ny)) return { x: nx, y: ny };
  if (!blocked(nx, p.y)) return { x: nx, y: p.y };
  if (!blocked(p.x, ny)) return { x: p.x, y: ny };
  return { x: p.x, y: p.y };
}

/** 依方向向量（可為斜向）與 dt 移動；斜向速度不會變快，撞到東西會滑行。 */
export function stepMove(p, dx, dy, dt, blocked) {
  const len = Math.hypot(dx, dy);
  if (!len) return { x: p.x, y: p.y };
  const d = SPEED * dt / len;
  return slide(p, p.x + dx * d, p.y + dy * d, blocked);
}

/** 往目標點走（點擊移動）；到了或被擋住不動時回傳 arrived。 */
export function stepToward(p, tx, ty, dt, blocked) {
  const dx = tx - p.x, dy = ty - p.y, dist = Math.hypot(dx, dy);
  const move = SPEED * dt;
  if (dist <= move) return blocked(tx, ty) ? { x: p.x, y: p.y, arrived: true } : { x: tx, y: ty, arrived: true };
  const n = slide(p, p.x + dx / dist * move, p.y + dy / dist * move, blocked);
  return { ...n, arrived: Math.hypot(n.x - p.x, n.y - p.y) < move * 0.2 };
}

/** 朝向：回傳 DIRS 的索引。水平分量較大時用左右，否則用上下。 */
export function dirOf(dx, dy, fallback = 0) {
  if (!dx && !dy) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? DIRS.left : DIRS.right;
  return dy < 0 ? DIRS.up : DIRS.down;
}

/** 腳底所在格與面向的那一格。 */
export function tileOf(x, y) { return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) }; }
export function facingTile(p) {
  const { tx, ty } = tileOf(p.x, p.y - 2);
  const [dx, dy] = DIR_VEC[p.dir || 0];
  return { tx: tx + dx, ty: ty + dy };
}

/** 鏡頭左上角：跟著玩家，但不超出地圖；地圖比鏡頭小時置中（可為負值）。 */
export function cameraFor(px, py, mapW, mapH, viewW = VIEW.w * TILE, viewH = VIEW.h * TILE) {
  const axis = (p, m, v) => (m <= v ? -Math.floor((v - m) / 2) : Math.round(Math.min(m - v, Math.max(0, p - v / 2))));
  return { x: axis(px, mapW, viewW), y: axis(py, mapH, viewH) };
}

// ---------- 聊天 ----------
/** 去掉控制字元與零寬／雙向控制字元、合併空白、截到上限（以字元計，不切壞代理對）。 */
export function cleanText(s, max = CHAT_MAX) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, max).join('');
}

/** 收到的網路訊息 → 乾淨的聊天文字，不合格回傳 null。 */
export function parseChat(d) {
  if (!d || typeof d !== 'object' || d.k !== 'c') return null;
  const t = cleanText(d.t);
  return t ? t : null;
}

/** 送出節流：回傳 { ok, wait }。 */
export function canSend(now, last) {
  const wait = last + CHAT_GAP_MS - now;
  return wait > 0 ? { ok: false, wait } : { ok: true, wait: 0 };
}

/** 由玩家 id 穩定算出衣服色相。 */
export function hueOf(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 360;
}

const AREA_RE = /^[a-z]{2,8}(:[A-Za-z0-9_-]{1,40})?$/;
/** 位置訊息 → { x, y, area } 或 null。area 例如 'plaza'、'town'、'farm:123'、'shop:bakery'。 */
export function parsePos(d) {
  if (!d || d.k !== 'p' || !Array.isArray(d.p) || d.p.length < 2) return null;
  const [x, y] = d.p;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e4 || Math.abs(y) > 1e4) return null;
  const area = typeof d.a === 'string' && AREA_RE.test(d.a) ? d.a : 'plaza';
  return { x, y, area };
}

/** 決定性的亂數產生器（地圖擺設、雜草石頭用）。 */
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function seedOf(str) { return hueOf(str) * 7919 + String(str).length; }
