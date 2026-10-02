import { escapeHtml, mountStylesheet, motionEnabled, renderIfChanged } from '../../util.js';
import { mountIcons as mountIconNodes } from '../../icons.js';

let root = null;
let sdk = null;
let controller = null;
let releaseStyles = null;
let generation = 0;
const listeners = [];
const state = { user: null, casino: null };

function registerDocumentListener(type, handler, options) { listeners.push({ type, handler, options }); }
function $(selector) { return root ? root.querySelector(selector) : null; }
function $$(selector) { return root ? Array.from(root.querySelectorAll(selector)) : []; }
function currentCasinoUserId() { return state.user && state.user.id; }
function ensureCasinoState() {
  if (!state.casino) state.casino = { userId: currentCasinoUserId(), balance: Number(sdk && sdk.getBalance()) || 0, slots: { config: null, spinning: false, last: null, bet: 5 } };
  return state.casino;
}
function mountIcons() { if (root) mountIconNodes(root); }
function toast(message) { if (sdk) sdk.toast(message); }
function casinoRoundId() { return sdk ? sdk.roundId() : ''; }
function refreshCasinoHistory() { if (sdk) sdk.refreshHistory(); }
function setCasinoBalance(value) {
  const balance = Number(value) || 0;
  if (state.casino) state.casino.balance = balance;
  if (sdk) sdk.setBalance(balance);
  const output = $('.pg-balance-value');
  if (output) output.textContent = balance.toLocaleString('zh-TW');
}
function isAbortedResponse(response) { return Boolean(response && response.aborted); }
async function api(path, options = {}) {
  const activeSdk = sdk;
  const activeGeneration = generation;
  if (!activeSdk || !controller) return { response: { ok: false, status: 0, aborted: true }, payload: {} };
  const next = { ...options, signal: controller.signal };
  if (typeof next.body === 'string') { try { next.body = JSON.parse(next.body); } catch (_) { /* keep body */ } }
  const result = await activeSdk.api(path, next);
  if (activeGeneration !== generation || activeSdk !== sdk) return { response: { ok: false, status: 0, aborted: true }, payload: {} };
  return result;
}


/* 大獎符號在後端叫 brand，但站內品牌圖示就是 K 棒，跟 candles 幾乎一樣，玩家認不出大獎。
   畫面上一律改用皇冠圖示並叫「大獎」；後端符號 id 不變（賠付、紀錄、測試都靠它）。 */
const SLOT_JACKPOT = 'brand';
const SLOT_SYMBOL_ICONS = { brand: 'crown' };

function slotIcon(sym) {
  const name = String(sym || '');
  return SLOT_SYMBOL_ICONS[name] || name;
}

const SLOT_SYMBOL_LABELS = {
  brand: '大獎',
  gem: '寶石',
  rocket: '火箭',
  bank: '銀行',
  flame: '火焰',
  trend: '趨勢',
  candles: 'K 線',
  coins: '金幣',
};
function slotCellsHtml(symbols, hits) {
  const hitAt = hits || [];
  return (symbols || []).map((sym, idx) => {
    const name = String(sym || '');
    const hit = hitAt[idx] ? ' is-hit' : '';
    const jackpot = name === SLOT_JACKPOT ? ' is-jackpot' : '';
    return `<span class="slot-cell${hit}${jackpot}"><span class="inline-icon" data-icon="${escapeHtml(slotIcon(name))}" aria-hidden="true"></span></span>`;
  }).join('');
}

function slotPaylineHits(line) {
  if (!line || line.length < 3) return [false, false, false];
  if (line[0] === line[1] && line[1] === line[2]) return [true, true, true];
  if (line.filter((s) => s === 'coins').length === 2) {
    return line.map((s) => s === 'coins');
  }
  return [false, false, false];
}

