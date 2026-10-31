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
const X = await import(`${SRC}/game/exchange.js`);
const { createLocalApi } = await import(`${SRC}/game/api.js`);
const PTY = await import(`${SRC}/game/party.js`);
const CT = await import(`${SRC}/game/contest.js`);
const SK = await import(`${SRC}/game/seek.js`);
const HOT = await import(`${SRC}/game/hot.js`);
const TG = await import(`${SRC}/game/tug.js`);
const HL = await import(`${SRC}/game/haul.js`);
const LT = await import(`${SRC}/game/light.js`);
const HI = await import(`${SRC}/game/hill.js`);
const SM = await import(`${SRC}/game/smash.js`);
const VA = await import(`${SRC}/game/vase.js`);
const CD = await import(`${SRC}/ui/countdown.js`);

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
const AREAS = ['plaza', 'town', 'arena', ...SHOPS.map((s) => `shop:${s.id}`), 'farm:u1', 'house:u1'];
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
test('south-lane houseWood is the exchange with 妮可', () => {
  const s = SHOPS.find((x) => x.id === 'exchange');
  assert.ok(s.south && s.k === 'houseWood' && s.npc.sprite === 'inspector' && s.npc.action === 'exchange');
  assert.equal(s.npc.name, '妮可');
  assert.ok(maps.town.warps.some((w) => w.to === 'shop:exchange'));
  assert.equal(maps['shop:exchange'].title, '派派鎮民交易所');
  assert.equal(maps['shop:exchange'].npcs[0].name, '妮可');
  assert.equal(maps.town.objects.filter((o) => o.k === 'houseWood').length, 1);
});
test('exchange spread is 2 percent; guest can see quotes and cannot trade', async () => {
  assert.deepEqual(X.spread(100), { buy: 101, sell: 99 });
  assert.deepEqual(X.spread(50), { buy: 51, sell: 49 });
  const open = Date.UTC(2026, 10, 2, 2, 0);   // 台北 10:00
  const shut = Date.UTC(2026, 10, 2, 8, 0);   // 台北 16:00
  assert.equal(X.marketOpen(open), true);
  assert.equal(X.marketOpen(shut), false);
  const api = createLocalApi();
  const q = await api.call('quote');
  assert.equal(q.quotes.length, 5);
  assert.deepEqual(q.quotes.map((t) => t.id), ['GROC', 'BAKE', 'SHOW', 'WISH', 'FISH']);
  await assert.rejects(() => api.call('trade', { side: 'buy', ticker: 'GROC', n: 1 }), /登入/);
});
test('NPCs and signs can be talked to from an adjacent walkable spot', () => {
  for (const m of [maps.town, ...SHOPS.map((s) => maps[`shop:${s.id}`]), maps.plaza, maps['farm:u1']]) {
    const ok = reach(m, Object.values(m.entries)[0]);
    for (const t of [...m.npcs, ...m.signs]) {
      // 從四個方向、由近到遠（不超過互動距離）找站得住、面向它就能互動的位置
      const spots = [];
      for (const d of [14, 22, 30, 38].filter((d) => d <= 14 + (t.reach || 14))) for (const [ux, uy, dir] of [[0, 1, 1], [0, -1, 0], [1, 0, 2], [-1, 0, 3]]) spots.push({ x: t.x + ux * d, y: t.y + uy * d + (uy < 0 ? 2 : 0), dir });
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
  assert.deepEqual(EV.activeEvents(at(15)).map((e) => e.id), ['reggie']);
  assert.deepEqual(EV.activeEvents(at(14)).map((e) => e.id), []);
  assert.ok(EV.activeEvents(at(14, 6)).some((e) => e.id === 'flower'), 'Saturday flower festival');
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
    for (const t of [...m.npcs, ...m.signs]) {
      const ds = [14, 22, 30, 38].filter((d) => d <= 14 + (t.reach || 14));
      assert.ok(ds.some((d) => [[0, 1, 1], [0, -1, 0], [1, 0, 2], [-1, 0, 3]].some(([ux, uy, dir]) => { const p = { x: t.x + ux * d, y: t.y + uy * d, dir }; return !m.blocked(p.x, p.y) && m.interactAt(p) === t; })), `${id}: event blocks ${t.name || t.title}`);
    }
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

// ---------- 雲端存檔 ----------
test('packFarm / unpackFarm round trip and worst-case size', () => {
  const s = F.newFarm('u1');
  s.gold = 1234; s.inv = { wheat: 3, fish_carp: 2 }; s.seeds = { tomato: 4 }; s.seedSel = 'tomato'; s.at = 1790000000000;
  const k = Object.keys(s.debris)[0]; s.debris[k].hp = 1;
  s.tilled['22,12'] = { w: 1790000000000 }; s.crops['22,12'] = { t: 'pumpkin', s: 2, w: 1790000000000 };
  const back = F.unpackFarm(JSON.parse(JSON.stringify(F.packFarm(s))), 'u1');
  assert.deepEqual(back, s);
  // 最壞：整塊田翻土並種滿南瓜
  const full = F.newFarm('u1'); full.debris = {};
  for (let y = F.FARM.field.y0; y <= F.FARM.field.y1; y++) for (let x = F.FARM.field.x0; x <= F.FARM.field.x1; x++) {
    full.tilled[`${x},${y}`] = { w: 1790000123456 }; full.crops[`${x},${y}`] = { t: 'strawberry', s: 3, w: 1790000123456 };
  }
  const bytes = Buffer.byteLength(JSON.stringify(F.packFarm(full)));
  assert.ok(bytes < 40 * 1024, `packed full farm is ${bytes} bytes`);
  assert.equal(F.unpackFarm({ v: 'p1', d: [[1, 1, 99, 1, 0]], gold: -5 }, 'u1').gold, 0, 'unpacked data is sanitised');
  assert.equal(F.unpackFarm({ v: 'nope' }, 'u1'), null);
});


// ---------- 拜訪與社交 ----------
const SO = await import(`${SRC}/social/home.js`);
test('home snapshot round trip hides gold, backpack and seeds', () => {
  const farm = F.newFarm('u1'); farm.gold = 9999; farm.inv = { pumpkin: 5 }; farm.seeds = { tomato: 3 }; farm.at = 5;
  farm.tilled['22,12'] = { w: 1790000000000 }; farm.crops['22,12'] = { t: 'tomato', s: 2, w: 1790000000000 };
  const d = C.defaultDecor(); d.style = 'houseWood'; d.ext.roof = 2;
  const home = SO.makeHome({ farm, decor: d, look: [1, 2, 3, 4, 5], name: '阿派' });
  const text = JSON.stringify(home);
  assert.ok(!text.includes('9999') && !text.includes('pumpkin') && !text.includes('"seeds"'), 'private data stays private');
  assert.ok(Buffer.byteLength(text) < 40 * 1024);
  const back = SO.readHome(JSON.parse(text), 'u1');
  assert.equal(back.name, '阿派'); assert.equal(back.decor.style, 'houseWood'); assert.equal(back.decor.ext.roof, 2);
  assert.deepEqual(back.farm.crops['22,12'], { t: 'tomato', s: 2, w: 1790000000000 });
  assert.equal(Object.keys(back.farm.debris).length, Object.keys(farm.debris).length);
  assert.equal(back.farm.gold, 0);
  assert.deepEqual(back.look, [1, 2, 3, 4, 5]);
  assert.equal(SO.readHome({ v: 9 }, 'u1'), null);
  assert.equal(SO.readHome({ v: 1, name: '<b>x</b>', field: { d: [[1, 1, 99, 1, 1]] }, look: 'bad' }, 'u1').look, null);
});
test('a visited farm and house build from the snapshot and have working warps', () => {
  const home = SO.readHome(SO.makeHome({ farm: F.newFarm('u9'), decor: C.defaultDecor(), look: null, name: 'B' }), 'u9');
  const fm = getMap('farm:u9', { decor: home.decor }), hm = getMap('house:u9', { decor: home.decor });
  syncFarm(fm, home.farm);
  assert.equal(fm.owner, 'u9'); assert.equal(hm.owner, 'u9');
  assert.ok(fm.warps.some((w) => w.to === 'house:u9')); assert.ok(hm.warps.some((w) => w.to === 'farm:u9'));
  const ok = reach(fm, fm.entries.east);
  const door = fm.warps.find((w) => w.to === 'house:u9');
  assert.ok(ok(door.x0, door.y0, door.x1, door.y1), 'visitor can walk from the bridge to the house');
});
test('directory card is small and readable', () => {
  const farm = F.newFarm('u1');
  const card = SO.makeCard({ farm, decor: C.defaultDecor(), look: [0, 0, 0, 1, 0], name: '很長的名字'.repeat(10), likes: 7 });
  assert.ok(Buffer.byteLength(JSON.stringify(card)) < 1024);
  const c = SO.readCard(JSON.parse(JSON.stringify(card)));
  assert.equal(c.likes, 7); assert.equal(Array.from(c.name).length, 20);
  assert.equal(SO.readCard({ v: 1, likes: -5, crops: 'x' }).likes, 0);
  assert.equal(SO.readCard(null), null);
});
test('social settings, friends and daily likes', () => {
  const s = SO.sanitizeSocial({ v: 1, open: false, friends: [{ id: 'u2', name: '小菲' }, { id: 5 }, null], liked: { u2: '2026-10-30', u3: 'bad' }, likes: 3 });
  assert.equal(s.open, false); assert.deepEqual(s.friends, [{ id: 'u2', name: '小菲' }]); assert.deepEqual(s.liked, { u2: '2026-10-30' });
  assert.equal(SO.toggleFriend(s, 'u3', 'C'), true); assert.equal(SO.isFriend(s, 'u3'), true);
  assert.equal(SO.toggleFriend(s, 'u3', 'C'), false);
  assert.equal(SO.canLike(s, 'u2', '2026-10-30'), false); assert.equal(SO.canLike(s, 'u2', '2026-10-31'), true);
  assert.equal(SO.sanitizeSocial(null).open, true, 'homes are open by default');
  assert.equal(SO.today(Date.UTC(2026, 9, 30, 17, 0)), '2026-10-31', 'Taipei date');
});
test('mail is validated and gifts move items safely', () => {
  assert.equal(SO.readMail({ id: 1, from: 'u2', fromName: '小菲', kind: 'note', data: { text: ' 你好‮ ' } }).text, '你好');
  assert.equal(SO.readMail({ id: 2, kind: 'note', data: { text: '   ' } }), null);
  assert.equal(SO.readMail({ id: 3, kind: 'sysgift', data: { item: 'wood', n: 1 } }), null, 'only crops and fish can be gifts');
  assert.equal(SO.readMail({ id: 4, kind: 'sysgift', data: { item: 'pumpkin', n: 500 } }), null);
  assert.equal(SO.readMail({ id: 5, kind: 'sysgift', data: { item: 'fish_tuna', n: 2 } }).n, 2);
  assert.equal(SO.readMail({ id: 5, kind: 'gift', data: { item: 'fish_tuna', n: 2 } }), null, 'player-sent gifts are not valid: only the server issues gifts');
  assert.equal(SO.readMail({ id: 6, kind: 'syssold', from: 'u2', fromName: 'B', data: { item: 'pumpkin', n: 2, price: 300 } }).price, 300);
  assert.equal(SO.readMail({ id: 7, kind: 'syscoop', data: { on: true } }).kind, 'coop');
  assert.equal(SO.readMail({ id: 6, kind: 'hack', data: {} }), null);
  const inv = { pumpkin: 1, wood: 9 };
  assert.equal(SO.takeGift(inv, 'wood'), false);
  assert.equal(SO.takeGift(inv, 'pumpkin'), true); assert.deepEqual(inv, { wood: 9 });
  assert.equal(SO.takeGift(inv, 'pumpkin'), false);
  for (const n of SO.EMOTES) assert.ok(ATLAS[`emote${n}`], `emote${n}`);
});

// ---------- 廣場搶寶 ----------
test('plaza treasure scramble: three join, grab, settle G, fourth and post-settle rejected', () => {
  let rnd = PTY.newParty();
  rnd = PTY.partyJoin(rnd, 'a', '阿派', 0).round;
  rnd = PTY.partyJoin(rnd, 'b', '小菲', 1).round;
  const third = PTY.partyJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true); rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  assert.equal(rnd.order.length, 3);
  const early = PTY.partyGrab(rnd, 'a', PTY.PARTY.spots[0].id, PTY.PARTY.spots[0].x, PTY.PARTY.spots[0].y, 3);
  assert.equal(early.ok, false); assert.equal(early.code, 'not_live');
  const boarded = PTY.partyJoin(rnd, 'd', '路人', 4);
  assert.equal(boarded.ok, true); rnd = boarded.round;
  assert.equal(rnd.status, 'countdown');
  assert.equal(rnd.order.length, 4);
  PTY.maybeExpire(rnd, rnd.startedAt + PTY.PARTY.countdownMs);
  assert.equal(rnd.status, 'live');
  const fourth = PTY.partyJoin(rnd, 'e', '晚到', PTY.PARTY.countdownMs + 1);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, 'party_live');
  const far = PTY.partyGrab(rnd, 'a', PTY.PARTY.spots[0].id, 0, 0, PTY.PARTY.countdownMs + 10);
  assert.equal(far.ok, false); assert.equal(far.code, 'too_far');
  const order = [['a', 0], ['b', 1], ['c', 2], ['a', 3], ['b', 4], ['c', 5]];
  for (const [uid, i] of order) {
    const s = PTY.PARTY.spots[i];
    const r = PTY.partyGrab(rnd, uid, s.id, s.x, s.y, PTY.PARTY.countdownMs + 20 + i);
    assert.equal(r.ok, true, r.msg || r.code);
    rnd = r.round;
  }
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { a: 40, b: 20, c: 10, d: 5 });
  const rec = { gold: 100 };
  assert.equal(PTY.applyPartyGold(rec, 'a', rnd), 40);
  assert.equal(rec.gold, 140);
  assert.equal(PTY.applyPartyGold(rec, 'a', rnd), 0);
  const after = PTY.partyGrab(rnd, 'a', PTY.PARTY.spots[0].id, PTY.PARTY.spots[0].x, PTY.PARTY.spots[0].y, 99);
  assert.equal(after.ok, false);
  assert.equal(after.code, 'party_over');
});
test('plaza scramble countdown: leave below min reopens, full board goes live', () => {
  let rnd = PTY.newParty();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = PTY.partyJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = PTY.partyLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  assert.equal(rnd.startedAt, null);
  rnd = PTY.partyJoin(rnd, 'c', 'C', 2).round;
  assert.equal(rnd.status, 'countdown');
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = PTY.partyJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(PTY.partyJoin(rnd, 'i', 'I', 4).code, 'party_live');
});
test('plaza map exposes the scramble chest and every spot sprite is in ATLAS', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'party');
  assert.ok(sign && sign.x === PTY.JOIN.x && sign.y === PTY.JOIN.y);
  const chest = maps.plaza.objects.find((o) => o.k === PTY.JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(chest && ATLAS[chest.k], 'join chest sprite missing from ATLAS');
  for (const s of PTY.PARTY.spots) {
    assert.ok(ATLAS[s.k], s.k);
    assert.ok(maps.plaza.objects.some((o) => o.k === s.k && o.x === s.x && o.y === s.y), s.id);
    assert.ok(maps.plaza.signs.some((t) => t.action === 'partyGrab' && t.spot === s.id));
  }
});
test('guest sandbox can run a scramble and does not persist gold', async () => {
  const api = createLocalApi();
  const joined = await api.call('party', { act: 'join' });
  assert.equal(joined.party.status, 'live');
  assert.ok(joined.party.players.length >= 3);
  const s = PTY.PARTY.spots[0];
  const grabbed = await api.call('party', { act: 'grab', spot: s.id, x: s.x, y: s.y });
  assert.equal(grabbed.party.status, 'over');
  assert.ok(grabbed.gold > 100);
  assert.ok(grabbed.payout >= 5);
  const gold = (await api.call('load')).me.gold;
  assert.equal(gold, grabbed.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('party', { act: 'grab', spot: s.id, x: s.x, y: s.y }), /結束|party_over/);
});
test('timeout end pays 40/20/10 once, even if next op is join or grab', async () => {
  const t0 = 1000, later = t0 + PTY.PARTY.roundMs;
  const joinPay = createLocalApi();
  const live = await joinPay.call('party', { act: 'join', now: t0 });
  assert.equal(live.party.status, 'live');
  assert.equal(live.party.players[0].id, 'guest');
  const afterJoin = await joinPay.call('party', { act: 'join', now: later });
  assert.equal(afterJoin.gold, 140);
  assert.equal(afterJoin.payout, 40);
  assert.equal((await joinPay.call('party', { act: 'view', now: later + 1 })).gold, 140);

  const grabPay = createLocalApi();
  await grabPay.call('party', { act: 'join', now: t0 });
  const s = PTY.PARTY.spots[0];
  await assert.rejects(
    () => grabPay.call('party', { act: 'grab', spot: s.id, x: s.x, y: s.y, now: later }),
    /結束|party_over/,
  );
  assert.equal((await grabPay.call('load')).me.gold, 140);
  assert.equal((await grabPay.call('party', { act: 'view', now: later + 1 })).gold, 140);

  let rnd = PTY.newParty();
  rnd = PTY.partyJoin(rnd, 'a', 'A', t0).round;
  rnd = PTY.partyJoin(rnd, 'b', 'B', t0).round;
  rnd = PTY.partyJoin(rnd, 'c', 'C', t0).round;
  assert.equal(rnd.status, 'countdown');
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + PTY.PARTY.countdownMs + PTY.PARTY.roundMs;
  PTY.maybeExpire(rnd, end);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { a: 40, b: 20, c: 10 });
  assert.equal(PTY.applyPartyGold(recs.a, 'a', rnd), 40);
  assert.equal(PTY.applyPartyGold(recs.b, 'b', rnd), 20);
  assert.equal(PTY.applyPartyGold(recs.c, 'c', rnd), 10);
  const nxt = PTY.partyJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(PTY.applyPartyGold(recs.a, 'a', nxt.round), 0);
  assert.equal(recs.a.gold, 140);
});

