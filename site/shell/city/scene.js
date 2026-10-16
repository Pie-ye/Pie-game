/**
 * 三個街區的外觀：背景、地面、天氣、路燈、房子外牆與招牌。
 * 賭場街＝賽博龐克夜城賭場（暗、雨、霓虹）；菲比廣場＝星光少女（粉彩、星星）；電玩巷＝傳統遊戲機台（80 年代街機廳）。
 * 全部以 canvas 2D 畫，座標用 layout.js 的邏輯像素；S 是 city.js 每一格傳進來的狀態。
 */
import { GROUND_Y, WORLD_H } from './layout.js';

export const INK = '#0b0714';
export const FACADE_W = 410;

/** 門的尺寸跟著房子高度走（矮房子配矮門、高樓配高門），寬度固定是高度的 0.6。 */
export function doorDims(b) {
  const h = Math.max(158, Math.min(214, Math.round(b.h * 0.44)));
  return { w: Math.round(h * 0.6), h };
}

export const THEMES = {
  casino: {
    bg: 'bg-casino.webp',
    sky: ['#07031a', '#1b0a3a', '#4a0f55'],
    ground: ['#241046', '#120726', '#05020c'],
    edge: ['#35f0ff', '#ff2bd6'],
    weather: 'rain',
    lamp: 'pole',
    carpet: '#b3122f',
    baseHeight: 440,
    scan: 1,
  },
  phoebe: {
    bg: 'bg-phoebe.webp',
    sky: ['#4a3a9a', '#a46fe0', '#ffc2ec'],
    ground: ['#ffd1f0', '#e3a3ea', '#a877d6'],
    edge: ['#ffffff', '#ff9fd8'],
    weather: 'stars',
    lamp: 'star',
    carpet: '#ff8fd0',
    baseHeight: 390,
    scan: 0.25,
  },
  arcade: {
    bg: 'bg-arcade.webp',
    sky: ['#0a0f2e', '#1a2468', '#3a1a68'],
    ground: ['#1a1a4a', '#0e0e30', '#06061a'],
    edge: ['#ffd23a', '#ff3b3b'],
    weather: 'pixels',
    lamp: 'globe',
    carpet: '#2a63ff',
    baseHeight: 440,
    scan: 0.8,
  },
};

const SIGN_FONT = '800 36px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", system-ui, sans-serif';

export function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function star(g, x, y, r, points = 4, inner = 0.38) {
  g.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const rad = i % 2 ? r * inner : r;
    const a = (Math.PI / points) * i - Math.PI / 2;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}


// ---------------------------------------------------------------- 每款遊戲的霓虹圖示（屋頂造型與門上標誌）

