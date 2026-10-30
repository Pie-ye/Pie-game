// 伺服器資料 → 前端畫面用的物件；伺服器推來的修補直接套上去。前端不再自己算權威狀態。
import { unpackFarm } from '../farm/state.js';

/** 精簡格式 {d,t,c} → { debris, tilled, crops }（時間是秒，轉回毫秒）。 */
export function fieldFromPacked(packed, owner) {
  const s = unpackFarm({ v: 'p1', d: packed.d, t: packed.t, c: packed.c, inv: {}, seeds: {}, gold: 0 }, owner);
  return { debris: s.debris, tilled: s.tilled, crops: s.crops };
}
/** 自己的完整資料（load 的 me）→ 農場物件（和舊格式相同的欄位，給畫面與 HUD 用）。 */
export function playerFarm(me, owner) {
  return { ...fieldFromPacked(me.farm, owner), inv: { ...(me.inv || {}) }, seeds: { ...(me.seeds || {}) }, seedSel: me.seedSel || 'wheat', gold: me.gold | 0, shares: { ...(me.shares || {}) } };
}
/** 伺服器的「自己」欄位（背包、金幣、種子、持股）覆蓋到農場物件上。 */
export function applyMine(farm, r) {
  if (!r) return;
  if (r.inv) farm.inv = { ...r.inv };
  if (r.seeds) farm.seeds = { ...r.seeds };
  if (r.seedSel) farm.seedSel = r.seedSel;
  if (Number.isFinite(r.gold)) farm.gold = r.gold;
  if (r.shares) farm.shares = { ...r.shares };
}
/** 一格或多格的修補：{ "x,y": { d, t, c } }，null 表示沒有。 */
export function applyTiles(farm, tiles) {
  for (const [k, v] of Object.entries(tiles || {})) {
    if (!/^\d{1,2},\d{1,2}$/.test(k) || !v) continue;
    for (const [field, part] of [['debris', 'd'], ['tilled', 't'], ['crops', 'c']]) {
      if (v[part]) farm[field][k] = { ...v[part] }; else delete farm[field][k];
    }
  }
}
