import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import PieGame from '../../../../sdk/pie-game-sdk.js';
import { step as walkStep, prepare, zoneAt, RADIUS } from './physics.js';
import { makeSky } from './sky.js';
import { makeRain } from './rain.js';
import { createAudio } from './audio.js';
import { HDRLoader } from '../vendor/jsm/loaders/HDRLoader.js';
import { createMultiplayer } from './multiplayer.js';
import { loadArcade, ROOM_Z } from './interior.js';
import { createArcadeGame } from './arcade-game.js';
import { loadDetailLibrary, preloadDetail, applyDetail } from './detail.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const P = (k, d) => (params.has(k) ? Number(params.get(k)) : d);  // 調光用的網址參數
const canvas = $('world'), app = $('app');

// ───────── 狀態 ─────────
const player = { x: 0, z: 16, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, bob: 0 };
const keys = new Set();
let mode = 'loading';           // loading | title | play | pause
let dragLook = false, dragging = false, rainOn = params.get('rain') !== '0', bloomOn = params.get('bloom') !== '0';
let autoQuality = params.get('autoq') !== '0';
let world = null, renderer, scene, camera, composer, bloom, sky, rain, lightPool = [], lightsData = [];
let streetRoot = null, interiorRoot = null, interiorActive = false, exteriorReturn = null;
let interactDoor = null, interactNear = false;
let nearCabinet = false;
const cabinetGame = createArcadeGame(() => { mode = 'pause'; document.body.dataset.mode = 'pause'; });
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let interiorWorld = null, streetColliders = null, streetBounds = 0;
const parts = [], flickers = [];
let net = null;
const audio = createAudio();
const touch = { id: null, x: 0, y: 0, ox: 0, oy: 0, look: null, lx: 0, ly: 0 };
let lastZone = '', zoneTimer = 0, stepDist = 0, clock = performance.now(), jumpQueued = false;

// ───────── 初始化渲染器 ─────────
function setupRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.info.autoReset = false;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, params.get('hi') ? 2 : 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = P('exp', 0.85);
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1a20, 0.0115);
  camera = new THREE.PerspectiveCamera(72, 1, 0.08, 900);
  camera.rotation.order = 'YXZ';
  sky = makeSky();
  scene.add(sky);
  rain = makeRain();
  scene.add(rain);
  scene.add(new THREE.HemisphereLight(0x4c8ea0, 0x140c08, P('hemi', 0.4)));
  const moon = new THREE.DirectionalLight(0x8aa8ff, P('moon', 0.3));
  moon.position.set(-30, 60, -86);
  scene.add(moon);
  // 環境反射用天空（讓濕地面與金屬反出夜空）
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const pm = new THREE.PMREMGenerator(renderer);
  scene.userData.env = pm.fromScene(envScene, 0, 0.1, 1000).texture;
  pm.dispose();
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), P('bs', 0.55), P('br', 0.5), P('bt', 1.1));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  onResize();
}

function onResize() {
  const w = app.clientWidth || window.innerWidth, h = app.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => renderer && onResize());

