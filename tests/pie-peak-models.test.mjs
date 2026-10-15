import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { ITEMS } from '../site/games/community/pie-peak/src/items.js';
import { generate } from '../site/games/community/pie-peak/src/worldgen.js';

const dir = new URL('../site/games/community/pie-peak/assets/models/', import.meta.url);
async function parse(name) {
  const file = await readFile(new URL(`${name}.glb`, dir));
  assert.equal(file.readUInt32LE(0), 0x46546c67, `${name}: glTF magic`);
  assert.equal(file.readUInt32LE(8), file.length, `${name}: declared length`);
  const jsonLength = file.readUInt32LE(12);
  return { doc: JSON.parse(file.subarray(20, 20 + jsonLength).toString()), size: file.length };
}

const HUMANOID = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  ...['L', 'R'].flatMap((s) => [`Shoulder_${s}`, `UpperArm_${s}`, `LowerArm_${s}`, `Hand_${s}`, `Fingers_${s}`, `UpperLeg_${s}`, `LowerLeg_${s}`, `Foot_${s}`])];

for (const name of ['phoebe', 'fluorolo']) {
  test(`${name} is a skinned humanoid with arm and hand bones for climbing`, async () => {
    const { doc, size } = await parse(name);
    assert.equal(doc.skins.length, 1);
    const joints = doc.skins[0].joints.map((i) => doc.nodes[i].name);
    for (const bone of HUMANOID) assert.ok(joints.includes(bone), `${name} missing bone ${bone}`);
    const attrs = doc.meshes[0].primitives[0].attributes;
    assert.ok(attrs.JOINTS_0 !== undefined && attrs.WEIGHTS_0 !== undefined && attrs.NORMAL !== undefined && attrs.TEXCOORD_0 !== undefined);
    assert.ok(size < 4_000_000, `${name} is ${size} bytes`);
    assert.ok(doc.images.length === 1 && doc.images[0].mimeType === 'image/jpeg');
  });
}

test('reggie is skinned with flipper and head bones', async () => {
  const { doc } = await parse('reggie');
  const joints = doc.skins[0].joints.map((i) => doc.nodes[i].name);
  for (const bone of ['Root', 'Hips', 'Spine', 'Head', 'FlipperF1_L', 'FlipperF2_R', 'FlipperR1_L', 'FlipperR2_R']) assert.ok(joints.includes(bone), bone);
});

test('every item and every world prop the game asks for ships as a GLB', async () => {
  const names = new Set(Object.values(ITEMS).map((i) => i.model));
  for (const extra of ['luggage', 'supply_drop', 'flytrap', 'beehive', 'rescue_helicopter', 'portable_stove', 'bomb_cheese', 'dynamite_bundle', 'backpack']) names.add(extra);
  for (const seed of [20261015, 7, 99]) for (const p of generate(seed).props) names.add(p.model);
  const missing = [];
  for (const n of names) { try { await stat(new URL(`${n}.glb`, dir)); } catch { missing.push(n); } }
  assert.deepEqual(missing, []);
});

test('the game stays within the 50 MB / 25 MiB per-file platform limits', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../site/games/community/pie-peak/', import.meta.url);
  let total = 0;
  async function walk(url) {
    for (const e of await readdir(url, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), url);
      if (e.isDirectory()) await walk(u); else { const s = (await stat(u)).size; total += s; assert.ok(s < 25 * 1024 * 1024, `${e.name} too large`); }
    }
  }
  await walk(root);
  assert.ok(total < 50_000_000, `total ${total}`);
});
