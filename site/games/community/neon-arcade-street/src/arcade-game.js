// A local, replayable cabinet game. Scores never affect account balances.
export function createArcadeGame(onClose) {
  const dialog = document.getElementById('arcade-game');
  const pads = [...dialog.querySelectorAll('[data-pad]')];
  const start = document.getElementById('arcade-start');
  const status = document.getElementById('arcade-status');
  let running = false, score = 0, misses = 0, target = -1, deadline = 0, timer = null;
  let best = 0;
  function paint() {
    pads.forEach((pad, i) => { pad.dataset.active = String(i === target); pad.disabled = !running; });
  }
  function finish() {
    running = false; clearInterval(timer); target = -1; best = Math.max(best, score); paint();
    status.textContent = `本局 ${score} 分 · 失誤 ${misses} 次 · 本次遊玩最高 ${best} 分`;
    start.hidden = false; start.textContent = '再玩一局'; start.focus();
  }
  function next() {
    // One full, stable target until a hit or timeout; no rapid flashing.
    const previous = target;
    target = (previous + 1 + Math.floor(Math.random() * 3)) % 4;
    deadline = performance.now() + 1500; paint();
    status.textContent = `得分 ${score} · 失誤 ${misses}/3 · 按亮起的方向`;
  }
  function hit(index) {
    if (!running) return;
    if (index === target) score++;
    else misses++;
    if (misses >= 3) finish(); else next();
  }
  start.addEventListener('click', () => {
    clearInterval(timer); score = misses = 0; running = true; start.hidden = true; next();
    pads[0].focus();
    timer = setInterval(() => {
      if (running && performance.now() >= deadline) { misses++; if (misses >= 3) finish(); else next(); }
    }, 100);
  });
  pads.forEach((pad, i) => pad.addEventListener('click', () => hit(i)));
  const directions = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
  dialog.addEventListener('keydown', event => {
    const index = directions.indexOf(event.code);
    if (index < 0) return;
    event.preventDefault(); if (!event.repeat) hit(index);
  });
  document.getElementById('arcade-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { running = false; clearInterval(timer); target = -1; paint(); onClose(); });
  return {
    open() {
      running = false; target = -1; paint(); start.hidden = false;
      status.textContent = '每個方向亮起 1.5 秒，按對得 1 分；失誤 3 次結束。';
      dialog.showModal(); start.focus();
    },
  };
}
