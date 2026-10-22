// 臉部貼圖：在 512×400 的透明畫布上畫眼睛、眉毛、鼻子、嘴巴、腮紅。
// 這張圖會貼在頭部球體正面的一塊曲面上（character.js 的 FACE_PATCH），
// 畫布中心 (256, 200) 約在臉的正中央。也用來畫捏臉選單的小圖示。
import { EYE_COLORS, SKIN } from './look.js';

export const FACE_W = 512, FACE_H = 400;
const EYE_Y = 222, EYE_DX = 104, NOSE_Y = 270, MOUTH_Y = 304;
const INK = '#3a2a22';

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function eye(g, x, look, mode, side) {
  const col = EYE_COLORS[look.eyeColor];
  g.save();
  g.translate(x, EYE_Y);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (mode === 'blink' || look.eyes === 2) {          // 閉眼／瞇瞇眼：一條弧線
    g.strokeStyle = INK; g.lineWidth = 9;
    g.beginPath();
    if (mode === 'blink') g.arc(0, -8, 26, 0.2 * Math.PI, 0.8 * Math.PI);
    else g.arc(0, 14, 26, 1.2 * Math.PI, 1.8 * Math.PI);
    g.stroke(); g.restore(); return;
  }
  if (mode === 'joy') {                               // 開心：^ ^
    g.strokeStyle = INK; g.lineWidth = 10;
    g.beginPath(); g.moveTo(-24, 8); g.lineTo(0, -16); g.lineTo(24, 8); g.stroke();
    g.restore(); return;
  }
  const iris = (rx, ry) => {
    g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.beginPath(); g.ellipse(0, ry * 0.18, rx * 0.72, ry * 0.68, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = INK; g.beginPath(); g.ellipse(0, ry * 0.2, rx * 0.38, ry * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.ellipse(-rx * 0.32, -ry * 0.38, rx * 0.3, ry * 0.24, 0, 0, Math.PI * 2); g.fill();
  };
  switch (look.eyes) {
    case 0: iris(22, 28); break;                                       // 圓圓眼
    case 1:                                                            // 閃亮眼
      iris(26, 34);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(10, 14, 6, 0, Math.PI * 2); g.fill();
      break;
    case 3:                                                            // 杏仁眼
      g.rotate(side * -0.12); iris(26, 20); break;
    case 4:                                                            // 睫毛眼
      iris(22, 28);
      g.strokeStyle = INK; g.lineWidth = 6;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + side * (0.55 + i * 0.32);
        g.beginPath(); g.moveTo(Math.cos(a) * 24, Math.sin(a) * 28); g.lineTo(Math.cos(a) * 38, Math.sin(a) * 40); g.stroke();
      }
      break;
    case 5: {                                                          // 星星眼
      g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, 25, 30, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = col === '#2a2018' ? '#ffd84a' : col;
      star(g, 0, 2, 18, 8);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-10, -14, 6, 0, Math.PI * 2); g.fill();
      break;
    }
    case 6:                                                            // 豆豆眼
      g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, 11, 14, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-3, -5, 3.5, 0, Math.PI * 2); g.fill();
      break;
    case 7:                                                            // 下垂眼
      iris(22, 26);
      g.strokeStyle = INK; g.lineWidth = 7;
      g.beginPath(); g.moveTo(-side * 30, -26); g.quadraticCurveTo(0, -36, side * 32, -18); g.stroke();
      break;
    default: iris(22, 28);
  }
  g.restore();
}

function star(g, x, y, r1, r2) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r2 : r1, a = -Math.PI / 2 + i * Math.PI / 5;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath(); g.fill();
}

function brows(g, look, hairCol) {
  if (!look.brows) return;
  g.strokeStyle = shade(hairCol, 0.75); g.lineCap = 'round';
  for (const s of [-1, 1]) {
    const x = 256 + s * EYE_DX;
    g.beginPath();
    switch (look.brows) {
      case 1: g.lineWidth = 6; g.moveTo(x - 22, 172); g.quadraticCurveTo(x, 162, x + 22, 172); break;
      case 2: g.lineWidth = 13; g.moveTo(x - 22, 170); g.lineTo(x + 22, 170); break;
      case 3: g.lineWidth = 8; g.moveTo(x - s * 22, 162); g.lineTo(x + s * 22, 176); break;   // 八字（內高外低）
      case 4: g.lineWidth = 8; g.moveTo(x - s * 22, 176); g.lineTo(x + s * 22, 160); break;   // 挑眉
      default: break;
    }
    g.stroke();
  }
}

