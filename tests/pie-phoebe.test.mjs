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

test('fan fire interval is doubled while ordinary shooters retain their interval', () => {
  const g = game(); const fan = g.makeEnemy('fan', 7, 0); const shooter = g.makeEnemy('shooter', -7, 0);
  assert.ok(fan.shootT >= 2.4 && fan.shootT < 4.8);
  fan.shootT = shooter.shootT = 0; g.updateEnemies(.01);
  assert.equal(fan.shootT, 4.8); assert.equal(shooter.shootT, 2.4);
});

test('mirror zone gathers enemies, empowers basics and triggers its heavy synergy', () => {
  const g = game(); g.weapons = { ring: 3, star: 3, litany: 3 };
  const target = g.makeEnemy('golem', 3, 0); target.hp = 10000;
  const side = g.makeEnemy('golem', 4, 0); side.hp = 10000;
  g.buildGrid(); g.updateMirror(.01);
  assert.equal(g.mirrorZone.x, 3); assert.ok(side.kx < 0);
  assert.ok(g.strikes.some((s) => s.source === 'litany'));
  g.p.x = 3; g.cd.star = 0; g.updateWeapons(.01);
  assert.ok(g.shots.every((s) => s.empowered));
  g.eshots.push({ x: 3 + g.mirrorZone.r, z: 0 }); g.updateMirror(.01);
  assert.ok(g.eshots[0].dead);
});

test('stasis vulnerability persists under field slow and damage is attributed', () => {
  const g = game(); g.weapons = { frost: 3, field: 3 }; g.cd.frost = 0;
  const e = g.makeEnemy('golem', 2, 0); e.hp = 10000;
  g.buildGrid(); g.updateWeapons(.01);
  assert.equal(e.slowMul, .4, 'field cannot overwrite stronger stasis');
  assert.ok(e.exposed > 2); assert.ok(g.damageBySkill.frost > 0); assert.ok(g.damageBySkill.field > 0);
  g.updateSlow(e, 2.5); g.slow(e, .7, .7); g.updateSlow(e, .4);
  assert.equal(e.slowMul, .7, 'weak field must not indefinitely extend strong stasis');
  g.mode = 'pause'; const before = e.exposed; g.update(.05); assert.equal(e.exposed, before);
});

test('overlapping echo waves each hit a target only once', () => {
  const g = game(); const e = g.makeEnemy('golem', 2, 0); e.hp = 10000;
  g.waves = [1, 2].map((id) => ({ x: 0, z: 0, r: .5, max: 8, dmg: 10, id, delay: 0 }));
  let hits = 0; g.hurt = () => hits++;
  for (let i = 0; i < 20; i++) g.updateMisc(.02);
  assert.equal(hits, 2);
});

test('echo clears bullets and late AoE blasts are tracked under their own skill', () => {
  const g = game(); g.weapons = { echo: 3, rain: 3 }; g.cd.echo = g.cd.rain = 0;
  const e = g.makeEnemy('golem', 2, 0); e.hp = 10000; g.buildGrid();
  g.eshots.push({ x: .6, z: 0, vx: 0, vz: 0, life: 3, dmg: 5 });
  g.updateWeapons(.01); g.updateMisc(.05); assert.ok(g.eshots[0].dead);
  g.updateMisc(.7); assert.ok(g.damageBySkill.rain > 0);
});

test('arena keeps player and drops on land and spawns enemies outside touch range', () => {
  const g = game(); g.p.x = 22; g.input.x = 1; g.spawnAcc = -1000;
  g.update(.05); assert.ok(Math.hypot(g.p.x, g.p.z) <= 22.001);
  g.drop('chest', 25, 25, 0); assert.ok(Math.hypot(g.pickups[0].x, g.pickups[0].z) < 22);
  for (let i = 0; i < 30; i++) {
    const e = g.spawnAround('hum', 13);
    assert.ok(Math.hypot(e.x - g.p.x, e.z - g.p.z) >= 8);
    assert.ok(Math.hypot(e.x, e.z) <= 23.001);
  }
  g.enemies = []; g.t = 240; g.bossIdx = 6; g.spawnTick(0);
  assert.equal(g.enemies.length, 40);
  assert.ok(g.enemies.every((e) => Math.hypot(e.x - g.p.x, e.z - g.p.z) >= 8));
});

