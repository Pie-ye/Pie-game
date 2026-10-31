// 煙火（煙火台蓋好後，每晚 21:00–21:05 在廣場）：依時間決定的粒子，同一時刻大家看到一樣的煙火。
const COLORS = ['#ff6b6b', '#ffd23f', '#6bc5ff', '#b48ef0', '#7ee08a', '#ffffff'];
const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

/** 台北時間 21:00–21:05。 */
export function fireworksTime(ms = Date.now()) {
  const d = new Date(ms + 8 * 3600_000);
  return d.getUTCHours() === 21 && d.getUTCMinutes() < 5;
}

/** 畫在螢幕座標（已乘好倍率的 canvas）。ms 用伺服器或本機時間都可以。 */
export function drawFireworks(ctx, ms) {
  const W = ctx.canvas.width, H = ctx.canvas.height, S = Math.max(1, Math.round(W / 480));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  const every = 650, life = 1600;
  const k0 = Math.floor((ms - life) / every), k1 = Math.floor(ms / every);
  for (let k = k0; k <= k1; k++) {
    const t = (ms - k * every) / life;
    if (t < 0 || t > 1) continue;
    const cx = (0.12 + hash(k) * 0.76) * W, cy = (0.1 + hash(k + 7) * 0.32) * H, col = COLORS[Math.floor(hash(k + 3) * COLORS.length)];
    const n = 22, r = (40 + hash(k + 11) * 50) * S * Math.sqrt(t);
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r + t * t * 30 * S;
      ctx.fillRect(Math.round(x), Math.round(y), 2 * S, 2 * S);
    }
  }
  ctx.restore();
}
