// 純漸層的特效底圖（光暈、環、光束、陰影）。這些不是「圖片美術」，只是加亮混合用的灰階漸層；
// 角色、敵人、道具、星光、鏡環與地板都是 Grok 生成的點陣圖（見 assets/）。
function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

export function glow() {
  const [c, ctx] = mk(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return c;
}

export function ring() {
  const [c, ctx] = mk(256, 256);
  for (const [w, a] of [[16, 0.18], [8, 0.55], [3, 1]]) {
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = w;
    ctx.beginPath(); ctx.arc(128, 128, 118, 0, 7); ctx.stroke();
  }
  return c;
}

export function disc() {
  const [c, ctx] = mk(256, 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 126);
  g.addColorStop(0, 'rgba(255,255,255,0.08)'); g.addColorStop(0.7, 'rgba(255,255,255,0.18)'); g.addColorStop(0.93, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(128, 128, 120, 0, 7); ctx.stroke();
  ctx.globalAlpha = 0.5; ctx.setLineDash([6, 12]); ctx.beginPath(); ctx.arc(128, 128, 96, 0, 7); ctx.stroke();
  return c;
}

export function beam() {
  const [c, ctx] = mk(256, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 64);
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createLinearGradient(0, 0, 256, 0);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.85, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = m; ctx.fillRect(0, 0, 256, 64);
  return c;
}

export function shadow() {
  const [c, ctx] = mk(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return c;
}

export function halo() {
  const [c, ctx] = mk(256, 96);
  ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.ellipse(128, 48, 100, 28, 0, 0, 7); ctx.stroke();
  ctx.lineWidth = 22; ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.ellipse(128, 48, 100, 28, 0, 0, 7); ctx.stroke();
  return c;
}
