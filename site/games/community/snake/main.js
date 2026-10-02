import PieGame from '../../../sdk/pie-game-sdk.js';

const SIZE = 16;
const CELL = 20;
const TICK_MS = 140;
const KEY = 'pg-snake-highscore';
const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const bannerEl = document.getElementById('banner');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'studio' ? 'studio' : 'playful';
}

function readBest() {
  const n = Number(localStorage.getItem(KEY) || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

let best = readBest();
bestEl.textContent = String(best);

const state = {
  snake: [{ x: 8, y: 8 }],
  dir: DIRS.right,
  queued: null,
  food: { x: 12, y: 8 },
  score: 0,
  running: false,
  dead: false,
  timer: null,
};

function placeFood() {
  const taken = new Set(state.snake.map((p) => `${p.x},${p.y}`));
  let x;
  let y;
  do {
    x = Math.floor(Math.random() * SIZE);
    y = Math.floor(Math.random() * SIZE);
  } while (taken.has(`${x},${y}`));
  state.food = { x, y };
}

function reset(keepBanner) {
  state.snake = [{ x: 8, y: 8 }];
  state.dir = DIRS.right;
  state.queued = null;
  state.score = 0;
  state.dead = false;
  state.running = false;
  scoreEl.textContent = '0';
  placeFood();
  if (!keepBanner) bannerEl.textContent = '按任意方向開始';
  draw();
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function draw() {
  ctx.fillStyle = cssVar('--sheet') || '#fbf8f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = cssVar('--cell') || '#e9e2d3';
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      if ((i + j) % 2 === 0) ctx.fillRect(i * CELL, j * CELL, CELL, CELL);
    }
  }
  ctx.fillStyle = cssVar('--accent') || '#835f13';
  ctx.beginPath();
  ctx.arc(state.food.x * CELL + CELL / 2, state.food.y * CELL + CELL / 2, CELL * 0.35, 0, Math.PI * 2);
  ctx.fill();
  const gain = cssVar('--gain') || '#0e7354';
  const ink = cssVar('--ink') || '#1a1713';
  state.snake.forEach((seg, idx) => {
    ctx.fillStyle = idx === 0 ? ink : gain;
    ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
  });
}

function tick() {
  if (!state.running) return;
  if (state.queued) {
    const next = state.queued;
    if (next.x !== -state.dir.x || next.y !== -state.dir.y) state.dir = next;
    state.queued = null;
  }
  const head = state.snake[0];
  const nx = head.x + state.dir.x;
  const ny = head.y + state.dir.y;
  if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) {
    die();
    return;
  }
  if (state.snake.some((s) => s.x === nx && s.y === ny)) {
    die();
    return;
  }
  state.snake.unshift({ x: nx, y: ny });
  if (nx === state.food.x && ny === state.food.y) {
    state.score += 1;
    scoreEl.textContent = String(state.score);
    if (state.score > best) {
      best = state.score;
      localStorage.setItem(KEY, String(best));
      bestEl.textContent = String(best);
    }
    placeFood();
  } else {
    state.snake.pop();
  }
  draw();
}

function die() {
  state.running = false;
  state.dead = true;
  clearInterval(state.timer);
  bannerEl.textContent = '撞到了。按方向鍵再來一局';
}

function start() {
  if (state.running) return;
  if (state.dead) reset(true);
  state.running = true;
  bannerEl.textContent = '';
  clearInterval(state.timer);
  state.timer = setInterval(tick, TICK_MS);
}

function steer(name) {
  const dir = DIRS[name];
  if (!dir) return;
  if (!state.running) start();
  state.queued = dir;
}

const keyMap = {
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
};

window.addEventListener('keydown', (ev) => {
  const name = keyMap[ev.key];
  if (!name) return;
  ev.preventDefault();
  steer(name);
});

document.querySelectorAll('[data-dir]').forEach((btn) => {
  const fire = (ev) => {
    ev.preventDefault();
    steer(btn.getAttribute('data-dir'));
  };
  btn.addEventListener('click', fire);
  btn.addEventListener('pointerdown', fire);
});

let swipe = null;
canvas.addEventListener('pointerdown', (ev) => {
  swipe = { x: ev.clientX, y: ev.clientY };
});
canvas.addEventListener('pointerup', (ev) => {
  if (!swipe) return;
  const dx = ev.clientX - swipe.x;
  const dy = ev.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
  if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 'right' : 'left');
  else steer(dy > 0 ? 'down' : 'up');
});

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme((theme) => {
  applyTheme(theme);
  draw();
});
reset();
PieGame.setHeight(document.documentElement.scrollHeight);
