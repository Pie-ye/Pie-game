/**
 * 一般遊戲範本：只跟外框握手，自己畫畫面。
 * 直接用瀏覽器開這個檔案會進入「獨立模式」（user = null）。
 */
import PieGame from '../../../sdk/pie-game-sdk.js';

const title = document.getElementById('title');
const hello = document.getElementById('hello');

function applyTheme(theme) {
  document.documentElement.dataset.theme = (theme === 'studio' || theme === 'classic') ? theme : 'playful';
}

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme(applyTheme);
PieGame.setHeight(document.documentElement.scrollHeight);

title.textContent = init.gameId;
const who = init.user && init.user.displayName ? init.user.displayName : '訪客';
hello.textContent = `你好，${who}。把遊戲邏輯寫在這裡。`;
