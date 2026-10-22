import * as THREE from '../../pie-phoebe/vendor/three.module.js';
import { SKIN, HAIR_COLORS, CLOTH_COLORS, sanitize } from './look.js';
import { drawFace, FACE_W, FACE_H } from './face.js';

// 動物森友會式的 Q 版人物：大頭（約身高四成）、短身短腿、圓手圓腳。
// 模型面向 +Z，root.rotation.y = 朝向角（世界前方 = (sin h, 0, cos h)）。
// 整個人約 1.35 m 高（不含頭髮），站在 root 原點上。

export const HEAD_R = 0.34;
const HIP_Y = 0.3;
const HEAD_Y = 0.62;               // 頭心相對髖部
const FACE_PATCH = { phiStart: Math.PI / 2 - 0.7, phiLength: 1.4, thetaStart: 0.85, thetaLength: 1.1 };

export const EMOTES = [
  { id: 'wave', label: '揮手', key: '1', glyph: 'Hi!', color: '#4aa3df' },
  { id: 'happy', label: '開心', key: '2', glyph: '♪', color: '#f0a020' },
  { id: 'love', label: '喜歡', key: '3', glyph: '♥', color: '#ff5d8f' },
  { id: 'wow', label: '驚訝', key: '4', glyph: '!', color: '#ff7a3d' },
  { id: 'hmm', label: '疑問', key: '5', glyph: '?', color: '#7a6cf0' },
];
export const EMOTE_IDS = EMOTES.map((e) => e.id);
export const EMOTE_TIME = 2.4;
const BUBBLE_Y = 2.42;          // 表情泡泡在名牌（1.9 m）上方

// ---------- 共用幾何與材質 ----------
const G = {
  head: new THREE.SphereGeometry(HEAD_R, 40, 28),
  face: new THREE.SphereGeometry(HEAD_R * 1.006, 32, 20, FACE_PATCH.phiStart, FACE_PATCH.phiLength, FACE_PATCH.thetaStart, FACE_PATCH.thetaLength),
  torso: new THREE.CylinderGeometry(0.16, 0.2, 0.34, 24),
  shoulders: new THREE.SphereGeometry(0.163, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  dress: new THREE.CylinderGeometry(0.155, 0.31, 0.46, 24),
  skirt: new THREE.CylinderGeometry(0.19, 0.29, 0.2, 24),
  pelvis: new THREE.CylinderGeometry(0.2, 0.19, 0.1, 24),
  leg: new THREE.CapsuleGeometry(0.075, 0.1, 6, 12),
  shortsLeg: new THREE.CylinderGeometry(0.088, 0.092, 0.12, 14),
  shoe: new THREE.SphereGeometry(1, 16, 12),
  arm: new THREE.CapsuleGeometry(0.056, 0.13, 6, 12),
  sleeve: new THREE.CapsuleGeometry(0.068, 0.04, 6, 12),
  hand: new THREE.SphereGeometry(0.066, 14, 10),
  ball: new THREE.SphereGeometry(1, 24, 16),
  cone: new THREE.ConeGeometry(1, 1, 16),
  ring: new THREE.TorusGeometry(0.07, 0.012, 8, 24),
  blob: new THREE.CircleGeometry(0.42, 24),
  hood: new THREE.TorusGeometry(0.15, 0.06, 10, 24, Math.PI * 1.2),
};
const capCache = new Map();
function shell(r, t0, t1, p0 = 0, pl = Math.PI * 2) {
  const k = [r, t0, t1, p0, pl].map((v) => v.toFixed(3)).join();
  if (!capCache.has(k)) capCache.set(k, new THREE.SphereGeometry(r, 32, 20, p0, pl, t0, t1 - t0));
  return capCache.get(k);
}

const matCache = new Map();
export function mat(color, extra = {}) {
  const k = color + JSON.stringify(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...extra }));
  return matCache.get(k);
}
const blobMat = new THREE.MeshBasicMaterial({ color: 0x1d4a3a, transparent: true, opacity: 0.22, depthWrite: false });