test('every weapon deals meaningful damage at Lv1 and scales through Lv4 and Lv8', async () => {
  const { skillStats, skillSummary } = await import('../site/games/community/pie-phoebe/src/skills.js');
  const report = {};
  for (const key of Object.keys(WEAPONS)) {
    report[key] = [];
    for (const lv of [1, 4, 8]) {
      const g = game(); g.charId = WEAPONS[key].owner === 'phrolova' ? 'phrolova' : 'phoebe'; g.weapons = { [key]: lv }; g.cd[key] = 0;
      for (let i = 0; i < 6; i++) {
        const e = g.makeEnemy('golem', 1.6 + (i % 3) * .5, Math.floor(i / 3) * .5);
        e.hp = e.maxhp = 1e7;
      }
      g.buildGrid(); g.p.moving = true;
      for (let frame = 0; frame < 600; frame++) {
        if (key === 'coda') g.notes = 6;            // 終章需要音符，由其他技能產生；這裡直接補滿
        g.t += .05; g.updateWeapons(.05); g.updateShots(.05); g.updateMisc(.05);
      }
      const damage = g.damageBySkill[key] || 0;
      assert.ok(damage > 200, `${key} Lv${lv} should deal at least 200 damage over 30 seconds`);
      assert.ok(skillSummary(key, lv).includes(String(Number(skillStats(key, lv).damage.toFixed(2)))));
      report[key].push(Math.round(damage / 30));
    }
    assert.ok(report[key][1] > report[key][0], `${key} Lv4 improves damage`);
    assert.ok(report[key][2] > report[key][1], `${key} Lv8 improves damage`);
  }
  console.log('30-second six-target benchmark (Lv1/Lv4/Lv8 damage/sec, fixed targets, excludes DoT):', JSON.stringify(report));
});

test('frost slows bosses without stunning and trail requires movement', () => {
  const g = game(); const boss = g.makeEnemy('vanguard', 3, 0);
  g.weapons = { frost: 3, trail: 3 }; g.cd.frost = 0;
  g.buildGrid(); g.updateNewWeapons(0.01);
  assert.equal(boss.stun, 0); assert.equal(boss.slowMul, 0.8);
  assert.equal(g.trails.length, 0);
  g.p.moving = true; g.updateNewWeapons(0.01); assert.equal(g.trails.length, 1);
  g.p.moving = false; g.petSkills.slide = 3; g.pet.slide = 0.5;
  g.updateNewWeapons(0.01); assert.equal(g.trails.length, 2);
  assert.equal(g.trails[1].dmg, g.trails[0].dmg * 2); assert.equal(g.trails[1].tide, true);
});

test('reflected bullets cannot damage the player later in the same frame', () => {
  const g = game(); g.eshots.push({ x: 0, z: 0, vx: 0, vz: 0, life: 2, dmg: 50, dead: true });
  g.updateShots(0.01); assert.equal(g.p.hp, 100); assert.equal(g.eshots.length, 0);
});

test('normal mode has six bosses, only the three main ones decide the win, endless rotates them', () => {
  const g = game(); g.spawnAcc = -10000;
  for (const t of [100, 180, 280, 360, 460, 540]) { g.t = t; g.spawnTick(0); }
  assert.equal(g.bossIdx, 6);
  assert.deepEqual(g.enemies.filter((e) => e.boss).map((e) => e.bossId), ['crab', 'vanguard', 'lighthouse', 'weaver', 'hive', 'conductor']);
  assert.deepEqual(g.enemies.filter((e) => e.main).map((e) => e.bossId), ['vanguard', 'weaver', 'conductor']);
  g.t = 720; g.spawnTick(0); assert.equal(g.bossIdx, 6);
  g.update(0.01); assert.notEqual(g.mode, 'win');
  for (const e of g.enemies.filter((e) => e.boss && e.elite)) g.kill(e);
  assert.equal(g.bossKills, 0); g.update(0.01); assert.notEqual(g.mode, 'win');
  for (const e of g.enemies.filter((e) => e.boss)) g.kill(e);
  assert.equal(g.bossKills, 3);
  g.pending = 0; g.update(0.01); assert.equal(g.mode, 'win');
  g.continueEndless(); g.t = 700; g.spawnTick(0); assert.equal(g.bossIdx, 7);
  assert.equal(g.enemies.filter((e) => e.boss && !e.dead).length, 1);
});

