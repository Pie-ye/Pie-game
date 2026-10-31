// 大胃王蛙（世界頭目）的畫面：套用伺服器快照、畫蛙／預警圈／派餅／幫忙的鎮民、肚子條與公告。
// 規則都在伺服器（server/games/boss.py）。
import { drawText } from '../engine/render.js';
import { ATLAS } from '../engine/atlas.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SHEETS = { idle: ['ninja/boss/frog_idle.png', 5], jump: ['ninja/boss/frog_jump.png', 6], charge: ['ninja/boss/frog_charge.png', 7],
  attack: ['ninja/boss/frog_attack.png', 3], hit: ['ninja/boss/frog_hit.png', 3] };
export const BOSS_IMAGES = Object.values(SHEETS).map((s) => s[0]);
const SCALE = 2, FW = 40;

function spr(ctx, scene, k, x, y) {
  const a = ATLAS[k];
  if (!a) return;
  ctx.drawImage(scene.imgs[a[0]], a[1], a[2], a[3], a[4], Math.round(x - a[3] / 2), Math.round(y - a[4]), a[3], a[4]);
}

/** 下一次出現的時間字串（台北時間）。 */
export function hhmmTaipei(ms) {
  const d = new Date(ms + 8 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function createBoss({ myId, audio, hud, sys, onCall }) {
  let snap = null, offset = 0, recvAt = 0, visible = false, lastHud = 0, hitFlash = 0, shake = 0, from = null, ammo = 3;
  let pies = [], callUntil = 0;
  const helpers = new Map();
  const fx = [];
  const frame = document.querySelector('.frame');
  const barEl = el('div', 'arena-hud boss-hud'); barEl.hidden = true;
  const bar = el('div', 'arena-bar'); barEl.append(bar);
  const callEl = el('button', 'arena-call boss-call'); callEl.type = 'button'; callEl.hidden = true;
  callEl.addEventListener('click', () => { callEl.hidden = true; callUntil = 0; if (onCall) onCall(); });
  frame.append(barEl, callEl);

  const serverNow = () => Date.now() + offset;
  const on = () => !!snap && snap.on;
  const stunned = () => on() && (snap.S || []).includes(myId());

  function onEvent(e) {
    const now = performance.now(), id = myId();
    if (e.k === 'eat') {
      hitFlash = now + 160;
      fx.push({ k: 'text', x: e.x, y: e.y - 6, t0: now, text: e.v > 1 ? `好吃！+${e.v}` : `+${e.v}`, color: e.v > 1 ? '#ffd23f' : '#fff3d6' });
      if (String(e.by) === id) audio.tool(e.v > 1 ? 'bigcoin' : 'coin');
    } else if (e.k === 'splat') fx.push({ k: 'decal', x: e.x, y: e.y + 8, t0: now });
    else if (e.k === 'mouth') audio.tool('talk');
    else if (e.k === 'jumpWarn') { from = snap ? { x: snap.x, y: snap.y } : null; audio.tool('whistle'); }
    else if (e.k === 'croakWarn') audio.tool('crack');
    else if (e.k === 'squash' || e.k === 'croak') {
      audio.tool(e.k === 'croak' ? 'fall' : 'splat');
      fx.push({ k: 'ring', x: e.x, y: e.y, r: e.r, t0: now });
      if ((e.ids || []).map(String).includes(id)) { shake = now + 350; hud.toast(e.k === 'croak' ? '呱！被震暈了' : '被壓扁了！', 1500); }
    } else if (e.k === 'full') { audio.tool('fanfare'); sys('🐸 大胃王蛙吃飽睡著了！丟中的人都有獎勵。'); }
    else if (e.k === 'escape') sys('🐸 大胃王蛙抱著剩下的派逃走了……下次再來！');
    else if (e.k === 'arrive') sys('🐸 大胃王蛙闖進廣場偷吃派！把派丟進牠嘴裡（空白鍵或點畫面）。');
  }

  function apply(s, pushed) {
    if (!s) return;
    const o = s.now - Date.now();
    offset = !snap || Math.abs(o - offset) > 1500 ? o : offset + (o - offset) * 0.2;
    if (pushed && s.ev) for (const e of s.ev) onEvent(e);
    snap = s; recvAt = performance.now();
    pies = (s.K || []).map((k) => ({ x: k[1], y: k[2], vx: k[3], vy: k[4], at: recvAt }));
    const seen = new Set();
    for (const [id, name, x, y, dir, sprite] of s.H || []) {
      seen.add(id);
      const h = helpers.get(id) || { id, name, x, y, sprite, npc: true, near: true, movedAt: 0 };
      if (Math.hypot(x - (h.tx ?? x), y - (h.ty ?? y)) > 0.3) h.movedAt = performance.now();
      Object.assign(h, { tx: x, ty: y, dir, sprite, name });
      helpers.set(id, h);
    }
    for (const id of [...helpers.keys()]) if (!seen.has(id)) helpers.delete(id);
    paint(true);
  }

  function paint(force) {
    const now = performance.now();
    if (!force && now - lastHud < 200) return;
    lastHud = now;
    const show = visible && on();
    barEl.hidden = !show;
    const call = !visible && callUntil > Date.now();
    callEl.hidden = !call;
    if (call) callEl.textContent = '🐸 大胃王蛙在廣場偷吃派！點這裡過去幫忙餵牠';
    if (!show) return;
    const left = Math.max(0, Math.ceil((snap.until - serverNow()) / 1000));
    const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const ph = snap.ph === 'mouth' ? '　張嘴了！丟進去 ×3' : snap.ph === 'sleep' ? '　吃飽睡著了 💤' : snap.ph === 'leave' ? '　逃走了' : '';
    bar.textContent = `🐸 大胃王蛙　肚子 ${Math.min(snap.fed, snap.need)}/${snap.need}　剩 ${mm}　🥧×${ammo}${ph}`;
  }

  // ---------- 繪圖 ----------
  function frogPos(now) {
    if (!snap) return { x: 0, y: 0, lift: 0 };
    if (snap.ph === 'jump' && from && snap.tx != null) {
      const t = Math.min(1, Math.max(0, 1 - (snap.end - serverNow()) / 500));
      return { x: from.x + (snap.tx - from.x) * t, y: from.y + (snap.ty - from.y) * t, lift: Math.sin(t * Math.PI) * 40 };
    }
    if (snap.ph === 'leave') { const t = Math.min(1, (now - recvAt) / 2500); return { x: snap.x, y: snap.y, lift: t * 80, fade: 1 - t }; }
    return { x: snap.x, y: snap.y, lift: 0 };
  }

  function drawUnder(ctx, now, scene) {
    if (!on()) return;
    for (const f of fx) {
      if (f.k !== 'decal') continue;
      ctx.globalAlpha = Math.max(0, 1 - (now - f.t0) / 3000); spr(ctx, scene, 'arenaSplat', f.x, f.y);
    }
    ctx.globalAlpha = 1;
    const pulse = 0.35 + Math.abs(Math.sin(now / 120)) * 0.3;
    if (snap.ph === 'jumpWarn' || snap.ph === 'jump') {
      ctx.fillStyle = `rgba(220,50,40,${pulse})`; ctx.beginPath(); ctx.ellipse(snap.tx, snap.ty, 34, 17, 0, 0, 7); ctx.fill();
    }
    if (snap.ph === 'croakWarn') {
      ctx.strokeStyle = `rgba(220,50,40,${pulse + 0.2})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(snap.x, snap.y, 72, 36, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(220,50,40,.12)'; ctx.fill();
    }
    const p = frogPos(now);
    ctx.fillStyle = 'rgba(30,40,20,.3)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 26 - p.lift / 6, 9, 0, 0, 7); ctx.fill();
  }

  function drawOver(ctx, now, scene) {
    if (!on() && !(snap && snap.ph === 'leave')) return;
    const p = frogPos(now);
    let sheet = 'idle', f = Math.floor(now / 160) % 5;
    if (now < hitFlash) { sheet = 'hit'; f = 1; }
    else if (snap.ph === 'mouth') { sheet = 'attack'; f = 1 + (Math.floor(now / 200) % 2); }
    else if (snap.ph === 'jumpWarn' || snap.ph === 'croakWarn') { sheet = 'charge'; f = Math.min(6, Math.floor((now - recvAt) / 200) + 2); }
    else if (snap.ph === 'jump') { sheet = 'jump'; f = 2; }
    else if (snap.ph === 'sleep') { sheet = 'idle'; f = 0; }
    const [src] = SHEETS[sheet];
    const img = scene.imgs[src];
    if (img) {
      ctx.globalAlpha = p.fade ?? 1;
      ctx.drawImage(img, f * FW, 0, FW, FW, Math.round(p.x - FW * SCALE / 2), Math.round(p.y - FW * SCALE + 6 - p.lift), FW * SCALE, FW * SCALE);
      ctx.globalAlpha = 1;
    }
    // 肚子條
    const w = 60, x0 = Math.round(p.x - w / 2), y0 = Math.round(p.y - FW * SCALE - 2 - p.lift);
    ctx.fillStyle = 'rgba(40,24,10,.8)'; ctx.fillRect(x0 - 1, y0 - 1, w + 2, 6);
    ctx.fillStyle = '#e8a33a'; ctx.fillRect(x0, y0, Math.round(w * Math.min(1, snap.fed / Math.max(1, snap.need))), 4);
    for (const q of pies) {
      const age = Math.min(0.4, (now - q.at) / 1000);
      const x = q.x + q.vx * age, y = q.y + q.vy * age;
      ctx.fillStyle = 'rgba(40,30,20,.25)'; ctx.fillRect(Math.round(x) - 3, Math.round(y) + 8, 7, 2);
      spr(ctx, scene, 'arenaPie', x, y + 6);
    }
    const smoke = scene.imgs['ninja/fx/smoke.png'];
    for (const r of fx) {
      if (r.k !== 'ring') continue;
      const t = (now - r.t0) / 500;
      if (t > 1) continue;
      ctx.strokeStyle = `rgba(255,240,200,${1 - t})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r * (0.5 + t * 0.6), r.r * (0.25 + t * 0.3), 0, 0, 7); ctx.stroke();
      if (smoke && t < 0.36) ctx.drawImage(smoke, Math.floor(t * 16) * 32, 0, 32, 32, r.x - 16, r.y - 24, 32, 32);
    }
  }

  function drawTop(ctx, cam, S, now) {
    ctx.setTransform(1, 0, 0, 1, -cam.x * S, -cam.y * S);
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], age = now - f.t0;
      if (age > (f.k === 'decal' ? 3000 : 900)) { fx.splice(i, 1); continue; }
      if (f.k === 'text') drawText(ctx, f.text, f.x, f.y - age / 40, 12, f.color);
    }
    if (snap && snap.ph === 'sleep') {
      const p = frogPos(now);
      drawText(ctx, 'Zzz…', p.x + 24, p.y - 70 - (now / 60) % 10, 14, '#dfe8ff');
    }
  }

  return {
    get snap() { return snap; },
    on, stunned,
    apply,
    setVisible(v) { visible = v; paint(true); },
    setAmmo(n) { if (Number.isFinite(n)) { ammo = n; paint(true); } },
    spend() { ammo = Math.max(0, ammo - 1); setTimeout(() => { ammo = Math.min(3, ammo + 1); }, 1300); paint(true); },
    get ammo() { return ammo; },
    canThrow() { return on() && !['sleep', 'leave'].includes(snap.ph) && !stunned(); },
    call(m) {
      if (m.k === 'warn') { sys(`🐸 ${hhmmTaipei(m.at)} 大胃王蛙要來廣場偷吃派了！準備好派餅。`); hud.toast('🐸 五分鐘後大胃王蛙要來廣場！', 3000); return; }
      callUntil = m.until ? Date.now() + (m.until - m.now) : Date.now() + 60_000;
      if (!visible) { hud.toast('🐸 大胃王蛙闖進廣場了！', 3000); sys('🐸 大胃王蛙闖進廣場偷吃派！快回廣場一起餵牠。'); }
      paint(true);
    },
    people(now, dt) {
      if (!on()) return [];
      const k = 1 - Math.exp(-dt * 12);
      return [...helpers.values()].map((h) => { h.x += (h.tx - h.x) * k; h.y += (h.ty - h.y) * k; h.moving = now - h.movedAt < 260; return h; });
    },
    tick() { paint(false); },
    shaking: () => performance.now() < shake,
    drawUnder, drawOver, drawTop,
  };
}
