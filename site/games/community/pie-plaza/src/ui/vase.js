// 廣場搶瓶面板：報名、把東岸花瓶搶給自己的隊。贏的隊 40／20／10 G。
import { openPanel, attachCountdown, liveLeftSeconds, liveTeamSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { VASE_JOIN } from '../game/vase.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const TEAM = { red: '紅隊', blue: '藍隊' };

/**
 * api：{ view(), join(), leave(), take() }
 */
export function openVase(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const vaseLive = (p, now = Date.now()) => {
    const me = (p.players || []).find((x) => x.id === p.you);
    const holder = (p.players || []).find((x) => x.id === p.holder);
    const ts = liveTeamSeconds(p, now);
    const left = liveLeftSeconds(p, now);
    const mine = me ? TEAM[me.team] || '' : '';
    const scoreBit = `紅 ${ts.red}　藍 ${ts.blue}。還有 ${left} 秒。`;
    if (me && me.holder) return `花瓶是${mine}的！守住，對手走近按 E 會搶走。${scoreBit}`;
    return `花瓶在${holder ? holder.name : '空著'}。你是${mine}，走到東岸花瓶按 E 搶過來。${scoreBit}`;
  };
  const cd = attachCountdown(status, '開始搶瓶。', vaseLive);
  const body = openPanel('廣場搶瓶', () => cd.stop());
  body.append(gold, status, msg, actions, people);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.vase || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開始搶瓶。`;
    } else if (p.status === 'live') status.textContent = vaseLive(p);
    else status.textContent = p.winner ? `${TEAM[p.winner] || ''}贏了。再按「加入」開下一輪。` : '這一輪平手。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了搶瓶'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    const take = btn('搶瓶', async () => {
      take.disabled = true;
      try { paint(await api.take()); say('你搶到花瓶了'); } catch (e) { say(e.msg || '搶不到', true); take.disabled = false; }
    });
    join.disabled = p.status === 'live' || !!(p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    take.disabled = p.status !== 'live' || !me || !!(me && me.holder);
    actions.append(join, leave, take);
    people.textContent = '';
    const h = el('h3', null, '這一輪');
    h.prepend(atlasIcon(VASE_JOIN.k, 28));
    people.append(h);
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const role = pl.holder ? '拿著' : (TEAM[pl.team] || '');
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
