// 傳南瓜面板：報名、搶南瓜。時間到手上有南瓜的人最後一名。
import { openPanel, attachCountdown, holdSeconds, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { HOT_JOIN } from '../game/hot.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), take() }
 */
export function openHot(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const hotLive = (p, now = Date.now()) => {
    const me = (p.players || []).find((x) => x.id === p.you);
    const holder = (p.players || []).find((x) => x.id === p.holder);
    const held = holdSeconds(p, now);
    const left = liveLeftSeconds(p, now);
    const holdBit = p.holder ? `已拿 ${held} 秒。` : '';
    if (me && me.holder) return `南瓜在你手上！${holdBit}還有 ${left} 秒。讓別人搶走，時間到你就是最後一名。`;
    return `南瓜在${holder ? holder.name : '別人'}手上。${holdBit}走到雞舍旁邊的南瓜按 E 搶過來。還有 ${left} 秒。`;
  };
  const cd = attachCountdown(status, '開始傳南瓜。', hotLive);
  const body = openPanel('傳南瓜', () => cd.stop());
  body.append(gold, status, msg, actions, people);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.hot || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開始傳南瓜。`;
    } else if (p.status === 'live') status.textContent = hotLive(p);
    else status.textContent = '這一輪結束。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了傳南瓜'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    const take = btn('搶南瓜', async () => {
      take.disabled = true;
      try { paint(await api.take()); say('你搶到南瓜了'); } catch (e) { say(e.msg || '搶不到', true); take.disabled = false; }
    });
    join.disabled = p.status === 'live' || !!(p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    take.disabled = p.status !== 'live' || !me || !!(me && me.holder);
    actions.append(join, leave, take);
    people.textContent = '';
    const h = el('h3', null, '這一輪');
    h.prepend(atlasIcon(HOT_JOIN.k, 28));
    people.append(h);
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const role = pl.holder ? '拿著南瓜' : '空手';
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}　${role}${pay}`));
      people.append(row);
    }
    if (p.status === 'over' && p.payout) say(`你拿到 ${p.payout} G`);
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; say(e.msg || '暫時連不上', true); }
  })();
}
