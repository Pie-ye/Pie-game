// 廣場搬寶面板：報名、從木桶扛起、送到大鍋放下。
import { openPanel, attachCountdown, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { HAUL_JOIN, HAUL_DROP } from '../game/haul.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), take(), drop() }
 */
export function openHaul(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const haulLive = (p, now = Date.now()) => {
    const me = (p.players || []).find((x) => x.id === p.you);
    const holder = (p.players || []).find((x) => x.id === p.holder);
    const left = `還有 ${liveLeftSeconds(p, now)} 秒。`;
    if (me && me.holder) return `寶物在你手上！跑到東北邊的大鍋按 E 放下得分。別人可以從西邊木桶搶走。${left}`;
    return `寶物在${holder ? holder.name : '木桶'}。走到西邊木桶按 E 扛起，再送到東北大鍋放下。${left}`;
  };
  const cd = attachCountdown(status, '開始搬寶。', haulLive);
  const body = openPanel('廣場搬寶', () => cd.stop());
  body.append(gold, status, msg, actions, people);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.haul || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    const holder = (p.players || []).find((x) => x.id === p.holder);
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開始搬寶。`;
    } else if (p.status === 'live') status.textContent = haulLive(p);
    else status.textContent = '這一輪結束。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了搬寶'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    const take = btn('扛起', async () => {
      take.disabled = true;
      try { paint(await api.take()); say('你扛起寶物了'); } catch (e) { say(e.msg || '扛不起', true); take.disabled = false; }
    });
    const drop = btn('放下', async () => {
      drop.disabled = true;
      try { paint(await api.drop()); say('送到大鍋了'); } catch (e) { say(e.msg || '放不下', true); drop.disabled = false; }
    });
    join.disabled = p.status === 'live' || !!(p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    take.disabled = p.status !== 'live' || !me || !!(me && me.holder);
    drop.disabled = p.status !== 'live' || !me || !(me && me.holder);
    actions.append(join, leave, take, drop);
    people.textContent = '';
    const h = el('h3', null, '這一輪');
    h.prepend(atlasIcon(HAUL_JOIN.k, 28), atlasIcon(HAUL_DROP.k, 28));
    people.append(h);
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const role = pl.holder ? '扛著' : '空手';
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}　${role}　${pl.score || 0} 件${pay}`));
      people.append(row);
    }
    if (p.status === 'over' && p.payout) say(`你拿到 ${p.payout} G`);
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; say(e.msg || '暫時連不上', true); }
  })();
}
