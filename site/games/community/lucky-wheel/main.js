import PieGame from '../../../sdk/pie-game-sdk.js';

const LABELS = ['×20', '×5', '×2', '×2', '×1', '未中', '未中', '未中'];
const wheel = document.getElementById('wheel');
const statusEl = document.getElementById('status');
let rotation = 0;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'studio' ? 'studio' : 'playful';
}

function indexOf(result) {
  const display = result.display;
  if (display && typeof display === 'object' && Number.isFinite(display.index)) return display.index;
  if (Array.isArray(display) && display[0] && Number.isFinite(display[0].index)) return display[0].index;
  return 0;
}

wheel.addEventListener('click', () => PieGame.coin.select('spin'));

PieGame.coin.onResult((result) => {
  const index = ((indexOf(result) % 8) + 8) % 8;
  const extra = 360 * 5;
  const target = extra + (360 - index * 45);
  rotation = (rotation - (rotation % 360)) + target;
  wheel.classList.add('spin');
  wheel.style.transform = `rotate(${rotation}deg)`;
  window.setTimeout(() => {
    const win = Number(result.net) > 0;
    statusEl.className = win ? 'win' : 'lose';
    statusEl.textContent = `${LABELS[index]} · 押 ${result.bet} · 得 ${result.payout} · 淨 ${result.net}`;
  }, 2400);
});

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme(applyTheme);
PieGame.coin.select('spin');
PieGame.setHeight(document.documentElement.scrollHeight);
