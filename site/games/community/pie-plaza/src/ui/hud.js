// 遊戲內介面：工具列、背包、時鐘、提示。
import { TOOLS, TOOL_NAMES, ITEM_NAMES } from '../farm/state.js';
import { assetUrl } from '../engine/sprites.js';
import { atlasIcon } from './icon.js';
import { fishName } from '../fish/fishing.js';

const ICON = { axe: 'ninja/tools/axe.png', pickaxe: 'ninja/tools/pickaxe.png', sickle: 'ninja/tools/sickle.png', hoe: 'ninja/tools/hoe.png', wateringcan: 'ninja/tools/wateringcan.png', hammer: 'ninja/tools/hammer.png', rod: 'gen/rod.png' };
const ATLAS_ICON = { seed: 'wheatSeed' };
const itemIcon = (k) => (k.startsWith('fish_') ? `fish${k.slice(5)[0].toUpperCase()}${k.slice(6)}` : { wood: 'log', stone: 'rockSmall', fiber: 'weedA' }[k] || `${k}Item`);
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const SEASON = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];

export function createHud({ onSelect }) {
  const bar = document.getElementById('toolbar'), inv = document.getElementById('inv'), toastEl = document.getElementById('toast');
  const buttons = TOOLS.map((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = `${i + 1}. ${TOOL_NAMES[t]}`; b.setAttribute('aria-label', TOOL_NAMES[t]);
    const n = document.createElement('small'); n.textContent = String(i + 1);
    let icon;
    if (ICON[t]) { icon = document.createElement('img'); icon.src = assetUrl(ICON[t]); icon.alt = ''; } else icon = atlasIcon(ATLAS_ICON[t], 32);
    b.append(icon, n);
    b.addEventListener('click', () => onSelect(i));
    bar.append(b);
    return b;
  });
  let toastTimer = null;
  return {
    select(i) { buttons.forEach((b, j) => b.classList.toggle('on', i === j)); },
    /** 依所在區域決定哪些工具可用。 */
    enable(fn) { TOOLS.forEach((t, i) => { buttons[i].disabled = !fn(t); }); },
    inventory(items) {
      inv.textContent = '';
      for (const [k, n] of Object.entries(items || {})) {
        if (!n) continue;
        const s = document.createElement('span'); s.title = ITEM_NAMES[k] || fishName(k.slice(5));
        s.append(atlasIcon(itemIcon(k), 16), document.createTextNode(`${n}`)); inv.append(s);
      }
    },
    clock(d = new Date()) {
      document.getElementById('clock-day').textContent = `${SEASON[d.getMonth()]} ${d.getDate()} 日（${WEEK[d.getDay()]}）`;
      const h = d.getHours(), m = Math.floor(d.getMinutes() / 10) * 10;
      document.getElementById('clock-time').textContent = `${h < 12 ? '上午' : '下午'} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
    },
    /** 第 7 格顯示目前選的種子與數量。 */
    seed(k, n) {
      const b = buttons[TOOLS.indexOf('seed')];
      const old = b.querySelector('i'); if (old) old.replaceWith(atlasIcon(`${k}Seed`, 32));
      let c = b.querySelector('em'); if (!c) { c = document.createElement('em'); c.className = 'count'; b.append(c); }
      c.textContent = n ? String(n) : '0';
    },
    gold(n) { document.getElementById('gold').textContent = `${n.toLocaleString()} G`; },
    badge(text) { const e = document.getElementById('event-badge'); e.hidden = !text; e.textContent = text || ''; },
    toast(text, ms = 1600) {
      if (!text) return;
      toastEl.textContent = text; toastEl.classList.add('on');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
    },
  };
}
