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
      tab: 'poker',
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

/* 賭場：德州撲克。
   .pcard 牌面元件：直接呼叫 casino-blackjack.js 匯出的全域 renderPcard(card)，跟 21 點
   共用同一份 HTML 結構／class 與 rank 對照表（T→10 等），不會各寫各的兩套牌面邏輯。
   德撲牌桌要塞進橢圓座位圈、一手最多同時攤 5 張公牌 + 多位玩家底牌，21 點那組尺寸
   （走 --control-h）直接套用會爆版，所以額外用 `.pk-board .pcard` / `.pk-cards .pcard`
   （比裸 .pcard 多一層祖先、特異度較高）把卡片縮小、收掉中央大花色浮水印，只留
   .pcard-corner 的 rank+suit；casino.css 有對應的 .pk- 覆寫規則。 */

const POKER_POLL_TABLE_MS = 2000;
const POKER_POLL_LOBBY_MS = 5000;
const POKER_SEATS = [0, 1, 2, 3, 4, 5];
const POKER_PHASE_LABELS = { waiting: '等待中', playing: '進行中', between: '換手中' };

function ensurePokerState() {
  const casino = ensureCasinoState();
  if (!casino.poker) {
    casino.poker = {
      tables: null,
      tableId: null,
      view: null,
      busy: false,
      pollTimer: null,
      buyIn: 100,
      raiseTo: null,
      // seq/lastApplied 不在 brief 列的欄位裡，是 review 第 1 輪 finding 2 要求加的：
      // 輪詢 GET 與動作 POST 是各自獨立的 fetch，先送出的 GET 可能因為網路延遲比後送出的
      // POST 還晚回來，若兩邊都直接覆寫 pk.view，剛做完的動作就可能被一個較舊的畫面蓋掉。
      seq: 0,
      lastApplied: 0,
    };
  }
  return casino.poker;
}

/* ============================== DOM 骨架 ============================== */

function ensurePokerDom() {
  const root = $('#casinoPoker');
  if (!root) return null;
  if (root.querySelector('.pk-content')) return root;
  root.innerHTML = `
    <div class="pk-content"></div>`;
  mountIcons();
  return root;
}

/* ============================== 牌面 ============================== */

function pkCardHtml(card) {
  return renderPcard(card);
}

function pkCardBackHtml() {
  return renderPcard('??');
}

function pkCardEmptyHtml() {
  return '<span class="pcard is-empty" aria-hidden="true"></span>';
}

function pkCardsRowHtml(cards) {
  return `<div class="pk-cards">${cards.map((c) => (c === '??' ? pkCardBackHtml() : pkCardHtml(c))).join('')}</div>`;
}

/* ============================== 讀取 ============================== */

async function fetchPokerTables(pk) {
  const { response, payload } = await api('/api/casino/poker/tables');
  if (isAbortedResponse(response)) return false;
  if (!response.ok) {
    toast(payload.error || '載入牌桌失敗');
    return false;
  }
  pk.tables = payload;
  if (typeof payload.balance === 'number') setCasinoBalance(payload.balance);
  return true;
}

/* pending 離桌（leave 回 {pending:true}）之後，這手繼續打，本人座位在後端於這手結束時
   才真的被移除；下一次輪詢的 payload 就不會再有 you。舊畫面若記得「本人先前 leaving
   為真」，這裡判斷是離桌完成了，自動清 tableId、回大廳，使用者不用自己想辦法逃出觀戰畫面。
   同時每次回應都設一次 balance（有才設，桌視圖多半沒有，這裡的 typeof 檢查跟其他讀取路徑
   一致）。*/
function applyPokerView(pk, payload) {
  const previousYou = pk.view && pk.view.you;
  const prevHand = pk.view && pk.view.lastResult ? pk.view.lastResult.handNo : null;
  pk.view = payload;
  const nextHand = payload.lastResult ? payload.lastResult.handNo : null;
  if (nextHand != null && nextHand !== prevHand && (payload.you || previousYou)
      && typeof refreshCasinoHistory === 'function') {
    refreshCasinoHistory('poker');
  }
  if (typeof payload.balance === 'number') setCasinoBalance(payload.balance);
  if (!payload.you && previousYou && previousYou.leaving) {
    pk.tableId = null;
    pk.view = null;
    toast('已離桌');
    return 'left';
  }
  return true;
}

