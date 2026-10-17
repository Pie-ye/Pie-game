import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutCity, doorAt, selectAdjacentGame, stepPlayer, cameraFor, districtFor, lookFor, themeAt, SPACING, DOOR_RADIUS, DISTRICT_GAP, WALK_SPEED,
} from '../site/shell/city/layout.js';

const games = [
  { id: 'snake', name: '貪吃蛇', kind: 'free' },
  { id: 'slots', name: '拉霸', official: true },
  { id: 'phoebe-egg', name: '搬蛋', kind: 'free' },
  { id: 'coin-flip', name: '猜硬幣', kind: 'coin' },
  { id: 'new-thing', name: '新遊戲', kind: 'free' },
  { id: 'new-coin', name: '新金幣', kind: 'coin' },
];

test('one navigation reaches exactly the adjacent door and stops', () => {
  const { buildings, width } = layoutCity(games);
  const s = { x: buildings[0].doorX, vx: 0, facing: 1, target: null };
  selectAdjacentGame(s, buildings, 1);
  for (let i = 0; i < 600; i += 1) stepPlayer(s, { dir: 0 }, 1 / 60, width);
  assert.equal(s.x, buildings[1].doorX);
  assert.equal(s.target, null);
  assert.equal(s.moving, false);
  assert.equal(s.vx, 0);
});

test('rapid navigation uses selected destination, reverses and clamps at ends', () => {
  const { buildings, width } = layoutCity(games);
  const s = { x: buildings[0].doorX, vx: 0, facing: 1, target: null };
  selectAdjacentGame(s, buildings, -1);
  assert.equal(s.target, buildings[0].doorX);
  selectAdjacentGame(s, buildings, 1);
  stepPlayer(s, { dir: 0 }, 0.05, width);
  selectAdjacentGame(s, buildings, 1);
  assert.equal(s.target, buildings[2].doorX);
  selectAdjacentGame(s, buildings, -1);
  selectAdjacentGame(s, buildings, -1);
  assert.equal(s.target, buildings[0].doorX);
  assert.equal(s.vx, 0);
  for (let i = 0; i < 20; i += 1) selectAdjacentGame(s, buildings, 1);
  assert.equal(s.target, buildings.at(-1).doorX);
  for (let i = 0; i < 1200; i += 1) stepPlayer(s, { dir: 0 }, 1 / 60, width);
  assert.equal(s.x, buildings.at(-1).doorX);
  assert.equal(selectAdjacentGame(s, [], 1), null);
});

test('layout groups by district and keeps door spacing', () => {
  const { buildings, gates, width } = layoutCity(games);
  assert.deepEqual(buildings.map((b) => b.id), ['slots', 'coin-flip', 'new-coin', 'phoebe-egg', 'snake', 'new-thing']);
  assert.deepEqual(gates.map((g) => g.district.id), ['casino', 'phoebe', 'arcade']);
  for (let i = 1; i < buildings.length; i += 1) {
    const gap = buildings[i].doorX - buildings[i - 1].doorX;
    assert.ok(gap === SPACING || gap === SPACING + DISTRICT_GAP, `gap ${gap}`);
  }
  assert.ok(width > buildings.at(-1).doorX);
});

test('unknown games get a stable accent and sensible district', () => {
  assert.equal(districtFor({ id: 'x1', kind: 'coin' }), 'casino');
  assert.equal(districtFor({ id: 'x2', kind: 'free', multiplayer: true }), 'arcade');
  assert.equal(lookFor({ id: 'x3', name: 'N' }).accent, lookFor({ id: 'x3', name: 'N' }).accent);
  assert.equal(lookFor({ id: 'x3', name: 'N' }).art, null);
  assert.equal(lookFor({ id: 'x3', name: 'N' }).sign, 'N');
});

test('doorAt only matches inside the radius', () => {
  const { buildings } = layoutCity(games);
  const b = buildings[1];
  assert.equal(doorAt(buildings, b.doorX + DOOR_RADIUS - 1).id, b.id);
  assert.equal(doorAt(buildings, b.doorX + SPACING / 2), null);
});

test('player accelerates, turns, and stops at the world edge', () => {
  const s = { x: 500, vx: 0, facing: 1, target: null };
  for (let i = 0; i < 30; i += 1) stepPlayer(s, { dir: 1 }, 1 / 60, 3000);
  assert.ok(s.x > 500 && s.vx > 0 && s.facing === 1 && s.moving);
  for (let i = 0; i < 1200; i += 1) stepPlayer(s, { dir: -1 }, 1 / 60, 3000);
  assert.equal(s.x, 120);
  assert.equal(s.vx, 0);
  assert.equal(s.facing, -1);
});

test('auto-walk reaches the target exactly and keys cancel it', () => {
  const s = { x: 400, vx: 0, facing: 1, target: 1500, autoRun: true };
  for (let i = 0; i < 600 && s.target != null; i += 1) stepPlayer(s, { dir: 0 }, 1 / 60, 4000);
  assert.equal(s.x, 1500);
  assert.equal(s.target, null);
  const t = { x: 400, vx: 0, facing: 1, target: 1500 };
  stepPlayer(t, { dir: -1 }, 1 / 60, 4000);
  assert.equal(t.target, null);
});

test('camera clamps to the world', () => {
  assert.equal(cameraFor(100, 1, 1000, 5000), 0);
  assert.equal(cameraFor(4950, 1, 1000, 5000), 4000);
  const mid = cameraFor(2500, 1, 1000, 5000);
  assert.ok(mid > 2000 && mid < 2100);
});

test('tapping a key moves a few steps, then stops (no coasting to the next building)', () => {
  const s = { x: 1000, vx: 0, facing: 1, target: null };
  for (let i = 0; i < 6; i += 1) stepPlayer(s, { dir: 1 }, 1 / 60, 9000); // 按 0.1 秒
  for (let i = 0; i < 120; i += 1) stepPlayer(s, { dir: 0 }, 1 / 60, 9000);
  assert.ok(s.x > 1000 && s.x < 1040, `moved ${s.x - 1000}`);
  assert.equal(s.vx, 0);
  assert.equal(s.moving, false);
});

test('holding a key never exceeds walking speed', () => {
  const s = { x: 500, vx: 0, facing: 1, target: null };
  for (let i = 0; i < 300; i += 1) stepPlayer(s, { dir: 1 }, 1 / 60, 9000);
  assert.ok(Math.abs(s.vx) <= WALK_SPEED + 1e-9);
});

test('theme blends only near district gates', () => {
  const { gates } = layoutCity(games);
  const g1 = gates[1].x;
  assert.deepEqual(themeAt(gates, gates[0].x + 50), { a: 'casino', b: null, t: 0 });
  const mid = themeAt(gates, g1);
  assert.equal(mid.a, 'casino');
  assert.equal(mid.b, 'phoebe');
  assert.ok(Math.abs(mid.t - 0.5) < 1e-9);
  const after = themeAt(gates, (g1 + gates[2].x) / 2);
  assert.deepEqual(after, { a: 'phoebe', b: null, t: 0 });
  const past = themeAt(gates, g1 + 100);
  assert.equal(past.a, 'casino');
  assert.equal(past.b, 'phoebe');
  assert.ok(past.t > 0.5);
});
