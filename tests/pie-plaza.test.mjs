import test from 'node:test';
import assert from 'node:assert/strict';
const SRC = '../site/games/community/pie-plaza/src';
const L = await import(`${SRC}/logic.js`);
const { blobTile } = await import(`${SRC}/engine/autotile.js`);
const { KIND } = await import(`${SRC}/engine/grid.js`);
const { ATLAS, DOORS } = await import(`${SRC}/engine/atlas.js`);
const { getMap } = await import(`${SRC}/maps/index.js`);
const { syncFarm } = await import(`${SRC}/maps/farm.js`);
const { SHOPS, TOWNSFOLK } = await import(`${SRC}/maps/npcs.js`);
const F = await import(`${SRC}/farm/state.js`);
const C = await import(`${SRC}/house/catalog.js`);
const LK = await import(`${SRC}/avatar/look.js`);
const { BODIES } = await import(`${SRC}/engine/bodies.js`);
const FI = await import(`${SRC}/fish/fishing.js`);
const EV = await import(`${SRC}/events/schedule.js`);
const { eventObjects } = await import(`${SRC}/events/effects.js`);
const EX = await import(`${SRC}/house/exterior.js`);

// ---------- 聊天與基本邏輯 ----------
test('cleanText strips controls, bidi marks and collapses spaces', () => {
  assert.equal(L.cleanText('  hi\n\t there ‮'), 'hi there');
  assert.equal(L.cleanText('a​b'), 'a b');
  assert.equal(L.cleanText(42), '');
  assert.equal(Array.from(L.cleanText('😀'.repeat(300))).length, L.CHAT_MAX);
});
test('parseChat / canSend', () => {
  assert.equal(L.parseChat({ k: 'c', t: ' 你好 ' }), '你好');
  assert.equal(L.parseChat({ k: 'c', t: '  ' }), null);
  assert.equal(L.parseChat({ k: 'p', t: 'x' }), null);
  assert.equal(L.canSend(1000, 1000 - L.CHAT_GAP_MS).ok, true);
  assert.equal(L.canSend(1000, 800).ok, false);
});
test('parsePos validates coordinates and area', () => {
  assert.deepEqual(L.parsePos({ k: 'p', p: [10, 20], a: 'farm:u_1' }), { x: 10, y: 20, area: 'farm:u_1' });
  assert.equal(L.parsePos({ k: 'p', p: [10, 20], a: '<script>' }).area, 'plaza');
  assert.equal(L.parsePos({ k: 'p', p: [NaN, 1] }), null);
  assert.equal(L.parsePos({ k: 'p', p: [1e9, 1] }), null);
});
test('movement: diagonal not faster, slides along walls, stepToward arrives', () => {
  const free = () => false;
  const a = L.stepMove({ x: 0, y: 0 }, 1, 0, 0.1, free), b = L.stepMove({ x: 0, y: 0 }, 1, 1, 0.1, free);
  assert.ok(Math.abs(Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)) < 1e-9);
  const wall = (x) => x > 5;
  const s = L.stepMove({ x: 5, y: 0 }, 1, 1, 0.1, wall);
  assert.equal(s.x, 5); assert.ok(s.y > 0);
  let p = { x: 0, y: 0 };
  for (let i = 0; i < 500; i++) { const r = L.stepToward(p, 50, 30, 0.05, free); p = r; if (r.arrived) break; }
  assert.deepEqual([p.x, p.y], [50, 30]);
});
test('dirOf, facingTile and camera clamp', () => {
  assert.equal(L.dirOf(5, 1), L.DIRS.right); assert.equal(L.dirOf(1, -5), L.DIRS.up); assert.equal(L.dirOf(0, 0, 3), 3);
  assert.deepEqual(L.facingTile({ x: 24, y: 30, dir: L.DIRS.right }), { tx: 2, ty: 1 });
  assert.deepEqual(L.cameraFor(0, 0, 1000, 1000), { x: 0, y: 0 });
  assert.deepEqual(L.cameraFor(990, 990, 1000, 1000), { x: 1000 - 480, y: 1000 - 288 });
  assert.ok(L.cameraFor(10, 10, 320, 208).x < 0, 'small rooms are centred');
});

// ---------- 自動接圖 ----------
test('blobTile follows the Sprout layout', () => {
  assert.deepEqual(blobTile(false, false, false, false), [3, 3]);
  assert.deepEqual(blobTile(true, true, true, true), [1, 1]);
  assert.deepEqual(blobTile(false, true, true, false), [0, 0]);
  assert.deepEqual(blobTile(true, false, false, true), [2, 2]);
  assert.deepEqual(blobTile(false, true, false, true), [1, 3]);
  assert.deepEqual(blobTile(true, false, true, false), [3, 1]);
});