// ───────── 載入場景 ─────────
const WET = new Set(['ground_plaza', 'ground_N', 'ground_E', 'ground_S', 'ground_W']);
function prepareScene(gltf, data) {
  streetRoot = gltf.scene;
  const env = scene.userData.env;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const seen = new Set();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!seen.has(m)) {
      seen.add(m);
      for (const k of ['map', 'emissiveMap', 'roughnessMap']) if (m[k]) m[k].anisotropy = aniso;
      if (params.get('detail') !== '0') applyDetail(m);
      // 葉片：貼圖 Alpha 鏤空（MASK），並乘上 Blender 給的色調，同一張葉圖變出健康／乾枯／發光
      if (m.userData && m.userData.cut) { m.alphaTest = 0.5; m.transparent = false; m.side = THREE.DoubleSide; m.depthWrite = true; }
      if (m.userData && m.userData.tint) m.color.multiply(new THREE.Color(m.userData.tint));
      m.envMap = env;
      m.envMapIntensity = WET.has(m.name) ? P('wet', 0.55) : m.name.startsWith('prop_') ? 0.6 : (m.metalness > 0.3 ? 0.8 : 0.1);
      m.emissiveIntensity *= P('em', 0.5);
      if (/^signs_.*_f$/.test(m.name)) flickers.push({ m, base: m.emissiveIntensity, seed: Math.random() * 100 });
    }
  });
  scene.add(gltf.scene);
  // 靜態物件不必每影格更新矩陣
  const partNames = new Set(data.parts.map((p) => p.name + '__'));
  gltf.scene.traverse((o) => {
    if (o.parent === gltf.scene) {
      const isPart = [...partNames].some((p) => o.name.startsWith(p));
      if (!isPart) { o.matrixAutoUpdate = false; o.updateMatrix(); }
    }
  });
  for (const p of data.parts) {
    const nodes = [];
    gltf.scene.traverse((o) => { if (o.name.startsWith(p.name + '__')) nodes.push(o); });
    parts.push({ ...p, nodes, base: nodes.map((n) => n.position.y) });
  }
  // 點光源池：只讓離玩家最近的幾盞真的打光，其餘靠自發光貼圖與泛光撐住氣氛
  lightsData = data.lights.map((l) => ({ ...l, color: new THREE.Color(l.c) }));
  const POOL = params.get('lights') ? Number(params.get('lights')) : 10;
  for (let i = 0; i < POOL; i++) {
    const L = new THREE.PointLight(0xffffff, 0, 24, 1.7);
    scene.add(L);
    lightPool.push({ L, id: -1, target: 0 });
  }
}

async function makeInterior() {
  const room = await loadArcade();
  interiorRoot = room.root; scene.add(interiorRoot);
  interactDoor = room.makeEntrance(); scene.add(interactDoor);
  return room;
}
function enterInterior() {
  if (interiorActive || !interactNear || !interiorRoot) return;
  exteriorReturn = { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch };
  interiorActive = true; interiorRoot.visible = true; streetRoot.visible = false; interactDoor.visible = false;
  sky.visible = false; rain.visible = false; audio.setRain(false);
  for (const s of lightPool) s.L.visible = false;
  scene.fog = null;
  Object.assign(player, { x: 0, z: ROOM_Z + 2.7, y: 0, vx: 0, vz: 0, vy: 0, yaw: 0, pitch: 0, bob: 0 });
  world.colliders = interiorWorld.colliders; world.bounds = interiorWorld.bounds; lastZone = '';
  $('zone-name').textContent = '星光電玩屋'; $('zone-en').textContent = 'STAR ARCADE ROOM'; document.body.dataset.zone = 'P';
  toast('進入星光電玩屋');
}
function exitInterior() {
  if (!interiorActive || !exteriorReturn || !interactNear) return;
  interiorActive = false; interiorRoot.visible = false; streetRoot.visible = true; interactDoor.visible = true;
  sky.visible = true; rain.visible = rainOn; audio.setRain(rainOn);
  for (const s of lightPool) s.L.visible = true;
  scene.fog = new THREE.FogExp2(0x0a1a20, 0.0115);
  Object.assign(player, exteriorReturn, { y: 0, vx: 0, vz: 0, vy: 0, bob: 0 }); world.colliders = streetColliders; world.bounds = streetBounds; lastZone = '';
  toast('回到星光電玩街');
}
function interact() {
  if (mode !== 'play') return;
  if (interiorActive && nearCabinet) {
    mode = 'arcade'; document.body.dataset.mode = 'arcade';
    keys.clear(); touch.id = touch.look = null; touch.x = touch.y = 0; jumpQueued = false;
    player.vx = player.vz = 0;
    if (document.pointerLockElement) document.exitPointerLock();
    cabinetGame.open();
  } else if (interiorActive) exitInterior();
  else enterInterior();
}

