/**
 * 金幣遊戲範本：不能自己呼叫下注 API。
 * PieGame.coin.select 只改外框選項；真正下注由外框按鈕送出。
 */
import PieGame from '../../../sdk/pie-game-sdk.js';

function applyTheme(theme) {
  document.documentElement.dataset.theme = (theme === 'studio' || theme === 'classic') ? theme : 'playful';
}

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme(applyTheme);
PieGame.setHeight(document.documentElement.scrollHeight);

document.getElementById('pick').addEventListener('click', () => {
  PieGame.coin.select('play');
});

PieGame.coin.onResult((result) => {
  const el = document.getElementById('result');
  const face = result.display && result.display.result ? result.display.result : (result.outcome && result.outcome.label);
  el.textContent = `結果：${face || ''}　押 ${result.bet}　得 ${result.payout}　淨 ${result.net}`;
});
