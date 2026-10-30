// 右側面板：小屋外觀選擇、室內裝潢（家具、地板、牆紙）。
import { FURNITURE, FLOORS, WALLS, HOUSE_STYLES } from '../house/catalog.js';
import { ROOF, ROOF_NAMES, WALL, WALL_NAMES, YARD, YARD_NAMES } from '../house/exterior.js';
import { CROPS } from '../farm/state.js';
import { todaySchedule, dayLabel, hhmm } from '../events/schedule.js';
import { hslToRgb } from '../avatar/look.js';
import { atlasIcon } from './icon.js';

const panel = () => document.getElementById('panel');
let onClose = null;
document.getElementById('panel-close').addEventListener('click', () => closePanel());
export function closePanel() { panel().hidden = true; const cb = onClose; onClose = null; if (cb) cb(); }
export const panelOpen = () => !panel().hidden;

export function openPanel(title, close) { return open(title, close); }
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

function swatches(body, title, colors, names, current, pick, fallbackL = 0.5) {
  const h = document.createElement('h3'); h.textContent = title; body.append(h);
  const row = document.createElement('div'); row.className = 'swatches';
  colors.forEach((c, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.title = names[i]; b.setAttribute('aria-label', `${title}：${names[i]}`);
    if (c) { const [r, g, bl] = hslToRgb([c[0], c[1], c[2] != null ? c[2] : fallbackL]); b.style.background = `rgb(${r},${g},${bl})`; } else b.classList.add('orig');
    b.classList.toggle('on', i === current);
    b.addEventListener('click', () => { row.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); pick(i); });
    row.append(b);
  });
  body.append(row);
}

/** 小屋設計：樣式、屋頂色、牆面色、院子四格。change(patch) 每次改動都會呼叫。 */
export function openHouseDesign(decor, change, close) {
  const body = open('小屋設計', close);
  const list = document.createElement('div'); list.className = 'styles compact';
  for (const [k, name] of Object.entries(HOUSE_STYLES)) {
    const b = document.createElement('button'); b.type = 'button'; b.classList.toggle('on', k === decor.style);
    const span = document.createElement('span'); span.textContent = name;
    b.append(atlasIcon(k, 56), span);
    b.addEventListener('click', () => { list.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); change({ style: k }); });
    list.append(b);
  }
  const h = document.createElement('h3'); h.textContent = '樣式'; body.append(h, list);
  swatches(body, '屋頂', ROOF, ROOF_NAMES, decor.ext.roof, (i) => change({ roof: i }));
  swatches(body, '牆面', WALL, WALL_NAMES, decor.ext.wall, (i) => change({ wall: i }));
  const yh = document.createElement('h3'); yh.textContent = '門前院子（左遠、左、右、右遠）'; body.append(yh);
  const slots = document.createElement('div'); slots.className = 'yard';
  decor.ext.yard.forEach((v, slot) => {
    const sel = document.createElement('select'); sel.setAttribute('aria-label', `院子第 ${slot + 1} 格`);
    YARD.forEach((k, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = YARD_NAMES[i]; o.selected = i === v; sel.append(o); });
    sel.addEventListener('change', () => change({ yard: [slot, Number(sel.value)] }));
    slots.append(sel);
  });
  body.append(slots);
}
/** 舊名稱相容 */
export const openHouseStyles = (current, pick, close) => openHouseDesign({ style: current, ext: { roof: 0, wall: 0, yard: [0, 0, 0, 0] } }, (p) => p.style && pick(p.style), close);

/** 雜貨店：買種子。buy(k, n) 回傳 { ok, msg }；gold() 取目前金幣。discount 是折扣倍數。 */
export function openSeedShop(title, gold, buy, discount = 1, close) {
  const body = open(title, close);
  const g = document.createElement('p'); g.className = 'gold-line';
  const paint = () => { g.textContent = `你的金幣：${gold()} G`; };
  paint(); body.append(g);
  if (discount < 1) { const d = document.createElement('p'); d.className = 'sale'; d.textContent = '早市特價：種子八折！'; body.append(d); }
  for (const [k, c] of Object.entries(CROPS)) {
    const row = document.createElement('div'); row.className = 'shop-row';
    const price = Math.ceil(c.seed * discount);
    const info = document.createElement('span'); info.innerHTML = '';
    info.append(atlasIcon(`${k}Seed`, 32), document.createTextNode(` ${c.name}種子 ${price} G`));
    const tip = document.createElement('small'); tip.textContent = `成品 ${c.sell} G`;
    const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = '買 1';
    const b5 = document.createElement('button'); b5.type = 'button'; b5.textContent = '買 5';
    for (const [b, n] of [[b1, 1], [b5, 5]]) b.addEventListener('click', () => { buy(k, n, price); paint(); });
    row.append(info, tip, b1, b5); body.append(row);
  }
}

/** 公告欄：今天的活動表。 */
export function openEventBoard(ms, close) {
  const body = open('派派鎮公告欄', close);
  const d = document.createElement('p'); d.textContent = `今天是 ${dayLabel(ms)}（台北時間）`; body.append(d);
  const list = todaySchedule(ms);
  if (!list.length) { const p = document.createElement('p'); p.textContent = '今天沒有活動。'; body.append(p); }
  for (const { e, from, to, state } of list) {
    const card = document.createElement('div'); card.className = `event ${state}`;
    const h = document.createElement('b'); h.textContent = `${e.icon} ${e.name}　${hhmm(from)}–${hhmm(to)}`;
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = state === 'now' ? '進行中' : state === 'past' ? '已結束' : '稍後';
    const p = document.createElement('p'); p.textContent = `${e.desc}（地點：${e.area === 'town' ? '商店街' : '廣場'}）`;
    card.append(h, tag, p); body.append(card);
  }
  const all = document.createElement('p'); all.className = 'note'; all.textContent = '每天：早市 07–10、瑞吉海獅秀 10–11／15–16／19–20、釣魚大賽 12–13 與 18–19、營火晚會 20–23；週末另有花祭 09–21。';
  body.append(all);
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