const LIGHT_GAIN = P('lg', 10);
let lightTimer = 0;
function updateLights(dt, force) {
  lightTimer -= dt;
  if (lightTimer <= 0 || force) {
    lightTimer = 0.15;
    const px = player.x, pz = player.z;
    const scored = [];
    for (let i = 0; i < lightsData.length; i++) {
      const l = lightsData[i];
      const dx = l.p[0] - px, dz = l.p[2] - pz, dy = l.p[1] - 1.6;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 < l.d * l.d * 1.4) scored.push([d2 / (l.i * l.i + 0.2), i]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    const want = new Set(scored.slice(0, lightPool.length).map((s) => s[1]));
    for (const s of lightPool) if (s.id >= 0 && !want.has(s.id)) s.target = 0;
    const held = new Set(lightPool.filter((s) => s.id >= 0 && s.target > 0).map((s) => s.id));
    for (const idx of want) {
      if (held.has(idx)) continue;
      const slot = lightPool.find((s) => s.id < 0 || (s.target === 0 && s.L.intensity < 0.05));
      if (!slot) continue;
      const l = lightsData[idx];
      slot.id = idx; slot.target = l.i * LIGHT_GAIN;
      slot.L.color.copy(l.color); slot.L.position.set(l.p[0], l.p[1], l.p[2]); slot.L.distance = l.d * 1.15;
      if (force) slot.L.intensity = slot.target;
    }
  }
  const k = Math.min(1, dt * 7);
  for (const s of lightPool) {
    s.L.intensity += (s.target - s.L.intensity) * k;
    if (s.target === 0 && s.L.intensity < 0.05) { s.L.intensity = 0; s.id = -1; }
  }
}

function animateWorld(t, dt) {
  for (const p of parts) {
    if (p.kind === 'spin') {
      for (const n of p.nodes) n.rotation.y += p.speed * dt;
    } else if (p.kind === 'patrol') {
      const a = t * p.speed + p.phase;
      p.nodes.forEach((n, i) => {
        n.position.set(p.cx + Math.cos(a) * p.r, p.base[i] + Math.sin(t * 1.3 + p.phase) * p.bob, p.cz + Math.sin(a) * p.r);
        n.rotation.y = -a + (p.speed > 0 ? -Math.PI / 2 : Math.PI / 2);
      });
    } else if (p.kind === 'float') {
      p.nodes.forEach((n, i) => {
        n.position.y = p.base[i] + Math.sin(t * p.speed + p.phase) * p.amp;
        n.rotation.y = t * p.spin + p.phase;
      });
    }
  }
  for (const f of flickers) {
    const n = Math.sin(t * 13 + f.seed) * Math.sin(t * 7.3 + f.seed * 2.1) + Math.sin(t * 31 + f.seed);
    f.m.emissiveIntensity = f.base * (n > 1.45 ? 0.12 : n > 1.2 ? 0.5 : 1);
  }
}

// ───────── 輸入 ─────────
const MOVE_KEYS = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r' };
window.addEventListener('keydown', (e) => {
  if (mode === 'arcade') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const c = e.code;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(c)) e.preventDefault();
  keys.add(c);
  if (e.repeat) return;
  if (c === 'Space') jumpQueued = true;  // 輕按也算數，不會在兩幀之間被漏掉
  if (c === 'KeyE' && mode === 'play') interact();
  if (c === 'KeyM') { const m = audio.toggleMute(); toast(m ? '音效 關' : '音效 開'); }
  else if (c === 'KeyN') { const m = audio.toggleMusic(); toast(m ? '配樂 開' : '配樂 關'); }
  else if (c === 'KeyR') { rainOn = !rainOn; rain.visible = rainOn && !interiorActive; audio.setRain(rain.visible); toast(rainOn ? '雨 開' : '雨 關'); }
  else if (c === 'KeyB') { bloomOn = !bloomOn; bloom.enabled = bloomOn; toast(bloomOn ? '泛光 開' : '泛光 關'); }
  else if (c === 'KeyH') { document.body.classList.toggle('hud-off'); }
  else if (c === 'Enter' && mode === 'title' && !$('start').disabled) begin();
  else if ((c === 'Escape' || c === 'KeyP') && mode === 'play' && dragLook) pause();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); touch.id = null; touch.x = touch.y = 0; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); if (mode === 'play') pause(); } });

