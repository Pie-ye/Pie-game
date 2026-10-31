// 全鎮工程面板：這一期要什麼、大家捐了多少、我能捐什麼、貢獻排行與已完成的工程。
import { openPanel } from './panels.js';
import { itemName } from '../social/home.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn) => { const b = el('button', null, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/** 背包裡能拿去捐某一格需求的東西：[{ item, have }]。fish 這一格吃任何魚。 */
export function donatable(key, inv, gold) {
  if (key === 'gold') return gold > 0 ? [{ item: 'gold', have: gold }] : [];
  if (key === 'pie') return Object.entries(inv || {}).filter(([k, n]) => k.startsWith('pie_') && n > 0).map(([item, have]) => ({ item, have }));
  if (key === 'fish') return Object.entries(inv || {}).filter(([k, n]) => k.startsWith('fish_') && n > 0).map(([item, have]) => ({ item, have }));
  return (inv || {})[key] > 0 ? [{ item: key, have: inv[key] }] : [];
}

/** data：伺服器 town view 回覆；api：{ inv(), gold(), donate(item, n) → 新回覆 }。 */
export function openTown(data, api) {
  const body = openPanel('派派新區建設');
  const paint = (d) => {
    body.replaceChildren();
    const v = d.view;
    if (v.done.length) {
      body.append(el('h3', null, '🏗️ 已完成'));
      for (const p of v.done) body.append(el('p', 'note', `✅ ${p.name}：${p.effect}`));
    }
    if (!v.cur) { body.append(el('p', null, v.weekly ? '本週的嘉年華已經辦起來了！派對獎金 +25%、出貨 +10% 到週日。下週一再一起籌備。' : '所有工程都蓋好了！下一期敬請期待。')); return; }
    if (v.weekly) body.append(el('p', 'note', '每週一期：這週籌備好，全鎮到週日都有派對獎金 +25%、出貨 +10%。'));
    const c = v.cur;
    body.append(el('h3', null, `🚧 施工中：${c.name}`), el('p', 'note', `蓋好以後：${c.effect}。完工時每位出過力的人拿回饋金（貢獻點的 15%）。`));
    const msg = el('p', 'note');
    for (const n of c.need) {
      const card = el('div', `event quest${n.got >= n.need ? ' past' : ''}`);
      card.append(el('b', null, `${n.got >= n.need ? '✅' : '📦'} ${n.name}`), el('span', 'tag', `${n.got} / ${n.need}`));
      const bar = el('span', 'qbar'); const f = el('i'); f.style.width = `${Math.round(Math.min(1, n.got / n.need) * 100)}%`; bar.append(f); card.append(bar);
      if (n.got < n.need) {
        const opts = donatable(n.k, api.inv(), api.gold());
        if (!opts.length) card.append(el('p', null, n.k === 'gold' ? '你沒有金幣。' : '背包裡沒有。'));
        for (const o of opts) {
          const row = el('div', 'menu-btns');
          const left = n.need - n.got;
          const label = o.item === 'gold' ? '金幣' : itemName(o.item);
          const amounts = o.item === 'gold' ? [10, 100, Math.min(o.have, left)] : [1, Math.min(o.have, left)];
          for (const a of [...new Set(amounts)].filter((x) => x > 0 && x <= o.have)) {
            row.append(btn(`捐 ${label} ×${a}`, async () => {
              try { const r = await api.donate(o.item, a); msg.textContent = `謝謝！捐了 ${label} ×${r.took}，貢獻 +${r.points}`; paint(r); } catch (e) { msg.textContent = e.msg || '捐不了'; }
            }));
          }
          card.append(row);
        }
      }
      body.append(card);
    }
    body.append(msg);
    body.append(el('h3', null, `🏅 貢獻排行（你：${c.mine} 點）`));
    if (!c.top.length) body.append(el('p', 'note', '還沒有人捐，當第一個吧！'));
    const ol = el('ol', 'note');
    for (const [name, pts] of c.top) ol.append(el('li', null, `${name}　${pts} 點`));
    body.append(ol);
    if (c.log.length) body.append(el('p', 'note', `最近：${c.log.slice(-4).reverse().map((l) => `${l[0]} 捐了 ${l[1] === 'gold' ? '金幣' : l[1] === 'fish' ? '魚' : itemName(l[1])} ×${l[2]}`).join('、')}`));
    if (v.next.length) body.append(el('p', 'note', `下一期：${v.next.map((p) => p.name).join('、')}`));
  };
  paint(data);
}