async function fetchPokerTable(pk, tableId) {
  const mySeq = (pk.seq += 1);
  const { response, payload } = await api(`/api/casino/poker/tables/${encodeURIComponent(tableId)}`);
  if (isAbortedResponse(response)) return false;
  if (!response.ok) {
    toast(payload.error || '載入牌桌失敗');
    return false;
  }
  // 輪詢的 GET 跟動作的 POST 是各自獨立的 fetch，先送出的 GET 可能比後送出、
  // 已經套用過的動作回應還晚到；比 lastApplied 舊的直接丟棄，不讓它蓋掉新狀態。
  if (mySeq < pk.lastApplied) return false;
  pk.lastApplied = mySeq;
  return applyPokerView(pk, payload);
}

/* ============================== 桌列表 ============================== */

function renderPokerLobby(pk) {
  ensurePokerDom();
  const content = $('#casinoPoker .pk-content');
  if (!content) return;
  const data = pk.tables || {};
  const tables = data.tables || [];
  const yourTable = data.yourTable || null;
  const yourTableRow = yourTable ? tables.find((t) => t.tableId === yourTable) : null;
  const yourTableName = yourTableRow ? yourTableRow.name : '';

  const cardsHtml = tables.map((t) => {
    const isYours = yourTable === t.tableId;
    const blocked = Boolean(yourTable) && !isYours;
    const phaseLabel = POKER_PHASE_LABELS[t.phase] || t.phase;
    const ctaLabel = isYours ? '回到牌桌' : '入座';
    const note = blocked ? `<p class="pk-lobby-note">你在 ${escapeHtml(yourTableName)} 桌</p>` : '';
    return `
      <button type="button" class="card pk-table-card" data-action="pk-open-table" data-table-id="${escapeHtml(t.tableId)}" data-is-yours="${isYours ? '1' : '0'}" ${blocked ? 'disabled' : ''}>
        <h3 class="pk-lobby-name">${escapeHtml(t.name)}</h3>
        <p class="pk-lobby-meta">盲注 ${Number(t.blinds[0])} / ${Number(t.blinds[1])}</p>
        <p class="pk-lobby-meta">${Number(t.seated)} / ${Number(t.maxSeats)} 人</p>
        <p class="pk-lobby-phase">${escapeHtml(phaseLabel)}</p>
        ${note}
        <span class="pk-lobby-cta">${ctaLabel}</span>
      </button>`;
  }).join('');

  renderIfChanged(content, `<div class="pk-lobby">${cardsHtml}</div>`);
}

/* ============================== 牌桌 ============================== */

function isDraggingPokerRange() {
  const el = document.activeElement;
  return Boolean(el && el.id === 'pkRaiseRange' && el.closest && el.closest('.pk-actions'));
}

function pokerFeltHtml(view) {
  const board = view.board || [];
  const boardCells = [0, 1, 2, 3, 4].map((i) => (board[i] ? pkCardHtml(board[i]) : pkCardEmptyHtml())).join('');
  let phaseMsg = '';
  if (view.phase === 'waiting') {
    phaseMsg = '<p class="pk-phase-message">等待第二位玩家…</p>';
  } else if (view.phase === 'between') {
    const secs = Math.max(0, Math.ceil(Number(view.nextHandAt || 0)));
    phaseMsg = `<p class="pk-phase-message">下一手 ${secs} 秒後開始</p>`;
  }
  return `
    <div class="pk-felt">
      <div class="pk-board">${boardCells}</div>
      <p class="pk-pot">底池 ${Number(view.pot || 0).toLocaleString('zh-TW')}</p>
      ${phaseMsg}
    </div>`;
}

