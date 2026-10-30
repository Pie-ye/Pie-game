// 地圖組裝：把地圖模組給的資料（地形格、物件、傳送點、NPC）整理成可查詢的世界。
// 純資料與幾何，不碰 DOM。
import { ATLAS, DOORS } from './atlas.js';
import { TILE } from '../logic.js';

export const size = (k) => { const a = ATLAS[k]; if (!a) throw new Error(`圖集沒有 ${k}`); return { w: a[3], h: a[4] }; };
const isBuilding = (k) => k.startsWith('house') || k.startsWith('shop') || k === 'chickenHouse';

// 預設的腳底碰撞框 [寬, 高]；null 表示可以穿過（花、草、地毯）
const FOOT = {
  treeSmall: [8, 6], treeRound: [12, 7], treeApple: [12, 7], treeBig: [14, 8], treeBigPink: [14, 8], treeBigOrange: [14, 8],
  treeN: [12, 7], treeN2: [12, 7], pine: [10, 7], treeClump: [60, 16], treeClump2: [60, 16], pineClump: [60, 16],
  stumpBig: [26, 12], grayRock: [28, 14],
};
const PASS = /^(flower|mush|sprout|lily|rug|weed|fern|banner|paint|clock|strawMat|bridge|awning)/;

/** 物件：x 為底部中心、y 為底部（原生像素）。 */
export function obj(k, x, y, opts = {}) {
  const { w, h } = size(k);
  let foot = opts.foot !== undefined ? opts.foot : FOOT[k];
  if (foot === undefined) foot = isBuilding(k) ? [w - 4, Math.round(h * 0.5)] : PASS.test(k) ? null : [Math.min(w, 14), Math.min(h, 8)];
  return { k, x, y, foot, ...opts, w, h };
}

/** 建築加上門口傳送點；回傳 { building, warp, doorX }。 */
export function building(k, x, y, to, at, label) {
  const b = obj(k, x, y);
  const d = DOORS[k] || [0, 14];
  const doorX = Math.round(x + d[0]);
  const warp = { x0: doorX - 7, y0: y - 3, x1: doorX + 7, y1: y + 7, to, at, dir: 1, label };
  return { building: b, warp, doorX };
}

export function finalizeMap(def) {
  const colliders = def.objects.filter((o) => o.foot).map((o) => ({
    x0: o.x - o.foot[0] / 2, x1: o.x + o.foot[0] / 2, y0: o.y - o.foot[1], y1: o.y,
  }));
  const map = {
    shared: true, npcs: [], signs: [], warps: [], music: true, ...def,
    pw: def.grid.w * TILE, ph: def.grid.h * TILE, colliders, dynamic: [],
  };
  const solidAt = (x, y, self) => {
    if (!map.grid.walkable(Math.floor(x / TILE), Math.floor(y / TILE))) return true;
    for (const r of colliders) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    for (const r of map.dynamic) if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
    for (const n of map.npcs) if (n !== self && Math.abs(x - n.x) < 6 && y > n.y - 6 && y < n.y + 2) return true;
    return false;
  };
  // 腳底用三個點檢查（左右腳與身體前緣），貼牆時不會穿模
  map.blocked = (x, y) => solidAt(x - 4, y) || solidAt(x + 4, y) || solidAt(x, y - 3);
  /** NPC 自己走路用：不把自己算成障礙。 */
  map.blockedFor = (self) => (x, y) => solidAt(x - 4, y, self) || solidAt(x + 4, y, self) || solidAt(x, y - 3, self);
  map.warpAt = (p) => map.warps.find((w) => p.x >= w.x0 && p.x <= w.x1 && p.y >= w.y0 && p.y <= w.y1 && (w.dir == null || w.dir === p.dir));
  /** 面前的 NPC 或告示牌（店主隔著櫃台也能說話：reach 較長）。 */
  map.interactAt = (p) => {
    const fx = p.x + [0, 0, -12, 12][p.dir], fy = p.y + [12, -12, 0, 0][p.dir];
    const near = (o) => Math.hypot(o.x - fx, (o.y - 4) - fy) < (o.reach || 14);
    return map.npcs.find(near) || map.signs.find(near) || null;
  };
  return map;
}

/** 在空地隨機撒花草（不擋路），避開 avoid(tx,ty) 回傳 true 的格子。 */
export function scatter(rnd, grid, kinds, n, list, ...rest) {
  const avoid = rest.find((r) => typeof r === 'function');
  const out = [];
  for (let i = 0; i < n; i++) {
    const tx = Math.floor(rnd() * grid.w), ty = Math.floor(rnd() * grid.h);
    if (!kinds.includes(grid.get(tx, ty)) || (avoid && avoid(tx, ty))) continue;
    out.push(obj(list[Math.floor(rnd() * list.length)], tx * TILE + 8 + Math.round((rnd() - 0.5) * 6), ty * TILE + 13, { foot: null, decor: true }));
  }
  return out;
}
