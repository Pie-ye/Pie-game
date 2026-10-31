// 營火捉迷藏面板：報名、藏、當尋人去檢查。
import { openPanel, attachCountdown, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), hide(spot), check(spot) }
 */
export function openSeek(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const spots = el('div', 'market-view');
  const seekLive = (p, now = Date.now()) => {
    const me = (p.players || []).find((x) => x.id === p.you);
    const left = `還有 ${liveLeftSeconds(p, now)} 秒。`;
    return (me && me.seeker ? '你是尋人！走到圓木、樹、石頭旁邊按 E 檢查。' : '藏進圓木、樹或石頭，尋人靠近按 E 會抓到你。') + left;
  };
  const cd = attachCountdown(status, '開始。', seekLive);
  const body = openPanel('營火捉迷藏', () => cd.stop());
  body.append(gold, status, msg, actions, people, spots);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.seek || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。只有你一個？等 12 秒，鎮民會來湊人數。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開始。`;
    } else if (p.status === 'live') status.textContent = seekLive(p);
    else status.textContent = '這一輪結束。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了捉迷藏'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    join.disabled = p.status === 'live' || !!(p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    actions.append(join, leave);
    people.textContent = '';
    people.append(el('h3', null, '這一輪'));
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const role = pl.seeker ? '尋人' : pl.hidden ? '藏好了' : '還沒藏';
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}　${role}${pay}`));
      people.append(row);
    }
    spots.textContent = '';
    spots.append(el('h3', null, '藏點'));
    const youSeeker = me && me.seeker;
    for (const s of p.spots || []) {
      const row = el('div', 'shop-row');
      const info = el('span');
      info.append(atlasIcon(s.k, 28), document.createTextNode(` ${s.name}${s.takenBy ? '　有人' : ''}`));
      row.append(info);
      const act = btn(youSeeker ? '檢查' : '藏', async () => {
        act.disabled = true;
        try {
          paint(youSeeker ? await api.check(s.id) : await api.hide(s.id));
          say(youSeeker ? '檢查了' : `藏進 ${s.name}`);
        } catch (e) { say(e.msg || '做不到', true); act.disabled = false; }
      });
      act.disabled = p.status !== 'live' || (!youSeeker && (!!s.takenBy || (me && me.hidden)));
      row.append(act);
      spots.append(row);
    }
    if (p.status === 'over' && p.payout) say(`你拿到 ${p.payout} G`);
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; say(e.msg || '暫時連不上', true); }
  })();
}
