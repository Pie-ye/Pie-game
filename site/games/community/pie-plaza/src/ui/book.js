// 鎮民手冊：今日委託與集章手冊（資料來自伺服器 op 'quests'）。
import { openPanel } from './panels.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** 完成通知的一行字（純函式，測得出）。 */
export function questLine(q) {
  if (q.t === 'stamp') return `📮 集到「${q.name}」章！+${q.gold} G`;
  if (q.t === 'title') return `🏅 集滿一整類，獲得稱號「${q.name}」！+${q.gold} G`;
  if (q.t === 'daily') return `📋 委託完成：${q.name}　+${q.gold} G`;
  if (q.t === 'bonus') return `🎁 今日委託全部完成！+${q.gold} G`;
  if (q.t === 'guide') return `🧭 新手任務完成：${q.name}　+${q.gold} G`;
  if (q.t === 'guideAll') return `🎓 新手引導全部完成！+${q.gold} G，歡迎成為派派鎮民！`;
  return '';
}

function bar(have, need) {
  const b = el('span', 'qbar');
  const f = el('i'); f.style.width = `${Math.round(Math.min(1, have / Math.max(1, need)) * 100)}%`;
  b.append(f);
  return b;
}

/** data 為 null 表示訪客（沒有伺服器）。tab：'daily' | 'stamps'。 */
export function openBook(data, tab = 'daily', close) {
  const body = openPanel('鎮民手冊', close);
  if (!data) {
    body.append(el('p', null, '登入後，伺服器會記下你的每日委託與集章進度。'));
    return;
  }
  const tabs = el('div', 'chips');
  const page = el('div');
  const show = (t) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    page.replaceChildren();
    if (t === 'guide') paintGuide(page, data); else if (t === 'daily') paintDaily(page, data); else if (t === 'rank') paintRank(page, data.rank); else paintStamps(page, data);
  };
  const guideLeft = (data.guide || []).filter((g) => !g.done).length;
  if (tab === 'daily' && guideLeft) tab = 'guide';
  for (const [t, name] of [...(guideLeft ? [['guide', `新手 ${data.guide.length - guideLeft}/${data.guide.length}`]] : []), ['daily', '今日委託'], ['stamps', `集章 ${data.count}/${data.total}`], ...(data.rank ? [['rank', '週榜']] : [])]) {
    const b = el('button', null, name); b.type = 'button'; b.dataset.t = t;
    b.addEventListener('click', () => show(t));
    tabs.append(b);
  }
  body.append(tabs, page);
  show(tab);
}

function paintDaily(page, data) {
  page.append(el('p', 'note', '每天（台北時間）換三個委託，完成就入帳；三個都完成再加碼。'));
  for (const d of data.daily) {
    const card = el('div', `event quest${d.done ? ' past' : ''}`);
    card.append(el('b', null, `${d.done ? '✅' : '⬜'} ${d.text}`), el('span', 'tag', `${d.gold} G`));
    card.append(bar(d.got, d.need), el('p', null, `${d.got} / ${d.need}`));
    page.append(card);
  }
  const b = el('div', `event quest${data.bonus.done ? ' past' : ''}`);
  b.append(el('b', null, `${data.bonus.done ? '🎁' : '🎀'} 三個都完成`), el('span', 'tag', `+${data.bonus.gold} G`));
  page.append(b);
}

function paintStamps(page, data) {
  if (data.titles.length) {
    page.append(el('h3', null, '🏅 稱號（戴上後別人會在你的名牌看到）'));
    const row = el('div', 'menu-btns');
    for (const t of data.titles) {
      const b = el('button', data.wearing === t ? 'on' : null, data.wearing === t ? `✓ ${t}` : t); b.type = 'button';
      b.addEventListener('click', async () => { if (data.wear) { await data.wear(data.wearing === t ? null : t); data.wearing = data.wearing === t ? null : t; page.replaceChildren(); paintStamps(page, data); } });
      row.append(b);
    }
    page.append(row);
  }
  page.append(el('p', 'note', `每集到一枚章就有金幣；集滿一整類再給 ${data.catBonus} G 和稱號（玩家名片上看得到）。`));
  for (const c of data.cats) {
    const list = data.stamps.filter((s) => s.cat === c.id);
    const got = list.filter((s) => s.got).length;
    page.append(el('h3', null, `${c.icon} ${c.name}　${got}/${list.length}　（稱號：${c.title}）`));
    const grid = el('div', 'stamps');
    for (const s of list) {
      const card = el('div', `stamp${s.got ? ' got' : ''}`);
      card.title = `${s.desc}（${s.gold} G）`;
      card.append(el('b', null, s.got ? `📮 ${s.name}` : s.name), el('small', null, s.desc));
      if (!s.got && s.need > 1) card.append(bar(s.have, s.need));
      grid.append(card);
    }
    page.append(grid);
  }
}

function paintRank(page, r) {
  page.append(el('p', 'note', `${r.week}（台北時間週一換週）。每週一結算，各榜前三名拿 ${r.gold.join('／')} G，第一名得到「週榜冠軍」章。`));
  if (r.last && r.last.length) page.append(el('p', 'note', `上週冠軍：${r.last.map(([t, n]) => `${t.replace(/^\S+\s/, '')} ${n}`).join('、')}`));
  for (const b of r.boards) {
    page.append(el('h3', null, `${b.title}　（你：${b.mine}）`));
    if (!b.top.length) { page.append(el('p', 'note', '這週還沒有人上榜，當第一個吧！')); continue; }
    const ol = el('ol', 'note');
    b.top.forEach(([name, v], i) => ol.append(el('li', i < 3 ? 'podium' : null, `${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${name}　${v}`)));
    page.append(ol);
  }
}

function paintGuide(page, data) {
  page.append(el('p', 'note', `跟著做一遍就認識派派鎮了。每一步都有金幣，全部完成再送 ${data.guideBonus} G。`));
  data.guide.forEach((g, i) => {
    const card = el('div', `event quest${g.done ? ' past' : ''}`);
    card.append(el('b', null, `${g.done ? '✅' : `${i + 1}.`} ${g.text}`), el('span', 'tag', `${g.gold} G`));
    if (!g.done && g.need > 1) card.append(bar(g.have, g.need));
    page.append(card);
  });
}

/** 右上角的引導小框：下一個還沒完成的步驟。全部完成或訪客時隱藏。 */
export function guideLine(data) {
  const g = (data && data.guide) || [];
  const i = g.findIndex((x) => !x.done);
  if (i < 0) return null;
  return `🧭 新手 ${i + 1}/${g.length}：${g[i].text}`;
}
