// 捏臉畫面：左邊大預覽（會走路、轉向），右邊選臉型與四組顏色。
import { BODIES } from '../engine/bodies.js';
import { FIELDS, randomLook, hslToRgb } from '../avatar/look.js';
import { lookSheet } from '../engine/sprites.js';

let root = null;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/** open(scene, look, onDone)：look 會被複製；按「完成」才回傳。 */
export function openCreator(scene, look, onDone, { first = false } = {}) {
  if (root) root.remove();
  let cur = look.slice();
  root = el('div', 'creator');
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '捏臉');
  const card = el('div', 'creator-card wood-box');
  const head = el('div', 'creator-head');
  head.append(el('b', null, first ? '歡迎來到派派鎮！先捏一個自己吧' : '捏臉'));
  const left = el('div', 'creator-left'), right = el('div', 'creator-right');
  const pv = el('canvas', 'creator-preview'); pv.width = 160; pv.height = 160;
  left.append(pv);
  const btns = el('div', 'creator-btns');
  const rnd = el('button', null, '隨機'); rnd.type = 'button';
  const done = el('button', 'primary', '完成'); done.type = 'button';
  btns.append(rnd, done); left.append(btns);

  // 臉型：每個底版畫一張正面小圖（套用目前顏色）
  const faces = el('div', 'creator-faces');
  const faceBtns = BODIES.map((b, i) => {
    const bt = el('button'); bt.type = 'button'; bt.title = b.name; bt.setAttribute('aria-label', b.name);
    const c = el('canvas'); c.width = 48; c.height = 48; bt.append(c, el('small', null, b.name));
    bt.addEventListener('click', () => { cur[0] = i; refresh(); });
    faces.append(bt); return { bt, c };
  });
  right.append(el('h3', null, '臉型與髮型'), faces);
  const rows = FIELDS.slice(1).map((f, j) => {
    const i = j + 1, row = el('div', 'swatches');
    const bs = f.colors.map((col, k) => {
      const b = el('button'); b.type = 'button'; b.title = f.names[k]; b.setAttribute('aria-label', `${f.name}：${f.names[k]}`);
      if (col) { const [r, g, bl] = hslToRgb(col); b.style.background = `rgb(${r},${g},${bl})`; } else b.classList.add('orig');
      b.addEventListener('click', () => { cur[i] = k; refresh(); });
      row.append(b); return b;
    });
    right.append(el('h3', null, f.name), row);
    return bs;
  });
  card.append(head, el('div', 'creator-body'));
  card.lastChild.append(left, right);
  root.append(card);
  document.querySelector('.frame').append(root);

  function refresh() {
    faceBtns.forEach(({ bt, c }, i) => {
      bt.classList.toggle('on', i === cur[0]);
      const sh = lookSheet(scene, [i, ...cur.slice(1)]), x = c.getContext('2d');
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, 48, 48);
      if (sh) x.drawImage(sh, 0, 0, 16, 16, 0, 0, 48, 48);
    });
    rows.forEach((bs, j) => bs.forEach((b, k) => b.classList.toggle('on', cur[j + 1] === k)));
  }
  let raf = 0;
  const t0 = performance.now();
  function tick(now) {
    const x = pv.getContext('2d'), sh = lookSheet(scene, cur);
    x.imageSmoothingEnabled = false; x.clearRect(0, 0, 160, 160);
    x.fillStyle = 'rgba(60,40,20,.25)'; x.beginPath(); x.ellipse(80, 148, 44, 10, 0, 0, 7); x.fill();
    const dir = [0, 3, 1, 2][Math.floor((now - t0) / 1600) % 4], f = Math.floor(now / 140) % 4;
    if (sh) x.drawImage(sh, dir * 16, f * 16, 16, 16, 8, 8, 144, 144);
    raf = requestAnimationFrame(tick);
  }
  rnd.addEventListener('click', () => { cur = randomLook(); refresh(); });
  done.addEventListener('click', () => { cancelAnimationFrame(raf); root.remove(); root = null; onDone(cur); });
  refresh(); raf = requestAnimationFrame(tick);
}
export const creatorOpen = () => !!root;
