// 小島地形與擺設（純函式，不碰 three.js；node 測試與瀏覽器共用）。
// 座標：x 向東、z 向南（−z 是北），y 向上，單位公尺。島中心是廣場噴水池。

export const TERRAIN_SIZE = 160;          // 地形網格覆蓋 −80..80
export const PLAZA_R = 9;
export const PLATEAU = { x: -13, z: -27, r: 12, h: 2.6 };
export const RAMP = { x0: -15.5, x1: -10.5, zTop: -18, zBottom: -10 };
export const POND = { x: 23, z: -9, r: 6.5 };
export const WATER_Y = 0;
export const DOCK_TOP = 0.78;

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export function coastR(theta) {
  return 54 + 3.5 * Math.sin(3 * theta + 0.4) + 2.2 * Math.sin(5 * theta + 1.3) + 1.4 * Math.sin(9 * theta + 2);
}
function noise(x, z) {
  return Math.sin(x * 0.21 + Math.sin(z * 0.13) * 1.7) * 0.5 + Math.sin(z * 0.17 + Math.cos(x * 0.11) * 2.1) * 0.5;
}

// 南邊碼頭：從沙灘往海裡延伸
export const SHORE_S = coastR(Math.PI / 2);
export const DOCK = { x0: -1.65, x1: 1.65, z0: SHORE_S - 3, z1: SHORE_S + 12 };

/** 高台的覆蓋比例（0 平地、1 台頂），含南側坡道 */
export function plateauFactor(x, z) {
  const dx = x - PLATEAU.x, dz = z - PLATEAU.z;
  const a = Math.atan2(dz, dx);
  const r = PLATEAU.r + 1.3 * Math.sin(3 * a + 0.5) + 0.8 * Math.sin(5 * a + 2);
  const cliff = smooth(r + 0.6, r - 0.6, Math.hypot(dx, dz));
  let ramp = 0;
  if (x > RAMP.x0 && x < RAMP.x1 && z > RAMP.zTop - 2 && z < RAMP.zBottom) ramp = smooth(RAMP.zBottom, RAMP.zTop, z);
  return Math.max(cliff, ramp);
}
const inRamp = (x, z) => x > RAMP.x0 + 0.4 && x < RAMP.x1 - 0.4 && z > RAMP.zTop - 2 && z < RAMP.zBottom + 0.5;

/** 離海岸線的距離（正＝島內） */
export function coastDist(x, z) { return coastR(Math.atan2(z, x)) - Math.hypot(x, z); }

/** 地形高度（不含碼頭） */
export function terrainHeight(x, z) {
  const d = coastDist(x, z);
  if (d < 0) return Math.max(-3.2, 0.15 + d * 0.12);
  let h = 0.15 + smooth(0, 7, d) * 0.35;                 // 沙灘
  const g = smooth(7, 8.6, d);                           // 草地小土坎
  h = lerp(h, 0.85 + noise(x, z) * 0.06, g);
  h += plateauFactor(x, z) * PLATEAU.h * g;
  const q = Math.hypot(x - POND.x, z - POND.z);
  if (q < POND.r + 2) h = lerp(h, -1.1, smooth(POND.r + 1.4, POND.r - 1.6, q));
  return h;
}

export const onDock = (x, z) => x > DOCK.x0 && x < DOCK.x1 && z > DOCK.z0 && z < DOCK.z1;
export function groundAt(x, z) {
  const h = terrainHeight(x, z);
  return onDock(x, z) ? Math.max(h, DOCK_TOP) : h;
}

// ---------- 建築 ----------
// 門一律朝向廣場；rot 是門的朝向角（0 = 門朝 +z）
export const HOUSE_HALF = 2.85;     // 屋子半寬（3×3 格 × 1.9 m）
export const HOUSES = [
  { x: -31, z: 18, roof: '#e2545b' },
  { x: -21, z: 31, roof: '#5b8def' },
  { x: 31, z: 17, roof: '#5cc48a' },
  { x: 15, z: 32, roof: '#ffb35c' },
].map((h) => {
  const rot = Math.atan2(-h.x, -h.z);
  const door = [h.x + Math.sin(rot) * (HOUSE_HALF + 0.9), h.z + Math.cos(rot) * (HOUSE_HALF + 0.9)];
  return { ...h, rot, door };
});

