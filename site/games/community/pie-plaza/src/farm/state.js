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
export const CROPS = {
  wheat: { name: '小麥', stages: ['wheat0', 'wheat1', 'wheat2', 'wheat3'], item: 'wheat' },
  beet: { name: '甜菜', stages: ['beet0', 'beet1', 'beet2', 'beet3'], item: 'beet' },
};
export const GROW_MS = 45_000;                      // 澆過水後多久長一階
export const TOOLS = ['axe', 'pickaxe', 'sickle', 'hoe', 'wateringcan', 'wheat', 'beet', 'hammer'];
export const TOOL_NAMES = { axe: '斧頭', pickaxe: '十字鎬', sickle: '鐮刀', hoe: '鋤頭', wateringcan: '澆水壺', wheat: '小麥種子', beet: '甜菜種子', hammer: '裝潢' };
export const ITEM_NAMES = { wood: '木材', stone: '石頭', fiber: '纖維', wheat: '小麥', beet: '甜菜' };

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
  return { v: 1, debris, tilled: {}, crops: {}, inv: { wood: 0, stone: 0, fiber: 0, wheat: 0, beet: 0 } };
}

/** 讀檔時把壞資料清掉（localStorage 可能被手改）。 */
export function sanitizeFarm(s, owner) {
  if (!s || typeof s !== 'object' || s.v !== 1) return newFarm(owner);
  const out = newFarm(owner);
  const okKey = (k) => /^\d{1,2},\d{1,2}$/.test(k);
  out.debris = {};
  for (const [k, d] of Object.entries(s.debris || {})) if (okKey(k) && d && DEBRIS[d.t]) out.debris[k] = { t: d.t, hp: Math.max(1, Math.min(DEBRIS[d.t].hp, d.hp | 0)), look: (d.look | 0) % DEBRIS[d.t].looks.length };
  for (const [k, t] of Object.entries(s.tilled || {})) if (okKey(k) && t) out.tilled[k] = { w: Number(t.w) || 0 };
  for (const [k, c] of Object.entries(s.crops || {})) if (okKey(k) && c && CROPS[c.t] && out.tilled[k]) out.crops[k] = { t: c.t, s: Math.max(0, Math.min(3, c.s | 0)), w: Number(c.w) || 0 };
  for (const k of Object.keys(out.inv)) out.inv[k] = Math.max(0, Math.min(99999, (s.inv && s.inv[k]) | 0));
  return out;
}

/**
 * 在 (x,y) 用工具。回傳 { ok, msg, changed }；會直接修改 state。
 * now 用來記錄澆水時間；作物長大由 grow() 處理。
 */
export function useTool(state, tool, x, y, now) {
  const k = key(x, y);
  if (!inField(x, y) && tool !== 'hammer') return { ok: false, msg: '這裡不能耕作' };
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
  if (CROPS[tool]) {
    if (!state.tilled[k]) return { ok: false, msg: '先用鋤頭翻土' };
    if (crop) return { ok: false, msg: '這裡已經種了東西' };
    state.crops[k] = { t: tool, s: 0, w: state.tilled[k].w || 0 };
    return { ok: true, msg: `種下${CROPS[tool].name}`, changed: true, plant: tool };
  }
  if (tool === 'axe' || tool === 'pickaxe' || tool === 'sickle') return { ok: false, msg: '這裡沒有東西' };
  return { ok: false, msg: '' };
}

/** 作物成長：澆過水且經過 GROW_MS 的長一階，並把水分用掉（下一階要再澆）。回傳是否有變化。 */
export function grow(state, now) {
  let changed = false;
  for (const [k, c] of Object.entries(state.crops)) {
    if (c.s < 3 && c.w && now - c.w >= GROW_MS) { c.s += 1; c.w = 0; if (state.tilled[k]) state.tilled[k].w = 0; changed = true; }
  }
  // 沒種東西的濕土過一陣子會乾
  for (const t of Object.values(state.tilled)) if (t.w && now - t.w > GROW_MS * 2) { t.w = 0; changed = true; }
  return changed;
}

export const debrisLeft = (state) => Object.keys(state.debris).length;
