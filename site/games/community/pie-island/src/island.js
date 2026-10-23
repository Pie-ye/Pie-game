import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import {
  TERRAIN_SIZE, terrainHeight, groundAt, groundColor, groundSplat, HOUSES, HOUSE_HALF, WATER_Y,
} from './layout.js';
import { RAMP, applyShadow, SCENE_STEPS, addInkShell } from './style.js';

// 小島的 3D 場景：地形、海、天空、雲、Kenney CC0 模型（實例化）與小屋。

const MODEL_DIR = './assets/models/';
const NO_SHADOW = /flower|grass|lily|mushroom|crop|campfire|rock_small|path/;
// Kenney 材質名 → 聖經色票。亮綠這個名字若出現，另外設成草的亮筆。
const RECOLOR = {
  grass: '#587760', leafsGreen: '#587760', leafsDark: '#3A5C4E', leafsLight: '#C6CE6B',
  stone: '#C9A380', woodBark: '#A8743E', dirt: '#9D836A',
};
// 第二輪模型還沒到的 Kenney：依路徑乘上同一套色，整座島先坐進色票。
const PATH_TINT = [
  [/tree_pine|tree_default|tree-high|tree_tall|\/tree$/, '#587760'],
  [/lantern/, '#C4925A'],
  [/fountain/, '#E6E0D4'],
  [/stall|bench/, '#C47A4A'],
  [/dock|boat|barrel|crate|chest|canoe/, '#CBA97A'],
  [/rock|stone_large/, '#C9A380'],
  [/tent/, '#E25B45'],
];

