// 臉部貼圖：照美術規格（spec.json 的 face / features / expressions）畫五官。
// 畫布 512×544 對應臉片 0.32×0.34 m；座標用臉寬、臉高的百分比。
// 底色透明，只畫五官（臉片貼在頭部正面、離表面 2 mm，膚色由頭本身提供）。
import { EYE_COLORS, SKIN } from './look.js';

export const FACE_W = 512, FACE_H = 544;
const px = (p) => (p / 100) * FACE_W;      // 寬度百分比
const py = (p) => (p / 100) * FACE_H;      // 高度百分比
const LID = '#4A372C', PUPIL = '#241C18', SCLERA = '#FFFEF8';
const STROKE = { thin: py(1.2), lid: py(2.4), mouth: py(2.0), lash: py(1.4) };

const EYE = { x: [31, 69], y: 40, w: 28, h: 28 };          // 審稿一：眼寬眼高都是臉的 28%
const BROW = { y: 22, w: 20, t: 3.2 };
const NOSE = { y: 60, w: 8, h: 6 };
const MOUTH = { y: 74, w: 26, h: 10 };
const BLUSH = { x: [16, 84], y: 52, w: 14, h: 9 };

// 規格 features.eyes
// 虹膜 iris 是眼高的比例（直徑），審稿一放大到 0.85
const EYES = [
  { iris: 0.85, pupil: 0.42, catch: 0.28, lid: 0.06, hs: 1 },
  { iris: 0.85, pupil: 0.4, catch: 0.32, lid: 0.06, hs: 1, sparkle: true },
  { iris: 0.85, pupil: 0.42, catch: 0.22, lid: 0.42, hs: 0.72 },
  { iris: 0.74, pupil: 0.42, catch: 0.22, lid: 0.1, hs: 0.78, ws: 1.08, lift: 0.1, ellipse: true },
  { iris: 0.85, pupil: 0.42, catch: 0.28, lid: 0.08, hs: 1, lashes: 3 },
  { iris: 0.88, pupil: 0, catch: 0.2, lid: 0.06, hs: 1, star: true },
  { iris: 0.38, pupil: 0.7, catch: 0.3, lid: 0.06, hs: 1 },
  { iris: 0.8, pupil: 0.42, catch: 0.24, lid: 0.12, hs: 0.92, drop: 0.14 },
];

function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
function luminance(hex) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hexRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function star(g, x, y, r1, r2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + i * Math.PI / n; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
  g.closePath(); g.fill();
}
function heart(g, x, y, s) {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.7, y - s * 1.3, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 0.9);
  g.fill();
}

