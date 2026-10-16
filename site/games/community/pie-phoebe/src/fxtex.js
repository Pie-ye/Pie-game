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

// 白色透明底特效，由實例顏色切換赦罪金色／告解青色。
export function sigil() {
  const [c, ctx] = mk(512, 512);
  ctx.translate(256, 256); ctx.strokeStyle = 'rgba(255,255,255,.75)';
  for (const r of [176, 211, 238]) {
    ctx.lineWidth = r === 211 ? 2 : 4;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  }
  for (let i = 0; i < 8; i++) {
    ctx.save(); ctx.rotate(i * Math.PI / 4);
    ctx.beginPath(); ctx.moveTo(0, -237); ctx.lineTo(20, -207); ctx.lineTo(0, -177); ctx.lineTo(-20, -207); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -142); ctx.lineTo(28, -28); ctx.lineTo(142, 0); ctx.lineTo(28, 28); ctx.stroke();
    ctx.restore();
  }
  return c;
}

export function prism() {
  const [c, ctx] = mk(128, 256);
  ctx.beginPath(); ctx.moveTo(64, 8); ctx.lineTo(111, 69); ctx.lineTo(99, 188); ctx.lineTo(64, 248); ctx.lineTo(29, 188); ctx.lineTo(17, 69); ctx.closePath();
  const g = ctx.createLinearGradient(16, 0, 112, 0);
  g.addColorStop(0, 'rgba(255,255,255,.12)'); g.addColorStop(.5, 'rgba(255,255,255,.65)'); g.addColorStop(1, 'rgba(255,255,255,.15)');
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(64, 8); ctx.lineTo(64, 248); ctx.moveTo(17, 69); ctx.lineTo(99, 188); ctx.moveTo(111, 69); ctx.lineTo(29, 188); ctx.stroke();
  return c;
}

export function pillar() {
  const [c, ctx] = mk(128, 512);
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.42, 'rgba(255,255,255,.12)');
  g.addColorStop(.5, 'rgba(255,255,255,.85)'); g.addColorStop(.58, 'rgba(255,255,255,.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 512);
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, 512);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(.4, '#000'); fade.addColorStop(1, '#000');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, 128, 512);
  return c;
}