const TEX_DIR = './assets/tex/';
/** 地形：有生成的地面貼圖就用貼圖混合（動漫畫風），沒有就退回頂點色 */
export function makeTerrain(segments = 220, textured = true) {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 4);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    if (textured) {
      const w = groundSplat(x, z);
      splat.set([w.sand, w.path, w.plaza, w.cliff], i * 4);
      c.setRGB(w.tint, w.tint, w.tint, THREE.SRGBColorSpace);
    } else {
      const [r, g, b] = groundColor(x, z);
      c.setRGB(r, g, b, THREE.SRGBColorSpace);
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.computeVertexNormals();
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP });
  if (textured) {
    const loader = new THREE.TextureLoader();
    const load = (n) => {
      const t = loader.load(`${TEX_DIR}${n}.jpg`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      return t;
    };
    const uniforms = { tGrass: { value: load('grass') }, tSand: { value: load('sand') }, tPath: { value: load('path') }, tPlaza: { value: load('plaza') }, tCliff: { value: load('cliff') } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aSplat; varying vec4 vSplat; varying vec3 vPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = aSplat; vPos = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tGrass, tSand, tPath, tPlaza, tCliff; varying vec4 vSplat; varying vec3 vPos;')
        .replace('#include <map_fragment>', `
          vec2 uvA = vPos.xz / 2.2;
          vec2 uvB = vPos.xz / 1.15 + vec2(0.37, 0.18);
          vec3 g = mix(texture2D(tGrass, uvA).rgb, texture2D(tGrass, uvB).rgb, 0.45);
          float l = dot(g, vec3(0.299, 0.587, 0.114));
          vec3 base = mix(vec3(0.427, 0.482, 0.212), vec3(0.620, 0.694, 0.306), smoothstep(0.22, 0.55, l));
          base = mix(base, vec3(0.776, 0.808, 0.420), smoothstep(0.55, 0.82, l));
          base = mix(base, texture2D(tSand, vPos.xz / 8.0).rgb, vSplat.x);
          base = mix(base, texture2D(tPath, vPos.xz / 4.5).rgb, vSplat.y);
          vec3 plaza = texture2D(tPlaza, vPos.xz / 6.5).rgb;
          float lp = dot(plaza, vec3(0.299, 0.587, 0.114));
          plaza = mix(vec3(lp), vec3(0.820, 0.740, 0.600), 0.82);
          base = mix(base, plaza, vSplat.z);
          base = mix(base, texture2D(tCliff, vec2(vPos.x + vPos.z, vPos.y * 1.6) / 4.0).rgb, vSplat.w);
          diffuseColor.rgb *= base;`);
    };
  }
  applyShadow(mat, { color: '#6E7B36', t: 0.55, steps: SCENE_STEPS, soft: 0.04 });
  const terrainShade = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    terrainShade.call(mat, shader, renderer);
    const from = 'vec3 shadowCol = uDarkMul > 0.0 ? albedo * uDarkMul : mix(albedo, uShadow * dot(albedo, vec3(0.333)) * 1.4, uShadowT);';
    const to = `vec3 shadowTint = mix(vec3(0.427, 0.482, 0.212), vec3(0.894, 0.788, 0.643), vSplat.x);
    shadowTint = mix(shadowTint, vec3(0.894, 0.824, 0.682), max(vSplat.y, vSplat.z));
    float grassW = clamp(1.0 - vSplat.x - vSplat.y - vSplat.z - vSplat.w, 0.0, 1.0);
    vec3 shadowCol = mix(albedo, shadowTint * dot(albedo, vec3(0.333)) * 1.4, mix(0.25, 0.55, grassW));`;
    shader.fragmentShader = shader.fragmentShader.replaceAll(from, to);
  };
  const mesh = new THREE.Mesh(geo, mat);
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
    uSand: { value: new THREE.Color('#F0E1C6') },
    uShallow: { value: new THREE.Color('#8BCCC6') },
    uDeep: { value: new THREE.Color('#3E94B0') },
    uFoam: { value: new THREE.Color('#F7FBFF') },
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
      uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSand; uniform vec3 uFoam;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = vWorld.xz / uSize + 0.5;
        float h = -3.2;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) h = texture2D(uHeight, uv).r * 6.7 - 3.2;
        float depth = max(0.0, -h);
        // 近岸透沙，很快進淺水，1 公尺左右就到外海色。池心 1.1 m 因此不再整池薄荷綠。
        vec3 col = mix(uSand, uShallow, smoothstep(0.02, 0.22, depth));
        col = mix(col, uDeep, smoothstep(0.45, 1.3, depth));
        float ripple = sin(vWorld.x * 1.3 + uTime * 1.1 + sin(vWorld.z * 0.7)) * sin(vWorld.z * 1.1 - uTime * 0.9 + sin(vWorld.x * 0.5));
        float spark = smoothstep(0.94, 0.995, ripple);
        col = mix(col, uFoam, spark * 0.28);
        float foam = smoothstep(0.18, 0.0, depth);
        col = mix(col, uFoam, foam * 0.35);
        float alpha = mix(0.78, 0.94, smoothstep(0.05, 0.6, depth));
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
    uniforms: {
      uMap: { value: null }, uHasMap: { value: 0 },
      uTop: { value: new THREE.Color('#90BEDF') }, uHorizon: { value: new THREE.Color('#E7F3F8') },
      uCloud: { value: new THREE.Color('#F5F6F0') }, uShade: { value: new THREE.Color('#C3C7D3') },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D uMap; uniform float uHasMap;
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uCloud; uniform vec3 uShade;
      varying vec3 vDir;
      void main(){
        vec3 dir = normalize(vDir);
        float k = smoothstep(0.0, 0.62, dir.y);
        vec3 col = mix(uHorizon, uTop, k);
        if (uHasMap > 0.5) {
          vec2 uv = vec2(atan(dir.z, dir.x) / 6.2831853 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265 + 0.5);
          float l = dot(texture2D(uMap, uv).rgb, vec3(0.299, 0.587, 0.114));
          float cloud = smoothstep(0.62, 0.88, l);
          float belly = smoothstep(0.40, 0.58, l) * (1.0 - cloud);
          col = mix(col, uShade, belly * 0.8);
          col = mix(col, uCloud, cloud);
        }
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
  if (name.startsWith('anime/')) normalize(gltf.scene);
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();   // Hunyuan3D 的 GLB 沒有法線
    const m = o.material;
    if (m && m.isMeshStandardMaterial) {
      m.roughness = Math.max(0.8, m.roughness); m.metalness = 0;
      if (RECOLOR[m.name]) m.color.set(RECOLOR[m.name]);
      if (/bright|leafsLight|grassLight/i.test(m.name || '')) m.color.set('#C6CE6B');
      if (name.startsWith('anime/')) m.userData.leaf = name.includes('lotus') ? 'lotus' : 'leaf';
      else {
        const tint = PATH_TINT.find(([re]) => re.test(name));
        if (tint) m.color.set(tint[1]);
      }
    }
    parts.push({ geometry: o.geometry, material: m, matrix: o.matrixWorld.clone() });
  });
  return parts;
}

/** Hunyuan3D 生成的模型：置中、腳貼地、高度正規化成 1 公尺（擺放時的 s 就是高度） */
function normalize(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = 1 / Math.max(1e-6, size.y);
  const wrap = new THREE.Group();
  while (root.children.length) wrap.add(root.children[0]);
  wrap.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  root.add(wrap);
  root.scale.setScalar(k);
}

/**
 * 動漫畫風模型的替換表：清單（assets/models/anime/manifest.json）裡有的，就把對應的 Kenney 模型換掉。
 * manifest：{ "models": { "palm_a": { "height": 5.2, "replaces": ["nature/tree_palmTall", ...], "radius": 0.35 } } }
 */