// ---------- 地圖 ----------
const decor = C.defaultDecor();
const AREAS = ['plaza', 'town', ...SHOPS.map((s) => `shop:${s.id}`), 'farm:u1', 'house:u1'];
const maps = Object.fromEntries(AREAS.map((a) => [a, getMap(a, { decor })]));
const resolve = (to) => (to === 'farm' ? 'farm:u1' : to);

test('every map builds and every object uses a known sprite', () => {
  for (const [a, m] of Object.entries(maps)) {
    assert.ok(m, a);
    for (const o of m.objects) assert.ok(ATLAS[o.k], `${a}: ${o.k}`);
  }
});
test('every warp leads to an existing map and entry, and entries are walkable', () => {
  for (const [a, m] of Object.entries(maps)) {
    for (const e of Object.values(m.entries)) assert.equal(m.blocked(e.x, e.y), false, `${a} entry ${e.x},${e.y} blocked`);
    for (const w of m.warps) {
      const dest = maps[resolve(w.to)];
      assert.ok(dest, `${a} -> ${w.to}`);
      assert.ok(dest.entries[w.entry], `${a} -> ${w.to}#${w.entry}`);
      const e = dest.entries[w.entry];
      assert.equal(dest.warpAt({ ...e }), undefined, `${w.to}#${w.entry} spawns inside a warp`);
    }
  }
});
// 從入口開始以 4 px 格點做 BFS，確認所有傳送點都走得到
function reach(m, start) {
  const seen = new Set(), q = [[Math.round(start.x / 4), Math.round(start.y / 4)]], key = (i, j) => `${i},${j}`;
  seen.add(key(...q[0]));
  while (q.length) {
    const [i, j] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (seen.has(key(ni, nj)) || ni < -4 || nj < -4 || ni * 4 > m.pw + 16 || nj * 4 > m.ph + 16 || m.blocked(ni * 4, nj * 4)) continue;
      seen.add(key(ni, nj)); q.push([ni, nj]);
    }
  }
  return (x0, y0, x1, y1) => { for (let i = Math.ceil(x0 / 4); i <= Math.floor(x1 / 4); i++) for (let j = Math.ceil(y0 / 4); j <= Math.floor(y1 / 4); j++) if (seen.has(key(i, j))) return true; return false; };
}
test('every warp is reachable on foot from the map entry', () => {
  for (const [a, m] of Object.entries(maps)) {
    const ok = reach(m, Object.values(m.entries)[0]);
    for (const w of m.warps) assert.ok(ok(w.x0, w.y0, w.x1, w.y1), `${a}: warp to ${w.to} unreachable`);
  }
});
test('every shop has a building with a door, an interior and a shopkeeper', () => {
  for (const s of SHOPS) {
    assert.ok(DOORS[s.k], s.k);
    const m = maps[`shop:${s.id}`];
    assert.equal(m.npcs.length, 1);
    assert.ok(m.npcs[0].lines.length >= 2);
    assert.ok(maps.town.warps.some((w) => w.to === `shop:${s.id}`));
  }
  assert.equal(maps.town.npcs.length, TOWNSFOLK.length);
});
test('NPCs and signs can be talked to from an adjacent walkable spot', () => {
  for (const m of [maps.town, ...SHOPS.map((s) => maps[`shop:${s.id}`]), maps.plaza, maps['farm:u1']]) {
    const ok = reach(m, Object.values(m.entries)[0]);
    for (const t of [...m.npcs, ...m.signs]) {
      const spots = [[0, 14, 1], [0, -12, 0], [14, 0, 2], [-14, 0, 3]].map(([dx, dy, dir]) => ({ x: t.x + dx, y: t.y + dy, dir }));
      const good = spots.some((p) => !m.blocked(p.x, p.y) && ok(p.x - 2, p.y - 2, p.x + 2, p.y + 2) && m.interactAt(p) === t);
      assert.ok(good, `${m.id}: cannot talk to ${t.name || t.title}`);
    }
  }
});

