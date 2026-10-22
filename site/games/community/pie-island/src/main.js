import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { makeTerrain, makeWater, makeSky, makeClouds, loadModels, instanceProps, makeHouses, HOUSE_PARTS } from './island.js';
import { buildWorld, step, groundAt, spawnPoint, zoneAt, rng, HOUSES, HOUSE_HALF, coastDist, groundColor, terrainHeight, DOCK } from './layout.js';
import { createCharacter, EMOTES, EMOTE_TIME } from './character.js';
import { loadLook, saveLook, randomLook, sanitize } from './look.js';
import { createCreator } from './creator.js';
import { createMultiplayer } from './multiplayer.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const Q = {
  shadows: params.get('shadows') !== '0',
  pr: parseFloat(params.get('pr')) || 0,
  fps: params.has('fps') ? Math.max(0, parseInt(params.get('fps'), 10) || 0) : 60,
  auto: params.get('autoq') !== '0',
};
const $ = (id) => document.getElementById(id);
const canvas = $('world');
const audio = createAudio();

// ---------- 渲染 ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
let pixelRatio = Q.pr || Math.min(2, window.devicePixelRatio || 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#d3eefb', 80, 280);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);

const hemi = new THREE.HemisphereLight('#dbf2ff', '#8cc76c', 1.25);
scene.add(hemi);
const SUN_DIR = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
const sun = new THREE.DirectionalLight('#fff0d4', 2.7);
sun.castShadow = Q.shadows;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 160 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

const sky = makeSky();
scene.add(sky);
const terrain = makeTerrain();
scene.add(terrain);
const water = makeWater();
scene.add(water.mesh);
const clouds = makeClouds(rng(7));
scene.add(clouds);
const world = buildWorld();

function resize() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.75 ? 55 : 42;          // 直式手機視野放寬
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- 玩家 ----------
const saved = loadLook();
let firstVisit = !saved;
let myLook = saved || sanitize(randomLook());
const me = createCharacter(myLook);
scene.add(me.root);
const sp = spawnPoint();
let st = { x: sp.x, z: sp.z, y: groundAt(sp.x, sp.z), vy: 0, air: false, heading: Math.PI };
let speed = 0, emote = null, emoteAt = -99, lastEmote = 0;

const cam = { yaw: 0, pitch: 0.58, dist: matchMedia('(pointer: coarse)').matches ? 8 : 9.5, target: new THREE.Vector3(st.x, st.y + 1.1, st.z) };

// ---------- 介面 ----------
const ui = {
  zone: $('zone-name'), online: $('online'), toast: $('toast'), map: $('map'), hint: $('hint'),
  bar: $('load-bar'), pct: $('load-pct'), start: $('start'),
};
let mode = 'loading';
function setMode(m) { mode = m; document.body.dataset.mode = m; }
setMode('loading');

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
}

function showStatus(s) {
  ui.online.dataset.mode = s.mode;
  if (s.mode === 'online') ui.online.textContent = `● 島上 ${s.online} 人`;
  else if (s.mode === 'reconnecting') ui.online.textContent = '◌ 重新連線中…';
  else ui.online.textContent = `○ ${s.reason || '單機'}`;
  if (s.name) $('me-name').textContent = s.name;
}

// 表情列
const emoteBar = $('emotes');
for (const e of EMOTES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.emote = e.id;
  b.innerHTML = `<i style="color:${e.color}">${e.glyph}</i><span>${e.label}</span><kbd>${e.key}</kbd>`;
  b.addEventListener('click', () => doEmote(e.id));
  emoteBar.append(b);
}
function doEmote(id) {
  const now = performance.now() / 1000;
  if (now - lastEmote < 0.5 || mode !== 'play') return;
  lastEmote = now; emote = id; emoteAt = now;
  net.emote(id);
  audio.emote();
}

// ---------- 多人（先連線，再載模型：SDK 連線逾時是牆上時鐘 5 秒） ----------
const net = createMultiplayer({
  scene,
  getPose: () => ({ x: st.x, y: st.y, z: st.z, yaw: st.heading }),
  getLook: () => myLook,
  toast,
  onStatus: showStatus,
});
const netReady = net.start();

// ---------- 捏臉 ----------
const creator = createCreator({
  root: $('creator'),
  onDone(look, first) {
    applyLook(look);
    firstVisit = false;
    audio.hello();
    if (first) toast('準備好了！用 WASD 到處逛逛吧');
    enterPlay();
  },
  onCancel() { enterPlay(); },
});
function applyLook(look) {
  myLook = sanitize(look);
  me.setLook(myLook);
  saveLook(myLook);
  net.lookChanged();
}
function openCreator(first = false) {
  keys.clear();
  setMode('create');
  creator.show(myLook, { first });
}