export async function applyAnimeModels(props) {
  let manifest;
  try { manifest = await (await fetch(`${MODEL_DIR}anime/manifest.json`)).json(); } catch (_err) { return props; }
  const table = new Map();
  for (const [name, m] of Object.entries(manifest.models || {})) for (const r of m.replaces || []) {
    if (!table.has(r)) table.set(r, []);
    table.get(r).push({ name: `anime/${name}`, ...m });
  }
  let i = 0;
  return props.map((p) => {
    const alts = table.get(p.model);
    if (!alts) return p;
    const a = alts[(i++) % alts.length];
    const spread = a.name.endsWith('/lotus') ? 1 : (0.85 + ((Math.sin(p.x * 12.9 + p.z * 78.2) + 1) / 2) * 0.3);
    const h = a.height * spread;
    return { ...p, model: a.name, s: h };
  });
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
export const HOUSE_PARTS = ['town/wall-wood', 'town/wall-wood-door', 'town/wall-wood-window-shutters'];
const CELL = HOUSE_HALF * 2 / 3;

export function makeHouses(models, { shadows = true } = {}) {
  const group = new THREE.Group();
  group.name = 'houses';
  const placeParts = (parent, name, x, y, z, rot, s) => {
    for (const part of models.get(name) || []) {
      let material = part.material;
      if (name.startsWith('town/wall-wood') && material) {
        material = material.clone();
        material.color.set(name.includes('door') ? '#CBA97A' : '#F4EFE6');
        material.roughness = 1;
        material.map = null;
        if (material.emissive) material.emissive.set('#000000');
        material.emissiveIntensity = 0;
      }
      const m = new THREE.Mesh(part.geometry, material);
      const holder = new THREE.Group();
      holder.position.set(x, y, z); holder.rotation.y = rot; holder.scale.setScalar(s);
      m.applyMatrix4(part.matrix);
      m.castShadow = shadows; m.receiveShadow = true;
      if (name.startsWith('town/wall-wood')) addInkShell(m);
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
    const roofMat = new THREE.MeshStandardMaterial({ name: 'roof', color: '#C47A4A', roughness: 0.7 });
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + over * 2, 0.2, len), roofMat);
      slab.position.set(0, wallTop + rise / 2 + 0.08, s * half / 2);
      slab.rotation.x = s * slope;
      slab.castShadow = shadows; slab.receiveShadow = true;
      addInkShell(slab);
      house.add(slab);
    }
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, W * 2 + over * 2 + 0.1, 12), new THREE.MeshStandardMaterial({ name: 'roof', color: '#A8743E', roughness: 0.7 }));
    ridge.rotation.z = Math.PI / 2; ridge.position.y = wallTop + rise + 0.12;
    addInkShell(ridge);
    house.add(ridge);
    const shape = new THREE.Shape([new THREE.Vector2(-W, 0), new THREE.Vector2(W, 0), new THREE.Vector2(0, rise)]);
    const gableGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
    const gableMat = new THREE.MeshStandardMaterial({ color: '#f4e7c9', roughness: 0.9 });
    for (const s of [-1, 1]) {
      const g = new THREE.Mesh(gableGeo, gableMat);
      g.rotation.y = Math.PI / 2;
      g.position.set(s > 0 ? W - 0.12 : -W, wallTop, 0);
      g.castShadow = shadows; addInkShell(g); house.add(g);
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), new THREE.MeshStandardMaterial({ color: '#B7D0C8', emissive: '#000000', emissiveIntensity: 0, roughness: 0.6 }));
      win.position.set(s * (W + 0.03), wallTop + rise * 0.4, 0); win.rotation.y = s * Math.PI / 2; house.add(win);
    }
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.85, 0.42), new THREE.MeshStandardMaterial({ name: 'stone', color: '#C9A380', roughness: 1 }));
    chimney.position.set(-W * 0.45, wallTop + rise * 0.55, -half * 0.35);
    chimney.castShadow = shadows;
    house.add(chimney);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.1, 0.54), new THREE.MeshStandardMaterial({ name: 'stone', color: '#E6E0D4', roughness: 1 }));
    cap.position.set(-W * 0.45, wallTop + rise * 0.55 + 0.46, -half * 0.35);
    house.add(cap);
    // 信箱
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), new THREE.MeshStandardMaterial({ color: '#8d6b4a' }));
    post.position.set(W + 0.6, 0.45, W + 1.0); house.add(post);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.45), new THREE.MeshStandardMaterial({ name: 'wood', color: '#CBA97A', roughness: 0.8 }));
    box.position.set(W + 0.6, 0.98, W + 1.0); box.castShadow = shadows; house.add(box);
    group.add(house);
  }
  return group;
}
