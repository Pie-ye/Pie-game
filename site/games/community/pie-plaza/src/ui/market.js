// 跳蚤市場：買別人的掛單、把背包裡的東西上架、管理自己的攤位。交易全部在伺服器完成。
import { openPanel } from './panels.js';
import { atlasIcon } from './icon.js';
import { itemName, marketable } from '../social/home.js';
import { CROPS, PIES } from '../farm/state.js';
import { FISH_PRICES } from '../fish/fishing.js';

/** 基礎價（和伺服器 base_value 一致）：上架單價要在 50%–300%。 */
export const baseValue = (k) => (CROPS[k] && CROPS[k].sell) || (PIES[k] && PIES[k].sell) || FISH_PRICES[k] || { wood: 6, stone: 6, fiber: 4 }[k] || 10;
export const priceRange = (k, n) => [Math.max(1, Math.floor(baseValue(k) * 0.5 * n)), Math.floor(baseValue(k) * 3 * n)];

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (text, fn, cls) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
export const itemIcon = (k) => (k.startsWith('fish_') ? `fish${k[5].toUpperCase()}${k.slice(6)}` : { wood: 'log', stone: 'rockSmall', fiber: 'weedA' }[k] || `${k}Item`);

/**
 * api：{ list() → Promise<listings>, buy(id), sell(item, n, price), unlist(id) }（失敗時丟 err.msg）
 * me：{ id, farm }（farm.inv、farm.gold 會在交易後由呼叫端更新）
 */
export function openMarket(api, me, tab = 'buy') {
  const body = openPanel('派派鎮跳蚤市場');
  const tabs = el('div', 'chips');
  const view = el('div', 'market-view');
  const gold = el('p', 'gold-line');
  const msg = el('p', 'note');
  const paintGold = () => { gold.textContent = `你的金幣：${me.farm.gold} G`; };
  const say = (t, bad) => { msg.textContent = t || ''; msg.style.color = bad ? '#c0392b' : ''; };
  const show = (t) => { tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); render(t); };
  for (const [t, label] of [['buy', '購買'], ['orders', '鎮民急徵'], ['sell', '上架'], ['mine', '我的攤位']]) { const b = btn(label, () => show(t)); b.dataset.t = t; tabs.append(b); }
  body.append(gold, tabs, msg, view);
  paintGold();

  async function render(t) {
    view.textContent = '';
    say('');
    if (t === 'sell') return renderSell();
    if (t === 'orders') return renderOrders();
    view.append(el('p', 'note', '讀取中…'));
    let items;
    try { items = await api.list(); } catch (e) { view.textContent = ''; say(e.msg || '市場暫時連不上', true); return; }
    view.textContent = '';
    const list = t === 'mine' ? items.filter((x) => x.seller === me.id) : items.filter((x) => x.seller !== me.id);
    if (!list.length) view.append(el('p', 'note', t === 'mine' ? '你還沒有上架任何東西。' : '現在沒有人在賣東西，來當第一個攤販吧！'));
    for (const it of list) {
      const row = el('div', 'shop-row');
      const info = el('span');
      info.append(atlasIcon(itemIcon(it.item), 32), document.createTextNode(` ${itemName(it.item)} ×${it.n}　${it.price} G`));
      row.append(info, el('small', null, t === 'mine' ? `上架中` : `賣家：${it.sellerName}`));
      if (t === 'mine') row.append(btn('下架', async () => { try { await api.unlist(it.id); say('已下架，東西放回背包'); render('mine'); } catch (e) { say(e.msg || '下架失敗', true); } }));
      else {
        const b = btn('購買', async () => {
          b.disabled = true;
          try { await api.buy(it.id); paintGold(); say(`買到 ${itemName(it.item)} ×${it.n}！`); row.remove(); } catch (e) { say(e.msg || '買不到', true); b.disabled = false; }
        });
        b.disabled = me.farm.gold < it.price;
        row.append(b);
      }
      view.append(row);
    }
  }

  function renderSell() {
    const items = marketable(me.farm.inv);
    if (!items.length) { view.append(el('p', 'note', '背包裡沒有可以賣的東西（作物、魚、木材、石頭、纖維）。')); return; }
    const sel = el('select'); sel.setAttribute('aria-label', '要賣的東西');
    for (const [k, n] of items) { const o = el('option', null, `${itemName(k)}（有 ${n}）`); o.value = k; sel.append(o); }
    const num = el('input'); num.type = 'number'; num.min = '1'; num.value = '1'; num.setAttribute('aria-label', '數量');
    const price = el('input'); price.type = 'number'; price.min = '1'; price.max = '99999'; price.setAttribute('aria-label', '總價');
    const hint = el('p', 'note');
    const suggest = () => { const n = Math.max(1, Math.floor(Number(num.value)) || 1), [lo, hi] = priceRange(sel.value, n); price.value = String(baseValue(sel.value) * n); hint.textContent = `可以定 ${lo}–${hi} G。成交收 10% 稅；掛兩小時以上、價格不超過 ${Math.floor(baseValue(sel.value) * 1.2 * n)} G 的話，路過的鎮民會買走。`; };
    sel.addEventListener('change', suggest); num.addEventListener('input', suggest);
    const form = el('div', 'sell-form');
    form.append(el('label', null, '物品'), sel, el('label', null, '數量'), num, el('label', null, '總價（G）'), price);
    const go = btn('上架', async () => {
      const n = Math.floor(Number(num.value)), p = Math.floor(Number(price.value));
      if (!(n >= 1 && n <= 99) || !(p >= 1 && p <= 99999)) { say('數量 1–99、價格 1–99999', true); return; }
      go.disabled = true;
      try { await api.sell(sel.value, n, p); say(`已上架 ${itemName(sel.value)} ×${n}，${p} G`); view.textContent = ''; renderSell(); } catch (e) { say(e.msg || '上架失敗', true); }
      go.disabled = false;
    }, 'primary');
    suggest();
    view.append(form, go, hint, el('p', 'note', '一個人最多同時上架 10 筆。有人買下時，錢會直接進你的帳戶，不在線上也一樣，信箱會通知你。'));
  }
  async function renderOrders() {
    if (!api.orders) return;
    let list;
    try { list = await api.orders(); } catch (e) { say(e.msg || '讀不到', true); return; }
    view.append(el('p', 'note', '鎮民今天急著要這些東西，出 1.4 倍價收購。每張限 3 位鎮民交貨，每人一次。'));
    for (const o of list) {
      const row = el('div', 'shop-row');
      const info = el('span');
      info.append(atlasIcon(itemIcon(o.item), 32), document.createTextNode(` ${o.npc}：${itemName(o.item)} ×${o.n}　${o.unit * o.n} G`));
      row.append(info, el('small', null, o.done ? '你交過了' : `還收 ${o.left} 份（你有 ${me.farm.inv[o.item] || 0}）`));
      const b = btn('交貨', async () => {
        b.disabled = true;
        try { const r = await api.fill(o.i); paintGold(); say(`${r.npc}：謝謝你！+${r.reward} G`); view.textContent = ''; renderOrders(); } catch (e) { say(e.msg || '交不了', true); b.disabled = false; }
      });
      b.disabled = o.done || o.left <= 0 || (me.farm.inv[o.item] || 0) < o.n;
      row.append(b);
      view.append(row);
    }
  }
  show(tab);
}
