import { CONTENT_ORIGIN } from './config.js';
import { casinoRoundId, fetchSession, getUser, playCommunity, playTicket, setBalance } from './api.js';
import { escapeHtml, rtpPercent } from './util.js';
import { bindDockHotkeys } from './hotkeys.js';

const BETS = [5, 10, 20, 50, 100];
// 節流 3 秒，對齊 SDK 的 ticketTimeoutMs（5 秒）：10 秒的話 SDK 會先 timeout。
// 一個遊戲最多 20 張／分鐘，仍低於股票大亂鬥的每人每分鐘 30 張上限。
const TICKET_INTERVAL_MS = 3000;

let listener = null;
let iframe = null;
let current = null;
let generation = 0;
let abort = null;
let unbindHotkeys = null;

// 遊戲回報的高度只當「想要多高」：真正的上限由 CSS（視窗高度扣掉頂欄與控制列）決定，
// 遊戲畫面永遠跟控制列一起留在同一個畫面裡。
function clampHeight(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.max(Math.ceil(n), 120), 1600);
}

function isLive(id) {
  return Boolean(current && current.mountId === id && iframe && iframe.contentWindow);
}

function postToGame(payload, id) {
  if (!isLive(id)) return;
  iframe.contentWindow.postMessage(payload, CONTENT_ORIGIN);
}

function userPayload() {
  const user = getUser();
  if (!user) return null;
  return { id: user.id, displayName: user.displayName || user.username };
}

export function allowedBets(spec) {
  const min = Number(spec && spec.minBet != null ? spec.minBet : 5);
  const max = Number(spec && spec.maxBet != null ? spec.maxBet : 100);
  const hits = BETS.filter((b) => b >= min && b <= max);
  if (hits.length) return hits;
  if (min === max) return [min];
  return [min, max];
}

async function sendInit(id) {
  // ready＝iframe 送了 pg:ready；activated＝外框已經知道登入狀態（與金幣規格）。兩個都到才回 pg:init。
  if (!isLive(id) || !current.ready || !current.activated || current.initSent) return;
  current.initSent = true;
  const { game, toast } = current;
  const payload = {
    type: 'pg:init',
    gameId: game.id,
    user: userPayload(),
  };
  if (game.multiplayer && getUser()) {
    const { response, payload: ticketBody } = await playTicket(game.id, { signal: abort && abort.signal });
    if (!isLive(id)) return;
    if (response && response.aborted) return;
    if (response.ok && ticketBody && ticketBody.ticket) {
      payload.ticket = ticketBody.ticket;
    } else {
      const err = (ticketBody && ticketBody.error) || '無法取得遊玩通行證';
      if (toast) toast(err);
      payload.ticket = null;
      payload.ticketError = err;
    }
  }
  postToGame(payload, id);
}

async function sendFreshTicket(id) {
  if (!isLive(id) || !getUser()) return;
  if (!current.game.multiplayer) return;
  const now = Date.now();
  if (current.lastTicketAt && now - current.lastTicketAt < TICKET_INTERVAL_MS) return;
  current.lastTicketAt = now;
  const { response, payload } = await playTicket(current.game.id, { signal: abort && abort.signal });
  if (!isLive(id) || (response && response.aborted)) return;
  if (response.ok && payload && payload.ticket) {
    postToGame({ type: 'pg:ticket', ticket: payload.ticket }, id);
  } else if (current.toast) {
    current.toast((payload && payload.error) || '無法取得遊玩通行證');
  }
}

/**
 * 下注請求被 unmount 中止（或回應晚於離開）時，背景重抓一次 session 對帳，
 * 因為伺服器可能已經扣款。失敗不 toast：使用者已經離開這一頁了。
 */
async function reconcileBalance(onBalance) {
  const sess = await fetchSession();
  if (onBalance) onBalance(sess ? sess.balance : 0);
}