// ---------- 步道 ----------
const H = HOUSES;
export const PATHS = [
  { w: 1.7, pts: [[0, PLAZA_R - 1], [0, 26], [0.5, SHORE_S - 6], [0, SHORE_S - 2]] },          // 往碼頭
  { w: 1.5, pts: [[-PLAZA_R + 1, 1], [-20, 7], H[0].door] },                                    // 西邊住宅
  { w: 1.4, pts: [[-20, 7], H[1].door] },
  { w: 1.5, pts: [[PLAZA_R - 1, 2], [20, 8], H[2].door] },                                      // 東邊住宅
  { w: 1.4, pts: [[20, 8], H[3].door] },
  { w: 1.4, pts: [[-4, -PLAZA_R + 1], [-10, -9], [-13, -9.5]] },                                // 往高台坡道
  { w: 1.4, pts: [[4, -PLAZA_R + 1], [6, -18], [9, -25]] },                                     // 農田
  { w: 1.3, pts: [H[2].door, [38, 20], [42, 23]] },                                               // 營地
];
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
export function pathDist(x, z) {
  let best = Infinity;
  for (const p of PATHS) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
      best = Math.min(best, segDist(x, z, ax, az, bx, bz) - p.w);
    }
  }
  return best;          // <0 在步道上
}

// ---------- 固定擺設 ----------
export const FARM = { x0: 3, x1: 15, z0: -35, z1: -27 };
export const CAMP = { x: 44, z: 24 };

