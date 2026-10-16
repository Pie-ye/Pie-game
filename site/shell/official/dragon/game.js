import { renderPcard } from '../../cards.js';
import { escapeHtml, renderIfChanged } from '../../util.js';
import { createBridge } from '../_bridge.js';

const bridge = createBridge('dragon');
const {
  state, $, api, casinoRoundId, currentCasinoUserId, ensureCasinoState,
  isAbortedResponse, mountIcons, onDocument: registerDocumentListener,
  refreshCasinoHistory, setCasinoBalance, toast,
} = bridge;


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
  ensureCasinoState();
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
    if (isAbortedResponse(response)) return;
    if (currentCasinoUserId() !== currentUid) return;
    if (!response.ok) {
      toast((payload && payload.error) || '載入射龍門失敗');
      if (renderIfChanged(box, '<p class="empty-hint">載入射龍門失敗，請稍後重試。</p>')) {
        mountIcons();
      }
      return;
    }
    dg.view = payload;
    if (payload.balance != null) {
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
  const leftCard = gates[0] ? renderPcard(gates[0]) : renderPcard('??');
  const rightCard = gates[1] ? renderPcard(gates[1]) : renderPcard('??');
  let middleCard = renderPcard('??');

  if (phase === 'settled' && third) {
    middleCard = renderPcard(third);
  } else if (phase === 'dealt') {
    middleCard = renderPcard('??');
  }

  const tableHtml = `
    <div class="dg-table-felt">
      <div class="dg-roof" aria-hidden="true"><i></i><b>龍門</b><i></i></div>
      <span class="dg-lantern is-l" aria-hidden="true"></span><span class="dg-lantern is-r" aria-hidden="true"></span>
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

  // 3. 控制列：押注籌碼一直在同一個位置，主要按鈕（發柱／下注進門／再發一次）永遠在最右邊。
  const chipsHtml = bets.map((b) => {
    const active = Number(b) === Number(currentBet) ? ' is-active' : '';
    return `<button type="button" class="pg-chip${active}" data-action="dg-chip" data-bet="${Number(b)}" aria-pressed="${active ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>${Number(b)}</button>`;
  }).join('');
  const betGroupHtml = `<div class="pg-dock-bet" role="group" aria-label="押注"><span class="pg-dock-label">押注</span>${chipsHtml}</div>`;

  let actHtml = '';
  let noteHtml = '';
  if (phase === 'dealt') {
    const isPair = Boolean(view.pair);
    const options = Array.isArray(view.options) ? view.options : [];
    const passHtml = `<button type="button" class="secondary-button" data-action="dg-pass" data-key="f" ${busy ? 'disabled' : ''}>放棄</button>`;
    if (!isPair && options.length > 0) {
      const opt = options[0];
      const canBet = !busy && balance >= currentBet * opt.pillarMult;
      noteHtml = '<p class="pg-dock-note">撞柱賠 2 倍押注</p>';
      actHtml = `${passHtml}
        <button type="button" class="primary-button pg-dock-primary" data-action="dg-bet" data-choice="inside" ${canBet ? '' : 'disabled'}>下注進門 · ×${escapeHtml(String(opt.payout))}</button>`;
    } else if (isPair) {
      noteHtml = '<p class="pg-dock-note">對子：猜大或猜小，撞柱賠 3 倍押注</p>';
      const sorted = options.slice().sort((a, b) => (a.choice === 'low' ? -1 : 0) - (b.choice === 'low' ? -1 : 0));
      const pairBtns = sorted.map((opt) => {
        const canBet = !busy && balance >= currentBet * opt.pillarMult;
        const isHigh = opt.choice === 'high';
        const key = isHigh ? 'd ArrowRight' : 'a ArrowLeft';
        return `<button type="button" class="primary-button" data-action="dg-bet" data-choice="${escapeHtml(opt.choice)}" data-key="${key}" ${canBet ? '' : 'disabled'}>${isHigh ? '猜大' : '猜小'} · ×${escapeHtml(String(opt.payout))}</button>`;
      }).join('');
      actHtml = `${passHtml}${pairBtns}`;
    }
  } else {
    const label = phase === 'settled' ? '再發一次柱' : '發柱';
    actHtml = `<button type="button" class="primary-button pg-dock-primary" data-action="dg-deal" ${busy ? 'disabled' : ''}>${busy ? '發柱中…' : label}</button>`;
  }

  const actionsHtml = `
    <div class="pg-dock casino-sticky-actions">
      ${betGroupHtml}
      ${noteHtml}
      <div class="pg-dock-act">${actHtml}</div>
    </div>
  `;

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

  if (renderIfChanged(box, fullHtml)) {
    mountIcons();
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
      if (payload.balance != null) {
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
      if (payload.balance != null) {
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

  const clientRoundId = casinoRoundId();

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
      if (payload.balance != null) {
        setCasinoBalance(payload.balance);
      }
      refreshCasinoHistory('dragon');

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

export function mount(target, officialSdk) {
  bridge.mount(target, officialSdk, {
    panelId: 'casinoDragon',
    live: true,
    styleUrl: new URL('./game.css', import.meta.url).href,
    render: renderCasinoDragon,
  });
}

export function unmount() {
  bridge.unmount();
}
