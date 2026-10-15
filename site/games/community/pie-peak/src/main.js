import * as THREE from 'three';
import PieGame from '../../../../sdk/pie-game-sdk.js';
import { Game } from './game.js';
import { SceneView } from './scene.js';
import { UI } from './ui.js';
import { ITEMS } from './items.js';
import { dailySeed } from './rng.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const app = $('app');
const params = new URLSearchParams(location.search);
const touchDevice = matchMedia('(pointer:coarse)').matches;
const keys = new Set();
const state = { game: null, view: null, ui: new UI(), mode: 'title', character: params.get('c') || 'phoebe', seed: Number(params.get('seed')) || dailySeed(),
  jump: false, grabTouch: false, runTouch: false, useTouch: false, stick: { x: 0, y: 0, id: null }, drag: null, lmb: false, look: { yaw: 0, pitch: 0, zoom: 0 }, tickAcc: 0, stepAcc: 0 };
let best = {}; try { best = JSON.parse(localStorage.getItem('pg-pie-peak-best') || '{}'); } catch { best = {}; }

$('seed-text').textContent = String(state.seed);
const showBest = () => { $('best').textContent = best.alt ? `最佳紀錄：高度 ${Math.round(best.alt)} m · 分數 ${best.score}${best.won ? ' · 已登頂' : ''}` : ''; };
showBest();
for (const b of document.querySelectorAll('#pick button')) {
  b.classList.toggle('on', b.dataset.c === state.character);
  b.onclick = () => { state.character = b.dataset.c; document.querySelectorAll('#pick button').forEach((x) => x.classList.toggle('on', x === b)); audio.unlock(); audio.play('click'); };
}

// ---------- screens ----------
function show(id, on) { $(id).hidden = !on; }
function setMode(m) {
  state.mode = m;
  show('menu', m === 'title'); show('hud', m !== 'title' && m !== 'loading');
  show('modal', ['pause', 'over', 'won'].includes(m)); show('loading', m === 'loading');
}
function modal({ eyebrow, title, copy, stats = [], primary, secondary, onPrimary, onSecondary }) {
  $('modal-eyebrow').textContent = eyebrow; $('modal-title').textContent = title; $('modal-copy').textContent = copy;
  $('modal-stats').innerHTML = stats.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
  $('m-primary').textContent = primary; $('m-primary').onclick = onPrimary;
  $('m-secondary').hidden = !secondary; if (secondary) { $('m-secondary').textContent = secondary; $('m-secondary').onclick = onSecondary; }
  $('m-home').onclick = () => { state.game = null; setMode('title'); showBest(); };
}
function statsOf(g) {
  const s = g.stats, t = Math.floor(g.time);
  return [['最高高度', `${Math.round(s.maxAlt)} m`], ['用時', `${Math.floor(t / 60)} 分 ${t % 60} 秒`], ['打開行李箱', s.opened], ['使用道具', s.itemsUsed], ['童軍徽章', s.badges], ['祭壇', `${s.shrines}/4`], ['摔落', s.falls], ['昏倒', s.deaths], ['分數', g.score()]];
}
function saveBest(g, won) {
  const score = g.score();
  if (!best.alt || g.stats.maxAlt > best.alt || (won && !best.won)) { best = { alt: Math.max(best.alt || 0, g.stats.maxAlt), score: Math.max(best.score || 0, score), won: best.won || won, seed: state.seed }; try { localStorage.setItem('pg-pie-peak-best', JSON.stringify(best)); } catch {} }
}

async function startGame() {
  audio.unlock(); setMode('loading'); $('load-text').textContent = '正在搭建山脈…'; $('load-bar').value = 0;
  await new Promise((r) => setTimeout(r, 30));
  const game = new Game(state.seed, { character: state.character });
  if (!state.view) state.view = new SceneView($('world'));
  state.view.clear?.();
  state.game = game;
  await state.view.build(game, (n, total) => { $('load-bar').value = n / total; $('load-text').textContent = `載入模型 ${n}/${total}`; });
  state.view.cam.yaw = 0; state.view.cam.pitch = 0.42;
  state.view.cam.target.set(game.player.x, game.player.y + 1, game.player.z);
  setMode('play'); app.focus(); state.ui.bagSig = '';
  state.ui.banner('海灘', '墜機倖存者 · 往上爬');
  for (const m of ['走向岩壁，按住 F 或滑鼠左鍵抓牆，W 往上爬', '先打開行李箱（靠近按住 E），補給藏在平台上', '體力上限會被飢餓、受傷、寒冷和負重壓低']) setTimeout(() => state.mode === 'play' && state.ui.toast(m, 'warn'), 500);
}
$('start').onclick = startGame;

