// 商店街：參考星露谷鵜鶘鎮的配置。北邊一排店面面向主街，中央是石板市集廣場，
// 南邊是住宅巷。所有人共用。西口接廣場。
import { Grid, KIND } from '../engine/grid.js';
import { obj, building, finalizeMap, scatter } from '../engine/world.js';
import { mulberry } from '../logic.js';
import { SHOPS, TOWNSFOLK } from './npcs.js';

export const TOWN = { w: 56, h: 30, roadY: 14, laneY: 23, plaza: [22, 9, 33, 24] };

export function buildTown() {
  const { w, h, roadY, laneY, plaza } = TOWN;
  const g = new Grid(w, h, KIND.GRASS);
  g.rect(0, roadY, w - 1, roadY + 1, KIND.DIRT);                 // 主街
  g.rect(3, laneY, w - 4, laneY + 1, KIND.DIRT);                 // 住宅巷
  g.rect(plaza[0], plaza[1], plaza[2], plaza[3], KIND.PAVE);      // 市集廣場
  const objects = [], warps = [], signs = [];
  const base = roadY * 16 - 1;                                   // 店面底部貼著主街
  for (const s of SHOPS) {
    const south = !!s.south;
    const y = south ? laneY * 16 - 1 : base;
    const road = south ? laneY : roadY;
    const b = building(s.k, s.cx, y, `shop:${s.id}`, null, s.title);
    b.warp.entry = 'door';
    objects.push(b.building); warps.push(b.warp);
    const sx = b.doorX + (b.doorX < s.cx ? 26 : -26);
    objects.push(obj('signSmall', sx, y + 12, { foot: [10, 5] }));
    const hours = south ? '用金幣買賣五檔鎮民指數。營業 09:00–16:00（台北）。' : '營業時間：早上 9 點到傍晚 5 點。';
    signs.push({ x: sx, y: y + 12, title: s.title, lines: [`【${s.title}】`, hours, '面向門口按 ↑ 就能進去。'] });
    g.rect(Math.floor((b.doorX - 8) / 16), road - 1, Math.floor((b.doorX + 7) / 16), road - 1, KIND.DIRT);
  }
  // 南邊住宅（門朝下，面向住宅巷；木造那棟已改成交易所）
  const homes = [['houseOrange', 104], ['houseOrange2', 232], ['houseChimney', 680], ['houseSmall', 792]];
  for (const [k, cx] of homes) objects.push(obj(k, cx, laneY * 16 - 1));
  // 北邊樹林（店面後方）與四周邊界
  for (let x = 32; x < w * 16; x += 64) { objects.push(obj(x % 128 ? 'treeClump' : 'pineClump', x, 64)); objects.push(obj(x % 192 ? 'treeClump2' : 'treeClump', x + 32, 128, { foot: [60, 10] })); }
  for (let x = 32; x < w * 16; x += 64) objects.push(obj(x % 128 ? 'pineClump' : 'treeClump', x, h * 16 - 2));
  for (let y = 300; y < h * 16 - 40; y += 48) { objects.push(obj('treeBig', 20, y)); objects.push(obj('treeBig', w * 16 - 20, y)); }
  objects.push(obj('treeBig', w * 16 - 20, 250), obj('treeBig', w * 16 - 20, 200));
  // 市集廣場：中央大樹、攤位、長椅、旗幟
  const px0 = plaza[0] * 16, px1 = (plaza[2] + 1) * 16, py0 = plaza[1] * 16, py1 = (plaza[3] + 1) * 16;
  objects.push(obj('treeBigOrange', (px0 + px1) / 2, py0 + 66, { foot: [14, 8] }));
  objects.push(obj('awningA', px0 + 40, py0 + 30, { foot: null }), obj('fruitCrates', px0 + 40, py0 + 44, { foot: [44, 10] }));
  objects.push(obj('awningB', px1 - 40, py0 + 30, { foot: null }), obj('potsA', px1 - 40, py0 + 44, { foot: [44, 10] }));
  objects.push(obj('barrels', px0 + 40, py1 - 52, { foot: [44, 8] }), obj('counterLong', px1 - 40, py1 - 52, { foot: [44, 6] }));
  for (const [bx, by, k] of [[px0 + 6, py0 + 34, 'banner1'], [px1 - 6, py0 + 34, 'banner3'], [px0 + 6, py1 - 4, 'banner4'], [px1 - 6, py1 - 4, 'banner6']]) objects.push(obj(k, bx, by, { foot: [8, 4] }));
  objects.push(obj('treeBigPink', 300, 330), obj('treeBigPink', 560, 300), obj('treeN', 150, 300), obj('treeN2', 820, 300));
  // 跳蚤市場攤位（廣場南邊）
  const fx = (px0 + px1) / 2, fy = py1 - 70;
  objects.push(obj('counterLong', fx, fy, { foot: [44, 6] }), obj('awningA', fx, fy - 14, { foot: null, overhead: true }), obj('crate', fx - 30, fy, { foot: [10, 5] }), obj('sack', fx + 30, fy, { foot: [10, 5] }));
  signs.push({ x: fx, y: fy, title: '跳蚤市場', lines: ['派派鎮跳蚤市場：把用不到的作物、魚、木材拿來賣，也能買別人上架的東西。'], action: 'flea', reach: 26, hint: 'E 逛市場' });
  objects.push(obj('signPost', 40, roadY * 16 - 4));
  objects.push(obj('bulletinBoard', 324, roadY * 16 - 4, { foot: [28, 6] }));
  signs.push({ x: 324, y: roadY * 16 - 4, title: '公告欄', lines: ['派派鎮公告欄：今天的活動都貼在這裡。', '廣場上隨時可以湊人玩搶寶、捉迷藏、傳南瓜、拔河、搬寶、紅綠燈、占席、砸罐和搶瓶。'], action: 'events', reach: 20 });
  for (const lx of [60, 180, 330, 570, 730, 860]) objects.push(obj('lampPost', lx, (roadY + 2) * 16 + 14, { foot: [6, 4] }));
  signs.push({ x: 40, y: roadY * 16 - 4, title: '路牌', lines: ['派派鎮 商店街', '← 西邊回到廣場'] });
  const rnd = mulberry(5566);
  const isFree = (tx, ty) => objects.some((o) => Math.abs(o.x - (tx * 16 + 8)) < o.w / 2 + 8 && ty * 16 + 13 > o.y - o.h - 4 && ty * 16 + 13 < o.y + 10);
  const decor = scatter(rnd, g, [KIND.GRASS], 260, ['flowerY', 'flowerY2', 'flowerP', 'flowerP2', 'flowerB', 'weedA', 'fern', 'mushA', 'pebble'], objects,
    (tx, ty) => g.get(tx, ty - 1) !== KIND.GRASS || isFree(tx, ty));
  const npcs = TOWNSFOLK.map((n) => ({ ...n, home: { x: n.x, y: n.y }, kind: 'npc' }));
  return finalizeMap({
    id: 'town', title: '商店街', grid: g, base: 'grass', objects: [...objects, ...decor], warps: [
      ...warps, { x0: -8, y0: roadY * 16, x1: 8, y1: roadY * 16 + 32, to: 'plaza', entry: 'east', label: '廣場' },
    ],
    signs, npcs,
    entries: { west: { x: 20, y: roadY * 16 + 18, dir: 3 },
      ...Object.fromEntries(warps.map((wp) => [wp.to, { x: (wp.x0 + wp.x1) / 2, y: wp.y1 + 6, dir: 0 }])) },
  });
}
