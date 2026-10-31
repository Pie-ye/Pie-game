// 廣場拔河面板：報名、看左右岸分數、提示走到乾草樁按 E 拉。
import { openPanel, attachCountdown, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { TUG } from '../game/tug.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), pull(side) }
 */
export function openTug(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const sides = el('div', 'market-view');
  const tugLive = (p, now = Date.now()) => {
    const me = (p.players || []).find((x) => x.id === p.you);
    const sc = p.score || { L: 0, R: 0 };
    const shore = me && me.team === 'R' ? '右岸' : '左岸';
    return `左岸 ${sc.L}　右岸 ${sc.R}。你在${shore}，走到乾草樁按 E 拉。還有 ${liveLeftSeconds(p, now)} 秒。`;
  };
  const cd = attachCountdown(status, '開始拔河。', tugLive);
  const body = openPanel('廣場拔河', () => cd.stop());
  body.append(gold, status, msg, actions, people, sides);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.tug || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    const sc = p.score || { L: 0, R: 0 };
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。只有你一個？等 12 秒，鎮民會來湊人數。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開始拔河。`;
    } else if (p.status === 'live') status.textContent = tugLive(p);
    else status.textContent = '這一輪結束。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了拔河'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
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
      const shore = pl.team === 'R' ? '右岸' : pl.team === 'L' ? '左岸' : '';
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}　${shore}　${pl.pulls || 0} 下${pay}`));
      people.append(row);
    }
    sides.textContent = '';
    sides.append(el('h3', null, '兩岸'));
    for (const s of p.spots || TUG.spots) {
      const row = el('div', 'shop-row');
      const info = el('span');
      info.append(atlasIcon(s.k, 28), document.createTextNode(` ${s.name}　${sc[s.id] || 0}`));
      row.append(info);
      const act = btn('拉', async () => {
        act.disabled = true;
        try { paint(await api.pull(s.id)); say(`你在${s.name}拉了一下`); } catch (e) { say(e.msg || '拉不到', true); act.disabled = false; }
      });
      act.disabled = p.status !== 'live' || !me || (me.team && me.team !== s.id);
      row.append(act);
      sides.append(row);
    }
    if (p.status === 'over' && p.payout) say(`你拿到 ${p.payout} G`);
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; say(e.msg || '暫時連不上', true); }
  })();
}
