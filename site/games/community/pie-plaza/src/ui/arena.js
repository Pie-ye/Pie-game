// 派派大作戰的畫面：套用伺服器快照、內插其他參賽者、畫地板／金幣／派餅／特效，以及計分介面與開賽公告。
// 規則都在伺服器；這裡只負責「看起來對」與把操作送出去。
import { ARENA, ROUNDS, QUAD, quadrant, quadrantCenter, unpackPlayer, standings, secondsLeft, cellOf, inField, fieldRect } from '../game/arena.js';
import { drawText } from '../engine/render.js';
import { ATLAS } from '../engine/atlas.js';

/** 圖集裡的一格，底部中心對齊 (x, y)。 */
function spr(ctx, scene, k, x, y) {
  const a = ATLAS[k];
  if (!a) return;
  ctx.drawImage(scene.imgs[a[0]], a[1], a[2], a[3], a[4], Math.round(x - a[3] / 2), Math.round(y - a[4]), a[3], a[4]);
}

const RUNNING = new Set(['intro', 'live', 'result', 'final']);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function createArena({ myId, audio, hud, sys, onCall }) {
  let snap = null, offset = 0, recvAt = 0, enabled = false, visible = false, lastHud = 0, lastCount = -1, shake = 0;
  let pies = [], coins = [], floor = '', mine = null, callUntil = 0, callName = '';
  const others = new Map();
  const fx = [];
  let banner = null;

  // ---------- DOM ----------
  const frame = document.querySelector('.frame');
  const hudEl = el('div', 'arena-hud'); hudEl.hidden = true;
  const barEl = el('div', 'arena-bar'), boardEl = el('ol', 'arena-board'), bannerEl = el('div', 'arena-banner');
  bannerEl.hidden = true;
  hudEl.append(barEl);
  const callEl = el('button', 'arena-call party-call'); callEl.type = 'button'; callEl.hidden = true;
  callEl.addEventListener('click', () => { callEl.hidden = true; callUntil = 0; if (onCall) onCall(); });
  frame.append(hudEl, boardEl, bannerEl, callEl);

  const serverNow = () => Date.now() + offset;
  const running = () => !!snap && RUNNING.has(snap.ph);
  const me = () => myId();
  const inShow = () => running() && !!mine && !mine.gone;

  function setBanner(title, sub, color, ms, lines) {
    banner = { title, sub, color, until: performance.now() + ms, lines: lines || [] };
    bannerEl.replaceChildren();
    const t = el('b', null, title); t.style.color = color || '#ffe7a8';
    bannerEl.append(t);
    if (sub) bannerEl.append(el('p', null, sub));
    if (lines && lines.length) { const ol = el('ol'); for (const l of lines) ol.append(el('li', l.cls || null, l.text)); bannerEl.append(ol); }
    bannerEl.hidden = !visible;
  }

  function onEvent(e) {
    const id = me();
    if (e.k === 'tp' && String(e.id) === id && tpHandler) tpHandler(e.x, e.y);
    else if (e.k === 'coin') {
      const c = coins.find((x) => x[0] === e.c);
      if (c) fx.push({ k: 'text', x: c[1], y: c[2] - 8, t0: performance.now(), text: `+${e.v}`, color: e.v > 1 ? '#ffd23f' : '#fff3d6' });
      if (String(e.id) === id) audio.tool(e.v > 1 ? 'bigcoin' : 'coin');
      coins = coins.filter((x) => x[0] !== e.c);
    } else if (e.k === 'hit') {
      fx.push({ k: 'smoke', x: e.x, y: e.y + 6, t0: performance.now() });
      if (String(e.id) === id) { audio.tool('splat'); shake = performance.now() + 300; fx.push({ k: 'text', x: e.x, y: e.y - 14, t0: performance.now(), text: '啪！', color: '#ff8a65' }); }
      else if (String(e.by) === id) { audio.tool('harvest'); fx.push({ k: 'text', x: e.x, y: e.y - 14, t0: performance.now(), text: '+1 命中！', color: '#ffd23f' }); }
      else audio.tool('splat');
      fx.push({ k: 'decal', x: e.x, y: e.y + 8, t0: performance.now() });
    } else if (e.k === 'splat') { fx.push({ k: 'decal', x: e.x, y: e.y + 8, t0: performance.now() }); }
    else if (e.k === 'crack') audio.tool('crack');
    else if (e.k === 'fall') {
      fx.push({ k: 'smoke', x: e.x, y: e.y, t0: performance.now() });
      if (String(e.id) === id) { audio.tool('fall'); hud.toast(e.quiz ? '答錯了，濕答答……' : '掉下去了！這回合先看大家比', e.quiz ? 1400 : 2500); }
    } else if (e.k === 'right') {
      if (String(e.id) === id) { audio.tool('harvest'); hud.toast('答對了！+1', 1200); }
    } else if (e.k === 'answer') audio.tool('crack');
    else if (e.k === 'question') audio.tool('talk');
    else if (e.k === 'round') {
      const r = ROUNDS[e.kind] || {};
      audio.tool('whistle');
      const last = snap && snap.rounds && e.rd === snap.rounds.length - 1;
      setBanner(`${last ? '決賽' : `第 ${e.rd + 1} 回合`}：${r.icon || ''} ${r.name || ''}`, last ? `${r.how}（積分加倍！）` : r.how, r.color, 3400);
    } else if (e.k === 'join') { if (String(e.id) !== id) sys(`🎪 ${e.name} 報名了派派大作戰`); }
    else if (e.k === 'abort') { sys('🎪 參賽的人都離開了，這場派派大作戰取消。'); }
  }
  let tpHandler = null;

  function showResult() {
    const list = standings([...allPlayers()], 'total');
    const r = ROUNDS[snap.kind] || {};
    setBanner(`${r.icon || ''} ${r.name || ''} 結算`, `第 ${snap.rd + 1}／${(snap.rounds || []).length} 回合`, r.color, 3800,
      list.map((p) => ({ text: `${p.rank}. ${p.name}${p.bot ? '（鎮民）' : ''}　+${p.gain}　共 ${p.total} 分`, cls: p.id === me() ? 'me' : null })));
  }
  function showFinal() {
    const res = snap.res || [];
    const top = res[0];
    audio.tool('fanfare');
    const lines = res.map((r) => ({ text: `${r.rank === 1 ? '👑' : `${r.rank}.`} ${r.name}${r.bot ? '（鎮民）' : ''}　${r.total} 分${r.bot ? '' : `　${r.gold | 0} G`}`, cls: String(r.id) === me() ? 'me' : null }));
    const humans = res.filter((r) => !r.bot).length;
    setBanner(top ? `👑 ${top.name} 奪冠！` : '比賽結束', humans > 1 ? `${humans} 位鎮民同場，金幣加成 +${Math.min(100, (humans - 1) * 20)}%！` : '找朋友一起報名，每多一人金幣 +20%。', '#ffd23f', 8800, lines);
    if (top && !top.bot) sys(`👑 ${top.name} 在派派大作戰奪冠！`);
  }

  function allPlayers() {
    const out = [];
    if (mine) out.push(mine);
    for (const p of others.values()) if (p.live) out.push(p);
    return out;
  }

  /** 伺服器快照；pushed=true 時才處理事件（回覆裡附的快照不重播事件）。 */
  function apply(s, pushed) {
    if (!s) return;
    const o = s.now - Date.now();
    offset = !snap || Math.abs(o - offset) > 1500 ? o : offset + (o - offset) * 0.2;
    const prev = snap;
    snap = s; recvAt = performance.now();
    mine = null;
    const seen = new Set();
    for (const row of s.P || []) {
      const p = unpackPlayer(row);
      if (p.id === me()) { mine = p; continue; }
      seen.add(p.id);
      const q = others.get(p.id) || { ...p, tx: p.x, ty: p.y, movedAt: 0 };
      if (Math.hypot(p.x - q.tx, p.y - q.ty) > 0.3) { q.movedAt = performance.now(); }
      if (Math.hypot(p.x - q.x, p.y - q.y) > 80) { q.x = p.x; q.y = p.y; }
      Object.assign(q, { ...p, x: q.x, y: q.y, tx: p.x, ty: p.y, live: true });
      others.set(p.id, q);
    }
    for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id);
    if (pushed && s.ev) for (const e of s.ev) onEvent(e);
    coins = s.kind === 'coin' ? s.C || [] : [];
    pies = (s.K || []).map((k) => ({ id: k[0], x: k[1], y: k[2], vx: k[3], vy: k[4], at: recvAt }));
    floor = s.F || '';
    const was = prev && prev.id === s.id ? prev.ph : null;
    if (pushed && s.ph !== was) {
      if (s.ph === 'result') showResult();
      else if (s.ph === 'final') showFinal();
      else if (s.ph === 'queue' && !was) audio.tool('talk');
    }
    if (!running()) { others.clear(); mine = null; }
    paintHud(true);
  }

  // ---------- 介面 ----------
  function paintHud(force) {
    const now = performance.now();
    if (!force && now - lastHud < 200) return;
    lastHud = now;
    const show = visible && enabled;
    hudEl.hidden = !show; boardEl.hidden = !show;
    bannerEl.hidden = !(visible && banner && now < banner.until);
    const call = !visible && callUntil > Date.now();
    callEl.hidden = !call;
    if (call) callEl.textContent = `📣 ${callName} 報名了派派大作戰！${Math.max(0, Math.ceil((callUntil - Date.now()) / 1000))} 秒後開賽，點這裡過去`;
    if (!show) return;
    const t = serverNow();
    if (!snap || snap.ph === 'idle') {
      barEl.textContent = '🎪 派派大作戰：到報名台按 E 報名，人不夠會有鎮民來湊熱鬧。';
      boardEl.replaceChildren();
      return;
    }
    if (snap.ph === 'queue') {
      const q = snap.q || [];
      const inQ = q.some((x) => String(x[0]) === me());
      barEl.textContent = `🎪 報名中（${q.length}/${ARENA.maxPlayers}）${secondsLeft(snap, t)} 秒後開賽${inQ ? '　你已報名，在報名台按 E 可取消' : '　到報名台按 E 加入'}`;
      if (q.length !== lastCount) { lastCount = q.length; boardEl.replaceChildren(...q.map((x) => el('li', String(x[0]) === me() ? 'me' : null, x[1]))); }
      return;
    }
    lastCount = -1;
    const r = ROUNDS[snap.kind] || {};
    const left = secondsLeft(snap, t);
    if (snap.kind === 'quiz' && snap.ph === 'live' && snap.Z) {
      const z = snap.Z, qleft = Math.max(0, Math.ceil((z.until - t) / 1000));
      barEl.textContent = z.st === 'ask' ? `❓ 第 ${z.i + 1}/${z.n} 題：${z.q}　⏱ ${qleft}` : `❓ 答案是 ${QUAD.labels[z.ok]}．${z.a[z.ok]}！`;
      boardEl.replaceChildren(...standings(allPlayers(), 'score').map((p) => el('li', p.id === me() ? 'me' : null, `${p.rank}. ${p.name}${p.bot ? '·鎮民' : ''}　${p.score}`)));
      return;
    }
    const head = `${r.icon || ''} ${r.name || ''}　第 ${snap.rd + 1}／${(snap.rounds || []).length} 回合`;
    const phase = snap.ph === 'intro' ? `${left} 秒後開始` : snap.ph === 'live' ? `剩 ${left} 秒` : snap.ph === 'result' ? '結算中' : '頒獎';
    const my = mine ? (snap.kind === 'pie' && snap.ph === 'live' ? `　🥧×${mine.ammo}　得分 ${mine.score}` : snap.kind === 'floor' ? (mine.out ? '　已出局' : '　還站著！') : `　得分 ${mine.score}`) : '　觀戰中';
    barEl.textContent = `${head}　${phase}${my}`;
    const key = snap.ph === 'live' && snap.kind !== 'floor' ? 'score' : 'total';
    boardEl.replaceChildren(...standings(allPlayers(), key).map((p) => {
      const li = el('li', p.id === me() ? 'me' : null, `${p.rank}. ${p.name}${p.bot ? '·鎮民' : ''}　${key === 'score' ? p.score : p.total}${p.out ? ' 💧' : ''}`);
      return li;
    }));
  }

  // ---------- 繪圖（世界座標） ----------
  function drawUnder(ctx, now, scene) {
    const [x0, y0, x1, y1] = ARENA.field;
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8);
    ctx.fillStyle = '#8a5a30'; ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
    const live = running() && (snap.kind === 'floor' || snap.kind === 'quiz') && snap.ph !== 'final';
    const quiz = running() && snap.kind === 'quiz' && snap.ph === 'live';
    for (let i = 0; i < ARENA.cols * ARENA.rows; i++) {
      const c = i % ARENA.cols, r = Math.floor(i / ARENA.cols), x = x0 + c * ARENA.cell, y = y0 + r * ARENA.cell;
      const st = live ? floor[i] || '0' : '0';
      if (st === '2') {
        ctx.fillStyle = '#16212e'; ctx.fillRect(x, y, ARENA.cell, ARENA.cell);
        ctx.fillStyle = '#0d141d'; ctx.fillRect(x, y, ARENA.cell, 6);
        ctx.fillStyle = 'rgba(120,170,220,.25)'; ctx.fillRect(x + 6 + ((i * 7) % 18), y + 14 + ((i * 5) % 12), 1, 1);
        continue;
      }
      const j = st === '1' ? Math.round(Math.sin(now / 30 + i) * 1) : 0;
      ctx.fillStyle = (c + r) % 2 ? '#e2c08a' : '#ecd2a0'; ctx.fillRect(x + j, y, ARENA.cell, ARENA.cell);
      if (quiz) { const q = quadrant(i); ctx.fillStyle = q < 0 ? 'rgba(90,58,30,.35)' : QUAD.colors[q]; ctx.fillRect(x + j, y, ARENA.cell, ARENA.cell); }
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + j, y, ARENA.cell, 1); ctx.fillRect(x + j, y, 1, ARENA.cell);
      ctx.fillStyle = 'rgba(90,58,30,.22)'; ctx.fillRect(x + j, y + ARENA.cell - 1, ARENA.cell, 1); ctx.fillRect(x + j + ARENA.cell - 1, y, 1, ARENA.cell);
      if (st === '1') {
        const on = Math.floor(now / 110) % 2 === 0;
        ctx.fillStyle = on ? 'rgba(230,60,40,.55)' : 'rgba(230,60,40,.25)'; ctx.fillRect(x + j, y, ARENA.cell, ARENA.cell);
        ctx.fillStyle = '#5a2a18';
        ctx.fillRect(x + j + 8, y + 10, 10, 1); ctx.fillRect(x + j + 17, y + 11, 1, 8); ctx.fillRect(x + j + 12, y + 19, 6, 1);
      }
    }
    if (!running()) {      // 場地中央的大字
      ctx.fillStyle = 'rgba(138,90,48,.35)';
      ctx.fillRect((x0 + x1) / 2 - 60, (y0 + y1) / 2 - 10, 120, 20);
    }
    for (const f of fx) {   // 地上的奶油漬，三秒淡出
      if (f.k !== 'decal') continue;
      ctx.globalAlpha = Math.max(0, 1 - (now - f.t0) / 3000);
      spr(ctx, scene, 'arenaSplat', f.x, f.y);
    }
    ctx.globalAlpha = 1;
    if (running() && snap.ph === 'final') spr(ctx, scene, 'arenaPodium', 240, 222);
    const img = scene.imgs['ninja/fx/coin.png'];
    for (const [, x, y, v] of coins) {
      const f = Math.floor(now / 120 + x) % 4;
      ctx.fillStyle = 'rgba(40,30,20,.25)'; ctx.fillRect(Math.round(x) - 3, Math.round(y), 6, 1);
      if (v > 1) spr(ctx, scene, 'arenaPieGold', x, y - Math.abs(Math.sin(now / 200)) * 2);
      else if (img) ctx.drawImage(img, f * 10, 0, 10, 10, Math.round(x) - 5, Math.round(y) - 10, 10, 10);
    }
  }

  function drawOver(ctx, now, scene, selfPos) {
    for (const p of pies) {
      const age = Math.min(0.4, (now - p.at) / 1000);
      const x = p.x + p.vx * age, y = p.y + p.vy * age;
      ctx.fillStyle = 'rgba(40,30,20,.25)'; ctx.fillRect(Math.round(x) - 3, Math.round(y) + 8, 7, 2);
      spr(ctx, scene, 'arenaPie', x, y + 6);
    }
    const smoke = scene.imgs['ninja/fx/smoke.png'];
    for (const f of fx) {
      if (f.k !== 'smoke' || !smoke) continue;
      const i = Math.floor((now - f.t0) / 60);
      if (i >= 6) continue;
      const s = f.small ? 16 : 24;
      ctx.drawImage(smoke, i * 32, 0, 32, 32, Math.round(f.x - s / 2), Math.round(f.y - s), s, s);
    }
    // 暈眩星星、被保護時的泡泡、領先者皇冠
    const list = allPlayers().map((p) => (p.id === me() && selfPos ? { ...p, x: selfPos.x, y: selfPos.y } : p));
    const lead = running() && snap.ph !== 'intro' ? standings(list, 'total')[0] : null;
    for (const p of list) {
      if (p.out) continue;
      if (p.stunned) for (let k = 0; k < 3; k++) {
        const a = now / 160 + k * 2.1;
        ctx.fillStyle = '#ffe14d'; ctx.fillRect(Math.round(p.x + Math.cos(a) * 6), Math.round(p.y - 19 + Math.sin(a) * 2), 2, 2);
      }
      if (p.shield && Math.floor(now / 120) % 2) { ctx.strokeStyle = 'rgba(160,220,255,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x, p.y - 7, 8, 10, 0, 0, 7); ctx.stroke(); }
      if (lead && p.id === lead.id && lead.total > 0) spr(ctx, scene, 'arenaCrown', p.x, p.y - 15 - Math.abs(Math.sin(now / 300)));
    }
  }

  function drawTop(ctx, cam, S, now) {
    ctx.setTransform(1, 0, 0, 1, -cam.x * S, -cam.y * S);
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], age = now - f.t0;
      if (age > (f.k === 'decal' ? 3000 : 900)) { fx.splice(i, 1); continue; }
      if (f.k === 'text') drawText(ctx, f.text, f.x, f.y - age / 40, 12, f.color);
    }
    if (!running()) {
      const [x0, y0, x1, y1] = ARENA.field;
      drawText(ctx, '派派大作戰', (x0 + x1) / 2, (y0 + y1) / 2 + 5, 14, 'rgba(90,58,30,.85)');
    }
    if (running() && snap.kind === 'quiz' && snap.Z && snap.ph === 'live') {
      for (let q = 0; q < 4; q++) {
        const [cx, cy] = quadrantCenter(q);
        const ok = snap.Z.ok;
        const text = `${QUAD.labels[q]}. ${snap.Z.a[q]}`;
        const w = Math.max(40, text.length * 7 + 10);
        ctx.fillStyle = ok == null ? 'rgba(40,24,10,.72)' : ok === q ? 'rgba(30,110,40,.9)' : 'rgba(40,24,10,.4)';
        ctx.fillRect(Math.round((cx - w / 2) * S), Math.round((cy - 9) * S), Math.round(w * S), Math.round(14 * S));
        drawText(ctx, text, cx, cy + 2, 12, ok == null || ok === q ? '#fff3d6' : 'rgba(255,243,214,.5)');
      }
    }
  }

  return {
    get snap() { return snap; },
    get mine() { return mine; },
    get offset() { return offset; },
    others,
    running, inShow, serverNow,
    setEnabled(v) { enabled = v; paintHud(true); },
    setVisible(v) { visible = v; frame.classList.toggle('in-arena', v); if (!v) { bannerEl.hidden = true; } paintHud(true); },
    onTeleport(fn) { tpHandler = fn; },
    apply,
    call(m) {
      callName = String(m.name || '有人').slice(0, 16);
      callUntil = Date.now() + Math.max(0, (m.end || 0) - (m.now || 0));
      sys(`📣 ${callName} 報名了派派大作戰！到廣場北邊的競技場一起玩。`);
      paintHud(true);
    },
    /** 這一刻自己不能動（開場前、結算、被打暈、掉下去）。 */
    frozen() {
      if (!inShow()) return false;
      return snap.ph !== 'live' || mine.stunned || mine.out;
    },
    canThrow() { return inShow() && snap.ph === 'live' && snap.kind === 'pie' && !mine.stunned && mine.ammo > 0; },
    /** 移動用的碰撞：參賽中只能在場內，不參賽就不能進場。 */
    blocker(base) {
      const r = fieldRect();
      return (x, y) => {
        if (inShow()) return !inField(x, y);
        if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
        return base(x, y);
      };
    },
    /** 不參賽卻被卡在場內（漏收傳送）時拉回大廳。 */
    rescue(p) {
      const r = fieldRect();
      // 參賽中：本機位置和伺服器差太多（被限速、漏收傳送）就以伺服器為準
      if (inShow() && !mine.out && Math.hypot(p.x - mine.x, p.y - mine.y) > 48 && performance.now() - recvAt < 400) { p.x = mine.x; p.y = mine.y; return true; }
      if (!inShow() && p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1) { p.x = 240; p.y = 262; return true; }
      return false;
    },
    /** 給 drawWorld 的人物（自己以外的參賽者）。 */
    people(now, dt) {
      const out = [];
      if (!running()) return out;
      const k = 1 - Math.exp(-dt * 14);
      for (const p of others.values()) {
        if (p.gone) continue;
        p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
        if (p.out && snap.kind === 'floor') continue;
        if (snap.kind === 'quiz' && floor[cellOf(p.x, p.y)] === '2') continue;      // 答錯掉下去，下一題再出現
        out.push({ id: p.id, name: p.name, x: p.x, y: p.y, dir: p.dir, moving: now - p.movedAt < 260, look: p.look, npc: p.bot, sprite: p.sprite, near: true, arena: true });
      }
      return out;
    },
    /** 問答揭曉時自己站在塌掉的區塊上。 */
    sunk(p) { return running() && snap.kind === 'quiz' && floor[cellOf(p.x, p.y)] === '2'; },
    participants() { return new Set(running() ? [...others.keys()] : []); },
    tick() { paintHud(false); },
    shaking: () => performance.now() < shake,
    drawUnder, drawOver, drawTop,
    cellOf,
  };
}
