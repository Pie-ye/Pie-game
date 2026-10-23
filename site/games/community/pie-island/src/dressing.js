import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { groundAt } from './layout.js';

// 第二輪生成模型還沒到的擺設：噴水池、路燈、攤位、碼頭、帳棚、石頭、花。
// 尺寸是公尺。模型原點在接地處，本地 +Z 朝南，rotation.y 用擺設的 r。

const geoCache = new Map();
const matCache = new Map();
function geo(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
function mat(hex, name = '') {
  const key = `${hex}|${name}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: 1, name }));
  return matCache.get(key);
}
function flat(hex, opacity = 1) {
  const key = `flat|${hex}|${opacity}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshBasicMaterial({
      color: hex, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    }));
  }
  return matCache.get(key);
}

const STONE = () => mat('#E6E0D4', 'stone');
const STONE_DARK = () => mat('#C9A380', 'stone');
const WOOD = () => mat('#CBA97A', 'wood');
const WOOD_DARK = () => mat('#A8743E', 'wood');
const CREAM = () => mat('#F4EFE6');
const ROOF = () => mat('#C47A4A', 'roof');
const BRASS = () => mat('#C4925A', 'wood');
const CORAL = () => mat('#E25B45');
const LEAF = () => mat('#587760', 'leafsGreen');
const GRASS = () => mat('#9EB14E', 'grass');
const GRASS_HI = () => mat('#C6CE6B', 'grass');

const box = (w, h, d) => geo(`box${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, n = 12) => geo(`cyl${rt}_${rb}_${h}_${n}`, () => new THREE.CylinderGeometry(rt, rb, h, n));
const sph = (r, n = 14) => geo(`sph${r}_${n}`, () => new THREE.SphereGeometry(r, n, Math.max(8, n - 4)));
const cone = (r, h, n = 7) => geo(`cone${r}_${h}_${n}`, () => new THREE.ConeGeometry(r, h, n));

const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _s2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const propM = new THREE.Matrix4();
const localM = new THREE.Matrix4();
const outM = new THREE.Matrix4();

function place(buckets, prop, parts) {
  const y = prop.y ?? groundAt(prop.x, prop.z);
  propM.compose(_p.set(prop.x, y, prop.z), _q.setFromAxisAngle(_up, prop.r || 0), _s.setScalar(prop.s || 1));
  for (const part of parts) {
    localM.compose(
      _p2.set(part.x || 0, part.y || 0, part.z || 0),
      _q2.setFromEuler(_e.set(part.rx || 0, part.ry || 0, part.rz || 0)),
      _s2.set(part.sx ?? 1, part.sy ?? 1, part.sz ?? 1),
    );
    outM.multiplyMatrices(propM, localM);
    const key = `${part.geo.uuid}|${part.mat.uuid}|${part.shadow ? 1 : 0}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { geo: part.geo, mat: part.mat, shadow: !!part.shadow, matrices: [] };
      buckets.set(key, bucket);
    }
    bucket.matrices.push(outM.clone());
  }
}

const P = (geo, mat, y, extra = {}) => ({ geo, mat, y, shadow: true, ...extra });

