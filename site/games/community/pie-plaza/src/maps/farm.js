// 個人農場：北邊是自己的小屋，前方一大片田地長滿雜草和石頭，要自己慢慢清。
// 只有自己看得到（之後可以開放拜訪）。東口接廣場。
import { Grid, KIND } from '../engine/grid.js';
import { obj, building, finalizeMap, scatter } from '../engine/world.js';
import { mulberry, seedOf } from '../logic.js';
import { FARM, DEBRIS, CROPS, isPath, POND } from '../farm/state.js';

export function buildFarm(owner, style = 'houseThatch') {
  const { w, h, house } = FARM;
  const g = new Grid(w, h, KIND.GRASS);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isPath(x, y)) g.set(x, y, KIND.DIRT);
  g.rect(POND.x0, POND.y0, POND.x1, POND.y1, KIND.WATER);
  const cx = house.tx * 16, base = house.ty * 16 - 1;
  const hb = building(style, cx, base, `house:${owner}`, null, '我的小屋');
  hb.warp.entry = 'door';
  const objects = [hb.building, obj('signPost', cx - 52, base + 14), obj('chest', cx + 48, base + 12)];
  const signs = [
    { x: cx - 52, y: base + 14, title: '小屋設計', lines: ['要換小屋的樣子嗎？'], action: 'houseStyle' },
    { x: cx + 48, y: base + 12, title: '出貨箱', lines: ['出貨箱：把作物放進來，隔天就會換成金幣。', '（出貨功能之後開放，背包裡的東西會先留著。）'] },
  ];
  // 四周樹林（東邊留出口）
  for (let x = 32; x < w * 16; x += 64) { objects.push(obj(x % 128 ? 'treeClump' : 'pineClump', x, 60)); objects.push(obj('pineClump', x, h * 16 + 6, { foot: [60, 24] })); }
  for (let x = 64; x < w * 16 - 32; x += 96) if (Math.abs(x - cx) > 70) objects.push(obj('treeClump2', x, 120, { foot: [60, 12] }));
  for (let y = 150; y < h * 16 - 20; y += 40) objects.push(obj('treeBig', 18, y));
  for (let y = 150; y < h * 16 - 20; y += 40) if (y < 14 * 16 || y > 18 * 16) objects.push(obj('treeBig', w * 16 - 18, y));
  objects.push(obj('lily', POND.x0 * 16 + 30, POND.y0 * 16 + 28, { foot: null }), obj('lily', POND.x1 * 16 - 10, POND.y1 * 16 - 6, { foot: null }));
  const rnd = mulberry(seedOf(`farmdecor:${owner}`));
  const decor = scatter(rnd, g, [KIND.GRASS], 50, ['flowerY', 'flowerP', 'flowerB', 'mushA', 'fern'], objects,
    (tx, ty) => ty >= FARM.field.y0 || g.get(tx, ty - 1) !== KIND.GRASS || objects.some((o) => Math.abs(o.x - (tx * 16 + 8)) < o.w / 2 + 6 && ty * 16 + 13 > o.y - o.h && ty * 16 + 13 < o.y + 10));
  const map = finalizeMap({
    id: `farm:${owner}`, title: '我的農場', grid: g, base: 'grass', objects: [...objects, ...decor], signs, shared: false, owner, farm: true,
    warps: [hb.warp, { x0: w * 16 - 8, y0: 15 * 16, x1: w * 16 + 8, y1: 17 * 16, to: 'plaza', entry: 'west', label: '廣場' }],
    entries: { east: { x: w * 16 - 20, y: 16 * 16 + 4, dir: 2 }, door: { x: hb.doorX, y: base + 14, dir: 0 } },
  });
  return map;
}

/** 由農場狀態產生動態物件（雜物擋路、作物不擋路）並更新碰撞。 */
export function syncFarm(map, state) {
  const dyn = [], colliders = [];
  for (const [k, d] of Object.entries(state.debris)) {
    const [x, y] = k.split(',').map(Number);
    const look = DEBRIS[d.t].looks[d.look] || DEBRIS[d.t].looks[0];
    dyn.push(obj(look, x * 16 + 8, y * 16 + 14, { foot: null, debris: d.t }));
    colliders.push({ x0: x * 16 + 2, x1: x * 16 + 14, y0: y * 16 + 4, y1: y * 16 + 15 });
  }
  for (const [k, c] of Object.entries(state.crops)) {
    const [x, y] = k.split(',').map(Number);
    dyn.push(obj(CROPS[c.t].stages[c.s], x * 16 + 8, y * 16 + 14, { foot: null, crop: c.t }));
  }
  map.farmObjects = dyn;
  map.dynamic = colliders;
  map.tilled = state.tilled;
  map.groundDirty = true;
}