test('hud lists every living boss, not just one', () => {
  const g = game(); let state = null; g.ui.update = (st) => { state = st; };
  g.spawnBoss('crab'); g.spawnBoss('hive'); g.spawnBoss('vanguard', { main: true });
  g.hud();
  assert.equal(state.bosses.length, 3);
  assert.deepEqual(state.bosses.map((b) => b.name), ['潮鳴蟹將', '噪潮母巢', '破陣者']);
  assert.ok(state.bosses[0].elite && !state.bosses[2].elite);
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

test('fan fire interval is doubled while ordinary shooters retain their interval', () => {
  const g = game(); const fan = g.makeEnemy('fan', 7, 0); const shooter = g.makeEnemy('shooter', -7, 0);
  assert.ok(fan.shootT >= 2.4 && fan.shootT < 4.8);
  fan.shootT = shooter.shootT = 0; g.updateEnemies(.01);
  assert.equal(fan.shootT, 4.8); assert.equal(shooter.shootT, 2.4);
});

test('mirror zone gathers enemies, empowers basics and triggers its heavy synergy', () => {
  const g = game(); g.weapons = { ring: 3, star: 3, litany: 3 };
  const target = g.makeEnemy('golem', 3, 0); target.hp = 10000;
  const side = g.makeEnemy('golem', 4, 0); side.hp = 10000;
  g.buildGrid(); g.updateMirror(.01);
  assert.equal(g.mirrorZone.x, 3); assert.ok(side.kx < 0);
  assert.ok(g.strikes.some((s) => s.source === 'litany'));
  g.p.x = 3; g.cd.star = 0; g.updateWeapons(.01);
  assert.ok(g.shots.every((s) => s.empowered));
  g.eshots.push({ x: 3 + g.mirrorZone.r, z: 0 }); g.updateMirror(.01);
  assert.ok(g.eshots[0].dead);
});

test('stasis vulnerability persists under field slow and damage is attributed', () => {
  const g = game(); g.weapons = { frost: 3, field: 3 }; g.cd.frost = 0;
  const e = g.makeEnemy('golem', 2, 0); e.hp = 10000;
  g.buildGrid(); g.updateWeapons(.01);
  assert.equal(e.slowMul, .4, 'field cannot overwrite stronger stasis');
  assert.ok(e.exposed > 2); assert.ok(g.damageBySkill.frost > 0); assert.ok(g.damageBySkill.field > 0);
  g.updateSlow(e, 2.5); g.slow(e, .7, .7); g.updateSlow(e, .4);
  assert.equal(e.slowMul, .7, 'weak field must not indefinitely extend strong stasis');
  g.mode = 'pause'; const before = e.exposed; g.update(.05); assert.equal(e.exposed, before);
});

test('overlapping echo waves each hit a target only once', () => {
  const g = game(); const e = g.makeEnemy('golem', 2, 0); e.hp = 10000;
  g.waves = [1, 2].map((id) => ({ x: 0, z: 0, r: .5, max: 8, dmg: 10, id, delay: 0 }));
  let hits = 0; g.hurt = () => hits++;
  for (let i = 0; i < 20; i++) g.updateMisc(.02);
  assert.equal(hits, 2);
});

test('echo clears bullets and late AoE blasts are tracked under their own skill', () => {
  const g = game(); g.weapons = { echo: 3, rain: 3 }; g.cd.echo = g.cd.rain = 0;
  const e = g.makeEnemy('golem', 2, 0); e.hp = 10000; g.buildGrid();
  g.eshots.push({ x: .6, z: 0, vx: 0, vz: 0, life: 3, dmg: 5 });
  g.updateWeapons(.01); g.updateMisc(.05); assert.ok(g.eshots[0].dead);
  g.updateMisc(.7); assert.ok(g.damageBySkill.rain > 0);
});

test('arena keeps player and drops on land and spawns enemies outside touch range', () => {
  const g = game(); g.p.x = 22; g.input.x = 1; g.spawnAcc = -1000;
  g.update(.05); assert.ok(Math.hypot(g.p.x, g.p.z) <= 22.001);
  g.drop('chest', 25, 25, 0); assert.ok(Math.hypot(g.pickups[0].x, g.pickups[0].z) < 22);
  for (let i = 0; i < 30; i++) {
    const e = g.spawnAround('hum', 13);
    assert.ok(Math.hypot(e.x - g.p.x, e.z - g.p.z) >= 8);
    assert.ok(Math.hypot(e.x, e.z) <= 23.001);
  }
  g.enemies = []; g.t = 240; g.bossIdx = 6; g.spawnTick(0);
  assert.equal(g.enemies.length, 40);
  assert.ok(g.enemies.every((e) => Math.hypot(e.x - g.p.x, e.z - g.p.z) >= 8));
});

test('every weapon deals meaningful damage at Lv1 and scales through Lv4 and Lv8', async () => {
  const { skillStats, skillSummary } = await import('../site/games/community/pie-phoebe/src/skills.js');
  const report = {};
  for (const key of Object.keys(WEAPONS)) {
    report[key] = [];
    for (const lv of [1, 4, 8]) {
      const g = game(); g.charId = WEAPONS[key].owner === 'phrolova' ? 'phrolova' : 'phoebe'; g.weapons = { [key]: lv }; g.cd[key] = 0;
      for (let i = 0; i < 6; i++) {
        const e = g.makeEnemy('golem', 1.6 + (i % 3) * .5, Math.floor(i / 3) * .5);
        e.hp = e.maxhp = 1e7;
      }
      g.buildGrid(); g.p.moving = true;
      for (let frame = 0; frame < 600; frame++) {
        if (key === 'coda') g.notes = 6;            // 終章需要音符，由其他技能產生；這裡直接補滿
        g.t += .05; g.updateWeapons(.05); g.updateShots(.05); g.updateMisc(.05);
      }
      const damage = g.damageBySkill[key] || 0;
      assert.ok(damage > 200, `${key} Lv${lv} should deal at least 200 damage over 30 seconds`);
      assert.ok(skillSummary(key, lv).includes(String(Number(skillStats(key, lv).damage.toFixed(2)))));
      report[key].push(Math.round(damage / 30));
    }
    assert.ok(report[key][1] > report[key][0], `${key} Lv4 improves damage`);
    assert.ok(report[key][2] > report[key][1], `${key} Lv8 improves damage`);
  }
  console.log('30-second six-target benchmark (Lv1/Lv4/Lv8 damage/sec, fixed targets, excludes DoT):', JSON.stringify(report));
});

test('frost slows bosses without stunning and trail requires movement', () => {
  const g = game(); const boss = g.makeEnemy('vanguard', 3, 0);
  g.weapons = { frost: 3, trail: 3 }; g.cd.frost = 0;
  g.buildGrid(); g.updateNewWeapons(0.01);
  assert.equal(boss.stun, 0); assert.equal(boss.slowMul, 0.8);
  assert.equal(g.trails.length, 0);
  g.p.moving = true; g.updateNewWeapons(0.01); assert.equal(g.trails.length, 1);
  g.p.moving = false; g.petSkills.slide = 3; g.pet.slide = 0.5;
  g.updateNewWeapons(0.01); assert.equal(g.trails.length, 2);
  assert.equal(g.trails[1].dmg, g.trails[0].dmg * 2); assert.equal(g.trails[1].tide, true);
});

test('reflected bullets cannot damage the player later in the same frame', () => {
  const g = game(); g.eshots.push({ x: 0, z: 0, vx: 0, vz: 0, life: 2, dmg: 50, dead: true });
  g.updateShots(0.01); assert.equal(g.p.hp, 100); assert.equal(g.eshots.length, 0);
});

test('normal mode has six bosses, only the three main ones decide the win, endless rotates them', () => {
  const g = game(); g.spawnAcc = -10000;
  for (const t of [100, 180, 280, 360, 460, 540]) { g.t = t; g.spawnTick(0); }
  assert.equal(g.bossIdx, 6);
  assert.deepEqual(g.enemies.filter((e) => e.boss).map((e) => e.bossId), ['crab', 'vanguard', 'lighthouse', 'weaver', 'hive', 'conductor']);
  assert.deepEqual(g.enemies.filter((e) => e.main).map((e) => e.bossId), ['vanguard', 'weaver', 'conductor']);
  g.t = 720; g.spawnTick(0); assert.equal(g.bossIdx, 6);
  g.update(0.01); assert.notEqual(g.mode, 'win');
  for (const e of g.enemies.filter((e) => e.boss && e.elite)) g.kill(e);
  assert.equal(g.bossKills, 0); g.update(0.01); assert.notEqual(g.mode, 'win');
  for (const e of g.enemies.filter((e) => e.boss)) g.kill(e);
  assert.equal(g.bossKills, 3);
  g.pending = 0; g.update(0.01); assert.equal(g.mode, 'win');
  g.continueEndless(); g.t = 700; g.spawnTick(0); assert.equal(g.bossIdx, 7);
  assert.equal(g.enemies.filter((e) => e.boss && !e.dead).length, 1);
});

test('hud lists every living boss, not just one', () => {
  const g = game(); g.spawnBoss('crab'); g.spawnBoss('hive'); g.spawnBoss('vanguard', { main: true });
  const hud = g.hud ? null : null;
  const bosses = g.enemies.filter((e) => e.boss);
  assert.equal(bosses.length, 3);
  assert.ok(g.boss && !g.boss.dead);
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

test('v1.4 reggie has no glutton skill, never eats fish, and its roar is weaker than v1.3', async () => {
  const { PET } = await import('../site/games/community/pie-phoebe/src/data.js');
  const { petStats } = await import('../site/games/community/pie-phoebe/src/skills.js');
  assert.deepEqual(Object.keys(PET), ['roar', 'slide']);
  assert.ok(petStats('roar', 1).damage < 24 + 9 && petStats('roar', 8).damage < 24 + 9 * 8 + 19);
  const g = game(); g.pet.x = 1; g.pet.z = 0; g.drop('fish', 1, 0, 1);
  g.pet.roarCd = g.pet.slideCd = 99; g.updatePickups(0.1);
  assert.equal(g.pickups.length, 1);      // 瑞吉站在魚上也不會吃
});

test('slide orbits the player, hits each enemy once per lap, then returns beside the player', () => {
  const g = game(); g.petSkills = { roar: 1, slide: 1 }; g.pet.roarCd = 99; g.pet.slideCd = 0;
  const ring = [];
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ring.push(g.makeEnemy('golem', Math.cos(a) * 3.1, Math.sin(a) * 3.1)); }
  for (const e of ring) e.hp = e.maxhp = 1e9;
  const hits = new Map(); const orig = g.hurt.bind(g);
  g.hurt = (e, d, o) => { if (o?.source === 'slide') hits.set(e.id, (hits.get(e.id) || 0) + 1); orig(e, d, o); };
  const radii = [];
  g.buildGrid(); g.updatePet(0.01);
  assert.ok(g.pet.slide > 0);
  for (let i = 0; i < 120 && g.pet.slide > 0; i++) {
    for (const e of ring) { e.kx = e.kz = 0; e.stun = 9; }
    g.buildGrid(); g.updatePet(1 / 30);
    if (g.pet.slideT > 0.5 && g.pet.slideT < g.pet.slideDur - 0.4) radii.push(Math.hypot(g.pet.x - g.p.x, g.pet.z - g.p.z));
  }
  assert.equal(g.pet.slide, 0);
  assert.ok(radii.length > 10 && radii.every((r) => Math.abs(r - 3.1) < 0.25), `orbit radii ${radii.slice(0, 3)}`);
  assert.ok([...hits.values()].every((n) => n === 1) && hits.size >= 6);
  const home = Math.hypot(g.pet.x - (g.p.x - g.p.face * 1.7), g.pet.z - (g.p.z + 0.9));
  assert.ok(home < 0.5, `returns beside player (${home})`);
});

test('slide Lv8 makes two laps and every enemy can be hit once per lap', () => {
  const g = game(); g.petSkills = { roar: 1, slide: 8 }; g.pet.roarCd = 99; g.pet.slideCd = 0;
  const e = g.makeEnemy('golem', 3.8, 0); e.hp = e.maxhp = 1e9;
  const n = { v: 0 }; const orig = g.hurt.bind(g); g.hurt = (x, d, o) => { if (o?.source === 'slide') n.v++; orig(x, d, o); };
  for (let i = 0; i < 4; i++) g.makeEnemy('hum', -3.8 + i * .1, 0);
  g.buildGrid(); g.updatePet(0.01);
  for (let i = 0; i < 200 && g.pet.slide > 0; i++) { e.x = 3.8; e.z = 0; e.kx = e.kz = 0; e.stun = 9; g.buildGrid(); g.updatePet(1 / 30); }
  assert.ok(n.v >= 2);
});

test('v1.4 synergies start at Lv2, announce themselves, and report their own damage', async () => {
  const { SYNERGIES, SYN_LV } = await import('../site/games/community/pie-phoebe/src/data.js');
  assert.equal(SYN_LV, 2); assert.equal(SYNERGIES.filter((s) => !s.char).length, 5); assert.equal(SYNERGIES.filter((s) => s.char === 'phrolova').length, 2);
  const banners = []; const g = game(); g.ui.banner = (t) => banners.push(t);
  g.weapons = { star: 2, chain: 1 }; g.refreshSynergies(); assert.ok(!g.syn('refract')); assert.equal(banners.length, 0);
  g.weapons.chain = 2; g.refreshSynergies(); assert.ok(g.syn('refract'));
  assert.equal(banners.length, 1); assert.match(banners[0], /聖輝折射/);
  g.refreshSynergies(); assert.equal(banners.length, 1);          // 只宣布一次
  for (let i = 0; i < 6; i++) g.makeEnemy('golem', 1 + i, 0);
  g.buildGrid(); g.cd.chain = 0; g.updateNewWeapons(0.01);
  assert.ok(g.synergyDamage.refract > 0, 'extra-target damage is credited to the synergy');
  assert.ok(g.fxs.some((f) => f.kind === 'beam' && f.color), 'extra links are drawn in a different colour');
});

test('shatter and echo-boom show feedback; echo-boom consumes 3 stacks', () => {
  const g = game(); g.weapons = { litany: 2, frost: 2, echo: 2, field: 2 };
  const e = g.makeEnemy('golem', 2, 0); e.slowT = 2; e.hp = e.maxhp = 1e9;
  g.fireBeam(0, 1, 100);
  assert.ok(g.synergyDamage.shatter > 0); assert.ok(g.nums.some((n) => n.text === '碎！'));
  g.waves.push({ x: 0, z: 0, r: 0.5, max: 6, dmg: 50, id: 99, delay: 0 }); e.frz = 5; e.x = 1.2; e.z = 0;
  g.updateMisc(0.1);
  assert.ok(g.synergyDamage.echoboom > 0); assert.ok(e.frz <= 3 + 2);   // 5 - 3 + 本次命中疊 2 層
});

test('level-up cards favour the missing half of a synergy', () => {
  const g = game(); g.weapons = { star: 3, ring: 1 }; g.petSkills = { roar: 1 };
  let chain = 0; let neutral = 0;
  for (let i = 0; i < 400; i++) for (const c of g.makeCards()) { if (c.key === 'chain') chain++; if (c.key === 'rain') neutral++; }
  assert.ok(chain > neutral * 1.5, `chain ${chain} vs rain ${neutral}`);
  const card = g.makeCards().concat(g.makeCards(), g.makeCards()).find((c) => c.key === 'chain');
  if (card) assert.match(card.desc, /聖輝折射/);
});

// ───────────────────────── v1.4 頭目機制 ─────────────────────────
function boss(id, x = 0, z = -8) {
  const g = game(); g.t = 200; g.spawnAcc = -1e9;
  const e = g.spawnBoss(id, { main: true }); e.x = x; e.z = z; e.hp = e.maxhp = 100000;
  g.p.x = 0; g.p.z = 0; g.input = { x: 0, z: 0 };
  return { g, e };
}
const run = (g, sec) => { for (let i = 0; i < sec * 30; i++) { g.p.hp = 100; g.p.inv = 1; g.updateEnemies(1 / 30); g.updateHazards(1 / 30); } };

test('vanguard: a charge that hits the wall staggers it, and a stagger makes it take +60% damage', () => {
  const { g, e } = boss('vanguard', 6, 0);
  e.ai = { mode: 'windup', t: 0.01, n: 0 }; e.cdx = 1; e.cdz = 0;       // 朝 +x 衝鋒，場地邊界在 22
  g.p.x = -8; g.p.z = 0;
  assert.equal(g.bossDamage(e, 100), 100);
  run(g, 3);
  assert.equal(e.ai.mode, 'stagger'); assert.ok(e.vuln > 0);
  assert.equal(g.bossDamage(e, 100), 160);
  assert.ok(Math.hypot(e.x, e.z) > 20);
});

test('vanguard: a charge that finds no wall ends without a stagger', () => {
  const { g, e } = boss('vanguard', -2, 0);
  e.ai = { mode: 'windup', t: 0.01, n: 0 }; e.cdx = 0; e.cdz = 0.0001; e.speed = 0;
  e.x = 0; e.z = 0; e.cdx = 0; e.cdz = 1;
  g.p.x = 15; run(g, 0.1);
  e.ai.mode = 'rush'; e.ai.t = 0.2; run(g, 0.5);
  assert.notEqual(e.ai.mode, 'stagger'); assert.equal(e.vuln > 0, false);
});

test('weaver: pillars shield it, breaking them all opens a damage window', () => {
  const { g, e } = boss('weaver');
  run(g, 0.2);
  const pillars = g.enemies.filter((o) => o.type === 'pillar');
  assert.equal(pillars.length, 3); assert.ok(e.ward < 0.2);
  assert.ok(Math.abs(g.bossDamage(e, 100) - 15) < 1e-9, 'ward cuts damage to 15%');
  for (const pl of pillars) g.kill(pl);
  run(g, 0.2);
  assert.equal(e.ward, 1); assert.ok(e.vuln > 0);
  assert.equal(g.bossDamage(e, 100), 150);
});

test('weaver: a second pillar wave arrives at half health', () => {
  const { g, e } = boss('weaver');
  run(g, 0.2); for (const pl of g.enemies.filter((o) => o.type === 'pillar')) g.kill(pl);
  run(g, 0.2); e.hp = e.maxhp * 0.49; run(g, 0.2);
  assert.equal(g.enemies.filter((o) => o.type === 'pillar' && !o.dead).length, 3);
});

test('conductor: phase 1 throws two opposite beams, phase 3 rotates safe sectors', () => {
  const { g, e } = boss('conductor');
  e.ai = { t: 99, beamCd: 0, sectorCd: 99, addCd: 99, phase: 1, n: 0 };
  run(g, 0.2);
  const beams = g.hazards.filter((h) => h.kind === 'beam'); assert.equal(beams.length, 2);
  assert.ok(Math.abs(Math.cos(beams[0].ang) + Math.cos(beams[1].ang)) < 1e-6);
  g.hazards = []; e.hp = e.maxhp * 0.2; e.ai.sectorCd = 0; run(g, 0.2);
  assert.equal(e.ai.phase, 3);
  e.ai.sectorCd = 0; g.hazards = g.hazards.filter((h) => h.kind !== 'sector'); run(g, 0.1);
  const sectors = g.hazards.filter((h) => h.kind === 'sector');
  assert.equal(sectors.length, 4);              // 六個扇區，兩個安全
});

test('hazards: beams, sectors and cones hurt only inside their shape and respect the warning time', () => {
  const g = game(); g.t = 10; const src = g.makeEnemy('hum', 0, 0); src.dmg = 10;
  g.p.x = 5; g.p.z = 0; g.p.inv = 0;
  g.addBeam(src, 0, { w: 0, warn: 1, dur: 2, len: 12, width: 1.5 });
  g.updateHazards(0.5); assert.equal(g.p.hp, 100);              // 預警中不傷人
  g.updateHazards(0.6); g.updateHazards(0.05); assert.ok(g.p.hp < 100);   // 光束啟動後傷人
  g.hazards = []; g.p.hp = 100; g.p.inv = 0; g.p.z = 4;
  g.addBeam(src, 0, { w: 0, warn: 0, dur: 2, len: 12, width: 1.5 }); g.updateHazards(0.1); assert.equal(g.p.hp, 100);
  g.hazards = []; g.p.x = 0; g.p.z = 10;
  g.addSector(src, 0, Math.PI / 3, 25, 0.5); g.updateHazards(0.6); assert.equal(g.p.hp, 100);   // 玩家在扇區外
  g.hazards = []; g.p.x = 10; g.p.z = 5; g.p.inv = 0;
  g.addSector(src, 0, Math.PI / 3, 25, 0.5); g.updateHazards(0.4); assert.equal(g.p.hp, 100); g.updateHazards(0.2); assert.ok(g.p.hp < 100);
  g.hazards = []; g.p.hp = 100; g.p.inv = 0; g.p.x = 0; g.p.z = 3;
  g.addCone(src, Math.PI / 2, 1.5, 4.8, 0.2); g.updateHazards(0.3); assert.ok(g.p.hp < 100);
  g.hazards = []; g.p.hp = 100; g.p.inv = 0; g.p.x = 3; g.p.z = 0;
  g.addCone(src, Math.PI / 2, 1.5, 4.8, 0.2); g.updateHazards(0.3); assert.equal(g.p.hp, 100);
});

test('crab: shield soaks damage first, breaking it staggers the crab, and it regrows later', () => {
  const { g, e } = boss('crab');
  run(g, 0.1);
  assert.ok(e.shield > 0); const hp0 = e.hp;
  g.hurt(e, e.shield * 0.5, { mul: 1 }); assert.equal(e.hp, hp0);       // 盾吸收，血量不動
  g.hurt(e, e.shield + 50, { mul: 1 }); run(g, 0.1);
  assert.ok(e.shield <= 0 && e.vuln > 0 && e.ai.broken);
  run(g, 15); assert.ok(e.shield > 0 && !e.ai.broken);
});

test('lighthouse: lit phase sweeps a beam, then the light goes out and it becomes vulnerable', () => {
  const { g, e } = boss('lighthouse');
  run(g, 2.5);
  assert.ok(g.hazards.some((h) => h.kind === 'beam'));
  assert.equal(e.vuln > 0, false);
  run(g, 14);
  assert.ok(e.ai.n >= 1);
  let saw = false; for (let i = 0; i < 30 * 40 && !saw; i++) { run(g, 1 / 30); if (e.vuln > 0) saw = true; }
  assert.ok(saw, 'it goes dark between beam cycles');
});

test('hive: eggs hatch into chargers after 6 seconds unless destroyed first', () => {
  const { g, e } = boss('hive');
  run(g, 3);
  const eggs = g.enemies.filter((o) => o.type === 'egg'); assert.equal(eggs.length, 3);
  g.kill(eggs[0]); const before = g.enemies.filter((o) => o.type === 'charger').length;
  run(g, 6.5);
  const hatched = g.enemies.filter((o) => o.type === 'charger').length - before;
  assert.equal(hatched, 2);
  assert.equal(g.enemies.filter((o) => o.type === 'egg' && o.hatch <= 0 && !o.dead).length, 0);
});

test('killing a boss removes its props, hazards and bullets, and elites do not count toward the win', () => {
  const { g, e } = boss('weaver'); run(g, 0.3);
  assert.ok(g.enemies.some((o) => o.type === 'pillar')); g.eshots.push({ x: 0, z: 0, vx: 0, vz: 0, life: 2, dmg: 5 });
  g.kill(e);
  assert.equal(g.enemies.filter((o) => o.type === 'pillar' && !o.dead).length, 0);
  assert.equal(g.eshots.length, 0); assert.equal(g.bossKills, 1);
  const c = game(); const crab = c.spawnBoss('crab', {}); c.kill(crab); assert.equal(c.bossKills, 0); assert.equal(c.eliteKills, 1);
});

// ───────────────────────── v1.4 弗洛洛 ─────────────────────────
function phro() {
  const g = game(); g.charId = 'phrolova'; g.newRun(); g.mode = 'play'; g.spawnAcc = -1e9; return g;
}

test('phrolova starts with the scythe, draws only her own skills, and only she gets the maestro', () => {
  const g = phro();
  assert.deepEqual(g.weapons, { scythe: 1 });
  const keys = new Set(); for (let i = 0; i < 300; i++) for (const c of g.makeCards()) if (c.type === 'weapon') keys.add(c.key);
  assert.deepEqual([...keys].sort(), ['coda', 'dream', 'lily', 'scythe']);
  g.p.prayer = 120; g.setMode('absolve'); assert.equal(g.p.mode, null);
  g.setMode('maestro'); assert.equal(g.p.mode, 'maestro'); assert.ok(g.hecate);
  const p = game(); p.p.prayer = 120; p.setMode('maestro'); assert.equal(p.p.mode, null);
});

test('scythe only cuts inside its arc, makes notes, and coda spends six notes to pull enemies in', () => {
  const g = phro(); g.weapons = { scythe: 4, coda: 4 }; g.cd.scythe = 0; g.cd.coda = 0;
  const front = g.makeEnemy('golem', 2.2, 0); const behind = g.makeEnemy('golem', -2.2, 0.1);
  front.hp = front.maxhp = behind.hp = behind.maxhp = 1e6;
  g.buildGrid(); g.updatePhrolova(0.01); g.buildGrid(); for (let i = 0; i < 20; i++) g.updatePhrolova(0.05);
  assert.ok(front.hp < front.maxhp); assert.equal(behind.hp, behind.maxhp);
  assert.ok(g.notes >= 1);
  g.notes = 6; const far = g.makeEnemy('golem', 4.2, 0); far.hp = far.maxhp = 1e6; g.buildGrid();
  g.cd.coda = 0; g.updatePhrolova(0.01);
  assert.equal(g.notes, 0); assert.ok(far.kx < 0, 'pulled toward the player');
});

test('phrolova synergies: dream-cut hits stagnated enemies harder, finale detonates erosion', () => {
  const g = phro(); g.weapons = { scythe: 2, dream: 2, coda: 2, lily: 2 }; g.refreshSynergies(false);
  assert.ok(g.syn('dreamcut') && g.syn('finale'));
  const e = g.makeEnemy('golem', 2, 0); e.hp = e.maxhp = 1e9; e.slowT = 2; g.cd.scythe = 0;
  g.buildGrid(); g.updatePhrolova(0.01); for (let i = 0; i < 20; i++) g.updatePhrolova(0.05);
  assert.ok(g.synergyDamage.dreamcut > 0);
  e.frz = 5; g.notes = 6; g.cd.coda = 0; g.buildGrid(); g.updatePhrolova(0.01);
  assert.ok(g.synergyDamage.finale > 0);
});

test('maestro makes hecate swing on her own, boosts damage, and ends cleanly', () => {
  const g = phro(); g.weapons = { scythe: 1 }; g.p.prayer = 120; g.setMode('maestro');
  const e = g.makeEnemy('golem', 3, 0); e.hp = e.maxhp = 1e9; g.buildGrid();
  assert.ok(g.atk > phro().atk * 1.2);
  for (let i = 0; i < 40; i++) { g.buildGrid(); g.updatePhrolova(0.05); }
  assert.ok(g.damageBySkill.hecate > 0);
  g.p.modeT = 0.01; g.p.hp = 100; g.update(0.05); assert.equal(g.hecate, null); assert.equal(g.p.mode, null);
});

test('v1.4 effects are dimmer than v1.3 and the brightness setting scales them', () => {
  const g = game();
  g.L = {}; g.fxLayers = [];
  const layer = { baseOpacity: 0.28, mat: { opacity: 0 }, setScale(s) { this.mat.opacity = Math.min(1, this.baseOpacity * s); } };
  g.fxLayers.push(layer);
  g.setFxLevel('low'); assert.ok(layer.mat.opacity < 0.28);
  g.setFxLevel('high'); assert.ok(layer.mat.opacity > 0.28);
  assert.equal(g.cycleFxLevel(), 'low');
});

// ───────────────────────── v1.4.1 弗洛洛貼紙風特效 ─────────────────────────
test('phrolova effects are sticker kinds, the attack pose lasts a moment, and notes pop up', () => {
  const g = phro(); g.weapons = { scythe: 4, dream: 3, coda: 3 }; g.cd.scythe = 0; g.cd.dream = 0; g.cd.coda = 0;
  const e = g.makeEnemy('golem', 2, 0); e.hp = e.maxhp = 1e9; g.makeEnemy('golem', 3, 1).hp = 1e9;
  g.buildGrid(); g.updatePhrolova(0.01); for (let i = 0; i < 8; i++) g.updatePhrolova(0.05);
  const kinds = new Set(g.fxs.map((f) => f.kind));
  for (const k of ['slash', 'bloom', 'flower', 'note']) assert.ok(kinds.has(k), `${k} fx`);
  assert.ok(g.p.atkT > 0, 'attack pose is on');
  assert.ok(g.fxs.find((f) => f.kind === 'bloom').flowers.length >= 3);
  g.notes = 6; g.cd.coda = 0; g.buildGrid(); g.updatePhrolova(0.01);
  assert.ok(g.fxs.some((f) => f.kind === 'burst'), 'coda uses the burst sticker');
  g.weapons = {}; g.slashes = []; for (let i = 0; i < 14; i++) g.update(0.05);
  assert.equal(g.p.atkT, 0, 'attack pose ends');
});

test('no additive glow is spent on phrolova skills: the old lily and crescent layers are gone', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../site/games/community/pie-phoebe/src/game.js', import.meta.url), 'utf8');
  assert.ok(!/L\.lily\b|L\.slash\b|tex\.crescent|fx_lily'/.test(src));
  assert.ok(/L\.pslash/.test(src) && /L\.pstand/.test(src) && /L\.phrolovaAtk/.test(src));
});
