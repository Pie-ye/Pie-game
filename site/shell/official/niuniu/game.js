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
      tab: 'niuniu',
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


const NN_DEFAULT_CONFIG = {
  minBet: 5,
  maxBet: 100,
  bets: [5, 10, 20, 50, 100],
  lockMult: 5,
};

function ensureNiuniuState() {
  if (typeof ensureCasinoState === 'function') ensureCasinoState();
  if (!state.casino) {
    state.casino = {
      userId: currentCasinoUserId(),
      tab: 'niuniu',
      balance: 0,
      slots: { config: null, spinning: false, last: null, bet: 5 },
    };
  }
  if (!state.casino.niuniu) {
    state.casino.niuniu = {
      config: null,
      result: null,
      busy: false,
      loading: false,
      bet: 10,
    };
  }
  return state.casino.niuniu;
}

function niuniuCards(cards, split) {
  const list = Array.isArray(cards) ? cards : [];
  if (Array.isArray(split) && split.length === 2) {
    return `<div class="nn-cards has-split">
      <div class="nn-card-group">${(split[0] || []).map((card) => renderPcard(card)).join('')}</div>
      <div class="nn-card-group">${(split[1] || []).map((card) => renderPcard(card)).join('')}</div>
    </div>`;
  }
  return `<div class="nn-cards"><div class="nn-card-group">${list.map((card) => renderPcard(card)).join('')}</div></div>`;
}

function niuniuHand(title, cards, hand) {
  const safeHand = hand || {};
  const handName = safeHand.name || '無牛';
  return `<section class="nn-hand">
    <div class="nn-hand-title"><span class="eyebrow">${escapeHtml(title)}</span></div>
    ${niuniuCards(cards, safeHand.split)}
    <div class="nn-hand-name">${escapeHtml(handName)}</div>
  </section>`;
}

function niuniuMarkup(nn) {
  const config = nn.config || NN_DEFAULT_CONFIG;
  const bets = Array.isArray(config.bets) ? config.bets : NN_DEFAULT_CONFIG.bets;
  const minBet = Number(config.minBet || NN_DEFAULT_CONFIG.minBet);
  const maxBet = Number(config.maxBet || NN_DEFAULT_CONFIG.maxBet);
  const lockMult = Number(config.lockMult || NN_DEFAULT_CONFIG.lockMult);
  nn.bet = Math.max(minBet, Math.min(maxBet, Number(nn.bet) || 10));
  const bet = nn.bet;
  const balance = Number((state.casino && state.casino.balance) || 0);
  const lock = bet * lockMult;
  const canPlay = !nn.busy && balance >= lock;
  const result = nn.result;

  const handsHtml = result ? `<div class="nn-hands">
    ${niuniuHand('莊家', result.banker, result.bankerHand)}
    ${niuniuHand('你', result.player, result.playerHand)}
  </div>` : `<div class="nn-waiting">
    <span class="eyebrow">單人對莊家</span>
    <p>選好押注後開牌，系統會自動找出三張成牛的組合。</p>
  </div>`;

  let resultHtml = '';
  if (result) {
    const multiplier = Number(result.mult || 1);
    const net = Number(result.net || 0);
    const resultText = result.winner === 'player'
      ? `贏 ×${multiplier} +${Math.abs(net).toLocaleString('zh-TW')}`
      : `輸 ×${multiplier} −${Math.abs(net).toLocaleString('zh-TW')}`;
    resultHtml = `<div class="nn-result ${result.winner === 'player' ? 'is-win' : 'is-loss'}" role="status">
      ${escapeHtml(resultText)}
    </div>`;
  }

  const betsHtml = bets.map((value) => {
    const amount = Number(value);
    const active = amount === bet ? ' is-active' : '';
    return `<button type="button" class="filter-tab${active}" data-action="nn-bet" data-bet="${amount}" aria-pressed="${amount === bet ? 'true' : 'false'}" ${nn.busy ? 'disabled' : ''}>${amount}</button>`;
  }).join('');

  return `<div class="nn-layout">
    ${handsHtml}
    ${resultHtml}
    <div class="nn-rules">
      <div class="nn-rule-copy">
        <h3>倍率表</h3>
        <p>同牌型比最大張、平手算莊家贏、閒家贏抽 5%。</p>
      </div>
      <div class="nn-paytable" aria-label="妞妞倍率表">
        <span><strong>五花牛</strong> ×5</span>
        <span><strong>牛牛</strong> ×3</span>
        <span><strong>牛七～牛九</strong> ×2</span>
        <span><strong>其餘</strong> ×1</span>
      </div>
      <p class="nn-warning">每局先凍結 5 倍押注，結算後退回。長期玩一定虧。</p>
    </div>
    <div class="nn-actions casino-sticky-actions">
      <div class="nn-bets" aria-label="選擇押注">${betsHtml}</div>
      <button type="button" class="primary-button" data-action="nn-play" ${canPlay ? '' : 'disabled'}>${nn.busy ? '開牌中…' : `開牌（先凍結 ${lock.toLocaleString('zh-TW')}）`}</button>
    </div>
  </div>`;
}

