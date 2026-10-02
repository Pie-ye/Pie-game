import { renderPcard } from '../../cards.js';
import { escapeHtml, renderIfChanged } from '../../util.js';
import { createBridge } from '../_bridge.js';

const bridge = createBridge('baccarat');
const {
  state, $, $$, api, casinoRoundId, currentCasinoUserId, ensureCasinoState,
  isAbortedResponse, mountIcons, onDocument: registerDocumentListener,
  refreshCasinoHistory, setCasinoBalance, toast,
} = bridge;


const BC_DEFAULT_CONFIG = {
  minBet: 5,
  maxBet: 100,
  bets: [5, 10, 20, 50, 100],
  odds: {
    player: 1.0,
    banker: 0.95,
    tie: 8.0,
  },
};

function ensureBaccaratState() {
  ensureCasinoState();
  if (!state.casino.baccarat) {
    state.casino.baccarat = {
      view: null,
      fetchingConfig: false,
      busy: false,
      bet: 10,
      side: 'banker',
      lastResult: null,
      animatedRoundId: null,
    };
  }
  return state.casino.baccarat;
}

function renderBaccaratCard(card, extraClass) {
  return renderPcard(card, { extraClass: extraClass ? ` ${extraClass}` : '' });
}

async function renderCasinoBaccarat() {
  const bc = ensureBaccaratState();
  const box = $('#casinoBaccarat');
  if (!box) return;

  if (!bc.view && !bc.fetchingConfig) {
    bc.fetchingConfig = true;
    const userId = currentCasinoUserId();
    api('/api/casino/baccarat/config').then(({ response, payload }) => {
      bc.fetchingConfig = false;
      if (isAbortedResponse(response)) return;
      if (currentCasinoUserId() !== userId) return;
      if (response.ok && payload) {
        bc.view = payload;
        if (payload.balance != null) {
          setCasinoBalance(payload.balance);
        }
        renderCasinoBaccarat();
      } else {
        toast((payload && payload.error) || '載入百家樂設定失敗');
      }
    }).catch(() => {
      bc.fetchingConfig = false;
    });
  }

  const config = (bc.view && bc.view.bets) ? bc.view : BC_DEFAULT_CONFIG;
  const bets = Array.isArray(config.bets) ? config.bets : BC_DEFAULT_CONFIG.bets;
  const minBet = Number(config.minBet || BC_DEFAULT_CONFIG.minBet);
  const maxBet = Number(config.maxBet || BC_DEFAULT_CONFIG.maxBet);

  bc.bet = Math.max(minBet, Math.min(maxBet, Number(bc.bet) || 10));
  const bet = bc.bet;
  const balance = Number((state.casino && state.casino.balance) || 0);
  const busy = Boolean(bc.busy);
  const res = bc.lastResult;
  const side = bc.side || 'banker';
  const isFreshThirdCard = Boolean(res && res.roundId && bc.animatedRoundId !== res.roundId);

  // 1. 發牌區（閒家、VS／結果、莊家）
  const playerCardsHtml = (res && Array.isArray(res.player) && res.player.length)
    ? res.player.map((card, idx) => renderBaccaratCard(card, idx === 2 && isFreshThirdCard ? 'bc-card-third' : '')).join('')
    : '<p class="bc-empty-hint">等待發牌…</p>';

  const bankerCardsHtml = (res && Array.isArray(res.banker) && res.banker.length)
    ? res.banker.map((card, idx) => renderBaccaratCard(card, idx === 2 && isFreshThirdCard ? 'bc-card-third' : '')).join('')
    : '<p class="bc-empty-hint">等待發牌…</p>';

  const playerPointsHtml = res && res.playerTotal != null
    ? `<span class="bc-points-badge">${escapeHtml(String(res.playerTotal))} 點${res.player.length === 2 && (res.playerTotal === 8 || res.playerTotal === 9) ? '（例牌）' : ''}</span>`
    : '';

  const bankerPointsHtml = res && res.bankerTotal != null
    ? `<span class="bc-points-badge">${escapeHtml(String(res.bankerTotal))} 點${res.banker.length === 2 && (res.bankerTotal === 8 || res.bankerTotal === 9) ? '（例牌）' : ''}</span>`
    : '';

  let vsColHtml = '<div class="bc-vs-text">VS</div>';
  if (res) {
    let outcomeTitle = '';
    let outcomeClass = '';
    if (res.result === 'player') {
      outcomeTitle = '閒家贏';
      outcomeClass = 'is-player';
    } else if (res.result === 'banker') {
      outcomeTitle = '莊家贏';
      outcomeClass = 'is-banker';
    } else {
      outcomeTitle = '和局';
      outcomeClass = 'is-tie';
    }

    const net = Number(res.net || 0);
    let netText = '';
    let netClass = '';
    if (net > 0) {
      netText = `+${net.toLocaleString('zh-TW')} 金幣`;
      netClass = 'is-gain';
    } else if (net === 0) {
      netText = `退回本金 ${Number(res.bet || 0).toLocaleString('zh-TW')} 金幣`;
      netClass = 'is-push';
    } else {
      netText = `-${Math.abs(net).toLocaleString('zh-TW')} 金幣`;
      netClass = 'is-loss';
    }

    vsColHtml = `
      <div class="bc-result-banner ${outcomeClass}">
        <span class="bc-result-title">${escapeHtml(outcomeTitle)}</span>
        <span class="bc-result-net ${netClass}">${escapeHtml(netText)}</span>
      </div>
    `;
  }

  // 2. 押注區塊：閒 1:1、和 1:8、莊 1:0.95
  const sideOptions = [
    { id: 'player', label: '閒 1:1', desc: '1 賠 1' },
    { id: 'tie', label: '和 1:8', desc: '1 賠 8（開和退回莊閒）' },
    { id: 'banker', label: '莊 1:0.95', desc: '1 賠 0.95（贏抽 5%）' },
  ];

  const sideChoicesHtml = sideOptions.map((opt) => {
    const isSelected = side === opt.id;
    return `
      <button type="button" class="bc-side-btn${isSelected ? ' is-selected' : ''}" data-action="bc-select-side" data-side="${opt.id}" aria-pressed="${isSelected}">
        <span class="bc-side-main">${escapeHtml(opt.label)}</span>
        <span class="bc-side-desc">${escapeHtml(opt.desc)}</span>
      </button>
    `;
  }).join('');

  // 3. 押注金額按鈕與輸入框
  const betChipsHtml = bets.map((b) => {
    const isSelected = Number(b) === bet;
    return `
      <button type="button" class="btn-preset chip-btn${isSelected ? ' is-active' : ''}" data-action="bc-bet" data-bet="${b}" aria-pressed="${isSelected}">
        ${b}
      </button>
    `;
  }).join('');

  // 4. 動作列（吸頂／吸底 sticky-actions）
  const sideLabelMap = { player: '閒', tie: '和', banker: '莊' };
  const currentSideName = sideLabelMap[side] || side;
  const canDeal = !busy && balance >= bet;

  const html = `
    <div class="bc-wrapper">
      <div class="bc-rules-banner">
        <span class="inline-icon" data-icon="sparkles" aria-hidden="true"></span>
        <span>補牌依標準表自動進行 · 開和時押莊閒退回 · 長期玩一定虧</span>
      </div>

      <div class="bc-table card">
        <div class="bc-hands-row">
          <div class="bc-side">
            <div class="bc-side-header">
              <span class="eyebrow">閒家 (Player)</span>
              ${playerPointsHtml}
            </div>
            <div class="bc-cards">${playerCardsHtml}</div>
          </div>

          <div class="bc-vs-col">${vsColHtml}</div>

          <div class="bc-side">
            <div class="bc-side-header">
              <span class="eyebrow">莊家 (Banker)</span>
              ${bankerPointsHtml}
            </div>
            <div class="bc-cards">${bankerCardsHtml}</div>
          </div>
        </div>

        <div class="bc-bet-choices">${sideChoicesHtml}</div>

        <div class="bc-bet-row">
          <div class="bc-bet-chips">
            <span class="eyebrow">籌碼</span>
            ${betChipsHtml}
          </div>
          <div class="bc-custom-bet">
            <label for="bcBetInput" class="eyebrow">自訂</label>
            <input type="number" id="bcBetInput" class="bc-bet-input" min="${minBet}" max="${maxBet}" value="${bet}" step="1" ${busy ? 'disabled' : ''} />
            <span class="unit">金幣</span>
          </div>
        </div>

        <div class="bc-actions casino-sticky-actions">
          <div class="bc-action-info">
            <span class="eyebrow">選擇</span>
            <span class="bc-choice-pill">押 <strong>${escapeHtml(currentSideName)}</strong> ${bet.toLocaleString('zh-TW')} 金幣</span>
          </div>
          <button type="button" class="primary-button bc-deal-btn" data-action="bc-deal" ${canDeal ? '' : 'disabled'}>
            ${busy ? '發牌中…' : `發牌（${bet.toLocaleString('zh-TW')} 金幣）`}
          </button>
        </div>
      </div>

      <section class="card bc-rules-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">百家樂規則與賠率說明</p>
            <h3>標準 Punto Banco 規則</h3>
          </div>
        </div>
        <div class="bc-rules-grid">
          <div class="bc-rule-item">
            <strong>賠率表</strong>
            <ul>
              <li><strong>閒 (Player)</strong>：1 賠 1（賭場優勢約 1.24%）</li>
              <li><strong>莊 (Banker)</strong>：1 賠 0.95（扣 5% 佣金，金額無條件捨去，賭場優勢約 1.06%）</li>
              <li><strong>和 (Tie)</strong>：1 賠 8（開和局時，押莊或押閒退回本金；賭場優勢約 14.4%）</li>
            </ul>
          </div>
          <div class="bc-rule-item">
            <strong>補牌規則</strong>
            <ul>
              <li>8 副牌每局重新洗牌，雙方先各發兩張（順序：閒、莊、閒、莊）。</li>
              <li>任一方前兩張點數為 8 或 9 形成「天生（例牌）」，雙方皆停牌。</li>
              <li>閒家 0–5 補一張牌，6–7 停牌。</li>
              <li>莊家依閒家補牌情況及自身點數，嚴格依國際標準補牌表自動進行。</li>
              <li><strong>賭博無法穩定獲利，長期玩期望值為負。</strong></li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  `;

  if (renderIfChanged(box, html)) {
    mountIcons();
  }

  if (res && res.roundId) {
    bc.animatedRoundId = res.roundId;
  }
}

