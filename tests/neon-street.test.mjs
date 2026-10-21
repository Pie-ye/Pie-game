import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { step, prepare, resolve, zoneAt, RADIUS, WALK, RUN } from '../site/games/community/neon-arcade-street/src/physics.js';

const data = JSON.parse(readFileSync(new URL('../site/games/community/neon-arcade-street/assets/scene.json', import.meta.url)));
const world = { colliders: prepare(data.colliders), bounds: data.bounds };
const fresh = (x, z, yaw = 0) => ({ x, z, y: 0, vx: 0, vz: 0, vy: 0, yaw, bob: 0 });
const walk = (p, input, seconds) => { for (let t = 0; t < seconds; t += 1 / 60) step(p, input, 1 / 60, world); return p; };

test('室內移動保留偏移座標，四側邊界不以街區原點裁切', () => {
  const room = { colliders: [], bounds: { minX: -5.64, maxX: 5.64, minZ: -243.64, maxZ: -236.36 } };
  const p = fresh(0, -237.3);
  for (let i = 0; i < 60; i++) step(p, { fx: 0, fz: 1 }, 1 / 60, room);
  assert.ok(p.z < -240 && p.z > -241, `z=${p.z}`);
  for (const [fx, fz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    for (let i = 0; i < 240; i++) step(p, { fx, fz, run: true }, 1 / 60, room);
    assert.ok(p.x >= room.bounds.minX && p.x <= room.bounds.maxX);
    assert.ok(p.z >= room.bounds.minZ && p.z <= room.bounds.maxZ);
  }
});

test('出生點在空地上，不會卡進任何碰撞體', () => {
  const p = { ...fresh(data.spawn.x, data.spawn.z) };
  const before = { x: p.x, z: p.z };
  assert.equal(resolve(p, RADIUS, world.colliders, world.bounds), false);
  assert.deepEqual({ x: p.x, z: p.z }, before);
});

test('W 往前走：yaw=0 朝北（z 變小），速度約等於步行速度', () => {
  const p = walk(fresh(0, 40), { fx: 0, fz: 1, run: false, jump: false }, 1);
  assert.ok(p.z < 40 - WALK * 0.85 && p.z > 40 - WALK * 1.05, `z=${p.z}`);
  assert.ok(Math.abs(p.x) < 1e-6);
});

test('D 往右走：yaw=0 時右手邊是東（x 變大）；轉 90 度朝西後 W 往西', () => {
  const p = walk(fresh(0, 40), { fx: 1, fz: 0, run: false, jump: false }, 0.5);
  assert.ok(p.x > 1);
  const q = walk(fresh(0, 40, Math.PI / 2), { fx: 0, fz: 1, run: false, jump: false }, 0.5);
  assert.ok(q.x < -1 && Math.abs(q.z - 40) < 0.01, `x=${q.x} z=${q.z}`);
});

test('Shift 奔跑比步行快', () => {
  const a = walk(fresh(0, 40), { fx: 0, fz: 1, run: false, jump: false }, 1);
  const b = walk(fresh(0, 40), { fx: 0, fz: 1, run: true, jump: false }, 1);
  assert.ok(40 - b.z > (40 - a.z) * 1.6 && 40 - b.z < RUN * 1.05);
});

test('斜向走不會比直走快', () => {
  const p = walk(fresh(0, 40), { fx: 1, fz: 1, run: false, jump: false }, 1);
  assert.ok(Math.hypot(p.x, p.z - 40) < WALK * 1.02);
});

test('朝廣場中心的紀念碑直走會被擋在基座外', () => {
  const p = walk(fresh(0, 16), { fx: 0, fz: 1, run: true, jump: false }, 6);
  assert.ok(Math.hypot(p.x, p.z) >= 9 + RADIUS - 0.05, `r=${Math.hypot(p.x, p.z)}`);
});

test('往大道側面的大樓直走會停在人行道邊，不會穿牆', () => {
  // 東大道（x=60）朝南（+z），yaw=π 朝南
  const p = walk(fresh(60, 0, Math.PI), { fx: 0, fz: 1, run: true, jump: false }, 4);
  assert.ok(p.z < data.avenueHalf + 0.2, `z=${p.z}`);
  assert.ok(p.z > data.avenueHalf - 3);
});

test('貼牆斜走會沿牆滑動而不是黏住', () => {
  const p = fresh(60, 0, Math.PI);
  walk(p, { fx: -1, fz: 1, run: false, jump: false }, 3); // 往南、往東（yaw=π 時右手邊是西，所以 fx=-1 往東）
  assert.ok(p.z < data.avenueHalf + 0.2);
  assert.ok(p.x > 62, `x=${p.x}`);
});

test('世界邊界不能走出去', () => {
  const p = walk(fresh(0, 0, Math.PI / 2), { fx: 0, fz: 1, run: true, jump: false }, 40);
  assert.ok(p.x >= -data.bounds - 1e-6);
});

test('大道盡頭有閘門與看板牆擋住', () => {
  const p = walk(fresh(0, 60, 0), { fx: 0, fz: -1, run: true, jump: false }, 25);
  assert.ok(p.z <= data.bounds + 1e-6);
});

test('跳躍會離地再落地', () => {
  const p = fresh(0, 40);
  let maxY = 0, landed = false;
  step(p, { fx: 0, fz: 0, run: false, jump: true }, 1 / 60, world);
  for (let i = 0; i < 120; i++) { const r = step(p, { fx: 0, fz: 0, run: false, jump: false }, 1 / 60, world); maxY = Math.max(maxY, p.y); landed ||= r.landed; }
  assert.ok(maxY > 0.5 && maxY < 1.2, `maxY=${maxY}`);
  assert.equal(p.y, 0);
  assert.ok(landed);
});

test('區域判定：廣場與四條大道', () => {
  assert.equal(zoneAt(0, 0), 'P');
  assert.equal(zoneAt(0, -60), 'N');
  assert.equal(zoneAt(60, 3), 'E');
  assert.equal(zoneAt(0, 60), 'S');
  assert.equal(zoneAt(-60, -3), 'W');
});

test('場景資料完整：碰撞、光源、動畫、區域名稱', () => {
  assert.ok(data.colliders.length > 150);
  assert.ok(data.lights.length > 100);
  for (const k of ['N', 'E', 'S', 'W', 'P']) assert.ok(data.zones[k].name && data.zones[k].en);
  assert.ok(data.parts.some((p) => p.kind === 'spin') && data.parts.some((p) => p.kind === 'float'));
  assert.ok(!data.colliders.some((c) => c.tag === 'far'));
});

test('洪水填充：玩家只能到街道、廣場與小巷，鑽不進大樓後方', () => {
  const S = 0.5, W = data.avenueHalf, R = data.ring, B = data.bounds;
  const key = (i, j) => `${i},${j}`;
  const free = (x, z) => !resolve({ x, z }, RADIUS, world.colliders, B);
  const seen = new Set([key(0, 32)]), queue = [[0, 32]];
  let outside = 0;
  while (queue.length) {
    const [i, j] = queue.pop(), x = i * S, z = j * S;
    if (!(Math.abs(x) <= W + 0.6 || Math.abs(z) <= W + 0.6 || Math.hypot(x, z) <= R + 4)) outside++;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + a, nj = j + b, k = key(ni, nj);
      if (seen.has(k) || Math.abs(ni * S) > B || Math.abs(nj * S) > B || !free(ni * S, nj * S)) continue;
      seen.add(k); queue.push([ni, nj]);
    }
  }
  // 小巷：寬 4 m、深 8 m，每條約 130 格（0.25 m²），最多 8 條
  assert.ok(outside * S * S < 8 * 4 * 8 + 40, `街道外可到達面積 ${outside * S * S} m²，可能有縫`);
  assert.ok(seen.size * S * S > 4000, '可走面積太小，可能被擋死');
});

test('被傳送到紀念碑裡面會被推出來，但不會被彈飛', () => {
  const p = fresh(0, 0);
  walk(p, { fx: 0, fz: 0, run: false, jump: false }, 1);
  assert.ok(Math.hypot(p.x, p.z) >= 9 + RADIUS - 0.05 && Math.hypot(p.x, p.z) < 14, `r=${Math.hypot(p.x, p.z)}`);
  assert.ok(Math.hypot(p.vx, p.vz) < RUN * 1.06);
});

test('線上 CSP 相容：沒有內嵌 import map，也沒有裸模組名稱', async () => {
  const { readFileSync, readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../site/games/community/neon-arcade-street/', import.meta.url).pathname;
  assert.ok(!/importmap/.test(readFileSync(join(root, 'index.html'), 'utf8')), '平台 CSP 不允許內嵌腳本');
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const f of walk(root).filter((x) => x.endsWith('.js'))) {
    const bare = readFileSync(f, 'utf8').match(/^\s*(?:import|export)\b[^'"\n]*from\s+['"](?![./])[^'"]+['"]/gm);
    assert.equal(bare, null, `${f} 有裸模組名稱匯入：${bare}`);
  }
});