// ---------- 載入場景 ----------
async function loadIsland() {
  const names = [...new Set([...world.props.map((p) => p.model), ...HOUSE_PARTS])];
  const models = await loadModels(names, (k) => {
    ui.bar.style.width = `${Math.round(k * 100)}%`;
    ui.pct.textContent = `${Math.round(k * 100)}%`;
  });
  scene.add(instanceProps(models, world.props, { shadows: Q.shadows }));
  scene.add(makeHouses(models, { shadows: Q.shadows }));
  renderer.compile(scene, camera);
  drawMapBase();
  await Promise.race([netReady, new Promise((r) => setTimeout(r, 1500))]);
  ui.start.disabled = false;
  ui.start.textContent = firstVisit ? '捏臉並登島 ▸' : '登島 ▸';
  ui.pct.textContent = '';
  window.__island.world = true;
  setMode('title');
}

function enterPlay() {
  if (creator.open) return;
  audio.start();
  setMode('play');
  $('app').focus();
}
ui.start.addEventListener('click', () => {
  audio.start();
  if (firstVisit) openCreator(true);
  else enterPlay();
});
$('resume').addEventListener('click', enterPlay);
$('menu-title').addEventListener('click', () => setMode('title'));
$('btn-creator').addEventListener('click', () => { if (mode === 'play') openCreator(); });
$('btn-pause').addEventListener('click', () => { if (mode === 'play') setMode('pause'); });
$('pause-creator').addEventListener('click', () => openCreator());

// ---------- 輸入 ----------
const keys = new Set();
let lastKeyAt = 0, jumpQueued = false, hudHidden = false;
const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE']);
window.addEventListener('keydown', (ev) => {
  if (mode === 'create') { if (ev.code === 'Escape') $('creator-cancel').click(); return; }
  lastKeyAt = performance.now();
  if (MOVE_CODES.has(ev.code)) ev.preventDefault();
  if (mode === 'title' && (ev.code === 'Enter' || ev.code === 'Space') && !ui.start.disabled) { ui.start.click(); return; }
  if (mode === 'pause' && ev.code === 'Escape') { enterPlay(); return; }
  if (mode !== 'play') return;
  if (ev.code === 'Escape') { setMode('pause'); return; }
  if (ev.repeat && !MOVE_CODES.has(ev.code)) return;
  keys.add(ev.code);
  if (ev.code === 'Space' && !ev.repeat) jumpQueued = true;
  const em = EMOTES.find((e) => `Digit${e.key}` === ev.code);
  if (em) doEmote(em.id);
  if (ev.code === 'KeyC') openCreator();
  if (ev.code === 'KeyM') toast(audio.toggleSfx() ? '音效：開' : '音效：關');
  if (ev.code === 'KeyN') toast(audio.toggleMusic() ? '音樂：開' : '音樂：關');
  if (ev.code === 'KeyH') { hudHidden = !hudHidden; document.body.classList.toggle('hud-off', hudHidden); }
});
window.addEventListener('keyup', (ev) => { keys.delete(ev.code); lastKeyAt = performance.now(); });
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { keys.clear(); if (mode === 'play') setMode('pause'); audio.suspend(); }
});