// 固定擺設（模型名 → 位置）。s 為縮放、r 為朝向、c 為碰撞半徑
export function fixedProps() {
  const P = [];
  const add = (model, x, z, o = {}) => P.push({ model, x, z, y: o.y, s: o.s ?? 1, r: o.r ?? 0, c: o.c ?? 0 });
  add('town/fountain-round-detail', 0, 0, { s: 2.3, c: 2.3 });
  for (let i = 0; i < 8; i++) {                           // 廣場燈
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    add('town/lantern', Math.cos(a) * (PLAZA_R - 0.6), Math.sin(a) * (PLAZA_R - 0.6), { s: 1.3, c: 0.18 });
  }
  add('town/stall-red', -5.5, -5.2, { s: 2, r: Math.PI * 0.25, c: 1.1 });
  add('town/stall-green', 5.5, -5.2, { s: 2, r: -Math.PI * 0.25, c: 1.1 });
  add('town/stall-bench', -6.2, 3.8, { s: 2.2, r: -Math.PI * 0.2, c: 0.45 });
  add('town/stall-bench', 6.2, 3.8, { s: 2.2, r: Math.PI * 0.2, c: 0.45 });
  add('town/cart', 7.4, -1.2, { s: 1.6, r: Math.PI * 0.5, c: 0.9 });
  // 碼頭與海邊
  for (let z = DOCK.z0 + 1.6; z < DOCK.z1; z += 3.25) add('pirate/structure-platform-dock', 0, z, { s: 1.3, y: DOCK_TOP - 1.31, c: 0 });
  add('pirate/boat-row-small', 3.6, DOCK.z1 - 3, { s: 1.1, y: -0.18, r: 0.1, c: 0 });
  add('pirate/ship-small', 26, SHORE_S + 30, { s: 1.4, y: -0.7, r: 0.7, c: 0 });
  add('pirate/barrel', -2.6, SHORE_S - 3.2, { s: 0.55, c: 0.4 });
  add('pirate/barrel', -3.4, SHORE_S - 2.4, { s: 0.55, c: 0.4 });
  add('pirate/crate', 2.8, SHORE_S - 3.6, { s: 0.75, r: 0.4, c: 0.5 });
  add('pirate/chest', -38, 30, { s: 0.45, r: -0.6, c: 0.4 });
  add('pirate/flag-pennant', -1.9, DOCK.z1 - 0.4, { s: 1.1, y: DOCK_TOP, c: 0 });
  add('pirate/rocks-sand-a', -46, -24, { s: 1.0, c: 2.2 });
  add('pirate/rocks-sand-b', 47, -22, { s: 0.9, r: 1.2, c: 2.0 });
  add('pirate/rocks-sand-a', 30, 44, { s: 0.7, r: 2, c: 1.6 });
  // 營地
  add('nature/tent_detailedOpen', CAMP.x, CAMP.z - 3.5, { s: 4, r: Math.PI, c: 1.7 });
  add('nature/tent_smallOpen', CAMP.x + 4.5, CAMP.z + 1, { s: 4, r: -Math.PI * 0.6, c: 1.2 });
  add('nature/campfire_stones', CAMP.x, CAMP.z + 1.2, { s: 3, c: 0.8 });
  add('nature/log_large', CAMP.x - 3, CAMP.z + 1.5, { s: 2, r: Math.PI * 0.45, c: 0.7 });
  add('nature/log_large', CAMP.x + 0.4, CAMP.z + 4.2, { s: 2, r: 0, c: 0.7 });
  add('nature/canoe', CAMP.x + 6, CAMP.z + 9, { s: 3.2, r: 0.6, c: 1.2 });
  // 高台：瞭望點
  add('town/tree-high-round', PLATEAU.x - 3, PLATEAU.z - 3, { s: 2.6, c: 0.6 });
  add('town/stall-bench', PLATEAU.x + 2, PLATEAU.z + 2, { s: 2.2, r: 0.6, c: 0.45 });
  add('nature/sign', RAMP.x1 + 1, RAMP.zBottom + 0.8, { s: 3, r: 0, c: 0.3 });
  add('nature/sign', 1.6, SHORE_S - 6, { s: 3, r: 0, c: 0.3 });
  // 農田
  const crops = ['nature/crop_pumpkin', 'nature/crop_melon', 'nature/crop_carrot'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 9; j++) add(crops[i % 3], FARM.x0 + 1.3 + j * 1.25, FARM.z0 + 1.4 + i * 1.8, { s: 2.2, r: j * 0.7, c: 0 });
  for (let x = FARM.x0; x < FARM.x1 - 0.1; x += 2) {
    add('nature/fence_simple', x + 1, FARM.z0, { s: 2, c: 0 });
    if (Math.abs(x + 1 - 9) > 1.5) add('nature/fence_simple', x + 1, FARM.z1 + 2, { s: 2, r: Math.PI, c: 0 });
  }
  // 池塘
  const lilies = [[1.5, 1], [-2, 2.4], [2.6, -2.1], [-1, -2.8], [-3.4, -0.4]];
  lilies.forEach(([dx, dz], i) => add(i % 2 ? 'nature/lily_small' : 'nature/lily_large', POND.x + dx, POND.z + dz, { s: 3.2, y: WATER_Y + 0.04, r: i, c: 0 }));
  return P;
}

// 柵欄碰撞：農田四周（北、東、西整排；南側留門）
export function fenceBoxes() {
  const t = 0.25;
  return [
    { x0: FARM.x0, x1: FARM.x1, z0: FARM.z0 - 1 - t, z1: FARM.z0 - 1 + t },
    { x0: FARM.x0, x1: 7.5, z0: FARM.z1 + 1 - t, z1: FARM.z1 + 1 + t },
    { x0: 10.5, x1: FARM.x1, z0: FARM.z1 + 1 - t, z1: FARM.z1 + 1 + t },
  ];
}

// ---------- 隨機擺設（固定種子，每個人看到的島一樣） ----------
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nearHouse(x, z, pad) {
  return HOUSES.some((h) => Math.hypot(x - h.x, z - h.z) < HOUSE_HALF * 1.45 + pad);
}
function reserved(x, z, pad = 0) {
  if (Math.hypot(x, z) < PLAZA_R + 2.5 + pad) return true;
  if (pathDist(x, z) < 1.2 + pad) return true;
  if (nearHouse(x, z, pad)) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2.2 + pad) return true;
  if (x > FARM.x0 - 2 - pad && x < FARM.x1 + 2 + pad && z > FARM.z0 - 2 - pad && z < FARM.z1 + 3 + pad) return true;
  if (Math.hypot(x - CAMP.x, z - CAMP.z) < 7 + pad) return true;
  if (x > RAMP.x0 - 2 && x < RAMP.x1 + 2 && z > RAMP.zTop - 3 && z < RAMP.zBottom + 2) return true;
  if (Math.abs(x) < 5 && z > SHORE_S - 9) return true;           // 碼頭前
  const p = plateauFactor(x, z);
  if (p > 0.02 && p < 0.98) return true;                          // 懸崖邊
  if (Math.hypot(x - PLATEAU.x + 3, z - PLATEAU.z + 3) < 3.5) return true;
  return false;
}