function fountain() {
  return [
    P(cyl(2.05, 1.9, 0.5, 20), STONE(), 0.25),
    P(cyl(2.2, 2.2, 0.1, 20), CREAM(), 0.52, { shadow: false }),
    P(cyl(0.85, 0.95, 0.72, 16), STONE(), 0.9),
    P(cyl(1.15, 1.05, 0.16, 18), STONE(), 1.28),
    P(cyl(0.95, 0.95, 0.06, 18), flat('#8BCCC6', 0.9), 1.26, { shadow: false }),
    P(cyl(0.07, 0.1, 0.55, 8), flat('#F7FBFF'), 1.55, { shadow: false }),
  ];
}
function lantern() {
  return [
    P(cyl(0.06, 0.08, 1.55, 8), WOOD(), 0.78),
    P(box(0.32, 0.42, 0.32), BRASS(), 1.72),
    P(box(0.18, 0.22, 0.18), flat('#F6E2C4'), 1.72, { shadow: false }),
    P(cyl(0.2, 0.2, 0.06, 8), BRASS(), 1.96, { shadow: false }),
  ];
}
function stall() {
  return [
    P(box(1.7, 0.85, 0.7), WOOD(), 0.42),
    P(cyl(0.05, 0.05, 1.35, 6), WOOD_DARK(), 0.68, { x: -0.75, z: 0.28 }),
    P(cyl(0.05, 0.05, 1.35, 6), WOOD_DARK(), 0.68, { x: 0.75, z: 0.28 }),
    P(box(2.05, 0.08, 1.25), CREAM(), 1.4),
    P(box(1.9, 0.35, 0.04), ROOF(), 1.15, { z: 0.62, shadow: false }),
  ];
}
function bench() {
  return [
    P(box(1.25, 0.08, 0.38), WOOD(), 0.46),
    P(box(1.25, 0.4, 0.08), WOOD(), 0.7, { z: -0.16 }),
    P(box(0.08, 0.46, 0.34), WOOD_DARK(), 0.23, { x: -0.5 }),
    P(box(0.08, 0.46, 0.34), WOOD_DARK(), 0.23, { x: 0.5 }),
  ];
}
function cart() {
  return [
    P(box(1.05, 0.48, 0.68), WOOD(), 0.62),
    P(cyl(0.28, 0.28, 0.08, 12), WOOD_DARK(), 0.28, { x: -0.48, rz: Math.PI / 2 }),
    P(cyl(0.28, 0.28, 0.08, 12), WOOD_DARK(), 0.28, { x: 0.48, rz: Math.PI / 2 }),
  ];
}
function dock() {
  return [
    P(box(3.2, 0.16, 3.15), WOOD(), 0.08),
    P(cyl(0.08, 0.08, 1.1, 6), WOOD_DARK(), -0.4, { x: -1.4, z: -1.3 }),
    P(cyl(0.08, 0.08, 1.1, 6), WOOD_DARK(), -0.4, { x: 1.4, z: -1.3 }),
    P(cyl(0.08, 0.08, 1.1, 6), WOOD_DARK(), -0.4, { x: -1.4, z: 1.3 }),
    P(cyl(0.08, 0.08, 1.1, 6), WOOD_DARK(), -0.4, { x: 1.4, z: 1.3 }),
  ];
}
function boat() {
  return [
    P(box(0.7, 0.28, 1.7), WOOD(), 0.14),
    P(box(0.5, 0.08, 0.4), WOOD_DARK(), 0.28, { shadow: false }),
  ];
}
function ship() {
  return [
    P(box(1.3, 0.7, 3.4), WOOD(), 0.35),
    P(cyl(0.06, 0.06, 2.4, 6), WOOD_DARK(), 1.7),
    P(box(0.06, 1.5, 1.1), CREAM(), 1.85, { shadow: false }),
  ];
}
function barrel() {
  return [P(cyl(0.28, 0.26, 0.48, 10), WOOD(), 0.24)];
}
function crate() {
  return [P(box(0.55, 0.5, 0.55), WOOD(), 0.25)];
}
function chest() {
  return [
    P(box(0.6, 0.32, 0.38), WOOD(), 0.16),
    P(box(0.62, 0.1, 0.4), WOOD_DARK(), 0.36, { shadow: false }),
  ];
}
function flag() {
  return [
    P(cyl(0.04, 0.04, 1.7, 6), WOOD(), 0.85),
    P(box(0.55, 0.32, 0.04), ROOF(), 1.5, { x: 0.28, shadow: false }),
  ];
}
function rock(tall) {
  return [P(sph(1, 12), STONE_DARK(), tall ? 0.85 : 0.55, { sy: tall ? 1.35 : 0.62 })];
}
function tent() {
  return [
    P(box(2.3, 0.08, 1.7), CORAL(), 1.05, { rx: 0.85 }),
    P(box(2.3, 0.08, 1.7), CORAL(), 1.05, { rx: -0.85 }),
    P(box(1.5, 0.06, 0.9), CREAM(), 0.5, { shadow: false }),
  ];
}
function fire() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    parts.push(P(sph(0.16, 8), STONE_DARK(), 0.1, { x: Math.cos(a) * 0.42, z: Math.sin(a) * 0.42, shadow: false }));
  }
  parts.push(P(cone(0.16, 0.48, 6), flat('#E25B45'), 0.4, { shadow: false }));
  parts.push(P(cone(0.08, 0.28, 5), flat('#F6E2C4'), 0.52, { shadow: false }));
  return parts;
}
function log() {
  return [P(cyl(0.14, 0.14, 1.5, 8), WOOD_DARK(), 0.14, { rz: Math.PI / 2 })];
}
function canoe() {
  return [P(box(0.5, 0.22, 2.3), WOOD(), 0.11)];
}
function sign() {
  return [
    P(cyl(0.05, 0.05, 1.0, 6), WOOD(), 0.5),
    P(box(0.7, 0.42, 0.06), CREAM(), 1.05, { shadow: false }),
  ];
}
function pumpkin() {
  return [P(sph(0.22, 10), ROOF(), 0.18, { shadow: false }), P(cone(0.06, 0.12, 5), LEAF(), 0.38, { shadow: false })];
}
function melon() {
  return [P(sph(0.2, 10), LEAF(), 0.16, { shadow: false })];
}
function carrot() {
  return [P(cone(0.07, 0.26, 6), CORAL(), 0.13, { shadow: false }), P(cone(0.08, 0.12, 5), GRASS_HI(), 0.3, { shadow: false })];
}
function fence() {
  return [
    P(cyl(0.04, 0.04, 0.7, 5), WOOD(), 0.35, { x: -0.9 }),
    P(cyl(0.04, 0.04, 0.7, 5), WOOD(), 0.35, { x: 0.9 }),
    P(box(1.9, 0.06, 0.04), WOOD(), 0.55, { shadow: false }),
    P(box(1.9, 0.06, 0.04), WOOD(), 0.32, { shadow: false }),
  ];
}
function tuft() {
  return [P(cone(0.22, 0.46, 5), GRASS(), 0.23, { shadow: false })];
}
const FLOWER = ['#F4E2C4', '#C6CE6B', '#E7B6C8'];
function flower(prop) {
  return [
    P(cyl(0.015, 0.015, 0.32, 5), LEAF(), 0.16, { shadow: false }),
    P(sph(0.09, 8), mat(FLOWER[prop.tint || 0]), 0.36, { shadow: false }),
  ];
}
function mushroom(prop) {
  const red = Math.abs(Math.sin(prop.x * 12.9 + prop.z)) < 0.22;
  return [
    P(cyl(0.05, 0.06, 0.16, 6), CREAM(), 0.08, { shadow: false }),
    P(sph(0.12, 8), red ? CORAL() : ROOF(), 0.18, { sy: 0.6, shadow: false }),
  ];
}

