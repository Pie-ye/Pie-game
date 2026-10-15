import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, BIOMES } from '../site/games/community/pie-peak/src/worldgen.js';
import { Game } from '../site/games/community/pie-peak/src/game.js';
import { Vitals } from '../site/games/community/pie-peak/src/status.js';
import { ITEMS, LOOT, RARE } from '../site/games/community/pie-peak/src/items.js';
import { PLAYER } from '../site/games/community/pie-peak/src/solids.js';

const SEED = 20261015;
const idle = { ix: 0, iy: 0, jump: false, grab: false, run: false, use: false, camYaw: 0 };
const step = (g, input, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) { g.update(1 / 60, input); g.events.length = 0; } };

test('world generation is deterministic and complete', () => {
  const a = generate(SEED), b = generate(SEED), c = generate(SEED + 1);
  assert.equal(a.world.boxes.length, b.world.boxes.length);
  assert.deepEqual(a.luggage.map((l) => l.loot), b.luggage.map((l) => l.loot));
  assert.notDeepEqual(a.luggage.map((l) => l.loot), c.luggage.map((l) => l.loot));
  assert.equal(a.biomes.length, 4);
  assert.equal(a.tiers.length, 20);
  assert.equal(a.shrines.length, 4);
  assert.ok(a.summit && a.summit.y > 150);
  assert.ok(a.luggage.length >= 40 && a.hazards.length >= 20);
  for (const t of a.tiers) assert.ok(t.y1 > t.y0 + 7);
});

test('every luggage and loose item rests on solid ground', () => {
  for (const seed of [SEED, 1, 77, 424242]) {
    const L = generate(seed);
    for (const l of L.luggage) assert.ok(L.world.groundBelow(l.x, l.y + 0.05, l.z, 0.1, 1), `luggage floating at ${l.x},${l.y},${l.z} seed ${seed}`);
    for (const it of L.items) assert.ok(L.world.groundBelow(it.x, it.y + 0.05, it.z, 0.1, 1), `item ${it.id} floating at ${it.x},${it.y},${it.z} seed ${seed}`);
  }
});

test('item catalogue is consistent', () => {
  const ids = Object.keys(ITEMS);
  assert.ok(ids.length >= 36, `only ${ids.length} items`);
  for (const [id, it] of Object.entries(ITEMS)) { assert.ok(it.name && it.desc && it.model && typeof it.use === 'function', id); assert.ok(it.weight >= 0); }
  for (const table of [...Object.values(LOOT), RARE]) for (const [id, w] of table) { assert.ok(ITEMS[id], `loot references unknown ${id}`); assert.ok(w > 0); }
  const reachable = new Set([...Object.values(LOOT).flat().map((e) => e[0]), ...RARE.map((e) => e[0])]);
  for (const id of ids) assert.ok(reachable.has(id), `${id} never drops`);
});

test('afflictions shrink the stamina cap and zero cap means down', () => {
  const v = new Vitals();
  assert.equal(v.cap, 100);
  v.add('injury', 30); v.add('hunger', 20); v.setWeight(5);
  assert.equal(v.cap, 45);
  v.restore(100); assert.equal(v.stamina, 45);
  v.add('cold', 100); assert.ok(v.down);
  v.clearAll(); assert.ok(v.cap > 90);
  assert.equal(new Vitals().fallDamage(5), 0); assert.ok(new Vitals().fallDamage(20) > 20);
});

test('player lands on the beach and falls with damage from height', () => {
  const g = new Game(SEED);
  step(g, idle, 1);
  assert.equal(g.player.state, 'ground');
  assert.ok(Math.abs(g.player.y) < 0.05);
  const before = g.v.aff.injury;
  Object.assign(g.player, { y: 14, state: 'air', fallPeak: 14, x: 0, z: 20 });
  step(g, idle, 2);
  assert.equal(g.player.state, 'ground');
  assert.ok(g.v.aff.injury > before + 10, 'fall damage applied');
});

