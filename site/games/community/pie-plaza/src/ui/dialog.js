// 對話框：頭像、名字、逐字顯示；點擊或按 E／空白／Enter 下一句。
import { assetUrl } from '../engine/sprites.js';

export function createDialog() {
  const box = document.getElementById('dialog'), face = document.getElementById('dialog-face');
  const nameEl = document.getElementById('dialog-name'), textEl = document.getElementById('dialog-text');
  let lines = [], idx = 0, shown = 0, timer = null, onDone = null;
  const full = () => Array.from(lines[idx] || '');
  function type() {
    clearInterval(timer);
    shown = 0; textEl.textContent = '';
    const chars = full();
    timer = setInterval(() => { shown++; textEl.textContent = chars.slice(0, shown).join(''); if (shown >= chars.length) clearInterval(timer); }, 28);
  }
  function close() { clearInterval(timer); box.hidden = true; const cb = onDone; onDone = null; if (cb) cb(); }
  function next() {
    if (box.hidden) return;
    if (shown < full().length) { clearInterval(timer); shown = full().length; textEl.textContent = full().join(''); return; }
    idx++;
    if (idx >= lines.length) close(); else type();
  }
  box.addEventListener('click', next);
  return {
    get open() { return !box.hidden; },
    /** who：{ name, sprite?（有頭像）}；lines：字串陣列。 */
    show(who, ls, done) {
      lines = ls; idx = 0; onDone = done || null;
      nameEl.textContent = who.name;
      if (who.sprite) { face.src = assetUrl(`ninja/npc/${who.sprite}_face.png`); face.parentElement.hidden = false; }
      else face.parentElement.hidden = true;
      box.hidden = false; type();
    },
    next, close,
  };
}