function renderCasinoSlots() {
  const box = $('#casinoSlots');
  if (!box || !state.casino) return;
  const spinning = state.casino.slots.spinning;
  if (spinning && box.querySelector('.slot-layout[data-spinning="1"]')) return;
  const cfg = state.casino.slots.config;
  if (!cfg) {
    if (renderIfChanged(box, '<p class="empty-hint">載入拉霸機中…</p>')) mountIcons();
    return;
  }
  const symbols = Array.isArray(cfg.symbols) ? cfg.symbols : [];
  const bets = Array.isArray(cfg.bets) ? cfg.bets : [1, 5, 10, 20];
  const bet = state.casino.slots.bet;
  const balance = Number(state.casino.balance || 0);
  const last = state.casino.slots.last;
  const paytable = cfg.paytable || {};
  const rtpPct = Math.round(Number(cfg.rtp || 0) * 100);
  const twoCoins = Number(cfg.twoCoinsMult != null ? cfg.twoCoinsMult : 1);
  const canSpin = !spinning && balance >= bet;
  const lineHits = last && last.line ? slotPaylineHits(last.line) : [false, false, false];

  const reelsHtml = [0, 1, 2].map((i) => {
    let cells;
    let hits = [false, false, false];
    if (last && last.reels && last.reels[i]) {
      cells = last.reels[i];
      hits = [false, lineHits[i], false];
    } else {
      cells = symbols.concat(symbols, symbols);
    }
    return `<div class="slot-reel" data-reel="${i}"><div class="slot-strip">${slotCellsHtml(cells, hits)}</div></div>`;
  }).join('');

  const betsHtml = bets.map((n) => {
    const active = Number(n) === Number(bet) ? ' is-active' : '';
    return `<button type="button" class="filter-tab${active}" data-action="slot-bet" data-bet="${Number(n)}" aria-pressed="${Number(n) === Number(bet) ? 'true' : 'false'}" ${spinning ? 'disabled' : ''}>${Number(n).toLocaleString('zh-TW')}</button>`;
  }).join('');

  const payRows = symbols.map((sym) => {
    const mult = paytable[sym];
    const label = SLOT_SYMBOL_LABELS[sym] || sym;
    const jackpot = sym === SLOT_JACKPOT;
    return `<tr${jackpot ? ' class="is-jackpot"' : ''}><td><span class="inline-icon" data-icon="${escapeHtml(slotIcon(sym))}" aria-hidden="true"></span> ${escapeHtml(label)}${jackpot ? ' <small>三連一夜致富</small>' : ''}</td><td class="num">×${escapeHtml(String(mult))}</td></tr>`;
  }).join('');

  let resultHtml = '<p class="slot-result-empty">按下旋轉，中線三連或任兩枚金幣即派彩。</p>';
  if (last && last.line) {
    const lineIcons = last.line.map((sym) => (
      `<span class="inline-icon" data-icon="${escapeHtml(slotIcon(sym))}" aria-hidden="true"></span>`
    )).join('');
    const payout = Number(last.payout || 0);
    const outcome = payout > 0
      ? `<strong class="slot-win">+${payout.toLocaleString('zh-TW')} 金幣</strong>`
      : '<span class="slot-miss">沒中，再接再厲</span>';
    resultHtml = `<div class="slot-result-line">${lineIcons} ${outcome}</div>`;
  }

  const html = `
    <div class="slot-layout" data-spinning="${spinning ? '1' : '0'}">
      <div class="slot-main">
        <div class="slot-machine">
          <div class="slot-window">
            ${reelsHtml}
            <div class="slot-payline" aria-hidden="true"></div>
          </div>
        </div>
        <div class="slot-controls casino-sticky-actions">
          <div class="slot-bets">${betsHtml}</div>
          <button type="button" class="primary-button" data-action="slot-spin" ${canSpin ? '' : 'disabled'}>旋轉（${Number(bet).toLocaleString('zh-TW')} 金幣）</button>
        </div>
        <div class="slot-result">${resultHtml}</div>
      </div>
      <div class="slot-paytable-wrap">
        <p class="eyebrow">賠付表</p>
        <table class="slot-paytable">
          <thead><tr><th>符號</th><th class="num">倍數</th></tr></thead>
          <tbody>
            ${payRows}
            <tr><td colspan="2">任兩枚金幣 ×${escapeHtml(String(twoCoins))}</td></tr>
          </tbody>
        </table>
        <p class="slot-rtp">理論回饋率 ${rtpPct}%</p>
      </div>
    </div>`;
  if (renderIfChanged(box, html)) mountIcons();
}

function slotCellHeight(machine) {
  const cell = machine && machine.querySelector('.slot-cell');
  const measured = cell ? cell.getBoundingClientRect().height : 0;
  if (measured) return measured;
  const controlH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-h')) || 40;
  return controlH * 2;
}

