// 農場狀態（純函式）：雜物（雜草、石頭、樹枝、樹樁）、耕地、作物、背包。
// 存檔是普通物件，鍵是 "x,y"。不碰 DOM，node 可直接測試。
import { mulberry, seedOf } from '../logic.js';

export const FARM = { w: 40, h: 30, field: { x0: 3, y0: 11, x1: 36, y1: 27 }, house: { tx: 20, ty: 9 } };
export const PATH_X = [19, 20];                    // 小屋門口往下的小路
export const PATH_Y = [15, 16];                    // 往東出口的小路

export const DEBRIS = {
  weed: { tool: 'sickle', hp: 1, drop: 'fiber', looks: ['weedA', 'weedB', 'weedC', 'weedD', 'weedE'] },
  stone: { tool: 'pickaxe', hp: 2, drop: 'stone', looks: ['rockBig', 'rockSmall', 'grayRockS'] },
  twig: { tool: 'axe', hp: 1, drop: 'wood', looks: ['log'] },
  stump: { tool: 'axe', hp: 4, drop: 'wood', looks: ['stump', 'brownRockS'] },
};
// seed：種子價格；sell：成品售價；grow：每階所需時間倍數（越大越慢）
const crop = (name, seed, sell, grow) => ({ name, seed, sell, grow });
export const CROPS = {
  wheat: crop('小麥', 10, 25, 1), carrot: crop('紅蘿蔔', 15, 40, 1), beet: crop('甜菜', 20, 55, 1.3),
  tomato: crop('番茄', 30, 80, 1.6), strawberry: crop('草莓', 40, 110, 1.9), pumpkin: crop('南瓜', 60, 190, 2.6),
};
for (const [k, c] of Object.entries(CROPS)) { c.stages = [0, 1, 2, 3].map((i) => `${k}${i}`); c.item = k; }
export const CROP_KEYS = Object.keys(CROPS);
export const GROW_MS = 45_000;                      // 澆過水後多久長一階（乘上作物倍數）
export const TOOLS = ['axe', 'pickaxe', 'sickle', 'hoe', 'wateringcan', 'rod', 'seed', 'hammer'];
export const TOOL_NAMES = { axe: '斧頭', pickaxe: '十字鎬', sickle: '鐮刀', hoe: '鋤頭', wateringcan: '澆水壺', rod: '釣竿', seed: '種子', hammer: '裝潢' };
export const ITEM_NAMES = { wood: '木材', stone: '石頭', fiber: '纖維', ...Object.fromEntries(Object.entries(CROPS).map(([k, c]) => [k, c.name])) };
export const STARTER_SEEDS = { wheat: 15, carrot: 5 };

const key = (x, y) => `${x},${y}`;
export const isPath = (x, y) => (PATH_X.includes(x) && y >= FARM.house.ty && y <= PATH_Y[1]) || (PATH_Y.includes(y) && x >= PATH_X[0]);
const inField = (x, y) => x >= FARM.field.x0 && x <= FARM.field.x1 && y >= FARM.field.y0 && y <= FARM.field.y1;
export const POND = { x0: 4, y0: 21, x1: 9, y1: 26 };
export const inPond = (x, y) => x >= POND.x0 && x <= POND.x1 && y >= POND.y0 && y <= POND.y1;

/** 新農場：依擁有者 id 決定雜物分布，同一個人每次都一樣。 */
export function newFarm(owner) {
  const rnd = mulberry(seedOf(`farm:${owner}`));
  const debris = {};
  for (let y = FARM.field.y0; y <= FARM.field.y1; y++) for (let x = FARM.field.x0; x <= FARM.field.x1; x++) {
    if (isPath(x, y) || inPond(x, y) || (Math.abs(x - 20) <= 3 && y <= 13)) continue;   // 門口留一小塊空地
    const r = rnd();
    if (r > 0.42) continue;
    const t = r < 0.22 ? 'weed' : r < 0.32 ? 'stone' : r < 0.38 ? 'twig' : 'stump';
    const d = DEBRIS[t];
    debris[key(x, y)] = { t, hp: d.hp, look: Math.floor(rnd() * d.looks.length) };
  }
  return { v: 2, debris, tilled: {}, crops: {}, inv: {}, seeds: { ...STARTER_SEEDS }, seedSel: 'wheat', gold: 100 };
}

