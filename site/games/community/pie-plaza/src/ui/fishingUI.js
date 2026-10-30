// 釣魚小遊戲畫面：直槽（魚與綠色捕捉條）＋右側進度條。按住空白鍵或滑鼠讓捕捉條上升。
import { assetUrl } from '../engine/sprites.js';

let box = null, cv = null;
const fishImg = new Image();
export function showFishing() {
  if (!box) {
    box = document.createElement('div'); box.className = 'fishing wood-box';
    cv = document.createElement('canvas'); cv.width = 64; cv.height = 240;
    const tip = document.createElement('p'); tip.textContent = '按住空白鍵／滑鼠';
    box.append(cv, tip);
    document.querySelector('.frame').append(box);
    fishImg.src = assetUrl('gen/fish_carp.png');
  }
  box.hidden = false;
}
export function hideFishing() { if (box) box.hidden = true; }
/** g：stepMinigame 的狀態。 */
export function drawFishing(g) {
  if (!cv) return;
  const x = cv.getContext('2d'), H = 220, top = 10, slotX = 8, slotW = 32;
  x.imageSmoothingEnabled = false;
  x.clearRect(0, 0, cv.width, cv.height);
  x.fillStyle = '#2e5f86'; x.fillRect(slotX, top, slotW, H);
  x.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < H; i += 12) x.fillRect(slotX, top + i, slotW, 5);
  const y = (v) => top + H - v * H;
  x.fillStyle = 'rgba(120,230,90,.75)'; x.fillRect(slotX + 2, y(g.bar + g.size), slotW - 4, g.size * H);
  x.strokeStyle = '#d8ffbf'; x.lineWidth = 2; x.strokeRect(slotX + 2, y(g.bar + g.size), slotW - 4, g.size * H);
  const fy = y(g.fish) - 8;
  if (fishImg.complete && fishImg.naturalWidth) x.drawImage(fishImg, slotX + 8, fy, 16, 16);
  else { x.fillStyle = '#ffb347'; x.fillRect(slotX + 10, fy + 4, 12, 8); }
  // 進度條
  x.fillStyle = '#4a2c12'; x.fillRect(48, top, 10, H);
  x.fillStyle = g.progress > 0.66 ? '#6ad04a' : g.progress > 0.33 ? '#f2c94c' : '#e8603c';
  x.fillRect(49, y(g.progress), 8, g.progress * H);
}