// 滑鼠拖曳轉鏡頭、滾輪拉近拉遠；觸控：左半邊搖桿、右半邊轉鏡頭
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const look = { id: null, x: 0, y: 0 };
const joyEl = $('joy'), knob = $('joy-knob');
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play') return;
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.45 && joy.id === null) {
    Object.assign(joy, { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
    joyEl.style.left = `${e.clientX}px`; joyEl.style.top = `${e.clientY}px`;
    joyEl.classList.add('on');
  } else if (look.id === null) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === joy.id) {
    const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, len = Math.hypot(dx, dy), max = 46;
    const k = len > max ? max / len : 1;
    joy.x = dx * k / max; joy.y = dy * k / max;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  } else if (e.pointerId === look.id) {
    cam.yaw -= (e.clientX - look.x) * 0.006;
    cam.pitch = Math.min(1.2, Math.max(0.22, cam.pitch + (e.clientY - look.y) * 0.004));
    look.x = e.clientX; look.y = e.clientY;
  }
});
const endPointer = (e) => {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; joyEl.classList.remove('on'); }
  if (e.pointerId === look.id) look.id = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  if (mode !== 'play') return;
  e.preventDefault();
  cam.dist = Math.min(20, Math.max(4.5, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
}, { passive: false });
$('jump-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpQueued = true; });
$('run-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); $('run-btn').classList.toggle('on'); });

function moveInput() {
  let f = 0, r = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
  if (joy.id !== null) { f -= joy.y; r += joy.x; }
  const len = Math.hypot(f, r);
  if (len > 1) { f /= len; r /= len; }
  // 鏡頭在角色後方：前 = 從鏡頭看出去的水平方向
  const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const rx = -fz, rz = fx;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || $('run-btn').classList.contains('on') || (joy.id !== null && Math.hypot(joy.x, joy.y) > 0.95);
  return { mx: fx * f + rx * r, mz: fz * f + rz * r, run, jump: jumpQueued };
}

// ---------- 小地圖 ----------
const MAP_SPAN = 66;
let mapBase = null;
function drawMapBase() {
  const N = 176;
  mapBase = document.createElement('canvas');
  mapBase.width = mapBase.height = N;
  const g = mapBase.getContext('2d');
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i / N * 2 - 1) * MAP_SPAN, z = (j / N * 2 - 1) * MAP_SPAN;
    const h = terrainHeight(x, z);
    let c;
    if (h < 0) { const d = Math.min(1, -h / 2.5); c = [0.5 - d * 0.25, 0.85 - d * 0.25, 0.88 - d * 0.08]; }
    else c = groundColor(x, z);
    const o = (j * N + i) * 4;
    img.data[o] = c[0] * 255; img.data[o + 1] = c[1] * 255; img.data[o + 2] = c[2] * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const toMap = (x, z) => [(x / MAP_SPAN + 1) / 2 * N, (z / MAP_SPAN + 1) / 2 * N];
  for (const h of HOUSES) {
    const [mx, my] = toMap(h.x, h.z);
    g.fillStyle = h.roof; g.strokeStyle = '#fffaf0'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(mx - 4, my - 4, 8, 8, 2); g.fill(); g.stroke();
  }
  const [dx0, dy0] = toMap(DOCK.x0, DOCK.z0), [dx1, dy1] = toMap(DOCK.x1, DOCK.z1);
  g.fillStyle = '#a77b4f'; g.fillRect(dx0, dy0, dx1 - dx0, dy1 - dy0);
  const [fx, fy] = toMap(0, 0);
  g.fillStyle = '#7ad7f0'; g.beginPath(); g.arc(fx, fy, 3, 0, Math.PI * 2); g.fill();
}
function drawMap() {
  if (!mapBase) return;
  const g = ui.map.getContext('2d'), N = ui.map.width;
  g.clearRect(0, 0, N, N);
  g.save();
  g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 2, 0, Math.PI * 2); g.clip();
  g.drawImage(mapBase, 0, 0, N, N);
  const toMap = (x, z) => [(x / MAP_SPAN + 1) / 2 * N, (z / MAP_SPAN + 1) / 2 * N];
  for (const p of net.avatars.positions()) {
    if (!p.visible) continue;
    const [x, y] = toMap(p.x, p.z);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#6b4f2a'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  const [x, y] = toMap(st.x, st.z);
  g.translate(x, y); g.rotate(-st.heading + Math.PI);
  g.fillStyle = '#ff6f61'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2.5); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ---------- 主迴圈 ----------
const clock = { last: performance.now(), t: 0, frames: 0, acc: 0, slow: 0, lastRender: 0, mapAt: 0 };
let zoneName = '';
const tmpV = new THREE.Vector3();

// 鏡頭被小屋擋住時拉近：沿著角色往鏡頭的方向找第一個碰到屋子的點
let camDist = 0;
const HOUSE_TOP = HOUSE_HALF * 2 / 3 + 2.1;
function clearDistance(t, dir, max) {
  for (let s = 0.6; s <= max; s += 0.3) {
    const x = t.x + dir[0] * s, y = t.y + dir[1] * s, z = t.z + dir[2] * s;
    for (const h of HOUSES) {
      if (y > groundAt(h.x, h.z) + HOUSE_TOP) continue;
      const dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), sn = Math.sin(h.rot);
      if (Math.abs(dx * c - dz * sn) < HOUSE_HALF + 0.9 && Math.abs(dx * sn + dz * c) < HOUSE_HALF + 0.9) return Math.max(2.2, s - 0.5);
    }
  }
  return max;
}

