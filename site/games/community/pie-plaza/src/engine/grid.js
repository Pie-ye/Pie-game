// 地形格：每張地圖是一個 Uint8Array，值是 KIND。
export const KIND = { VOID: 0, WATER: 1, GRASS: 2, DIRT: 3, PAVE: 4, FLOOR: 5, WALL: 6, BRIDGE: 7 };
const WALKABLE = new Set([KIND.GRASS, KIND.DIRT, KIND.PAVE, KIND.FLOOR, KIND.BRIDGE]);
/** 畫草地時當成「陸地」的格子（橋也算，橋頭的草地才不會變圓角）。 */
export const LANDISH = new Set([KIND.GRASS, KIND.DIRT, KIND.PAVE, KIND.BRIDGE]);

export class Grid {
  constructor(w, h, fill = KIND.GRASS) { this.w = w; this.h = h; this.a = new Uint8Array(w * h).fill(fill); }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y, outside = KIND.VOID) { return this.inside(x, y) ? this.a[y * this.w + x] : outside; }
  set(x, y, k) { if (this.inside(x, y)) this.a[y * this.w + x] = k; }
  rect(x0, y0, x1, y1, k) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, k); return this; }
  walkable(x, y) { return WALKABLE.has(this.get(x, y)); }
  count(k) { let n = 0; for (const v of this.a) if (v === k) n++; return n; }
}
