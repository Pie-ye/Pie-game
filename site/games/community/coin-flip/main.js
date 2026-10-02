import PieGame from '../../../sdk/pie-game-sdk.js';

function applyTheme(theme) {
  document.documentElement.dataset.theme = (theme === 'studio' || theme === 'classic') ? theme : 'playful';
}

const coin = document.getElementById('coin');
const statusEl = document.getElementById('status');
let choice = 'heads';

function setChoice(id) {
  choice = id;
  PieGame.coin.select(id);
  document.querySelectorAll('[data-choice]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-choice') === id);
  });
}

document.querySelectorAll('[data-choice]').forEach((btn) => {
  btn.addEventListener('click', () => setChoice(btn.getAttribute('data-choice')));
});
coin.addEventListener('click', () => setChoice(choice === 'heads' ? 'tails' : 'heads'));

function faceOf(result) {
  const display = result.display;
  if (display && typeof display === 'object' && display.face) return display.face;
  if (Array.isArray(display) && display[0] && display[0].face) return display[0].face;
  return choice === 'heads' ? 'tails' : 'heads';
}

PieGame.coin.onResult((result) => {
  const face = faceOf(result) === 'tails' ? 'tails' : 'heads';
  coin.classList.remove('flip', 'to-tails', 'show-tails');
  void coin.offsetWidth;
  if (face === 'tails') coin.classList.add('to-tails');
  coin.classList.add('flip');
  window.setTimeout(() => {
    coin.classList.remove('flip', 'to-tails');
    coin.classList.toggle('show-tails', face === 'tails');
    const win = Number(result.net) > 0;
    statusEl.className = win ? 'win' : 'lose';
    const label = face === 'heads' ? '正面' : '反面';
    statusEl.textContent = `${label}朝上 · 押 ${result.bet} · 得 ${result.payout} · 淨 ${result.net}`;
  }, 900);
});

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme(applyTheme);
setChoice('heads');
PieGame.setHeight(document.documentElement.scrollHeight);