// A scripted climber: stands in front of tier wall column x, holds grab + up until it stands on the top plateau.
function climbTier(g, tier, x, maxSeconds = 40) {
  const p = g.player, input = { ...idle, grab: true, iy: 1 };
  Object.assign(p, { x, y: tier.y0 + 0.01, z: tier.zFront + 1.2, vx: 0, vy: 0, vz: 0, state: 'air', fallPeak: tier.y0 });
  g.v.grant('infinite', 999);
  // approach the wall
  for (let i = 0; i < 60 * maxSeconds; i++) {
    if (i % 30 === 0 && g.v.cap < 60) g.v.clearAll();
    if (g.mode !== 'play') { g.v.clearAll(); g.mode = 'play'; p.state = 'air'; }
    g.update(1 / 60, input); g.events.length = 0;
    if (p.state === 'ground' && p.y > tier.y1 - 0.2) return true;
    if (p.state === 'faint') return false;
  }
  return false;
}
function freeColumn(L, tier) {
  // x positions on the wall where no ledge/overhang sits above the start and the surface is plain rock/sand
  const sections = L.world.boxes.filter((b) => b.section !== undefined && b.z1 === tier.zFront && Math.abs(b.y1 - tier.y1) < 1e-6);
  const blockers = L.world.boxes.filter((b) => (b.ledge || b.overhang || b.kind === 'ladder') && Math.abs(b.z0 - tier.zFront) < 1e-6 && b.y0 > tier.y0 - 1 && b.y1 < tier.y1 + 1);
  for (let x = tier.cx - 16; x <= tier.cx + 16; x += 0.5) {
    const s = sections.find((b) => x > b.x0 + 0.5 && x < b.x1 - 0.5);
    if (!s || ['lava', 'ice', 'fragile'].includes(s.kind)) continue;
    if (blockers.some((b) => b.kind !== 'ladder' && x > b.x0 - 0.6 && x < b.x1 + 0.6)) continue;
    if (L.world.boxes.some((b) => b.fragile && x > b.x0 - 0.6 && x < b.x1 + 0.6 && b.y0 > tier.y0 && b.y1 < tier.y1)) continue;
    return x;
  }
  return null;
}

test('every tier can be free-climbed straight up a clear column', () => {
  const g = new Game(SEED);
  const failures = [];
  for (const tier of g.level.tiers) {
    const x = freeColumn(g.level, tier);
    if (x === null) { failures.push(`tier ${tier.index}: no free column`); continue; }
    if (!climbTier(g, tier, x)) failures.push(`tier ${tier.index} at x=${x.toFixed(1)} stuck at y=${g.player.y.toFixed(1)} state=${g.player.state}`);
  }
  assert.deepEqual(failures, []);
});

test('hanging costs stamina; running out drops the climber', () => {
  const g = new Game(SEED);
  const tier = g.level.tiers[0], x = freeColumn(g.level, tier);
  Object.assign(g.player, { x, y: 0.01, z: tier.zFront + 0.5, state: 'air' });
  step(g, { ...idle, grab: true, iy: 1 }, 1);
  assert.equal(g.player.state, 'climb');
  const s0 = g.v.stamina; step(g, { ...idle, grab: true, iy: 1 }, 1);
  assert.ok(g.v.stamina < s0 - 3, 'climbing drains stamina');
  g.v.stamina = 0.5; step(g, { ...idle, grab: true, iy: 0 }, 1);
  assert.notEqual(g.player.state, 'climb');
});

test('items apply their effects', () => {
  const g = new Game(SEED);
  g.v.add('hunger', 30); g.v.add('injury', 40);
  g.slots = [{ id: 'snack_pack', charges: 0 }, { id: 'first_aid', charges: 0 }, { id: 'energy_drink', charges: 0 }];
  g.use(0); assert.ok(g.v.aff.hunger < 20);
  g.use(1); assert.ok(g.v.aff.injury < 0.1 + 0);
  g.use(2); assert.ok(g.v.has('boost') && g.v.has('fast'));
  assert.equal(g.slots.filter(Boolean).length, 0);
  // revive star rescues a faint
  g.slots = [{ id: 'revive_star', charges: 0 }];
  g.v.add('injury', 100); g.update(1 / 60, idle); g.update(1 / 60, idle);
  assert.equal(g.mode, 'play'); assert.equal(g.slots.filter(Boolean).length, 0); assert.ok(g.v.cap > 20);
});

test('fainting without a revive star ends the run and a shrine respawn restores play', () => {
  const g = new Game(SEED);
  g.slots = [];
  g.v.add('injury', 100); step(g, idle, 0.2);
  assert.equal(g.mode, 'over');
  g.respawn(); assert.equal(g.mode, 'play'); assert.ok(!g.v.down);
});