async function animateSlotReels(reels) {
  const reelEls = $$('#casinoSlots .slot-reel');
  const cfg = state.casino && state.casino.slots && state.casino.slots.config;
  const symbols = (cfg && cfg.symbols) || [];
  const line = [0, 1, 2].map((i) => ((reels && reels[i]) || [])[1]);
  const lineHits = slotPaylineHits(line);

  const applyFinal = () => {
    reelEls.forEach((reel, i) => {
      const strip = reel.querySelector('.slot-strip');
      if (!strip) return;
      const target = (reels && reels[i]) || [];
      const hits = [false, lineHits[i], false];
      strip.style.transform = '';
      strip.innerHTML = slotCellsHtml(target, hits);
    });
    mountIcons();
  };

  if (!motionEnabled()) {
    applyFinal();
    return;
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const ease = rootStyle.getPropertyValue('--ease-out').trim() || 'ease';
  const dur3 = parseFloat(rootStyle.getPropertyValue('--dur-3'));
  const stagger = parseFloat(rootStyle.getPropertyValue('--stagger'));
  const machine = $('#casinoSlots .slot-machine');
  const anims = [];

  reelEls.forEach((reel, i) => {
    const strip = reel.querySelector('.slot-strip');
    if (!strip) return;
    const target = (reels && reels[i]) || [];
    const filler = [];
    const fillerCount = 12;
    for (let n = 0; n < fillerCount; n += 1) {
      filler.push(symbols.length ? symbols[Math.floor(Math.random() * symbols.length)] : 'coins');
    }
    const cells = filler.concat(target);
    strip.style.transform = 'translateY(0)';
    strip.innerHTML = slotCellsHtml(cells);
    const cellH = slotCellHeight(machine);
    const offset = Math.max(0, (cells.length - 3) * cellH);
    const duration = dur3 * (3 + i);
    const delay = stagger * 4 * i;
    const anim = strip.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(-${offset}px)` }],
      { duration, easing: ease, fill: 'forwards', delay },
    );
    anims.push(anim);
  });
  mountIcons();
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
  anims.forEach((a) => {
    try {
      a.commitStyles();
      a.cancel();
    } catch (_) { /* ignore */ }
  });
  applyFinal();
}

function casinoSpinOwnerMatches(userId) {
  return Boolean(state.user && state.user.id === userId);
}

function abandonCasinoSpin(userId) {
  if (state.casino && state.casino.userId === userId) {
    state.casino.slots.spinning = false;
  }
}

async function slotSpin() {
  ensureCasinoState();
  if (state.casino.slots.spinning) return;
  const cfg = state.casino.slots.config;
  if (!cfg) return;
  const bet = Number(state.casino.slots.bet);
  if (state.casino.balance < bet) {
    toast('金幣不足');
    return;
  }
  const userId = currentCasinoUserId();
  state.casino.slots.spinning = true;
  renderCasinoSlots();

  const clientRoundId = casinoRoundId();
  const { response, payload } = await api('/api/casino/slots/spin', {
    method: 'POST',
    body: JSON.stringify({ bet, clientRoundId }),
  });
  if (!casinoSpinOwnerMatches(userId)) {
    abandonCasinoSpin(userId);
    return;
  }
  if (!response.ok) {
    state.casino.slots.spinning = false;
    toast(payload.error || '旋轉失敗');
    renderCasinoSlots();
    return;
  }
  try {
    await animateSlotReels(payload.reels);
  } catch (_) { /* 動畫中斷仍要落地結果 */ }
  if (!casinoSpinOwnerMatches(userId)) {
    abandonCasinoSpin(userId);
    return;
  }
  state.casino.slots.last = payload;
  state.casino.slots.spinning = false;
  setCasinoBalance(payload.balance);
  renderCasinoSlots();
  if (Number(payload.payout) > 0) {
    toast(`中獎 +${Number(payload.payout).toLocaleString('zh-TW')} 金幣`);
  }
  refreshCasinoHistory('slots');
}

registerDocumentListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'slot-bet') {
    e.preventDefault();
    ensureCasinoState();
    if (state.casino.slots.spinning) return;
    const next = Number(btn.dataset.bet);
    if (!Number.isFinite(next)) return;
    state.casino.slots.bet = next;
    renderCasinoSlots();
  } else if (action === 'slot-spin') {
    e.preventDefault();
    slotSpin();
  }
});

async function loadSlots() {
  const slots = ensureCasinoState().slots;
  renderCasinoSlots();
  const { response, payload } = await api('/api/casino/slots/config');
  if (isAbortedResponse(response)) return;
  if (!response.ok) { toast((payload && payload.error) || '載入賭場失敗'); return; }
  slots.config = payload;
  const bets = Array.isArray(payload.bets) ? payload.bets : [1, 5, 10, 20];
  if (!bets.includes(slots.bet)) slots.bet = bets.includes(5) ? 5 : (bets[0] || 5);
  setCasinoBalance(payload.balance);
  renderCasinoSlots();
}

export function mount(target, officialSdk) {
  unmount();
  root = target;
  sdk = officialSdk;
  generation += 1;
  controller = new AbortController();
  state.user = officialSdk.user || null;
  state.casino = null;
  root.classList.add('pg-official-slots');
  root.innerHTML = `<div class=official-balance>餘額 <strong class=pg-balance-value>${Number(officialSdk.getBalance()).toLocaleString('zh-TW')}</strong> 金幣</div><div id=casinoSlots></div>`;
  releaseStyles = mountStylesheet(new URL('./game.css', import.meta.url).href);
  for (const item of listeners) root.addEventListener(item.type, item.handler, item.options);
  loadSlots();
}

export function unmount() {
  generation += 1;
  if (controller) controller.abort();
  if (root) {
    for (const item of listeners) root.removeEventListener(item.type, item.handler, item.options);
    for (const animation of root.getAnimations ? root.getAnimations({ subtree: true }) : []) animation.cancel();
    root.classList.remove('pg-official-slots');
    root.replaceChildren();
  }
  if (releaseStyles) releaseStyles();
  releaseStyles = null;
  controller = null;
  sdk = null;
  root = null;
  state.user = null;
  state.casino = null;
}