export function scatterProps(seed = 20261022) {
  const R = rng(seed);
  const out = [];
  const trees = [];
  const tryPlace = (n, test, make, tries = 40) => {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < tries; k++) {
        const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 60;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (!test(x, z)) continue;
        make(x, z); break;
      }
    }
  };
  const spaced = (x, z, gap) => trees.every((t) => Math.hypot(t.x - x, t.z - z) > gap);
  // 闊葉樹：草地與高台上
  const broad = ['town/tree', 'town/tree-high-round', 'nature/tree_default', 'nature/tree_oak', 'nature/tree_fat', 'nature/tree_detailed'];
  tryPlace(78, (x, z) => coastDist(x, z) > 11 && !reserved(x, z, 1.2) && spaced(x, z, 4.2), (x, z) => {
    const model = broad[Math.floor(R() * broad.length)];
    const s = model.startsWith('town') ? 2.1 + R() * 0.5 : 3.0 + R() * 0.7;
    trees.push({ x, z }); out.push({ model, x, z, s, r: R() * 6.28, c: 0.45 });
  });
  // 椰子樹：沙灘
  const palms = ['nature/tree_palmTall', 'nature/tree_palmBend', 'nature/tree_palmDetailedTall', 'nature/tree_palmShort'];
  tryPlace(34, (x, z) => { const d = coastDist(x, z); return d > 1.2 && d < 6 && !reserved(x, z, 0.5) && spaced(x, z, 4.5); }, (x, z) => {
    trees.push({ x, z }); out.push({ model: palms[Math.floor(R() * palms.length)], x, z, s: 3.4 + R() * 0.8, r: R() * 6.28, c: 0.35 });
  });
  // 灌木
  const bushes = ['nature/plant_bush', 'nature/plant_bushLarge', 'nature/plant_bushDetailed', 'nature/plant_bushSmall'];
  tryPlace(46, (x, z) => coastDist(x, z) > 9 && !reserved(x, z, 0.3) && spaced(x, z, 1.6), (x, z) => {
    out.push({ model: bushes[Math.floor(R() * bushes.length)], x, z, s: 2.8 + R() * 0.8, r: R() * 6.28, c: 0.5 });
  });
  // 花叢：一叢 3–6 朵同色
  const flowers = [['nature/flower_redA', 'nature/flower_redB'], ['nature/flower_yellowA', 'nature/flower_yellowB'], ['nature/flower_purpleA', 'nature/flower_purpleB']];
  tryPlace(58, (x, z) => coastDist(x, z) > 9 && !reserved(x, z, -0.6), (x, z) => {
    const kind = flowers[Math.floor(R() * flowers.length)];
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const fx = x + (R() - 0.5) * 2.2, fz = z + (R() - 0.5) * 2.2;
      if (reserved(fx, fz, -0.8)) continue;
      out.push({ model: kind[i % 2], x: fx, z: fz, s: 2.4 + R() * 0.6, r: R() * 6.28, c: 0 });
    }
  });
  // 草叢、蘑菇
  const grass = ['nature/grass', 'nature/grass_large', 'nature/grass_leafs'];
  tryPlace(260, (x, z) => coastDist(x, z) > 8.6 && !reserved(x, z, -0.9), (x, z) => {
    out.push({ model: grass[Math.floor(R() * grass.length)], x, z, s: 1.5 + R() * 0.7, r: R() * 6.28, c: 0 });
  }, 8);
  tryPlace(14, (x, z) => coastDist(x, z) > 12 && !reserved(x, z, 0) && !spaced(x, z, 3), (x, z) => {
    out.push({ model: R() < 0.5 ? 'nature/mushroom_red' : 'nature/mushroom_tanGroup', x, z, s: 2.4, r: R() * 6.28, c: 0 });
  });
  // 石頭：沙灘與草地
  const rocks = ['nature/rock_largeA', 'nature/rock_largeB', 'nature/rock_smallA', 'nature/rock_smallC', 'nature/rock_tallA', 'nature/stone_largeA'];
  tryPlace(24, (x, z) => coastDist(x, z) > 0.5 && !reserved(x, z, 0.5) && spaced(x, z, 2.5), (x, z) => {
    const model = rocks[Math.floor(R() * rocks.length)];
    const s = 2.2 + R() * 1.4;
    out.push({ model, x, z, s, r: R() * 6.28, c: model.includes('small') ? 0 : 0.42 * s * (model.includes('tall') ? 1 : 0.9) });
  });
  return out;
}