async function baccaratDeal() {
  const bc = ensureBaccaratState();
  if (bc.busy) return;
  const userId = currentCasinoUserId();
  if (!userId) {
    toast('請先登入');
    return;
  }
  const bet = Number(bc.bet) || 10;
  const balance = Number((state.casino && state.casino.balance) || 0);
  if (balance < bet) {
    toast('金幣不足');
    return;
  }
  const side = bc.side || 'banker';
  const clientRoundId = casinoRoundId();

  bc.busy = true;
  renderCasinoBaccarat();

  try {
    const { response, payload } = await api('/api/casino/baccarat/play', {
      method: 'POST',
      body: JSON.stringify({ side, bet, clientRoundId }),
    });
    if (currentCasinoUserId() !== userId) return;

    if (!response.ok) {
      toast((payload && payload.error) || '遊戲發生錯誤，請重試');
      return;
    }

    bc.lastResult = payload;
    if (payload.balance != null) {
      setCasinoBalance(payload.balance);
    }
    refreshCasinoHistory('baccarat');

    const net = Number(payload.net || 0);
    const sideNameMap = { player: '閒', banker: '莊', tie: '和' };
    const outcomeName = sideNameMap[payload.result] || payload.result;
    if (net > 0) {
      toast(`開 ${outcomeName}！獲勝 +${net.toLocaleString('zh-TW')} 金幣`);
    } else if (net === 0) {
      toast(`開 ${outcomeName}！退回本金 ${bet.toLocaleString('zh-TW')} 金幣`);
    } else {
      toast(`開 ${outcomeName}！未中獎`);
    }
  } catch (_) {
    toast('網路異常，請稍後重試');
  } finally {
    if (currentCasinoUserId() === userId) {
      bc.busy = false;
      renderCasinoBaccarat();
    }
  }
}

registerDocumentListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'bc-select-side') {
    e.preventDefault();
    const bc = ensureBaccaratState();
    if (bc.busy) return;
    const targetSide = btn.dataset.side;
    if (targetSide && ['player', 'banker', 'tie'].includes(targetSide)) {
      bc.side = targetSide;
      renderCasinoBaccarat();
    }
  } else if (action === 'bc-bet') {
    e.preventDefault();
    const bc = ensureBaccaratState();
    if (bc.busy) return;
    const next = Number(btn.dataset.bet);
    if (!Number.isFinite(next)) return;
    bc.bet = next;
    renderCasinoBaccarat();
  } else if (action === 'bc-deal') {
    e.preventDefault();
    const bc = ensureBaccaratState();
    const input = $('#bcBetInput');
    if (input) {
      const val = parseInt(input.value, 10);
      if (Number.isFinite(val)) {
        const config = bc.view || BC_DEFAULT_CONFIG;
        const minBet = Number(config.minBet || BC_DEFAULT_CONFIG.minBet);
        const maxBet = Number(config.maxBet || BC_DEFAULT_CONFIG.maxBet);
        bc.bet = Math.max(minBet, Math.min(maxBet, val));
      }
    }
    baccaratDeal();
  }
});

registerDocumentListener('input', (e) => {
  if (e.target && e.target.id === 'bcBetInput') {
    let val = parseInt(e.target.value, 10);
    if (!Number.isFinite(val)) return;
    const bc = ensureBaccaratState();
    const config = bc.view || BC_DEFAULT_CONFIG;
    const maxBet = Number(config.maxBet || BC_DEFAULT_CONFIG.maxBet);
    if (val > maxBet) {
      val = maxBet;
      e.target.value = String(maxBet);
    }
    bc.bet = val;
    const dealBtn = $('#casinoBaccarat [data-action="bc-deal"]');
    if (dealBtn) {
      dealBtn.textContent = `發牌（${val.toLocaleString('zh-TW')} 金幣）`;
      const balance = Number((state.casino && state.casino.balance) || 0);
      dealBtn.disabled = Boolean(bc.busy || balance < val);
    }
    $$('#casinoBaccarat [data-action="bc-bet"]').forEach((b) => {
      const on = Number(b.dataset.bet) === val;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
});

registerDocumentListener('change', (e) => {
  if (e.target && e.target.id === 'bcBetInput') {
    const bc = ensureBaccaratState();
    const config = bc.view || BC_DEFAULT_CONFIG;
    const minBet = Number(config.minBet || BC_DEFAULT_CONFIG.minBet);
    const maxBet = Number(config.maxBet || BC_DEFAULT_CONFIG.maxBet);
    let val = parseInt(e.target.value, 10);
    if (!Number.isFinite(val) || val < minBet) val = minBet;
    if (val > maxBet) val = maxBet;
    e.target.value = String(val);
    bc.bet = val;
    renderCasinoBaccarat();
  }
});

export function mount(target, officialSdk) {
  bridge.mount(target, officialSdk, {
    panelId: 'casinoBaccarat',
    live: true,
    styleUrl: new URL('./game.css', import.meta.url).href,
    render: renderCasinoBaccarat,
  });
}

export function unmount() {
  bridge.unmount();
}
