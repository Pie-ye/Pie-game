// 每幀繪圖：鏡頭、水面、地面、耕地、物件與角色依 y 排序，最後用高解析度畫名牌與對話泡泡。
import { TILE, VIEW } from '../logic.js';
import { ATLAS } from './atlas.js';
import { buildGround, buildTilled } from './ground.js';
import { farmerSheet, walkFrame } from './sprites.js';

let SCALE = 2;
export function setScale(k) { SCALE = Math.max(1, Math.floor(k)); }
export const getScale = () => SCALE;
const FONT = (px) => `${px * SCALE}px Zpix, "PingFang TC", "Noto Sans TC", monospace`;

function ground(scene, map) {
  let g = scene.grounds.get(map.id);
  if (!g || g.version !== map.version) { g = { ...buildGround(scene, map), version: map.version }; scene.grounds.set(map.id, g); }
  if (map.farm && (map.groundDirty || !g.tilled)) { g.tilled = buildTilled(scene, map); map.groundDirty = false; }
  return g;
}
export function dropGround(scene, id) { scene.grounds.delete(id); }

function sprite(ctx, scene, k, x, y) {
  const a = ATLAS[k];
  if (!a) return;
  ctx.drawImage(scene.imgs[a[0]], a[1], a[2], a[3], a[4], Math.round(x - a[3] / 2), Math.round(y - a[4]), a[3], a[4]);
}

function drawPerson(ctx, scene, p, now) {
  const sheet = p.npc ? scene.imgs[`ninja/npc/${p.sprite}.png`] : farmerSheet(scene, p.id);
  const f = p.acting && now < p.acting ? 4 : walkFrame(p.moving, now);
  ctx.fillStyle = 'rgba(40,30,20,.25)'; ctx.beginPath(); ctx.ellipse(Math.round(p.x), Math.round(p.y) - 1, 6, 2.5, 0, 0, 7); ctx.fill();
  ctx.drawImage(sheet, (p.dir || 0) * 16, f * 16, 16, 16, Math.round(p.x - 8), Math.round(p.y - 15), 16, 16);
}

function textWidth(ctx, text, size) { ctx.font = FONT(size); return ctx.measureText(text).width / SCALE; }
function drawText(ctx, text, x, y, size, color, align = 'center') {
  ctx.font = FONT(size); ctx.textAlign = align; ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x * SCALE), Math.round(y * SCALE));
}
function nameTag(ctx, x, y, text, npc) {
  const w = Math.ceil(textWidth(ctx, text, 12)) + 6, h = 11, bx = Math.round(x - w / 2), by = Math.round(y);
  ctx.fillStyle = npc ? 'rgba(40,70,40,.78)' : 'rgba(60,36,16,.78)'; ctx.fillRect(bx * SCALE, by * SCALE, w * SCALE, h * SCALE);
  drawText(ctx, text, x, by + 9, 12, '#fff3d6');
}
function wrap(ctx, text, max) {
  const lines = []; let cur = '';
  for (const ch of Array.from(text)) { if (textWidth(ctx, cur + ch, 12) > max) { lines.push(cur); cur = ch; } else cur += ch; }
  if (cur) lines.push(cur);
  return lines;
}
function bubble(ctx, scene, x, y, text, viewW) {
  const lines = wrap(ctx, text, 96), w = Math.ceil(Math.max(...lines.map((l) => textWidth(ctx, l, 12)))) + 12, h = lines.length * 13 + 7;
  const bx = Math.round(Math.min(viewW - w - 2, Math.max(2, x - w / 2))), by = Math.round(y - h - 4);
  const img = scene.imgs['ninja/dialog.png'], m = 6, sw = img.width, sh = img.height;
  const S = SCALE, W = w * S, H = h * S, X = bx * S, Y = by * S, M = m * S;
  const cut = (sx, sy, sW, sH, dx, dy, dW, dH) => ctx.drawImage(img, sx, sy, sW, sH, dx, dy, dW, dH);
  cut(0, 0, m, m, X, Y, M, M); cut(sw - m, 0, m, m, X + W - M, Y, M, M);
  cut(0, sh - m, m, m, X, Y + H - M, M, M); cut(sw - m, sh - m, m, m, X + W - M, Y + H - M, M, M);
  cut(m, 0, sw - 2 * m, m, X + M, Y, W - 2 * M, M); cut(m, sh - m, sw - 2 * m, m, X + M, Y + H - M, W - 2 * M, M);
  cut(0, m, m, sh - 2 * m, X, Y + M, M, H - 2 * M); cut(sw - m, m, m, sh - 2 * m, X + W - M, Y + M, M, H - 2 * M);
  cut(m, m, sw - 2 * m, sh - 2 * m, X + M, Y + M, W - 2 * M, H - 2 * M);
  ctx.fillStyle = '#e9e0ee'; ctx.fillRect(Math.round(x - 3) * S, (by + h - 1) * S, 6 * S, 3 * S);
  ctx.fillStyle = '#d56a34'; ctx.fillRect(Math.round(x - 3) * S, (by + h + 2) * S, 6 * S, S);
  lines.forEach((l, i) => drawText(ctx, l, bx + 6, by + 12 + i * 13, 12, '#3a2412', 'left'));
}