// ---------- 碰撞與移動 ----------
export function buildWorld() {
  const props = [...fixedProps(), ...scatterProps()];
  const circles = props.filter((p) => p.c > 0).map((p) => ({ x: p.x, z: p.z, r: p.c }));
  // 房子：轉成本地座標的方框（門口不擋，可以貼著門）
  const houses = HOUSES.map((h) => ({ ...h, half: HOUSE_HALF }));
  const boxes = fenceBoxes();
  // 空間雜湊加速圓形碰撞查詢
  const cell = 4, grid = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const c of circles) {
    const i0 = Math.floor((c.x - c.r) / cell), i1 = Math.floor((c.x + c.r) / cell);
    const j0 = Math.floor((c.z - c.r) / cell), j1 = Math.floor((c.z + c.r) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
  }
  return { props, circles, houses, boxes, grid, cell };
}

export const BODY_R = 0.32;

/** 這個位置站得住嗎（地形＋碰撞）。from 用來判斷高台邊緣 */
export function blocked(world, x, z) {
  if (!onDock(x, z)) {
    const h = terrainHeight(x, z);
    if (h < -0.38) return true;                                 // 深水
    const p = plateauFactor(x, z);
    if (p > 0.06 && p < 0.94 && !inRamp(x, z)) return true;     // 懸崖
  } else if (z > DOCK.z1 - 0.3) return true;
  const list = world.grid.get(`${Math.floor(x / world.cell)},${Math.floor(z / world.cell)}`);
  if (list) for (const c of list) if (Math.hypot(x - c.x, z - c.z) < c.r + BODY_R) return true;
  for (const h of world.houses) {
    const dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), s = Math.sin(h.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;          // 轉到房子本地座標
    if (Math.abs(lx) < h.half + BODY_R && Math.abs(lz) < h.half + BODY_R) return true;
  }
  for (const b of world.boxes) if (x > b.x0 - BODY_R && x < b.x1 + BODY_R && z > b.z0 - BODY_R && z < b.z1 + BODY_R) return true;
  return false;
}

export const WALK = 3.6, RUN = 6.4, JUMP_V = 5.2, GRAVITY = 15;

/**
 * 一步移動。state：{ x, y, z, vy, air, heading }；input：{ mx, mz（世界座標方向，長度 ≤ 1）, run, jump }
 * 回傳新的 state 與實際速度。
 */
export function step(world, state, input, dt) {
  const s = { ...state };
  const len = Math.hypot(input.mx, input.mz);
  const speed = (input.run ? RUN : WALK) * Math.min(1, len);
  let moved = 0;
  if (len > 0.01) {
    const dx = input.mx / len * speed * dt, dz = input.mz / len * speed * dt;
    const ox = s.x, oz = s.z;
    if (!blocked(world, s.x + dx, s.z + dz)) { s.x += dx; s.z += dz; }
    else if (!blocked(world, s.x + dx, s.z)) s.x += dx;
    else if (!blocked(world, s.x, s.z + dz)) s.z += dz;
    moved = Math.hypot(s.x - ox, s.z - oz) / Math.max(dt, 1e-4);
    // 轉身：平順轉向移動方向
    const target = Math.atan2(input.mx, input.mz);
    let d = target - s.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    s.heading += d * Math.min(1, dt * 12);
  }
  const ground = groundAt(s.x, s.z);
  if (!s.air && input.jump) { s.vy = JUMP_V; s.air = true; }
  if (s.air) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= ground) { s.y = ground; s.vy = 0; s.air = false; }
  } else if (s.y - ground > 0.35) { s.air = true; s.vy = 0; }       // 走下碼頭邊緣等落差
  else s.y = ground;
  return { state: s, speed: moved };
}