/** 以 kind 畫一個霓虹線條圖示，中心 (cx,cy)、大小 r。先畫黑色外框再畫發光的彩線，像貼在牆上的霓虹管。 */
function drawGlyph(g, kind, cx, cy, r, color, t) {
  const path = () => {
    g.beginPath();
    switch (kind) {
      case 'slots': {
        for (let i = -1; i <= 1; i += 1) {
          g.rect(cx + i * r * 0.72 - r * 0.3, cy - r * 0.42, r * 0.6, r * 0.84);
        }
        break;
      }
      case 'blackjack': {
        g.moveTo(cx, cy - r);
        g.bezierCurveTo(cx + r * 1.3, cy - r * 0.1, cx + r * 0.6, cy + r * 0.7, cx, cy + r * 0.3);
        g.bezierCurveTo(cx - r * 0.6, cy + r * 0.7, cx - r * 1.3, cy - r * 0.1, cx, cy - r);
        g.moveTo(cx, cy + r * 0.3);
        g.lineTo(cx - r * 0.28, cy + r);
        g.lineTo(cx + r * 0.28, cy + r);
        g.closePath();
        break;
      }
      case 'baccarat': {
        g.moveTo(cx - r, cy + r * 0.6);
        g.lineTo(cx - r, cy - r * 0.5);
        g.lineTo(cx - r * 0.5, cy);
        g.lineTo(cx, cy - r * 0.8);
        g.lineTo(cx + r * 0.5, cy);
        g.lineTo(cx + r, cy - r * 0.5);
        g.lineTo(cx + r, cy + r * 0.6);
        g.closePath();
        break;
      }
      case 'niuniu': {
        g.moveTo(cx - r * 1.1, cy - r * 0.8);
        g.quadraticCurveTo(cx - r * 1.2, cy + r * 0.1, cx - r * 0.5, cy + r * 0.1);
        g.lineTo(cx - r * 0.4, cy + r * 0.9);
        g.lineTo(cx + r * 0.4, cy + r * 0.9);
        g.lineTo(cx + r * 0.5, cy + r * 0.1);
        g.quadraticCurveTo(cx + r * 1.2, cy + r * 0.1, cx + r * 1.1, cy - r * 0.8);
        break;
      }
      case 'dragon': {
        g.moveTo(cx - r * 1.1, cy + r * 0.5);
        g.bezierCurveTo(cx - r * 0.6, cy - r * 1.1, cx - r * 0.2, cy + r * 1.1, cx + r * 0.3, cy - r * 0.2);
        g.bezierCurveTo(cx + r * 0.6, cy - r * 0.9, cx + r * 0.9, cy - r * 0.7, cx + r * 1.1, cy - r * 0.2);
        g.lineTo(cx + r * 0.8, cy - r * 0.05);
        break;
      }
      case 'texas': {
        g.ellipse(cx, cy + r * 0.35, r * 1.2, r * 0.3, 0, 0, Math.PI * 2);
        g.moveTo(cx - r * 0.55, cy + r * 0.3);
        g.quadraticCurveTo(cx - r * 0.5, cy - r * 0.9, cx, cy - r * 0.6);
        g.quadraticCurveTo(cx + r * 0.5, cy - r * 0.9, cx + r * 0.55, cy + r * 0.3);
        break;
      }
      case 'coinflip': {
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.moveTo(cx + r * 0.62, cy);
        g.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
        break;
      }
      case 'wheel': {
        g.arc(cx, cy, r, 0, Math.PI * 2);
        const spin = t * 1.2;
        for (let i = 0; i < 8; i += 1) {
          const a = spin + (Math.PI / 4) * i;
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        break;
      }
      default: {
        star(g, cx, cy, r, 5, 0.5);
      }
    }
  };
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  path();
  g.lineWidth = 11;
  g.strokeStyle = INK;
  g.stroke();
  path();
  g.lineWidth = 5;
  g.strokeStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.stroke();
  g.restore();
}

/** 每棟房子的高度：依街區基準加上以 id 算出的固定變化，同一款遊戲永遠一樣高。 */
export function facadeHeight(building) {
  const theme = THEMES[building.look.district] || THEMES.casino;
  let h = 7;
  for (const ch of building.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return theme.baseHeight + ((h % 9) - 4) * 11;
}

// ---------------------------------------------------------------- 背景

function drawTiled(S, a, parallax, y, h) {
  const { g, cam, viewW } = S;
  const w = (a.sw / a.sh) * h;
  const period = w * 2;
  const pos = (((cam * parallax) % period) + period) % period;
  const first = Math.floor(pos / w);
  const x0 = -(pos % w);
  for (let i = 0, x = x0; x < viewW + 1; i += 1, x += w) {
    if ((first + i) % 2 === 1) {
      g.save();
      g.translate(x + w + 1, 0);
      g.scale(-1, 1);
      g.drawImage(a.img, a.sx, a.sy, a.sw, a.sh, 0, y, w + 1, h);
      g.restore();
    } else {
      g.drawImage(a.img, a.sx, a.sy, a.sw, a.sh, x, y, w + 1, h);
    }
  }
}

export function drawBackdrop(S, id, alpha) {
  const { g, viewW, art, t } = S;
  const th = THEMES[id];
  g.save();
  g.globalAlpha = alpha;
  const grad = g.createLinearGradient(0, 0, 0, GROUND_Y);
  th.sky.forEach((c, i) => grad.addColorStop(i / (th.sky.length - 1), c));
  g.fillStyle = th.sky[0];
  g.fillRect(0, -S.topPad, viewW, S.topPad + 1);
  g.fillStyle = grad;
  g.fillRect(0, 0, viewW, WORLD_H);
  const bg = art[`bg-${id}`];
  if (bg) {
    drawTiled(S, bg, 0.07, 0, GROUND_Y + 10);
    // 直式螢幕上方多出來的部分：把背景上下鏡像接上去，不要留一塊空白。
    if (S.topPad > 0) {
      g.save();
      g.scale(1, -1);
      drawTiled(S, bg, 0.07, 0, GROUND_Y + 10);
      g.restore();
    }
  }
  if (id !== 'arcade') {
    for (const s of S.stars) {
      const x = (((s.x - S.cam * 0.03) % 3000) + 3000) % 3000;
      if (x > viewW) continue;
      g.globalAlpha = alpha * (0.3 + 0.7 * Math.abs(Math.sin(t * 1.4 + s.p)));
      g.fillStyle = id === 'phoebe' ? '#fff3fb' : '#fff';
      if (id === 'phoebe' && s.r > 1.6) {
        star(g, x, s.y, s.r * 2.6);
        g.fill();
      } else {
        g.fillRect(x, s.y, s.r, s.r);
      }
    }
  }
  if (id === 'phoebe') {
    // 偶像舞台的聚光燈：三道光柱左右緩緩掃動
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i += 1) {
      const baseX = viewW * (0.2 + i * 0.3);
      const sway = Math.sin(t * 0.6 + i * 2) * 140;
      const hue = ['255,143,208', '170,200,255', '255,240,170'][i];
      const beam = g.createLinearGradient(0, 0, 0, GROUND_Y);
      beam.addColorStop(0, `rgba(${hue},0.32)`);
      beam.addColorStop(1, `rgba(${hue},0)`);
      g.fillStyle = beam;
      g.beginPath();
      g.moveTo(baseX - 12, -S.topPad);
      g.lineTo(baseX + 12, -S.topPad);
      g.lineTo(baseX + sway + 130, GROUND_Y);
      g.lineTo(baseX + sway - 130, GROUND_Y);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
  if (id === 'casino') {
    for (const car of S.cars) {
      const span = viewW + 400;
      const x = ((((car.x + car.speed * t) - S.cam * 0.45) % span) + span) % span - 200;
      g.globalAlpha = alpha;
      g.fillStyle = car.hue;
      g.shadowColor = car.hue;
      g.shadowBlur = 14;
      g.fillRect(x, car.y, 26, 4);
      g.fillRect(x + (car.speed > 0 ? -34 : 26), car.y + 1, 34, 2);
      g.shadowBlur = 0;
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- 地面

export function drawGround(S, id, alpha) {
  const { g, viewW, cam, pulse } = S;
  const th = THEMES[id];
  const top = GROUND_Y;
  g.save();
  g.globalAlpha = alpha;
  const grad = g.createLinearGradient(0, top, 0, WORLD_H);
  grad.addColorStop(0, th.ground[0]);
  grad.addColorStop(0.2, th.ground[1]);
  grad.addColorStop(1, th.ground[2]);
  g.fillStyle = grad;
  g.fillRect(0, top, viewW, WORLD_H - top);
  if (id === 'casino') {
    // 濕柏油：斜向的霓虹水光與路面標線
    g.fillStyle = 'rgba(53,240,255,0.10)';
    for (let x = -(cam % 240); x < viewW; x += 240) g.fillRect(x, top + 30, 2, WORLD_H - top);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (let x = -(cam % 160); x < viewW; x += 160) g.fillRect(x, WORLD_H - 34, 90, 5);
  } else if (id === 'phoebe') {
    // 粉彩菱形磁磚，每隔幾格有一顆小星星
    const size = 70;
    const x0 = -(cam % size) - size;
    const idx0 = Math.floor(cam / size) - 1;
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0, x = x0; x < viewW + size; c += 1, x += size) {
        const y = top + 14 + r * 30;
        const odd = (idx0 + c + r) % 2 === 0;
        g.fillStyle = odd ? 'rgba(255,255,255,0.40)' : 'rgba(255,143,208,0.30)';
        g.beginPath();
        g.moveTo(x + size / 2, y);
        g.lineTo(x + size, y + 15);
        g.lineTo(x + size / 2, y + 30);
        g.lineTo(x, y + 15);
        g.closePath();
        g.fill();
        if ((idx0 + c) % 4 === 0 && r === 1) {
          g.fillStyle = '#fff';
          star(g, x + size / 2, y + 15, 6);
          g.fill();
        }
      }
    }
  } else {
    // 街機廳地毯：深藍底配上洋紅／青／黃的幾何花紋
    const tile = 96;
    const x0 = -(cam % tile) - tile;
    const idx0 = Math.floor(cam / tile) - 1;
    const colors = ['#ff2bd6', '#35f0ff', '#ffd23a'];
    for (let c = 0, x = x0; x < viewW + tile; c += 1, x += tile) {
      for (let r = 0; r < 3; r += 1) {
        const y = top + 22 + r * 34;
        g.fillStyle = colors[(idx0 + c + r) % 3];
        g.globalAlpha = alpha * 0.55;
        if ((idx0 + c + r) % 2) {
          g.beginPath();
          g.moveTo(x + 10, y + 20);
          g.lineTo(x + 26, y);
          g.lineTo(x + 42, y + 20);
          g.closePath();
          g.fill();
        } else {
          g.fillRect(x + 54, y + 4, 22, 12);
          g.fillRect(x + 58, y, 14, 4);
        }
      }
    }
    g.globalAlpha = alpha;
  }
  // 邊緣線
  const edge = g.createLinearGradient(0, 0, viewW, 0);
  edge.addColorStop(0, th.edge[0]);
  edge.addColorStop(0.5, th.edge[1]);
  edge.addColorStop(1, th.edge[0]);
  g.fillStyle = edge;
  g.globalAlpha = alpha * (0.65 + pulse * 0.35);
  g.fillRect(0, top, viewW, 4);
  g.globalAlpha = alpha;
  if (id === 'arcade') {
    // 賽車旗格紋路緣
    const sq = 14;
    for (let x = -(cam % (sq * 2)); x < viewW; x += sq) {
      g.fillStyle = Math.floor((x + cam) / sq) % 2 ? '#fff' : INK;
      g.fillRect(x, top + 4, sq, sq / 2);
    }
  } else {
    g.fillStyle = INK;
    g.fillRect(0, top + 4, viewW, 5);
  }
  g.restore();
}

// ---------------------------------------------------------------- 天氣

export function drawWeather(S, id, alpha) {
  const { g, viewW, t, parts } = S;
  if (!parts.length || alpha <= 0.02) return;
  g.save();
  g.globalAlpha = alpha;
  if (id === 'casino') {
    g.strokeStyle = 'rgba(160,220,255,0.28)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (const d of parts) {
      const y = ((d.y * WORLD_H) + t * 780 * d.s) % WORLD_H;
      const x = ((d.x * viewW) - y * 0.22 + viewW) % viewW;
      g.moveTo(x, y);
      g.lineTo(x - 5, y + 26 * d.s);
    }
    g.stroke();
  } else if (id === 'phoebe') {
    // 緩緩飄落的小星星與花瓣
    for (const d of parts) {
      const y = ((d.y * WORLD_H) + t * 60 * d.s) % WORLD_H;
      const x = ((d.x * viewW) + Math.sin(t * 0.9 + d.y * 9) * 26 + viewW) % viewW;
      g.fillStyle = d.x > 0.5 ? '#ffffff' : '#ffb3e0';
      g.save();
      g.translate(x, y);
      g.rotate(t * d.s + d.y * 6);
      star(g, 0, 0, 5 + d.s * 4);
      g.fill();
      g.restore();
    }
  } else {
    // 往上飄的像素方塊（像街機畫面的粒子）
    const colors = ['#ff2bd6', '#35f0ff', '#ffd23a', '#9dff3a'];
    for (let i = 0; i < parts.length; i += 1) {
      const d = parts[i];
      const y = WORLD_H - (((d.y * WORLD_H) + t * 50 * d.s) % WORLD_H);
      const x = (d.x * viewW + viewW) % viewW;
      g.fillStyle = colors[i % 4];
      g.globalAlpha = alpha * 0.55;
      const s = 4 + Math.round(d.s * 3) * 2;
      g.fillRect(Math.round(x / 4) * 4, Math.round(y / 4) * 4, s, s);
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- 路燈

export function drawLamps(S, id) {
  const { g, cam, viewW, pulse } = S;
  const th = THEMES[id];
  const spacing = 235;
  const start = Math.floor(cam / spacing) - 1;
  for (let i = start; i < start + viewW / spacing + 3; i += 1) {
    const x = i * spacing + 117 - cam;
    if (th.lamp === 'pole') {
      const hue = i % 2 ? '#35f0ff' : '#ff2bd6';
      g.fillStyle = INK;
      g.fillRect(x - 3, GROUND_Y - 190, 6, 196);
      g.fillRect(x - 3, GROUND_Y - 190, 30, 5);
      g.save();
      g.fillStyle = hue;
      g.shadowColor = hue;
      g.shadowBlur = 20 + pulse * 10;
      g.fillRect(x + 20, GROUND_Y - 187, 16, 6);
      g.restore();
      g.save();
      g.globalCompositeOperation = 'lighter';
      const cone = g.createLinearGradient(0, GROUND_Y - 180, 0, GROUND_Y + 40);
      cone.addColorStop(0, rgba(hue, 0.18));
      cone.addColorStop(1, rgba(hue, 0));
      g.fillStyle = cone;
      g.beginPath();
      g.moveTo(x + 22, GROUND_Y - 180);
      g.lineTo(x + 34, GROUND_Y - 180);
      g.lineTo(x + 80, GROUND_Y + 40);
      g.lineTo(x - 24, GROUND_Y + 40);
      g.closePath();
      g.fill();
      g.restore();
    } else if (th.lamp === 'star') {
      g.fillStyle = '#fff7fd';
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.fillRect(x - 4, GROUND_Y - 170, 8, 176);
      g.strokeRect(x - 4, GROUND_Y - 170, 8, 176);
      g.save();
      g.fillStyle = '#ffe36a';
      g.shadowColor = '#ffd23a';
      g.shadowBlur = 18 + pulse * 12;
      star(g, x, GROUND_Y - 188, 22 + pulse * 3, 5, 0.5);
      g.fill();
      g.lineWidth = 4;
      g.stroke();
      g.restore();
    } else {
      g.fillStyle = INK;
      g.fillRect(x - 3, GROUND_Y - 150, 6, 156);
      g.save();
      const hue = ['#ff3b3b', '#ffd23a', '#35f0ff'][((i % 3) + 3) % 3];
      g.fillStyle = hue;
      g.shadowColor = hue;
      g.shadowBlur = 20;
      g.beginPath();
      g.arc(x, GROUND_Y - 162, 15, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
    }
  }
}

// ---------------------------------------------------------------- 房子

function facadePath(g, id, x, y, w, h) {
  const bottom = y + h;
  g.beginPath();
  if (id === 'casino') {
    const c = 26;
    g.moveTo(x, bottom);
    g.lineTo(x, y + c);
    g.lineTo(x + c, y);
    g.lineTo(x + w - c, y);
    g.lineTo(x + w, y + c);
    g.lineTo(x + w, bottom);
  } else if (id === 'phoebe') {
    const r = 80;
    g.moveTo(x, bottom);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, bottom);
  } else {
    g.moveTo(x, bottom);
    g.lineTo(x, y + 40);
    g.lineTo(x + 38, y + 40);
    g.lineTo(x + 38, y + 20);
    g.lineTo(x + 84, y + 20);
    g.lineTo(x + 84, y);
    g.lineTo(x + w - 84, y);
    g.lineTo(x + w - 84, y + 20);
    g.lineTo(x + w - 38, y + 20);
    g.lineTo(x + w - 38, y + 40);
    g.lineTo(x + w, y + 40);
    g.lineTo(x + w, bottom);
  }
  g.closePath();
}

function drawCover(g, a, x, y, w, h) {
  const scale = Math.max(w / a.sw, h / a.sh);
  const sw = w / scale;
  const sh = h / scale;
  g.drawImage(a.img, a.sx + (a.sw - sw) / 2, a.sy + (a.sh - sh) / 2, sw, sh, x, y, w, h);
}

/** 房子的鏡像倒影：只畫外牆貼圖，淡淡的。 */
export function drawFacadeReflection(S, b) {
  const { g, cam } = S;
  const id = b.look.district;
  const h = b.h;
  const x = b.doorX - cam - FACADE_W / 2;
  g.save();
  g.translate(0, GROUND_Y * 2);
  g.scale(1, -1);
  g.globalAlpha = id === 'phoebe' ? 0.28 : 0.2;
  facadePath(g, id, x, GROUND_Y - h, FACADE_W, h);
  g.clip();
  if (b.art) drawCover(g, b.art, x, GROUND_Y - h, FACADE_W, h);
  else {
    g.fillStyle = b.look.accent;
    g.fillRect(x, GROUND_Y - h, FACADE_W, h);
  }
  g.restore();
}

function drawDecor(S, b, id, x, y, w, h, pulse) {
  const { g, t } = S;
  const accent = b.look.accent;
  if (id === 'casino') {
    // 跑馬燈：沿著屋簷一圈燈泡，輪流亮
    const step = Math.floor(t * 5);
    for (let px = x + 42, i = 0; px < x + w - 30; px += 27, i += 1) {
      const on = (i + step) % 3 === 0;
      g.beginPath();
      g.arc(px, y + 11, 5, 0, Math.PI * 2);
      g.fillStyle = on ? '#fff3b0' : '#6a4a1a';
      if (on) {
        g.shadowColor = '#ffd23a';
        g.shadowBlur = 14;
      }
      g.fill();
      g.shadowBlur = 0;
    }
    // 兩側直立 LED 燈條：色塊往上捲動
    for (const sx of [x + 6, x + w - 20]) {
      g.save();
      g.beginPath();
      g.rect(sx, y + 40, 14, h - 44);
      g.clip();
      g.fillStyle = '#05020c';
      g.fillRect(sx, y + 40, 14, h - 44);
      const seg = 18;
      const off = (S.t * 48) % (seg * 2);
      for (let ly = y + h - off; ly > y + 30; ly -= seg * 2) {
        g.fillStyle = accent;
        g.shadowColor = accent;
        g.shadowBlur = 10;
        g.fillRect(sx + 2, ly - seg, 10, seg - 3);
      }
      g.restore();
      g.lineWidth = 3;
      g.strokeStyle = INK;
      g.strokeRect(sx, y + 40, 14, h - 44);
    }
  } else if (id === 'phoebe') {
    // 屋頂一排閃爍的小星星＋兩側的蝴蝶結緞帶
    for (let i = 0; i < 7; i += 1) {
      const px = x + 70 + i * ((w - 140) / 6);
      const py = y + 30 - Math.sin((i / 6) * Math.PI) * 6 + (i % 2 ? 8 : 0);
      g.save();
      g.fillStyle = i % 2 ? '#fff' : '#ffe36a';
      g.shadowColor = '#fff';
      g.shadowBlur = 10 + Math.abs(Math.sin(t * 2 + i)) * 10;
      star(g, px, py, 9 + Math.abs(Math.sin(t * 2 + i)) * 4);
      g.fill();
      g.restore();
    }
    g.fillStyle = '#ff8fd0';
    g.strokeStyle = INK;
    g.lineWidth = 3;
    for (const sx of [x + 6, x + w - 6]) {
      g.beginPath();
      g.moveTo(sx, y + 120);
      g.lineTo(sx + (sx < x + w / 2 ? 26 : -26), y + 104);
      g.lineTo(sx + (sx < x + w / 2 ? 26 : -26), y + 136);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }
}

function drawEntrance(S, b, id, dx, isNear) {
  const { g, t } = S;
  const th = THEMES[id];
  const accent = b.look.accent;
  const { w: dw, h: dh } = doorDims(b);
  const left = dx - dw / 2;
  const top = GROUND_Y - dh;
  // 地毯：從門口一路鋪到人行道前緣
  g.save();
  g.fillStyle = th.carpet;
  g.beginPath();
  g.moveTo(left + 6, GROUND_Y);
  g.lineTo(left + dw - 6, GROUND_Y);
  g.lineTo(left + dw + 30, WORLD_H - 4);
  g.lineTo(left - 30, WORLD_H - 4);
  g.closePath();
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = id === 'casino' ? '#ffd23a' : '#fff';
  g.stroke();
  g.restore();
  // 門框與玻璃
  g.save();
  const arch = id === 'phoebe';
  if (arch) {
    g.beginPath();
    g.moveTo(left, GROUND_Y);
    g.lineTo(left, top + dw / 2);
    g.arc(dx, top + dw / 2, dw / 2, Math.PI, 0);
    g.lineTo(left + dw, GROUND_Y);
    g.closePath();
  } else {
    roundRect(g, left, top, dw, dh, id === 'casino' ? 6 : 0);
  }
  const glass = g.createLinearGradient(0, top, 0, GROUND_Y);
  if (id === 'phoebe') {
    glass.addColorStop(0, '#fff0fb');
    glass.addColorStop(1, rgba(accent, isNear ? 1 : 0.8));
  } else if (id === 'arcade') {
    glass.addColorStop(0, '#0a0f2e');
    glass.addColorStop(1, rgba(accent, isNear ? 0.95 : 0.6));
  } else {
    glass.addColorStop(0, '#07030f');
    glass.addColorStop(1, rgba(accent, isNear ? 0.95 : 0.55));
  }
  g.fillStyle = glass;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = id === 'phoebe' ? '#ff6fc8' : accent;
  g.shadowColor = accent;
  g.shadowBlur = isNear ? 24 : 10;
  g.stroke();
  g.shadowBlur = 0;
  // 對開門縫與把手
  g.strokeStyle = INK;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(dx, arch ? top + 8 : top + 4);
  g.lineTo(dx, GROUND_Y);
  g.stroke();
  g.fillStyle = id === 'casino' ? '#ffd23a' : '#fff';
  g.fillRect(dx - 12, GROUND_Y - dh * 0.45, 5, 30);
  g.fillRect(dx + 7, GROUND_Y - dh * 0.45, 5, 30);
  g.restore();
  // 雨棚
  const awnY = top - 6;
  const awnW = dw + 52;
  g.save();
  if (id === 'phoebe') {
    // 粉白條紋＋扇貝邊
    const n = 7;
    const sw = awnW / n;
    for (let i = 0; i < n; i += 1) {
      g.fillStyle = i % 2 ? '#fff' : '#ff9fd8';
      g.fillRect(dx - awnW / 2 + i * sw, awnY - 24, sw, 24);
      g.beginPath();
      g.arc(dx - awnW / 2 + i * sw + sw / 2, awnY, sw / 2, 0, Math.PI);
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = INK;
      g.stroke();
    }
    g.strokeRect(dx - awnW / 2, awnY - 24, awnW, 24);
  } else if (id === 'arcade') {
    const n = 8;
    const sw = awnW / n;
    for (let i = 0; i < n; i += 1) {
      g.fillStyle = i % 2 ? '#fff' : '#ff3b3b';
      g.fillRect(dx - awnW / 2 + i * sw, awnY - 22, sw, 26);
    }
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.strokeRect(dx - awnW / 2, awnY - 22, awnW, 26);
  } else {
    // 暗色玻璃雨棚，下緣有一條霓虹
    g.fillStyle = '#0b0718';
    g.beginPath();
    g.moveTo(dx - awnW / 2, awnY + 4);
    g.lineTo(dx - awnW / 2 + 14, awnY - 22);
    g.lineTo(dx + awnW / 2 - 14, awnY - 22);
    g.lineTo(dx + awnW / 2, awnY + 4);
    g.closePath();
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke();
    g.fillStyle = accent;
    g.shadowColor = accent;
    g.shadowBlur = 14;
    g.fillRect(dx - awnW / 2, awnY + 1, awnW, 4);
  }
  g.restore();
  // 地毯兩側的立柱與繩子（賭場）
  if (id === 'casino') {
    for (const side of [-1, 1]) {
      const px = dx + side * (dw / 2 + 26);
      g.fillStyle = '#ffd23a';
      g.fillRect(px - 3, GROUND_Y + 8, 6, 34);
      g.beginPath();
      g.arc(px, GROUND_Y + 8, 7, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = INK;
      g.stroke();
    }
  }
  // 門前的光
  g.save();
  g.globalCompositeOperation = 'lighter';
  const beam = g.createLinearGradient(0, GROUND_Y, 0, WORLD_H);
  beam.addColorStop(0, rgba(accent, isNear ? 0.5 : 0.2));
  beam.addColorStop(1, rgba(accent, 0));
  g.fillStyle = beam;
  g.beginPath();
  g.moveTo(left, GROUND_Y);
  g.lineTo(left + dw, GROUND_Y);
  g.lineTo(left + dw * 1.3, WORLD_H);
  g.lineTo(left - dw * 0.3, WORLD_H);
  g.closePath();
  g.fill();
  g.restore();
  if (isNear) drawArrow(g, dx, top - 88, accent, t);
}

function drawArrow(g, x, y, color, t) {
  const bob = Math.sin(t * 7) * 6;
  g.save();
  g.translate(x, y + bob);
  g.beginPath();
  g.moveTo(0, -22);
  g.lineTo(22, 6);
  g.lineTo(8, 6);
  g.lineTo(8, 20);
  g.lineTo(-8, 20);
  g.lineTo(-8, 6);
  g.lineTo(-22, 6);
  g.closePath();
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.fill();
  g.restore();
}

function drawSign(S, b, id, dx, isNear, pulse, y) {
  const { g } = S;
  const text = b.look.sign;
  g.font = SIGN_FONT;
  if (!b.signW) b.signW = Math.max(190, Math.ceil(g.measureText(text).width) + 70);
  const w = b.signW;
  const h = 64;
  const x = dx - w / 2;
  const accent = b.look.accent;
  g.save();
  if (id === 'phoebe') {
    roundRect(g, x, y, w, h, 32);
    g.fillStyle = '#fff0fb';
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 4;
    g.strokeStyle = '#ff6fc8';
    g.shadowColor = '#ff6fc8';
    g.shadowBlur = isNear ? 24 : 10;
    roundRect(g, x + 4, y + 4, w - 8, h - 8, 28);
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#ffd23a';
    star(g, x + 22, y + h / 2, 9);
    g.fill();
    star(g, x + w - 22, y + h / 2, 9);
    g.fill();
  } else if (id === 'arcade') {
    g.fillStyle = '#12123a';
    g.fillRect(x, y, w, h);
    g.lineWidth = 7;
    g.strokeStyle = INK;
    g.strokeRect(x, y, w, h);
    g.lineWidth = 4;
    g.strokeStyle = '#ffd23a';
    g.strokeRect(x + 5, y + 5, w - 10, h - 10);
    g.fillStyle = '#ff3b3b';
    for (const [cx, cy] of [[x + 12, y + 12], [x + w - 12, y + 12], [x + 12, y + h - 12], [x + w - 12, y + h - 12]]) {
      g.fillRect(cx - 3, cy - 3, 6, 6);
    }
  } else {
    roundRect(g, x, y, w, h, 10);
    g.fillStyle = '#0b0718';
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = INK;
    g.stroke();
    g.lineWidth = 3;
    g.strokeStyle = accent;
    g.shadowColor = accent;
    g.shadowBlur = (isNear ? 26 : 14) + pulse * 8;
    roundRect(g, x + 4, y + 4, w - 8, h - 8, 7);
    g.stroke();
    g.shadowBlur = 0;
  }
  g.font = SIGN_FONT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const ty = y + h / 2 + 1;
  if (id === 'phoebe') {
    g.lineWidth = 6;
    g.strokeStyle = '#fff';
    g.strokeText(text, dx, ty);
    g.fillStyle = '#8a2d9e';
    g.fillText(text, dx, ty);
  } else if (id === 'arcade') {
    g.fillStyle = '#ff3b3b';
    g.fillText(text, dx + 3, ty + 3);
    g.fillStyle = '#ffd23a';
    g.fillText(text, dx, ty);
  } else {
    g.lineWidth = 6;
    g.strokeStyle = INK;
    g.strokeText(text, dx, ty);
    g.fillStyle = isNear ? '#ffffff' : '#f4eaff';
    g.fillText(text, dx, ty);
  }
  g.restore();
}



/** 賭場屋頂上各家專屬的霓虹造型：遠看輪廓就不一樣。 */
function drawRoofOrnament(S, b, x, y, w, isNear) {
  const { g, t } = S;
  const kind = b.look.art;
  const cx = x + w / 2;
  const r = 40 + (isNear ? 6 : 0);
  const accent = b.look.accent;
  // 立柱把圖示撐在屋頂上
  g.save();
  g.fillStyle = INK;
  g.fillRect(cx - 5, y - 18, 10, 24);
  g.restore();
  if (kind === 'slots') {
    for (let i = -1; i <= 1; i += 1) {
      g.save();
      const on = Math.floor(t * 4) % 3 === i + 1;
      g.fillStyle = on ? '#fff3b0' : accent;
      g.shadowColor = accent;
      g.shadowBlur = on ? 24 : 8;
      g.beginPath();
      g.arc(cx + i * 46, y - 34, 15, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = INK;
      g.stroke();
      g.restore();
    }
    return;
  }
  drawGlyph(g, kind, cx, y - 44, r, accent, t);
}

/** 街機造型的外牆：頂部跑馬燈招牌、CRT 螢幕（裡面放壁畫）、控制台（搖桿＋按鈕＋投幣孔）。 */
function drawArcadeFace(S, b, x, y, w, h, isNear, pulse) {
  const { g, t } = S;
  const accent = b.look.accent;
  const dx = x + w / 2;
  const awningTop = GROUND_Y - doorDims(b).h - 30;
  g.fillStyle = '#16163f';
  g.fillRect(x, y, w, h);
  // 兩側的機身貼紙：斜條紋
  const stripe = ['#ff3b3b', '#ffd23a', '#2a63ff'];
  for (const sx of [x + 4, x + w - 30]) {
    for (let i = 0; i < 3; i += 1) {
      g.fillStyle = stripe[i];
      g.beginPath();
      g.moveTo(sx + i * 8, y + h);
      g.lineTo(sx + i * 8 + 8, y + h);
      g.lineTo(sx + i * 8 + 8, y + 90);
      g.lineTo(sx + i * 8, y + 90);
      g.closePath();
      g.fill();
    }
  }
  // CRT 螢幕
  const deck = 52;
  const sx = x + 40;
  const sy = y + 88;
  const sw = w - 80;
  const sh = Math.max(86, awningTop - 10 - deck - sy);
  roundRect(g, sx - 12, sy - 12, sw + 24, sh + 24, 22);
  g.fillStyle = '#0a0a22';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = accent;
  g.stroke();
  g.save();
  roundRect(g, sx, sy, sw, sh, 14);
  g.clip();
  if (b.art) drawCover(g, b.art, sx, sy, sw, sh);
  else {
    g.fillStyle = rgba(accent, 0.5);
    g.fillRect(sx, sy, sw, sh);
  }
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let ly = sy; ly < sy + sh; ly += 3) g.fillRect(sx, ly, sw, 1);
  const vg = g.createRadialGradient(dx, sy + sh / 2, sh * 0.2, dx, sy + sh / 2, sw * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(sx, sy, sw, sh);
  const glare = g.createLinearGradient(sx, sy, sx + sw * 0.5, sy + sh);
  glare.addColorStop(0, 'rgba(255,255,255,0.22)');
  glare.addColorStop(0.35, 'rgba(255,255,255,0)');
  g.fillStyle = glare;
  g.fillRect(sx, sy, sw, sh);
  if (Math.floor(t * 1.6) % 2 === 0) {
    g.font = '800 17px ui-monospace, "Courier New", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.shadowColor = '#fff';
    g.shadowBlur = 8;
    g.fillText('INSERT COIN', dx, sy + sh - 16);
  }
  g.restore();
  // 控制台
  const dy = sy + sh + 16;
  roundRect(g, x + 22, dy, w - 44, deck - 8, 10);
  g.fillStyle = '#2c2c70';
  g.fill();
  g.lineWidth = 5;
  g.strokeStyle = INK;
  g.stroke();
  // 搖桿
  const jx = x + 62;
  const jy = dy + (deck - 8) / 2;
  g.fillStyle = '#9aa';
  g.fillRect(jx - 3, jy - 4, 6, 20);
  g.beginPath();
  g.arc(jx, jy - 8, 11, 0, Math.PI * 2);
  g.fillStyle = '#ff3b3b';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = INK;
  g.stroke();
  // 三顆按鈕：跟著節拍輪流亮
  const btn = ['#ff3b3b', '#ffd23a', '#2a63ff'];
  const beat = Math.floor(t * 2) % 3;
  for (let i = 0; i < 3; i += 1) {
    const bx = x + w - 150 + i * 40;
    g.beginPath();
    g.arc(bx, jy, 12, 0, Math.PI * 2);
    g.fillStyle = btn[i];
    if (beat === i || isNear) {
      g.shadowColor = btn[i];
      g.shadowBlur = 14;
    }
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 3;
    g.strokeStyle = INK;
    g.stroke();
  }
  // 投幣孔（在門的正上方）
  g.fillStyle = '#ffd23a';
  g.fillRect(dx - 18, dy + 4, 36, 30);
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.strokeRect(dx - 18, dy + 4, 36, 30);
  g.fillStyle = INK;
  g.fillRect(dx - 2, dy + 10, 4, 14);
  void pulse;
}

export function drawFacade(S, b, isNear, pulse) {
  const { g, cam } = S;
  const id = b.look.district;
  const h = b.h;
  const w = FACADE_W;
  const dx = b.doorX - cam;
  const x = dx - w / 2;
  const y = GROUND_Y - h;
  const accent = b.look.accent;
  g.save();
  facadePath(g, id, x, y, w, h);
  g.save();
  g.clip();
  if (id === 'arcade') {
    drawArcadeFace(S, b, x, y, w, h, isNear, pulse);
  } else if (b.art) {
    drawCover(g, b.art, x, y, w, h);
  } else {
    const fill = g.createLinearGradient(0, y, 0, GROUND_Y);
    fill.addColorStop(0, rgba(accent, 0.55));
    fill.addColorStop(1, '#120a2a');
    g.fillStyle = fill;
    g.fillRect(x, y, w, h);
  }
  if (id === 'casino') {
    // 壁畫本身已是洋紅／青的賽博霓虹（Colab 產圖）；程式只加掃描線與偶爾的故障色偏
    // 全息掃描線與偶爾的故障色偏
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let ly = y; ly < GROUND_Y; ly += 5) g.fillRect(x, ly, w, 1);
    const glitch = Math.floor(S.t * 6) % 23 === 0;
    if (glitch) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = rgba('#35f0ff', 0.2);
      g.fillRect(x, y + ((S.t * 90) % h), w, 8);
      g.globalCompositeOperation = 'source-over';
    }
  }
  // 下半部壓暗，門和招牌才讀得出來
  const shade = g.createLinearGradient(0, y + h * (id === 'arcade' ? 0.9 : 0.35), 0, GROUND_Y);
  shade.addColorStop(0, 'rgba(8,3,20,0)');
  shade.addColorStop(1, id === 'phoebe' ? 'rgba(90,40,120,0.45)' : 'rgba(8,3,20,0.7)');
  g.fillStyle = shade;
  g.fillRect(x, y, w, h);
  if (isNear) {
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = rgba(accent, 0.16 + pulse * 0.08);
    g.fillRect(x, y, w, h);
  }
  g.restore();
  facadePath(g, id, x, y, w, h);
  g.lineWidth = 8;
  g.lineJoin = 'round';
  g.strokeStyle = INK;
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = id === 'phoebe' ? '#fff' : accent;
  g.shadowColor = accent;
  g.shadowBlur = (isNear ? 26 : 10) + pulse * 6;
  g.stroke();
  g.restore();
  drawDecor(S, b, id, x, y, w, h, pulse);
  if (id === 'casino') drawRoofOrnament(S, b, x, y, w, isNear);
  drawEntrance(S, b, id, dx, isNear);
  if (id === 'casino' && b.look.art) {
    // 每家賭場的門玻璃上都有自己的霓虹標誌
    const dd = doorDims(b);
    drawGlyph(g, b.look.art, dx, GROUND_Y - dd.h * 0.62, dd.w * 0.26, accent, S.t);
  }
  // 招牌放在「門上雨棚」和「房子頂端」的正中間，高矮不同的房子都不會壓到門或頂邊。
  const awningTop = GROUND_Y - doorDims(b).h - 30;
  const signH = 64;
  const signY = Math.max(y + 26, Math.round((y + 26 + awningTop - signH) / 2 + (awningTop - y) * 0.12));
  drawSign(S, b, id, dx, isNear, pulse, id === 'arcade' ? y + 8 : Math.min(signY, awningTop - signH - 6));
}

/** 城門：街區之間的拱門。 */
export function drawGate(S, gate, pulse) {
  const { g, cam, viewW } = S;
  const x = gate.x - cam;
  if (x < -300 || x > viewW + 300) return;
  const id = gate.district.id;
  const color = gate.district.color;
  const top = GROUND_Y - 380;
  g.save();
  if (id === 'phoebe') {
    // 粉彩拱門＋星星
    g.lineWidth = 12;
    g.strokeStyle = INK;
    g.beginPath();
    g.moveTo(x - 150, GROUND_Y);
    g.lineTo(x - 150, top + 100);
    g.arc(x, top + 100, 150, Math.PI, 0);
    g.lineTo(x + 150, GROUND_Y);
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = '#fff';
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#ffe36a';
    star(g, x, top - 36, 26 + pulse * 4, 5, 0.5);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = INK;
    g.stroke();
  } else if (id === 'arcade') {
    g.fillStyle = INK;
    g.fillRect(x - 158, top + 30, 16, 350);
    g.fillRect(x + 142, top + 30, 16, 350);
    g.fillRect(x - 158, top + 30, 316, 22);
    const colors = ['#ff3b3b', '#ffd23a', '#2a63ff', '#2cff9a'];
    for (let i = 0; i < 8; i += 1) {
      g.fillStyle = colors[i % 4];
      g.fillRect(x - 150 + i * 37.5, top + 34, 37.5, 14);
    }
  } else {
    g.fillStyle = INK;
    g.fillRect(x - 150, top, 10, 380);
    g.fillRect(x + 140, top, 10, 380);
    g.fillRect(x - 150, top, 300, 14);
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 18 + pulse * 10;
    g.fillRect(x - 146, top + 2, 292, 4);
    g.shadowBlur = 0;
  }
  const label = gate.district.name;
  g.font = '800 36px "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.lineJoin = 'round';
  const ty = id === 'phoebe' ? top + 96 : top + 70;
  if (id === 'phoebe') {
    g.strokeStyle = '#fff';
    g.strokeText(label, x, ty);
    g.fillStyle = '#c0399e';
    g.fillText(label, x, ty);
  } else {
    g.strokeStyle = INK;
    g.strokeText(label, x, ty);
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.fillText(label, x, ty);
  }
  g.restore();
}
