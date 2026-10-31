// 廣場占席面板：報名、占住東北草席。持有時間最長的人拿 40 G。
import { openPanel, attachCountdown, liveLeftSeconds, liveScoreSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { HILL_JOIN } from '../game/hill.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), take() }
 */
export function openHill(api) {
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const hillLive = (p, now = Date.now()) => {
    const me = (p.players || []).find((x) => x.id === p.you);
    const holder = (p.players || []).find((x) => x.id === p.holder);
    const sec = p.holder ? liveScoreSeconds(p, p.holder, now) : 0;
    const left = liveLeftSeconds(p, now);
    const holdBit = p.holder ? `已占 ${sec} 秒。` : '';
    if (me && me.holder) return `草席是你的！${holdBit}還有 ${left} 秒。別人走近按 E 會搶走。`;
    return `草席在${holder ? holder.name : '空著'}。${holdBit}走到東北草席按 E 占住。還有 ${left} 秒。`;
  };
  const cd = attachCountdown(status, '開始占席。', hillLive);
  const body = openPanel('廣場占席', () => cd.stop());
  body.append(gold, status, msg, actions, people);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function paint(data) {
    const p = data.hill || data;
    cd.remember(p);
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    if (p.status === 'open') status.textContent = `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。`;
    else if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      status.textContent = `倒數上車（${n}/${p.max}）。${left} 秒後開始占席。`;
    } else if (p.status === 'live') status.textContent = hillLive(p);
    else status.textContent = '這一輪結束。再按「加入」開下一輪。';
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了占席'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    const take = btn('占住', async () => {
      take.disabled = true;
      try { paint(await api.take()); say('你占住草席了'); } catch (e) { say(e.msg || '占不到', true); take.disabled = false; }
    });
    join.disabled = p.status === 'live' || !!(p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    take.disabled = p.status !== 'live' || !me || !!(me && me.holder);
    actions.append(join, leave, take);
    people.textContent = '';
    const h = el('h3', null, '這一輪');
    h.prepend(atlasIcon(HILL_JOIN.k, 28));
    people.append(h);
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const role = pl.holder ? '占著' : '旁邊';
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