export const SPAWN = { x: 0, z: 13 };
export function spawnPoint(rand = Math.random) {
  for (let i = 0; i < 20; i++) {
    const x = SPAWN.x + (rand() - 0.5) * 6, z = SPAWN.z + (rand() - 0.5) * 3;
    if (Math.hypot(x, z) > PLAZA_R - 1) return { x, z };
  }
  return { ...SPAWN };
}

/** 地點名稱（顯示在畫面上方） */
export function zoneAt(x, z) {
  if (onDock(x, z)) return '小碼頭';
  if (Math.hypot(x, z) < PLAZA_R + 5) return '噴水池廣場';
  if (plateauFactor(x, z) > 0.9) return '瞭望高台';
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 3) return '蓮花池';
  if (x > FARM.x0 - 2 && x < FARM.x1 + 2 && z > FARM.z0 - 2 && z < FARM.z1 + 3) return '小農田';
  if (Math.hypot(x - CAMP.x, z - CAMP.z) < 9) return '海邊營地';
  if (HOUSES.some((h) => Math.hypot(x - h.x, z - h.z) < 7)) return '小屋區';
  if (coastDist(x, z) < 7) return '沙灘';
  return '草原';
}

/** 地面顏色（0..1 RGB），地形網格頂點色用 */
export function groundColor(x, z) {
  const d = coastDist(x, z);
  const h = terrainHeight(x, z);
  const n = noise(x * 2.3, z * 2.3);
  const sand = [0.96 + n * 0.015, 0.87 + n * 0.02, 0.66 + n * 0.02];
  if (d < 7.4) {
    const wet = smooth(1.2, -0.6, d);                              // 浪打到的濕沙
    return mix(sand, [0.82, 0.72, 0.52], wet);
  }
  let c = [0.47 + n * 0.035, 0.78 + n * 0.04, 0.38 + n * 0.03];  // 草地
  const checker = (Math.floor(x / 2.2) + Math.floor(z / 2.2)) & 1;   // 動森那種淡淡的格子草
  if (checker) c = [c[0] * 0.965, c[1] * 0.975, c[2] * 0.965];
  const p = plateauFactor(x, z);
  if (p > 0.06 && p < 0.94 && !inRamp(x, z)) c = [0.62 + n * 0.03, 0.5 + n * 0.03, 0.38];     // 崖壁
  const q = Math.hypot(x - POND.x, z - POND.z);
  if (q < POND.r + 1.2) c = mix(c, [0.55, 0.47, 0.34], smooth(POND.r + 1.2, POND.r, q));
  if (h < 0.3 && d > 7.4) c = mix(c, [0.55, 0.47, 0.34], 0.6);
  const pd = pathDist(x, z);
  if (pd < 0.4) c = mix(c, [0.86, 0.76, 0.56], smooth(0.4, -0.2, pd));
  const r = Math.hypot(x, z);
  if (r < PLAZA_R + 0.3) {
    const tile = ((Math.floor(r / 1.5) + Math.floor(Math.atan2(z, x) * 6 / Math.PI)) & 1) ? 0.95 : 0.9;
    c = mix(c, [0.93 * tile, 0.87 * tile, 0.76 * tile], smooth(PLAZA_R + 0.3, PLAZA_R - 0.3, r));
  }
  if (x > FARM.x0 - 0.5 && x < FARM.x1 + 0.5 && z > FARM.z0 - 0.5 && z < FARM.z1 + 1) {
    const row = (Math.floor((z - FARM.z0) / 0.9) & 1) ? 0.92 : 1;
    c = [0.52 * row, 0.38 * row, 0.26 * row];
  }
  return c;
}
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
