// 釣魚大賽記分板：時段內海釣的公分榜，時段結束發 G。
import { openPanel } from './panels.js';
import { atlasIcon } from './icon.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/**
 * api：{ view() → Promise<{contest, gold, payout}> }
 */
export function openContest(api) {
  const body = openPanel('釣魚大賽');
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const people = el('div', 'market-view');
  body.append(gold, status, msg, people);

  function paint(data) {
    const c = data.contest || data;
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    if (!c.active && c.status !== 'over') status.textContent = '每天 12–13、18–19（台北）在廣場海邊釣魚，釣到的公分會上榜。金色鯉魚分數加倍。';
    else if (c.status === 'open') status.textContent = `大賽進行中（${c.slot || ''}）。榜上 ${ (c.players || []).length } 人。`;
    else status.textContent = '這一場結束。等下一個時段再釣。';
    people.textContent = '';
    people.append(el('h3', null, '記分板'));
    const list = [...(c.players || [])].sort((a, b) => b.score - a.score);
    if (!list.length) people.append(el('p', 'note', '還沒有人上榜。面向大海拋竿吧。'));
    for (const pl of list) {
      const row = el('div', 'shop-row');
      const pay = c.payouts ? `　${c.payouts[pl.id] || 0} G` : '';
      row.append(atlasIcon('fishGolden', 28), el('span', null, ` ${pl.name}　${pl.n} 尾　${pl.score} 分${pay}`));
      people.append(row);
    }
    if (c.status === 'over' && c.payout) msg.textContent = `你拿到 ${c.payout} G`;
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; msg.textContent = e.msg || '暫時連不上'; msg.style.color = '#c0392b'; }
  })();
}