function pokerSeatsCellsHtml(view) {
  const bySeat = {};
  (view.seats || []).forEach((s) => { bySeat[s.seat] = s; });
  const youSeat = view.you ? view.you.seat : null;
  return POKER_SEATS.map((n) => {
    const seat = bySeat[n];
    if (!seat) {
      return `<div class="pk-seat is-empty-seat" data-seat="${n}"><p class="pk-seat-empty">空位</p></div>`;
    }
    const classes = ['pk-seat'];
    if (seat.folded) classes.push('is-folded');
    if (seat.isActor) classes.push('is-actor');
    if (youSeat === seat.seat) classes.push('is-you');
    const dealerBadge = seat.isDealer ? '<span class="pk-dealer-badge">D</span>' : '';
    const timerHtml = seat.isActor
      ? `<p class="pk-seat-timer">${Math.max(0, Math.ceil(Number(seat.timeLeft || 0)))} 秒</p>`
      : '';
    const cardsHtml = seat.cards ? pkCardsRowHtml(seat.cards) : '';
    const betHtml = Number(seat.bet || 0) > 0
      ? `<p class="pk-seat-bet">下注 ${Number(seat.bet).toLocaleString('zh-TW')}</p>`
      : '';
    return `
      <div class="${classes.join(' ')}" data-seat="${n}">
        <p class="pk-seat-name">${escapeHtml(seat.username)}${dealerBadge}</p>
        <p class="pk-seat-stack">${Number(seat.stack).toLocaleString('zh-TW')}</p>
        ${betHtml}
        ${cardsHtml}
        ${timerHtml}
      </div>`;
  }).join('');
}

function pokerActionsHtml(view) {
  const you = view.you;
  if (!you || !you.inHand) return '';
  const pk = ensurePokerState();
  const busy = Boolean(pk.busy);
  /* 後端 view() 的 you 物件沒有 isActor 欄位（只有 seats[] 裡每一位才有）：
     canFold / canCall / minRaise 三者都只在輪到你時才會非 false／非 null，
     所以「現在是不是你」用這三個既有欄位推回去，而不是去讀一個不存在的鍵。 */
  const isActor = Boolean(you.canFold || you.canCall || (you.minRaise !== null && you.minRaise !== undefined));
  const callAmount = Number(you.callAmount || 0);
  const callLabel = callAmount === 0 ? '過牌' : `跟注 ${callAmount.toLocaleString('zh-TW')}`;
  const foldDisabled = busy || !isActor || !you.canFold;
  const callDisabled = busy || !isActor || !you.canCall;
  const hasRaise = you.minRaise !== null && you.minRaise !== undefined;

  let raiseHtml = '';
  if (hasRaise) {
    const minRaise = Number(you.minRaise);
    const maxRaise = Number(you.maxRaise);
    const raiseTo = pk.raiseTo != null ? Number(pk.raiseTo) : minRaise;
    const raiseDisabled = busy || !isActor;
    raiseHtml = `
      <div class="pk-raise">
        <label for="pkRaiseRange">加注到</label>
        <input id="pkRaiseRange" type="range" min="${minRaise}" max="${maxRaise}" step="1" value="${raiseTo}" data-action="pk-raise-range" ${raiseDisabled ? 'disabled' : ''} />
        <strong class="pk-raise-value">${raiseTo.toLocaleString('zh-TW')}</strong>
        <button type="button" class="secondary-button" data-action="pk-raise-confirm" ${raiseDisabled ? 'disabled' : ''}>確定</button>
      </div>`;
  }

  const waitMsg = !isActor ? '<p class="pk-actions-wait">等待其他玩家</p>' : '';
  return `
    <div class="pk-actions casino-sticky-actions">
      ${waitMsg}
      <div class="pk-actions-row">
        <button type="button" class="secondary-button" data-action="pk-fold" ${foldDisabled ? 'disabled' : ''}>棄牌</button>
        <button type="button" class="primary-button" data-action="pk-call" ${callDisabled ? 'disabled' : ''}>${callLabel}</button>
      </div>
      ${raiseHtml}
    </div>`;
}