test('luggage opens and gives loot, the bag has limited slots', () => {
  const g = new Game(SEED);
  const l = g.luggage[0];
  Object.assign(g.player, { x: l.x, y: l.y, z: l.z + 0.6, state: 'air' });
  step(g, idle, 0.5);
  const input = { ...idle, use: true };
  step(g, input, 1.4);
  assert.ok(l.opened);
  assert.ok(g.slots.filter(Boolean).length >= 2);
  g.slots = Array.from({ length: g.capacity }, () => ({ id: 'apple', charges: 0 }));
  assert.equal(g.give('banana'), false);
});

test('shrine heals, checkpoints and the grapple pulls the player up a wall', () => {
  const g = new Game(SEED);
  const sh = g.shrines[0];
  Object.assign(g.player, { x: sh.x, y: sh.y, z: sh.z, state: 'air' });
  g.v.add('injury', 50); step(g, idle, 0.5);
  step(g, { ...idle, use: true }, 0.3);
  assert.ok(sh.used); assert.ok(g.v.aff.injury < 20); assert.equal(g.checkpoint.name, sh.name);
  const g2 = new Game(SEED); g2.give('grapple_gun');
  const tier = g2.level.tiers[0];
  Object.assign(g2.player, { x: tier.cx, y: 0, z: 2, state: 'ground' }); step(g2, idle, 0.3);
  g2.aim = { ox: tier.cx, oy: 1.5, oz: 2, dx: 0, dy: 0.45, dz: -0.9 };
  assert.ok(g2.use(g2.slots.findIndex((s) => s && s.id === 'grapple_gun')));
  step(g2, idle, 1.2);
  assert.ok(g2.player.y > 1.5, `grapple height ${g2.player.y}`);
});

test('overhang: the climber hangs under the slab and shimmies out onto its top', () => {
  const g = new Game(SEED);
  const tier = g.level.tiers.find((t) => t.overhang), o = tier.overhang;
  g.v.grant('infinite', 999);
  Object.assign(g.player, { x: o.x, y: o.y - 3, z: tier.zFront + 0.6, state: 'air', fallPeak: o.y - 3 });
  let sawCeiling = false, top = false;
  for (let i = 0; i < 60 * 30 && !top; i++) {
    const p = g.player;
    g.update(1 / 60, { ...idle, grab: true, iy: p.state === 'ceiling' ? -1 : 1 }); g.events.length = 0;
    if (p.state === 'ceiling') sawCeiling = true;
    if (p.state === 'ground' && p.y > o.y + 0.5) top = true;
  }
  assert.ok(sawCeiling, 'hung from the ceiling'); assert.ok(top, 'reached the top of the overhang');
});

test('vines can be climbed hand over hand to the platform above', () => {
  const g = new Game(SEED);
  const pole = g.level.world.poles.find((p) => p.kind === 'vine');
  g.v.grant('infinite', 999);
  Object.assign(g.player, { x: pole.x, y: pole.y0, z: pole.z + 0.6, state: 'air', fallPeak: pole.y0 });
  let sawPole = false;
  for (let i = 0; i < 60 * 25; i++) { g.update(1 / 60, { ...idle, grab: true, iy: 1 }); g.events.length = 0; if (g.player.state === 'pole') sawPole = true; if (g.player.state === 'ground' && g.player.y > pole.y1 - 1) break; }
  assert.ok(sawPole); assert.equal(g.player.state, 'ground'); assert.ok(g.player.y > pole.y1 - 1);
});

