// 拜訪家園（純函式）：給別人看的家園快照、名冊名片、社交設定、信件檢查。
// 快照只放看得到的東西（田地、小屋、外觀）；金幣、背包、種子不公開。
import { packFarm, unpackFarm, debrisLeft, ITEM_NAMES, CROPS } from '../farm/state.js';
import { sanitizeDecor } from '../house/catalog.js';
import { sanitizeLook } from '../avatar/look.js';
import { cleanText } from '../logic.js';
import { fishName, FISH_PRICES } from '../fish/fishing.js';

export const NOTE_MAX = 80;
export const EMOTES = [27, 6, 18, 22, 23, 20, 13, 29, 17, 28];
export const EMOTE_NAMES = ['愛心', '開心', '微笑', '驚訝', '疑問', '無言', '難過', '閃亮', '生氣', '想睡'];

/** 家園快照（公開鍵 home）。 */
export function makeHome({ farm, decor, look, name }) {
  const p = packFarm(farm);
  return { v: 1, name: cleanText(name, 20), look, decor: decor && { floor: decor.floor, wall: decor.wall, style: decor.style, ext: decor.ext, items: decor.items.map(({ k, tx, ty }) => ({ k, tx, ty })), v: 1 }, field: { d: p.d, t: p.t, c: p.c }, at: Math.max(farm.at || 0, decor.at || 0) };
}
/** 別人的快照 → { farm, decor, look, name }；不合格回傳 null（雲端資料也不信任）。 */
export function readHome(home, owner) {
  if (!home || typeof home !== 'object' || home.v !== 1 || !home.field) return null;
  const farm = unpackFarm({ v: 'p1', ...home.field, inv: {}, gold: 0, seeds: {} }, owner);
  if (!farm) return null;
  return { farm, decor: sanitizeDecor(home.decor), look: sanitizeLook(home.look), name: cleanText(home.name, 20) || '鎮民' };
}

/** 名冊名片（公開鍵 card，要小於 4 KB）。 */
export function makeCard({ farm, decor, look, name, likes }) {
  return {
    v: 1, name: cleanText(name, 20), look, style: decor.style, roof: decor.ext.roof, wall: decor.ext.wall,
    crops: Object.keys(farm.crops).length, cleared: debrisLeft(farm), likes: likes | 0, at: Date.now(),
  };
}
export function readCard(c) {
  if (!c || typeof c !== 'object' || c.v !== 1) return null;
  const n = (v) => Math.max(0, Math.min(1e6, Number.isFinite(v) ? Math.floor(v) : 0));
  return { name: cleanText(c.name, 20) || '鎮民', look: sanitizeLook(c.look), style: typeof c.style === 'string' ? c.style : 'houseThatch', crops: n(c.crops), debris: n(c.cleared), likes: n(c.likes), at: n(c.at), title: cleanText(c.title, 8) || '', crowns: n(c.crowns), stamps: n(c.stamps) };
}

/** 社交設定（私人鍵 social）：家園是否開放、好友、今天按讚過誰、累積的讚。 */
export function defaultSocial() { return { v: 1, open: true, friends: [], liked: {}, likes: 0, at: 0 }; }
export function sanitizeSocial(s) {
  const d = defaultSocial();
  if (!s || typeof s !== 'object' || s.v !== 1) return d;
  d.open = s.open !== false;
  d.friends = (Array.isArray(s.friends) ? s.friends : []).filter((f) => f && typeof f.id === 'string' && f.id.length <= 64).slice(0, 100)
    .map((f) => ({ id: f.id, name: cleanText(f.name, 20) || '鎮民' }));
  for (const [k, v] of Object.entries(s.liked && typeof s.liked === 'object' ? s.liked : {})) if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) d.liked[k] = v;
  d.likes = Math.max(0, Math.min(1e6, s.likes | 0));
  d.at = Number(s.at) || 0;
  return d;
}
export const isFriend = (social, id) => social.friends.some((f) => f.id === id);
export function toggleFriend(social, id, name) {
  if (isFriend(social, id)) social.friends = social.friends.filter((f) => f.id !== id);
  else social.friends.push({ id, name: cleanText(name, 20) || '鎮民' });
  return isFriend(social, id);
}
/** 每個家園每天只能按讚一次（day：YYYY-MM-DD）。 */
export function canLike(social, owner, day) { return social.liked[owner] !== day; }

// ---------- 信件 ----------
const GIFTABLE = (k) => !!(CROPS[k] || FISH_PRICES[k]);
const GIFTABLE_ANY = (k) => GIFTABLE(k) || ['wood', 'stone', 'fiber'].includes(k);
export const marketable = (inv) => Object.entries(inv || {}).filter(([k, n]) => n > 0 && GIFTABLE_ANY(k));
export function giftable(inv) { return Object.entries(inv || {}).filter(([k, n]) => n > 0 && GIFTABLE(k)); }
export const itemName = (k) => (k.startsWith('fish_') ? fishName(k.slice(5)) : ITEM_NAMES[k] || k);
/** 收到的信：檢查格式並整理成畫面用的資料；不合格回傳 null。 */
export function readMail(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'number') return null;
  const from = { id: String(m.from || ''), name: cleanText(m.fromName, 20) || '鎮民' };
  const d = m.data && typeof m.data === 'object' ? m.data : {};
  if (m.kind === 'note') { const text = cleanText(d.text, NOTE_MAX); return text ? { id: m.id, kind: 'note', from, text, at: m.createdAt } : null; }
  if (m.kind === 'like' || m.kind === 'syslike') return { id: m.id, kind: 'like', from, at: m.createdAt, sys: m.kind === 'syslike' };
  if (m.kind === 'syscoop') return { id: m.id, kind: 'coop', from, on: !!d.on, at: m.createdAt, sys: true };
  if (m.kind === 'syssold') {
    const n = d.n | 0, price = d.price | 0;
    return GIFTABLE_ANY(d.item) && n >= 1 && price >= 1 ? { id: m.id, kind: 'sold', from, item: d.item, n, price, at: m.createdAt, sys: true } : null;
  }
  if (m.kind === 'sysdiv') {
    const gold = d.gold | 0;
    return gold >= 1 ? { id: m.id, kind: 'div', from, gold, at: m.createdAt, sys: true } : null;
  }
  if (m.kind === 'sysrank') {
    const title = cleanText(d.title, 20), rank = d.rank | 0, gold = Math.max(0, d.gold | 0);
    return title && rank >= 1 && rank <= 3 ? { id: m.id, kind: 'rank', from, title, rank, gold, week: cleanText(d.week, 10), at: m.createdAt, sys: true } : null;
  }
  if (m.kind === 'sysbuild') {
    const gold = Math.max(0, d.gold | 0), name = cleanText(d.name, 20);
    return name ? { id: m.id, kind: 'build', from, name, gold, points: Math.max(0, d.points | 0), at: m.createdAt, sys: true } : null;
  }
  if (m.kind === 'sysgift' || m.kind === 'gift') {
    const n = d.n | 0;
    if (m.kind === 'gift') return null;                      // 舊版玩家互寄的禮物不再有效：禮物只能由伺服器發
    return GIFTABLE(d.item) && n >= 1 && n <= 99 ? { id: m.id, kind: 'gift', from, item: d.item, n, at: m.createdAt, sys: true } : null;
  }
  return null;
}
/** 送禮：從自己的背包扣掉。回傳是否成功。 */
export function takeGift(inv, k, n = 1) {
  if (!GIFTABLE(k) || !(inv[k] >= n)) return false;
  inv[k] -= n; if (!inv[k]) delete inv[k];
  return true;
}
export const today = (ms = Date.now()) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