/** 一隻眼睛。side：-1 左、+1 右（畫面上的左右） */
function eye(g, cx, look, ex, side) {
  const spec = EYES[ex.eyes] || EYES[0];
  const W = px(EYE.w) * (spec.ws || 1) * (ex.scale || 1), H = py(EYE.h) * spec.hs * (ex.scale || 1);
  const cy = py(EYE.y);
  g.save();
  g.translate(cx, cy);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (ex.closed) {                                            // 閉眼：與眼同寬的弧
    g.strokeStyle = LID; g.lineWidth = H * 0.18 * 0.8;
    g.beginPath();
    if (ex.closed === 'happy') { g.moveTo(-W * 0.42, H * 0.12); g.quadraticCurveTo(0, -H * 0.45, W * 0.42, H * 0.12); }
    else { g.moveTo(-W * 0.42, -H * 0.02); g.quadraticCurveTo(0, H * 0.32, W * 0.42, -H * 0.02); }
    g.stroke(); g.restore(); return;
  }
  // 外眼角上揚／下垂：外側是 side 方向
  const tilt = (spec.lift ? -spec.lift : 0) + (spec.drop ? spec.drop : 0);
  g.rotate(side * tilt * 0.9);
  const rx = W / 2, ry = H / 2;
  const scleraPath = () => { g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); };
  g.save();
  scleraPath(); g.clip();
  g.fillStyle = SCLERA; g.fillRect(-rx, -ry, W, H);
  const ir = (H * spec.iris / 2) * (ex.smallPupil ? 0.92 : 1);
  const iy = ry * 0.08;
  const iris = EYE_COLORS[look.eyeColor];
  if (ex.love) {
    g.fillStyle = '#E2506A'; heart(g, 0, iy, ir * 0.75);
  } else if (spec.star) {
    g.fillStyle = PUPIL; g.beginPath(); g.arc(0, iy, ir, 0, Math.PI * 2); g.fill();
    g.fillStyle = mixHex(iris, '#FFE07A', 0.45); star(g, 0, iy, ir * 0.78, ir * 0.3, 4);
  } else {
    g.fillStyle = iris; g.beginPath(); g.arc(0, iy, ir, 0, Math.PI * 2); g.fill();
    g.fillStyle = mixHex(iris, '#000000', 0.25); g.beginPath(); g.arc(0, iy, ir, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(0, iy); g.fill();
    const pr = ir * (spec.pupil || 0.4) * (ex.smallPupil ? 0.6 : 1);
    g.fillStyle = PUPIL; g.beginPath(); g.arc(0, iy + ir * 0.05, pr, 0, Math.PI * 2); g.fill();
  }
  // 高光：十點鐘方向一顆大的、右下一顆小的
  g.fillStyle = '#FFFFFF';
  const cr = H * spec.catch / 2;
  g.beginPath(); g.ellipse(-ir * 0.42, iy - ir * 0.45, cr * 1.1, cr, -0.5, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(ir * 0.38, iy + ir * 0.42, cr * 0.42, 0, Math.PI * 2); g.fill();
  if (spec.sparkle) star(g, ir * 0.62, iy - ir * 0.62, cr * 0.9, cr * 0.25, 4);
  // 上眼瞼蓋住的部分擦掉（露出底下的皮膚）
  const lidY = -ry + H * spec.lid;
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(-rx - 2, -ry - 2, W + 4, lidY + ry + 2);
  g.globalCompositeOperation = 'source-over';
  g.restore();
  // 眼眶細線與上眼瞼粗線
  g.strokeStyle = LID; g.lineWidth = STROKE.thin;
  scleraPath(); g.stroke();
  g.save(); scleraPath(); g.clip();
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(-rx - 4, -ry - 4, W + 8, lidY + ry + 4);
  g.restore();
  // 上眼瞼：沿著被切掉的位置畫一道弧
  const half = rx * Math.sqrt(Math.max(0, 1 - (lidY / ry) ** 2));
  g.lineWidth = STROKE.lid;
  g.beginPath();
  g.moveTo(-half - STROKE.lid * 0.2, lidY + 2);
  g.quadraticCurveTo(0, lidY - H * 0.06, half + STROKE.lid * 0.2, lidY + 2);
  g.stroke();
  if (spec.lashes) {
    g.lineWidth = STROKE.lash;
    for (let i = 0; i < spec.lashes; i++) {
      const a = -Math.PI / 2 + side * (0.55 + i * 0.28);
      const x0 = Math.cos(a) * rx, y0 = Math.sin(a) * ry;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * W * 0.18, y0 + Math.sin(a) * W * 0.18); g.stroke();
    }
  }
  g.restore();
}

function brows(g, look, ex, hairHex) {
  const kinds = ex.brows || [look.brows, look.brows];
  g.strokeStyle = mixHex(hairHex, '#2C2622', 0.15);
  g.fillStyle = g.strokeStyle;
  g.lineCap = 'round';
  [-1, 1].forEach((side, i) => {
    const k = kinds[i];
    if (!k) return;
    const cx = px(EYE.x[i]), cy = py(BROW.y);
    const w = px(BROW.w) * (k === 2 ? 0.9 : k === 5 ? 0.55 : 1);
    const t = py([0, 2.2, 4.6, 2.6, 2.6, 3.4][k]);
    const inner = cx - side * w / 2, outer = cx + side * w / 2;
    g.lineWidth = t;
    g.beginPath();
    if (k === 1) { g.moveTo(inner, cy); g.quadraticCurveTo(cx, cy - py(4), outer, cy); }
    else if (k === 2) { g.moveTo(inner, cy); g.quadraticCurveTo(cx, cy - py(1.5), outer, cy); }
    else if (k === 3) { g.moveTo(inner, cy - py(4)); g.quadraticCurveTo(cx, cy - py(2.4), outer, cy + py(0.8)); }
    else if (k === 4) { g.moveTo(inner, cy + py(1)); g.quadraticCurveTo(cx, cy - py(2.6), outer, cy - py(4)); }
    else if (k === 5) { g.moveTo(inner, cy); g.lineTo(outer, cy - py(0.5)); }
    g.stroke();
  });
}

