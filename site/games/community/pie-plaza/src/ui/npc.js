// 鎮民互動面板：好感心數、送禮、原本的功能（買種子、改小屋……），以及瑪莉的烤派面板。
import { openPanel, closePanel } from './panels.js';
import { atlasIcon } from './icon.js';
import { itemName } from '../social/home.js';
import { FRIENDS, tasteOf } from '../game/friends.js';
import { PIES } from '../farm/state.js';
import { itemIcon } from './market.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const EFFECT = { pie_strawberry: '派對裡：餵食值、得分 ×2', pie_pumpkin: '派對裡：命中範圍 ×1.8', pie_tomato: '派對裡：一次扇形丟三個', pie_carrot: '派對裡：飛得更快更遠', pie_beet: '派對裡：蛙會張大嘴；對手暈更久' };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

export const heartsText = (h) => `${'♥'.repeat(h)}${'♡'.repeat(Math.max(0, 10 - h))}`;

/**
 * id：好感鍵；fv：伺服器 friends view 裡這位的 { hearts, p, today }；inv：背包；
 * actions：[{ label, fn }]（原本的功能）；gift(item) → Promise<回覆>（失敗丟 err.msg）。
 */
export function openNpcMenu(id, fv, inv, actions, gift) {
  const f = FRIENDS[id];
  const body = openPanel(f.name);
  const paint = (v, msgText) => {
    body.replaceChildren();
    const hearts = el('p', 'hearts', heartsText(v.hearts));
    hearts.title = `${v.hearts} 顆心（下一顆 ${v.p}/100）`;
    body.append(hearts);
    const bar = el('span', 'qbar'); const fill = el('i'); fill.style.width = `${v.hearts >= 10 ? 100 : v.p}%`; bar.append(fill); body.append(bar);
    if (actions.length) {
      const row = el('div', 'menu-btns');
      for (const a of actions) row.append(btn(a.label, () => { closePanel(); a.fn(); }));
      body.append(row);
    }
    body.append(el('h3', null, '🎁 送禮'));
    if (v.today) body.append(el('p', 'note', `今天已經送過${f.name}了，明天再來。`));
    body.append(el('p', 'note', v.hearts >= 2 ? `${f.name}最喜歡：${f.loves.map(itemName).join('、')}；也喜歡：${f.likes.map(itemName).join('、')}。` : '多送幾次就會知道他喜歡什麼。到 2、4、6、8、10 心會回禮。'));
    const msg = el('p', 'note', msgText || '');
    const grid = el('div', 'grid-items gifts');
    const items = Object.entries(inv()).filter(([, n]) => n > 0)
      .sort(([a], [b]) => (v.hearts >= 2 ? ['love', 'like', 'ok'].indexOf(tasteOf(id, a)) - ['love', 'like', 'ok'].indexOf(tasteOf(id, b)) : 0) || (PIES[b] ? 1 : 0) - (PIES[a] ? 1 : 0));
    if (!items.length) grid.append(el('p', 'note', '背包是空的。'));
    for (const [k, n] of items) {
      const b = el('button'); b.type = 'button'; b.disabled = v.today;
      b.append(atlasIcon(itemIcon(k), 28), el('span', null, `${itemName(k)} ×${n}`));
      if (v.hearts >= 2 && tasteOf(id, k) === 'love') b.classList.add('loved');
      b.addEventListener('click', async () => {
        try { const r = await gift(k); paint(r.friends[id], r.message); } catch (e) { msg.textContent = e.msg || '送不出去'; }
      });
      grid.append(b);
    }
    body.append(grid, msg);
  };
  paint(fv);
}

/** 瑪莉的烤派面板。inv() 背包；bake(pie, n) → Promise<回覆>。 */
export function openBake(inv, bake) {
  const body = openPanel('瑪莉麵包店・烤派');
  const paint = (msgText) => {
    body.replaceChildren();
    body.append(el('p', 'note', '用自己種的作物烤派：比直接賣原料值錢，也是送鎮民最好的禮物。'));
    const msg = el('p', 'note', msgText || '');
    for (const [k, p] of Object.entries(PIES)) {
      const have = inv();
      const can = Math.min(...Object.entries(p.need).map(([i, n]) => Math.floor((have[i] || 0) / n)));
      const card = el('div', `event quest${can ? '' : ' past'}`);
      const head = el('b'); head.append(atlasIcon(itemIcon(k), 20), document.createTextNode(` ${p.name}`));
      card.append(head, el('span', 'tag', `賣 ${p.sell} G`));
      card.append(el('p', null, Object.entries(p.need).map(([i, n]) => `${itemName(i)} ${have[i] || 0}/${n}`).join('　')));
      card.append(el('p', 'note', `${EFFECT[k] || ''}（大胃王蛙、派餅大戰按 Q 選來丟）`));
      if (can) {
        const row = el('div', 'menu-btns');
        for (const n of [...new Set([1, can])]) row.append(btn(n === 1 ? '烤 1 個' : `全部烤（${n}）`, async () => {
          try { const r = await bake(k, n); paint(`烤好了 ${p.name} ×${r.baked}！`); } catch (e) { paint(e.msg || '烤不了'); }
        }));
        card.append(row);
      }
      body.append(card);
    }
    body.append(msg);
  };
  paint();
}