/**
 * people：[{ id, name, x, y, dir, moving, bubble, bubbleAt, self, npc, sprite }]
 * opts：{ cursor: {tx,ty,ok}, ghost: {k,x,y,ok}, hint: {x,y,text} }
 */
export function drawWorld(ctx, scene, map, people, cam, now, bubbleMs, opts = {}) {
  const S = SCALE, vw = VIEW.w * TILE, vh = VIEW.h * TILE;
  const g = ground(scene, map);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#1b130d'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(S, 0, 0, S, -cam.x * S, -cam.y * S);
  if (g.water) ctx.drawImage(g.water[Math.floor(now / 380) % 4], 0, 0);
  ctx.drawImage(g.land, 0, 0);
  if (g.tilled) ctx.drawImage(g.tilled, 0, 0);
  const inView = (x, y, w, h) => x + w / 2 > cam.x - 8 && x - w / 2 < cam.x + vw + 8 && y > cam.y - 8 && y - h < cam.y + vh + 8;
  const flat = [], items = [];
  const all = map.farmObjects ? map.objects.concat(map.farmObjects) : map.objects;
  for (const o of all) {
    if (!inView(o.x, o.y, o.w, o.h)) continue;
    if (o.wall || /^(rug|strawMat)/.test(o.k)) flat.push(o); else items.push({ y: o.y, o });
  }
  for (const o of flat) sprite(ctx, scene, o.k, o.x, o.y);
  if (opts.cursor) {
    const { tx, ty, ok } = opts.cursor;
    ctx.strokeStyle = ok ? 'rgba(255,255,255,.85)' : 'rgba(255,90,60,.85)'; ctx.lineWidth = 1;
    ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
  }
  for (const p of people) if (inView(p.x, p.y, 16, 16)) items.push({ y: p.y, p });
  items.sort((a, b) => a.y - b.y);
  for (const it of items) { if (it.o) sprite(ctx, scene, it.o.k, it.o.x, it.o.y); else drawPerson(ctx, scene, it.p, now); }
  if (opts.ghost) {
    ctx.globalAlpha = 0.6; sprite(ctx, scene, opts.ghost.k, opts.ghost.x, opts.ghost.y); ctx.globalAlpha = 1;
    if (!opts.ghost.ok) { ctx.fillStyle = 'rgba(255,60,40,.35)'; const a = ATLAS[opts.ghost.k]; ctx.fillRect(opts.ghost.x - a[3] / 2, opts.ghost.y - a[4], a[3], a[4]); }
  }
  // 文字層：原生座標扣掉鏡頭再乘 SCALE
  ctx.setTransform(1, 0, 0, 1, -cam.x * S, -cam.y * S);
  for (const p of people) if (inView(p.x, p.y, 16, 16) && !p.self && (!p.npc || p.near)) nameTag(ctx, p.x, p.y + 2, p.name, p.npc);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const p of people) if (p.bubble && now - p.bubbleAt < bubbleMs) bubble(ctx, scene, p.x - cam.x, p.y - cam.y - 19, p.bubble, vw);
  if (opts.hint) {
    const { x, y, text } = opts.hint, sx = x - cam.x, sy = y - cam.y;
    const w = Math.ceil(textWidth(ctx, text, 12)) + 10;
    ctx.fillStyle = 'rgba(40,24,10,.85)'; ctx.fillRect(Math.round(sx - w / 2) * S, Math.round(sy - 14) * S, w * S, 13 * S);
    drawText(ctx, text, sx, sy - 4, 12, '#ffe7a8');
  }
}
