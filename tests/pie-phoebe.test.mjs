import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {} };
const { Game } = await import('../site/games/community/pie-phoebe/src/game.js');
const { spawnTable, WEAPONS } = await import('../site/games/community/pie-phoebe/src/data.js');

function game() {
  const g = Object.create(Game.prototype);
  g.ui = { setSlots() {}, banner() {}, end() {}, hideScreen() {}, showHud() {}, levelup() {} };
  g.camPos = {}; g.grid = new Map(); g.input = { x: 0, z: 0 }; g.clock = 0;
  g.newRun(); g.mode = 'play';
  return g;
}

test('new enemies enter the pool gradually', () => {
  assert.deepEqual(spawnTable(0), [['hum', 10]]);
  for (const [key, time] of [['charger',75], ['fan',145], ['mortar',225], ['splitter',300]]) {
    assert.ok(!spawnTable(time - 1).some(([k]) => k === key));
    assert.ok(spawnTable(time).some(([k]) => k === key));
  }
});

test('charge locks direction and gives time to sidestep', () => {
  const g = game(); const e = g.makeEnemy('charger', -5, 0);
  e.atkT = 0; g.updateEnemies(0.01);
  assert.equal(e.state, 2); assert.equal(e.x, -5);
  g.p.z = 4; g.updateEnemies(0.5);
  assert.equal(e.x, -5); assert.equal(e.cdz, 0);
  g.updateEnemies(0.5); g.updateEnemies(0.1);
  assert.ok(e.x > -5); assert.equal(e.z, 0);
});

test('blast damage waits for warning, hits once, and can be dodged', () => {
  const g = game(); const e = g.makeEnemy('mortar', 4, 4);
  g.warnBlast(e, 0, 0); g.updateHazards(1);
  assert.equal(g.p.hp, 100);
  g.updateHazards(0.3); assert.equal(g.p.hp, 89);
  g.p.inv = 0; g.updateHazards(0.1); assert.equal(g.p.hp, 89);
  g.warnBlast(e, 0, 0); g.p.x = 4; g.updateHazards(1.3);
  assert.equal(g.p.hp, 89);
});

test('fan enemy fires a spread, splitter creates three children only once', () => {
  const g = game(); const fan = g.makeEnemy('fan', 6, 0);
  fan.shootT = 0; g.updateEnemies(0.01);
  assert.equal(g.eshots.length, 5);
  assert.ok(new Set(g.eshots.map((s) => s.vz)).size > 1);
  const split = g.makeEnemy('splitter', 2, 2); g.kill(split); g.kill(split);
  assert.equal(g.enemies.filter((e) => e.type === 'bat').length, 3);
});

test('boss ring has a safe gap and no bullets before the warning finishes', () => {
  const g = game(); const e = g.makeEnemy('boss', -6, 0);
  Object.assign(e, { rank: 2, pattern: 0, atkT: 0 });
  g.updateEnemies(0.01); assert.equal(e.state, 4); assert.equal(g.eshots.length, 0);
  g.updateEnemies(1.3); assert.equal(g.eshots.length, 22);
  for (const s of g.eshots) assert.ok(Math.abs(Math.atan2(s.vz, s.vx)) >= 0.57);
});

test('chain synergy adds two distinct targets and frozen targets take bonus beam damage', () => {
  const g = game(); g.weapons = { chain: 3, star: 3 };
  for (let i = 0; i < 8; i++) g.makeEnemy('golem', 1 + i, 0);
  const hits = []; g.hurt = (e, dmg) => hits.push({ id: e.id, dmg });
  g.cd.chain = 0; g.updateNewWeapons(0.01);
  assert.equal(hits.length, 6); assert.equal(new Set(hits.map((h) => h.id)).size, 6);
  g.weapons = { frost: 3, litany: 3 };
  g.enemies = [g.enemies[0]]; g.enemies[0].slowT = 2;
  hits.length = 0; g.fireBeam(0, 1, 100); assert.equal(hits[0].dmg, 160);
});

test('frost slows bosses without stunning and trail requires movement', () => {
  const g = game(); const boss = g.makeEnemy('boss', 3, 0);
  g.weapons = { frost: 3, trail: 3 }; g.cd.frost = 0;
  g.buildGrid(); g.updateNewWeapons(0.01);
  assert.equal(boss.stun, 0); assert.equal(boss.slowMul, 0.8);
  assert.equal(g.trails.length, 0);
  g.p.moving = true; g.updateNewWeapons(0.01); assert.equal(g.trails.length, 1);
  g.p.moving = false; g.petSkills.slide = 3; g.pet.slide = 0.5;
  g.updateNewWeapons(0.01); assert.equal(g.trails.length, 2);
  assert.equal(g.trails[1].dmg, g.trails[0].dmg * 1.5);
});

test('reflected bullets cannot damage the player later in the same frame', () => {
  const g = game(); g.eshots.push({ x: 0, z: 0, vx: 0, vz: 0, life: 2, dmg: 50, dead: true });
  g.updateShots(0.01); assert.equal(g.p.hp, 100); assert.equal(g.eshots.length, 0);
});

test('normal mode spawns three bosses and requires their defeat to win', () => {
  const g = game(); g.spawnAcc = -10000;
  for (const t of [180, 360, 540]) { g.t = t; g.spawnTick(0); }
  g.t = 720; g.spawnTick(0); assert.equal(g.bossIdx, 3);
  g.update(0.01); assert.notEqual(g.mode, 'win');
  for (const e of g.enemies.filter((e) => e.boss)) g.kill(e);
  g.pending = 0; g.update(0.01); assert.equal(g.mode, 'win');
  g.continueEndless(); g.spawnTick(0); assert.equal(g.bossIdx, 4);
});

test('restart clears new mechanics and upgrade pool respects the five weapon limit', () => {
  const g = game(); g.hazards.push({}); g.trails.push({}); g.bossKills = 3;
  g.newRun(); assert.equal(g.hazards.length + g.trails.length + g.bossKills, 0);
  g.weapons = { star: 1, chain: 1, frost: 1, trail: 1, ring: 1 };
  for (let i = 0; i < 50; i++) {
    for (const c of g.makeCards()) if (c.type === 'weapon') assert.ok(g.weapons[c.key]);
  }
  for (const w of Object.values(WEAPONS)) assert.equal(w.lv.length, w.max + 1);
});
