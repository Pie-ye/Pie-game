// 圖集物件 → DOM 小圖（CSS 背景裁切，像素放大）。
import { ATLAS } from '../engine/atlas.js';
import { assetUrl } from '../engine/sprites.js';

const sizes = new Map();
function sheetSize(sheet) {
  if (!sizes.has(sheet)) sizes.set(sheet, new Promise((res) => { const im = new Image(); im.onload = () => res([im.width, im.height]); im.src = assetUrl(sheet); }));
  return sizes.get(sheet);
}
/** k 是圖集名稱；max 是最大邊長（CSS px），會用整數倍放大。 */
export function atlasIcon(k, max = 32) {
  const i = document.createElement('i');
  const a = ATLAS[k];
  if (!a) return i;
  const [sheet, x, y, w, h] = a;
  const s = Math.max(1, Math.floor(max / Math.max(w, h)));
  i.style.width = `${w * s}px`; i.style.height = `${h * s}px`;
  i.style.backgroundImage = `url("${assetUrl(sheet)}")`;
  i.style.backgroundPosition = `${-x * s}px ${-y * s}px`;
  sheetSize(sheet).then(([sw, sh]) => { i.style.backgroundSize = `${sw * s}px ${sh * s}px`; });
  return i;
}
