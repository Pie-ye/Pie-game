import { escapeHtml, mountStylesheet, motionEnabled, renderIfChanged } from '../../util.js';
import { mountIcons as mountIconNodes } from '../../icons.js';

let root = null;
let sdk = null;
let controller = null;
let releaseStyles = null;
let bodyAddon = null;
let generation = 0;
const documentListeners = [];
const windowListeners = [];
const state = { user: null, casino: null };

function registerDocumentListener(type, handler, options) { documentListeners.push({ type, handler, options }); }
function registerWindowListener(type, handler, options) { windowListeners.push({ type, handler, options }); }
function $(selector) {
  if (root) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  if (bodyAddon) {
    if (bodyAddon.matches(selector)) return bodyAddon;
    return bodyAddon.querySelector(selector);
  }
  return null;
}
function $$(selector) {
  const found = root ? Array.from(root.querySelectorAll(selector)) : [];
  if (bodyAddon) {
    if (bodyAddon.matches(selector)) found.push(bodyAddon);
    found.push(...bodyAddon.querySelectorAll(selector));
  }
  return found;
}
function currentCasinoUserId() { return state.user && state.user.id; }
function ensureCasinoState() {
  if (!state.casino) {
    state.casino = {
      userId: currentCasinoUserId(),
      tab: 'dragon',
      balance: Number(sdk && sdk.getBalance()) || 0,
      slots: { config: null, spinning: false, last: null, bet: 5 },
    };
  }
  return state.casino;
}
function mountIcons() {
  if (root) mountIconNodes(root);
  if (bodyAddon) mountIconNodes(bodyAddon);
}
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
function currentView() { return root ? 'casino' : ''; }
async function api(path, options = {}) {
  const activeSdk = sdk;
  const activeGeneration = generation;
  if (!activeSdk || !controller) return { response: { ok: false, status: 0, aborted: true }, payload: {} };
  const next = { ...options, signal: controller.signal };
  if (typeof next.body === 'string') {
    try { next.body = JSON.parse(next.body); } catch (_) { /* keep a non-JSON body */ }
  }
  let result;
  try {
    result = await activeSdk.api(path, next);
  } catch (_) {
    result = { response: { ok: false, status: 0 }, payload: { error: '連線失敗，請檢查網路後重試' } };
  }
  if (activeGeneration !== generation || activeSdk !== sdk) {
    return { response: { ok: false, status: 0, aborted: true }, payload: {} };
  }
  return result;
}
async function refreshCasinoBalance() {
  const { response, payload } = await api('/api/casino/slots/config');
  if (!isAbortedResponse(response) && response.ok && payload && payload.balance != null) setCasinoBalance(payload.balance);
}
function renderPcard(card, options) { return sdk ? sdk.renderPcard(card, options) : ''; }


const DG_DEFAULT_CONFIG = {
  minBet: 5,
  maxBet: 100,
  bets: [5, 10, 20, 50, 100],
  payouts: {
    1: 12,
    2: 5.5,
    3: 3.3,
    4: 2.2,
    5: 1.5,
    6: 1.2,
    7: 0.85,
    8: 0.65,
    9: 0.45,
    10: 0.3,
    11: 0.2,
    12: 0.1,
  },
};

function ensureDragonState() {
  if (typeof ensureCasinoState === 'function') {
    ensureCasinoState();
  }
  if (!state.casino) {
    state.casino = {
      userId: currentCasinoUserId(),
      tab: 'dragon',
      balance: 0,
      slots: { config: null, spinning: false, last: null, bet: 5 },
    };
  }
  if (!state.casino.dragon) {
    state.casino.dragon = {
      view: null,
      busy: false,
      bet: 10,
    };
  }
  return state.casino.dragon;
}

function cardDisplayName(card) {
  if (!card || card.length < 1) return '';
  const r = card[0];
  return r === 'T' ? '10' : r;
}