const BUILD = {
  'dress/fountain': fountain,
  'dress/lantern': lantern,
  'dress/stall': stall,
  'dress/bench': bench,
  'dress/cart': cart,
  'dress/dock': dock,
  'dress/boat': boat,
  'dress/ship': ship,
  'dress/barrel': barrel,
  'dress/crate': crate,
  'dress/chest': chest,
  'dress/flag': flag,
  'dress/rock': () => rock(false),
  'dress/rock-tall': () => rock(true),
  'dress/tent': tent,
  'dress/fire': fire,
  'dress/log': log,
  'dress/canoe': canoe,
  'dress/sign': sign,
  'dress/pumpkin': pumpkin,
  'dress/melon': melon,
  'dress/carrot': carrot,
  'dress/fence': fence,
  'dress/tuft': tuft,
  'dress/flower': flower,
  'dress/mushroom': mushroom,
};

export function makeDressing(props, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'dressing';
  const buckets = new Map();
  for (const prop of props) {
    const build = BUILD[prop.model];
    if (build) place(buckets, prop, build(prop));
  }
  for (const bucket of buckets.values()) {
    const inst = new THREE.InstancedMesh(bucket.geo, bucket.mat, bucket.matrices.length);
    bucket.matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = shadows && bucket.shadow;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}
