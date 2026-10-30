// 小屋裝潢：可擺的家具、地板與牆紙。純資料與規則，node 可測。
import { ROOM } from '../maps/interior.js';
import { defaultExterior, sanitizeExterior } from './exterior.js';

// k 是圖集名稱；wall: true 的掛在牆上（畫、時鐘）；w/h 是佔用格數
export const FURNITURE = [
  { k: 'bedGreen', name: '綠色床', w: 1, h: 2 }, { k: 'bedBlue', name: '藍色床', w: 1, h: 2 }, { k: 'bedPink', name: '粉紅床', w: 1, h: 2 },
  { k: 'tableSmall', name: '小桌子', w: 1, h: 1 }, { k: 'tableN', name: '方桌', w: 1, h: 1 }, { k: 'tableLong', name: '長桌', w: 3, h: 1 },
  { k: 'chairL', name: '椅子（左）', w: 1, h: 1 }, { k: 'chairR', name: '椅子（右）', w: 1, h: 1 }, { k: 'stool', name: '凳子', w: 1, h: 1 },
  { k: 'sofa', name: '沙發', w: 2, h: 1 }, { k: 'dresser', name: '櫃子', w: 1, h: 1 }, { k: 'dresserBig', name: '大衣櫃', w: 2, h: 1 },
  { k: 'bookcase', name: '書架', w: 1, h: 1 }, { k: 'bookcaseBig', name: '大書櫃', w: 2, h: 1 }, { k: 'plantPot', name: '盆栽', w: 1, h: 1 },
  { k: 'plantN', name: '大盆栽', w: 1, h: 1 }, { k: 'flowerPot', name: '花盆', w: 1, h: 1 }, { k: 'lampG', name: '綠燈', w: 1, h: 1 },
  { k: 'lampP', name: '粉燈', w: 1, h: 1 }, { k: 'barrel', name: '木桶', w: 1, h: 1 }, { k: 'crate', name: '木箱', w: 1, h: 1 },
  { k: 'rugGL', name: '綠地毯', w: 2, h: 1, flat: true }, { k: 'rugPL', name: '粉地毯', w: 2, h: 1, flat: true }, { k: 'rugBL', name: '藍地毯', w: 2, h: 1, flat: true },
  { k: 'strawMat', name: '草蓆', w: 3, h: 3, flat: true },
  { k: 'paintFlower', name: '花之畫', w: 1, h: 1, wall: true }, { k: 'paintField', name: '田園畫', w: 1, h: 1, wall: true },
  { k: 'paintNight', name: '星空畫', w: 1, h: 1, wall: true }, { k: 'clockRound', name: '圓時鐘', w: 1, h: 1, wall: true },
];
export const FLOORS = { tan: '米色磁磚', cream: '奶油磚', yellow: '黃石地', dark: '深石地', orange: '橘磚', sage: '灰綠磚' };
export const WALLS = { cream: '奶油牆', orange: '橘紅牆', sage: '灰綠牆', brown: '木頭牆' };
export const HOUSE_STYLES = { houseThatch: '茅草大屋', houseWood: '木造農舍', houseChimney: '煙囪小屋', houseOrange: '橘瓦平房', houseSmall: '小木屋' };

const byK = Object.fromEntries(FURNITURE.map((f) => [f.k, f]));
export const furniture = (k) => byK[k] || null;

/** 家具佔用的格子。x,y 是底部中心像素（與 obj 相同），由左上格 tx,ty 換算。 */
export function placeAt(f, tx, ty) {
  return { k: f.k, x: tx * 16 + (f.w * 16) / 2, y: (ty + f.h) * 16, wall: !!f.wall, tx, ty };
}
export function cellsOf(f, tx, ty) { const out = []; for (let y = ty; y < ty + f.h; y++) for (let x = tx; x < tx + f.w; x++) out.push([x, y]); return out; }

/** 能不能擺在 (tx,ty)：地板家具要在地板內、不能擋門口、不能和其他非地毯家具重疊；牆上的要掛在牆面。 */
export function canPlace(items, k, tx, ty) {
  const f = furniture(k);
  if (!f) return false;
  const { floor, door, wallRows } = ROOM;
  const cells = cellsOf(f, tx, ty);
  if (f.wall) {
    if (!cells.every(([x, y]) => x >= floor.x0 && x <= floor.x1 && y >= 1 && y < wallRows)) return false;
  } else {
    if (!cells.every(([x, y]) => x >= floor.x0 && x <= floor.x1 && y >= floor.y0 && y <= floor.y1)) return false;
    if (!f.flat && cells.some(([x, y]) => y === floor.y1 && (x === door.tx || x === door.tx + 1))) return false;
  }
  const taken = new Set();
  for (const it of items) {
    const g = furniture(it.k);
    if (!g || !!g.flat !== !!f.flat || !!g.wall !== !!f.wall) continue;   // 地毯與家具可以疊
    for (const [x, y] of cellsOf(g, it.tx, it.ty)) taken.add(`${x},${y}`);
  }
  return cells.every(([x, y]) => !taken.has(`${x},${y}`));
}

/** 點到哪一件家具（取最上層：非地毯優先）。 */
export function itemAt(items, tx, ty) {
  const hit = items.filter((it) => { const f = furniture(it.k); return f && cellsOf(f, it.tx, it.ty).some(([x, y]) => x === tx && y === ty); });
  hit.sort((a, b) => (furniture(a.k).flat ? 1 : 0) - (furniture(b.k).flat ? 1 : 0));
  return hit[0] || null;
}

export function defaultDecor() {
  const items = [];
  const put = (k, tx, ty) => { if (canPlace(items, k, tx, ty)) items.push(placeAt(furniture(k), tx, ty)); };
  put('rugGL', 9, 7); put('bedGreen', 1, 3); put('dresser', 2, 3); put('tableN', 14, 6); put('chairL', 13, 6); put('chairR', 15, 6);
  put('plantN', 18, 3); put('lampG', 17, 3); put('paintField', 6, 1); put('clockRound', 10, 1); put('paintFlower', 13, 1); put('bookcase', 5, 3); put('bookcaseBig', 7, 3); put('sofa', 4, 9); put('flowerPot', 1, 11);
  return { v: 1, floor: 'tan', wall: 'cream', style: 'houseThatch', ext: defaultExterior(), items };
}

export function sanitizeDecor(d) {
  if (!d || typeof d !== 'object' || d.v !== 1) return defaultDecor();
  const out = { v: 1, floor: FLOORS[d.floor] ? d.floor : 'tan', wall: WALLS[d.wall] ? d.wall : 'cream', style: HOUSE_STYLES[d.style] ? d.style : 'houseThatch', ext: sanitizeExterior(d.ext), items: [] };
  for (const it of Array.isArray(d.items) ? d.items.slice(0, 80) : []) {
    if (!it || !furniture(it.k)) continue;
    const tx = it.tx | 0, ty = it.ty | 0;
    if (canPlace(out.items, it.k, tx, ty)) out.items.push(placeAt(furniture(it.k), tx, ty));
  }
  out.at = Number(d.at) || 0;
  return out;
}
