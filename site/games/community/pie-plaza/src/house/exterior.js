// 小屋外觀自訂（純資料）：樣式、屋頂色、牆面色、門前四格院子擺設。
// 屋頂與牆面依每種樣式的「屋簷線」上下分區換色（屋簷線以上是屋頂）。
export const ROOF = [null, [5, 0.62], [205, 0.5], [120, 0.42], [275, 0.4], [40, 0.75], [210, 0.08]];
export const ROOF_NAMES = ['原色', '紅瓦', '藍瓦', '綠瓦', '紫瓦', '金黃', '石板灰'];
export const WALL = [null, [35, 0.15, 0.85], [20, 0.45, 0.28], [345, 0.4, 0.72], [205, 0.18, 0.55], [100, 0.2, 0.55]];
export const WALL_NAMES = ['原色', '白漆', '深木', '粉紅', '藍灰', '抹茶'];
export const EAVES = { houseThatch: 0.66, houseWood: 0.72, houseChimney: 0.5, houseOrange: 0.62, houseSmall: 0.55 };
// 院子四格：門左遠、門左、門右、門右遠
export const YARD = [null, 'flowerY2', 'flowerP2', 'sunflower', 'bushBerry', 'bush', 'plantN', 'barrel', 'crate', 'pumpkin3', 'mushD', 'lampPost'];
export const YARD_NAMES = ['空地', '黃花', '粉花', '向日葵', '莓果叢', '灌木', '盆栽', '木桶', '木箱', '南瓜', '蘑菇', '路燈'];
export const YARD_OFFSETS = [-46, -26, 26, 46];

export function defaultExterior() { return { roof: 0, wall: 0, yard: [1, 0, 0, 3] }; }
export function sanitizeExterior(e) {
  const d = defaultExterior();
  if (!e || typeof e !== 'object') return d;
  const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
  return { roof: idx(e.roof, ROOF.length), wall: idx(e.wall, WALL.length), yard: [0, 1, 2, 3].map((i) => idx(Array.isArray(e.yard) ? e.yard[i] : 0, YARD.length)) };
}
