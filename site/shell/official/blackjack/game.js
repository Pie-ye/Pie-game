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
      tab: 'blackjack',
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


const BJ_SUIT_SYMBOLS = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

const BJ_DEFAULT_CONFIG = {
  minBet: 5,
  maxBet: 100,
  bets: [5, 10, 20, 50, 100],
};

function ensureBlackjackState() {
  if (typeof ensureCasinoState === 'function') {
    ensureCasinoState();
  }
  if (!state.casino) {
    state.casino = {
      userId: currentCasinoUserId(),
      tab: 'blackjack',
      balance: 0,
      slots: { config: null, spinning: false, last: null, bet: 5 },
    };
  }
  if (!state.casino.blackjack) {
    state.casino.blackjack = { view: null, busy: false, bet: 10 };
  }
  return state.casino.blackjack;
}

/* 牌面元件：德撲（casino-poker.js）直接呼叫 renderPcard(card) 複用同一份 HTML 結構／
   class，兩邊牌面渲染只有一份，rank 對照（T→10 等）不會各寫各的、對出兩種結果。
   opts.extraClass / opts.extraAttrs 只有 21 點自己的進場動畫（is-dealt + stagger 延遲）
   會用到，德撲呼叫時不帶。 */
function renderPcard(card, opts) {
  const o = opts || {};
  const extraClass = o.extraClass || '';
  const extraAttrs = o.extraAttrs || '';
  if (card === '??') {
    return `<div class="pcard is-back${extraClass}"${extraAttrs} aria-label="暗牌"></div>`;
  }
  const rank = card[0];
  const suitChar = card[1] || '';
  const isRed = suitChar === 'h' || suitChar === 'd';
  const suitUnicode = BJ_SUIT_SYMBOLS[suitChar] || suitChar;
  const displayRank = rank === 'T' ? '10' : rank;
  const redClass = isRed ? ' is-red' : '';
  return `
    <div class="pcard${redClass}${extraClass}"${extraAttrs} aria-label="${escapeHtml(displayRank)} ${escapeHtml(suitUnicode)}">
      <div class="pcard-corner">
        <span class="pcard-rank">${escapeHtml(displayRank)}</span>
        <span class="pcard-suit">${suitUnicode}</span>
      </div>
      <div class="pcard-center" aria-hidden="true">${suitUnicode}</div>
    </div>
  `;
}

function calculateHandValue(cards) {
  if (!Array.isArray(cards) || !cards.length) return { total: 0, soft: false };
  let total = 0;
  let hasAce = false;
  for (const card of cards) {
    if (!card || card === '??') continue;
    const rank = card[0];
    if (rank === 'A') {
      total += 1;
      hasAce = true;
    } else if ('TJQK'.includes(rank)) {
      total += 10;
    } else {
      total += parseInt(rank, 10) || 0;
    }
  }
  const soft = hasAce && (total + 10 <= 21);
  return { total: soft ? total + 10 : total, soft };
}