// ---------- 釣魚大賽 ----------
test('fishing contest scores cm, doubles golden, pays 40/20/10 at slot end', () => {
  const noon = at(12), end = at(13);
  let rnd = CT.newContest();
  rnd = CT.contestCatch(rnd, 'a', '阿派', 'sardine', 20, noon).round;
  rnd = CT.contestCatch(rnd, 'b', '小菲', 'golden', 20, noon).round;
  rnd = CT.contestCatch(rnd, 'c', '皮皮', 'tuna', 30, noon).round;
  assert.equal(rnd.players.b.score, 40);
  assert.equal(CT.contestCatch(rnd, 'd', '路人', 'bass', 10, end).code, 'contest_closed');
  CT.maybeExpireContest(rnd, end);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { b: 40, c: 20, a: 10 });
  const rec = { gold: 100 };
  assert.equal(CT.applyContestGold(rec, 'b', rnd), 40);
  assert.equal(rec.gold, 140);
  assert.equal(CT.applyContestGold(rec, 'b', rnd), 0);
  const nxt = CT.contestCatch(rnd, 'e', 'E', 'bass', 15, noon);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.slot, '12-13');
  assert.equal(CT.applyContestGold(rec, 'b', nxt.round), 0);
});
test('plaza map exposes the fishing contest board and sprite is in ATLAS', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'contest');
  assert.ok(sign && sign.x === CT.BOARD.x && sign.y === CT.BOARD.y);
  const board = maps.plaza.objects.find((o) => o.k === CT.BOARD.k && o.x === sign.x && o.y === sign.y);
  assert.ok(board && ATLAS[board.k], 'contest board sprite missing from ATLAS');
});
test('guest sandbox contest pays once and does not persist gold', async () => {
  const noon = at(12), end = at(13);
  const api = createLocalApi();
  let land = null;
  for (let i = 0; i < 16; i++) {
    const c = await api.call('cast', { where: 'sea', now: noon });
    assert.equal(c.contest, true);
    land = await api.call('land', { cast: c.cast, ok: true, now: noon });
    if (land.caught && land.size > 0 && land.board && land.board.players.length) break;
  }
  assert.ok(land && land.board && land.board.players.length >= 1, 'guest should land a scoring fish during the slot');
  const done = await api.call('contest', { now: end });
  assert.equal(done.contest.status, 'over');
  assert.equal(done.gold, 140);
  assert.equal(done.payout, 40);
  assert.equal((await api.call('contest', { now: end + 1 })).gold, 140);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
});

