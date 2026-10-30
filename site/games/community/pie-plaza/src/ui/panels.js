// 右側面板：小屋外觀選擇、室內裝潢（家具、地板、牆紙）。
import { FURNITURE, FLOORS, WALLS, HOUSE_STYLES } from '../house/catalog.js';
import { atlasIcon } from './icon.js';

const panel = () => document.getElementById('panel');
let onClose = null;
document.getElementById('panel-close').addEventListener('click', () => closePanel());
export function closePanel() { panel().hidden = true; const cb = onClose; onClose = null; if (cb) cb(); }
export const panelOpen = () => !panel().hidden;

function open(title, close) {
  document.getElementById('panel-title').textContent = title;
  const body = document.getElementById('panel-body'); body.textContent = '';
  panel().hidden = false; onClose = close || null;
  return body;
}
function chips(body, title, options, current, pick) {
  const h = document.createElement('h3'); h.textContent = title; body.append(h);
  const box = document.createElement('div'); box.className = 'chips';
  for (const [k, name] of Object.entries(options)) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.classList.toggle('on', k === current);
    b.addEventListener('click', () => { box.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); pick(k); });
    box.append(b);
  }
  body.append(box);
}

/** 小屋外觀：五種樣式。 */
export function openHouseStyles(current, pick, close) {
  const body = open('小屋設計', close);
  const list = document.createElement('div'); list.className = 'styles';
  for (const [k, name] of Object.entries(HOUSE_STYLES)) {
    const b = document.createElement('button'); b.type = 'button'; b.classList.toggle('on', k === current);
    const span = document.createElement('span'); span.textContent = name;
    b.append(atlasIcon(k, 80), span);
    b.addEventListener('click', () => { list.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); pick(k); });
    list.append(b);
  }
  body.append(list);
}

/** 室內裝潢：選家具後點地板擺放；「拿起」模式點家具收回。 */
export function openDecor(decor, { pickItem, pickFloor, pickWall }, close) {
  const body = open('裝潢模式', close);
  const tip = document.createElement('p'); tip.textContent = '選一件家具，再點房間擺放。選「拿起」後點家具可以收回。按 Esc 結束。'; body.append(tip);
  chips(body, '地板', FLOORS, decor.floor, pickFloor);
  chips(body, '牆紙', WALLS, decor.wall, pickWall);
  const h = document.createElement('h3'); h.textContent = '家具'; body.append(h);
  const grid = document.createElement('div'); grid.className = 'grid-items';
  const mk = (k, name, icon) => {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.k = k;
    const s = document.createElement('span'); s.textContent = name;
    b.append(icon, s);
    b.addEventListener('click', () => { grid.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); pickItem(k); });
    grid.append(b);
    return b;
  };
  const take = mk('remove', '拿起', (() => { const i = document.createElement('i'); i.textContent = '✋'; i.style.fontSize = '22px'; i.style.lineHeight = '32px'; return i; })());
  for (const f of FURNITURE) mk(f.k, f.name, atlasIcon(f.k, 32));
  take.classList.add('on'); pickItem('remove');
  body.append(grid);
}