async function renderCasinoNiuniu() {
  const nn = ensureNiuniuState();
  const box = $('#casinoNiuniu');
  if (!box) return;

  if (!nn.config && !nn.loading) {
    const userId = currentCasinoUserId();
    nn.loading = true;
    renderIfChanged(box, '<p class="empty-hint">載入妞妞中…</p>');
    try {
      const { response, payload } = await api('/api/casino/niuniu/config');
      if (currentCasinoUserId() !== userId) return;
      if (!response.ok) {
        toast((payload && payload.error) || '載入妞妞失敗');
        renderIfChanged(box, '<p class="empty-hint">載入妞妞失敗，請稍後重試。</p>');
        return;
      }
      nn.config = payload;
      if (typeof setCasinoBalance === 'function' && payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
    } catch (_) {
      if (currentCasinoUserId() !== userId) return;
      toast('網路異常，請重試');
      renderIfChanged(box, '<p class="empty-hint">載入妞妞失敗，請稍後重試。</p>');
      return;
    } finally {
      if (currentCasinoUserId() === userId) nn.loading = false;
    }
  }

  if (!nn.config) return;
  if (renderIfChanged(box, niuniuMarkup(nn))) mountIcons();
}

async function niuniuPlay() {
  const nn = ensureNiuniuState();
  if (nn.busy) return;
  const userId = currentCasinoUserId();
  const config = nn.config || NN_DEFAULT_CONFIG;
  const minBet = Number(config.minBet || NN_DEFAULT_CONFIG.minBet);
  const maxBet = Number(config.maxBet || NN_DEFAULT_CONFIG.maxBet);
  const lockMult = Number(config.lockMult || NN_DEFAULT_CONFIG.lockMult);
  const bet = Math.max(minBet, Math.min(maxBet, Number(nn.bet) || 10));
  nn.bet = bet;
  const balance = Number((state.casino && state.casino.balance) || 0);
  if (balance < bet * lockMult) {
    toast('金幣不足，每局需先凍結 5 倍押注');
    return;
  }

  nn.busy = true;
  renderCasinoNiuniu();
  try {
    const { response, payload } = await api('/api/casino/niuniu/play', {
      method: 'POST',
      body: JSON.stringify({ bet, clientRoundId: casinoRoundId() }),
    });
    if (currentCasinoUserId() !== userId) return;
    if (!response.ok) {
      toast((payload && payload.error) || '開牌失敗');
      return;
    }
    nn.result = payload;
    if (typeof setCasinoBalance === 'function' && payload.balance != null) {
      setCasinoBalance(payload.balance);
    }
    const net = Number(payload.net || 0);
    toast(net > 0 ? `贏得 ${net.toLocaleString('zh-TW')} 金幣` : `輸掉 ${Math.abs(net).toLocaleString('zh-TW')} 金幣`);
    if (typeof refreshCasinoHistory === 'function') refreshCasinoHistory('niu_niu');
  } catch (_) {
    if (currentCasinoUserId() === userId) toast('網路異常，請重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      nn.busy = false;
      renderCasinoNiuniu();
    }
  }
}

registerDocumentListener('click', (event) => {
  const button = event.target.closest && event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'nn-bet') {
    event.preventDefault();
    const nn = ensureNiuniuState();
    if (nn.busy) return;
    const bet = Number(button.dataset.bet);
    if (!Number.isFinite(bet)) return;
    nn.bet = bet;
    renderCasinoNiuniu();
  } else if (button.dataset.action === 'nn-play') {
    event.preventDefault();
    niuniuPlay();
  }
});

function createPokerModal() {
  if ('niuniu' !== 'poker') return;
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
  root.classList.add('pg-official-niuniu');
  root.innerHTML = `<div class="official-balance">餘額 <strong class="pg-balance-value">${Number(officialSdk.getBalance()).toLocaleString('zh-TW')}</strong> 金幣</div><div id="casinoNiuniu" aria-live="polite"></div>`;
  releaseStyles = mountStylesheet(new URL('./game.css', import.meta.url).href);
  createPokerModal();
  for (const item of documentListeners) document.addEventListener(item.type, item.handler, item.options);
  for (const item of windowListeners) window.addEventListener(item.type, item.handler, item.options);
  renderCasinoNiuniu();
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
    root.classList.remove('pg-official-niuniu');
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