const patternCache = new Map();
function patternMat(color, pattern) {
  if (!pattern) return mat(color);
  const k = `${color}|${pattern}`;
  if (patternCache.has(k)) return patternCache.get(k);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 128, 128);
  const light = new THREE.Color(color).getHSL({}).l;
  const ink = light > 0.72 ? 'rgba(90,120,200,.55)' : 'rgba(255,255,255,.75)';
  g.fillStyle = ink;
  if (pattern === 1) for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 14);
  if (pattern === 2) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(x * 32 + (y % 2) * 16 + 8, y * 32 + 16, 7, 0, Math.PI * 2); g.fill(); }
  if (pattern === 3) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) starPath(g, x * 64 + (y % 2) * 32 + 22, y * 64 + 32, 16, 7);
  if (pattern === 4) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) flower(g, x * 64 + (y % 2) * 32 + 24, y * 64 + 32);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 1.4);
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75 });
  patternCache.set(k, m);
  return m;
}
function starPath(g, x, y, r1, r2) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  g.closePath(); g.fill();
}
function flower(g, x, y) {
  const ink = g.fillStyle;
  for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; g.beginPath(); g.arc(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(255,214,90,.95)'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = ink;
}

// 表情泡泡：每種一張共用貼圖
const bubbleTex = new Map();
function bubbleMaterial(id) {
  if (!bubbleTex.has(id)) {
    const e = EMOTES.find((x) => x.id === id);
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#fffaf0'; g.strokeStyle = '#7a5a3a'; g.lineWidth = 5;
    g.beginPath(); g.roundRect(10, 8, 108, 88, 36); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(52, 94); g.lineTo(64, 118); g.lineTo(76, 94); g.fillStyle = '#fffaf0'; g.fill();
    g.beginPath(); g.moveTo(52, 96); g.lineTo(64, 118); g.lineTo(76, 96); g.stroke();
    g.fillStyle = e.color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${e.glyph.length > 1 ? 40 : 64}px "Arial Rounded MT Bold", "Noto Sans TC", system-ui, sans-serif`;
    g.fillText(e.glyph, 64, 54);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    bubbleTex.set(id, new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  }
  return bubbleTex.get(id);
}

function mesh(geo, material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

// ---------- 頭髮、耳朵、帽子、眼鏡 ----------
// 臉部開口：正前方 ±0.8 rad 的範圍不能被頭髮蓋住
const SIDE_P0 = Math.PI / 2 + 0.82, SIDE_PL = Math.PI * 2 - 1.64;

function addHair(head, look, hm) {
  const R = HEAD_R;
  const add = (o) => { head.add(o); return o; };
  // 戴草帽／毛帽／棒球帽時，頭頂的髮飾（翹毛、丸子、刺）收進帽子裡
  const hatted = look.hat >= 1 && look.hat <= 3;
  const top = (o) => (hatted ? o : add(o));
  const cap = (r = 1.07, t1 = 1.22) => add(mesh(shell(R * r, 0, t1), hm));
  const around = (r = 1.06, t1 = 1.95) => add(mesh(shell(R * r, 0.9, t1, SIDE_P0, SIDE_PL), hm));
  switch (look.hair) {
    case 0: // 短髮：頭頂＋後腦，前面一撮翹起
      cap(); around(1.06, 1.85);
      top(mesh(G.ball, hm, 0.08, R * 0.92, R * 0.42, 0.16, 0.09, 0.12)).rotation.z = -0.4;
      break;
    case 1: // 鮑伯頭
      cap(1.12, 1.28); around(1.13, 2.3);
      add(mesh(G.ball, hm, 0, R * 0.72, R * 0.62, 0.3, 0.1, 0.14));
      break;
    case 2: // 雙馬尾
      cap(); around(1.06, 1.9);
      for (const s of [-1, 1]) {
        const tail = add(mesh(G.ball, hm, s * R * 1.12, -0.04, -0.05, 0.11, 0.22, 0.11));
        tail.rotation.z = s * 0.35;
        add(mesh(G.ball, mat('#ff6f91'), s * R * 1.0, 0.1, -0.03, 0.05));
      }
      break;
    case 3: // 丸子頭
      cap(); around(1.06, 1.85);
      top(mesh(G.ball, hm, 0, R * 1.18, -0.06, 0.14));
      add(mesh(G.ball, hm, 0, R * 0.78, R * 0.6, 0.26, 0.08, 0.13));
      break;
    case 4: // 刺刺頭
      cap(1.06, 1.18); around(1.05, 1.8);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2, tilt = 0.6;
        const spike = top(mesh(G.cone, hm, Math.sin(a) * R * 0.55, R * 0.88, Math.cos(a) * R * 0.55, 0.1, 0.22, 0.1));
        spike.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
      }
      top(mesh(G.cone, hm, 0, R * 1.1, 0, 0.1, 0.24, 0.1));
      break;
    case 5: // 長直髮
      cap(1.1, 1.26); around(1.11, 2.45);
      add(mesh(G.ball, hm, 0, -R * 0.62, -R * 0.42, 0.31, 0.36, 0.14));
      add(mesh(G.ball, hm, 0, R * 0.74, R * 0.6, 0.29, 0.09, 0.14));
      break;
    case 6: { // 馬尾
      cap(); around(1.06, 1.9);
      const tail = add(mesh(G.ball, hm, 0, -0.02, -R * 1.18, 0.11, 0.25, 0.11));
      tail.rotation.x = 0.5;
      add(mesh(G.ball, mat('#ffd84a'), 0, 0.12, -R * 1.0, 0.055));
      break;
    }
    case 7: // 爆炸頭
      add(mesh(shell(R * 1.36, 0, 1.0), hm, 0, 0.05, -0.04));
      add(mesh(shell(R * 1.34, 0.9, 2.05, SIDE_P0 + 0.1, SIDE_PL - 0.2), hm, 0, 0.05, -0.05));
      break;
    default: break; // 光頭
  }
}

function addEars(head, look, skinM, hm) {
  const R = HEAD_R;
  switch (look.ears) {
    case 1: // 貓耳
      for (const s of [-1, 1]) {
        const e = mesh(G.cone, hm, s * R * 0.55, R * 0.98, 0, 0.12, 0.2, 0.07);
        e.rotation.z = -s * 0.42; head.add(e);
        const inner = mesh(G.cone, mat('#ffb6c8'), s * R * 0.55, R * 0.97, 0.03, 0.07, 0.13, 0.03);
        inner.rotation.z = -s * 0.42; head.add(inner);
      }
      break;
    case 2: // 熊耳
      for (const s of [-1, 1]) {
        head.add(mesh(G.ball, hm, s * R * 0.68, R * 0.82, -0.02, 0.1, 0.1, 0.07));
        head.add(mesh(G.ball, mat('#f6c9a8'), s * R * 0.68, R * 0.82, 0.03, 0.055, 0.055, 0.04));
      }
      break;
    case 3: // 兔耳
      for (const s of [-1, 1]) {
        const e = mesh(G.ball, mat('#fbf6ee'), s * R * 0.32, R * 1.38, -0.04, 0.07, 0.22, 0.05);
        e.rotation.z = -s * 0.15; head.add(e);
        const inner = mesh(G.ball, mat('#ffb6c8'), s * R * 0.32, R * 1.38, -0.01, 0.04, 0.17, 0.03);
        inner.rotation.z = -s * 0.15; head.add(inner);
      }
      break;
    default: // 人耳
      for (const s of [-1, 1]) head.add(mesh(G.ball, skinM, s * R * 0.99, -0.02, 0, 0.05, 0.075, 0.045));
  }
}

function addHat(head, look) {
  const R = HEAD_R;
  switch (look.hat) {
    case 1: { // 草帽
      const straw = mat('#efd48a'), band = mat('#e2545b');
      head.add(mesh(new THREE.CylinderGeometry(0.56, 0.58, 0.025, 32), straw, 0, R * 0.62, -0.02));
      head.add(mesh(new THREE.CylinderGeometry(0.24, 0.29, 0.2, 28), straw, 0, R * 0.62 + 0.1, -0.02));
      head.add(mesh(new THREE.CylinderGeometry(0.292, 0.292, 0.05, 28), band, 0, R * 0.62 + 0.03, -0.02));
      break;
    }
    case 2: { // 毛帽
      const knit = mat('#5b8def'), trim = mat('#fffaf0');
      head.add(mesh(shell(R * 1.13, 0, 1.2), knit));
      const band = mesh(new THREE.TorusGeometry(R * 1.04, 0.045, 10, 36), trim, 0, R * 0.36, 0);
      band.rotation.x = Math.PI / 2; head.add(band);
      head.add(mesh(G.ball, trim, 0, R * 1.2, 0, 0.09));
      break;
    }
    case 3: { // 棒球帽
      const c = mat('#e2545b');
      head.add(mesh(shell(R * 1.12, 0, 1.15), c));
      const visor = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 24, 1, false, -Math.PI / 2, Math.PI), c, 0, R * 0.42, R * 0.86);
      visor.scale.set(1, 1, 0.9); visor.rotation.x = 0.12; head.add(visor);
      head.add(mesh(G.ball, mat('#fffaf0'), 0, R * 1.12, 0, 0.03));
      break;
    }
    case 4: { // 花冠
      const ring = mesh(new THREE.TorusGeometry(R * 0.9, 0.025, 8, 36), mat('#5cc48a'), 0, R * 0.55, -0.02);
      ring.rotation.x = Math.PI / 2 - 0.15; head.add(ring);
      const cols = ['#ff8eb0', '#fff3a0', '#ffffff', '#b6a6ff'];
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        head.add(mesh(G.ball, mat(cols[i % cols.length]), Math.sin(a) * R * 0.9, R * 0.55 + Math.cos(a) * 0.04, Math.cos(a) * R * 0.9 - 0.02, 0.055, 0.04, 0.055));
      }
      break;
    }
    case 5: { // 小葉子（像島上居民頭上那片）
      const leaf = mesh(G.ball, mat('#6cc35a'), 0.03, R * 1.1, 0.02, 0.1, 0.025, 0.06);
      leaf.rotation.z = 0.5; head.add(leaf);
      const stem = mesh(G.cone, mat('#5a9a3c'), -0.02, R * 1.02, 0.02, 0.012, 0.08, 0.012);
      stem.rotation.z = 0.3; head.add(stem);
      break;
    }
    default: break;
  }
}

function addGlasses(head, look) {
  if (!look.glasses) return;
  // 眼睛約在臉部貼圖 (256±104, 222)：換算成球面角度
  const theta = FACE_PATCH.thetaStart + (222 / FACE_H) * FACE_PATCH.thetaLength;
  const dphi = (104 / FACE_W) * FACE_PATCH.phiLength;
  const r = HEAD_R * 1.04;
  const frame = mat(look.glasses === 2 ? '#24242c' : '#7a5a3a');
  for (const s of [-1, 1]) {
    const phi = Math.PI / 2 + s * dphi;
    const x = -r * Math.cos(phi) * Math.sin(theta), y = r * Math.cos(theta), z = r * Math.sin(phi) * Math.sin(theta);
    const ring = mesh(G.ring, frame, x, y, z, 1.05);
    ring.rotation.y = s * dphi;
    head.add(ring);
    if (look.glasses === 2) {
      const lens = mesh(new THREE.CircleGeometry(0.068, 20), mat('#30343c', { roughness: 0.2 }), x, y, z + 0.002);
      lens.rotation.y = s * dphi; head.add(lens);
    }
  }
  head.add(mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), frame, 0, r * Math.cos(theta), r * Math.sin(theta) + 0.012));
}

// ---------- 組裝 ----------
function faceTextures(look) {
  const hair = HAIR_COLORS[look.hairColor];
  return ['open', 'blink', 'joy'].map((mode) => {
    const cv = document.createElement('canvas');
    cv.width = FACE_W; cv.height = FACE_H;
    drawFace(cv.getContext('2d'), look, mode, hair);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

function build(look) {
  const skinM = mat(SKIN[look.skin]);
  const hairM = mat(HAIR_COLORS[look.hairColor], { roughness: 0.55 });
  const topM = patternMat(CLOTH_COLORS[look.topColor], look.pattern);
  const plainTop = mat(CLOTH_COLORS[look.topColor]);
  const botM = mat(CLOTH_COLORS[look.bottomColor]);
  const shoeM = mat(CLOTH_COLORS[look.shoes], { roughness: 0.5 });
  const dress = look.top === 1;

  const body = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = HIP_Y; body.add(hips);

  const legs = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.088, 0, 0); hips.add(pivot);
    const legM = dress || look.bottom !== 0 ? skinM : botM;
    pivot.add(mesh(G.leg, legM, 0, -0.12, 0));
    if (!dress && look.bottom === 1) pivot.add(mesh(G.shortsLeg, botM, 0, -0.035, 0));
    pivot.add(mesh(G.shoe, shoeM, 0, -0.245, 0.03, 0.085, 0.065, 0.12));
    return pivot;
  });

  const torso = new THREE.Group(); hips.add(torso);
  if (dress) {
    torso.add(mesh(G.dress, topM, 0, 0.11, 0));
  } else {
    torso.add(mesh(G.torso, topM, 0, 0.17, 0));
    if (look.bottom === 2) torso.add(mesh(G.skirt, botM, 0, 0.0, 0));
    else torso.add(mesh(G.pelvis, botM, 0, 0.0, 0));
  }
  torso.add(mesh(G.shoulders, look.top === 3 ? plainTop : topM, 0, 0.335, 0, 1, 0.42, 1));
  if (look.top === 2) {
    const hood = mesh(G.hood, plainTop, 0, 0.36, -0.07);
    hood.rotation.set(-0.3, 0, Math.PI * 0.9);
    torso.add(hood);
  }

  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.19, 0.31, 0); pivot.rotation.z = s * 0.32; torso.add(pivot);
    pivot.add(mesh(G.arm, look.top === 2 ? plainTop : skinM, 0, -0.12, 0));
    if (look.top === 0 || look.top === 1) pivot.add(mesh(G.sleeve, plainTop, 0, -0.04, 0));
    pivot.add(mesh(G.hand, skinM, 0, -0.245, 0));
    return pivot;
  });

  const headPivot = new THREE.Group(); headPivot.position.y = HEAD_Y; hips.add(headPivot);
  const head = new THREE.Group(); head.scale.set(1, 0.94, 0.96); headPivot.add(head);
  head.add(mesh(G.head, skinM));
  const faces = faceTextures(look);
  const faceMat = new THREE.MeshStandardMaterial({ map: faces[0], transparent: true, roughness: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const face = new THREE.Mesh(G.face, faceMat);
  face.renderOrder = 1;
  head.add(face);
  addHair(head, look, hairM);
  addEars(head, look, skinM, hairM);
  addHat(head, look);
  addGlasses(head, look);

  const blob = new THREE.Mesh(G.blob, blobMat);
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02;
  body.add(blob);
  return { body, hips, torso, legs, arms, headPivot, faces, faceMat, blob };
}

export function createCharacter(lookIn) {
  const root = new THREE.Group();
  let look = sanitize(lookIn);
  let rig = build(look);
  root.add(rig.body);
  const bubble = new THREE.Sprite(bubbleMaterial('wave'));
  bubble.scale.set(0.62, 0.62, 1); bubble.position.y = BUBBLE_Y; bubble.visible = false;
  root.add(bubble);
  let phase = 0, t = 0, blinkAt = 2 + Math.random() * 3, blinkUntil = 0, faceMode = 0;

  function disposeRig() {
    root.remove(rig.body);
    rig.faces.forEach((f) => f.dispose());
    rig.faceMat.dispose();
  }

  return {
    root,
    get look() { return look; },
    setLook(next) {
      look = sanitize(next);
      disposeRig();
      rig = build(look);
      root.add(rig.body);
    },
    /** s: { speed（m/s）, air（是否在空中）, emote（id 或 null）, emoteT（表情開始後秒數） } */
    animate(dt, s = {}) {
      t += dt;
      const speed = s.speed || 0;
      phase += speed * dt * 2.8;
      const sw = Math.min(1, speed / 3.4) * 0.95;
      const sn = Math.sin(phase);
      const [legL, legR] = rig.legs, [armL, armR] = rig.arms;
      legL.rotation.x = sn * sw; legR.rotation.x = -sn * sw;
      armL.rotation.x = -sn * sw * 0.9; armR.rotation.x = sn * sw * 0.9;
      armL.rotation.z = -0.32; armR.rotation.z = 0.32;
      rig.hips.position.y = HIP_Y + Math.abs(Math.cos(phase)) * 0.045 * Math.min(1, speed / 2);
      rig.hips.rotation.y = sn * 0.08 * sw;
      rig.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012 * (speed < 0.2 ? 1 : 0);
      rig.headPivot.rotation.set(0, 0, 0);
      rig.hips.rotation.x = Math.min(1, speed / 6) * 0.12;
      if (s.air) {
        legL.rotation.x = 0.55; legR.rotation.x = -0.35;
        armL.rotation.z = -1.1; armR.rotation.z = 1.1;
      }

      // 表情動作
      const e = s.emote, et = s.emoteT || 0;
      bubble.visible = Boolean(e) && et < EMOTE_TIME;
      if (bubble.visible) {
        bubble.material = bubbleMaterial(e);
        const pop = Math.min(1, et * 6);
        bubble.scale.setScalar(0.62 * (0.6 + 0.4 * pop));
        bubble.position.y = BUBBLE_Y + Math.sin(et * 5) * 0.03;
        if (e === 'wave') { armR.rotation.z = 2.5 + Math.sin(et * 14) * 0.35; armR.rotation.x = 0; }
        if (e === 'happy') {
          rig.hips.position.y += Math.abs(Math.sin(et * 7)) * 0.16;
          armL.rotation.z = -2.4; armR.rotation.z = 2.4; armL.rotation.x = armR.rotation.x = 0;
        }
        if (e === 'love') { armL.rotation.set(-0.9, 0, 0.5); armR.rotation.set(-0.9, 0, -0.5); rig.headPivot.rotation.z = Math.sin(et * 4) * 0.15; }
        if (e === 'wow') {
          if (et < 0.35) rig.hips.position.y += Math.sin(et / 0.35 * Math.PI) * 0.14;
          armL.rotation.z = -1.4; armR.rotation.z = 1.4;
        }
        if (e === 'hmm') { rig.headPivot.rotation.z = 0.28; armR.rotation.set(-2.2, 0, -0.2); }
      }

      // 眨眼與開心臉
      let want = 0;
      if (t > blinkAt) { blinkUntil = t + 0.13; blinkAt = t + 2.2 + Math.random() * 3.5; }
      if (t < blinkUntil) want = 1;
      if (bubble.visible && (e === 'happy' || e === 'love' || e === 'wave')) want = 2;
      if (want !== faceMode) { faceMode = want; rig.faceMat.map = rig.faces[want]; rig.faceMat.needsUpdate = true; }
    },
    setShadowBlob(on) { rig.blob.visible = on; },
    dispose() { disposeRig(); },
  };
}