function nose(g, look) {
  const skin = SKIN[look.skin];
  const col = mixHex(skin, '#7A4A3A', 0.35);
  const x = 256, y = py(NOSE.y);
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round';
  switch (look.nose) {
    case 1: g.beginPath(); g.arc(x, y, px(5) / 2, 0, Math.PI * 2); g.fill(); break;
    case 2: g.lineWidth = STROKE.mouth; g.beginPath(); g.moveTo(x + px(1.2), y - py(2.4)); g.quadraticCurveTo(x + px(2.4), y + py(1.6), x - px(1.4), y + py(1.6)); g.stroke(); break;
    case 3:
      g.fillStyle = mixHex(skin, '#7A4A3A', 0.18); g.beginPath(); g.ellipse(x, y, px(NOSE.w) / 2, py(NOSE.h) / 2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.ellipse(x - px(1.2), y - py(1.2), px(1.4), py(0.9), -0.4, 0, Math.PI * 2); g.fill();
      break;
    case 4: g.lineWidth = STROKE.thin * 1.4; g.beginPath(); g.moveTo(x - px(4), y); g.quadraticCurveTo(x, y + py(1.6), x + px(4), y); g.stroke(); break;
    default: break;
  }
}

function mouth(g, look, ex) {
  const m = ex.mouth != null ? ex.mouth : look.mouth;
  const skin = SKIN[look.skin];
  const ink = luminance(skin) > 0.45 ? '#C45B66' : '#8E3A48';
  const inside = mixHex(ink, '#3A1A20', 0.45);
  const x = 256, y = py(MOUTH.y);
  g.strokeStyle = ink; g.lineWidth = STROKE.mouth; g.lineCap = 'round'; g.lineJoin = 'round';
  const openD = (w, h, teeth) => {
    g.fillStyle = inside;
    g.beginPath(); g.moveTo(x - w / 2, y - h * 0.35); g.lineTo(x + w / 2, y - h * 0.35);
    g.quadraticCurveTo(x + w / 2, y + h, x, y + h * 0.75); g.quadraticCurveTo(x - w / 2, y + h, x - w / 2, y - h * 0.35); g.closePath(); g.fill();
    g.save(); g.clip();
    g.fillStyle = '#E0898C'; g.beginPath(); g.ellipse(x, y + h * 0.75, w * 0.32, h * 0.38, 0, 0, Math.PI * 2); g.fill();
    if (teeth) { g.fillStyle = '#FFF8F2'; g.fillRect(x - w / 2, y - h * 0.35, w, h * 0.3); }
    g.restore();
    g.stroke();
  };
  g.beginPath();
  switch (m) {
    case 0: { const w = px(26); g.moveTo(x - w / 2, y - py(1)); g.quadraticCurveTo(x, y + py(4.5), x + w / 2, y - py(1)); g.stroke(); break; }
    case 1: openD(px(24), py(9)); break;
    case 2: { const w = px(16); g.moveTo(x - w / 2, y - py(1)); g.quadraticCurveTo(x - w / 4, y + py(3.4), x, y); g.quadraticCurveTo(x + w / 4, y + py(3.4), x + w / 2, y - py(1)); g.stroke(); break; }
    case 3: g.fillStyle = inside; g.ellipse(x, y + py(1), px(7) / 2, py(8) / 2, 0, 0, Math.PI * 2); g.fill(); g.stroke(); break;
    case 4:
      g.fillStyle = ink; g.ellipse(x, y + py(0.5), px(10) / 2, py(6) / 2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(x - px(1.6), y - py(0.6), px(1.6), py(0.8), -0.3, 0, Math.PI * 2); g.fill();
      break;
    case 5: { const w = px(14); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x, y + py(1.4), x + w / 2, y); g.stroke(); break; }
    case 6: openD(px(24), py(9), true); break;
    case 7: {
      const w = px(26);
      g.fillStyle = '#E0898C'; g.beginPath(); g.ellipse(x + px(2), y + py(3.4), px(3.4), py(3.2), 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(x - w / 2, y - py(1)); g.quadraticCurveTo(x, y + py(4.5), x + w / 2, y - py(1)); g.stroke();
      break;
    }
    default: break;
  }
}

function blush(g, look) {
  const k = look.blush;
  if (!k) return;
  for (let i = 0; i < 2; i++) {
    const x = px(BLUSH.x[i]), y = py(BLUSH.y);
    if (k === 1) {
      g.fillStyle = 'rgba(242,163,160,.55)';
      g.beginPath(); g.ellipse(x, y, px(BLUSH.w) / 2, py(BLUSH.h) / 2, 0, 0, Math.PI * 2); g.fill();
    } else if (k === 2) {
      g.strokeStyle = 'rgba(226,128,124,.8)'; g.lineWidth = STROKE.thin * 1.2; g.lineCap = 'round';
      for (let s = -1; s <= 1; s++) { g.beginPath(); g.moveTo(x + s * px(3.2) - px(1.6), y + py(1.6)); g.lineTo(x + s * px(3.2) + px(1.6), y - py(1.6)); g.stroke(); }
    }
  }
  if (k === 3) {                                // 雀斑：鼻梁兩側共五點，跨臉寬 28%
    g.fillStyle = '#C4846A';
    const dots = [[-14, 52], [-9, 55], [-11, 49], [10, 51], [13, 55]];
    for (const [dx, dy] of dots) { g.beginPath(); g.arc(256 + px(dx), py(dy), px(0.9), 0, Math.PI * 2); g.fill(); }
  }
}

// 表情：只換眼睛、眉毛與嘴的畫法（規格 expressions）
export const EXPRESSIONS = ['neutral', 'blink', 'happy', 'wow', 'love', 'hmm'];
function expression(look, mode) {
  switch (mode) {
    case 'blink': return { eyes: look.eyes, closed: 'blink' };
    case 'happy': return { eyes: look.eyes, closed: 'happy', mouth: 1 };
    case 'wow': return { eyes: 0, scale: 1.12, smallPupil: true, mouth: 3, brows: [4, 4] };
    case 'love': return { eyes: look.eyes, love: true, mouth: 0 };
    case 'hmm': return { eyes: 3, mouth: 5, brows: [4, 3] };
    default: return { eyes: look.eyes };
  }
}

/** 畫整張臉（透明底）。hairHex 給眉毛用。 */
export function drawFace(g, look, mode = 'neutral', hairHex = '#8D5A34', clear = true) {
  if (clear) g.clearRect(0, 0, FACE_W, FACE_H);
  const ex = expression(look, mode);
  blush(g, look);
  eye(g, px(EYE.x[0]), look, ex, -1);
  eye(g, px(EYE.x[1]), look, ex, 1);
  brows(g, look, ex, hairHex);
  nose(g, look);
  mouth(g, look, ex);
}

/** 臉片的底色：那一檔膚色，外圈 6% 羽化，讓面片邊界消失 */
export function drawFaceSkin(g, look) {
  g.clearRect(0, 0, FACE_W, FACE_H);
  g.fillStyle = SKIN[look.skin];
  g.fillRect(0, 0, FACE_W, FACE_H);
  g.globalCompositeOperation = 'destination-in';
  for (const [x1, y1] of [[FACE_W, 0], [0, FACE_H]]) {
    const gr = g.createLinearGradient(0, 0, x1, y1);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.06, 'rgba(0,0,0,1)');
    gr.addColorStop(0.94, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, FACE_W, FACE_H);
  }
  g.globalCompositeOperation = 'source-over';
}

/** 捏臉選單的小圖：膚色圓臉上畫整張臉 */
export function drawFaceIcon(canvas, look, hairHex) {
  const g = canvas.getContext('2d');
  const s = canvas.width;
  g.clearRect(0, 0, s, s);
  g.fillStyle = SKIN[look.skin];
  g.beginPath(); g.ellipse(s / 2, s / 2 + s * 0.02, s * 0.46, s * 0.44, 0, 0, Math.PI * 2); g.fill();
  const off = document.createElement('canvas');
  off.width = FACE_W; off.height = FACE_H;
  drawFace(off.getContext('2d'), look, 'neutral', hairHex);
  const k = (s * 0.92) / FACE_W;
  g.drawImage(off, s / 2 - 256 * k, s / 2 - py(52) * k, FACE_W * k, FACE_H * k);
}
