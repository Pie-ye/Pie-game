// Three.js view of a Game: terrain meshes merged from the collision boxes, GLB props, items, hazards, the rigged
// characters, weather particles, sky/fog per biome and the follow camera.
import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { loadModel, place, loadTexture, loadSky, toon, loadCharacter } from './assets.js';
import { BIOMES } from './worldgen.js';
import { ITEMS } from './items.js';
import { Rig } from './rig.js';
import { Particles } from './fx.js';
import { PLAYER } from './solids.js';

const TEX = {
  sand: 'rock_beach', rock: null, moss: 'rock_jungle', snow: 'rock_alpine', ice: 'ice', basalt: 'rock_volcano', lava: 'rock_volcano',
  ladder: 'wood_plank', wood: 'wood_plank', fragile: 'rock_beach', rubble: 'rock_volcano', thorn: null, bounce: null,
};
const SKIP_KINDS = new Set(['bounce', 'thorn']);
const PROP_MODELS = new Set();
const lerpAngle = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; };

function noiseVec(x, y, z, amp) {
  return [
    (Math.sin(x * 1.7 + y * 2.3) + Math.sin(z * 2.9 - y * 1.1)) * 0.5 * amp,
    (Math.sin(y * 2.1 + z * 1.3) + Math.sin(x * 1.9 + z * 2.2)) * 0.5 * amp * 0.5,
    (Math.sin(z * 1.8 + x * 2.6) + Math.sin(y * 2.7 - x * 1.4)) * 0.5 * amp,
  ];
}
function rockGeometry(b, uvScale = 0.25, topMaterial = 0) {
  const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0, seg = (L) => Math.max(1, Math.min(18, Math.round(L / 1.7)));
  const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  const smooth = !b.ledge && !b.deco && b.kind !== 'ladder';
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, z * uvScale, y * uvScale); else if (ay >= az) uv.setXY(i, x * uvScale, z * uvScale); else uv.setXY(i, x * uvScale, y * uvScale);
    if (b.kind !== 'ladder' && !b.ground) { const o = noiseVec(x, y, z, smooth ? 0.13 : 0.07); p.setXYZ(i, x + o[0], y + o[1], z + o[2]); }
  }
  g.computeVertexNormals();
  // BoxGeometry draws +x,-x,+y,-y,+z,-z as groups 0..5: the +y face (walkable top) may use a separate ground material.
  for (const grp of g.groups) grp.materialIndex = grp.materialIndex === 2 ? topMaterial : 0;
  return g;
}

// Split a displaced box into walls (everything but +y) and tops (+y), so tops can use the biome ground texture.
function splitTop(g) {
  const idx = g.index.array, wall = [], top = [];
  for (const grp of g.groups) {
    const dst = grp.materialIndex === 1 ? top : wall;
    for (let i = grp.start; i < grp.start + grp.count; i++) dst.push(idx[i]);
  }
  const a = g.clone(), b = g.clone();
  a.clearGroups(); b.clearGroups(); a.setIndex(wall); b.setIndex(top);
  return [a, b];
}

