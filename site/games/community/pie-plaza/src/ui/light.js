// 廣場紅綠燈面板：報名、看綠／紅燈、提示走到下一樁按 E。
import { openPanel, liveLeftSeconds } from './panels.js';
import { atlasIcon } from './icon.js';
import { LIGHT, lightFromPublic } from '../game/light.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };

/**
 * api：{ view(), join(), leave(), dash(spot) }
 */
export function openLight(api) {
  let lastP = null;
  const tick = setInterval(() => pulse(), 200);
  const body = openPanel('廣場紅綠燈', () => clearInterval(tick));
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const actions = el('div', 'sell-form');
  const people = el('div', 'market-view');
  const spots = el('div', 'market-view');
  body.append(gold, status, msg, actions, people, spots);
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };

  function liveLine(p) {
    const n = (p.players || []).length;
    const me = (p.players || []).find((x) => x.id === p.you);
    if (p.status === 'open') return `等人中（${n}/${p.min}）。第三人加入開始倒數，最多 ${p.max} 人。只有你一個？等 12 秒，鎮民會來湊人數。`;
    if (p.status === 'countdown') {
      const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (Date.now() - (p.startedAt || 0))) / 1000));
      return `倒數上車（${n}/${p.max}）。${left} 秒後綠燈，還可以加入。`;
    }
    if (p.status === 'live') {
      const left = `還有 ${liveLeftSeconds(p)} 秒。`;
      const lamp = lightFromPublic(p, Date.now()) === 'red' ? '紅燈！停住，不要按 E。' : '綠燈！走到下一樁按 E。';
      if (me && me.out) return `你出局了，等這一輪結束。${left}`;
      if (me && me.done) return `你到終點了，等其他人。${left}`;
      return `${lamp}${left}`;
    }
    return '這一輪結束。再按「加入」開下一輪。';
  }
  function pulse() {
    if (!lastP) return;
    status.textContent = liveLine(lastP);
    if (lastP.status === 'live') {
      const lamp = lightFromPublic(lastP, Date.now());
      const h = spots.querySelector('h3');
      if (h) h.textContent = lamp === 'red' ? '紅燈' : '樁';
    }
  }

  function paint(data) {
    const p = data.light || data;
    lastP = p;
    gold.textContent = `你的金幣：${data.gold ?? 0} G`;
    status.textContent = liveLine(p);
    const me = (p.players || []).find((x) => x.id === p.you);
    actions.textContent = '';
    const join = btn('加入', async () => {
      join.disabled = true;
      try { paint(await api.join()); say('你加入了紅綠燈'); } catch (e) { say(e.msg || '加入失敗', true); join.disabled = false; }
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
      const mark = pl.done ? '　抵達' : pl.out ? '　出局' : `　${pl.score} 樁`;
      const pay = p.payouts ? `　${p.payouts[pl.id] || 0} G` : '';
      row.append(el('span', null, `${pl.name}${mark}${pay}`));
      people.append(row);
    }
    spots.textContent = '';
    spots.append(el('h3', null, p.light === 'red' ? '紅燈' : '樁'));
    for (const s of p.spots || LIGHT.spots) {
      const row = el('div', 'shop-row');
      const info = el('span');
      info.append(atlasIcon(s.k, 28), document.createTextNode(` ${s.name}`));
      row.append(info);
      const act = btn('踩', async () => {
        act.disabled = true;
        try {
          const r = await api.dash(s.id);
          paint(r);
          const you = (r.light && r.light.players || []).find((x) => x.id === r.light.you);
          if (you && you.out) say('紅燈時動了，出局', true);
          else say(`踩到 ${s.name}`);
        } catch (e) { say(e.msg || '踩不到', true); act.disabled = false; }
      });
      const next = me && !me.out && !me.done && (p.spots || LIGHT.spots)[me.score || 0];
      act.disabled = p.status !== 'live' || !me || me.out || me.done || !next || next.id !== s.id;
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
