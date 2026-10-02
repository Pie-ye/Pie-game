import { renderPcard } from '../../cards.js';
import { escapeHtml, renderIfChanged } from '../../util.js';
import { createBridge } from '../_bridge.js';

const bridge = createBridge('niuniu');
const {
  state, $, api, casinoRoundId, currentCasinoUserId, ensureCasinoState,
  isAbortedResponse, mountIcons, onDocument: registerDocumentListener,
  refreshCasinoHistory, setCasinoBalance, toast,
} = bridge;


const NN_DEFAULT_CONFIG = {
  minBet: 5,
  maxBet: 100,
  bets: [5, 10, 20, 50, 100],
  lockMult: 5,
};

function ensureNiuniuState() {
  ensureCasinoState();
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
      if (isAbortedResponse(response)) return;
      if (currentCasinoUserId() !== userId) return;
      if (!response.ok) {
        toast((payload && payload.error) || '載入妞妞失敗');
        renderIfChanged(box, '<p class="empty-hint">載入妞妞失敗，請稍後重試。</p>');
        return;
      }
      nn.config = payload;
      if (payload.balance != null) {
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
    if (payload.balance != null) {
      setCasinoBalance(payload.balance);
    }
    const net = Number(payload.net || 0);
    toast(net > 0 ? `贏得 ${net.toLocaleString('zh-TW')} 金幣` : `輸掉 ${Math.abs(net).toLocaleString('zh-TW')} 金幣`);
    refreshCasinoHistory('niu_niu');
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

export function mount(target, officialSdk) {
  bridge.mount(target, officialSdk, {
    panelId: 'casinoNiuniu',
    live: true,
    styleUrl: new URL('./game.css', import.meta.url).href,
    render: renderCasinoNiuniu,
  });
}

export function unmount() {
  bridge.unmount();
}
