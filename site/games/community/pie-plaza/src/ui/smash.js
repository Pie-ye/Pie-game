// 廣場砸罐面板：報名、罐子冒出時砸中。砸最多的人拿 40 G。
import { openPanel, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { SMASH_JOIN, smashUpFromPublic } from '../game/smash.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), hit() }
 */
export function openSmash(api) {
  let lastP = null, hitBtn = null;
  const tick = setInterval(() => pulse(), 200);
  const body = openPanel('廣場砸罐', () => clearInterval(tick));
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  body.append(gold, status, msg, actions, people);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function liveLine(p) {
    const n = (p.players || []).length;
    if (p.status === 'open') return `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。`;
    if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      return `倒數上車（${n}/${p.max}）。${left} 秒後開始砸罐。`;
    }
    if (p.status === 'live') {
      const left = `還有 ${liveLeftSeconds(p)} 秒。`;
      return smashUpFromPublic(p, Date.now())
        ? `罐子冒出來了！走近南岸紅罐按 E 砸。每一波只能砸一次。${left}`
        : `罐子縮回去了，等它再冒出來。砸最多的人拿 40 G。${left}`;
    }
    return '這一輪結束。再按「加入」開下一輪。';
  }
  function pulse() {
    if (!lastP) return;
    status.textContent = liveLine(lastP);
    if (hitBtn && lastP.status === 'live') {
      const me = (lastP.players || []).find((x) => x.id === lastP.you);
      hitBtn.disabled = !me || !smashUpFromPublic(lastP, Date.now());
    }
  }

  function paint(data) {
    const p = data.smash || data;
    lastP = p;
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    const me = (p.players || []).find((x) => x.id === p.you);
    status.textContent = liveLine(p);
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了砸罐'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
    });
    const leave = btn('退出', async () => {
      try { paint(await api.leave()); say('你退出了'); } catch (e) { say(e.msg || '現在不能退出', true); }
    });
    const hit = btn('砸', async () => {
      hit.disabled = true;
      try { paint(await api.hit()); say('砸中了'); } catch (e) { say(e.msg || '砸不到', true); hit.disabled = false; }
    });
    join.disabled = p.status === 'live' || !!(p.players || []).some((x) => x.id === p.you);
    leave.disabled = (p.status !== 'open' && p.status !== 'countdown') || !(p.players || []).some((x) => x.id === p.you);
    hit.disabled = p.status !== 'live' || !me || !smashUpFromPublic(p, Date.now());
    hitBtn = hit;
    actions.append(join, leave, hit);
    people.textContent = '';
    const h = el('h3', null, '這一輪');
    h.prepend(atlasIcon(SMASH_JOIN.k, 28));
    people.append(h);
    for (const pl of p.players || []) {
      const row = el('div', 'shop-row');
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}　${pl.score | 0} 下${pay}`));
      people.append(row);
    }
    if (p.status === 'over' && p.payout) say(`你拿到 ${p.payout} G`);
  }

  (async () => {
    people.append(el('p', 'note', '讀取中…'));
    try { paint(await api.view()); } catch (e) { people.textContent = ''; say(e.msg || '暫時連不上', true); }
  })();
}