test('hazards: boulders, geysers, flytraps and cold actually hurt or move the player', () => {
  const hit = (g, secs, f) => { for (let i = 0; i < secs * 60; i++) { g.update(1 / 60, f(i)); g.events.length = 0; } };
  { // a boulder rolls off the plateau and strikes a climber below
    const g = new Game(SEED), h = g.hazards.find((x) => x.type === 'boulder'), t = g.tierAt(h);
    Object.assign(g.player, { x: t.cx, y: t.y0 + 3, z: t.zFront + 0.35, state: 'air', fallPeak: t.y0 + 3 }); g.v.grant('infinite', 99);
    hit(g, 14, () => ({ ...idle, grab: true, iy: 0.02 }));
    assert.ok(g.v.aff.injury > 5, 'boulder injury');
  }
  { // a geyser throws the player upward
    const g = new Game(SEED), h = g.hazards.find((x) => x.type === 'geyser'); let maxY = 0;
    Object.assign(g.player, { x: h.x, y: h.y, z: h.z, state: 'air' });
    hit(g, 12, () => { maxY = Math.max(maxY, g.player.y); return idle; });
    assert.ok(maxY - h.y > 3, `geyser lift ${maxY - h.y}`);
  }
  { // flytrap bites
    const g = new Game(SEED), h = g.hazards.find((x) => x.type === 'flytrap');
    Object.assign(g.player, { x: h.x, y: h.y, z: h.z + 1.2, state: 'air' });
    hit(g, 1.5, () => idle);
    assert.ok(g.v.aff.injury > 3);
    const g2 = new Game(SEED), h2 = g2.hazards.find((x) => x.type === 'flytrap'); h2.asleep = 20;
    Object.assign(g2.player, { x: h2.x, y: h2.y, z: h2.z + 1.2, state: 'air' }); hit(g2, 1.5, () => idle);
    assert.ok(g2.v.aff.injury < 1, 'sleeping flytrap is harmless');
  }
  { // alpine exposure builds cold, a heat pack stops it
    const g = new Game(SEED), t = g.level.tiers.find((x) => x.bi === 2);
    Object.assign(g.player, { x: t.cx, y: t.y1, z: t.zBack + 4, state: 'air' });
    hit(g, 60, () => idle); assert.ok(g.v.aff.cold > 15, `cold ${g.v.aff.cold}`);
    g.give('heat_pack'); g.use(g.slots.findIndex((s) => s && s.id === 'heat_pack'));
    const before = g.v.aff.cold; hit(g, 20, () => idle); assert.ok(g.v.aff.cold <= before);
  }
});

test('items: rope, glider, dynamite and bedroll do what they say', () => {
  const g = new Game(SEED), t = g.level.tiers[0];
  const use = (id) => g.use(g.slots.findIndex((s) => s && s.id === id));
  const run = (secs, f = idle) => { for (let i = 0; i < secs * 60; i++) { g.update(1 / 60, f); g.events.length = 0; } };
  g.give('rope_spool'); Object.assign(g.player, { x: t.cx, y: t.y1, z: t.zBack + 4, state: 'air' }); run(1);
  assert.ok(use('rope_spool')); assert.equal(g.ropes.length, 1); assert.ok(g.ropes[0].y1 - g.ropes[0].y0 > 5);
  g.give('glider_umbrella'); Object.assign(g.player, { x: t.cx, y: t.y1 + 25, z: t.zFront + 6, state: 'air', vy: 0, fallPeak: t.y1 + 25 }); run(0.6);
  assert.ok(use('glider_umbrella')); let minVy = 0; for (let i = 0; i < 180; i++) { g.update(1 / 60, idle); minVy = Math.min(minVy, g.player.vy); g.events.length = 0; }
  assert.ok(minVy > -3, `gliding fall speed ${minVy}`); assert.equal(g.player.state, 'glide');
  const g2 = new Game(SEED), vt = g2.level.tiers.find((x) => x.rubble !== undefined), boxes = g2.world.boxes.filter((b) => b.rubble);
  g2.give('dynamite'); Object.assign(g2.player, { x: vt.rubble, y: vt.y1, z: vt.zBack + 6.5, state: 'air', yaw: Math.PI });
  for (let i = 0; i < 60; i++) { g2.update(1 / 60, idle); g2.events.length = 0; }
  assert.ok(g2.use(g2.slots.findIndex((s) => s && s.id === 'dynamite')));
  for (let i = 0; i < 240; i++) { g2.update(1 / 60, idle); g2.events.length = 0; }
  assert.ok(boxes.some((b) => !b.solid), 'rubble blown open');
  const g3 = new Game(SEED); g3.give('bedroll'); g3.v.add('injury', 30); g3.v.stamina = 5; for (let i = 0; i < 30; i++) { g3.update(1 / 60, idle); g3.events.length = 0; }
  assert.ok(g3.use(g3.slots.findIndex((s) => s && s.id === 'bedroll'))); for (let i = 0; i < 400; i++) { g3.update(1 / 60, idle); g3.events.length = 0; }
  assert.ok(g3.v.stamina > 50 && g3.v.aff.injury < 20);
});

test('different characters carry different modifiers', () => {
  const a = new Game(SEED, { character: 'phoebe' }), b = new Game(SEED, { character: 'fluorolo' });
  assert.ok(a.mods.climb < b.mods.climb); assert.ok(b.mods.cold < a.mods.cold);
});
