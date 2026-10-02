import { renderPcard } from '../../cards.js';
import { escapeHtml, motionEnabled, renderIfChanged } from '../../util.js';
import { createBridge } from '../_bridge.js';

const bridge = createBridge('blackjack');
const {
  state, $, $$, api, casinoRoundId, currentCasinoUserId, ensureCasinoState,
  isAbortedResponse, mountIcons, onDocument: registerDocumentListener,
  refreshCasinoHistory, setCasinoBalance, toast,
} = bridge;

const BJ_DEFAULT_CONFIG = {
  minBet: 5,
  maxBet: 100,
  bets: [5, 10, 20, 50, 100],
};

function ensureBlackjackState() {
  ensureCasinoState();
  if (!state.casino.blackjack) {
    state.casino.blackjack = { view: null, busy: false, bet: 10 };
  }
  return state.casino.blackjack;
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
    if (isAbortedResponse(response)) return;
    if (!response.ok) {
      toast((payload && payload.error) || '載入 21 點失敗');
      if (renderIfChanged(box, '<p class="empty-hint">載入 21 點失敗，請稍後重試。</p>')) {
        mountIcons();
      }
      return;
    }
    bj.view = payload;
    if (payload.balance != null) {
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
    const canAnimate = isNew && motionEnabled();
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
          if (getPayload.balance != null) {
            setCasinoBalance(getPayload.balance);
          }
        }
      } else {
        toast((payload && payload.error) || '發牌失敗');
      }
    } else {
      bj.view = payload;
      if (payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
      if (payload.phase === 'settled' && payload.result) {
        bj.lastResult = payload.result;
        const totalPayout = Number(payload.result.totalPayout || 0);
        toast(totalPayout > 0 ? `總派彩 +${totalPayout.toLocaleString('zh-TW')} 金幣` : '未獲派彩');
        refreshCasinoHistory('blackjack');
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
        if (getPayload.balance != null) {
          setCasinoBalance(getPayload.balance);
        }
      }
    } else {
      bj.view = payload;
      if (payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
      if (payload.phase === 'settled' && payload.result) {
        bj.lastResult = payload.result;
        const totalPayout = Number(payload.result.totalPayout || 0);
        toast(totalPayout > 0 ? `總派彩 +${totalPayout.toLocaleString('zh-TW')} 金幣` : '未獲派彩');
        refreshCasinoHistory('blackjack');
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

export function mount(target, officialSdk) {
  bridge.mount(target, officialSdk, {
    panelId: 'casinoBlackjack',
    live: true,
    styleUrl: new URL('./game.css', import.meta.url).href,
    render: renderCasinoBlackjack,
  });
}

export function unmount() {
  bridge.unmount();
}