export class SceneView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.scene.fog = new THREE.Fog(0xbfe6ff, 40, 170);
    this.hemi = new THREE.HemisphereLight(0xdff1ff, 0x6b7a5a, 1.55); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d6, 2.1); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); const sc = this.sun.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    this.fx = new Particles(this.scene);
    this.cam = { yaw: 0, pitch: 0.42, dist: 6.2, pos: new THREE.Vector3(), target: new THREE.Vector3(), shake: 0 };
    this.dynamic = { items: new Map(), luggage: new Map(), hazards: new Map(), projectiles: new Map(), ropes: new Map(), flares: [], stoves: [], baits: [], bombs: [], pitons: [] };
    this.biomeIndex = -1; this.fogTarget = new THREE.Color(0xbfe6ff); this.skyCache = {};
    this.world = new THREE.Group(); this.scene.add(this.world);
    this.time = 0; this.lights = new THREE.Group(); this.scene.add(this.lights);
    this.resize(); window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fx.mat.uniforms.scale.value = h * 0.9 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / 2;
  }

  clear() {
    for (const o of [this.world, this.char?.holder, this.reggie?.holder, this.glider, this.lantern, this.pack, this.heli?.n]) if (o) this.scene.remove(o);
    for (const l of [...this.lights.children]) this.lights.remove(l);
    for (const f of this.flames || []) this.scene.remove(f.light);
    for (const m of this.dynamic.hazards.values()) if (m.parent === this.scene) this.scene.remove(m);
    for (const m of this.dynamic.projectiles.values()) this.scene.remove(m);
    for (const m of this.dynamic.ropes.values()) this.scene.remove(m);
    for (const k of Object.keys(this._lm || {})) for (const n of this._lm[k].values()) this.scene.remove(n);
    this._lm = {}; this.propNodes = null; this.flames = []; this.rubbleNodes = null; this.heli = null; this.char = null; this.rig = null; this.reggie = null; this.yawVis = undefined;
    this.dynamic = { items: new Map(), luggage: new Map(), hazards: new Map(), projectiles: new Map(), ropes: new Map(), flares: [], stoves: [], baits: [], bombs: [], pitons: [] };
    this.world = new THREE.Group(); this.scene.add(this.world); this.biomeIndex = -1;
  }
  // ---------- build ----------
  async build(game, onProgress = () => {}) {
    this.game = game;
    const L = game.level;
    this.skies = {}; for (const b of BIOMES) this.skies[b.id] = loadSky(b.sky);
    this.scene.background = this.skies.shore;
    // terrain boxes merged per material
    const groups = new Map();
    for (const b of L.world.boxes) {
      if (b.deco && b.kind === 'bounce') continue;
      if (SKIP_KINDS.has(b.kind) || b.kind === 'hold' || b.kind === 'crystal') continue;
      const texName = b.ground ? 'ground_sand' : (b.tex && b.tex !== 'crystal' && b.tex !== 'bounce' ? b.tex : TEX[b.kind] || 'rock_beach');
      const key = `${texName}|${b.kind}|${b.ground ? 'g' : ''}|${b.deco ? 'd' : ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    this.boxMeshes = new Map();
    for (const [key, list] of groups) {
      const [texName, kind, g, deco] = key.split('|');
      const tex = loadTexture(`${texName}.jpg`);
      const emissive = kind === 'lava' || texName === 'rock_volcano' && kind === 'basalt' ? 0xff5a1a : 0x000000;
      const ramp = this.ramp();
      const mat = new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp, color: kind === 'ice' ? 0xcfe8ff : kind === 'snow' ? 0xf2f6ff : 0xffffff,
        emissive, emissiveMap: kind === 'lava' ? tex : null, emissiveIntensity: kind === 'lava' ? 0.9 : texName === 'rock_volcano' ? 0.12 : 0 });
      if (kind === 'ice') { mat.transparent = true; mat.opacity = 0.88; }
      // walkable tops use the biome's ground texture (grass, snow, ash) instead of the cliff texture
      const bi = list[0].bio;
      const useGround = !g && bi !== undefined && !['ice', 'ladder', 'fragile', 'rubble'].includes(kind) && !(kind === 'lava' && deco);
      const topMat = useGround ? new THREE.MeshToonMaterial({ map: loadTexture(`${BIOMES[bi].ground}.jpg`), gradientMap: ramp, color: 0xffffff, emissive: bi === 3 ? 0x331100 : 0x000000 }) : mat;
            // boxes that can disappear (fragile/rubble) keep their own mesh, the rest are merged
      const dyn = list.filter((b) => b.fragile || b.rubble || b.kind === 'fragile' || b.kind === 'rubble');
      const stat = list.filter((b) => !dyn.includes(b));
      const topIdx = useGround ? 1 : 0;
      if (stat.length) {
        const raw = stat.map((b) => rockGeometry(b, g ? 0.12 : 0.25, topIdx));
        if (useGround) {
          const pairs = raw.map(splitTop);
          const wallMesh = new THREE.Mesh(mergeGeometries(pairs.map((x) => x[0])), mat), topMesh = new THREE.Mesh(mergeGeometries(pairs.map((x) => x[1])), topMat);
          for (const m of [wallMesh, topMesh]) { m.castShadow = true; m.receiveShadow = true; this.world.add(m); }
          pairs.forEach((x) => { x[0].dispose(); x[1].dispose(); });
        } else {
          const mesh = new THREE.Mesh(mergeGeometries(raw.map((x) => { x.clearGroups(); return x; })), mat); mesh.castShadow = true; mesh.receiveShadow = true; this.world.add(mesh);
        }
        raw.forEach((x) => x.dispose());
      }
      for (const b of dyn) { const m = new THREE.Mesh(rockGeometry(b), mat); m.castShadow = m.receiveShadow = true; this.world.add(m); this.boxMeshes.set(b.id, m); }
    }
    // ladders: rungs
    const rungGeo = [], rungMat = toon({ color: new THREE.Color(0xb98550) });
    for (const b of L.world.boxes) {
      if (b.kind !== 'ladder') continue;
      for (let y = b.y0 + 0.3; y < b.y1; y += 0.42) { const r = new THREE.BoxGeometry(b.x1 - b.x0 + 0.2, 0.09, 0.12); r.translate((b.x0 + b.x1) / 2, y, b.z1 + 0.04); rungGeo.push(r); }
      for (const sx of [b.x0 - 0.02, b.x1 + 0.02]) { const r = new THREE.BoxGeometry(0.1, b.y1 - b.y0, 0.14); r.translate(sx, (b.y0 + b.y1) / 2, b.z1 + 0.04); rungGeo.push(r); }
    }
    if (rungGeo.length) { const m = new THREE.Mesh(mergeGeometries(rungGeo), rungMat); m.castShadow = true; this.world.add(m); }
    this.buildHolds(L);
    this.buildOcean(L);
    this.buildDistant(L);
    // props (GLBs)
    const props = L.props;
    let done = 0; const total = props.length + 40;
    await Promise.all(props.map(async (pr, i) => {
      const opts = {}; if (pr.height !== undefined) opts.height = pr.height; else if (pr.width !== undefined) opts.width = pr.width;
      const node = await place(pr.model, { ...opts, gain: pr.model === 'campfire' ? 1.1 : 1 });
      node.position.set(pr.x, pr.y, pr.z); node.rotation.y = pr.rotY || 0;
      if (pr.rotX) { node.rotation.x = pr.rotX; node.position.y += (pr.width || 1) * 0.5; }
      if (pr.flipY) { const inner = node.children[0]; inner.rotation.x = Math.PI; inner.position.y = pr.height; }
      this.world.add(node); (this.propNodes ||= []).push(node);
      if (pr.icicle !== undefined) this.dynamic.hazards.set(`ici${pr.icicle}`, node);
      if (pr.rubble) { pr.node = node; (this.rubbleNodes ||= []).push(node); }
      if (pr.model === 'campfire' || pr.model === 'shrine_altar') this.addFlame(pr);
      if (pr.model === 'summit_beacon') { const l = new THREE.PointLight(0xaee6ff, 6, 30); l.position.set(pr.x, pr.y + 8.5, pr.z); this.scene.add(l); }
      onProgress(++done, total);
    }));
    // items & luggage & hazards visuals
    await this.buildEntities(game, (n) => onProgress(done + n, total));
    // the player
    await this.buildPlayer(game);
  }
  addFlame(pr) {
    const l = new THREE.PointLight(pr.model === 'campfire' ? 0xffa44a : 0xffe69a, pr.model === 'campfire' ? 6 : 5, 11);
    l.position.set(pr.x, pr.y + (pr.model === 'campfire' ? 0.9 : 3), pr.z); this.scene.add(l);
    (this.flames ||= []).push({ light: l, base: l.intensity, x: pr.x, y: pr.y + (pr.model === 'campfire' ? 0.7 : 0), z: pr.z, fire: pr.model === 'campfire' });
  }
  buildHolds(L) {
    const rockGeo = new THREE.IcosahedronGeometry(1, 1);
    const pos = rockGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * 1.0, pos.getY(i) * 0.7, pos.getZ(i) * 0.55 + 0.1 * Math.sin(i));
    rockGeo.computeVertexNormals();
    const byBiome = {};
    for (const h of L.world.holds) (byBiome[h.bi] ||= []).push(h);
    for (const [bi, list] of Object.entries(byBiome)) {
      const crystals = list.filter((h) => h.kind === 'crystal'), rocks = list.filter((h) => h.kind !== 'crystal');
      const tex = loadTexture(`${BIOMES[bi].tex}.jpg`);
      const mk = (geo, mat, arr, s) => {
        if (!arr.length) return;
        const im = new THREE.InstancedMesh(geo, mat, arr.length); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
        arr.forEach((h, i) => { e.set(0, (i * 1.7) % 6.28, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(h.x, h.y, h.z), q, new THREE.Vector3(s, s, s)); im.setMatrixAt(i, m); });
        im.castShadow = true; this.world.add(im);
      };
      mk(rockGeo, new THREE.MeshToonMaterial({ map: tex, color: 0xffffff, gradientMap: this.ramp() }), rocks, 0.28);
      mk(new THREE.OctahedronGeometry(1, 0), new THREE.MeshToonMaterial({ color: 0x7fd8ff, emissive: 0x3aa8ff, emissiveIntensity: 1.4, gradientMap: this.ramp() }), crystals, 0.22);
    }
  }
  ramp() { return this._ramp ||= (() => { const t = new THREE.DataTexture(new Uint8Array([110, 170, 220, 255]), 4, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; })(); }
  buildOcean(L) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), new THREE.MeshToonMaterial({ color: 0x45b7da, gradientMap: this.ramp() }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.6, 400); this.world.add(sea);
    this.sea = sea;
  }
  buildDistant(L) {
    const mats = BIOMES.map((b) => new THREE.MeshToonMaterial({ map: loadTexture(`${b.tex}.jpg`), gradientMap: this.ramp(), color: 0xffffff }));
    for (const d of L.wallDecor) {
      const g = rockGeometry({ x0: d.x - d.w / 2, x1: d.x + d.w / 2, y0: d.y - d.h / 2, y1: d.y + d.h / 2, z0: d.z - d.d / 2, z1: d.z + d.d / 2, kind: 'rock' }, 0.04);
      const m = new THREE.Mesh(g, mats[d.bi]); this.world.add(m);
    }
  }
  async buildEntities(game, progress) {
    let n = 0;
    const L = game.level;
    // luggage
    for (const l of game.luggage) {
      const node = await place('luggage', { height: 0.62 });
      node.position.set(l.x, l.y, l.z); node.rotation.y = (l.x * 7.3) % 6.28; this.world.add(node); this.dynamic.luggage.set(l, node); progress(++n);
    }
    // loose items (spinning)
    const ids = new Set(game.items.map((i) => i.id)); for (const id of ['apple', 'snack_pack', 'banana', 'scout_badge']) ids.add(id);
    await Promise.all([...ids].map((id) => loadModel(ITEMS[id].model)));
    this.ensureItemVisuals(game);
    // hazards
    for (const h of game.hazards) {
      if (h.type === 'flytrap') { const node = await place('flytrap', { height: 1.3 }); node.position.set(h.x, h.y, h.z); node.rotation.y = 0; this.world.add(node); this.dynamic.hazards.set(h.id, node); }
      if (h.type === 'bees') {
        const hive = await place('beehive', { height: 0.9 }); hive.position.set(h.sx ?? h.x, (h.sy ?? h.y) - 0.5, h.sz ?? h.z); this.world.add(hive);
        const geo = new THREE.SphereGeometry(0.06, 6, 4), mat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
        const im = new THREE.InstancedMesh(geo, mat, 14); im.frustumCulled = false; this.scene.add(im); this.dynamic.hazards.set(h.id, im);
      }
      if (h.type === 'geyser') {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 1, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.55, depthWrite: false }));
        col.visible = false; this.scene.add(col); this.dynamic.hazards.set(h.id, col);
      }
    }
    // static references for effects
    this.projGeo = new THREE.SphereGeometry(1, 12, 10);
  }
  ensureItemVisuals(game) {
    for (const it of game.items) {
      if (this.dynamic.items.has(it)) continue;
      const holder = new THREE.Group(); holder.position.set(it.x, it.y, it.z); this.world.add(holder);
      this.dynamic.items.set(it, holder);
      loadModel(ITEMS[it.id].model).then((t) => {
        const inner = t.clone(); const sz = t.userData.size; const k = (it.id === 'backpack' ? 0.72 : it.id === 'scout_badge' ? 0.36 : 0.5) / Math.max(sz.y, sz.x, sz.z) * (t.userData.fallback ? 0.5 : 1);
        inner.scale.setScalar(k); inner.position.y = 0.45; holder.add(inner); holder.userData.inner = inner;
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 24), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; holder.add(ring);
        const tint = new THREE.PointLight(0xffe9a8, 0.7, 3.2); tint.position.y = 0.8; holder.add(tint);
      });
    }
  }
  async buildPlayer(game) {
    const id = game.character;
    this.char = await loadCharacter(id, 1.3).catch(() => null);
    if (this.char) {
      this.scene.add(this.char.holder);
      this.rig = new Rig(this.char.holder, this.char.model);
    } else {
      // fallback capsule keeps the game playable if the model is missing
      const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.6, 4, 10), new THREE.MeshToonMaterial({ color: 0xffd36b })); m.position.y = 0.65; g.add(m);
      this.char = { holder: g, model: g, scale: 0.65 }; this.scene.add(g);
    }
    // Reggie rides on the hat
    try {
      const r = await loadCharacter('reggie', 0.5);
      this.reggie = r; this.scene.add(r.holder);
      r.holder.traverse((o) => { if (o.isMesh) o.castShadow = false; });
      this.reggieBones = {}; r.model.traverse((o) => { if (o.isBone) this.reggieBones[o.name] = o; });
    } catch { this.reggie = null; }
    // glider umbrella and backpack
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 12, 1, true), new THREE.MeshToonMaterial({ color: 0xff5a4a, side: THREE.DoubleSide, gradientMap: this.ramp() }));
    cone.visible = false; this.scene.add(cone); this.glider = cone;
    this.lantern = new THREE.PointLight(0xffd89a, 0, 9); this.scene.add(this.lantern);
    this.pack = null;
    place('backpack', { height: 0.5 }).then((n) => { n.visible = false; this.scene.add(n); this.pack = n; });
  }

  // ---------- per-frame ----------
  update(dt, game, input) {
    this.time += dt; const g = game, p = g.player;
    this.updateCamera(dt, g, input);
    this.updateCharacter(dt, g);
    this.updateEntities(dt, g);
    this.updateBiome(dt, g);
    this.updateWeather(dt, g);
    if (this.propNodes && (this._cull = (this._cull || 0) + dt) > 0.25) { this._cull = 0; const px = p.x, py = p.y, pz = p.z; for (const n of this.propNodes) n.visible = Math.abs(n.position.y - py) < 90 && Math.hypot(n.position.x - px, n.position.z - pz) < 130 && !n.userData.gone && !n.userData.hidden; }
    this.processEvents(g);
    this.updateHeli(dt, g);
    this.fx.update(dt);
    // shadow camera follows the player
    this.sun.position.set(p.x + 18, p.y + 40, p.z + 22); this.sun.target.position.set(p.x, p.y, p.z);
    this.sun.target.updateMatrixWorld();
    for (const f of this.flames || []) { f.light.intensity = f.base * (0.85 + Math.sin(this.time * 11 + f.x) * 0.1 + Math.random() * 0.08); if (f.fire && Math.hypot(f.x - p.x, f.z - p.z) < 40 && Math.random() < dt * 14) this.fx.emit({ x: f.x + (Math.random() - 0.5) * 0.4, y: f.y, z: f.z + (Math.random() - 0.5) * 0.4, vy: 1.6, life: 0.7, size: 0.28, color: [1, 0.6, 0.2], alpha: 0.8, grow: -0.6 }); }
    this.renderer.render(this.scene, this.camera);
  }
  updateCamera(dt, g, input) {
    const c = this.cam, p = g.player;
    if (input.lookYaw) c.yaw += input.lookYaw; if (input.lookPitch) c.pitch = THREE.MathUtils.clamp(c.pitch + input.lookPitch, -0.15, 1.2);
    if (input.zoom) c.dist = THREE.MathUtils.clamp(c.dist + input.zoom, 3.2, 12);
    const climbing = p.climbing;
    const ty = p.y + (climbing ? 0.95 : 0.8) + (p.state === 'faint' ? -0.4 : 0);
    c.target.x += (p.x - c.target.x) * Math.min(1, dt * 9); c.target.y += (ty - c.target.y) * Math.min(1, dt * 7); c.target.z += (p.z - c.target.z) * Math.min(1, dt * 9);
    const cp = Math.cos(c.pitch), dist = c.dist * (climbing ? 0.9 : 1);
    const dx = Math.sin(c.yaw) * cp * dist, dy = Math.sin(c.pitch) * dist + 0.4, dz = Math.cos(c.yaw) * cp * dist;
    let k = 1;
    const hit = g.world.raycast(c.target.x, c.target.y, c.target.z, dx / dist, dy / dist, dz / dist, dist + 0.3);
    if (hit) k = Math.max(0.25, (hit.t - 0.4) / dist);
    const shake = c.shake > 0 ? (c.shake -= dt, (Math.random() - 0.5) * c.shake * 0.5) : 0;
    this.camera.position.set(c.target.x + dx * k + shake, c.target.y + dy * k + shake, c.target.z + dz * k);
    this.camera.lookAt(c.target.x, c.target.y + 0.15, c.target.z);
  }
  updateCharacter(dt, g) {
    if (!this.char) return;
    const p = g.player, h = this.char.holder;
    this.yawVis = lerpAngle(this.yawVis ?? p.yaw, p.yaw, Math.min(1, dt * (p.climbing ? 30 : 14)));
    const hug = p.state === 'climb' ? 0.13 : p.state === 'pole' ? 0.04 : 0;
    const n = p.surf ? { x: p.surf.nx, z: p.surf.nz } : p.pole ? { x: Math.sin(p.poleAngle), z: Math.cos(p.poleAngle) } : { x: 0, z: 0 };
    h.position.set(p.x - n.x * hug, p.y, p.z - n.z * hug);
    h.rotation.set(0, this.yawVis, 0);
    if (p.state === 'faint') { h.rotation.x = -Math.PI / 2 + 0.2; h.position.y += 0.22; }
    if (p.state === 'ceiling') h.position.y -= 0.0;
    const speed = Math.hypot(p.vx, p.vz);
    if (this.rig) {
      const tr = p.surf ? { x: p.surf.nz, z: -p.surf.nx } : { x: 1, z: 0 };
      this.rig.update(dt, {
        state: p.state, speed, running: p.running, vy: p.vy, stun: p.stun, scale: this.char.scale, pos: new THREE.Vector3(p.x, p.y, p.z), yaw: p.yaw,
        nx: n.x, nz: n.z, wallDist: PLAYER.radius + 0.02, climbX: p.climbDir.x, climbY: p.climbDir.y, moveAmt: p.moveAmt, height: PLAYER.height,
        mantleT: p.mantle ? Math.min(1, p.mantle.t / p.mantle.dur) : 0, pullTarget: p.pull ? new THREE.Vector3(p.pull.target.x, p.pull.target.y + 1, p.pull.target.z) : null,
      });
      if (this.rig.bob) h.position.y += this.rig.bob;
    }
    // accessories
    this.glider.visible = p.state === 'glide';
    if (this.glider.visible) { this.glider.position.set(p.x, p.y + 2.0, p.z); this.glider.rotation.y = this.time; }
    if (this.pack) {
      const has = g.has('backpack'); this.pack.visible = has;
      if (has && this.rig) { const c = this.rig.boneWorld('Chest'); const back = new THREE.Vector3(0, 0.0, -0.2).applyQuaternion(h.quaternion); this.pack.position.copy(c).add(back); this.pack.position.y -= 0.18; this.pack.quaternion.copy(h.quaternion); }
    }
    this.lantern.intensity = g.lantern ? 5 : 0; this.lantern.position.set(p.x, p.y + 1.2, p.z);
    // Reggie on the hat
    if (this.reggie && this.rig) {
      const head = this.rig.boneWorld('Head', new THREE.Vector3());
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(h.quaternion);
      const r = this.reggie.holder, bob = Math.sin(this.time * 2.2) * 0.012;
      const lift = p.state === 'faint' ? 0.45 : 0.58;
      r.position.copy(head).addScaledVector(up, lift + bob); r.rotation.set(0, this.yawVis, 0); if (p.state === 'faint') r.rotation.x = -Math.PI / 2 + 0.2;
      const b = this.reggieBones;
      if (b.Head) b.Head.rotation.z = Math.sin(this.time * 1.7) * 0.18;
      const alarm = this.reggieAlarm > 0 ? (this.reggieAlarm -= dt, Math.sin(this.time * 30) * 0.5) : 0;
      for (const [name, sgn] of [['FlipperF1_L', 1], ['FlipperF1_R', -1]]) if (b[name]) b[name].rotation.z = sgn * (Math.sin(this.time * 4 + sgn) * 0.12 + alarm);
    }
  }
  updateEntities(dt, g) {
    // spin / hide items
    this.ensureItemVisuals(g);
    for (const [it, node] of this.dynamic.items) {
      if (it.taken) { if (node.parent) node.parent.remove(node); continue; }
      node.position.set(it.x, it.y, it.z);
      const inner = node.userData.inner; if (inner) { inner.rotation.y += dt * 1.6; inner.position.y = 0.45 + Math.sin(this.time * 2.4 + it.x) * 0.06; }
    }
    const reveal = g.time < g.revealUntil;
    for (const [l, node] of this.dynamic.luggage) {
      if (l.opened && !node.userData.opened) { node.userData.opened = true; node.rotation.x = -0.35; node.scale.multiplyScalar(0.94); this.fx.burst(l.x, l.y + 0.5, l.z, 14, { color: [1, 0.9, 0.5], speed: 2.5, size: 0.14, life: 0.7 }); }
      if (!l.opened && reveal && Math.hypot(l.x - g.player.x, l.z - g.player.z) < 70) { if (Math.random() < dt * 6) this.fx.emit({ x: l.x, y: l.y + 0.6 + Math.random(), z: l.z, vy: 1.4, life: 1, size: 0.3, color: [1, 0.85, 0.3], alpha: 1 }); }
    }
    for (const l of g.luggage) if (!this.dynamic.luggage.has(l)) {
      const holder = new THREE.Group(); holder.position.set(l.x, l.y, l.z); this.world.add(holder); this.dynamic.luggage.set(l, holder);
      place(l.supply ? 'supply_drop' : 'luggage', { height: l.supply ? 0.8 : 0.62 }).then((n) => holder.add(n));
      if (l.supply) this.fx.burst(l.x, l.y + 1, l.z, 30, { color: [1, 0.4, 0.3], speed: 2, size: 0.3, life: 1.5, gravity: 0.5 });
    }
    // hazards
    for (const h of g.hazards) {
      const node = this.dynamic.hazards.get(h.id);
      if (h.type === 'flytrap' && node) {
        const k = h.state === 'snap' ? 1.25 : 1 + Math.sin(this.time * 3 + h.id) * 0.04; node.scale.setScalar(h.asleep > 0 ? 0.8 : k);
        node.rotation.x = h.asleep > 0 ? 0.35 : 0; node.rotation.y = h.alert ? Math.atan2(g.player.x - h.x, g.player.z - h.z) : node.rotation.y;
      }
      if (h.type === 'bees' && node) {
        const m = new THREE.Matrix4(), s = h.asleep > 0 ? 0 : 1;
        for (let i = 0; i < 14; i++) { const a = this.time * (2 + (i % 3)) + i, r = h.active ? 0.5 + (i % 4) * 0.15 : 0.35; m.makeScale(s, s, s).setPosition(h.x + Math.cos(a) * r, h.y + Math.sin(a * 1.3) * 0.25, h.z + Math.sin(a) * r); node.setMatrixAt(i, m); }
        node.instanceMatrix.needsUpdate = true;
      }
      if (h.type === 'geyser' && node) {
        node.visible = h.state === 'erupt'; if (node.visible) { const hgt = 9 * Math.min(1, (1.5 - h.timer) * 5 + 0.2); node.scale.set(1, hgt, 1); node.position.set(h.x, h.y + hgt / 2, h.z); if (Math.random() < 0.7) this.fx.emit({ x: h.x + (Math.random() - 0.5), y: h.y + Math.random() * hgt, z: h.z + (Math.random() - 0.5), vy: 3, life: 0.6, size: 0.5, color: [0.95, 0.98, 1], alpha: 0.7, grow: 1 }); }
        if (h.state === 'warn' && Math.random() < dt * 30) this.fx.emit({ x: h.x + (Math.random() - 0.5) * 1.4, y: h.y + 0.1, z: h.z + (Math.random() - 0.5) * 1.4, vy: 2.2, life: 0.6, size: 0.3, color: [0.9, 0.95, 1], alpha: 0.6, grow: 1.2 });
      }
      if (h.type === 'steam' && h.active && Math.hypot(h.x - g.player.x, h.z - g.player.z) < 60 && Math.random() < dt * 40) this.fx.emit({ x: h.x + (Math.random() - 0.5) * 0.6, y: h.y + 0.2, z: h.z + (Math.random() - 0.5) * 0.6, vx: (Math.random() - 0.5), vy: 2.4, vz: (Math.random() - 0.5), life: 1.4, size: 0.7, color: [0.85, 0.85, 0.85], alpha: 0.55, grow: 2.2 });
      if (h.type === 'icicle' && h.state === 'fall') { const n2 = this.dynamic.hazards.get(`ici${h.id}`); if (n2) { n2.visible = false; n2.userData.hidden = true; } }
      if (h.type === 'icicle' && h.state === 'hang') { const n2 = this.dynamic.hazards.get(`ici${h.id}`); if (n2) { n2.userData.hidden = false; n2.visible = true; if (n2.children[0]) n2.children[0].position.x = Math.sin(this.time * 40) * (h.timer > 0.1 ? 0.03 : 0); } }
    }
    // projectiles
    const seen = new Set();
    for (const pr of g.projectiles) {
      if (pr.delay > 0) continue; seen.add(pr);
      let m = this.dynamic.projectiles.get(pr);
      if (!m) {
        const color = { coconut: 0x7a4a24, boulder: 0x8a8a84, lavarock: 0xff6a2a, snowball: 0xf4fbff, icicle: 0xbfe8ff }[pr.type] || 0x888888;
        m = new THREE.Mesh(this.projGeo, new THREE.MeshToonMaterial({ color, gradientMap: this.ramp(), emissive: pr.type === 'lavarock' ? 0xff5a10 : 0, emissiveIntensity: 0.8 })); m.castShadow = true;
        if (pr.type === 'icicle') m.scale.set(pr.r * 0.7, pr.r * 3.2, pr.r * 0.7); else m.scale.setScalar(pr.r);
        this.scene.add(m); this.dynamic.projectiles.set(pr, m);
        if (pr.type === 'boulder' || pr.type === 'lavarock' || pr.type === 'snowball') place(pr.type === 'lavarock' ? 'lava_rock' : 'boulder', { height: pr.r * 2 }).then((n) => { n.position.y = -pr.r; m.add(n); n.scale.multiplyScalar(1 / pr.r); m.material.visible = false; });
      }
      m.position.set(pr.x, pr.y, pr.z); if (pr.type !== 'icicle') { m.rotation.x += dt * 5; m.rotation.z += dt * 3; }
      if (pr.type === 'lavarock' && Math.random() < dt * 40) this.fx.emit({ x: pr.x, y: pr.y, z: pr.z, vy: 1, life: 0.5, size: 0.3, color: [1, 0.5, 0.1], alpha: 0.8 });
    }
    for (const [pr, m] of this.dynamic.projectiles) if (!seen.has(pr)) { this.scene.remove(m); this.dynamic.projectiles.delete(pr); }
    // flares, stoves, baits, bombs
    this.syncList('flares', g.flares, (f) => { const l = new THREE.PointLight(0xff4a3a, 9, 22); const s = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff8a6a })); const grp = new THREE.Group(); grp.add(l, s); return grp; }, (f, n) => { n.position.set(f.x, f.y, f.z); n.children[0].intensity = 8 + Math.sin(this.time * 30) * 2; if (Math.random() < dt * 40) this.fx.emit({ x: f.x, y: f.y, z: f.z, vx: (Math.random() - 0.5) * 2, vy: 2, vz: (Math.random() - 0.5) * 2, life: 0.8, size: 0.2, color: [1, 0.5, 0.3], alpha: 0.9, gravity: 2 }); });
    this.syncList('stoves', g.stoves, (s) => { const grp = new THREE.Group(); place('portable_stove', { height: 0.55 }).then((n) => grp.add(n)); const l = new THREE.PointLight(0x7ac8ff, 3, 8); l.position.y = 0.6; grp.add(l); return grp; }, (s, n) => { n.position.set(s.x, s.y, s.z); });
    this.syncList('baits', g.baits, () => { const grp = new THREE.Group(); place('bomb_cheese', { height: 0.3 }).then((n) => grp.add(n)); return grp; }, (b, n) => n.position.set(b.x, b.y, b.z));
    this.syncList('bombs', g.bombs, () => { const grp = new THREE.Group(); place('dynamite_bundle', { height: 0.35 }).then((n) => grp.add(n)); return grp; }, (b, n) => { n.position.set(b.x, b.y - 0.15, b.z); n.scale.setScalar(1 + Math.sin(this.time * 24) * 0.08); if (Math.random() < dt * 40) this.fx.emit({ x: b.x, y: b.y + 0.3, z: b.z, vy: 1.5, life: 0.4, size: 0.12, color: [1, 0.8, 0.3] }); });
    this.syncList('pitons', g.pitons, () => { const grp = new THREE.Group(); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), new THREE.MeshToonMaterial({ color: 0xc8d0d8 })); m.rotation.x = Math.PI / 2; grp.add(m); return grp; }, (pt, n) => n.position.set(pt.x, pt.y, pt.z));
    // ropes
    for (const pole of g.ropes) if (!this.dynamic.ropes.has(pole)) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, pole.y1 - pole.y0, 6), new THREE.MeshToonMaterial({ color: 0xf08a2a }));
      m.position.set(pole.x, (pole.y0 + pole.y1) / 2, pole.z); this.scene.add(m); this.dynamic.ropes.set(pole, m);
    }
    // broken boxes
    for (const [id, m] of this.boxMeshes) if (!g.world.boxes[id].solid && m.visible) { m.visible = false; }
    if (this.rubbleNodes) for (const n of this.rubbleNodes) { if (!n.userData.gone && !this.anyRubbleSolid(g)) { n.visible = false; n.userData.gone = true; } }
    // shrine glow when used
  }
  anyRubbleSolid(g) { return g.world.boxes.some((b) => b.rubble && b.solid); }
  syncList(key, list, make, update) {
    const arr = this.dynamic[key];
    while (arr.length < list.length) { const entry = { src: null, node: null }; arr.push(entry); }
    const map = (this._lm ||= {}); const m = (map[key] ||= new Map());
    for (const src of list) { if (!m.has(src)) { const n = make(src); this.scene.add(n); m.set(src, n); } update(src, m.get(src)); }
    for (const [src, n] of m) if (!list.includes(src)) { this.scene.remove(n); m.delete(src); }
  }
  updateBiome(dt, g) {
    const bi = g.biome.index, b = BIOMES[bi];
    if (bi !== this.biomeIndex) {
      this.biomeIndex = bi; this.scene.background = this.skies[b.id]; this.fogTarget.set(b.fog);
      this.sun.color.set(b.sun); this.hemi.color.set(b.amb);
      this.scene.background.mapping = THREE.EquirectangularReflectionMapping;
    }
    this.scene.fog.color.lerp(this.fogTarget, Math.min(1, dt * 1.5));
    const far = THREE.MathUtils.lerp(this.scene.fog.far, g.env.dark && !g.lantern ? 22 : b.fogFar * (g.env.steam ? 0.6 : 1), Math.min(1, dt * 2));
    this.scene.fog.far = far; this.scene.fog.near = far * 0.28;
    this.scene.backgroundIntensity = 1; 
    this.hemi.intensity = g.env.dark ? 0.55 : 1.55;
  }
  updateWeather(dt, g) {
    const p = g.player, b = g.biome.id, cam = this.camera.position;
    const spawn = (rate, f) => { const n = Math.floor(rate * dt + Math.random()); for (let i = 0; i < n; i++) f(); };
    if (b === 'alpine') spawn(60, () => this.fx.emit({ x: cam.x + (Math.random() - 0.5) * 30, y: cam.y + 8 + Math.random() * 6, z: cam.z + (Math.random() - 0.5) * 30, vx: (g.wind ? g.wind.x * 0.5 : 0.8) + Math.random(), vy: -2.2, vz: 0.4, life: 5, size: 0.09, color: [1, 1, 1], alpha: 0.9 }));
    if (b === 'jungle' && g.rain) spawn(160, () => this.fx.emit({ x: cam.x + (Math.random() - 0.5) * 26, y: cam.y + 9 + Math.random() * 4, z: cam.z + (Math.random() - 0.5) * 26, vy: -17, life: 0.7, size: 0.05, color: [0.7, 0.85, 1], alpha: 0.7 }));
    if (b === 'volcano') spawn(22, () => this.fx.emit({ x: cam.x + (Math.random() - 0.5) * 30, y: cam.y - 5 + Math.random() * 6, z: cam.z + (Math.random() - 0.5) * 30, vy: 2 + Math.random() * 2, vx: 0.5, life: 4, size: 0.1, color: [1, 0.5, 0.15], alpha: 0.9 }));
    if (b === 'shore' && Math.random() < dt * 4) this.fx.emit({ x: cam.x + (Math.random() - 0.5) * 30, y: p.y + 0.4 + Math.random() * 3, z: cam.z + (Math.random() - 0.5) * 30, vx: 1.4, life: 4, size: 0.05, color: [1, 1, 0.9], alpha: 0.5 });
    if (g.wind && Math.random() < dt * 90) this.fx.emit({ x: p.x - g.wind.x * 0.3 + (Math.random() - 0.5) * 6, y: p.y + Math.random() * 4, z: p.z + (Math.random() - 0.5) * 6, vx: g.wind.x * 0.9, life: 0.5, size: 0.08, color: [1, 1, 1], alpha: 0.5 });
    // climbing dust
    if (p.climbing && p.moveAmt > 0.3 && Math.random() < dt * 14) this.fx.emit({ x: p.x - (p.surf?.nx || 0) * 0.3, y: p.y + 0.9, z: p.z - (p.surf?.nz || 0) * 0.3, vx: (Math.random() - 0.5), vy: -0.5, vz: (Math.random() - 0.5), life: 0.6, size: 0.12, color: [0.8, 0.75, 0.65], alpha: 0.6, gravity: 1 });
  }
  async startHeli(g) {
    const n = await place('rescue_helicopter', { width: 6 });
    const s = g.level.summit; n.position.set(s.x + 20, s.y + 40, s.z + 10); this.scene.add(n);
    this.heli = { n, t: 0, s };
  }
  updateHeli(dt, g) {
    const h = this.heli; if (!h) return; h.t += dt;
    const k = Math.min(1, h.t / 3.5), e = k * k * (3 - 2 * k);
    h.n.position.set(h.s.x + 20 * (1 - e) + 2.4 * e, h.s.y + 40 * (1 - e) + 6 * e + Math.sin(h.t * 2) * 0.15, h.s.z + 10 * (1 - e) - 3 * e);
    h.n.rotation.y = Math.atan2(-20, -10) * (1 - e) + h.t * 0.1; h.n.rotation.z = Math.sin(h.t * 3) * 0.04;
    this.cam.dist += (7 - this.cam.dist) * Math.min(1, dt); this.cam.pitch += (0.18 - this.cam.pitch) * Math.min(1, dt);
    if (Math.random() < dt * 60) this.fx.emit({ x: h.n.position.x + (Math.random() - 0.5) * 5, y: h.n.position.y - 2, z: h.n.position.z + (Math.random() - 0.5) * 5, vy: -4, life: 1, size: 0.3, color: [1, 1, 1], alpha: 0.4 });
  }
  processEvents(g) {
    for (const e of g.events) {
      switch (e.type) {
        case 'land': if (e.drop > 1.5) this.fx.burst(g.player.x, g.player.y + 0.1, g.player.z, Math.min(18, 4 + e.drop * 2), { color: [0.85, 0.8, 0.7], speed: 2 + e.drop * 0.2, size: 0.18, life: 0.6, gravity: 3 }); if (e.drop > 6) this.cam.shake = 0.35; break;
        case 'hurt': this.cam.shake = Math.min(0.6, 0.15 + e.amount * 0.02); this.reggieAlarm = 0.6; break;
        case 'smash': this.fx.burst(e.x, e.y, e.z, 16, { color: e.what === 'icicle' ? [0.8, 0.95, 1] : e.what === 'lavarock' ? [1, 0.5, 0.2] : [0.75, 0.7, 0.62], speed: 4, size: 0.2, life: 0.8 }); break;
        case 'explode': this.fx.burst(e.x, e.y, e.z, 60, { color: [1, 0.6, 0.2], speed: 8, size: 0.4, life: 1, gravity: 2, grow: 1.5 }); this.cam.shake = 0.8; break;
        case 'rumble': this.cam.shake = 0.3; this.reggieAlarm = 1; break;
        case 'break': { const b = e.box; this.fx.burst((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2, 30, { color: [0.8, 0.75, 0.68], speed: 4, size: 0.25, life: 1 }); break; }
        case 'snap': this.fx.burst(e.x, e.y + 0.8, e.z, 10, { color: [0.4, 0.9, 0.3], speed: 3, size: 0.14 }); break;
        case 'launch': this.fx.burst(g.player.x, g.player.y, g.player.z, 22, { color: [1, 1, 1], speed: 4, size: 0.3, life: 0.7, gravity: -1 }); break;
        case 'shrine': this.fx.burst(e.ref.x, e.ref.y + 1.5, e.ref.z, 70, { color: [1, 0.9, 0.4], speed: 5, size: 0.3, life: 1.6, gravity: -1.5 }); break;
        case 'revive': this.fx.burst(g.player.x, g.player.y + 1, g.player.z, 60, { color: [1, 0.9, 0.3], speed: 5, size: 0.3, life: 1.4, gravity: -1 }); break;
        case 'grapple': { for (let i = 0; i <= 14; i++) { const t = i / 14; this.fx.emit({ x: e.from.x + (e.to.x - e.from.x) * t, y: e.from.y + (e.to.y - e.from.y) * t, z: e.from.z + (e.to.z - e.from.z) * t, life: 0.5, size: 0.12, color: [0.8, 0.85, 0.9] }); } break; }
        case 'dart': { for (let i = 0; i <= 12; i++) { const t = i / 12; this.fx.emit({ x: e.from.x + (e.to.x - e.from.x) * t, y: e.from.y + (e.to.y - e.from.y) * t, z: e.from.z + (e.to.z - e.from.z) * t, life: 0.4, size: 0.08, color: [1, 0.5, 0.8] }); } break; }
        case 'pickup': this.fx.burst(g.player.x, g.player.y + 0.8, g.player.z, 8, { color: [1, 0.9, 0.5], speed: 1.6, size: 0.12, life: 0.6, gravity: -2 }); break;
        case 'win': this.startHeli(g); break;
        case 'mantle': this.fx.burst(g.player.x, g.player.y + 0.3, g.player.z, 6, { color: [0.85, 0.8, 0.7], speed: 1.5, size: 0.12 }); break;
      }
    }
  }
}