// ---------- 農場 ----------
test('new farm is deterministic and full of debris, but the door area and path are clear', () => {
  const a = F.newFarm('u1'), b = F.newFarm('u1'), c = F.newFarm('u2');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.debris, c.debris);
  assert.ok(F.debrisLeft(a) > 150);
  for (const k of Object.keys(a.debris)) { const [x, y] = k.split(',').map(Number); assert.ok(!F.isPath(x, y) && !F.inPond(x, y), k); }
});
test('clearing debris needs the right tool and several hits for stones and stumps', () => {
  const s = F.newFarm('u1');
  const find = (t) => Object.entries(s.debris).find(([, d]) => d.t === t)[0].split(',').map(Number);
  const [sx, sy] = find('stone');
  assert.equal(F.useTool(s, 'axe', sx, sy, 0).ok, false);
  assert.equal(F.useTool(s, 'pickaxe', sx, sy, 0).cleared, undefined);
  assert.equal(F.useTool(s, 'pickaxe', sx, sy, 0).cleared, 'stone');
  assert.equal(s.inv.stone, 1);
  const [tx, ty] = find('stump');
  let hits = 0; while (s.debris[`${tx},${ty}`]) { F.useTool(s, 'axe', tx, ty, 0); hits++; }
  assert.equal(hits, F.DEBRIS.stump.hp); assert.equal(s.inv.wood, 3);
});
test('till, plant, water, grow and harvest', () => {
  const s = F.newFarm('u1');
  const [x, y] = [22, 12];
  delete s.debris[`${x},${y}`];
  assert.equal(F.useTool(s, 'seed', x, y, 0).ok, false, 'needs tilled soil');
  assert.ok(F.useTool(s, 'hoe', x, y, 0).till);
  const seeds = s.seeds.wheat;
  assert.equal(F.useTool(s, 'seed', x, y, 0).plant, 'wheat');
  assert.equal(s.seeds.wheat, seeds - 1);
  assert.equal(F.grow(s, F.GROW_MS * 10), false, 'no water, no growth');
  let t = 1000;
  for (let stage = 1; stage <= 3; stage++) { F.useTool(s, 'wateringcan', x, y, t); t += F.GROW_MS; F.grow(s, t); assert.equal(s.crops[`${x},${y}`].s, stage); }
  assert.equal(F.useTool(s, 'sickle', x, y, t).harvest, 'wheat');
  assert.equal(s.inv.wheat, 1);
  assert.equal(F.useTool(s, 'hoe', 19, 12, 0).ok, false, 'path stays clear');
});
test('sanitizeFarm drops bad data', () => {
  const s = F.sanitizeFarm({ v: 2, debris: { '1,1': { t: 'lava', hp: 9 }, '5,15': { t: 'stone', hp: 99 } }, tilled: { 'x,y': {} }, crops: { '6,15': { t: 'wheat', s: 9 } }, inv: { wood: -5, stone: 'a', hack: 5 }, gold: -9, seeds: { wheat: 3, lava: 9 } }, 'u1');
  assert.equal(s.inv.hack, undefined); assert.equal(s.gold, 0); assert.deepEqual(s.seeds, { wheat: 3 });
  assert.equal(s.debris['1,1'], undefined);
  assert.equal(s.debris['5,15'].hp, 2);
  assert.equal(s.crops['6,15'], undefined, 'crop on untilled tile removed');
  assert.equal(s.inv.wood, undefined);
  const old = F.sanitizeFarm({ v: 1, debris: {}, inv: { wheat: 2 } }, 'u1');
  assert.equal(old.v, 2); assert.deepEqual(old.seeds, F.STARTER_SEEDS); assert.equal(old.inv.wheat, 2);
  assert.equal(F.sanitizeFarm(null, 'u1').v, 2);
});
test('farm debris blocks walking until cleared', () => {
  const m = getMap('farm:u1', { decor }), s = F.newFarm('u1');
  syncFarm(m, s);
  const [k] = Object.keys(s.debris); const [x, y] = k.split(',').map(Number);
  assert.equal(m.blocked(x * 16 + 8, y * 16 + 12), true);
  delete s.debris[k]; syncFarm(m, s);
  assert.ok(m.farmObjects.length === F.debrisLeft(s));
});

