// 地面合成：每張地圖只畫一次（耕地另外一層，有變動才重畫）。
import { TILE, mulberry, seedOf } from '../logic.js';
import { KIND, LANDISH } from './grid.js';
import { blobTile } from './autotile.js';
import { ATLAS } from './atlas.js';
import { canvas } from './sprites.js';

// 室內地板與牆紙：取自 Ninja Adventure TilesetInteriorFloor 的單格（x, y）
// 2×2 格為一組重複，花紋才完整
export const FLOOR_TILES = { tan: [240, 0], cream: [64, 0], yellow: [0, 192], dark: [176, 192], orange: [64, 96], sage: [240, 96] };
export const WALL_TILES = { cream: [96, 16], orange: [0, 96], sage: [176, 96], brown: [240, 192] };
const GRASS_DETAIL = [[96, 80], [112, 80], [128, 80], [144, 80], [96, 96], [112, 96], [144, 96]];
const DIRT_FLAT = [[0, 80], [16, 80], [32, 80], [16, 96], [32, 96]];

function autotile(L, img, grid, x, y, same, outside) {
  const n = same(grid.get(x, y - 1, outside)), s = same(grid.get(x, y + 1, outside)), w = same(grid.get(x - 1, y, outside)), e = same(grid.get(x + 1, y, outside));
  const [c, r] = blobTile(n, e, s, w);
  L.drawImage(img, c * TILE, r * TILE, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
  return n && s && w && e;
}

/** 回傳 { water: [4 張動畫] | null, land }。 */
export function buildGround(scene, map) {
  const { imgs } = scene, g = map.grid, W = g.w * TILE, H = g.h * TILE;
  const rnd = mulberry(seedOf(map.id));
  const hasWater = map.base === 'water' || g.count(KIND.WATER) > 0;
  const water = hasWater ? [0, 1, 2, 3].map((f) => {
    const [c, x] = canvas(W, H);
    for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) x.drawImage(imgs['sprout/water.png'], f * TILE, 0, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
    return c;
  }) : null;
  const [land, L] = canvas(W, H);
  if (map.base === 'void') { L.fillStyle = '#1b130d'; L.fillRect(0, 0, W, H); }
  const outside = map.base === 'water' ? KIND.WATER : map.base === 'void' ? KIND.VOID : KIND.GRASS;
  const isLand = (k) => LANDISH.has(k);
  const isDirt = (k) => k === KIND.DIRT || k === KIND.BRIDGE;
  for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
    const k = g.get(tx, ty);
    if (k === KIND.GRASS || k === KIND.DIRT || k === KIND.PAVE) {
      const full = autotile(L, imgs['sprout/grass.png'], g, tx, ty, isLand, outside);
      if (full && k === KIND.GRASS && rnd() < 0.2) { const [sx, sy] = GRASS_DETAIL[Math.floor(rnd() * GRASS_DETAIL.length)]; L.drawImage(imgs['sprout/grass.png'], sx, sy, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE); }
    }
  }
  for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
    const k = g.get(tx, ty);
    const pair = (img, [sx, sy]) => L.drawImage(img, sx + (tx % 2) * TILE, sy + (ty % 2) * TILE, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
    if (k === KIND.DIRT) {
      // Sprout 的土路方塊縮在格子中間，接成路會變窄；改用整格平鋪＋描邊
      const [sx, sy] = DIRT_FLAT[Math.floor(rnd() * DIRT_FLAT.length)];
      L.drawImage(imgs['sprout/dirt.png'], sx, sy, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
    } else if (k === KIND.PAVE) pair(imgs['ninja/interior_floor.png'], [32, 208]);
    else if (k === KIND.FLOOR) pair(imgs['ninja/interior_floor.png'], FLOOR_TILES[map.floor] || FLOOR_TILES.tan);
    else if (k === KIND.WALL) pair(imgs['ninja/interior_floor.png'], WALL_TILES[map.wall] || WALL_TILES.cream);
  }
  // 土路邊緣：與草地相鄰的邊畫深色線與草邊，角落削圓
  for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
    if (g.get(tx, ty) !== KIND.DIRT) continue;
    const x = tx * TILE, y = ty * TILE, d = (dx, dy) => isDirt(g.get(tx + dx, ty + dy, KIND.DIRT)) || g.get(tx + dx, ty + dy, KIND.DIRT) === KIND.PAVE;
    const n = d(0, -1), s2 = d(0, 1), w = d(-1, 0), e = d(1, 0);
    L.fillStyle = 'rgba(150,105,60,.75)';
    if (!n) L.fillRect(x, y, TILE, 1); if (!s2) L.fillRect(x, y + TILE - 1, TILE, 1);
    if (!w) L.fillRect(x, y, 1, TILE); if (!e) L.fillRect(x + TILE - 1, y, 1, TILE);
    L.fillStyle = '#8cc34f';
    if (!n && !w) { L.fillRect(x, y, 3, 1); L.fillRect(x, y, 1, 3); L.fillRect(x + 1, y + 1, 1, 1); }
    if (!n && !e) { L.fillRect(x + TILE - 3, y, 3, 1); L.fillRect(x + TILE - 1, y, 1, 3); L.fillRect(x + TILE - 2, y + 1, 1, 1); }
    if (!s2 && !w) { L.fillRect(x, y + TILE - 1, 3, 1); L.fillRect(x, y + TILE - 3, 1, 3); L.fillRect(x + 1, y + TILE - 2, 1, 1); }
    if (!s2 && !e) { L.fillRect(x + TILE - 3, y + TILE - 1, 3, 1); L.fillRect(x + TILE - 1, y + TILE - 3, 1, 3); L.fillRect(x + TILE - 2, y + TILE - 2, 1, 1); }
  }
  // 石板廣場邊緣描一圈深色，看起來比較像鋪面
  L.fillStyle = 'rgba(110,70,40,.6)';
  for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
    if (g.get(tx, ty) !== KIND.PAVE) continue;
    const x = tx * TILE, y = ty * TILE, p = (dx, dy) => g.get(tx + dx, ty + dy) === KIND.PAVE || g.get(tx + dx, ty + dy) === KIND.DIRT;
    if (!p(0, -1)) L.fillRect(x, y, TILE, 2); if (!p(0, 1)) L.fillRect(x, y + TILE - 2, TILE, 2);
    if (!p(-1, 0)) L.fillRect(x, y, 2, TILE); if (!p(1, 0)) L.fillRect(x + TILE - 2, y, 2, TILE);
  }
  // 室內：牆頂深色邊、踢腳板、牆面陰影
  if (map.base === 'void') {
    for (let tx = 0; tx < g.w; tx++) {
      if (g.get(tx, 0) !== KIND.WALL) continue;
      L.fillStyle = '#3a2414'; L.fillRect(tx * TILE, 0, TILE, 4);
      L.fillStyle = '#6b4224'; L.fillRect(tx * TILE, 3 * TILE - 4, TILE, 4);
      L.fillStyle = 'rgba(0,0,0,.18)'; L.fillRect(tx * TILE, 3 * TILE, TILE, 3);
    }
    L.fillStyle = '#8a5a30';
    const door = [...Array(g.w).keys()].filter((tx) => g.get(tx, g.h - 1) === KIND.FLOOR);
    if (door.length) { L.fillRect(door[0] * TILE + 2, (g.h - 1) * TILE + 2, door.length * TILE - 4, 10); L.fillStyle = '#a8763e'; L.fillRect(door[0] * TILE + 4, (g.h - 1) * TILE + 4, door.length * TILE - 8, 6); }
  }
  // 橋：Sprout 木橋取中間 32 px
  for (const b of map.bridges || []) {
    const [, x, y] = ATLAS.bridgeH;
    L.drawImage(imgs['sprout/bridge.png'], x + 5, y, 32, 32, b.x, b.y, 32, 32);
  }
  return { water, land };
}

/** 農場耕地層：Tilled_Dirt 自動接圖，澆過水的加深。 */
export function buildTilled(scene, map) {
  const g = map.grid, [c, x] = canvas(g.w * TILE, g.h * TILE);
  const t = map.tilled || {};
  const has = (tx, ty) => !!t[`${tx},${ty}`];
  for (const k of Object.keys(t)) {
    const [tx, ty] = k.split(',').map(Number);
    const [col, row] = blobTile(has(tx, ty - 1), has(tx + 1, ty), has(tx, ty + 1), has(tx - 1, ty));
    x.drawImage(scene.imgs['sprout/tilled.png'], col * TILE, row * TILE, TILE, TILE, tx * TILE, ty * TILE, TILE, TILE);
  }
  // 澆水：在耕地像素上疊深色（source-atop 只蓋到已畫的土）
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = 'rgba(70,40,20,.45)';
  for (const [k, v] of Object.entries(t)) if (v.w) { const [tx, ty] = k.split(',').map(Number); x.fillRect(tx * TILE, ty * TILE, TILE, TILE); }
  x.globalCompositeOperation = 'source-over';
  return c;
}
