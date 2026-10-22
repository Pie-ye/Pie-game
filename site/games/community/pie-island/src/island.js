import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import {
  TERRAIN_SIZE, terrainHeight, groundAt, groundColor, HOUSES, HOUSE_HALF, WATER_Y,
} from './layout.js';

// 小島的 3D 場景：地形、海、天空、雲、Kenney CC0 模型（實例化）與小屋。

const MODEL_DIR = './assets/models/';
const NO_SHADOW = /flower|grass|lily|mushroom|crop|campfire|rock_small|path/;
// Nature Kit 原本是偏藍的青綠色；改成動森那種偏黃、暖一點的綠（只改材質顏色，不改模型）
const RECOLOR = {
  grass: '#5fb04c', leafsGreen: '#62c04c', leafsDark: '#3f9a46', stone: '#cfc8b8', woodBark: '#a8744a', dirt: '#b98a5a',
};

export function makeTerrain(segments = 220) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const [r, g, b] = groundColor(x, z);
    c.setRGB(r, g, b, THREE.SRGBColorSpace);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** 海水：用地形高度圖算水深，淺處透出沙子、岸邊有一波波浪花 */
export function makeWater() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * TERRAIN_SIZE - TERRAIN_SIZE / 2, z = (j + 0.5) / N * TERRAIN_SIZE - TERRAIN_SIZE / 2;
    const h = terrainHeight(x, z);
    data[(j * N + i) * 4] = Math.round(Math.min(1, Math.max(0, (h + 3.2) / 6.7)) * 255);
    data[(j * N + i) * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uSize: { value: TERRAIN_SIZE },
    uShallow: { value: new THREE.Color('#7ee8da') },
    uDeep: { value: new THREE.Color('#2a8bd6') },
  }]);
  uniforms.uHeight = { value: tex };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uSize; uniform sampler2D uHeight;
      uniform vec3 uShallow; uniform vec3 uDeep;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = vWorld.xz / uSize + 0.5;
        float h = -3.2;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) h = texture2D(uHeight, uv).r * 6.7 - 3.2;
        float depth = max(0.0, -h);
        vec3 col = mix(uShallow, uDeep, smoothstep(0.05, 2.8, depth));
        // 水面的光斑
        float ripple = sin(vWorld.x * 1.3 + uTime * 1.1 + sin(vWorld.z * 0.7)) * sin(vWorld.z * 1.1 - uTime * 0.9 + sin(vWorld.x * 0.5));
        col += vec3(0.09) * smoothstep(0.82, 0.98, ripple);
        // 岸邊浪花：一波一波往岸上推
        float wave = fract(uTime * 0.22 + vWorld.x * 0.004);
        float band = 0.55 * (1.0 - wave);
        float foam = smoothstep(0.08, 0.0, abs(depth - band)) * (1.0 - wave) * step(depth, 0.7);
        foam = max(foam, smoothstep(0.1, 0.0, depth));
        col = mix(col, vec3(1.0), foam * 0.85);
        float alpha = mix(0.42, 0.93, smoothstep(0.0, 1.4, depth));
        alpha = max(alpha, foam * 0.9);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_Y;
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return { mesh, update(t) { mat.uniforms.uTime.value = t; } };
}

export function makeSky() {
  const geo = new THREE.SphereGeometry(420, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color('#4fb0f2') }, uHorizon: { value: new THREE.Color('#d9f3ff') }, uSun: { value: new THREE.Vector3(-0.45, 0.55, 0.7).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; varying vec3 vDir;
      void main(){
        float k = smoothstep(-0.05, 0.55, vDir.y);
        vec3 col = mix(uHorizon, uTop, k);
        float s = max(0.0, dot(normalize(vDir), uSun));
        col += vec3(1.0, 0.95, 0.8) * (pow(s, 300.0) * 1.2 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  return sky;
}

export function makeClouds(seedRand) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfefff', emissiveIntensity: 0.35, roughness: 1, flatShading: false });
  const ball = new THREE.SphereGeometry(1, 16, 10);
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    const n = 4 + Math.floor(seedRand() * 4);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(ball, mat);
      const s = 4 + seedRand() * 4;
      m.scale.set(s * 1.3, s * 0.75, s);
      m.position.set((k - n / 2) * 4.2 + seedRand() * 2, seedRand() * 1.6, seedRand() * 3);
      c.add(m);
    }
    const a = seedRand() * Math.PI * 2, r = 90 + seedRand() * 140;
    c.position.set(Math.cos(a) * r, 42 + seedRand() * 26, Math.sin(a) * r);
    c.rotation.y = seedRand() * Math.PI;
    group.add(c);
  }
  group.name = 'clouds';
  return group;
}

// ---------- 模型 ----------
async function loadModel(loader, name) {
  const gltf = await loader.loadAsync(`${MODEL_DIR}${name}.glb`);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m && m.isMeshStandardMaterial) {
      m.roughness = Math.max(0.8, m.roughness); m.metalness = 0;
      if (RECOLOR[m.name]) m.color.set(RECOLOR[m.name]);
    }
    parts.push({ geometry: o.geometry, material: m, matrix: o.matrixWorld.clone() });
  });
  return parts;
}

/** 依名稱載入模型（並行），每個名稱只載一次 */
export async function loadModels(names, onProgress) {
  const loader = new GLTFLoader();
  const out = new Map();
  let done = 0;
  await Promise.all([...new Set(names)].map(async (n) => {
    try { out.set(n, await loadModel(loader, n)); }
    catch (err) { console.warn('模型載入失敗', n, err); out.set(n, []); }
    done++; onProgress && onProgress(done / names.length);
  }));
  return out;
}