// ---------- 營火捉迷藏 ----------
test('plaza hide-and-seek: three join, first is seeker, hide/check tag, settle G', () => {
  let rnd = SK.newSeek();
  rnd = SK.seekJoin(rnd, 'a', '阿派', 0).round;
  rnd = SK.seekJoin(rnd, 'b', '小菲', 1).round;
  const third = SK.seekJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true); rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  assert.equal(rnd.order.length, 3);
  const early = SK.seekHide(rnd, 'b', SK.SEEK.spots[0].id, SK.SEEK.spots[0].x, SK.SEEK.spots[0].y, 3);
  assert.equal(early.ok, false); assert.equal(early.code, 'not_live');
  const boarded = SK.seekJoin(rnd, 'd', '路人', 4);
  assert.equal(boarded.ok, true); rnd = boarded.round;
  assert.equal(rnd.status, 'countdown');
  SK.maybeExpireSeek(rnd, rnd.startedAt + SK.SEEK.countdownMs);
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.seeker, 'a');
  const fourth = SK.seekJoin(rnd, 'e', '晚到', SK.SEEK.countdownMs + 1);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, 'seek_live');
  assert.equal(SK.seekJoin(rnd, 'a', '阿派', SK.SEEK.countdownMs + 2).code, 'already_in');
  const asSeeker = SK.seekHide(rnd, 'a', SK.SEEK.spots[0].id, SK.SEEK.spots[0].x, SK.SEEK.spots[0].y, SK.SEEK.countdownMs + 10);
  assert.equal(asSeeker.code, 'not_hider');
  const far = SK.seekHide(rnd, 'b', SK.SEEK.spots[0].id, 0, 0, SK.SEEK.countdownMs + 11);
  assert.equal(far.code, 'too_far');
  const s0 = SK.SEEK.spots[0], s1 = SK.SEEK.spots[1];
  assert.equal(SK.seekHide(rnd, 'b', s0.id, s0.x, s0.y, SK.SEEK.countdownMs + 12).ok, true);
  assert.equal(SK.seekHide(rnd, 'b', s0.id, s0.x, s0.y, SK.SEEK.countdownMs + 13).code, 'already_hidden');
  assert.equal(SK.seekHide(rnd, 'c', s0.id, s0.x, s0.y, SK.SEEK.countdownMs + 14).code, 'spot_taken');
  assert.equal(SK.seekHide(rnd, 'c', s1.id, s1.x, s1.y, SK.SEEK.countdownMs + 15).ok, true);
  assert.equal(SK.seekCheck(rnd, 'b', s0.id, s0.x, s0.y, SK.SEEK.countdownMs + 16).code, 'not_seeker');
  assert.equal(SK.seekCheck(rnd, 'a', SK.SEEK.spots[2].id, SK.SEEK.spots[2].x, SK.SEEK.spots[2].y, SK.SEEK.countdownMs + 17).code, 'empty_spot');
  const tagged = SK.seekCheck(rnd, 'a', s0.id, s0.x, s0.y, SK.SEEK.countdownMs + 18);
  assert.equal(tagged.ok, true);
  assert.equal(tagged.found, 'b');
  assert.equal(rnd.seeker, 'b');
  assert.equal(rnd.hidden.b, undefined);
  assert.equal(rnd.hidden.c, s1.id);
  SK.maybeExpireSeek(rnd, rnd.startedAt + SK.SEEK.roundMs);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { c: 40, a: 20, b: 10, d: 5 });
  const rec = { gold: 100 };
  assert.equal(SK.applySeekGold(rec, 'c', rnd), 40);
  assert.equal(rec.gold, 140);
  assert.equal(SK.applySeekGold(rec, 'c', rnd), 0);
  assert.equal(SK.seekHide(rnd, 'c', s1.id, s1.x, s1.y, 99).code, 'seek_over');
});
test('plaza hide-and-seek countdown: leave below min reopens, full board goes live', () => {
  let rnd = SK.newSeek();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = SK.seekJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = SK.seekLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  assert.equal(rnd.startedAt, null);
  rnd = SK.seekJoin(rnd, 'c', 'C', 2).round;
  assert.equal(rnd.status, 'countdown');
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = SK.seekJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(rnd.seeker, 'a');
  assert.equal(SK.seekJoin(rnd, 'i', 'I', 4).code, 'seek_live');
  assert.equal(SK.seekLeave(rnd, 'c', 5).code, 'seek_live');
});
test('plaza map exposes the hide-and-seek log and every spot sprite is in ATLAS', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'seek');
  assert.ok(sign && sign.x === SK.SEEK_JOIN.x && sign.y === SK.SEEK_JOIN.y);
  const log = maps.plaza.objects.find((o) => o.k === SK.SEEK_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(log && ATLAS[log.k], 'join log sprite missing from ATLAS');
  for (const s of SK.SEEK.spots) {
    assert.ok(ATLAS[s.k], s.k);
    assert.ok(maps.plaza.objects.some((o) => o.k === s.k && o.x === s.x && o.y === s.y), s.id);
    assert.ok(maps.plaza.signs.some((t) => t.action === 'seekSpot' && t.spot === s.id));
  }
});
test('guest sandbox hide-and-seek fills bots, guest is seeker, timeout pays once', async () => {
  const t0 = 1000, later = t0 + SK.SEEK.roundMs;
  const api = createLocalApi();
  const joined = await api.call('seek', { act: 'join', now: t0 });
  assert.equal(joined.seek.status, 'live');
  assert.ok(joined.seek.players.length >= 3);
  assert.equal(joined.seek.seeker, 'guest');
  assert.ok(joined.seek.players.filter((p) => p.hidden).length >= 2);
  const s = SK.SEEK.spots[0];
  const found = await api.call('seek', { act: 'check', spot: s.id, x: s.x, y: s.y, now: t0 + 10 });
  assert.equal(found.seek.seeker !== 'guest', true);
  const done = await api.call('seek', { act: 'view', now: later });
  assert.equal(done.seek.status, 'over');
  assert.ok(done.gold > 100);
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('seek', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('seek', { act: 'hide', spot: s.id, x: s.x, y: s.y, now: later + 2 }), /結束|seek_over/);
});
test('timeout end pays remaining hiders first, even if next op is join', () => {
  const t0 = 1000;
  let rnd = SK.newSeek();
  rnd = SK.seekJoin(rnd, 'a', 'A', t0).round;
  rnd = SK.seekJoin(rnd, 'b', 'B', t0).round;
  rnd = SK.seekJoin(rnd, 'c', 'C', t0).round;
  assert.equal(rnd.status, 'countdown');
  SK.maybeExpireSeek(rnd, t0 + SK.SEEK.countdownMs);
  const s0 = SK.SEEK.spots[0];
  assert.equal(SK.seekHide(rnd, 'b', s0.id, s0.x, s0.y, t0 + SK.SEEK.countdownMs + 1).ok, true);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + SK.SEEK.countdownMs + SK.SEEK.roundMs;
  SK.maybeExpireSeek(rnd, end);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { b: 40, a: 20, c: 10 });
  assert.equal(SK.applySeekGold(recs.b, 'b', rnd), 40);
  assert.equal(SK.applySeekGold(recs.a, 'a', rnd), 20);
  assert.equal(SK.applySeekGold(recs.c, 'c', rnd), 10);
  const nxt = SK.seekJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(SK.applySeekGold(recs.b, 'b', nxt.round), 0);
  assert.equal(recs.b.gold, 140);
});

// ---------- 傳南瓜 ----------
test('plaza hot potato: holder passes to the next, short holders rank first, holder ranks last', () => {
  let rnd = HOT.newHot();
  rnd = HOT.hotJoin(rnd, 'a', '阿派', 0).round;
  rnd = HOT.hotJoin(rnd, 'b', '小菲', 1).round;
  const third = HOT.hotJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true); rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  assert.equal(HOT.hotTake(rnd, 'a', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, 3).code, 'not_live');
  rnd = HOT.hotJoin(rnd, 'd', '路人', 4).round;
  const live = rnd.startedAt + HOT.HOT.countdownMs;
  HOT.maybeExpireHot(rnd, live);
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.holder, 'a');
  assert.equal(HOT.hotJoin(rnd, 'e', '晚到', live + 1).code, 'hot_live');
  assert.equal(HOT.hotTake(rnd, 'b', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, live + 10).code, 'not_holder');
  assert.equal(HOT.hotTake(rnd, 'a', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, live + 500).code, 'too_soon');
  assert.equal(HOT.hotTake(rnd, 'a', 0, 0, live + 1300).code, 'too_far');
  const p1 = HOT.hotTake(rnd, 'a', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, live + 1300);
  assert.equal(p1.ok, true); assert.equal(p1.holder, 'b');
  const p2 = HOT.hotTake(rnd, 'b', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, live + 2500);
  assert.equal(p2.ok, true); assert.equal(rnd.holder, 'c');
  HOT.maybeExpireHot(rnd, rnd.startedAt + HOT.HOT.roundMs);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { d: 40, b: 20, a: 10, c: 5 });
  const rec = { gold: 100 };
  assert.equal(HOT.applyHotGold(rec, 'd', rnd), 40);
  assert.equal(rec.gold, 140);
  assert.equal(HOT.applyHotGold(rec, 'd', rnd), 0);
  assert.equal(HOT.hotTake(rnd, 'c', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, 99).code, 'hot_over');
});
test('plaza hot potato countdown: leave below min reopens, full board goes live', () => {
  let rnd = HOT.newHot();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = HOT.hotJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = HOT.hotLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = HOT.hotJoin(rnd, 'c', 'C', 2).round;
  assert.equal(rnd.status, 'countdown');
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = HOT.hotJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(rnd.holder, 'a');
  assert.equal(HOT.hotJoin(rnd, 'i', 'I', 4).code, 'hot_live');
  assert.equal(HOT.hotLeave(rnd, 'c', 5).code, 'hot_live');
});
test('plaza map exposes the hot-potato pumpkin and sprite is in ATLAS', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'hot');
  assert.ok(sign && sign.x === HOT.HOT_JOIN.x && sign.y === HOT.HOT_JOIN.y);
  const pumpkin = maps.plaza.objects.find((o) => o.k === HOT.HOT_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(pumpkin && ATLAS[pumpkin.k], 'pumpkin sprite missing from ATLAS');
});
test('guest sandbox hot potato fills bots, guest passes, bots pass back, timeout pays', async () => {
  const t0 = 1000, later = t0 + HOT.HOT.roundMs;
  const api = createLocalApi();
  const joined = await api.call('hot', { act: 'join', now: t0 });
  assert.equal(joined.hot.status, 'live');
  assert.ok(joined.hot.players.length >= 3);
  assert.equal(joined.hot.holder, 'guest');
  await assert.rejects(() => api.call('hot', { act: 'take', x: HOT.HOT_JOIN.x, y: HOT.HOT_JOIN.y, now: t0 + 10 }), /等一下|too_soon/);
  const took = await api.call('hot', { act: 'take', x: HOT.HOT_JOIN.x, y: HOT.HOT_JOIN.y, now: t0 + 1300 });
  assert.notEqual(took.hot.holder, 'guest');
  const back = await api.call('hot', { act: 'view', now: t0 + 1300 + HOT.HOT.passMs + 900 });
  assert.notEqual(back.hot.holder, took.hot.holder, 'bot passed it on');
  const done = await api.call('hot', { act: 'view', now: later });
  assert.equal(done.hot.status, 'over');
  assert.ok(done.gold > 100);
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('hot', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('hot', { act: 'take', x: HOT.HOT_JOIN.x, y: HOT.HOT_JOIN.y, now: later + 2 }), /結束|hot_over/);
});
test('hot potato timeout pays holder last, even if next op is join', () => {
  const t0 = 1000;
  let rnd = HOT.newHot();
  rnd = HOT.hotJoin(rnd, 'a', 'A', t0).round;
  rnd = HOT.hotJoin(rnd, 'b', 'B', t0).round;
  rnd = HOT.hotJoin(rnd, 'c', 'C', t0).round;
  HOT.maybeExpireHot(rnd, t0 + HOT.HOT.countdownMs);
  assert.equal(HOT.hotTake(rnd, 'a', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, t0 + HOT.HOT.countdownMs + 1300).ok, true);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + HOT.HOT.countdownMs + HOT.HOT.roundMs;
  HOT.maybeExpireHot(rnd, end);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { c: 40, a: 20, b: 10 });
  assert.equal(HOT.applyHotGold(recs.c, 'c', rnd), 40);
  assert.equal(HOT.applyHotGold(recs.a, 'a', rnd), 20);
  assert.equal(HOT.applyHotGold(recs.b, 'b', rnd), 10);
  const nxt = HOT.hotJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(HOT.applyHotGold(recs.c, 'c', nxt.round), 0);
  assert.equal(recs.c.gold, 140);
});