function rtpLineFor(choiceId) {
  const choices = (current && current.spec && current.spec.choices) || [];
  const selected = choices.find((c) => c.id === choiceId);
  const pct = selected ? rtpPercent(selected.rtp) : null;
  return pct != null ? `回饋率 ${pct}%，長期玩一定虧` : '長期玩一定虧';
}

function syncChoice(choice) {
  if (!current || !choice) return;
  current.choice = choice;
  const bar = document.getElementById('coinBetBar');
  if (!bar) return;
  bar.querySelectorAll('[data-choice]').forEach((el) => {
    const on = el.getAttribute('data-choice') === choice;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const note = bar.querySelector('.rtp-note');
  if (note) note.textContent = rtpLineFor(choice);
}

const CHOICE_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', 'a', 's'];

function renderBetBar(root, { spec, onPlay, mountId: id }) {
  const bar = document.createElement('div');
  bar.className = 'pg-dock casino-sticky-actions';
  bar.id = 'coinBetBar';

  if (!getUser()) {
    bar.innerHTML = `<p class="pg-dock-note rtp-note">金幣遊戲的下注由外框送出，長期玩一定虧。</p>
      <div class="pg-dock-act"><a class="primary-button pg-dock-primary" href="#/login">登入後才能下注</a></div>`;
    root.appendChild(bar);
    return bar;
  }

  const choices = (spec && spec.choices) || [];
  current.choice = current.choice || (choices[0] && choices[0].id) || '';
  const bets = allowedBets(spec);
  current.bet = bets.includes(current.bet) ? current.bet : bets[0];

  // 只有一個選項時不必選，選項區整個省掉。
  const choiceHtml = choices.length > 1 ? choices.map((c, i) => {
    const key = CHOICE_KEYS[i] ? ` data-key="${CHOICE_KEYS[i]}"` : '';
    return `<button type="button" class="pg-seg choice-btn${c.id === current.choice ? ' is-active' : ''}" data-choice="${escapeHtml(c.id)}"${key} aria-pressed="${c.id === current.choice ? 'true' : 'false'}">${escapeHtml(c.label || c.id)}</button>`;
  }).join('') : '';

  const betHtml = bets.map((b) => (
    `<button type="button" class="pg-chip bet-btn${b === current.bet ? ' is-active' : ''}" data-bet="${b}" aria-pressed="${b === current.bet ? 'true' : 'false'}">${b}</button>`
  )).join('');

  bar.innerHTML = `
    ${choiceHtml ? `<div class="pg-dock-pick choice-row" role="group" aria-label="選項">${choiceHtml}</div>` : ''}
    <div class="pg-dock-bet bet-row" role="group" aria-label="押注"><span class="pg-dock-label">押注</span>${betHtml}</div>
    <p class="pg-dock-note rtp-note">${escapeHtml(rtpLineFor(current.choice))}</p>
    <div class="pg-dock-act play-row">
      <button type="button" class="primary-button pg-dock-primary" id="playBtn">下注</button>
    </div>
  `;
  root.appendChild(bar);

  bar.addEventListener('click', async (ev) => {
    if (!isLive(id)) return;
    const choiceBtn = ev.target.closest('[data-choice]');
    if (choiceBtn) {
      syncChoice(choiceBtn.getAttribute('data-choice'));
      return;
    }
    const betBtn = ev.target.closest('[data-bet]');
    if (betBtn) {
      current.bet = Number(betBtn.getAttribute('data-bet'));
      bar.querySelectorAll('[data-bet]').forEach((el) => {
        const on = Number(el.getAttribute('data-bet')) === current.bet;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      return;
    }
    if (ev.target.closest('#playBtn')) {
      if (current.playing) return;
      current.playing = true;
      bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await onPlay({ choice: current.choice, bet: current.bet });
      } finally {
        if (isLive(id) && current) {
          current.playing = false;
          bar.querySelectorAll('button').forEach((b) => { b.disabled = false; });
        }
      }
    }
  });

  return bar;
}

function onMessage(event, id) {
  if (!isLive(id) || event.source !== iframe.contentWindow) return;
  if (event.origin !== CONTENT_ORIGIN) return;
  const data = event.data || {};
  const type = data.type;
  if (type === 'pg:ready') {
    if (current.readyHandled) return;
    current.readyHandled = true;
    current.ready = true;
    sendInit(id);
    return;
  }
  if (type === 'pg:height') {
    const px = clampHeight(data.px != null ? data.px : data.height);
    if (px != null) iframe.style.setProperty('--frame-h', `${px}px`);
    return;
  }
  if (type === 'pg:select') {
    syncChoice(data.choice);
    return;
  }
  if (type === 'pg:ticket') {
    if (!current.game.multiplayer) return;
    sendFreshTicket(id);
  }
}

export function unmountCommunity() {
  generation += 1;
  if (abort) {
    try { abort.abort(); } catch (_) { /* ignore */ }
    abort = null;
  }
  if (listener) {
    window.removeEventListener('message', listener);
    listener = null;
  }
  if (unbindHotkeys) {
    unbindHotkeys();
    unbindHotkeys = null;
  }
  iframe = null;
  current = null;
}

/** 外框頁首的全螢幕鈕：把 iframe 整個放大（遊戲自己不必處理）。 */
export function requestCommunityFullscreen() {
  if (iframe && iframe.requestFullscreen) iframe.requestFullscreen();
}

/** 投稿遊戲的網址。有 release 時走 /r/<sha>/…：內容不會變，瀏覽器與 Cloudflare 都能永久快取。 */
export function communityGameUrl(game, release) {
  const prefix = release ? `/r/${encodeURIComponent(release)}` : '';
  return `${CONTENT_ORIGIN}${prefix}/games/community/${encodeURIComponent(game.id)}/${game.entry || 'index.html'}`;
}

// ── 大廳預熱 ──────────────────────────────────────────────
// 遊戲 HTML 從源站回來要一整趟 tunnel（慢網路 0.6 秒以上），是點進投稿遊戲時最慢的一步。
// 玩家還在大廳時，用「不能跑腳本」的隱藏 iframe 先把 /r/<sha>/ 底下的頁面載一次：
// 內容不會變（immutable），瀏覽器快取起來，真的點進去時 HTML、CSS、主程式都直接命中快取。
// 必須是 iframe：瀏覽器的快取依「頂層網站＋框架網站」分區，外框自己 fetch 的結果 iframe 用不到。
// sandbox 只給 allow-same-origin、不給 allow-scripts：投稿程式碼一行都不會執行
// （DevTools 會印「Blocked script execution … sandboxed」，那就是它在擋，正常）。
const WARM_LIMIT = 8;
const WARM_PARALLEL = 3;
const WARM_TIMEOUT_MS = 10000;
const warmed = new Set();
let warmQueue = [];
let warming = 0;

function warmNext() {
  if (warming >= WARM_PARALLEL) return;
  const url = warmQueue.shift();
  if (!url) return;
  warming += 1;
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('allow', "autoplay 'none'; fullscreen 'none'; gamepad 'none'");
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.className = 'pg-warm-frame';
  frame.style.display = 'none';
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    frame.remove();
    warming -= 1;
    warmNext();
  };
  const timer = setTimeout(finish, WARM_TIMEOUT_MS);
  frame.addEventListener('load', finish, { once: true });
  frame.addEventListener('error', finish, { once: true });
  frame.src = url;
  document.body.appendChild(frame);
  warmNext();
}

/**
 * 預熱投稿遊戲。urgent＝玩家已經指到這張卡片，插到佇列最前面。
 * 沒有 release（開發模式、伺服器沒內嵌開機資料）時網址不能快取，預熱沒有意義，直接略過。
 */
export function warmCommunity(game, release, { urgent = false } = {}) {
  if (!release || !game || !game.id) return;
  const url = communityGameUrl(game, release);
  if (warmed.has(url)) return;
  if (!urgent && warmed.size >= WARM_LIMIT) return;
  warmed.add(url);
  if (urgent) warmQueue.unshift(url);
  else warmQueue.push(url);
  warmNext();
}

/** 離開大廳時清掉還沒開始的預熱，別跟真正要玩的遊戲搶頻寬。 */
export function cancelWarmQueue() {
  for (const url of warmQueue) warmed.delete(url);
  warmQueue = [];
}

/**
 * 先把 iframe 掛上去開始下載，登入狀態還不用知道。
 * 外框確定登入狀態（金幣遊戲還要有規格）之後呼叫 activateCommunity()，
 * 才畫下注列、回 pg:init；在那之前遊戲送來的 pg:ready 會先記著。
 */
export function mountCommunity(root, { game, release, toast, refreshHistory, onBalance }) {
  unmountCommunity();
  const id = generation;
  abort = new AbortController();
  current = {
    mountId: id,
    root,
    game,
    spec: null,
    toast,
    refreshHistory,
    onBalance,
    ready: false,
    readyHandled: false,
    activated: false,
    initSent: false,
    lastTicketAt: 0,
    choice: '',
    bet: null,
    playing: false,
  };

  const wrap = document.createElement('div');
  wrap.className = 'community-frame-wrap';
  iframe = document.createElement('iframe');
  iframe.className = 'community-frame';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
  iframe.setAttribute('allow', 'fullscreen; gamepad; autoplay');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.title = game.name || game.id;
  iframe.src = communityGameUrl(game, release);
  wrap.appendChild(iframe);
  root.appendChild(wrap);

  listener = (event) => onMessage(event, id);
  window.addEventListener('message', listener);
}

export function activateCommunity({ spec } = {}) {
  if (!current || current.activated) return;
  const id = current.mountId;
  if (!isLive(id)) return;
  const { root, game, toast, refreshHistory, onBalance } = current;
  current.spec = spec || null;
  current.activated = true;

  if (game.multiplayer && !getUser()) {
    const banner = document.createElement('p');
    banner.className = 'mp-banner';
    banner.textContent = '登入後才能加入多人房間';
    root.insertBefore(banner, root.firstChild);
  }

  if (game.kind === 'coin') {
    renderBetBar(root, {
      spec,
      mountId: id,
      onPlay: async ({ choice, bet }) => {
        const { response, payload } = await playCommunity(game.id, {
          choice,
          bet,
          clientRoundId: casinoRoundId(),
          signal: abort && abort.signal,
        });
        if (!isLive(id) || (response && response.aborted)) {
          // 中止的請求結果不明，成功但晚到的結果也還沒記帳：兩種都背景對帳一次。
          if ((response && response.aborted) || response.ok) void reconcileBalance(onBalance);
          return;
        }
        if (!response.ok) {
          if (toast) toast((payload && payload.error) || '下注失敗');
          return;
        }
        if (payload.balance != null) {
          setBalance(payload.balance);
          if (onBalance) onBalance(payload.balance);
        }
        postToGame({
          type: 'pg:result',
          choice: payload.choice,
          outcome: payload.outcome,
          display: payload.display,
          bet: payload.bet,
          payout: payload.payout,
          net: payload.net,
        }, id);
        const net = Number(payload.net || 0);
        const sign = net > 0 ? '+' : (net < 0 ? '−' : '');
        // display 是投稿遊戲自訂的物件（給 iframe 畫面用），提示只用結果名稱。
        const outcome = payload.outcome;
        const outcomeLabel = outcome && typeof outcome === 'object' ? outcome.label : outcome;
        const label = typeof outcomeLabel === 'string' && outcomeLabel ? outcomeLabel : '開獎';
        if (toast) toast(`${label} · 淨 ${sign}${Math.abs(net)}`);
        if (refreshHistory) await refreshHistory();
      },
    });
    unbindHotkeys = bindDockHotkeys(() => root);
  }

  sendInit(id);
}
