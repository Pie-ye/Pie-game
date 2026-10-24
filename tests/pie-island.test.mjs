import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorld, blocked, step, groundAt, terrainHeight, plateauFactor, spawnPoint, zoneAt,
  HOUSES, DOCK, DOCK_TOP, PLATEAU, RAMP, POND, coastDist, scatterProps, pathDist, PLAZA_R,
} from '../site/games/community/pie-island/src/layout.js';
import {
  FIELDS, DEFAULT_LOOK, sanitize, encode, decode, randomLook, sizeOf, loadLook, saveLook, sameLook, KEYS,
} from '../site/games/community/pie-island/src/look.js';

const world = buildWorld();

// 從出生點開始的格狀 BFS：回傳走得到的格子集合
function reachable(start, cell = 0.5) {
  const key = (i, j) => `${i},${j}`;
  const seen = new Set([key(Math.round(start.x / cell), Math.round(start.z / cell))]);
  const queue = [[Math.round(start.x / cell), Math.round(start.z / cell)]];
  while (queue.length) {
    const [i, j] = queue.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj, k = key(ni, nj);
      if (seen.has(k) || Math.abs(ni * cell) > 70 || Math.abs(nj * cell) > 80) continue;
      if (blocked(world, ni * cell, nj * cell)) continue;
      // 相鄰格高低差太大（懸崖）也算走不過去
      if (Math.abs(groundAt(ni * cell, nj * cell) - groundAt(i * cell, j * cell)) > 0.5) continue;
      seen.add(k); queue.push([ni, nj]);
    }
  }
  return (x, z) => seen.has(key(Math.round(x / cell), Math.round(z / cell)));
}
const canReach = reachable(spawnPoint(() => 0.5));

test('出生點在陸地上、站得住、不在廣場噴水池裡', () => {
  for (let i = 0; i < 20; i++) {
    const p = spawnPoint(Math.random);
    assert.equal(blocked(world, p.x, p.z), false);
    assert.ok(groundAt(p.x, p.z) > 0.3);
    assert.ok(Math.hypot(p.x, p.z) > PLAZA_R - 1);
  }
});

test('每間小屋的門口都走得到，屋子本身擋得住', () => {
  for (const h of HOUSES) {
    assert.ok(canReach(h.door[0], h.door[1]), `門口 ${h.door} 走不到`);
    assert.equal(blocked(world, h.x, h.z), true);
    assert.ok(pathDist(h.door[0], h.door[1]) < 0, '門口有步道');
  }
});

test('碼頭可以走到盡頭，高度是甲板高度', () => {
  const z = DOCK.z1 - 1;
  assert.ok(canReach(0, z));
  assert.equal(groundAt(0, z), DOCK_TOP);
  assert.ok(terrainHeight(0, z) < -1, '碼頭盡頭底下是深水');
  assert.equal(blocked(world, 6, z), true, '碼頭旁邊的深水不能走');
});

test('高台只能從坡道上去，台頂走得到', () => {
  assert.ok(plateauFactor(PLATEAU.x, PLATEAU.z) > 0.99);
  assert.ok(canReach(PLATEAU.x + 2, PLATEAU.z + 4), '台頂走不到');
  const midRamp = (RAMP.zTop + RAMP.zBottom) / 2;
  const cx = (RAMP.x0 + RAMP.x1) / 2;
  assert.ok(canReach(cx, midRamp), '坡道走不到');
  // 高台邊緣其他地方是懸崖
  for (const a of [0, 1, 2.2, 3.1, 4]) {
    let r = 0;
    while (plateauFactor(PLATEAU.x + Math.cos(a) * r, PLATEAU.z + Math.sin(a) * r) > 0.5) r += 0.05;
    assert.equal(blocked(world, PLATEAU.x + Math.cos(a) * r, PLATEAU.z + Math.sin(a) * r), true, `角度 ${a} 的崖邊沒擋`);
  }
});

test('池塘與外海不能走進去，淺灘可以', () => {
  assert.equal(blocked(world, POND.x, POND.z), true);
  // 找一個沙灘外 2 公尺的淺水點
  const a = 0.3, r0 = Math.hypot(30, 5);
  let shallow = null;
  for (let r = r0; r < 70; r += 0.25) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (coastDist(x, z) < -1.5) { shallow = [x, z]; break; }
  }
  assert.ok(shallow);
  assert.equal(blocked(world, ...shallow), false, '淺灘可以涉水');
  assert.equal(blocked(world, 80, 0), true, '遠海不能走');
});

test('擺設是固定種子：每個玩家看到的島一樣', () => {
  const a = scatterProps(), b = scatterProps();
  assert.deepEqual(a, b);
  assert.ok(a.length > 300);
  for (const p of a.filter((x) => x.c > 0)) assert.ok(coastDist(p.x, p.z) > 0, `${p.model} 在海裡`);
});

