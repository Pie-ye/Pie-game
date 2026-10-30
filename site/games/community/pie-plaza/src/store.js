// 個人存檔（農場、小屋）：SDK 沒有雲端存檔，先放在瀏覽器 localStorage，依帳號區分。
import { newFarm, sanitizeFarm } from './farm/state.js';
import { defaultDecor, sanitizeDecor } from './house/catalog.js';

const k = (owner, what) => `pie-plaza:${what}:${owner}`;
function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_e) { return null; } }
function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (_e) { /* 空間不足或無痕模式：這次不存 */ } }

export function loadFarm(owner) { const s = read(k(owner, 'farm')); return s ? sanitizeFarm(s, owner) : newFarm(owner); }
export function saveFarm(owner, s) { write(k(owner, 'farm'), s); }
export function loadDecor(owner) { return sanitizeDecor(read(k(owner, 'decor'))); }
export function saveDecor(owner, d) { write(k(owner, 'decor'), { v: 1, floor: d.floor, wall: d.wall, style: d.style, ext: d.ext, items: d.items.map(({ k: kk, tx, ty }) => ({ k: kk, tx, ty })) }); }

export function loadLook(owner) { const l = read(k(owner, 'look')); return Array.isArray(l) ? l : null; }
export function saveLook(owner, l) { write(k(owner, 'look'), l); }