// ---------- 裝潢 ----------
test('furniture placement rules', () => {
  const items = [];
  assert.ok(C.canPlace(items, 'bedGreen', 1, 3));
  items.push(C.placeAt(C.furniture('bedGreen'), 1, 3));
  assert.equal(C.canPlace(items, 'tableN', 1, 4), false, 'overlap');
  assert.ok(C.canPlace(items, 'rugGL', 1, 4), 'rugs can go under furniture');
  assert.equal(C.canPlace(items, 'tableN', 0, 5), false, 'outside floor');
  assert.equal(C.canPlace(items, 'tableN', 9, 11), false, 'blocks the door');
  assert.equal(C.canPlace(items, 'paintField', 4, 5), false, 'paintings go on the wall');
  assert.ok(C.canPlace(items, 'paintField', 4, 1));
  assert.equal(C.itemAt(items, 1, 4).k, 'bedGreen');
});
test('default decor is valid and sanitize keeps it', () => {
  const d = C.defaultDecor();
  assert.ok(d.items.length >= 10);
  for (const f of C.FURNITURE) assert.ok(ATLAS[f.k], f.k);
  assert.deepEqual(C.sanitizeDecor(JSON.parse(JSON.stringify(d))).items.map((i) => i.k), d.items.map((i) => i.k));
  assert.equal(C.sanitizeDecor({ v: 1, floor: 'lava', items: [{ k: 'nope' }] }).floor, 'tan');
  for (const k of Object.keys(C.HOUSE_STYLES)) assert.ok(DOORS[k], `house style ${k} has a door`);
});
test('house furniture never blocks the way out', () => {
  const m = maps['house:u1'];
  const ok = reach(m, m.entries.door);
  assert.ok(ok(m.warps[0].x0, m.warps[0].y0, m.warps[0].x1, m.warps[0].y1));
});
test('ground kinds used by maps are known', () => {
  for (const m of Object.values(maps)) for (const v of m.grid.a) assert.ok(Object.values(KIND).includes(v));
});

// ---------- 經濟 ----------
test('buy seeds, cycle seed type, ship everything', () => {
  const s = F.newFarm('u1');
  s.gold = 100;
  assert.equal(F.buySeed(s, 'pumpkin', 2).ok, false, 'not enough gold');
  assert.ok(F.buySeed(s, 'tomato', 2).ok);
  assert.equal(s.gold, 100 - 2 * F.CROPS.tomato.seed);
  const seen = new Set(); for (let i = 0; i < 5; i++) seen.add(F.nextSeed(s));
  assert.deepEqual([...seen].sort(), ['carrot', 'tomato', 'wheat']);
  s.inv = { wheat: 3, wood: 5, fish_carp: 2 };
  const r = F.shipAll(s, { ...F.CROP_PRICES, ...FI.FISH_PRICES });
  assert.equal(r.total, 3 * F.CROPS.wheat.sell + 2 * FI.FISH_PRICES.fish_carp);
  assert.deepEqual(s.inv, { wood: 5 }, 'wood is kept');
});
test('every crop has sprites for all stages, item and seed', () => {
  for (const k of F.CROP_KEYS) for (const n of [...F.CROPS[k].stages, `${k}Item`, `${k}Seed`]) assert.ok(ATLAS[n], n);
});

// ---------- 捏臉 ----------
test('look sanitize, default and palette', () => {
  assert.equal(LK.sanitizeLook([0, 0, 0, 0]), null);
  assert.equal(LK.sanitizeLook([99, 0, 0, 0, 0]), null);
  assert.equal(LK.sanitizeLook([0, 1.5, 0, 0, 0]), null);
  assert.deepEqual(LK.sanitizeLook([1, 2, 3, 4, 5]), [1, 2, 3, 4, 5]);
  assert.ok(LK.sanitizeLook(LK.defaultLook('abc')));
  for (let i = 0; i < 50; i++) assert.ok(LK.sanitizeLook(LK.randomLook()));
  assert.equal(LK.lookPalette([0, 0, 0, 0, 0]).map.size, 0, 'original colours need no remap');
  const p = LK.lookPalette([0, 4, 0, 6, 0]);
  assert.ok(p.map.size >= BODIES[0].hair.length + BODIES[0].top.length);
});
test('role palette keeps relative shading', () => {
  const m = LK.rolePalette([[200, 50, 50], [120, 30, 30]], [210, 0.6, 0.5]);
  const a = LK.rgbToHsl(m.get('200,50,50')), b = LK.rgbToHsl(m.get('120,30,30'));
  assert.ok(a[2] > b[2]); assert.ok(Math.abs(a[0] - 210) < 3);
});
test('every body has colours to recolour and a face picture', () => {
  for (const b of BODIES) { assert.ok(b.top.length + b.bottom.length > 0, b.id); assert.ok(b.name); }
});