async function renderCasinoBlackjack() {
  const bj = ensureBlackjackState();
  const box = $('#casinoBlackjack');
  if (!box) return;

  if (!bj.view) {
    const { response, payload } = await api('/api/casino/blackjack');
    if (!response.ok) {
      toast((payload && payload.error) || '載入 21 點失敗');
      if (renderIfChanged(box, '<p class="empty-hint">載入 21 點失敗，請稍後重試。</p>')) {
        mountIcons();
      }
      return;
    }
    bj.view = payload;
    if (typeof setCasinoBalance === 'function' && payload.balance != null) {
      setCasinoBalance(payload.balance);
    }
  }

  const view = bj.view;
  const config = view.config || bj.config || BJ_DEFAULT_CONFIG;
  bj.config = config;
  const bets = Array.isArray(config.bets) ? config.bets : BJ_DEFAULT_CONFIG.bets;
  const minBet = Number(config.minBet || BJ_DEFAULT_CONFIG.minBet);
  const maxBet = Number(config.maxBet || BJ_DEFAULT_CONFIG.maxBet);

  bj.bet = Math.max(minBet, Math.min(maxBet, Number(bj.bet) || 10));
  const bet = bj.bet;
  const balance = Number((state.casino && state.casino.balance) || 0);
  const busy = Boolean(bj.busy);
  const phase = view.phase || 'idle';
  const result = view.result || bj.lastResult || null;
  const isSettled = phase === 'settled' || Boolean(result);

  bj.knownCards = bj.knownCards || new Set();
  const nextKnownCards = new Set();
  let dealIndex = 0;

  function renderCard(card, key) {
    const isNew = !bj.knownCards.has(key);
    nextKnownCards.add(key);
    const canAnimate = isNew && typeof motionEnabled === 'function' && motionEnabled();
    const dealtClass = canAnimate ? ' is-dealt' : '';
    const delayStyle = canAnimate ? ` style="animation-delay: calc(var(--stagger) * ${dealIndex++});"` : '';
    return renderPcard(card, { extraClass: dealtClass, extraAttrs: delayStyle });
  }

  // 1. 莊家區 .bj-dealer
  let dealerCards = [];
  let dealerTotalText = '';
  let dealerPointsClass = 'bj-points';

  if (isSettled && result && Array.isArray(result.dealer)) {
    dealerCards = result.dealer;
    const total = Number(result.dealerTotal || 0);
    const isBust = total > 21;
    dealerTotalText = isBust ? `${total} 點 · 莊家爆牌` : `${total} 點`;
    dealerPointsClass = isBust ? 'bj-points is-bust' : 'bj-points';
  } else if (phase === 'player' && Array.isArray(view.dealer)) {
    dealerCards = view.dealer;
    const total = Number(view.dealerVisibleTotal || 0);
    dealerTotalText = `${total} 點`;
    dealerPointsClass = 'bj-points';
  }

  const dealerCardsHtml = dealerCards.length
    ? dealerCards.map((c, i) => renderCard(c, `d-${i}-${c}`)).join('')
    : '<p class="bj-empty-hint">等待發牌…</p>';

  const dealerHtml = `
    <div class="bj-dealer">
      <div class="bj-area-header">
        <div class="bj-title-wrap">
          <span class="eyebrow">莊家</span>
          ${dealerTotalText ? `<span class="${dealerPointsClass}">${escapeHtml(dealerTotalText)}</span>` : ''}
        </div>
      </div>
      <div class="bj-cards">${dealerCardsHtml}</div>
    </div>
  `;

  // 2. 玩家區 .bj-hands
  let handsData = [];
  if (isSettled && result && Array.isArray(result.hands)) {
    handsData = result.hands;
  } else if (phase === 'player' && Array.isArray(view.hands)) {
    handsData = view.hands;
  }

  let handsHtml = '';
  if (!handsData.length) {
    handsHtml = `
      <div class="bj-hand">
        <div class="bj-area-header">
          <div class="bj-title-wrap">
            <span class="eyebrow">玩家</span>
          </div>
        </div>
        <div class="bj-cards"><p class="bj-empty-hint">等待發牌…</p></div>
      </div>
    `;
  } else {
    handsHtml = handsData.map((hand, idx) => {
      const isActive = phase === 'player' && view.active === idx;
      const activeClass = isActive ? ' is-active' : '';
      const handTitle = handsData.length > 1 ? `第 ${idx + 1} 手` : '玩家';
      const cards = Array.isArray(hand.cards) ? hand.cards : [];
      const handVal = calculateHandValue(cards);
      const total = hand.total != null ? hand.total : handVal.total;
      const soft = hand.soft != null ? hand.soft : handVal.soft;
      const pointsText = soft ? `軟 ${total}` : `${total}`;

      const handBet = Number(hand.bet || bet);
      const doubledNote = hand.doubled ? '（加倍）' : '';
      const betText = `押注 ${handBet.toLocaleString('zh-TW')} 金幣${doubledNote}`;

      let statusText = '';
      if (phase === 'player') {
        if (hand.status === 'playing') statusText = '進行中';
        else if (hand.status === 'stood') statusText = '停牌';
        else if (hand.status === 'bust') statusText = '爆牌';
        else if (hand.status === 'blackjack') statusText = '黑傑克';
        else statusText = hand.status || '進行中';
      } else {
        if (hand.outcome === 'blackjack') statusText = '黑傑克';
        else if (total > 21) statusText = '爆牌';
        else statusText = '停牌';
      }

      const cardsHtml = cards.map((c, i) => renderCard(c, `h-${idx}-${i}-${c}`)).join('');

      return `
        <div class="bj-hand${activeClass}">
          <div class="bj-area-header">
            <div class="bj-title-wrap">
              <span class="eyebrow">${escapeHtml(handTitle)}</span>
              <span class="bj-points">${escapeHtml(pointsText)}</span>
              <span class="bj-bet-tag">${escapeHtml(betText)}</span>
            </div>
            <span class="status-pill">${escapeHtml(statusText)}</span>
          </div>
          <div class="bj-cards">${cardsHtml}</div>
        </div>
      `;
    }).join('');
  }

  // 3. 動作列 .bj-actions
  let actionsHtml = '';
  if (phase === 'player') {
    actionsHtml = `
      <div class="bj-actions bj-play-actions casino-sticky-actions">
        <button type="button" class="secondary-button" data-action="bj-act" data-act="hit" ${view.canHit && !busy ? '' : 'disabled'}>要牌</button>
        <button type="button" class="secondary-button" data-action="bj-act" data-act="stand" ${view.canStand && !busy ? '' : 'disabled'}>停牌</button>
        <button type="button" class="secondary-button" data-action="bj-act" data-act="double" ${view.canDouble && !busy ? '' : 'disabled'}${view.canDouble ? '' : ' title="只有手上剛好兩張牌時才能加倍"'}>加倍</button>
        <button type="button" class="secondary-button" data-action="bj-act" data-act="split" ${view.canSplit && !busy ? '' : 'disabled'}${view.canSplit ? '' : ' title="兩張同點數、且這局還沒分過牌才能分牌"'}>分牌</button>
      </div>
    `;
  } else if (isSettled) {
    actionsHtml = `
      <div class="bj-actions casino-sticky-actions">
        <button type="button" class="primary-button" data-action="bj-again" ${busy ? 'disabled' : ''}>再來一局</button>
      </div>
    `;
  } else {
    const canDeal = !busy && balance >= bet;
    const betsHtml = bets.map((b) => {
      const active = Number(b) === Number(bet) ? ' is-active' : '';
      return `<button type="button" class="filter-tab${active}" data-action="bj-bet" data-bet="${Number(b)}" aria-pressed="${Number(b) === Number(bet) ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>${Number(b)}</button>`;
    }).join('');

    actionsHtml = `
      <div class="bj-actions">
        <div class="bj-bets">
          ${betsHtml}
          <div class="bj-custom-bet">
            <input type="number" class="bj-bet-input" id="bjBetInput" min="${minBet}" max="${maxBet}" value="${bet}" ${busy ? 'disabled' : ''} aria-label="自訂押注">
          </div>
        </div>
        <button type="button" class="primary-button" data-action="bj-deal" ${canDeal ? '' : 'disabled'}>發牌（${bet.toLocaleString('zh-TW')} 金幣）</button>
      </div>
    `;
  }

  // 4. 結果摘要 .bj-result
  let resultHtml = '';
  if (isSettled && result && Array.isArray(result.hands)) {
    const rowsHtml = result.hands.map((hand, idx) => {
      const handPrefix = result.hands.length > 1 ? `第 ${idx + 1} 手：` : '';
      let text = '';
      if (hand.outcome === 'blackjack') {
        text = `黑傑克！+${Number(hand.payout || 0).toLocaleString('zh-TW')}`;
      } else if (hand.outcome === 'win') {
        const bustNote = (Number(result.dealerTotal || 0) > 21) ? '（莊家爆牌）' : '';
        text = `贏了 +${Number(hand.payout || 0).toLocaleString('zh-TW')}${bustNote}`;
      } else if (hand.outcome === 'push') {
        text = '平手，退回押注';
      } else {
        text = '輸了';
      }
      return `<div class="bj-result-row">${escapeHtml(handPrefix)}${escapeHtml(text)}</div>`;
    }).join('');

    resultHtml = `<div class="bj-result">${rowsHtml}</div>`;
  }

  const fullHtml = `
    <div class="bj-layout">
      ${dealerHtml}
      <div class="bj-hands">${handsHtml}</div>
      ${actionsHtml}
      ${resultHtml}
    </div>
  `;

  bj.knownCards = nextKnownCards;
  if (renderIfChanged(box, fullHtml)) {
    mountIcons();
  }
}