function pause() {
  if (state.mode === 'play') { state.mode = 'pause'; clearInput(); modal({ eyebrow: 'PAUSED', title: '喘口氣再出發', copy: '時間暫停了。', stats: statsOf(state.game), primary: '繼續攀登', onPrimary: () => { setMode('play'); app.focus(); } }); setMode('pause'); }
  else if (state.mode === 'pause') { setMode('play'); app.focus(); }
}
$('btn-pause').onclick = pause;
$('btn-sound').onclick = () => { audio.unlock(); $('btn-sound').textContent = `音效 ${audio.toggle() ? '關' : '開'}`; };

// ---------- input ----------
function clearInput() { keys.clear(); state.lmb = false; state.stick = { x: 0, y: 0, id: null }; state.grabTouch = state.runTouch = state.useTouch = false; state.drag = null; $('joystick').firstElementChild.style.transform = ''; for (const id of ['t-grab', 't-run']) $(id).classList.remove('active'); }
function readInput() {
  const k = (n) => (keys.has(n) ? 1 : 0), c = state.view.cam;
  const ix = k('d') - k('a') + state.stick.x, iy = k('w') - k('s') - state.stick.y;
  const v = Math.hypot(ix, iy);
  const input = { ix: v > 1 ? ix / v : ix, iy: v > 1 ? iy / v : iy, jump: state.jump, grab: keys.has('f') || state.lmb || state.grabTouch, run: keys.has('shift') || state.runTouch, use: keys.has('e') || state.useTouch, camYaw: c.yaw, aim: aimRay() };
  state.jump = false; return input;
}
const _dir = new THREE.Vector3();
function aimRay() {
  const cam = state.view.camera; cam.getWorldDirection(_dir);
  return { ox: cam.position.x, oy: cam.position.y, oz: cam.position.z, dx: _dir.x, dy: _dir.y, dz: _dir.z };
}
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (e.target.closest && e.target.closest('button') && k === ' ') return;
  keys.add(k); if (e.repeat) return; audio.unlock();
  if (state.mode === 'title') { if (k === 'enter') startGame(); return; }
  if (k === 'escape' || k === 'p') { pause(); return; }
  if (state.mode !== 'play') return;
  const g = state.game;
  if (k === ' ') state.jump = true;
  if (k >= '1' && k <= '7') selectSlot(Number(k) - 1);
  if (k === 'enter' || k === 'r') useSlot(g.selected);
  if (k === 'q') g.drop(g.selected);
  if (k === 'tab') selectSlot((g.selected + 1) % g.capacity);
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { clearInput(); if (state.mode === 'play') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearInput(); if (state.mode === 'play') pause(); } });
function selectSlot(i) { const g = state.game; if (!g || i >= g.capacity) return; g.selectSlot(i); state.ui.bagSig = ''; audio.play('click'); }
function useSlot(i) { const g = state.game; if (!g) return; g.selectSlot(i); g.use(i); state.ui.bagSig = ''; }
const canvas = $('world');
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (e.button === 2 || (e.pointerType === 'touch' && e.clientX > innerWidth * 0.35)) { state.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); }
  else if (e.button === 0 && e.pointerType === 'mouse') { state.lmb = true; }
});
canvas.addEventListener('pointermove', (e) => { if (state.drag?.id === e.pointerId) { state.look.yaw -= (e.clientX - state.drag.x) * 0.006; state.look.pitch += (e.clientY - state.drag.y) * 0.004; state.drag.x = e.clientX; state.drag.y = e.clientY; } });
for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(n, (e) => { if (e.button === 0 || n !== 'pointerup') state.lmb = false; if (state.drag?.id === e.pointerId) state.drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.look.zoom += e.deltaY * 0.006; }, { passive: false });
// touch controls
const joy = $('joystick');
joy.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.unlock(); state.stick.id = e.pointerId; joy.setPointerCapture(e.pointerId); });
joy.addEventListener('pointermove', (e) => { if (e.pointerId !== state.stick.id) return; const r = joy.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2, l = Math.max(40, Math.hypot(dx, dy)); state.stick.x = dx / l; state.stick.y = dy / l; joy.firstElementChild.style.transform = `translate(${state.stick.x * 30}px,${state.stick.y * 30}px)`; });
for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) joy.addEventListener(n, () => { state.stick = { x: 0, y: 0, id: null }; joy.firstElementChild.style.transform = ''; });
$('t-jump').onpointerdown = (e) => { e.preventDefault(); audio.unlock(); state.jump = true; };
$('t-grab').onpointerdown = (e) => { e.preventDefault(); state.grabTouch = !state.grabTouch; $('t-grab').classList.toggle('active', state.grabTouch); };
$('t-run').onpointerdown = (e) => { e.preventDefault(); state.runTouch = !state.runTouch; $('t-run').classList.toggle('active', state.runTouch); };
$('t-use').onpointerdown = (e) => { e.preventDefault(); state.useTouch = true; $('t-use').setPointerCapture(e.pointerId); };
for (const n of ['pointerup', 'pointercancel', 'lostpointercapture']) $('t-use').addEventListener(n, () => (state.useTouch = false));
$('t-item').onpointerdown = (e) => { e.preventDefault(); state.game && useSlot(state.game.selected); };
const handlers = { select: selectSlot, use: useSlot, touch: touchDevice, camYaw: () => state.view?.cam.yaw || 0 };