// ---------- 廣場拔河 ----------
test('plaza tug of war: three join, even left odd right, pull, winning side paid', () => {
  let rnd = TG.newTug();
  rnd = TG.tugJoin(rnd, 'a', '阿派', 0).round;
  rnd = TG.tugJoin(rnd, 'b', '小菲', 1).round;
  const third = TG.tugJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true); rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  const L = TG.TUG.spots[0], R = TG.TUG.spots[1];
  const early = TG.tugPull(rnd, 'a', L.id, L.x, L.y, 3);
  assert.equal(early.code, 'not_live');
  TG.maybeExpireTug(rnd, rnd.startedAt + TG.TUG.countdownMs);
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.team.a, 'L');
  assert.equal(rnd.team.b, 'R');
  assert.equal(rnd.team.c, 'L');
  assert.equal(TG.tugJoin(rnd, 'e', '晚到', TG.TUG.countdownMs + 1).code, 'tug_live');
  assert.equal(TG.tugJoin(rnd, 'a', '阿派', TG.TUG.countdownMs + 2).code, 'already_in');
  assert.equal(TG.tugPull(rnd, 'a', R.id, R.x, R.y, TG.TUG.countdownMs + 10).code, 'wrong_side');
  assert.equal(TG.tugPull(rnd, 'a', L.id, 0, 0, TG.TUG.countdownMs + 11).code, 'too_far');
  assert.equal(TG.tugPull(rnd, 'a', L.id, L.x, L.y, TG.TUG.countdownMs + 12).ok, true);
  assert.equal(TG.tugPull(rnd, 'b', R.id, R.x, R.y, TG.TUG.countdownMs + 13).ok, true);
  assert.equal(TG.tugPull(rnd, 'b', R.id, R.x, R.y, TG.TUG.countdownMs + 14).ok, true);
  TG.maybeExpireTug(rnd, rnd.startedAt + TG.TUG.roundMs);
  assert.equal(rnd.status, 'over');
  assert.equal(rnd.winner, 'R');
  assert.deepEqual(rnd.payouts, { b: 40, a: 5, c: 5 });
  const rec = { gold: 100 };
  assert.equal(TG.applyTugGold(rec, 'b', rnd), 40);
  assert.equal(rec.gold, 140);
  assert.equal(TG.applyTugGold(rec, 'b', rnd), 0);
  assert.equal(TG.tugPull(rnd, 'a', L.id, L.x, L.y, 99).code, 'tug_over');
});
test('plaza tug countdown: leave below min reopens, full board goes live', () => {
  let rnd = TG.newTug();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = TG.tugJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = TG.tugLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = TG.tugJoin(rnd, 'c', 'C', 2).round;
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = TG.tugJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(TG.tugJoin(rnd, 'i', 'I', 4).code, 'tug_live');
});
test('plaza map exposes tug hay stakes and sprites are in ATLAS', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'tug');
  assert.ok(sign && sign.x === TG.TUG_JOIN.x && sign.y === TG.TUG_JOIN.y);
  const hay = maps.plaza.objects.find((o) => o.k === TG.TUG_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(hay && ATLAS[hay.k], 'tug join hay missing from ATLAS');
  for (const s of TG.TUG.spots) {
    assert.ok(ATLAS[s.k], s.k);
    assert.ok(maps.plaza.objects.some((o) => o.k === s.k && o.x === s.x && o.y === s.y), s.id);
    assert.ok(maps.plaza.signs.some((t) => t.action === 'tugPull' && t.side === s.id));
  }
});
test('guest sandbox tug fills bots and timeout pays once', async () => {
  const t0 = 1000, later = t0 + TG.TUG.roundMs;
  const api = createLocalApi();
  const joined = await api.call('tug', { act: 'join', now: t0 });
  assert.equal(joined.tug.status, 'live');
  assert.ok(joined.tug.players.length >= 3);
  const side = joined.tug.yourTeam;
  const s = TG.TUG.spots.find((x) => x.id === side);
  const pulled = await api.call('tug', { act: 'pull', side: s.id, x: s.x, y: s.y, now: t0 + 10 });
  assert.ok(pulled.tug.players.find((p) => p.id === 'guest').pulls >= 1);
  const done = await api.call('tug', { act: 'view', now: later });
  assert.equal(done.tug.status, 'over');
  assert.ok(done.gold > 100);
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('tug', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('tug', { act: 'pull', side: s.id, x: s.x, y: s.y, now: later + 2 }), /結束|tug_over/);
});
test('tug timeout pays winning side, even if next op is join', () => {
  const t0 = 1000;
  let rnd = TG.newTug();
  rnd = TG.tugJoin(rnd, 'a', 'A', t0).round;
  rnd = TG.tugJoin(rnd, 'b', 'B', t0).round;
  rnd = TG.tugJoin(rnd, 'c', 'C', t0).round;
  TG.maybeExpireTug(rnd, t0 + TG.TUG.countdownMs);
  const L = TG.TUG.spots[0], R = TG.TUG.spots[1];
  TG.tugPull(rnd, 'a', L.id, L.x, L.y, t0 + TG.TUG.countdownMs + 1);
  TG.tugPull(rnd, 'b', R.id, R.x, R.y, t0 + TG.TUG.countdownMs + 2);
  TG.tugPull(rnd, 'b', R.id, R.x, R.y, t0 + TG.TUG.countdownMs + 3);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + TG.TUG.countdownMs + TG.TUG.roundMs;
  TG.maybeExpireTug(rnd, end);
  assert.equal(rnd.winner, 'R');
  assert.deepEqual(rnd.payouts, { b: 40, a: 5, c: 5 });
  assert.equal(TG.applyTugGold(recs.b, 'b', rnd), 40);
  const nxt = TG.tugJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(TG.applyTugGold(recs.b, 'b', nxt.round), 0);
  assert.equal(recs.b.gold, 140);
});