test('移動：撞牆會沿牆滑、跳起來會落地', () => {
  let s = { x: 0, y: groundAt(0, 13), z: 13, vy: 0, air: false, heading: 0 };
  for (let i = 0; i < 60; i++) s = step(world, s, { mx: 0, mz: -1, run: false, jump: false }, 1 / 30).state;
  assert.ok(Math.hypot(s.x, s.z) > 2.3 + 0.3 - 0.01, '不會穿過噴水池');
  s = step(world, s, { mx: 0, mz: 0, jump: true }, 1 / 30).state;
  assert.equal(s.air, true);
  for (let i = 0; i < 60; i++) s = step(world, s, { mx: 0, mz: 0 }, 1 / 30).state;
  assert.equal(s.air, false);
  assert.ok(Math.abs(s.y - groundAt(s.x, s.z)) < 1e-9);
});

test('地點名稱', () => {
  assert.equal(zoneAt(0, 3), '噴水池廣場');
  assert.equal(zoneAt(0, DOCK.z1 - 2), '小碼頭');
  assert.equal(zoneAt(PLATEAU.x, PLATEAU.z), '瞭望高台');
});

test('外觀：預設值合法、亂傳的值被擋掉', () => {
  assert.deepEqual(sanitize(DEFAULT_LOOK), { ...DEFAULT_LOOK });
  const bad = sanitize({ skin: 99, eyes: -1, hair: 1.5, hat: '2', glasses: 2, __proto__: { x: 1 } });
  assert.equal(bad.skin, DEFAULT_LOOK.skin);
  assert.equal(bad.eyes, DEFAULT_LOOK.eyes);
  assert.equal(bad.hair, DEFAULT_LOOK.hair);
  assert.equal(bad.hat, DEFAULT_LOOK.hat);
  assert.equal(bad.glasses, 2);
  assert.deepEqual(Object.keys(bad), KEYS);
  assert.deepEqual(decode('nope'), { ...DEFAULT_LOOK });
  assert.deepEqual(decode([1e9]), { ...DEFAULT_LOOK });
});

test('外觀：編碼來回不變、隨機結果都在範圍內', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) {
    const l = randomLook(rand);
    for (const f of FIELDS) assert.ok(l[f.key] >= 0 && l[f.key] < sizeOf(f), f.key);
    assert.ok(sameLook(decode(encode(l)), l));
    assert.ok(JSON.stringify(encode(l)).length < 200, '網路訊息很小');
  }
});

test('外觀：存檔讀檔', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadLook(storage), null);
  const l = { ...DEFAULT_LOOK, hair: 3, hat: 1 };
  saveLook(l, storage);
  assert.ok(sameLook(loadLook(storage), l));
  mem.set('pie-island.look.v2', '{broken');
  assert.equal(loadLook(storage), null);
});

// ---------- 靜態檢查：平台 CSP 與素材 ----------
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixedProps } from '../site/games/community/pie-island/src/layout.js';

const gameDir = join(dirname(fileURLToPath(import.meta.url)), '../site/games/community/pie-island');
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

test('線上 CSP 相容：沒有內嵌腳本、import map、裸模組名稱或外部網址', () => {
  const html = readFileSync(join(gameDir, 'index.html'), 'utf8');
  assert.ok(!/importmap/.test(html));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), '不能有內嵌 script');
  for (const f of walk(join(gameDir, 'src'))) {
    const js = readFileSync(f, 'utf8');
    for (const m of js.matchAll(/from\s+'([^']+)'/g)) assert.ok(m[1].startsWith('.'), `${f} 匯入了裸模組 ${m[1]}`);
    assert.ok(!/https?:\/\//.test(js.replace(/\/\/.*$/gm, '')), `${f} 有外部網址`);
  }
});

test('擺設用到的模型檔都在，整包大小在平台限制內', () => {
  const names = new Set([...buildWorld().props.map((p) => p.model), 'town/wall-wood', 'town/wall-wood-door', 'town/wall-wood-window-shutters', 'town/chimney', 'house/roof', 'house/gable', 'house/floor', 'house/mailbox']);
  for (const n of names) {
    assert.ok(!n.startsWith('dress/'), `地圖還有程式模型 ${n}`);
    assert.ok(existsSync(join(gameDir, 'assets/models', `${n}.glb`)), `缺 ${n}.glb`);
  }
  assert.ok(fixedProps().length > 50);
  const files = walk(gameDir);
  const total = files.reduce((s, f) => s + statSync(f).size, 0);
  assert.ok(total < 50e6, `整包 ${total} bytes`);
  for (const f of files) assert.ok(statSync(f).size < 25 * 1024 * 1024, `${f} 太大`);
  for (const dir of ['nature', 'pirate', 'town']) assert.ok(existsSync(join(gameDir, 'assets/models', dir, 'LICENSE.txt')), `${dir} 缺授權檔`);
});