// ---------- 釣魚 ----------
test('fish rolls depend on place, time and contest', () => {
  const r = FI.mulberry ? FI.mulberry(1) : Math.random;
  for (let i = 0; i < 200; i++) {
    const f = FI.rollFish('pond', 3, false);
    assert.ok(f.where.includes('pond')); assert.notEqual(f.id, 'trout', 'trout only in daytime'); assert.notEqual(f.id, 'golden');
  }
  let golden = 0; for (let i = 0; i < 2000; i++) if (FI.rollFish('sea', 12, true).id === 'golden') golden++;
  assert.ok(golden > 0, 'golden carp can appear during the contest');
  for (const f of FI.FISH) if (!f.junk) assert.ok(ATLAS[`fish${f.id[0].toUpperCase()}${f.id.slice(1)}`], f.id);
});
test('minigame: holding keeps the bar on a calm fish and catches it; idling loses it', () => {
  const calm = { diff: 1 };
  const g = FI.newMinigame(calm);
  let t = 0; const rnd = () => 0.5;
  while (!g.done && t < 30) { FI.stepMinigame(g, 1 / 60, g.bar + g.size / 2 < g.fish, rnd); t += 1 / 60; }
  assert.equal(g.done, 'caught');
  const g2 = FI.newMinigame({ diff: 3 }); g2.fish = 0.9; t = 0;
  while (!g2.done && t < 30) { FI.stepMinigame(g2, 1 / 60, false, () => 0.99); t += 1 / 60; }
  assert.equal(g2.done, 'escaped');
});

// ---------- 活動 ----------
const at = (h, dow = 3) => { // 2026-10-28 是星期三；回傳台北時間 h 點的毫秒
  const base = Date.UTC(2026, 9, 28 + ((dow - 3 + 7) % 7), h - 8, 30);
  return base;
};
test('events follow Taipei time', () => {
  assert.deepEqual(EV.activeEvents(at(8)).map((e) => e.id), ['market']);
  assert.deepEqual(EV.activeEvents(at(12)).map((e) => e.id), ['fishing']);
  assert.deepEqual(EV.activeEvents(at(21)).map((e) => e.id), ['campfire']);
  assert.deepEqual(EV.activeEvents(at(15)).map((e) => e.id), []);
  assert.ok(EV.activeEvents(at(15, 6)).some((e) => e.id === 'flower'), 'Saturday flower festival');
  const day = EV.todaySchedule(at(12));
  assert.equal(day.find((x) => x.e.id === 'market').state, 'past');
  assert.equal(day.find((x) => x.e.id === 'fishing' && x.from === 12).state, 'now');
});
test('daylight: bright noon, dark midnight, warm dusk', () => {
  assert.equal(EV.daylight(at(12)).dark, 0);
  assert.ok(EV.daylight(at(23)).dark > 0.5);
  assert.ok(EV.daylight(at(17)).warm > 0.2);
});
test('event decorations use known sprites and never block warps or entries', () => {
  for (const id of ['plaza', 'town']) {
    const m = maps[id];
    const objs = eventObjects(id, EV.EVENTS.map((e) => e.id));
    assert.ok(objs.length > 0);
    for (const o of objs) assert.ok(ATLAS[o.k], o.k);
    m.dynamic = objs.filter((o) => o.foot).map((o) => ({ x0: o.x - o.foot[0] / 2, x1: o.x + o.foot[0] / 2, y0: o.y - o.foot[1], y1: o.y }));
    for (const e of Object.values(m.entries)) assert.equal(m.blocked(e.x, e.y), false, `${id} entry blocked by event`);
    const ok = reach(m, Object.values(m.entries)[0]);
    for (const w of m.warps) assert.ok(ok(w.x0, w.y0, w.x1, w.y1), `${id}: event blocks warp to ${w.to}`);
    for (const t of [...m.npcs, ...m.signs]) assert.ok([[0, 14], [0, -12], [14, 0], [-14, 0]].some(([dx, dy]) => !m.blocked(t.x + dx, t.y + dy)), `${id}: event blocks ${t.name || t.title}`);
    m.dynamic = [];
  }
});

// ---------- 小屋外觀 ----------
test('exterior sanitize and yard sprites', () => {
  assert.deepEqual(EX.sanitizeExterior({ roof: 99, wall: -1, yard: [1, 'x', 99] }), { roof: 0, wall: 0, yard: [1, 0, 0, 0] });
  for (const k of EX.YARD) if (k) assert.ok(ATLAS[k], k);
  for (const k of Object.keys(C.HOUSE_STYLES)) assert.ok(EX.EAVES[k], k);
});
test('house yard decorations never block the door or the farm path', () => {
  for (const style of Object.keys(C.HOUSE_STYLES)) {
    const d = C.defaultDecor(); d.style = style; d.ext.yard = [3, 7, 8, 11];
    const m = getMap('farm:u1', { decor: d });
    const ok = reach(m, m.entries.east);
    const w = m.warps.find((x) => x.to.startsWith('house'));
    assert.ok(ok(w.x0, w.y0, w.x1, w.y1), `${style}: door unreachable`);
    for (const t of m.signs) assert.ok([[0, 14], [14, 0], [-14, 0]].some(([dx, dy]) => !m.blocked(t.x + dx, t.y + dy)), `${style}: ${t.title}`);
  }
});