const SENS = 0.0022;
function look(dx, dy) {
  player.yaw -= dx * SENS;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * SENS));
}
document.addEventListener('mousemove', (e) => {
  if (mode !== 'play') return;
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
  else if (dragging) look(e.movementX, e.movementY);
});
canvas.addEventListener('mousedown', () => { if (mode === 'play' && dragLook) dragging = true; });
window.addEventListener('mouseup', () => { dragging = false; });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) { if (mode !== 'play') enterPlay(); }
  else if (mode === 'play' && !dragLook) pause();
});
document.addEventListener('pointerlockerror', () => { dragLook = true; enterPlay(); toast('無法鎖定滑鼠：改用按住左鍵拖曳轉視角'); });

// 觸控：左半邊搖桿、右半邊轉視角
function onTouchStart(e) {
  if (mode !== 'play') return;
  for (const t of e.changedTouches) {
    if (t.clientX < window.innerWidth * 0.5 && touch.id === null) {
      touch.id = t.identifier; touch.ox = t.clientX; touch.oy = t.clientY; touch.x = touch.y = 0;
      const j = $('joy'); j.style.display = 'block'; j.style.left = `${t.clientX - 55}px`; j.style.top = `${t.clientY - 55}px`;
    } else if (touch.look === null) { touch.look = t.identifier; touch.lx = t.clientX; touch.ly = t.clientY; }
  }
  e.preventDefault();
}
function onTouchMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touch.id) {
      const dx = (t.clientX - touch.ox) / 55, dy = (t.clientY - touch.oy) / 55, l = Math.hypot(dx, dy) || 1, k = Math.min(1, l) / l;
      touch.x = dx * k; touch.y = dy * k;
      $('joy-knob').style.transform = `translate(${touch.x * 40}px,${touch.y * 40}px)`;
    } else if (t.identifier === touch.look) {
      look((t.clientX - touch.lx) * 1.4, (t.clientY - touch.ly) * 1.4); touch.lx = t.clientX; touch.ly = t.clientY;
    }
  }
  e.preventDefault();
}
function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === touch.id) { touch.id = null; touch.x = touch.y = 0; $('joy').style.display = 'none'; $('joy-knob').style.transform = ''; }
    if (t.identifier === touch.look) touch.look = null;
  }
}
canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove', onTouchMove, { passive: false });
canvas.addEventListener('touchend', onTouchEnd);
canvas.addEventListener('touchcancel', onTouchEnd);
$('jump-btn').addEventListener('touchstart', (e) => { jumpQueued = true; e.preventDefault(); }, { passive: false });
$('interact-btn').addEventListener('click', interact);

function readInput(dt) {
  const a = (...c) => c.some((k) => keys.has(k));
  let fx = (a('KeyD') ? 1 : 0) - (a('KeyA') ? 1 : 0) + touch.x;
  let fz = (a('KeyW') ? 1 : 0) - (a('KeyS') ? 1 : 0) - touch.y;
  // 方向鍵轉視角（沒有滑鼠時的備案）
  const ky = (a('ArrowLeft') ? 1 : 0) - (a('ArrowRight') ? 1 : 0), kp = (a('ArrowDown') ? -1 : 0) + (a('ArrowUp') ? 1 : 0);
  if (ky) player.yaw += ky * 1.9 * dt;
  if (kp) player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch + kp * 1.3 * dt));
  const jump = jumpQueued || a('Space');
  jumpQueued = false;
  return { fx, fz, run: a('ShiftLeft', 'ShiftRight') || Math.hypot(touch.x, touch.y) > 0.92, jump };
}