async function blackjackDeal() {
  const bj = ensureBlackjackState();
  if (bj.busy) return;
  const userId = currentCasinoUserId();
  const minBet = Number((bj.config && bj.config.minBet) || BJ_DEFAULT_CONFIG.minBet);
  const maxBet = Number((bj.config && bj.config.maxBet) || BJ_DEFAULT_CONFIG.maxBet);
  const bet = Math.max(minBet, Math.min(maxBet, Number(bj.bet) || 10));
  bj.bet = bet;

  const balance = Number((state.casino && state.casino.balance) || 0);
  if (balance < bet) {
    toast('金幣不足');
    return;
  }

  bj.busy = true;
  bj.lastResult = null;
  bj.knownCards = new Set();
  renderCasinoBlackjack();

  const clientRoundId = casinoRoundId();
  try {
    const { response, payload } = await api('/api/casino/blackjack/deal', {
      method: 'POST',
      body: JSON.stringify({ bet, clientRoundId }),
    });

    if (currentCasinoUserId() !== userId) return;

    if (!response.ok) {
      if (payload && payload.code === 'round_in_progress') {
        const { response: getRes, payload: getPayload } = await api('/api/casino/blackjack');
        if (getRes.ok && getPayload) {
          bj.view = getPayload;
          if (typeof setCasinoBalance === 'function' && getPayload.balance != null) {
            setCasinoBalance(getPayload.balance);
          }
        }
      } else {
        toast((payload && payload.error) || '發牌失敗');
      }
    } else {
      bj.view = payload;
      if (typeof setCasinoBalance === 'function' && payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
      if (payload.phase === 'settled' && payload.result) {
        bj.lastResult = payload.result;
        const totalPayout = Number(payload.result.totalPayout || 0);
        toast(totalPayout > 0 ? `總派彩 +${totalPayout.toLocaleString('zh-TW')} 金幣` : '未獲派彩');
        if (typeof refreshCasinoHistory === 'function') refreshCasinoHistory('blackjack');
      }
    }
  } catch (_) {
    toast('網路異常，請重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      bj.busy = false;
      renderCasinoBlackjack();
    }
  }
}

async function blackjackAction(action) {
  const bj = ensureBlackjackState();
  if (bj.busy) return;
  const userId = currentCasinoUserId();
  const step = Number(bj.view && bj.view.step);
  const roundId = bj.view && bj.view.roundId;
  if (!Number.isInteger(step) || typeof roundId !== 'string') return;
  bj.busy = true;
  renderCasinoBlackjack();

  try {
    const { response, payload } = await api('/api/casino/blackjack/action', {
      method: 'POST',
      body: JSON.stringify({ action, step, roundId }),
    });

    if (currentCasinoUserId() !== userId) return;

    if (!response.ok) {
      toast((payload && payload.error) || '操作失敗');
      const { response: getRes, payload: getPayload } = await api('/api/casino/blackjack');
      if (currentCasinoUserId() !== userId) return;
      if (getRes.ok && getPayload) {
        bj.view = getPayload;
        if (typeof setCasinoBalance === 'function' && getPayload.balance != null) {
          setCasinoBalance(getPayload.balance);
        }
      }
    } else {
      bj.view = payload;
      if (typeof setCasinoBalance === 'function' && payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
      if (payload.phase === 'settled' && payload.result) {
        bj.lastResult = payload.result;
        const totalPayout = Number(payload.result.totalPayout || 0);
        toast(totalPayout > 0 ? `總派彩 +${totalPayout.toLocaleString('zh-TW')} 金幣` : '未獲派彩');
        if (typeof refreshCasinoHistory === 'function') refreshCasinoHistory('blackjack');
      }
    }
  } catch (_) {
    toast('網路異常，請重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      bj.busy = false;
      renderCasinoBlackjack();
    }
  }
}

function blackjackAgain() {
  const bj = ensureBlackjackState();
  if (bj.busy) return;
  bj.lastResult = null;
  bj.knownCards = new Set();
  bj.view = {
    phase: 'idle',
    balance: (state.casino && state.casino.balance) || 0,
    config: (bj.view && bj.view.config) || bj.config || BJ_DEFAULT_CONFIG,
  };
  renderCasinoBlackjack();
}

registerDocumentListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'bj-bet') {
    e.preventDefault();
    const bj = ensureBlackjackState();
    if (bj.busy) return;
    const next = Number(btn.dataset.bet);
    if (!Number.isFinite(next)) return;
    bj.bet = next;
    renderCasinoBlackjack();
  } else if (action === 'bj-deal') {
    e.preventDefault();
    const bj = ensureBlackjackState();
    const input = $('#bjBetInput');
    if (input) {
      const val = parseInt(input.value, 10);
      if (Number.isFinite(val)) {
        const minBet = Number((bj.config && bj.config.minBet) || BJ_DEFAULT_CONFIG.minBet);
        const maxBet = Number((bj.config && bj.config.maxBet) || BJ_DEFAULT_CONFIG.maxBet);
        bj.bet = Math.max(minBet, Math.min(maxBet, val));
      }
    }
    blackjackDeal();
  } else if (action === 'bj-act') {
    e.preventDefault();
    const act = btn.dataset.act;
    if (act) blackjackAction(act);
  } else if (action === 'bj-again') {
    e.preventDefault();
    blackjackAgain();
  }
});