/** 把擺設清單變成實例化網格：同一個模型的所有擺放只畫一次 */
export function instanceProps(models, props, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'props';
  const byModel = new Map();
  for (const p of props) {
    if (!byModel.has(p.model)) byModel.set(p.model, []);
    byModel.get(p.model).push(p);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), tmp = new THREE.Matrix4();
  for (const [name, list] of byModel) {
    const parts = models.get(name) || [];
    for (const part of parts) {
      const inst = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      list.forEach((p, i) => {
        pos.set(p.x, p.y ?? groundAt(p.x, p.z) - 0.02, p.z);
        q.setFromAxisAngle(up, p.r || 0);
        scl.setScalar(p.s || 1);
        m4.compose(pos, q, scl);
        tmp.multiplyMatrices(m4, part.matrix);
        inst.setMatrixAt(i, tmp);
      });
      inst.castShadow = shadows && !NO_SHADOW.test(name);
      inst.receiveShadow = true;
      inst.name = name;
      inst.computeBoundingSphere();
      group.add(inst);
    }
  }
  return group;
}

// ---------- 小屋：Kenney 木牆片（3×3 格）＋程式做的屋頂與信箱 ----------
export const HOUSE_PARTS = ['town/wall-wood', 'town/wall-wood-door', 'town/wall-wood-window-shutters', 'town/chimney'];
const CELL = HOUSE_HALF * 2 / 3;

export function makeHouses(models, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'houses';
  const placeParts = (parent, name, x, y, z, rot, s) => {
    for (const part of models.get(name) || []) {
      const m = new THREE.Mesh(part.geometry, part.material);
      const holder = new THREE.Group();
      holder.position.set(x, y, z); holder.rotation.y = rot; holder.scale.setScalar(s);
      m.applyMatrix4(part.matrix);
      m.castShadow = shadows; m.receiveShadow = true;
      holder.add(m); parent.add(holder);
    }
  };
  for (const h of HOUSES) {
    const house = new THREE.Group();
    const base = groundAt(h.x, h.z) - 0.05;
    house.position.set(h.x, base, h.z);
    house.rotation.y = h.rot;
    // 牆：外圈 8 格，門在 +z 正中，其他三面中間是窗
    const sides = [
      { rot: -Math.PI / 2, cells: [[-1, 1], [0, 1], [1, 1]] },   // +z（門）
      { rot: Math.PI / 2, cells: [[-1, -1], [0, -1], [1, -1]] },  // −z
      { rot: 0, cells: [[1, -1], [1, 0], [1, 1]] },               // +x
      { rot: Math.PI, cells: [[-1, -1], [-1, 0], [-1, 1]] },      // −x
    ];
    sides.forEach((side, si) => side.cells.forEach(([i, j], k) => {
      const name = k === 1 ? (si === 0 ? 'town/wall-wood-door' : 'town/wall-wood-window-shutters') : 'town/wall-wood';
      placeParts(house, name, i * CELL, 0, j * CELL, side.rot, CELL);
    }));
    // 地板
    const floor = new THREE.Mesh(new THREE.BoxGeometry(HOUSE_HALF * 2, 0.16, HOUSE_HALF * 2), new THREE.MeshStandardMaterial({ color: '#c8a77a', roughness: 0.9 }));
    floor.position.y = 0.04; floor.receiveShadow = true; house.add(floor);
    // 屋頂：兩片斜板＋兩面山牆
    const W = HOUSE_HALF, over = 0.5, rise = 1.75, wallTop = CELL;
    const half = W + over;
    const slope = Math.atan2(rise, half);
    const len = Math.hypot(half, rise) + 0.12;
    const roofMat = new THREE.MeshStandardMaterial({ color: h.roof, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + over * 2, 0.2, len), roofMat);
      slab.position.set(0, wallTop + rise / 2 + 0.08, s * half / 2);
      slab.rotation.x = s * slope;
      slab.castShadow = shadows; slab.receiveShadow = true;
      house.add(slab);
    }
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, W * 2 + over * 2 + 0.1, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color(h.roof).multiplyScalar(0.8), roughness: 0.7 }));
    ridge.rotation.z = Math.PI / 2; ridge.position.y = wallTop + rise + 0.12; house.add(ridge);
    const shape = new THREE.Shape([new THREE.Vector2(-W, 0), new THREE.Vector2(W, 0), new THREE.Vector2(0, rise)]);
    const gableGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    const gableMat = new THREE.MeshStandardMaterial({ color: '#f4e7c9', roughness: 0.9 });
    for (const s of [-1, 1]) {
      const g = new THREE.Mesh(gableGeo, gableMat);
      g.rotation.y = Math.PI / 2;
      g.position.set(s > 0 ? W - 0.12 : -W, wallTop, 0);
      g.castShadow = shadows; house.add(g);
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshStandardMaterial({ color: '#9fd8ff', emissive: '#4a7a9a', emissiveIntensity: 0.25, roughness: 0.3 }));
      win.position.set(s * (W + 0.03), wallTop + rise * 0.4, 0); win.rotation.y = s * Math.PI / 2; house.add(win);
    }
    placeParts(house, 'town/chimney', -W * 0.45, wallTop + rise * 0.35, -half * 0.35, 0, 1.6);
    // 信箱
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), new THREE.MeshStandardMaterial({ color: '#8d6b4a' }));
    post.position.set(W + 0.6, 0.45, W + 1.0); house.add(post);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.45), roofMat);
    box.position.set(W + 0.6, 0.98, W + 1.0); box.castShadow = shadows; house.add(box);
    group.add(house);
  }
  return group;
}