// ───────── 流程 ─────────
function begin() {
  audio.start();
  audio.setRain(rainOn && !interiorActive);
  if (matchMedia('(pointer: coarse)').matches) { dragLook = false; enterPlay(); return; } // 觸控裝置不需要鎖定滑鼠
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { dragLook = true; enterPlay(); toast('無法鎖定滑鼠：改用按住左鍵拖曳轉視角'); });
  } catch { dragLook = true; enterPlay(); }
  // 某些環境 requestPointerLock 不會觸發事件也不會報錯：保底
  setTimeout(() => { if (mode === 'title' || mode === 'pause') { dragLook = true; enterPlay(); toast('改用按住左鍵拖曳轉視角'); } }, 900);
}
function enterPlay() {
  mode = 'play';
  document.body.dataset.mode = 'play';
  audio.resume();
  app.focus();
}
function pause() {
  if (mode !== 'play') return;
  mode = 'pause';
  document.body.dataset.mode = 'pause';
  keys.clear();
  if (document.pointerLockElement) document.exitPointerLock();
}
$('start').addEventListener('click', begin);
$('resume').addEventListener('click', () => { if (dragLook) enterPlay(); else begin(); });
$('menu-title').addEventListener('click', () => { mode = 'title'; document.body.dataset.mode = 'title'; });

let toastTimer = 0;
function showOnline(s) {
  const el = $('online');
  el.dataset.mode = s.mode;
  el.textContent = s.mode === 'online' ? `● 線上 ${s.online} 人` : s.mode === 'reconnecting' ? '連線中斷，重連中…' : s.reason || '單機';
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1400);
}