registerDocumentListener('input', (e) => {
  if (e.target && e.target.id === 'bjBetInput') {
    let val = parseInt(e.target.value, 10);
    if (!Number.isFinite(val)) return;
    const bj = ensureBlackjackState();
    const maxBet = Number((bj.config && bj.config.maxBet) || BJ_DEFAULT_CONFIG.maxBet);
    if (val > maxBet) {
      val = maxBet;
      e.target.value = String(maxBet);
    }
    bj.bet = val;
    const dealBtn = $('#casinoBlackjack [data-action="bj-deal"]');
    if (dealBtn) {
      dealBtn.textContent = `發牌（${val.toLocaleString('zh-TW')} 金幣）`;
      const balance = Number((state.casino && state.casino.balance) || 0);
      dealBtn.disabled = Boolean(bj.busy || balance < val);
    }
    $$('#casinoBlackjack [data-action="bj-bet"]').forEach((b) => {
      const on = Number(b.dataset.bet) === val;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
});

registerDocumentListener('change', (e) => {
  if (e.target && e.target.id === 'bjBetInput') {
    const bj = ensureBlackjackState();
    const minBet = Number((bj.config && bj.config.minBet) || BJ_DEFAULT_CONFIG.minBet);
    const maxBet = Number((bj.config && bj.config.maxBet) || BJ_DEFAULT_CONFIG.maxBet);
    let val = parseInt(e.target.value, 10);
    if (!Number.isFinite(val) || val < minBet) val = minBet;
    if (val > maxBet) val = maxBet;
    e.target.value = String(val);
    bj.bet = val;
    renderCasinoBlackjack();
  }
});

function createPokerModal() {
  if ('blackjack' !== 'poker') return;
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
  root.classList.add('pg-official-blackjack');
  root.innerHTML = `<div class="official-balance">餘額 <strong class="pg-balance-value">${Number(officialSdk.getBalance()).toLocaleString('zh-TW')}</strong> 金幣</div><div id="casinoBlackjack" aria-live="polite"></div>`;
  releaseStyles = mountStylesheet(new URL('./game.css', import.meta.url).href);
  createPokerModal();
  for (const item of documentListeners) document.addEventListener(item.type, item.handler, item.options);
  for (const item of windowListeners) window.addEventListener(item.type, item.handler, item.options);
  renderCasinoBlackjack();
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
    root.classList.remove('pg-official-blackjack');
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