function nose(g, look) {
  const skin = SKIN[look.skin];
  switch (look.nose) {
    case 1: g.fillStyle = shade(skin, 0.72); g.beginPath(); g.ellipse(256, NOSE_Y, 7, 5, 0, 0, Math.PI * 2); g.fill(); break;
    case 2: g.fillStyle = shade(skin, 0.78); g.beginPath(); g.moveTo(256, NOSE_Y - 10); g.lineTo(266, NOSE_Y + 6); g.lineTo(246, NOSE_Y + 6); g.closePath(); g.fill(); break;
    case 3: g.fillStyle = shade(skin, 0.86); g.beginPath(); g.ellipse(256, NOSE_Y, 14, 11, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.arc(251, NOSE_Y - 4, 4, 0, Math.PI * 2); g.fill(); break;
    default: break;
  }
}

function mouth(g, look, mode) {
  g.strokeStyle = INK; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 7;
  const m = mode === 'joy' ? 1 : look.mouth;
  const y = MOUTH_Y;
  const open = (w, h) => {
    g.fillStyle = '#8c2f3a';
    g.beginPath(); g.moveTo(256 - w, y - 4); g.quadraticCurveTo(256, y - 2, 256 + w, y - 4); g.quadraticCurveTo(256 + w * 0.7, y + h, 256, y + h); g.quadraticCurveTo(256 - w * 0.7, y + h, 256 - w, y - 4); g.fill();
    g.fillStyle = '#ff8a95'; g.beginPath(); g.ellipse(256, y + h * 0.7, w * 0.45, h * 0.28, 0, 0, Math.PI * 2); g.fill();
  };
  g.beginPath();
  switch (m) {
    case 0: g.arc(256, y - 16, 20, 0.22 * Math.PI, 0.78 * Math.PI); g.stroke(); break;
    case 1: open(26, 30); break;
    case 2: g.moveTo(228, y - 6); g.quadraticCurveTo(242, y + 12, 256, y - 2); g.quadraticCurveTo(270, y + 12, 284, y - 6); g.stroke(); break;
    case 3: g.fillStyle = '#8c2f3a'; g.ellipse(256, y, 9, 11, 0, 0, Math.PI * 2); g.fill(); break;
    case 4:
      open(22, 22);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(262, y - 4); g.lineTo(272, y - 4); g.lineTo(267, y + 7); g.closePath(); g.fill();
      break;
    case 5: g.moveTo(240, y); g.lineTo(272, y); g.stroke(); break;
    case 6:
      g.arc(256, y - 16, 20, 0.22 * Math.PI, 0.78 * Math.PI); g.stroke();
      g.fillStyle = '#ff7a8a'; g.beginPath(); g.ellipse(262, y + 8, 9, 11, 0, 0, Math.PI * 2); g.fill();
      break;
    default: break;
  }
}

function blush(g, look) {
  if (!look.blush) return;
  if (look.blush === 3) {
    g.fillStyle = 'rgba(150,90,50,.55)';
    for (const s of [-1, 1]) for (const [dx, dy] of [[-10, 0], [6, -6], [8, 9], [-4, 12]]) {
      g.beginPath(); g.arc(256 + s * (EYE_DX + 8) + dx, EYE_Y + 50 + dy, 3.6, 0, Math.PI * 2); g.fill();
    }
    return;
  }
  g.fillStyle = look.blush === 1 ? 'rgba(255,120,150,.42)' : 'rgba(255,140,80,.45)';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(256 + s * (EYE_DX + 14), EYE_Y + 52, 30, 17, 0, 0, Math.PI * 2); g.fill(); }
}

/**
 * 畫整張臉（透明底）。mode：'open' 一般、'blink' 閉眼、'joy' 開心。
 * hairCol 給眉毛用。
 */
export function drawFace(g, look, mode = 'open', hairCol = '#3a2a20', clear = true) {
  if (clear) g.clearRect(0, 0, FACE_W, FACE_H);
  blush(g, look);
  for (const s of [-1, 1]) eye(g, 256 + s * EYE_DX, look, mode, s);
  brows(g, look, hairCol);
  nose(g, look);
  mouth(g, look, mode);
}

/** 捏臉選單用的小圖：膚色圓臉上畫整張臉 */
export function drawFaceIcon(canvas, look, hairCol) {
  const g = canvas.getContext('2d');
  const s = canvas.width;
  g.clearRect(0, 0, s, s);
  g.fillStyle = SKIN[look.skin];
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2); g.fill();
  g.save();
  const k = s / 330;
  g.translate(s / 2 - 256 * k, s / 2 - 238 * k);
  g.scale(k, k);
  drawFace(g, look, 'open', hairCol, false);
  g.restore();
}
