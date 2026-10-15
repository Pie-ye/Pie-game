// Asset loading: GLB models (Hunyuan3D output, rigged characters), textures, sky panoramas.
// Missing files fall back to simple primitives so the game always boots.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const base = (p) => new URL(`../assets/${p}`, import.meta.url).href;

// 4-band toon ramp: crisp cel shading that still shows the baked Hunyuan texture.
const ramp = new THREE.DataTexture(new Uint8Array([110, 170, 220, 255]), 4, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
export const toonRamp = ramp;

export function toon(src, opts = {}) {
  const m = new THREE.MeshToonMaterial({ map: src.map || null, color: src.color ? src.color.clone() : 0xffffff, gradientMap: ramp,
    side: opts.double ? THREE.DoubleSide : THREE.FrontSide, transparent: !!src.transparent, opacity: src.opacity ?? 1,
    vertexColors: !!opts.vertexColors, emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 1 });
  if (m.map) { m.map.anisotropy = 4; m.map.colorSpace = THREE.SRGBColorSpace; }
  if (opts.gain) m.color.multiplyScalar(opts.gain);
  return m;
}

const modelCache = new Map();
export const missing = new Set();

function fallback(name) {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshToonMaterial({ color: 0xb8a070, gradientMap: ramp }));
  mesh.position.y = 0.5; g.add(mesh); g.userData.size = new THREE.Vector3(1, 1, 1); g.userData.fallback = true;
  return g;
}

// Normalised template: centred on x/z, resting on y=0. Clone it for each placement.
export function loadModel(name, opts = {}) {
  const key = name + (opts.gain ? `@${opts.gain}` : '');
  if (!modelCache.has(key)) {
    modelCache.set(key, new Promise((resolve) => {
      loader.load(base(`models/${name}.glb`), (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => {
          if (o.isMesh) {
            // Hunyuan exports carry no normals; without them toon shading goes black.
            if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
            o.material = toon(o.material, { gain: opts.gain ?? 1.0, double: true });
            o.castShadow = true; o.receiveShadow = false;
          }
        });
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
        const holder = new THREE.Group();
        root.position.set(-c.x, -box.min.y, -c.z);
        holder.add(root); holder.userData.size = s;
        resolve(holder);
      }, undefined, () => { missing.add(name); resolve(fallback(name)); });
    }));
  }
  return modelCache.get(key);
}

// Fit a model into the given width/height (uniform scale) and return a new node.
export async function place(name, { height, width, scale, gain } = {}) {
  const t = await loadModel(name, { gain });
  const size = t.userData.size, node = new THREE.Group(), inner = t.clone();
  let k = scale ?? 1;
  if (scale === undefined) k = height !== undefined ? height / size.y : width !== undefined ? width / Math.max(size.x, size.z) : 1;
  inner.scale.setScalar(k); node.add(inner); node.userData.size = size.clone().multiplyScalar(k);
  return node;
}

const texCache = new Map();
export function loadTexture(name, { repeat = true, srgb = true } = {}) {
  if (!texCache.has(name)) {
    const t = texLoader.load(base(`tex/${name}`), undefined, undefined, () => {});
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(name, t);
  }
  return texCache.get(name);
}
export function loadSky(name) {
  const t = loadTexture(`${name}.jpg`, { repeat: false });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

// A skinned, rigged character (Hunyuan mesh + Colab/Blender skeleton). Height normalised to `height` metres.
export async function loadCharacter(id, height = 1.3) {
  const gltf = await new Promise((resolve, reject) => loader.load(base(`models/${id}.glb`), resolve, undefined, reject));
  const model = gltf.scene;
  const holder = new THREE.Group();
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  const s = height / size.y;
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  model.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.material = toon(o.material, { gain: id === 'reggie' ? 2.0 : 1.35, double: true });
      o.frustumCulled = false; o.castShadow = true;
    }
  });
  holder.add(model);
  return { holder, model, scale: s, size: size.multiplyScalar(s) };
}
export function preload(names, onProgress) {
  let done = 0;
  return Promise.all(names.map((n) => loadModel(n).then((m) => { onProgress?.(++done, names.length); return m; })));
}