// ───────── HUD ─────────
const mapCv = $('map'), mctx = mapCv.getContext('2d'), compass = $('compass'), cctx = compass.getContext('2d');
let mapTimer = 0;
function drawMap() {
  if (interiorActive) {
    const S = mapCv.width, scale = S / 16, c = S / 2;
    mctx.clearRect(0, 0, S, S);
    mctx.fillStyle = 'rgba(18,10,36,.9)'; mctx.fillRect(0, 0, S, S);
    mctx.strokeStyle = '#b48cff'; mctx.lineWidth = 2;
    mctx.strokeRect(c - 6 * scale, c - 4 * scale, 12 * scale, 8 * scale);
    mctx.fillStyle = '#ff8fd0';
    for (const o of interiorWorld.colliders) if (o.tag === 'cabinet')
      mctx.fillRect(c + (o.cx - o.hw) * scale, c + (o.cz - ROOM_Z - o.hd) * scale, o.hw * 2 * scale, o.hd * 2 * scale);
    mctx.fillStyle = '#ffd84a'; mctx.fillRect(c - scale, c + 3.7 * scale, 2 * scale, .3 * scale);
    mctx.save(); mctx.translate(c + player.x * scale, c + (player.z - ROOM_Z) * scale); mctx.rotate(-player.yaw);
    mctx.fillStyle = '#5ee1ff'; mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4, 4); mctx.lineTo(-4, 4); mctx.closePath(); mctx.fill(); mctx.restore();
    return;
  }
  const S = mapCv.width, sc = S / 210, c = S / 2;
  mctx.clearRect(0, 0, S, S);
  mctx.save();
  mctx.beginPath(); mctx.arc(c, c, c - 2, 0, 7); mctx.clip();
  mctx.fillStyle = 'rgba(10,6,24,.85)'; mctx.fillRect(0, 0, S, S);
  const wx = (x) => c + x * sc, wz = (z) => c + z * sc;
  mctx.fillStyle = 'rgba(120,90,200,.28)';
  mctx.fillRect(wx(-10), wz(-100), 20 * sc, 200 * sc);
  mctx.fillRect(wx(-100), wz(-10), 200 * sc, 20 * sc);
  mctx.beginPath(); mctx.arc(c, c, 27 * sc, 0, 7); mctx.fill();
  mctx.strokeStyle = '#ff8a3d'; mctx.lineWidth = 1.5; mctx.beginPath(); mctx.arc(c, c, 24 * sc, 0, 7); mctx.stroke();
  mctx.fillStyle = 'rgba(255,255,255,.14)';
  for (const o of world.colliders) if (o.t === 'obb' && o.tag === 'b') {
    mctx.save(); mctx.translate(wx(o.cx), wz(o.cz)); mctx.rotate(Math.atan2(o.az, o.ax));
    mctx.fillRect(-o.hw * sc, -o.hd * sc, o.hw * 2 * sc, o.hd * 2 * sc); mctx.restore();
  }
  mctx.fillStyle = '#ffd84a'; mctx.beginPath(); mctx.arc(c, c, 3, 0, 7); mctx.fill();
  mctx.translate(wx(player.x), wz(player.z)); mctx.rotate(-player.yaw);
  mctx.fillStyle = '#29e6ff'; mctx.shadowColor = '#29e6ff'; mctx.shadowBlur = 6;
  mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 5); mctx.lineTo(0, 2); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill();
  mctx.restore();
}
const DIRS = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
function drawCompass() {
  const w = compass.width, h = compass.height;
  cctx.clearRect(0, 0, w, h);
  const heading = ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360; // 0=北，順時針
  const ppd = w / 140;
  cctx.font = '600 15px "Noto Sans TC", system-ui, sans-serif'; cctx.textAlign = 'center';
  for (let d = -70; d <= 70; d += 5) {
    const ang = ((Math.round(heading / 5) * 5 + d) % 360 + 360) % 360;
    const x = w / 2 + (ang - heading + (ang - heading > 180 ? -360 : ang - heading < -180 ? 360 : 0)) * ppd;
    if (x < 6 || x > w - 6) continue;
    const dir = DIRS.find((q) => q[1] === ang);
    cctx.strokeStyle = dir ? '#5ae8ff' : 'rgba(180,200,210,.45)';
    cctx.beginPath(); cctx.moveTo(x, h - 4); cctx.lineTo(x, h - (dir ? 14 : ang % 15 === 0 ? 10 : 7)); cctx.stroke();
    if (dir) { cctx.fillStyle = dir[0].length === 1 ? '#ffd84a' : '#bcd3da'; cctx.fillText(dir[0], x, 16); }
  }
  cctx.fillStyle = '#29e6ff'; cctx.beginPath(); cctx.moveTo(w / 2 - 5, 0); cctx.lineTo(w / 2 + 5, 0); cctx.lineTo(w / 2, 7); cctx.fill();
}
function updateZone(dt) {
  // street world is published before the optional interior assets finish loading;
  // do not query the entrance until its portal has been created.
  if (!world || !interactDoor) return;
  if (interiorActive) {
    interactNear = player.z > ROOM_Z + 2.6 && Math.abs(player.x) < 1.6;
    nearCabinet = interiorWorld.machines.some(m => m.name === 'arcade-machine'
      && player.z > m.z && Math.hypot(player.x - m.x, player.z - m.z) < 1.8);
    const el = $('interact'); el.textContent = nearCabinet ? 'E／按鈕　遊玩星光反應' : interactNear ? 'E／按鈕　離開星光電玩屋' : '星光電玩屋 · 室內探索'; el.classList.toggle('on', true);
    $('interact-btn').textContent = nearCabinet ? '遊玩' : '離開';
    $('interact-btn').classList.toggle('on', interactNear || nearCabinet);
    return;
  }
  nearCabinet = false;
  const z = zoneAt(player.x, player.z, world.ring);
  if (z !== lastZone) {
    lastZone = z;
    const info = world.zones[z];
    $('zone-name').textContent = info.name; $('zone-en').textContent = info.en;
    const b = $('zone-banner'); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
    document.body.dataset.zone = z;
  }
  const dx = player.x - interactDoor.position.x, dz = player.z - interactDoor.position.z;
  interactNear = dx * dx + dz * dz < 2.2 * 2.2;
  const el = $('interact'); el.textContent = interactNear ? 'E　進入星光電玩屋' : ''; el.classList.toggle('on', interactNear);
  $('interact-btn').textContent = '進入';
  $('interact-btn').classList.toggle('on', interactNear);
}

