// 個人存檔（農場、小屋）：SDK 沒有雲端存檔，先放在瀏覽器 localStorage，依帳號區分。
import { newFarm, sanitizeFarm } from './farm/state.js';
import { defaultDecor, sanitizeDecor } from './house/catalog.js';

const k = (owner, what) => `pie-plaza:${what}:${owner}`;
function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_e) { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_e) { /* 空間不足或無痕模式：這次不存 */ } }

export function loadFarm(owner) { const s = read(k(owner, 'farm')); return s ? sanitizeFarm(s, owner) : newFarm(owner); }
export function saveFarm(owner, s) { write(k(owner, 'farm'), s); }
export function loadDecor(owner) { return sanitizeDecor(read(k(owner, 'decor'))); }
export const decorData = (d) => ({ v: 1, at: d.at || 0, floor: d.floor, wall: d.wall, style: d.style, ext: d.ext, items: d.items.map(({ k: kk, tx, ty }) => ({ k: kk, tx, ty })) });
export function saveDecor(owner, d) { write(k(owner, 'decor'), decorData(d)); }

/** 外觀存成 { l, at }；舊版只存陣列，讀到時當成時間 0。 */
export function loadLookEntry(owner) {
  const v = read(k(owner, 'look'));
  if (Array.isArray(v)) return { l: v, at: 0 };
  return v && Array.isArray(v.l) ? { l: v.l, at: Number(v.at) || 0 } : null;
}
export function loadLook(owner) { const e = loadLookEntry(owner); return e ? e.l : null; }
export function saveLook(owner, l, at = Date.now()) { write(k(owner, 'look'), { l, at }); }