const cap = (n) => Math.max(0, Math.min(999999, Math.floor(Number(n) || 0)));
/** 讀檔時把壞資料清掉（localStorage 可能被手改）；v1 舊檔會升級並送起始種子。 */
export function sanitizeFarm(s, owner) {
  if (!s || typeof s !== 'object' || (s.v !== 1 && s.v !== 2)) return newFarm(owner);
  const out = newFarm(owner);
  const okKey = (k) => /^\d{1,2},\d{1,2}$/.test(k);
  out.debris = {};
  for (const [k, d] of Object.entries(s.debris || {})) if (okKey(k) && d && DEBRIS[d.t]) out.debris[k] = { t: d.t, hp: Math.max(1, Math.min(DEBRIS[d.t].hp, d.hp | 0)), look: (d.look | 0) % DEBRIS[d.t].looks.length };
  for (const [k, t] of Object.entries(s.tilled || {})) if (okKey(k) && t) out.tilled[k] = { w: Number(t.w) || 0 };
  for (const [k, c] of Object.entries(s.crops || {})) if (okKey(k) && c && CROPS[c.t] && out.tilled[k]) out.crops[k] = { t: c.t, s: Math.max(0, Math.min(3, c.s | 0)), w: Number(c.w) || 0 };
  for (const [k, n] of Object.entries(s.inv || {})) if (ITEM_NAMES[k] || /^fish_|^junk_/.test(k)) { const v = cap(n); if (v) out.inv[k] = v; }
  if (s.v === 2) {
    out.seeds = {};
    for (const k of CROP_KEYS) { const v = cap(s.seeds && s.seeds[k]); if (v) out.seeds[k] = v; }
    out.gold = cap(s.gold);
    out.seedSel = CROPS[s.seedSel] ? s.seedSel : 'wheat';
  }
  out.at = Number(s.at) || 0;
  return out;
}

/** 種子選擇：Q 切換到下一種有庫存的種子。 */
export function nextSeed(state) {
  const have = CROP_KEYS.filter((k) => state.seeds[k] > 0);
  if (!have.length) return state.seedSel;
  const i = have.indexOf(state.seedSel);
  state.seedSel = have[(i + 1) % have.length];
  return state.seedSel;
}
export function buySeed(state, k, n = 1) {
  const c = CROPS[k];
  if (!c || n < 1) return { ok: false, msg: '' };
  if (state.gold < c.seed * n) return { ok: false, msg: '金幣不夠' };
  state.gold -= c.seed * n;
  state.seeds[k] = (state.seeds[k] || 0) + n;
  if (!state.seeds[state.seedSel]) state.seedSel = k;
  return { ok: true, msg: `買了 ${n} 包${c.name}種子` };
}
/** 出貨：把作物與魚全部賣掉；prices 是 { 物品: 單價 }。 */
export function shipAll(state, prices) {
  let total = 0; const sold = [];
  for (const [k, n] of Object.entries(state.inv)) {
    const p = prices[k];
    if (!p || !n) continue;
    total += p * n; sold.push([k, n]); delete state.inv[k];
  }
  state.gold += total;
  return { total, sold };
}
export const CROP_PRICES = Object.fromEntries(Object.entries(CROPS).map(([k, c]) => [k, c.sell]));

/**
 * 在 (x,y) 用工具。回傳 { ok, msg, changed }；會直接修改 state。
 * now 用來記錄澆水時間；作物長大由 grow() 處理。
 */