// ---------- events → audio / UI ----------
function handleEvents(g) {
  for (const e of g.events) {
    switch (e.type) {
      case 'toast': state.ui.toast(e.msg, e.tone); break;
      case 'jump': audio.play('jump'); break;
      case 'land': audio.play('land', Math.min(1.5, e.drop / 6)); break;
      case 'attach': audio.play('attach'); break;
      case 'lunge': audio.play('lunge'); break;
      case 'mantle': audio.play('mantle'); break;
      case 'pickup': audio.play('pickup'); break;
      case 'badge': audio.play('badge'); break;
      case 'use': audio.play('use'); break;
      case 'hurt': audio.play('hurt'); state.ui.flashHurt(); if (e.amount > 8) audio.play('reggie'); break;
      case 'exhausted': audio.play('exhausted'); state.ui.toast('體力耗盡！', 'bad'); break;
      case 'luggage': audio.play('luggage'); break;
      case 'shrine': audio.play('shrine'); state.ui.banner('祭壇', '體力恢復・重生點已記錄'); break;
      case 'biome': audio.play('biome'); state.ui.banner(e.biome.name, e.biome.sub); break;
      case 'geyser': audio.play('geyser'); break;
      case 'rumble': audio.play('rumble'); state.ui.toast('⚠ 上方有落石！', 'warn'); break;
      case 'smash': audio.play('smash'); break;
      case 'explode': audio.play('explode'); break;
      case 'snap': audio.play('snap'); break;
      case 'sting': audio.play('sting'); break;
      case 'bees-angry': audio.play('reggie'); state.ui.toast('蜜蜂發怒了！快跑', 'bad'); break;
      case 'sniff': audio.play('reggie'); break;
      case 'drop': audio.play('rustle'); break;
      case 'fuse': audio.play('fuse'); break;
      case 'faint': audio.play('faint'); break;
      case 'revive': audio.play('revive'); break;
      case 'grapple': audio.play('grapple'); break;
      case 'glide': audio.play('glide'); break;
      case 'dart': audio.play('dart'); break;
      case 'rustle': audio.play('rustle'); break;
      case 'bounce': audio.play('bounce'); break;
      case 'launch': audio.play('launch'); break;
      case 'over': onOver(g); break;
      case 'win': onWin(g); break;
      case 'respawn': setMode('play'); app.focus(); break;
    }
  }
  g.events.length = 0;
}
function onOver(g) {
  saveBest(g, false); state.mode = 'over';
  modal({ eyebrow: 'FAINTED', title: '你昏倒了', copy: `最近的祭壇在「${g.checkpoint.name}」。重生會丟失部分行李。`, stats: statsOf(g),
    primary: '在祭壇醒來', onPrimary: () => { g.respawn(); }, secondary: '重新開始新的一局', onSecondary: startGame });
  setMode('over');
}
function onWin(g) {
  saveBest(g, true); state.mode = 'won'; audio.play('win');
  setTimeout(() => { modal({ eyebrow: 'RESCUED', title: '登頂成功！救援抵達', copy: '你和瑞吉一起看見了雲海。', stats: statsOf(g), primary: '再爬一次', onPrimary: startGame }); setMode('won'); }, 1500);
}

// ---------- loop ----------
let last = performance.now(), climbTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const g = state.game, view = state.view;
  if (g && view && (state.mode === 'play' || state.mode === 'over' || state.mode === 'won' || state.mode === 'pause')) {
    const look = { lookYaw: state.look.yaw + ((keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0)) * dt * 2.2, lookPitch: state.look.pitch + ((keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0)) * dt * 1.2, zoom: state.look.zoom };
    state.look = { yaw: 0, pitch: 0, zoom: 0 };
    let input = { ix: 0, iy: 0, jump: false, grab: false, run: false, use: false, camYaw: view.cam.yaw };
    if (state.mode === 'play') {
      input = readInput();
      state.stepAcc += dt; let n = 0;
      while (state.stepAcc >= 1 / 60 && n++ < 6) { g.update(1 / 60, { ...input, jump: input.jump && n === 1 }); state.stepAcc -= 1 / 60; }
      if (g.player.climbing && g.player.moveAmt > 0.3 && (climbTick -= dt) <= 0) { climbTick = 0.34; audio.play('climb'); }
      audio.setWind(Math.min(1, g.player.y / 200) * 0.6 + (g.wind ? 0.5 : 0));
    }
    view.update(state.mode === 'pause' ? 0 : dt, g, { ...look });
    handleEvents(g);
    state.ui.update(g, dt, handlers);
  } else if (view && state.mode === 'title') {
    /* title uses the CSS backdrop only */
  }
}
requestAnimationFrame(frame);
setMode('title');
window.__peak = { state, get game() { return state.game; }, get view() { return state.view; }, startGame, readInput };
PieGame.ready().then(() => PieGame.setHeight()).catch(() => {});