async function renderCasinoDragon() {
  const dg = ensureDragonState();
  const box = $('#casinoDragon');
  if (!box) return;

  const currentUid = currentCasinoUserId();

  if (!dg.view) {
    const { response, payload } = await api('/api/casino/dragon');
    if (currentCasinoUserId() !== currentUid) return;
    if (!response.ok) {
      toast((payload && payload.error) || '載入射龍門失敗');
      if (typeof renderIfChanged === 'function') {
        if (renderIfChanged(box, '<p class="empty-hint">載入射龍門失敗，請稍後重試。</p>')) {
          if (typeof mountIcons === 'function') mountIcons();
        }
      }
      return;
    }
    dg.view = payload;
    if (typeof setCasinoBalance === 'function' && payload.balance != null) {
      setCasinoBalance(payload.balance);
    }
  }

  const view = dg.view || {};
  const phase = view.phase || 'idle';
  const busy = Boolean(dg.busy);
  const balance = Number((state.casino && state.casino.balance) || 0);

  const bets = (view.config && Array.isArray(view.config.bets)) ? view.config.bets : DG_DEFAULT_CONFIG.bets;
  if (!bets.includes(dg.bet)) {
    dg.bet = bets.includes(10) ? 10 : bets[0];
  }
  const currentBet = dg.bet;

  // 1. 頂部狀態橫幅
  let statusBannerHtml = '';
  if (phase === 'idle') {
    statusBannerHtml = `
      <div class="dg-status-banner">
        <span class="dg-intro-text">先看兩根柱再決定要不要下注，撞柱要賠兩倍</span>
      </div>
    `;
  } else if (phase === 'dealt') {
    const gates = view.gates || [];
    const isPair = Boolean(view.pair);
    const winRanks = (view.options && view.options[0] && view.options[0].winRanks) || 0;
    statusBannerHtml = `
      <div class="dg-status-banner">
        <span class="dg-gate-info">
          門柱 <strong>${escapeHtml(cardDisplayName(gates[0]))}</strong> 與 <strong>${escapeHtml(cardDisplayName(gates[1]))}</strong>
          ${isPair ? '（對子 · 可猜大或猜小）' : ` · 可中點數 <strong>${winRanks}</strong> 個`}
        </span>
      </div>
    `;
  } else if (phase === 'settled') {
    const outcome = view.outcome;
    const net = Number(view.net || 0);
    const pair = Boolean(view.pair);
    const multStr = pair ? '3 倍' : '2 倍';

    if (outcome === 'win') {
      const winText = net > 0 ? `進門 +${net.toLocaleString('zh-TW')} 金幣` : '進門 · 保本';
      statusBannerHtml = `
        <div class="dg-status-banner">
          <div class="dg-result-badge is-win">
            ${escapeHtml(winText)}
          </div>
        </div>
      `;
    } else if (outcome === 'pillar') {
      statusBannerHtml = `
        <div class="dg-status-banner">
          <div class="dg-result-badge is-pillar">
            撞柱 −${Math.abs(net).toLocaleString('zh-TW')} 金幣（賠 ${multStr}）
          </div>
        </div>
      `;
    } else {
      statusBannerHtml = `
        <div class="dg-status-banner">
          <div class="dg-result-badge is-lose">
            沒進 −${Math.abs(net).toLocaleString('zh-TW')} 金幣
          </div>
        </div>
      `;
    }
  }

  // 2. 牌桌三張牌展示區
  const gates = view.gates || [];
  const third = view.third;
  const leftCard = gates[0] ? renderPcard(gates[0]) : '<div class="pcard is-back" aria-label="暗牌"></div>';
  const rightCard = gates[1] ? renderPcard(gates[1]) : '<div class="pcard is-back" aria-label="暗牌"></div>';
  let middleCard = '<div class="pcard is-back" aria-label="暗牌"></div>';

  if (phase === 'settled' && third) {
    middleCard = renderPcard(third);
  } else if (phase === 'dealt') {
    middleCard = renderPcard('??');
  }

  const tableHtml = `
    <div class="dg-table-felt">
      <div class="dg-cards-row">
        <div class="dg-card-slot">
          <span class="dg-slot-title">左柱</span>
          ${leftCard}
        </div>
        <div class="dg-card-slot dg-card-middle">
          <span class="dg-slot-title">第三張</span>
          ${middleCard}
        </div>
        <div class="dg-card-slot">
          <span class="dg-slot-title">右柱</span>
          ${rightCard}
        </div>
      </div>
    </div>
  `;

  // 3. 動作區（帶 .casino-sticky-actions 以相容手機懸浮列）
  let actionsHtml = '';
  if (phase === 'idle') {
    actionsHtml = `
      <div class="dg-actions-container casino-sticky-actions">
        <button type="button" class="primary-button dg-deal-btn" data-action="dg-deal" ${busy ? 'disabled' : ''}>
          發柱
        </button>
      </div>
    `;
  } else if (phase === 'dealt') {
    const isPair = Boolean(view.pair);
    const options = Array.isArray(view.options) ? view.options : [];

    // 押注選擇鈕
    const betsHtml = bets.map((b) => {
      const active = Number(b) === Number(currentBet) ? ' is-active' : '';
      return `<button type="button" class="filter-tab${active}" data-action="dg-chip" data-bet="${Number(b)}" aria-pressed="${active ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>${Number(b)}</button>`;
    }).join('');

    let optionButtonsHtml = '';
    if (!isPair && options.length > 0) {
      const opt = options[0];
      const lockAmount = currentBet * opt.pillarMult;
      const canBet = !busy && balance >= lockAmount;
      optionButtonsHtml = `
        <div class="dg-btn-group">
          <button type="button" class="primary-button" data-action="dg-bet" data-choice="inside" ${canBet ? '' : 'disabled'}>
            下注進門 · 賠 ×${opt.payout}
          </button>
          <span class="dg-mult-hint">撞柱賠 2 倍</span>
          <button type="button" class="secondary-button" data-action="dg-pass" ${busy ? 'disabled' : ''}>
            放棄
          </button>
        </div>
      `;
    } else if (isPair) {
      const pairBtns = options.map((opt) => {
        const lockAmount = currentBet * opt.pillarMult;
        const canBet = !busy && balance >= lockAmount;
        const label = opt.choice === 'high' ? '猜大' : '猜小';
        return `
          <button type="button" class="primary-button" data-action="dg-bet" data-choice="${escapeHtml(opt.choice)}" ${canBet ? '' : 'disabled'}>
            ${label} · 賠 ×${opt.payout} <span class="dg-mult-hint">（撞柱賠 3 倍）</span>
          </button>
        `;
      }).join('');

      optionButtonsHtml = `
        <div class="dg-pair-options">
          ${pairBtns}
          <button type="button" class="secondary-button" data-action="dg-pass" ${busy ? 'disabled' : ''}>
            放棄
          </button>
        </div>
      `;
    }

    actionsHtml = `
      <div class="dg-actions-container casino-sticky-actions">
        <div class="dg-bet-selector">
          <span class="dg-bet-label">押注金額：</span>
          ${betsHtml}
        </div>
        ${optionButtonsHtml}
      </div>
    `;
  } else if (phase === 'settled') {
    actionsHtml = `
      <div class="dg-actions-container casino-sticky-actions">
        <button type="button" class="primary-button dg-deal-btn" data-action="dg-deal" ${busy ? 'disabled' : ''}>
          再發一次柱
        </button>
      </div>
    `;
  }

  // 4. 賠率表（依可中點數 1–12 顯示對應倍率）
  const payouts = (view.config && view.config.payouts) || DG_DEFAULT_CONFIG.payouts;
  const payoutCardsHtml = Object.keys(payouts).map((ranks) => {
    const rate = payouts[ranks];
    return `
      <div class="dg-payout-card">
        <div class="dg-payout-ranks">${ranks} 點</div>
        <div class="dg-payout-rate">×${rate}</div>
      </div>
    `;
  }).join('');

  const payoutSectionHtml = `
    <div class="dg-payout-box">
      <div class="dg-payout-header">
        <h3 class="dg-payout-title">射龍門賠率表</h3>
        <span class="dg-warning-tag">※ 長期玩一定虧 · 莊家優勢保證</span>
      </div>
      <div class="dg-payout-grid">
        ${payoutCardsHtml}
      </div>
      <div class="dg-rules-notes">
        • <strong>不同點</strong>：第三張介於兩柱之間進門（贏賠率倍數）；落在兩柱外輸押注；撞柱輸 2 倍押注。<br>
        • <strong>對子</strong>：可猜大或猜小（贏賠率倍數）；猜錯輸押注；撞柱輸 3 倍押注。
      </div>
    </div>
  `;

  const fullHtml = `
    ${statusBannerHtml}
    ${tableHtml}
    ${actionsHtml}
    ${payoutSectionHtml}
  `;

  if (typeof renderIfChanged === 'function') {
    if (renderIfChanged(box, fullHtml)) {
      if (typeof mountIcons === 'function') mountIcons();
    }
  } else {
    box.innerHTML = fullHtml;
    if (typeof mountIcons === 'function') mountIcons();
  }
}