function pokerAsideHtml(view) {
  const log = (view.log || []).slice(-10);
  const logHtml = log.length
    ? `<ul class="pk-log">${log.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : '<p class="empty-hint">尚無紀錄</p>';

  let resultHtml = '';
  if (view.lastResult) {
    const r = view.lastResult;
    const winners = (r.winners || [])
      .map((w) => `${escapeHtml(w.username)} +${Number(w.amount).toLocaleString('zh-TW')}`)
      .join('、');
    const showdown = (r.showdown || [])
      .map((s) => `${escapeHtml(s.username)}：${(s.cards || []).map((c) => escapeHtml(c)).join(' ')} ${escapeHtml(s.handName || '')}`)
      .join('<br>');
    resultHtml = `
      <div class="pk-last-result">
        <p class="eyebrow">第 ${Number(r.handNo)} 手結果</p>
        ${winners ? `<p class="pk-result-winners">${winners}</p>` : ''}
        ${showdown ? `<p class="pk-result-showdown">${showdown}</p>` : ''}
      </div>`;
  }

  let leaveHtml = '';
  if (view.you) {
    const leaving = Boolean(view.you.leaving);
    leaveHtml = `<button type="button" class="secondary-button pk-leave" data-action="pk-leave" ${leaving ? 'disabled' : ''}>${leaving ? '這手打完就離桌' : '離桌'}</button>`;
  } else {
    // 沒有 you 就是觀戰畫面（例如 pending 離桌完成前，本人座位還沒被移除的過渡狀態）：
    // 永遠給一顆回大廳鍵，不依賴任何自動偵測，使用者不會被困在這裡沒有出路。
    leaveHtml = '<button type="button" class="secondary-button pk-leave" data-action="pk-back">回大廳</button>';
  }

  return `
    <div class="pk-aside">
      ${resultHtml}
      <div class="pk-log-wrap">
        <p class="eyebrow">最近動態</p>
        ${logHtml}
      </div>
      ${leaveHtml}
    </div>`;
}

function pokerTableHtml(view) {
  return `
    <div class="pk-table">
      <div class="pk-table-header">
        <h3>${escapeHtml(view.name)}</h3>
        <span class="pk-blinds">盲注 ${Number(view.blinds[0])} / ${Number(view.blinds[1])}</span>
        <span class="pk-handno">第 ${Number(view.handNo)} 手</span>
      </div>
      <div class="pk-surface">
        ${pokerFeltHtml(view)}
        <div class="pk-seats-region">${pokerSeatsCellsHtml(view)}</div>
      </div>
      ${pokerActionsHtml(view)}
      ${pokerAsideHtml(view)}
    </div>`;
}

function renderPokerTableView(pk) {
  ensurePokerDom();
  const view = pk.view;
  const content = $('#casinoPoker .pk-content');
  if (!content || !view) return;
  if (isDraggingPokerRange()) {
    const seatsRegion = content.querySelector('.pk-seats-region');
    if (seatsRegion) renderIfChanged(seatsRegion, pokerSeatsCellsHtml(view));
    return;
  }
  renderIfChanged(content, pokerTableHtml(view));
}

/* ============================== 輪詢 ============================== */

function stopPokerPolling() {
  const casino = state.casino;
  const pk = casino && casino.poker;
  if (pk && pk.pollTimer) {
    clearInterval(pk.pollTimer);
    pk.pollTimer = null;
  }
}

function startPokerPolling() {
  const panel = $('#casinoPoker');
  const active = Boolean(state.user)
    && currentView() === 'casino'
    && state.casino
    && state.casino.tab === 'poker'
    && panel
    && !panel.hidden
    && !document.hidden;
  if (!active) {
    stopPokerPolling();
    return;
  }
  const pk = ensurePokerState();
  stopPokerPolling();
  const ms = pk.tableId ? POKER_POLL_TABLE_MS : POKER_POLL_LOBBY_MS;
  pk.pollTimer = setInterval(() => { renderCasinoPoker(); }, ms);
}

/* ============================== 主渲染入口 ============================== */

let pokerFetchSeq = 0;

async function renderCasinoPoker() {
  ensureCasinoState();
  const pk = ensurePokerState();
  ensurePokerDom();
  const seq = (pokerFetchSeq += 1);
  if (!pk.tableId) {
    const ok = await fetchPokerTables(pk);
    if (seq !== pokerFetchSeq) return;
    if (ok) renderPokerLobby(pk);
  } else {
    const result = await fetchPokerTable(pk, pk.tableId);
    if (seq !== pokerFetchSeq) return;
    if (result === 'left') {
      const lobbyOk = await fetchPokerTables(pk);
      if (seq !== pokerFetchSeq) return;
      if (lobbyOk) renderPokerLobby(pk);
    } else if (result) {
      renderPokerTableView(pk);
    }
  }
  startPokerPolling();
}

/* ============================== 買入對話框 ============================== */

function openPokerSitModal(tableId) {
  ensurePokerDom();
  const pk = ensurePokerState();
  pk.buyIn = 100;
  const gate = $('#pkSitGate');
  if (!gate) return;
  gate.dataset.tableId = tableId;
  gate.hidden = false;
  gate.setAttribute('aria-hidden', 'false');
  const range = $('#pkBuyInRange');
  if (range) range.value = '100';
  const out = $('#pkBuyInValue');
  if (out) out.textContent = '100';
}

function closePokerSitModal() {
  const gate = $('#pkSitGate');
  if (!gate) return;
  gate.hidden = true;
  gate.setAttribute('aria-hidden', 'true');
}

async function confirmPokerSit() {
  const gate = $('#pkSitGate');
  const tableId = gate && gate.dataset.tableId;
  if (!tableId) return;
  const pk = ensurePokerState();
  const buyIn = Number(pk.buyIn) || 100;
  closePokerSitModal();
  const mySeq = (pk.seq += 1);
  const { response, payload } = await api(`/api/casino/poker/tables/${encodeURIComponent(tableId)}/sit`, {
    method: 'POST',
    body: JSON.stringify({ buyIn }),
  });
  if (isAbortedResponse(response)) return;
  if (!response.ok) {
    toast(payload.error || '入座失敗');
    renderCasinoPoker();
    return;
  }
  // 動作回應一律視為最新：不管期間有沒有更晚送出、還沒回來的輪詢 GET，這裡都直接推高
  // lastApplied，往後任何比這次動作舊的回應都會被 fetchPokerTable 的 mySeq 比對丟棄。
  pk.lastApplied = Math.max(pk.lastApplied, mySeq);
  pk.tableId = tableId;
  applyPokerView(pk, payload);
  pk.raiseTo = null;
  refreshCasinoBalance();
  renderCasinoPoker();
}

/* ============================== 動作 ============================== */

async function pokerAct(action, amount) {
  const pk = ensurePokerState();
  if (pk.busy || !pk.tableId) return;
  pk.busy = true;
  renderPokerTableView(pk);
  const body = { action };
  if (amount !== undefined && amount !== null) body.amount = amount;
  const mySeq = (pk.seq += 1);
  const { response, payload } = await api(`/api/casino/poker/tables/${encodeURIComponent(pk.tableId)}/act`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  pk.busy = false;
  if (isAbortedResponse(response)) return;
  if (!response.ok) {
    toast(payload.error || '操作失敗');
    renderCasinoPoker();
    return;
  }
  pk.lastApplied = Math.max(pk.lastApplied, mySeq);
  pk.raiseTo = null;
  const result = applyPokerView(pk, payload);
  if (result === 'left') {
    renderCasinoPoker();
    return;
  }
  renderPokerTableView(pk);
  startPokerPolling();
}

async function pokerLeave() {
  const pk = ensurePokerState();
  if (pk.busy || !pk.tableId) return;
  pk.busy = true;
  renderPokerTableView(pk);
  const mySeq = (pk.seq += 1);
  const { response, payload } = await api(`/api/casino/poker/tables/${encodeURIComponent(pk.tableId)}/leave`, {
    method: 'POST',
  });
  pk.busy = false;
  if (isAbortedResponse(response)) return;
  if (!response.ok) {
    toast(payload.error || '離桌失敗');
    renderCasinoPoker();
    return;
  }
  pk.lastApplied = Math.max(pk.lastApplied, mySeq);
  if (payload.pending) {
    toast('這手打完會自動離桌');
    applyPokerView(pk, payload);
    pk.raiseTo = null;
    renderPokerTableView(pk);
    startPokerPolling();
    return;
  }
  pk.tableId = null;
  pk.view = null;
  pk.raiseTo = null;
  if (typeof payload.balance === 'number') setCasinoBalance(payload.balance);
  refreshCasinoBalance();
  renderCasinoPoker();
}

/* ============================== 事件委派 ============================== */

registerDocumentListener('click', (e) => {
  const target = e.target.closest && e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'pk-open-table') {
    e.preventDefault();
    const tableId = target.dataset.tableId;
    const pk = ensurePokerState();
    if (target.dataset.isYours === '1') {
      pk.tableId = tableId;
      pk.view = null;
      renderCasinoPoker();
    } else {
      openPokerSitModal(tableId);
    }
  } else if (action === 'close-pk-sit-modal') {
    e.preventDefault();
    closePokerSitModal();
  } else if (action === 'pk-sit-confirm') {
    e.preventDefault();
    confirmPokerSit();
  } else if (action === 'pk-fold') {
    e.preventDefault();
    pokerAct('fold');
  } else if (action === 'pk-call') {
    e.preventDefault();
    pokerAct('call');
  } else if (action === 'pk-raise-confirm') {
    e.preventDefault();
    const rangeEl = $('#pkRaiseRange');
    const pk = ensurePokerState();
    const amount = rangeEl ? Number(rangeEl.value) : Number(pk.raiseTo);
    pokerAct('raise', amount);
  } else if (action === 'pk-leave') {
    e.preventDefault();
    pokerLeave();
  } else if (action === 'pk-back') {
    e.preventDefault();
    const pk = ensurePokerState();
    pk.tableId = null;
    pk.view = null;
    renderCasinoPoker();
  }
});

registerDocumentListener('input', (e) => {
  const target = e.target;
  if (!target || !target.dataset) return;
  if (target.dataset.action === 'pk-buyin-range') {
    const pk = ensurePokerState();
    pk.buyIn = Number(target.value);
    const out = $('#pkBuyInValue');
    if (out) out.textContent = Number(pk.buyIn).toLocaleString('zh-TW');
  } else if (target.dataset.action === 'pk-raise-range') {
    const pk = ensurePokerState();
    pk.raiseTo = Number(target.value);
    const wrap = target.closest('.pk-raise');
    const out = wrap && wrap.querySelector('.pk-raise-value');
    if (out) out.textContent = Number(pk.raiseTo).toLocaleString('zh-TW');
  }
});

/* ============================== 輪詢的停止訊號 ==============================
   switchCasinoTab（casino.js）換到別的分頁時只會切換 #casinoPoker 的 hidden，
   不會呼叫 renderCasinoPoker()，所以這裡不能改 switchCasinoTab，只能用
   MutationObserver 盯 hidden 屬性；換 view（hash 改變）時 #casinoPoker 的
   hidden 完全不會變，另外要接 hashchange 才停得掉。 */


registerDocumentListener('visibilitychange', () => { startPokerPolling(); });
registerWindowListener('hashchange', () => { stopPokerPolling(); });

function createPokerModal() {
  if ('poker' !== 'poker') return;
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
  root.classList.add('pg-official-poker');
  root.innerHTML = `<div class="official-balance">餘額 <strong class="pg-balance-value">${Number(officialSdk.getBalance()).toLocaleString('zh-TW')}</strong> 金幣</div><div id="casinoPoker" aria-live="polite"></div>`;
  releaseStyles = mountStylesheet(new URL('./game.css', import.meta.url).href);
  createPokerModal();
  for (const item of documentListeners) document.addEventListener(item.type, item.handler, item.options);
  for (const item of windowListeners) window.addEventListener(item.type, item.handler, item.options);
  renderCasinoPoker();
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
    root.classList.remove('pg-official-poker');
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