// ───────── 主迴圈 ─────────
let fpsAcc = 0, fpsN = 0, lowFor = 0, simTime = 0;
// 幀率上限預設 60（高更新率螢幕不必畫到 120／144，省電也省發熱）。網址 fps=30 可改，fps=0 不設上限
const FPS_CAP = params.has('fps') ? Number(params.get('fps')) : 60;
const MIN_FRAME_MS = FPS_CAP > 0 ? 1000 / FPS_CAP - 2 : 0;   // 減 2ms 容許 rAF 的抖動，60 Hz 螢幕才不會隔幀被跳過
function frame(now) {
  requestAnimationFrame(frame);
  if (now - clock < MIN_FRAME_MS) return;
  const dt = Math.min(0.25, (now - clock) / 1000);  // 卡頓時模擬仍追上實際時間（下面切成小步）
  clock = now;
  simTime += dt;
  if (!world) return;
  if (mode === 'arcade') { if (net) net.update(dt, camera.position); return; }
  let moved = 0;
  if (mode === 'play') {
    const input = readInput(dt);
    // 固定小步長：低幀率時走路速度不變，也不會一步穿牆
    for (let rem = dt; rem > 1e-6; rem -= 1 / 60) {
      const h = Math.min(rem, 1 / 60);
      const r = walkStep(player, input, h, world);
      moved += r.moved;
      if (r.landed) audio.landed();
      stepDist += r.moved;
      const stride = input.run ? 0.95 : 0.7;
      if (stepDist > stride && r.speed > 0.5) { stepDist = 0; audio.step(input.run, true); }
    }
  }
  const motion = reducedMotion.matches || params.get('motion') === '0' ? 0 : 1;
  const bobAmp = Math.min(1, Math.hypot(player.vx, player.vz) / 6) * 0.025 * motion;
  const sway = Math.sin(player.bob * Math.PI * 0.5) * bobAmp * 0.12;
  camera.position.set(player.x, world.eye + player.y + Math.sin(player.bob * Math.PI) * bobAmp, player.z);
  camera.rotation.set(player.pitch, player.yaw, sway);
  sky.position.copy(camera.position);
  sky.material.uniforms.uTime.value = simTime;
  rain.material.uniforms.uTime.value = simTime;
  rain.material.uniforms.uCam.value.copy(camera.position);
  animateWorld(simTime, dt);
  if (net) net.update(dt, camera.position);
  updateLights(dt);
  updateZone(dt);
  mapTimer -= dt;
  if (mapTimer <= 0) { mapTimer = 0.1; drawMap(); drawCompass(); }
  renderer.info.reset();
  composer.render(dt);
  // 效能自動降級：連續 3 秒低於 24 fps 就關泛光、降像素比
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 1) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    $('fps').textContent = `${Math.round(fps)} fps`;
    if (autoQuality && mode === 'play') {
      lowFor = fps < 24 ? lowFor + 1 : 0;
      if (lowFor >= 3) {
        lowFor = 0;
        if (bloomOn) { bloomOn = false; bloom.enabled = false; toast('畫面較卡：已自動關閉泛光（B 可重開）'); }
        else if (renderer.getPixelRatio() > 1) { renderer.setPixelRatio(1); onResize(); }
        else if (lightPool.length > 4) { lightPool.splice(4).forEach((s) => scene.remove(s.L)); toast('已降低動態光源數量'); }
      }
    }
  }
}

