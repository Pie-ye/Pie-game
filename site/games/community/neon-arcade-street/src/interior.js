import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { prepare } from './physics.js';

// All visible architecture and cabinets are Kenney Mini Arcade CC0 meshes.
// Dimensions are metres. The root is separate so the street can stop rendering.
export const ROOM_Z = -240;
export async function loadArcade() {
  const root = new THREE.Group();
  root.name = 'kenney_arcade'; root.position.z = ROOM_Z; root.visible = false;
  const names = ['floor', 'wall', 'wall-door-rotate', 'arcade-machine', 'pinball', 'claw-machine', 'dance-machine', 'prize-wheel', 'vending-machine'];
  const loader = new GLTFLoader();
  const library = Object.fromEntries(await Promise.all(names.map(async name =>
    [name, (await loader.loadAsync(`./assets/interior/kenney-mini-arcade/${name}.glb`)).scene])));
  const colliders = [], machines = [], tinted = new Map();
  // Normalize the pack's different pivots once, preserving the source geometry.
  function place(name, x, z, { height, size, yaw = 0, y = 0, tint } = {}) {
    const item = library[name].clone(true);
    const box = new THREE.Box3().setFromObject(item), d = box.getSize(new THREE.Vector3());
    const scale = size ? new THREE.Vector3(size[0] / d.x, size[1] / d.y, size[2] / d.z)
      : new THREE.Vector3().setScalar(height / d.y);
    item.position.set(-(box.min.x + d.x / 2) * scale.x, -box.min.y * scale.y, -(box.min.z + d.z / 2) * scale.z);
    item.scale.copy(scale);
    const anchor = new THREE.Group(); anchor.position.set(x, y, z); anchor.rotation.y = yaw; anchor.add(item); root.add(anchor);
    if (tint) item.traverse(o => {
      if (!o.isMesh) return;
      const key = o.material.uuid + tint;
      if (!tinted.has(key)) {
        const material = o.material.clone(); material.color.set(tint); material.roughness = 0.8;
        tinted.set(key, material);
      }
      o.material = tinted.get(key);
    });
    anchor.updateWorldMatrix(true, true);
    return anchor;
  }
  function solid(item, tag) {
    const b = new THREE.Box3().setFromObject(item);
    colliders.push({ t: 'obb', cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2,
      ax: 1, az: 0, hw: (b.max.x - b.min.x) / 2, hd: (b.max.z - b.min.z) / 2, tag });
  }
  // Contiguous 2m tiles; raised underside supplies a closed ceiling using pack floors.
  for (let x = -5; x <= 5; x += 2) for (let z = -3; z <= 3; z += 2) {
    place('floor', x, z, { size: [2, .05, 2], y: -.05, tint: '#9280ba' });
    place('floor', x, z, { size: [2, .08, 2], y: 3.4, tint: '#786a9c' });
  }
  for (let x = -5; x <= 5; x += 2) {
    solid(place('wall', x, -4.2, { size: [2, 3.4, .4], tint: '#baa3e3' }), 'wall');
    if (Math.abs(x) > 1) solid(place('wall', x, 4.2, { size: [2, 3.4, .4], yaw: Math.PI, tint: '#baa3e3' }), 'wall');
  }
  for (const x of [-6.2, 6.2]) for (let z = -3; z <= 3; z += 2)
    solid(place('wall', x, z, { size: [2, 3.4, .4], yaw: Math.PI / 2, tint: '#baa3e3' }), 'wall');
  // Four metre entry bay: a full source doorway, no generated doorway geometry.
  place('wall-door-rotate', 0, 4.2, { size: [4, 3.4, .5], yaw: Math.PI });
  function cabinet(name, x, z, height, yaw = 0, label = '') {
    const item = place(name, x, z, { height, yaw }); solid(item, 'cabinet');
    machines.push({ x, z: z + ROOM_Z, name, label });
  }
  cabinet('arcade-machine', -4.5, -2.85, 1.9, 0, '街機');
  cabinet('arcade-machine', -2.9, -2.85, 1.9, 0, '街機');
  cabinet('dance-machine', .1, -2.7, 2.1, 0, '跳舞機');
  cabinet('pinball', 3.4, -2.6, 1.65, 0, '彈珠台');
  cabinet('claw-machine', 4.65, .5, 2, -Math.PI / 2, '夾娃娃機');
  cabinet('vending-machine', -4.8, .3, 1.95, Math.PI / 2, '販賣機');
  cabinet('prize-wheel', -3.9, 2.7, 1.85, Math.PI / 2, '幸運轉盤');
  const ambient = new THREE.HemisphereLight(0xe8ddff, 0x292039, 2.4); root.add(ambient);
  for (const [color, x, z] of [[0x5ee1ff, -3.6, -1], [0xff8fd0, 3.6, -1]]) {
    const light = new THREE.PointLight(color, 16, 10, 2); light.position.set(x, 2.8, z); root.add(light);
  }
  // Batch repeated imported tiles/walls. Geometry/material stay shared with the pack.
  const batches = new Map(), meshes = [];
  root.updateWorldMatrix(true, true);
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const inverse = root.matrixWorld.clone().invert();
  for (const mesh of meshes) {
    const key = `${mesh.geometry.uuid}/${mesh.material.uuid}`;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(mesh);
  }
  for (const group of batches.values()) {
    if (group.length < 2) continue;
    const batch = new THREE.InstancedMesh(group[0].geometry, group[0].material, group.length);
    group.forEach((mesh, i) => { batch.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)); mesh.removeFromParent(); });
    batch.computeBoundingSphere(); root.add(batch);
  }
  return { root, machines, colliders: prepare(colliders),
    bounds: { minX: -5.64, maxX: 5.64, minZ: ROOM_Z - 3.64, maxZ: ROOM_Z + 3.64 },
    makeEntrance() {
      const door = library['wall-door-rotate'].clone(true);
      const b = new THREE.Box3().setFromObject(door), d = b.getSize(new THREE.Vector3());
      door.scale.set(2.7 / d.x, 3.2 / d.y, .6 / d.z);
      door.position.set(-(b.min.x + d.x / 2) * door.scale.x, -b.min.y * door.scale.y, -(b.min.z + d.z / 2) * door.scale.z);
      const entry = new THREE.Group(); entry.add(door); entry.position.set(10.45, 0, 49.1); entry.rotation.y = Math.PI / 2;
      return entry;
    } };
}
