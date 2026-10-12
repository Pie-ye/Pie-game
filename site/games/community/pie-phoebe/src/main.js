import PieGame from '../../../../sdk/pie-game-sdk.js';
import { loadAssets } from './assets.js';
import { Game, loadBest } from './game.js';
import { UI } from './ui.js';
import * as Audio from './audio.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');
const canvas = document.getElementById('gl');
const nums = document.getElementById('nums');

let game = null;
let ui = null;

const handlers = {
  onStart: () => { Audio.unlock(); game.start(); app.focus(); },
  onPick: (i) => game.pick(i),
  onResume: () => { game.resume(); app.focus(); },
  onPause: () => (game.mode === 'pause' ? game.resume() : game.pause()),
  onQuit: () => game.quit(),
  onContinue: () => game.continueEndless(),
  onMute: () => { Audio.unlock(); Audio.setMuted(!Audio.isMuted()); ui.refreshMute(); },
  onMode: (m) => game.setMode(m),
};

// ───────── 鍵盤 ─────────
const keys = new Set();
function readKeys() {
  let x = 0; let z = 0;
  if (keys.has('arrowleft') || keys.has('a')) x -= 1;
  if (keys.has('arrowright') || keys.has('d')) x += 1;
  if (keys.has('arrowup') || keys.has('w')) z -= 1;
  if (keys.has('arrowdown') || keys.has('s')) z += 1;
  return [x, z];
}

window.addEventListener('keydown', (ev) => {
  if (!game) return;
  const k = ev.key.toLowerCase();
  Audio.unlock();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) ev.preventDefault();
  if (ev.repeat && k !== 'arrowup') { keys.add(k); return; }
  keys.add(k);
  if (game.mode === 'title' || game.mode === 'over') { if (k === 'enter' || k === ' ') handlers.onStart(); return; }
  if (game.mode === 'win') { if (k === 'enter') handlers.onStart(); return; }
  if (game.mode === 'levelup') { if (k >= '1' && k <= '3') game.pick(Number(k) - 1); return; }
  if (k === 'p' || k === 'escape') handlers.onPause();
  else if (game.mode === 'pause' && (k === 'enter' || k === ' ')) handlers.onResume();
  else if (k === 'q') game.setMode('absolve');
  else if (k === 'e') game.setMode('confess');
  else if (k === 'm') handlers.onMute();
});
window.addEventListener('keyup', (ev) => keys.delete(ev.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); if (game && game.mode === 'play') game.pause(); });

// ───────── 指標（觸控／滑鼠）虛擬搖桿 ─────────
const stick = { id: null, ox: 0, oy: 0, x: 0, z: 0 };
app.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('button') || !game || game.mode !== 'play' || stick.id != null) return;
  Audio.unlock();
  stick.id = ev.pointerId; stick.ox = ev.clientX; stick.oy = ev.clientY; stick.x = 0; stick.z = 0;
  app.setPointerCapture(ev.pointerId);
  const r = app.getBoundingClientRect();
  ui.stick(true, ev.clientX - r.left, ev.clientY - r.top, 0, 0);
});
app.addEventListener('pointermove', (ev) => {
  if (ev.pointerId !== stick.id) return;
  let dx = ev.clientX - stick.ox; let dy = ev.clientY - stick.oy;
  const max = 48;
  const l = Math.hypot(dx, dy);
  if (l > max) { dx = (dx / l) * max; dy = (dy / l) * max; }
  stick.x = dx / max; stick.z = dy / max;
  const r = app.getBoundingClientRect();
  ui.stick(true, stick.ox - r.left, stick.oy - r.top, dx, dy);
});
const endStick = (ev) => {
  if (ev.pointerId !== stick.id) return;
  stick.id = null; stick.x = 0; stick.z = 0;
  ui.stick(false);
};
app.addEventListener('pointerup', endStick);
app.addEventListener('pointercancel', endStick);

// ───────── 主迴圈 ─────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game.bot) {
    const [kx, kz] = readKeys();
    game.input.x = kx + stick.x; game.input.z = kz + stick.z;
  }
  game.update(dt);
  game.render();
  if (game.mode === 'play' || game.mode === 'levelup') game.hud();
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    Audio.prefetchSamples();
    const assets = await loadAssets();
    ui = new UI(handlers);
    game = new Game(canvas, nums, assets, ui);
    window.addEventListener('resize', () => game.resize());
    new ResizeObserver(() => game.resize()).observe(app);
    ui.loaded();
    ui.title(loadBest());
    if (params.get('bot') === '1') { game.bot = true; game.start(); }
    window.__pie = { game, ui };
    requestAnimationFrame(frame);
  } catch (err) {
    document.getElementById('loading').textContent = `載入失敗：${err.message}`;
    throw err;
  }
}

boot();
PieGame.ready().then(() => PieGame.setHeight());
