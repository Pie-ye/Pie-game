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
  if (!keepBanner) bannerEl.textContent = 'PRESS ANY KEY';
  draw();
}

// 像素風畫面：深色方格底、綠色蛇身（頭上有眼睛）、紅色蘋果。
function draw() {
  ctx.fillStyle = '#04100a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a2418';
  for (let i = 0; i < SIZE; i += 1) {
    for (let j = 0; j < SIZE; j += 1) {
      if ((i + j) % 2 === 0) ctx.fillRect(i * CELL, j * CELL, CELL, CELL);
    }
  }
  // 蘋果
  const fx = state.food.x * CELL;
  const fy = state.food.y * CELL;
  ctx.fillStyle = '#ff3b3b';
  ctx.fillRect(fx + 4, fy + 6, CELL - 8, CELL - 8);
  ctx.fillRect(fx + 6, fy + 4, CELL - 12, CELL - 4);
  ctx.fillStyle = '#ffb0a0';
  ctx.fillRect(fx + 6, fy + 7, 3, 3);
  ctx.fillStyle = '#2cff9a';
  ctx.fillRect(fx + CELL / 2 - 1, fy + 1, 3, 4);
  state.snake.forEach((seg, idx) => {
    const x = seg.x * CELL;
    const y = seg.y * CELL;
    ctx.fillStyle = '#0a6a3a';
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.fillStyle = idx === 0 ? '#9dff3a' : (idx % 2 ? '#2cff9a' : '#1fd47a');
    ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
    if (idx === 0) {
      ctx.fillStyle = '#04100a';
      const d = state.dir;
      const ex = d.x === 0 ? [5, 12] : (d.x > 0 ? [11, 11] : [5, 5]);
      const ey = d.y === 0 ? [5, 12] : (d.y > 0 ? [11, 11] : [5, 5]);
      if (d.x === 0) {
        ctx.fillRect(x + 5, y + ey[0], 3, 3);
        ctx.fillRect(x + 12, y + ey[0], 3, 3);
      } else {
        ctx.fillRect(x + ex[0], y + 5, 3, 3);
        ctx.fillRect(x + ex[0], y + 12, 3, 3);
      }
    }
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
  if (state.snake.slice(1).some((s) => s.x === nx && s.y === ny)) {
    die();
    return;
  }
  draw();
}

function die() {
  state.running = false;
  state.dead = true;
  clearInterval(state.timer);
  bannerEl.textContent = 'GAME OVER · 按方向鍵再來';
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

// 用實體按鍵位置（ev.code）：中文輸入法開著時 ev.key 會變成 "Process"。
const keyMap = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (ev) => {
  const name = keyMap[ev.code];
  if (!name) return;
  ev.preventDefault();
  steer(name);
});

document.querySelectorAll('[data-dir]').forEach((btn) => {
  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    steer(btn.getAttribute('data-dir'));
  });
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

await PieGame.ready();
reset();
PieGame.setHeight();
