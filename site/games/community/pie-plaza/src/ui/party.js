// 廣場搶寶面板：報名、看分數、提示走到箱子旁邊按 E。
import { openPanel, attachCountdown, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view() → Promise<{party, gold}>, join(), grab(spot), leave() }
 */
export function openParty(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const spots = el('div', 'market-view');
  const partyLive = (p, now = Date.now()) => `開搶了！走到木箱、麻袋、竹籃旁邊按 E 拿走。還有 ${liveLeftSeconds(p, now)} 秒。`;
  const cd = attachCountdown(status, '開搶，還可以加入。', partyLive);
  const body = openPanel('廣場搶寶', () => cd.stop());
  body.append(gold, status, msg, actions, people, spots);

  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.party || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人上車。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開搶，還可以加入。`;
    } else if (p.status === 'live') status.textContent = partyLive(p);
    else status.textContent = '這一輪結束。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了搶寶'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    join.disabled = p.status === 'live' || (p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    actions.append(join, leave);
    people.textContent = '';
    const h = el('h3', null, '這一輪');
    people.append(h);
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}　${pl.score} 件${pay}`));
      people.append(row);
    }
    spots.textContent = '';
    spots.append(el('h3', null, '寶點'));
    for (const s of p.spots || []) {
      const row = el('div', 'shop-row');
      const info = el('span');
      info.append(atlasIcon(s.k, 28), document.createTextNode(` ${s.name}${s.takenBy ? '　已被拿走' : ''}`));
      row.append(info);
      const grab = btn('搶', async () => {
        grab.disabled = true;
        try { paint(await api.grab(s.id)); say(`搶到 ${s.name}`); } catch (e) { say(e.msg || '搶不到', true); grab.disabled = false; }
      });
      grab.disabled = p.status !== 'live' || !!s.takenBy;
      row.append(grab);
      spots.append(row);
    }
    if (p.status === 'over' && p.payout) say(`你拿到 ${p.payout} G`);
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; say(e.msg || '暫時連不上', true); }
  })();
}