// ---------- 廣場搬寶 ----------
test('plaza haul: three join, take at barrel drop at cauldron, most deliveries paid', () => {
  let rnd = HL.newHaul();
  rnd = HL.haulJoin(rnd, 'a', '阿派', 0).round;
  rnd = HL.haulJoin(rnd, 'b', '小菲', 1).round;
  const third = HL.haulJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true); rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  const early = HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, 3);
  assert.equal(early.code, 'not_live');
  HL.maybeExpireHaul(rnd, rnd.startedAt + HL.HAUL.countdownMs);
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.holder, null);
  assert.equal(HL.haulJoin(rnd, 'e', '晚到', HL.HAUL.countdownMs + 1).code, 'haul_live');
  assert.equal(HL.haulJoin(rnd, 'a', '阿派', HL.HAUL.countdownMs + 2).code, 'already_in');
  assert.equal(HL.haulDrop(rnd, 'a', HL.HAUL_DROP.x, HL.HAUL_DROP.y, HL.HAUL.countdownMs + 10).code, 'empty_hands');
  assert.equal(HL.haulTake(rnd, 'a', 0, 0, HL.HAUL.countdownMs + 11).code, 'too_far');
  assert.equal(HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, HL.HAUL.countdownMs + 12).ok, true);
  assert.equal(rnd.holder, 'a');
  assert.equal(HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, HL.HAUL.countdownMs + 13).code, 'already_holding');
  assert.equal(HL.haulTake(rnd, 'b', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, HL.HAUL.countdownMs + 14).ok, true);
  assert.equal(rnd.holder, 'b');
  assert.equal(HL.haulDrop(rnd, 'b', 0, 0, HL.HAUL.countdownMs + 15).code, 'too_far');
  assert.equal(HL.haulDrop(rnd, 'b', HL.HAUL_DROP.x, HL.HAUL_DROP.y, HL.HAUL.countdownMs + 16).ok, true);
  assert.equal(rnd.holder, null);
  assert.equal(rnd.scores.b, 1);
  assert.equal(HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, HL.HAUL.countdownMs + 17).ok, true);
  assert.equal(HL.haulDrop(rnd, 'a', HL.HAUL_DROP.x, HL.HAUL_DROP.y, HL.HAUL.countdownMs + 18).ok, true);
  assert.equal(HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, HL.HAUL.countdownMs + 19).ok, true);
  assert.equal(HL.haulDrop(rnd, 'a', HL.HAUL_DROP.x, HL.HAUL_DROP.y, HL.HAUL.countdownMs + 20).ok, true);
  HL.maybeExpireHaul(rnd, rnd.startedAt + HL.HAUL.roundMs);
  assert.equal(rnd.status, 'over');
  assert.deepEqual(rnd.payouts, { a: 40, b: 20, c: 10 });
  const rec = { gold: 100 };
  assert.equal(HL.applyHaulGold(rec, 'a', rnd), 40);
  assert.equal(rec.gold, 140);
  assert.equal(HL.applyHaulGold(rec, 'a', rnd), 0);
  assert.equal(HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, 99).code, 'haul_over');
});
test('plaza haul countdown: leave below min reopens, full board goes live', () => {
  let rnd = HL.newHaul();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = HL.haulJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = HL.haulLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = HL.haulJoin(rnd, 'c', 'C', 2).round;
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = HL.haulJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(HL.haulJoin(rnd, 'i', 'I', 4).code, 'haul_live');
});
test('plaza map exposes haul barrel and cauldron and bulletin names always-on parties', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'haul');
  assert.ok(sign && sign.x === HL.HAUL_JOIN.x && sign.y === HL.HAUL_JOIN.y);
  const barrel = maps.plaza.objects.find((o) => o.k === HL.HAUL_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(barrel && ATLAS[barrel.k], 'haul join barrel missing from ATLAS');
  assert.ok(ATLAS[HL.HAUL_DROP.k]);
  assert.ok(maps.plaza.objects.some((o) => o.k === HL.HAUL_DROP.k && o.x === HL.HAUL_DROP.x && o.y === HL.HAUL_DROP.y));
  assert.ok(maps.plaza.signs.some((t) => t.action === 'haulDrop'));
  const board = maps.plaza.signs.find((s) => s.action === 'events');
  const blob = (board.lines || []).join(' ');
  assert.ok(blob.includes('搶寶') && blob.includes('捉迷藏') && blob.includes('傳南瓜') && blob.includes('拔河') && blob.includes('搬寶') && blob.includes('紅綠燈') && blob.includes('占席') && blob.includes('砸罐') && blob.includes('搶瓶'));
  const west = maps.plaza.signs.find((s) => s.x === 52 && s.y === 126);
  const east = maps.plaza.signs.find((s) => s.x === 428 && s.y === 126);
  const westBlob = (west.lines || []).join(' ');
  const eastBlob = (east.lines || []).join(' ');
  assert.ok(westBlob.includes('搬寶') && westBlob.includes('捉迷藏') && westBlob.includes('傳南瓜') && westBlob.includes('搶寶') && westBlob.includes('紅綠燈'));
  assert.ok(eastBlob.includes('拔河') && eastBlob.includes('搶瓶') && eastBlob.includes('占席') && eastBlob.includes('砸罐'));
  assert.ok(EV.ALWAYS_ON.length >= 9);
  assert.ok(EV.ALWAYS_ON.some((p) => p.name === '廣場搬寶'));
  assert.ok(EV.ALWAYS_ON.some((p) => p.name === '廣場紅綠燈'));
  assert.ok(EV.ALWAYS_ON.some((p) => p.name === '廣場占席'));
  assert.ok(EV.ALWAYS_ON.some((p) => p.name === '廣場砸罐'));
  assert.ok(EV.ALWAYS_ON.some((p) => p.name === '廣場搶瓶'));
  const fountain = maps.plaza.signs.find((s) => s.action === 'wish');
  const seek = maps.plaza.signs.find((s) => s.action === 'seek');
  const show = maps.plaza.signs.find((s) => s.action === 'show');
  for (const p of [HL.HAUL_JOIN, HL.HAUL_DROP]) {
    assert.ok(Math.hypot(p.x - fountain.x, p.y - fountain.y) > 44, 'haul vs fountain');
    assert.ok(Math.hypot(p.x - seek.x, p.y - seek.y) > 44, 'haul vs seek');
    assert.ok(Math.hypot(p.x - show.x, p.y - show.y) > 44, 'haul vs Reggie');
  }
});
test('guest sandbox haul fills bots and timeout pays once', async () => {
  const t0 = 1000, later = t0 + HL.HAUL.roundMs;
  const api = createLocalApi();
  const joined = await api.call('haul', { act: 'join', now: t0 });
  assert.equal(joined.haul.status, 'live');
  assert.ok(joined.haul.players.length >= 3);
  const stolen = await api.call('haul', { act: 'take', x: HL.HAUL_JOIN.x, y: HL.HAUL_JOIN.y, now: t0 + 10 });
  assert.equal(stolen.haul.holder, 'guest');
  const scored = await api.call('haul', { act: 'drop', x: HL.HAUL_DROP.x, y: HL.HAUL_DROP.y, now: t0 + 11 });
  assert.ok(scored.haul.players.find((p) => p.id === 'guest').score >= 1);
  const done = await api.call('haul', { act: 'view', now: later });
  assert.equal(done.haul.status, 'over');
  assert.ok(done.gold > 100);
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('haul', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('haul', { act: 'take', x: HL.HAUL_JOIN.x, y: HL.HAUL_JOIN.y, now: later + 2 }), /結束|haul_over/);
});
test('haul timeout pays deliveries, even if next op is join', () => {
  const t0 = 1000;
  let rnd = HL.newHaul();
  rnd = HL.haulJoin(rnd, 'a', 'A', t0).round;
  rnd = HL.haulJoin(rnd, 'b', 'B', t0).round;
  rnd = HL.haulJoin(rnd, 'c', 'C', t0).round;
  HL.maybeExpireHaul(rnd, t0 + HL.HAUL.countdownMs);
  HL.haulTake(rnd, 'a', HL.HAUL_JOIN.x, HL.HAUL_JOIN.y, t0 + HL.HAUL.countdownMs + 1);
  HL.haulDrop(rnd, 'a', HL.HAUL_DROP.x, HL.HAUL_DROP.y, t0 + HL.HAUL.countdownMs + 2);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + HL.HAUL.countdownMs + HL.HAUL.roundMs;
  HL.maybeExpireHaul(rnd, end);
  assert.deepEqual(rnd.payouts, { a: 40, b: 20, c: 10 });
  assert.equal(HL.applyHaulGold(recs.a, 'a', rnd), 40);
  const nxt = HL.haulJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(HL.applyHaulGold(recs.a, 'a', nxt.round), 0);
  assert.equal(recs.a.gold, 140);
});
test('plaza light: three join, green dash scores, red dash outs, finishers paid', () => {
  let rnd = LT.newLight();
  rnd = LT.lightJoin(rnd, 'a', '阿派', 0).round;
  rnd = LT.lightJoin(rnd, 'b', '小菲', 1).round;
  const third = LT.lightJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true);
  assert.equal(third.round.status, 'countdown');
  rnd = third.round;
  const early = LT.lightDash(rnd, 'a', 'a', LT.LIGHT.spots[0].x, LT.LIGHT.spots[0].y, 3);
  assert.equal(early.code, 'not_live');
  LT.maybeExpireLight(rnd, (rnd.startedAt || 0) + LT.LIGHT.countdownMs);
  assert.equal(rnd.status, 'live');
  assert.equal(LT.lightJoin(rnd, 'e', '晚到', LT.LIGHT.countdownMs + 1).code, 'light_live');
  assert.equal(LT.lightJoin(rnd, 'a', '阿派', LT.LIGHT.countdownMs + 2).code, 'already_in');
  const liveAt = rnd.startedAt;
  const s0 = LT.LIGHT.spots[0];
  assert.equal(LT.lightDash(rnd, 'a', s0.id, 0, 0, liveAt + 10).code, 'too_far');
  assert.equal(LT.lightDash(rnd, 'a', 'c', s0.x, s0.y, liveAt + 11).code, 'wrong_spot');
  assert.equal(LT.lightOf(rnd, liveAt + 10), 'green');
  assert.equal(LT.lightDash(rnd, 'a', s0.id, s0.x, s0.y, liveAt + 12).ok, true);
  assert.equal(rnd.players.a.score, 1);
  const redAt = liveAt + LT.LIGHT.greenMs + 10;
  assert.equal(LT.lightOf(rnd, redAt), 'red');
  const out = LT.lightDash(rnd, 'b', s0.id, s0.x, s0.y, redAt);
  assert.equal(out.ok, true);
  assert.equal(out.out, true);
  assert.equal(!!rnd.out.b, true);
  const green2 = liveAt + LT.LIGHT.greenMs + LT.LIGHT.redMs + 10;
  assert.equal(LT.lightOf(rnd, green2), 'green');
  for (const [uid, from] of [['a', 1], ['c', 0]]) {
    for (let i = from; i < LT.LIGHT.spots.length; i++) {
      const s = LT.LIGHT.spots[i];
      assert.equal(LT.lightDash(rnd, uid, s.id, s.x, s.y, green2 + i).ok, true);
    }
  }
  assert.equal(rnd.status, 'over');
  assert.equal(rnd.payouts.a, 40);
  assert.equal(rnd.payouts.c, 20);
  assert.equal(rnd.payouts.b, 10);
  const rec = { gold: 100 };
  assert.equal(LT.applyLightGold(rec, 'a', rnd), 40);
  assert.equal(LT.applyLightGold(rec, 'a', rnd), 0);
  assert.equal(LT.lightDash(rnd, 'a', s0.id, s0.x, s0.y, 99).code, 'light_over');
});
test('plaza light countdown: leave below min reopens, full board goes live', () => {
  let rnd = LT.newLight();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = LT.lightJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = LT.lightLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = LT.lightJoin(rnd, 'c', 'C', 2).round;
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = LT.lightJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(LT.lightJoin(rnd, 'i', 'I', 4).code, 'light_live');
});
test('plaza map exposes light course on north lawn unique from fountain tug haul', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'light');
  assert.ok(sign && sign.x === LT.LIGHT_JOIN.x && sign.y === LT.LIGHT_JOIN.y);
  const rail = maps.plaza.objects.find((o) => o.k === LT.LIGHT_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(rail && ATLAS[rail.k], 'light join railing missing from ATLAS');
  for (const s of LT.LIGHT.spots) {
    assert.ok(ATLAS[s.k], s.k);
    assert.ok(maps.plaza.objects.some((o) => o.k === s.k && o.x === s.x && o.y === s.y), s.id);
    assert.ok(maps.plaza.signs.some((t) => t.action === 'lightDash' && t.spot === s.id));
  }
  const fountain = maps.plaza.signs.find((s) => s.action === 'wish');
  const tug = maps.plaza.signs.find((s) => s.action === 'tug');
  const pts = [LT.LIGHT_JOIN, ...LT.LIGHT.spots];
  for (const p of pts) {
    assert.ok(Math.hypot(p.x - fountain.x, p.y - fountain.y) > 64, 'light vs fountain');
    assert.ok(Math.hypot(p.x - tug.x, p.y - tug.y) > 48, 'light vs tug');
    assert.ok(Math.hypot(p.x - HL.HAUL_JOIN.x, p.y - HL.HAUL_JOIN.y) > 48, 'light vs haul join');
    assert.ok(Math.hypot(p.x - HL.HAUL_DROP.x, p.y - HL.HAUL_DROP.y) > 48, 'light vs haul drop');
  }
});
test('guest sandbox light fills bots and timeout pays once', async () => {
  const t0 = 1000, later = t0 + LT.LIGHT.roundMs;
  const api = createLocalApi();
  const joined = await api.call('light', { act: 'join', now: t0 });
  assert.equal(joined.light.status, 'live');
  assert.ok(joined.light.players.length >= 3);
  const s0 = LT.LIGHT.spots[0];
  const stepped = await api.call('light', { act: 'dash', spot: s0.id, x: s0.x, y: s0.y, now: t0 + 10 });
  assert.ok(stepped.light.players.find((p) => p.id === 'guest').score >= 1);
  const done = await api.call('light', { act: 'view', now: later });
  assert.equal(done.light.status, 'over');
  assert.ok(done.gold > 100);
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('light', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('light', { act: 'dash', spot: s0.id, x: s0.x, y: s0.y, now: later + 2 }), /結束|light_over/);
});
test('light timeout pays remaining, even if next op is join', () => {
  const t0 = 1000;
  let rnd = LT.newLight();
  rnd = LT.lightJoin(rnd, 'a', 'A', t0).round;
  rnd = LT.lightJoin(rnd, 'b', 'B', t0).round;
  rnd = LT.lightJoin(rnd, 'c', 'C', t0).round;
  LT.maybeExpireLight(rnd, t0 + LT.LIGHT.countdownMs);
  const s0 = LT.LIGHT.spots[0];
  LT.lightDash(rnd, 'a', s0.id, s0.x, s0.y, t0 + LT.LIGHT.countdownMs + 10);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + LT.LIGHT.countdownMs + LT.LIGHT.roundMs;
  LT.maybeExpireLight(rnd, end);
  assert.equal(rnd.status, 'over');
  assert.equal(rnd.payouts.a, 40);
  assert.equal(LT.applyLightGold(recs.a, 'a', rnd), 40);
  const nxt = LT.lightJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(LT.applyLightGold(recs.a, 'a', nxt.round), 0);
  assert.equal(recs.a.gold, 140);
});
test('lightFromPublic is idle-null and matches lightOf while live', () => {
  assert.equal(LT.lightFromPublic(null, 0), null);
  assert.equal(LT.lightFromPublic({ status: 'open' }, 0), null);
  let rnd = LT.newLight();
  rnd = LT.lightJoin(rnd, 'a', 'A', 0).round;
  rnd = LT.lightJoin(rnd, 'b', 'B', 0).round;
  rnd = LT.lightJoin(rnd, 'c', 'C', 0).round;
  LT.maybeExpireLight(rnd, rnd.startedAt + LT.LIGHT.countdownMs);
  const liveAt = rnd.startedAt;
  const pub = LT.lightPublic(rnd, liveAt + 10);
  assert.equal(LT.lightFromPublic(pub, liveAt + 10), 'green');
  assert.equal(LT.lightOf(rnd, liveAt + 10), 'green');
  const redAt = liveAt + LT.LIGHT.greenMs + 10;
  assert.equal(LT.lightFromPublic(pub, redAt), 'red');
  assert.equal(LT.lightOf(rnd, redAt), 'red');
});
test('plaza hill: three join, take credits hold time, longest paid', () => {
  let rnd = HI.newHill();
  rnd = HI.hillJoin(rnd, 'a', '阿派', 0).round;
  rnd = HI.hillJoin(rnd, 'b', '小菲', 1).round;
  const third = HI.hillJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true);
  assert.equal(third.round.status, 'countdown');
  rnd = third.round;
  const early = HI.hillTake(rnd, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, 3);
  assert.equal(early.code, 'not_live');
  HI.maybeExpireHill(rnd, (rnd.startedAt || 0) + HI.HILL.countdownMs);
  assert.equal(rnd.status, 'live');
  assert.equal(HI.hillJoin(rnd, 'e', '晚到', HI.HILL.countdownMs + 1).code, 'hill_live');
  assert.equal(HI.hillJoin(rnd, 'a', '阿派', HI.HILL.countdownMs + 2).code, 'already_in');
  const liveAt = rnd.startedAt;
  assert.equal(HI.hillTake(rnd, 'a', 0, 0, liveAt + 10).code, 'too_far');
  assert.equal(HI.hillTake(rnd, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, liveAt + 12).ok, true);
  assert.equal(rnd.holder, 'a');
  assert.equal(HI.hillTake(rnd, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, liveAt + 13).code, 'already_holding');
  assert.equal(HI.hillTake(rnd, 'b', HI.HILL_JOIN.x, HI.HILL_JOIN.y, liveAt + 112).ok, true);
  assert.equal(rnd.holder, 'b');
  assert.ok((rnd.scores.a | 0) >= 100);
  assert.equal(HI.hillTake(rnd, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, liveAt + 200).ok, true);
  HI.maybeExpireHill(rnd, liveAt + HI.HILL.roundMs);
  assert.equal(rnd.status, 'over');
  assert.equal(rnd.payouts.a, 40);
  assert.equal(rnd.payouts.b, 20);
  assert.equal(rnd.payouts.c, 10);
  const rec = { gold: 100 };
  assert.equal(HI.applyHillGold(rec, 'a', rnd), 40);
  assert.equal(HI.applyHillGold(rec, 'a', rnd), 0);
  assert.equal(HI.hillTake(rnd, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, 99).code, 'hill_over');
});
test('plaza hill countdown: leave below min reopens, full board goes live', () => {
  let rnd = HI.newHill();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = HI.hillJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = HI.hillLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = HI.hillJoin(rnd, 'c', 'C', 2).round;
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = HI.hillJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(HI.hillJoin(rnd, 'i', 'I', 4).code, 'hill_live');
});
test('plaza map exposes hill straw mat unique from fountain haul light', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'hill');
  assert.ok(sign && sign.x === HI.HILL_JOIN.x && sign.y === HI.HILL_JOIN.y);
  const mat = maps.plaza.objects.find((o) => o.k === HI.HILL_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(mat && ATLAS[mat.k], 'hill strawMat missing from ATLAS');
  const fountain = maps.plaza.signs.find((s) => s.action === 'wish');
  const light = maps.plaza.signs.find((s) => s.action === 'light');
  assert.ok(Math.hypot(HI.HILL_JOIN.x - fountain.x, HI.HILL_JOIN.y - fountain.y) > 64, 'hill vs fountain');
  assert.ok(Math.hypot(HI.HILL_JOIN.x - HL.HAUL_DROP.x, HI.HILL_JOIN.y - HL.HAUL_DROP.y) > 48, 'hill vs haul drop');
  assert.ok(Math.hypot(HI.HILL_JOIN.x - light.x, HI.HILL_JOIN.y - light.y) > 48, 'hill vs light join');
});
test('guest sandbox hill fills bots and timeout pays once', async () => {
  const t0 = 1000, later = t0 + HI.HILL.roundMs;
  const api = createLocalApi();
  const joined = await api.call('hill', { act: 'join', now: t0 });
  assert.equal(joined.hill.status, 'live');
  assert.ok(joined.hill.players.length >= 3);
  const stolen = await api.call('hill', { act: 'take', x: HI.HILL_JOIN.x, y: HI.HILL_JOIN.y, now: t0 + 10 });
  assert.equal(stolen.hill.holder, 'guest');
  const done = await api.call('hill', { act: 'view', now: later });
  assert.equal(done.hill.status, 'over');
  assert.ok(done.gold > 100);
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('hill', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('hill', { act: 'take', x: HI.HILL_JOIN.x, y: HI.HILL_JOIN.y, now: later + 2 }), /結束|hill_over/);
});
test('hill timeout pays longest hold, even if next op is join', () => {
  const t0 = 1000;
  let rnd = HI.newHill();
  rnd = HI.hillJoin(rnd, 'a', 'A', t0).round;
  rnd = HI.hillJoin(rnd, 'b', 'B', t0).round;
  rnd = HI.hillJoin(rnd, 'c', 'C', t0).round;
  HI.maybeExpireHill(rnd, t0 + HI.HILL.countdownMs);
  HI.hillTake(rnd, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, t0 + HI.HILL.countdownMs + 1);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + HI.HILL.countdownMs + HI.HILL.roundMs;
  HI.maybeExpireHill(rnd, end);
  assert.deepEqual(rnd.payouts, { a: 40, b: 20, c: 10 });
  assert.equal(HI.applyHillGold(recs.a, 'a', rnd), 40);
  const nxt = HI.hillJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(HI.applyHillGold(recs.a, 'a', nxt.round), 0);
  assert.equal(recs.a.gold, 140);
});
test('plaza smash: three join, up hits score, down misses, most paid', () => {
  let rnd = SM.newSmash();
  rnd = SM.smashJoin(rnd, 'a', '阿派', 0).round;
  rnd = SM.smashJoin(rnd, 'b', '小菲', 1).round;
  const third = SM.smashJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true);
  rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  const early = SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, 3);
  assert.equal(early.code, 'not_live');
  SM.maybeExpireSmash(rnd, rnd.startedAt + SM.SMASH.countdownMs);
  const liveAt = rnd.startedAt;
  assert.equal(rnd.status, 'live');
  assert.equal(SM.smashJoin(rnd, 'e', '晚到', liveAt + 1).code, 'smash_live');
  assert.equal(SM.smashJoin(rnd, 'a', '阿派', liveAt + 2).code, 'already_in');
  assert.equal(SM.smashHit(rnd, 'a', 0, 0, liveAt + 10).code, 'too_far');
  assert.equal(SM.smashUp(rnd, liveAt + 10), true);
  assert.equal(SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, liveAt + 12).ok, true);
  assert.equal(SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, liveAt + 13).code, 'already_hit');
  assert.equal(SM.smashHit(rnd, 'b', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, liveAt + 14).ok, true);
  const downAt = liveAt + SM.SMASH.upMs + 10;
  assert.equal(SM.smashUp(rnd, downAt), false);
  assert.equal(SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, downAt).code, 'not_up');
  const pop1 = liveAt + SM.SMASH.upMs + SM.SMASH.downMs + 10;
  assert.equal(SM.smashUp(rnd, pop1), true);
  assert.equal(SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, pop1).ok, true);
  SM.maybeExpireSmash(rnd, liveAt + SM.SMASH.roundMs);
  assert.equal(rnd.status, 'over');
  assert.equal(rnd.payouts.a, 40);
  assert.equal(rnd.payouts.b, 20);
  assert.equal(rnd.payouts.c, 10);
  assert.equal(SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, 99).code, 'smash_over');
});
test('plaza smash countdown: leave below min reopens, full board goes live', () => {
  let rnd = SM.newSmash();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = SM.smashJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = SM.smashLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = SM.smashJoin(rnd, 'c', 'C', 2).round;
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = SM.smashJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(SM.smashJoin(rnd, 'i', 'I', 4).code, 'smash_live');
});
test('plaza map exposes smash jar unique from contest show fountain', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'smash');
  assert.ok(sign && sign.x === SM.SMASH_JOIN.x && sign.y === SM.SMASH_JOIN.y);
  const jar = maps.plaza.objects.find((o) => o.k === SM.SMASH_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(jar && ATLAS[jar.k], 'smash jarRed missing from ATLAS');
  const fountain = maps.plaza.signs.find((s) => s.action === 'wish');
  const contest = maps.plaza.signs.find((s) => s.action === 'contest');
  const show = maps.plaza.signs.find((s) => s.action === 'show');
  assert.ok(Math.hypot(SM.SMASH_JOIN.x - fountain.x, SM.SMASH_JOIN.y - fountain.y) > 64, 'smash vs fountain');
  assert.ok(Math.hypot(SM.SMASH_JOIN.x - contest.x, SM.SMASH_JOIN.y - contest.y) > 48, 'smash vs contest');
  assert.ok(Math.hypot(SM.SMASH_JOIN.x - show.x, SM.SMASH_JOIN.y - show.y) > 68, 'smash vs show');
});
test('guest sandbox smash fills bots and timeout pays once', async () => {
  const api = createLocalApi();
  const t0 = 5_000_000;
  const joined = await api.call('smash', { act: 'join', now: t0 });
  assert.equal(joined.smash.status, 'live');
  assert.ok(joined.smash.players.length >= 3);
  const hit = await api.call('smash', { act: 'hit', x: SM.SMASH_JOIN.x, y: SM.SMASH_JOIN.y, now: t0 + 10 });
  assert.ok(hit.smash.players.find((p) => p.id === 'guest').score >= 1);
  const later = t0 + SM.SMASH.roundMs + 50;
  const done = await api.call('smash', { act: 'view', now: later });
  assert.equal(done.smash.status, 'over');
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('smash', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('smash', { act: 'hit', x: SM.SMASH_JOIN.x, y: SM.SMASH_JOIN.y, now: later + 2 }), /結束|smash_over/);
});
test('smash timeout pays most hits, even if next op is join', () => {
  const t0 = 1000;
  let rnd = SM.newSmash();
  rnd = SM.smashJoin(rnd, 'a', 'A', t0).round;
  rnd = SM.smashJoin(rnd, 'b', 'B', t0).round;
  rnd = SM.smashJoin(rnd, 'c', 'C', t0).round;
  SM.maybeExpireSmash(rnd, t0 + SM.SMASH.countdownMs);
  SM.smashHit(rnd, 'a', SM.SMASH_JOIN.x, SM.SMASH_JOIN.y, t0 + SM.SMASH.countdownMs + 1);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + SM.SMASH.countdownMs + SM.SMASH.roundMs;
  SM.maybeExpireSmash(rnd, end);
  assert.deepEqual(rnd.payouts, { a: 40, b: 20, c: 10 });
  assert.equal(SM.applySmashGold(recs.a, 'a', rnd), 40);
  const nxt = SM.smashJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(SM.applySmashGold(recs.a, 'a', nxt.round), 0);
  assert.equal(recs.a.gold, 140);
});
test('smashUpFromPublic is visible when idle and matches smashUp while live', () => {
  assert.equal(SM.smashUpFromPublic(null, 0), true);
  assert.equal(SM.smashUpFromPublic({ status: 'open' }, 0), true);
  const jar = maps.plaza.objects.find((o) => o.k === SM.SMASH_JOIN.k && o.x === SM.SMASH_JOIN.x && o.y === SM.SMASH_JOIN.y);
  assert.ok(jar && !jar.hide);
  let rnd = SM.newSmash();
  rnd = SM.smashJoin(rnd, 'a', 'A', 0).round;
  rnd = SM.smashJoin(rnd, 'b', 'B', 0).round;
  rnd = SM.smashJoin(rnd, 'c', 'C', 0).round;
  SM.maybeExpireSmash(rnd, rnd.startedAt + SM.SMASH.countdownMs);
  const liveAt = rnd.startedAt;
  const pub = SM.smashPublic(rnd, liveAt + 10);
  assert.equal(SM.smashUpFromPublic(pub, liveAt + 10), true);
  assert.equal(SM.smashUp(rnd, liveAt + 10), true);
  const downAt = liveAt + SM.SMASH.upMs + 10;
  assert.equal(SM.smashUpFromPublic(pub, downAt), false);
  assert.equal(SM.smashUp(rnd, downAt), false);
});
test('plaza vase: three join, steal from other team, teammate blocked, winners paid', () => {
  let rnd = VA.newVase();
  rnd = VA.vaseJoin(rnd, 'a', '阿派', 0).round;
  rnd = VA.vaseJoin(rnd, 'b', '小菲', 1).round;
  const third = VA.vaseJoin(rnd, 'c', '皮皮', 2);
  assert.equal(third.ok, true);
  rnd = third.round;
  assert.equal(rnd.status, 'countdown');
  const early = VA.vaseTake(rnd, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, 3);
  assert.equal(early.code, 'not_live');
  VA.maybeExpireVase(rnd, rnd.startedAt + VA.VASE.countdownMs);
  const liveAt = rnd.startedAt;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.team.a, 'red');
  assert.equal(rnd.team.b, 'blue');
  assert.equal(rnd.team.c, 'red');
  assert.equal(VA.vaseJoin(rnd, 'e', '晚到', liveAt + 1).code, 'vase_live');
  assert.equal(VA.vaseJoin(rnd, 'a', '阿派', liveAt + 2).code, 'already_in');
  assert.equal(VA.vaseTake(rnd, 'a', 0, 0, liveAt + 10).code, 'too_far');
  assert.equal(VA.vaseTake(rnd, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, liveAt + 12).ok, true);
  assert.equal(VA.vaseTake(rnd, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, liveAt + 13).code, 'already_holding');
  assert.equal(VA.vaseTake(rnd, 'c', VA.VASE_JOIN.x, VA.VASE_JOIN.y, liveAt + 14).code, 'already_ours');
  assert.equal(VA.vaseTake(rnd, 'b', VA.VASE_JOIN.x, VA.VASE_JOIN.y, liveAt + 112).ok, true);
  assert.equal(VA.vaseTake(rnd, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, liveAt + 200).ok, true);
  VA.maybeExpireVase(rnd, liveAt + VA.VASE.roundMs);
  assert.equal(rnd.status, 'over');
  assert.equal(rnd.winner, 'red');
  assert.equal(rnd.payouts.a, 40);
  assert.equal(rnd.payouts.c, 20);
  assert.equal(rnd.payouts.b, 5);
  assert.equal(VA.vaseTake(rnd, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, 99).code, 'vase_over');
});
test('plaza vase countdown: leave below min reopens, full board goes live', () => {
  let rnd = VA.newVase();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) rnd = VA.vaseJoin(rnd, id, name, 0).round;
  assert.equal(rnd.status, 'countdown');
  rnd = VA.vaseLeave(rnd, 'c', 1).round;
  assert.equal(rnd.status, 'open');
  rnd = VA.vaseJoin(rnd, 'c', 'C', 2).round;
  for (const id of ['d', 'e', 'f', 'g', 'h']) rnd = VA.vaseJoin(rnd, id, id.toUpperCase(), 3).round;
  assert.equal(rnd.status, 'live');
  assert.equal(rnd.order.length, 8);
  assert.equal(VA.vaseJoin(rnd, 'i', 'I', 4).code, 'vase_live');
});
test('plaza map exposes vase unique from tug smash show hill haul', () => {
  const sign = maps.plaza.signs.find((s) => s.action === 'vase');
  assert.ok(sign && sign.x === VA.VASE_JOIN.x && sign.y === VA.VASE_JOIN.y);
  const flask = maps.plaza.objects.find((o) => o.k === VA.VASE_JOIN.k && o.x === sign.x && o.y === sign.y);
  assert.ok(flask && ATLAS[flask.k], 'vase sprite missing from ATLAS');
  const tug = maps.plaza.signs.find((s) => s.action === 'tug');
  const smash = maps.plaza.signs.find((s) => s.action === 'smash');
  const show = maps.plaza.signs.find((s) => s.action === 'show');
  const hill = maps.plaza.signs.find((s) => s.action === 'hill');
  const haulDrop = maps.plaza.signs.find((s) => s.action === 'haulDrop');
  const fountain = maps.plaza.signs.find((s) => s.action === 'wish');
  assert.ok(Math.hypot(VA.VASE_JOIN.x - tug.x, VA.VASE_JOIN.y - tug.y) > 48, 'vase vs tug');
  assert.ok(Math.hypot(VA.VASE_JOIN.x - smash.x, VA.VASE_JOIN.y - smash.y) > 48, 'vase vs smash');
  assert.ok(Math.hypot(VA.VASE_JOIN.x - show.x, VA.VASE_JOIN.y - show.y) > 68, 'vase vs show');
  assert.ok(Math.hypot(VA.VASE_JOIN.x - hill.x, VA.VASE_JOIN.y - hill.y) > 48, 'vase vs hill');
  assert.ok(Math.hypot(VA.VASE_JOIN.x - haulDrop.x, VA.VASE_JOIN.y - haulDrop.y) > 48, 'vase vs haul drop');
  assert.ok(Math.hypot(VA.VASE_JOIN.x - fountain.x, VA.VASE_JOIN.y - fountain.y) > 64, 'vase vs fountain');
  assert.ok(maps.plaza.grid.walkable(Math.floor(VA.VASE_JOIN.x / 16), Math.floor(VA.VASE_JOIN.y / 16)), 'vase stands on walkable grass');
});
test('plaza always-on joins unique by hypot > reach_a + reach_b + 8', () => {
  const pts = [
    { n: 'party', x: PTY.JOIN.x, y: PTY.JOIN.y, r: PTY.PARTY.reach },
    { n: 'seek', x: SK.SEEK_JOIN.x, y: SK.SEEK_JOIN.y, r: SK.SEEK.reach },
    { n: 'hot', x: HOT.HOT_JOIN.x, y: HOT.HOT_JOIN.y, r: HOT.HOT.reach },
    { n: 'tug', x: TG.TUG_JOIN.x, y: TG.TUG_JOIN.y, r: TG.TUG.reach },
    ...TG.TUG.spots.map((s) => ({ n: `tug-${s.id}`, x: s.x, y: s.y, r: TG.TUG.reach })),
    { n: 'haul', x: HL.HAUL_JOIN.x, y: HL.HAUL_JOIN.y, r: HL.HAUL.reach },
    { n: 'haulDrop', x: HL.HAUL_DROP.x, y: HL.HAUL_DROP.y, r: HL.HAUL.reach },
    { n: 'light', x: LT.LIGHT_JOIN.x, y: LT.LIGHT_JOIN.y, r: LT.LIGHT.reach },
    ...LT.LIGHT.spots.map((s) => ({ n: `light-${s.id}`, x: s.x, y: s.y, r: LT.LIGHT.reach })),
    { n: 'hill', x: HI.HILL_JOIN.x, y: HI.HILL_JOIN.y, r: HI.HILL.reach },
    { n: 'smash', x: SM.SMASH_JOIN.x, y: SM.SMASH_JOIN.y, r: SM.SMASH.reach },
    { n: 'vase', x: VA.VASE_JOIN.x, y: VA.VASE_JOIN.y, r: VA.VASE.reach },
    { n: 'wish', x: 240, y: 182, r: 36 },
    { n: 'show', x: 389, y: 250, r: 40 },
    { n: 'contest', x: CT.BOARD.x, y: CT.BOARD.y, r: 20 },
  ];
  const fam = (n) => n.split('-')[0];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (fam(pts[i].n) === fam(pts[j].n)) continue;
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      assert.ok(d > pts[i].r + pts[j].r + 8, `${pts[i].n} vs ${pts[j].n} d=${d.toFixed(1)} need > ${pts[i].r + pts[j].r + 8}`);
    }
  }
});
test('guest sandbox vase fills bots and timeout pays once', async () => {
  const api = createLocalApi();
  const t0 = 5_000_000;
  const joined = await api.call('vase', { act: 'join', now: t0 });
  assert.equal(joined.vase.status, 'live');
  assert.ok(joined.vase.players.length >= 3);
  const stolen = await api.call('vase', { act: 'take', x: VA.VASE_JOIN.x, y: VA.VASE_JOIN.y, now: t0 + 10 });
  assert.equal(stolen.vase.holder, 'guest');
  const later = t0 + VA.VASE.roundMs + 50;
  const done = await api.call('vase', { act: 'view', now: later });
  assert.equal(done.vase.status, 'over');
  assert.ok(done.payout >= 5);
  assert.equal((await api.call('vase', { act: 'view', now: later + 1 })).gold, done.gold);
  const fresh = createLocalApi();
  assert.equal((await fresh.call('load')).me.gold, 100);
  await assert.rejects(() => api.call('vase', { act: 'take', x: VA.VASE_JOIN.x, y: VA.VASE_JOIN.y, now: later + 2 }), /結束|vase_over/);
});
test('vase timeout pays winning team, even if next op is join', () => {
  const t0 = 1000;
  let rnd = VA.newVase();
  rnd = VA.vaseJoin(rnd, 'a', 'A', t0).round;
  rnd = VA.vaseJoin(rnd, 'b', 'B', t0).round;
  rnd = VA.vaseJoin(rnd, 'c', 'C', t0).round;
  VA.maybeExpireVase(rnd, t0 + VA.VASE.countdownMs);
  VA.vaseTake(rnd, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, t0 + VA.VASE.countdownMs + 1);
  const recs = { a: { gold: 100 }, b: { gold: 100 }, c: { gold: 100 } };
  const end = t0 + VA.VASE.countdownMs + VA.VASE.roundMs;
  VA.maybeExpireVase(rnd, end);
  assert.equal(rnd.winner, 'red');
  assert.deepEqual(rnd.payouts, { a: 40, c: 20, b: 5 });
  assert.equal(VA.applyVaseGold(recs.a, 'a', rnd), 40);
  const nxt = VA.vaseJoin(rnd, 'd', 'D', end);
  assert.equal(nxt.ok, true);
  assert.equal(nxt.round.status, 'open');
  assert.equal(VA.applyVaseGold(recs.a, 'a', nxt.round), 0);
  assert.equal(recs.a.gold, 140);
});
test('countdownText ticks remaining seconds from startedAt', () => {
  const p = { status: 'countdown', players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], max: 8, countdownMs: 9000, startedAt: 1000 };
  assert.equal(CD.countdownText(p, '開搶，還可以加入。', 1000), '倒數上車（3/8）。9 秒後開搶，還可以加入。');
  assert.equal(CD.countdownText(p, '開搶，還可以加入。', 1000 + 8500), '倒數上車（3/8）。1 秒後開搶，還可以加入。');
  assert.equal(CD.countdownText(p, '開始占席。', 1000 + 9000), '倒數上車（3/8）。0 秒後開始占席。');
});
test('holdSeconds liveLeftSeconds liveScoreSeconds tick from heldAt', () => {
  const p = { status: 'live', holder: 'a', heldAt: 1000, startedAt: 1000, roundMs: 45000, scores: { a: 5000, b: 0 }, teamScore: { red: 5000, blue: 0 }, players: [{ id: 'a', team: 'red' }, { id: 'b', team: 'blue' }] };
  assert.equal(CD.holdSeconds(p, 1000), 0);
  assert.equal(CD.holdSeconds(p, 1000 + 12500), 12);
  assert.equal(CD.liveLeftSeconds(p, 1000), 45);
  assert.equal(CD.liveLeftSeconds(p, 1000 + 44500), 1);
  assert.equal(CD.liveLeftSeconds(p, 1000 + 45000), 0);
  assert.equal(CD.holdSeconds({ status: 'countdown', heldAt: 1000 }, 2000), 0);
  assert.equal(CD.liveScoreSeconds(p, 'a', 1000 + 7000), 12);
  assert.equal(CD.liveScoreSeconds(p, 'b', 1000 + 7000), 0);
  assert.deepEqual(CD.liveTeamSeconds(p, 1000 + 7000), { red: 12, blue: 0 });
});
test('occupancyLine and joinHint show boarders without remaining-seconds', () => {
  assert.equal(EV.occupancyLine(null), '等人中');
  assert.equal(EV.occupancyLine({ status: 'open', players: [], min: 3, max: 8 }), '等人中');
  assert.equal(EV.occupancyLine({ status: 'open', players: [{ id: 'a' }, { id: 'b' }], min: 3, max: 8 }), '等人中 2/3');
  assert.equal(EV.occupancyLine({ status: 'countdown', players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], min: 3, max: 8 }), '倒數上車 3/8');
  assert.equal(EV.occupancyLine({ status: 'live', players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], min: 3, max: 8 }), '進行中 4/8');
  assert.equal(EV.occupancyLine({ status: 'over', players: [{ id: 'a' }], min: 3, max: 8 }), '剛結束');
  const base = 'E 參加搶寶';
  assert.equal(EV.joinHint(base, null, 'z'), base);
  assert.equal(EV.joinHint(base, { status: 'open', players: [{ id: 'a' }, { id: 'b' }], min: 3, max: 8 }, 'z'), 'E 參加搶寶（2/3）');
  assert.equal(EV.joinHint(base, { status: 'countdown', players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], min: 3, max: 8 }, 'z'), 'E 參加搶寶（3/8）倒數中');
  assert.equal(EV.joinHint(base, { status: 'live', players: [{ id: 'a' }, { id: 'z' }], min: 3, max: 8 }, 'z'), null);
  assert.equal(EV.joinHint(base, { status: 'live', players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], min: 3, max: 8 }, 'z'), '進行中（3/8）');
  assert.ok(EV.ALWAYS_ON.every((s) => ['party', 'seek', 'hot', 'tug', 'haul', 'light', 'hill', 'smash', 'vase'].includes(s.id)));
});
test('countdownMark lights join spots only while boarding', () => {
  assert.equal(EV.countdownMark(null, 1, 2), null);
  assert.equal(EV.countdownMark({ status: 'open', players: [{ id: 'a' }] }, 1, 2), null);
  assert.equal(EV.countdownMark({ status: 'live' }, 200, 126), null);
  assert.equal(EV.countdownMark({ status: 'over' }, 200, 126), null);
  assert.deepEqual(EV.countdownMark({ status: 'countdown' }, 200, 126), { x: 200, y: 126, color: 'rgba(255,240,120,.95)' });
});
test('seekLiveMark lights the join log only while live, never hide spots', () => {
  assert.equal(EV.seekLiveMark(null, 140, 214), null);
  assert.equal(EV.seekLiveMark({ status: 'open' }, 140, 214), null);
  assert.equal(EV.seekLiveMark({ status: 'countdown' }, 140, 214), null);
  assert.equal(EV.seekLiveMark({ status: 'over' }, 140, 214), null);
  assert.deepEqual(EV.seekLiveMark({ status: 'live' }, 140, 214), { x: 140, y: 214, color: 'rgba(190,70,210,.95)' });
});
test('seekSpotHint does not spoil hiders to spectators', () => {
  const snap = {
    status: 'live',
    players: [{ id: 'a', seeker: true, hidden: false }, { id: 'b', seeker: false, hidden: true }, { id: 'c', seeker: false, hidden: false }],
    spots: [{ id: 'logW', takenBy: 'b' }, { id: 'rock', takenBy: null }],
  };
  assert.equal(EV.seekSpotHint(null, 'z', 'logW'), null);
  assert.equal(EV.seekSpotHint({ status: 'open' }, 'a', 'logW'), null);
  assert.equal(EV.seekSpotHint(snap, 'z', 'logW'), '進行中');
  assert.equal(EV.seekSpotHint(snap, 'a', 'logW'), 'E 檢查');
  assert.equal(EV.seekSpotHint(snap, 'a', 'rock'), 'E 檢查');
  assert.equal(EV.seekSpotHint(snap, 'b', 'rock'), '你已經藏好了');
  assert.equal(EV.seekSpotHint(snap, 'c', 'logW'), '已經有人了');
  assert.equal(EV.seekSpotHint(snap, 'c', 'rock'), 'E 藏');
});
test('hill hot vase public expose heldAt while live', () => {
  let hill = HI.newHill();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) hill = HI.hillJoin(hill, id, name, 0).round;
  HI.maybeExpireHill(hill, HI.HILL.countdownMs);
  HI.hillTake(hill, 'a', HI.HILL_JOIN.x, HI.HILL_JOIN.y, HI.HILL.countdownMs + 10);
  assert.equal(HI.hillPublic(hill, HI.HILL.countdownMs + 10).heldAt, HI.HILL.countdownMs + 10);
  let hot = HOT.newHot();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) hot = HOT.hotJoin(hot, id, name, 0).round;
  HOT.maybeExpireHot(hot, HOT.HOT.countdownMs);
  assert.equal(HOT.hotPublic(hot, HOT.HOT.countdownMs).heldAt, HOT.HOT.countdownMs);
  HOT.hotTake(hot, 'a', HOT.HOT_JOIN.x, HOT.HOT_JOIN.y, HOT.HOT.countdownMs + 1300);
  assert.equal(HOT.hotPublic(hot, HOT.HOT.countdownMs + 1300).heldAt, HOT.HOT.countdownMs + 1300);
  let vase = VA.newVase();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) vase = VA.vaseJoin(vase, id, name, 0).round;
  VA.maybeExpireVase(vase, VA.VASE.countdownMs);
  VA.vaseTake(vase, 'a', VA.VASE_JOIN.x, VA.VASE_JOIN.y, VA.VASE.countdownMs + 5);
  assert.equal(VA.vasePublic(vase, VA.VASE.countdownMs + 5).heldAt, VA.VASE.countdownMs + 5);
});