export function useTool(state, tool, x, y, now) {
  const k = key(x, y);
  if (!inField(x, y)) return { ok: false, msg: '這裡不能耕作' };
  if (isPath(x, y)) return { ok: false, msg: '這是小路，留著走路吧' };
  const d = state.debris[k];
  if (d) {
    const info = DEBRIS[d.t];
    if (tool !== info.tool) return { ok: false, msg: `要用${TOOL_NAMES[info.tool]}才行` };
    d.hp -= 1;
    if (d.hp > 0) return { ok: true, msg: '再敲幾下…', changed: true, hit: d.t };
    delete state.debris[k];
    state.inv[info.drop] = (state.inv[info.drop] || 0) + (d.t === 'stump' ? 3 : 1);
    return { ok: true, msg: `得到 ${ITEM_NAMES[info.drop]}`, changed: true, cleared: d.t };
  }
  const crop = state.crops[k];
  if (tool === 'sickle' && crop) {
    if (crop.s < 3) return { ok: false, msg: '還沒成熟' };
    delete state.crops[k];
    const item = CROPS[crop.t].item;
    state.inv[item] = (state.inv[item] || 0) + 1;
    return { ok: true, msg: `收成 ${CROPS[crop.t].name}！`, changed: true, harvest: crop.t };
  }
  if (tool === 'hoe') {
    if (state.tilled[k]) return { ok: false, msg: '已經翻過土了' };
    state.tilled[k] = { w: 0 };
    return { ok: true, msg: '', changed: true, till: true };
  }
  if (tool === 'wateringcan') {
    if (!state.tilled[k]) return { ok: false, msg: '先用鋤頭翻土' };
    state.tilled[k].w = now;
    if (crop) crop.w = now;
    return { ok: true, msg: '', changed: true, water: true };
  }
  if (tool === 'seed') {
    const t = state.seedSel;
    if (!CROPS[t] || !(state.seeds[t] > 0)) return { ok: false, msg: '沒有種子了，去雜貨店買吧' };
    if (!state.tilled[k]) return { ok: false, msg: '先用鋤頭翻土' };
    if (crop) return { ok: false, msg: '這裡已經種了東西' };
    state.seeds[t] -= 1;
    if (!state.seeds[t]) { delete state.seeds[t]; nextSeed(state); }
    state.crops[k] = { t, s: 0, w: state.tilled[k].w || 0 };
    return { ok: true, msg: `種下${CROPS[t].name}`, changed: true, plant: t };
  }
  if (tool === 'axe' || tool === 'pickaxe' || tool === 'sickle') return { ok: false, msg: '這裡沒有東西' };
  return { ok: false, msg: '' };
}

/** 作物成長：澆過水且經過 GROW_MS 的長一階，並把水分用掉（下一階要再澆）。回傳是否有變化。 */
export function grow(state, now) {
  let changed = false;
  for (const [k, c] of Object.entries(state.crops)) {
    if (c.s < 3 && c.w && now - c.w >= GROW_MS * CROPS[c.t].grow) { c.s += 1; c.w = 0; if (state.tilled[k]) state.tilled[k].w = 0; changed = true; }
  }
  // 沒種東西的濕土過一陣子會乾
  for (const t of Object.values(state.tilled)) if (t.w && now - t.w > GROW_MS * 2) { t.w = 0; changed = true; }
  return changed;
}

export const debrisLeft = (state) => Object.keys(state.debris).length;

// ---------- 雲端存檔用的精簡格式 ----------
// 一般格式的鍵是 "x,y" 字串、時間是毫秒，整塊田翻滿土時會超過 40 KB；
// 打包成數字陣列、時間改成秒，最壞情況約 23 KB（伺服器上限 48 KB）。
const DEBRIS_KEYS = Object.keys(DEBRIS);
const sec = (ms) => (ms ? Math.round(ms / 1000) : 0);
export function packFarm(s) {
  const xy = (k) => k.split(',').map(Number);
  return {
    v: 'p1', at: s.at || 0,
    d: Object.entries(s.debris).map(([k, d]) => [...xy(k), DEBRIS_KEYS.indexOf(d.t), d.hp, d.look]),
    t: Object.entries(s.tilled).map(([k, t]) => [...xy(k), sec(t.w)]),
    c: Object.entries(s.crops).map(([k, c]) => [...xy(k), CROP_KEYS.indexOf(c.t), c.s, sec(c.w)]),
    inv: s.inv, seeds: s.seeds, sel: s.seedSel, gold: s.gold,
  };
}
/** 解包後一律再經過 sanitizeFarm（雲端資料也不信任）。 */
export function unpackFarm(p, owner) {
  if (!p || p.v !== 'p1') return null;
  const arr = (a) => (Array.isArray(a) ? a.filter(Array.isArray) : []);
  const out = { v: 2, debris: {}, tilled: {}, crops: {}, inv: p.inv, seeds: p.seeds, seedSel: p.sel, gold: p.gold };
  for (const [x, y, ti, hp, look] of arr(p.d)) if (DEBRIS_KEYS[ti]) out.debris[`${x},${y}`] = { t: DEBRIS_KEYS[ti], hp, look };
  for (const [x, y, w] of arr(p.t)) out.tilled[`${x},${y}`] = { w: (Number(w) || 0) * 1000 };
  for (const [x, y, ci, st, w] of arr(p.c)) if (CROP_KEYS[ci]) out.crops[`${x},${y}`] = { t: CROP_KEYS[ci], s: st, w: (Number(w) || 0) * 1000 };
  const s = sanitizeFarm(out, owner);
  s.at = Number(p.at) || 0;
  return s;
}