function updateCamera(dt, follow) {
  if (follow) {
    tmpV.set(st.x, st.y + 1.05, st.z);
    cam.target.lerp(tmpV, 1 - Math.exp(-dt * 10));
    if (keys.has('KeyQ')) cam.yaw += dt * 1.8;
    if (keys.has('KeyE')) cam.yaw -= dt * 1.8;
  } else {
    // 標題畫面：繞著廣場慢慢轉
    cam.yaw = clock.t * 0.05;
    cam.target.set(0, 1.5, 4);
  }
  let d = follow ? cam.dist : 34;
  const p = follow ? cam.pitch : 0.42;
  const dir = [Math.sin(cam.yaw) * Math.cos(p), Math.sin(p), Math.cos(cam.yaw) * Math.cos(p)];
  if (follow) d = Math.min(d, clearDistance(cam.target, dir, d));
  if (!camDist || camDist > d) camDist = d;                 // 被擋時立刻拉近
  else camDist += (d - camDist) * Math.min(1, dt * 3);     // 離開遮擋後慢慢退回
  const cx = cam.target.x + dir[0] * camDist;
  const cz = cam.target.z + dir[2] * camDist;
  let cy = cam.target.y + dir[1] * camDist;
  cy = Math.max(cy, groundAt(cx, cz) + 0.8, 0.6);
  camera.position.set(cx, cy, cz);
  camera.lookAt(cam.target);
  sky.position.copy(camera.position);
  sun.target.position.copy(cam.target);
  sun.position.copy(cam.target).addScaledVector(SUN_DIR, 70);
}

function adaptQuality(dt) {
  if (!Q.auto || mode !== 'play') return;
  clock.acc += dt; clock.frames++;
  if (clock.acc < 3) return;
  const fps = clock.frames / clock.acc;
  clock.acc = 0; clock.frames = 0;
  if (fps >= 24) { clock.slow = 0; return; }
  clock.slow++;
  if (clock.slow < 2) return;
  clock.slow = 0;
  if (sun.castShadow) { sun.castShadow = false; toast('畫面有點卡，先關掉陰影'); }
  else if (pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio * 0.75); resize(); toast('降低解析度讓畫面更順'); }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (Q.fps > 0 && now - clock.lastRender < 1000 / Q.fps - 2) return;
  clock.lastRender = now;
  const dt = Math.min(0.05, (now - clock.last) / 1000);
  clock.last = now;
  clock.t += dt;
  if (keys.size && now - lastKeyAt > 1500) keys.clear();      // 輸入法吃掉 keyup 時自動放開

  const playing = mode === 'play';
  if (playing) {
    const input = moveInput();
    const wasAir = st.air;
    const res = step(world, st, input, dt);
    st = res.state; speed = res.speed;
    if (!wasAir && st.air && input.jump) audio.jump();
    jumpQueued = false;
    const z = zoneAt(st.x, st.z);
    if (z !== zoneName) { zoneName = z; ui.zone.textContent = z; ui.zone.parentElement.classList.remove('pop'); void ui.zone.offsetWidth; ui.zone.parentElement.classList.add('pop'); }
  } else speed = 0;
  me.root.position.set(st.x, st.y, st.z);
  me.root.rotation.y = st.heading;
  const et = now / 1000 - emoteAt;
  if (emote && et > EMOTE_TIME) emote = null;
  me.animate(dt, { speed, air: st.air, emote, emoteT: et });
  me.root.visible = mode !== 'title' && mode !== 'loading';

  updateCamera(dt, mode !== 'title' && mode !== 'loading');
  water.update(clock.t);
  clouds.rotation.y += dt * 0.004;
  net.update(dt, camera.position);
  if (now - clock.mapAt > 120) { clock.mapAt = now; drawMap(); }
  adaptQuality(dt);
  if (mode !== 'create') renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------- 測試掛鉤 ----------
window.__island = {
  get mode() { return mode; },
  world: false,
  net,
  creator,
  renderer,
  get state() { return { ...st }; },
  get look() { return { ...myLook }; },
  get zone() { return zoneName; },
  get camera() { return { ...cam, target: cam.target.toArray() }; },
  setPose(x, z, heading = st.heading) { st = { ...st, x, z, y: groundAt(x, z), vy: 0, air: false, heading }; },
  setLook(l) { applyLook(l); },
  setCamera(yaw, pitch = cam.pitch, dist = cam.dist) { Object.assign(cam, { yaw, pitch, dist }); },
  emote: doEmote,
  openCreator,
  coastDist,
};

loadIsland().catch((err) => {
  console.error(err);
  ui.pct.textContent = '載入失敗，請重新整理';
});