// ---------- 派派大作戰 ----------
const AR = await import('../site/games/community/pie-plaza/src/game/arena.js');
test('arena: field is enclosed for spectators, desk reachable, standings share ranks', () => {
  const m = maps.arena;
  const [x0, y0, x1, y1] = AR.ARENA.field;
  assert.equal(AR.cellOf(x0 + 1, y0 + 1), 0);
  assert.equal(AR.cellOf(x1 - 1, y1 - 1), AR.ARENA.cols * AR.ARENA.rows - 1);
  assert.ok(AR.inField(240, 150) && !AR.inField(240, 262));
  const desk = m.signs.find((t) => t.action === 'arenaDesk');
  assert.ok(desk && AR.nearDesk(desk.x, desk.y));
  const s = AR.standings([{ id: 'a', total: 5 }, { id: 'b', total: 9 }, { id: 'c', total: 5 }]);
  assert.deepEqual(s.map((p) => [p.id, p.rank]), [['b', 1], ['a', 2], ['c', 2]]);
  const p = AR.unpackPlayer(['npc:sam', '山姆', 10, 20, 3, 1 | 2, 4, 9, 2, 'villager3', 7]);
  assert.ok(p.bot && p.stunned && !p.out && p.sprite === 'villager3' && p.gain === 7);
  assert.deepEqual(AR.throwDir(3), [1, 0]);
  const [dx, dy] = AR.throwDir(0, 1, 1); assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-9);
});

test('boss: Taipei time label and images listed', async () => {
  const B = await import('../site/games/community/pie-plaza/src/ui/boss.js').catch(() => null);
  if (!B) return;                      // ui/boss.js 需要 DOM 時略過
  assert.equal(B.hhmmTaipei(Date.UTC(2027, 0, 15, 4, 30)), '12:30');
  assert.equal(B.BOSS_IMAGES.length, 5);
});

test('arena quiz quadrants match the server and centers sit inside each quadrant', () => {
  const qs = Array.from({ length: AR.ARENA.cols * AR.ARENA.rows }, (_, i) => AR.quadrant(i));
  assert.equal(qs.filter((q) => q === -1).length, AR.ARENA.rows);
  for (let q = 0; q < 4; q++) {
    const [cx, cy] = AR.quadrantCenter(q);
    assert.equal(AR.quadrant(AR.cellOf(cx, cy)), q, `center of ${q}`);
  }
});