async function dragonDeal() {
  const dg = ensureDragonState();
  if (dg.busy) return;
  const userId = currentCasinoUserId();
  dg.busy = true;
  renderCasinoDragon();

  try {
    const { response, payload } = await api('/api/casino/dragon/deal', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    if (currentCasinoUserId() !== userId) return;

    if (!response.ok) {
      toast((payload && payload.error) || '發柱失敗');
    } else {
      dg.view = payload;
      if (typeof setCasinoBalance === 'function' && payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
    }
  } catch (_) {
    toast('網路異常，請重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      dg.busy = false;
      renderCasinoDragon();
    }
  }
}

async function dragonPass() {
  const dg = ensureDragonState();
  if (dg.busy) return;
  const gateId = dg.view && dg.view.gateId;
  if (!gateId) return;
  const userId = currentCasinoUserId();
  dg.busy = true;
  renderCasinoDragon();

  try {
    const { response, payload } = await api('/api/casino/dragon/pass', {
      method: 'POST',
      body: JSON.stringify({ gateId }),
    });

    if (currentCasinoUserId() !== userId) return;

    if (!response.ok) {
      toast((payload && payload.error) || '放棄失敗');
    } else {
      dg.view = payload;
      if (typeof setCasinoBalance === 'function' && payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
    }
  } catch (_) {
    toast('網路異常，請重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      dg.busy = false;
      renderCasinoDragon();
    }
  }
}

async function dragonBet(choice) {
  const dg = ensureDragonState();
  if (dg.busy) return;
  const gateId = dg.view && dg.view.gateId;
  if (!gateId) return;

  const userId = currentCasinoUserId();
  const bet = Number(dg.bet) || 10;
  const balance = Number((state.casino && state.casino.balance) || 0);

  const opt = (dg.view && dg.view.options || []).find((o) => o.choice === choice);
  const pillarMult = (opt && opt.pillarMult) || 2;
  const lockAmount = bet * pillarMult;
  if (balance < lockAmount) {
    toast(`金幣不足（撞柱需賠 ${pillarMult} 倍，至少需 ${lockAmount} 金幣）`);
    return;
  }

  dg.busy = true;
  renderCasinoDragon();

  const clientRoundId = typeof casinoRoundId === 'function' ? casinoRoundId() : ('dg-' + Date.now());

  try {
    const { response, payload } = await api('/api/casino/dragon/bet', {
      method: 'POST',
      body: JSON.stringify({
        gateId,
        choice,
        bet,
        clientRoundId,
      }),
    });

    if (currentCasinoUserId() !== userId) return;

    if (!response.ok) {
      toast((payload && payload.error) || '下注失敗');
    } else {
      dg.view = payload;
      if (typeof setCasinoBalance === 'function' && payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
      if (typeof refreshCasinoHistory === 'function') {
        refreshCasinoHistory('dragon');
      }

      const outcome = payload.outcome;
      const net = Number(payload.net || 0);
      if (outcome === 'win') {
        if (net > 0) {
          toast(`進門！獲利 +${net.toLocaleString('zh-TW')} 金幣`);
        } else {
          toast('進門！只拿回本金（保本）');
        }
      } else if (outcome === 'pillar') {
        toast(`撞柱！損失 −${Math.abs(net).toLocaleString('zh-TW')} 金幣`);
      } else {
        toast(`沒進！損失 −${Math.abs(net).toLocaleString('zh-TW')} 金幣`);
      }
    }
  } catch (_) {
    toast('網路異常，請重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      dg.busy = false;
      renderCasinoDragon();
    }
  }
}

registerDocumentListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'dg-deal') {
    e.preventDefault();
    dragonDeal();
  } else if (action === 'dg-pass') {
    e.preventDefault();
    dragonPass();
  } else if (action === 'dg-bet') {
    e.preventDefault();
    const choice = btn.dataset.choice;
    if (choice) {
      dragonBet(choice);
    }
  } else if (action === 'dg-chip') {
    e.preventDefault();
    const dg = ensureDragonState();
    if (dg.busy) return;
    const nextBet = parseInt(btn.dataset.bet, 10);
    if (Number.isFinite(nextBet)) {
      dg.bet = nextBet;
      renderCasinoDragon();
    }
  }
});

function createPokerModal() {
  if ('dragon' !== 'poker') return;
  bodyAddon = document.createElement('div');
  bodyAddon.className = 'pg-official-poker-modal friend-modal-gate';
  bodyAddon.id = 'pkSitGate';
  bodyAddon.hidden = true;
  bodyAddon.setAttribute('aria-hidden', 'true');
  bodyAddon.innerHTML = `<div class="friend-modal-card" role="dialog" aria-modal="true" aria-labelledby="pkSitTitle">
    <header class="modal-header">
      <div><span class="status-pill"><span class="inline-icon" data-icon="dice" aria-hidden="true"></span> 入座</span><h2 id="pkSitTitle">選擇買入金額</h2></div>
      <button type="button" class="icon-button" data-action="close-pk-sit-modal" aria-label="關閉"><span data-icon="x-close" aria-hidden="true"></span></button>
    </header>
    <div class="pk-sit-body">
      <label for="pkBuyInRange">買入金額（50–200）</label>
      <input id="pkBuyInRange" type="range" min="50" max="200" step="10" value="100" data-action="pk-buyin-range">
      <strong id="pkBuyInValue" class="pk-buyin-value">100</strong>
      <div class="adjust-actions"><button type="button" class="secondary-button" data-action="close-pk-sit-modal">取消</button><button type="button" class="primary-button" data-action="pk-sit-confirm">確定</button></div>
    </div>
  </div>`;
  document.body.appendChild(bodyAddon);
  mountIcons();
}

export function mount(target, officialSdk) {
  unmount();
  root = target;
  sdk = officialSdk;
  generation += 1;
  controller = new AbortController();
  state.user = officialSdk.user || null;
  state.casino = null;
  root.classList.add('pg-official-dragon');
  root.innerHTML = `<div class="official-balance">餘額 <strong class="pg-balance-value">${Number(officialSdk.getBalance()).toLocaleString('zh-TW')}</strong> 金幣</div><div id="casinoDragon" aria-live="polite"></div>`;
  releaseStyles = mountStylesheet(new URL('./game.css', import.meta.url).href);
  createPokerModal();
  for (const item of documentListeners) document.addEventListener(item.type, item.handler, item.options);
  for (const item of windowListeners) window.addEventListener(item.type, item.handler, item.options);
  renderCasinoDragon();
}

export function unmount() {
  generation += 1;
  if (typeof stopPokerPolling === 'function') stopPokerPolling();
  if (controller) controller.abort();
  for (const item of documentListeners) document.removeEventListener(item.type, item.handler, item.options);
  for (const item of windowListeners) window.removeEventListener(item.type, item.handler, item.options);
  if (bodyAddon) bodyAddon.remove();
  bodyAddon = null;
  if (root) {
    for (const animation of root.getAnimations ? root.getAnimations({ subtree: true }) : []) animation.cancel();
    root.classList.remove('pg-official-dragon');
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
