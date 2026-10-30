// 派派鎮民交易所：看五檔指數、用遊戲金幣買進賣出。行情由伺服器決定。
import { openPanel } from './panels.js';
import { atlasIcon } from './icon.js';
import { TICKERS } from '../game/exchange.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const iconOf = (id) => (TICKERS.find((t) => t.id === id) || {}).icon || 'sack';
const chgText = (n) => (n > 0 ? `+${n}` : String(n));
const chgCls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

/**
 * api：{ quote() → Promise<view>, trade(side, ticker, n) }
 * opts：{ guest }
 */
export function openExchange(api, opts = {}) {
  const body = openPanel('派派鎮民交易所');
  const gold = el('p', 'gold-line');
  const status = el('p', 'note');
  const msg = el('p', 'note');
  const view = el('div', 'market-view');
  const qty = el('input');
  qty.type = 'number'; qty.min = '1'; qty.max = '99'; qty.value = '1'; qty.setAttribute('aria-label', '股數');
  const form = el('div', 'sell-form');
  form.append(el('label', null, '一次買賣'), qty, el('span', 'note', '股'));
  body.append(gold, status, msg, form, view);

  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };
  const nOf = () => Math.max(1, Math.min(99, Math.floor(Number(qty.value) || 1)));

  function paint(data) {
    gold.textContent = `你的金幣：${data.gold} G`;
    const hours = `${String(data.hours[0]).padStart(2, '0')}:00–${String(data.hours[1]).padStart(2, '0')}:00`;
    status.textContent = data.open
      ? `開盤中（台北 ${hours}）。價差 2%，週一開盤發 1% 股息。`
      : `休息中。營業時間台北 ${hours}。訪客可看行情，登入才能買賣。`;
    view.textContent = '';
    for (const q of data.quotes) {
      const row = el('div', 'shop-row x-row');
      const info = el('span');
      info.append(atlasIcon(iconOf(q.id), 28), document.createTextNode(` ${q.id} ${q.name}　${q.mid} G`));
      const small = el('small', null, `買 ${q.buy} / 賣 ${q.sell}　持有 ${q.hold}　${q.why}`);
      const chg = el('b', `x-chg ${chgCls(q.chg)}`, chgText(q.chg));
      row.append(info, chg, small);
      const buy = btn('買', async () => {
        buy.disabled = sell.disabled = true;
        try {
          const r = await api.trade('buy', q.id, nOf());
          say(`買進 ${q.id} ×${r.n}，花 ${r.paid} G`);
          paint(r);
        } catch (e) { say(e.msg || '買不到', true); buy.disabled = sell.disabled = false; }
      });
      const sell = btn('賣', async () => {
        buy.disabled = sell.disabled = true;
        try {
          const r = await api.trade('sell', q.id, nOf());
          say(`賣出 ${q.id} ×${r.n}，得到 ${r.got} G`);
          paint(r);
        } catch (e) { say(e.msg || '賣不掉', true); buy.disabled = sell.disabled = false; }
      });
      const locked = opts.guest || !data.open;
      buy.disabled = locked || data.gold < q.buy;
      sell.disabled = locked || q.hold < 1;
      row.append(buy, sell);
      view.append(row);
    }
    if (opts.guest) say('登入後才能用金幣買賣。');
    else if (data.div) say(`週一股息入帳 ${data.div} G`);
  }

  (async () => {
    view.append(el('p', 'note', '讀取中…'));
    try { paint(await api.quote()); } catch (e) { view.textContent = ''; say(e.msg || '行情暫時連不上', true); }
  })();
}