// 真實夜景 HDRI（Poly Haven shanghai_bund，CC0）當環境反射：濕地面、玻璃與金屬會反出霓虹天際線。
// 下半球塗黑，免得地面的暖色磚反成假的補光。失敗就沿用上面的程式天空。
async function loadEnvironment() {
  if (params.get('hdri') === '0') return;
  try {
    const hdr = await new HDRLoader().loadAsync('./assets/env/shanghai_bund_1k.hdr');
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const envScene = new THREE.Scene();
    envScene.background = hdr;
    envScene.backgroundIntensity = P('hdri', 0.25);
    envScene.backgroundRotation.y = P('hrot', 0.6);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(900, 24), new THREE.MeshBasicMaterial({ color: 0x07040f }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5;
    envScene.add(floor);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.userData.env = pm.fromScene(envScene, 0, 0.1, 2000).texture;
    pm.dispose(); hdr.dispose();
  } catch (err) { console.warn('HDRI 載入失敗，改用程式天空', err); }
}

async function boot() {
  setupRenderer();
  net = createMultiplayer({ scene, getPose: () => (world ? { ...player, area: interiorActive ? 'arcade' : 'street' } : null), toast, onStatus: showOnline });
  net.start();
  const bar = $('load-bar'), pct = $('load-pct');
  const load = (url, onProgress) => new Promise((res, rej) => new GLTFLoader().load(url, res, onProgress, rej));
  const [data, gltf] = await Promise.all([
    fetch('./assets/scene.json').then((r) => r.json()),
    load('./assets/street.glb', (e) => { if (e.total) { const p = Math.round(e.loaded / e.total * 100); bar.style.width = `${p}%`; pct.textContent = `${p}%`; } }),
  ]);
  await loadEnvironment();
  if (params.get('detail') !== '0') {
    await loadDetailLibrary();
    const mats = new Set();
    gltf.scene.traverse((o) => { if (o.isMesh) mats.add(o.material); });
    await preloadDetail(mats, renderer);
  }
  prepareScene(gltf, data);
  world = { colliders: prepare(data.colliders), bounds: data.bounds, eye: data.eye, zones: data.zones, ring: data.ring };
  streetColliders = world.colliders; streetBounds = world.bounds;
  interiorWorld = await makeInterior();
  const sp = params.get('spawn');
  if (sp) { const [x, z, yaw, pitch] = sp.split(',').map(Number); Object.assign(player, { x, z, yaw: yaw || 0, pitch: pitch || 0 }); }
  else Object.assign(player, { x: data.spawn.x, z: data.spawn.z, yaw: data.spawn.yaw });
  if (!bloomOn) bloom.enabled = false;
  if (!rainOn) rain.visible = false;
  updateLights(0.2, true);
  bar.style.width = '100%'; pct.textContent = '100%';
  $('start').disabled = false; $('start').textContent = '進入街區 ▸';
  mode = 'title'; document.body.dataset.mode = 'title';
  if (params.get('autostart')) { dragLook = true; enterPlay(); }
}

window.__street = {
  player, THREE, get world() { return world; }, get mode() { return mode; },
  get interior() { return interiorActive; }, get interiorWorld() { return interiorWorld; },
  setPose(x, z, yaw = 0, pitch = 0) { Object.assign(player, { x, z, yaw, pitch, vx: 0, vz: 0 }); updateLights(0.2, true); if (world) updateZone(0); },
  get fps() { return $('fps').textContent; },
  get net() { return net; },
  stats() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tex: renderer.info.memory.textures }; },
};

requestAnimationFrame(frame);
boot().catch((err) => { console.error(err); $('load-pct').textContent = `載入失敗：${err.message || err}`; });
PieGame.ready().then(() => PieGame.setHeight()).catch(() => {});
