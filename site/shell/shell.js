import { CONTENT_ORIGIN, REGISTER_URL } from './config.js';
import {
  api,
  casinoRoundId,
  clearAuth,
  fetchCommunity,
  fetchHistory,
  fetchSession,
  getBalance,
  getUser,
  login as apiLogin,
  logout as apiLogout,
  prefetch,
  setBalance,
  setUnauthorizedHandler,
} from './api.js';
import { createOfficialSdk } from './official-sdk.js';
import { escapeHtml, formatCoins } from './util.js';
import { renderHistory } from './history.js';
import {
  activateCommunity,
  cancelWarmQueue,
  mountCommunity,
  notifyTheme,
  requestCommunityFullscreen,
  unmountCommunity,
  warmCommunity,
} from './community-host.js';
import { setRollingText, swapView } from './motion.js';

const THEMES = ['cyber', 'playful'];
const DEFAULT_THEME = 'cyber';
// v0.2 以前的兩套主題已經拿掉，存過的人一律換成賽博。
const RETIRED_THEMES = { studio: 'cyber', classic: 'cyber' };
const THEME_KEY = 'pg_theme';

// firstGet：遊戲掛上後第一個打的 GET。點進遊戲時先預取，跟下載遊戲模組同時跑。
export const OFFICIAL_GAMES = [
  { id: 'slots', name: '拉霸', description: '三輪拉霸', historyGame: 'slots', firstGet: '/api/casino/slots/config' },
  { id: 'blackjack', name: '21 點', description: '對莊家比點', historyGame: 'blackjack', firstGet: '/api/casino/blackjack' },
  { id: 'poker', name: '德州撲克', description: '多人牌桌', historyGame: 'poker', firstGet: '/api/casino/poker/tables' },
  { id: 'dragon', name: '射龍門', description: '門柱比大小', historyGame: 'dragon_gate', firstGet: '/api/casino/dragon' },
  { id: 'niuniu', name: '妞妞', description: '五張比牌型', historyGame: 'niu_niu', firstGet: '/api/casino/niuniu/config' },
  { id: 'baccarat', name: '百家樂', description: '閒莊和', historyGame: 'baccarat', firstGet: '/api/casino/baccarat/config' },
];

const OFFICIAL_BY_ID = Object.fromEntries(OFFICIAL_GAMES.map((g) => [g.id, g]));

const catalog = {
  submissions: [],
  casinoById: new Map(),
  release: null,
  loaded: false,
  casinoLoaded: false,
};

// 伺服器內嵌在首頁的開機資料（投稿目錄、金幣遊戲清單、內容 release）。
// 直接用靜態伺服器打開 index.html 時沒有這份，就退回瀏覽器自己抓。
function readBootData() {
  const el = document.getElementById('pg-boot');
  if (!el) return null;
  try {
    const data = JSON.parse(el.textContent || 'null');
    return data && typeof data === 'object' ? data : null;
  } catch (_) {
    return null;
  }
}

let sessionSettled = false;
let sessionPromise = null;
let catalogPromise = null;
let casinoPromise = null;

let currentOfficial = null;
let routeSeq = 0;
let menuCloseListener = null;
let loginDialog = null;

// Toast 堆疊（Arc Toast stack）：最多疊 3 則，新的在最前面；滑鼠移上去展開並暫停計時；
// 同一句話連續出現時不再疊一則，改成輕彈一下。
const TOAST_MAX = 3;
const TOAST_LINGER_MS = 1500;
let toastPaused = false;

function toastRegion() {
  const region = document.getElementById('toast');
  if (region && !region.dataset.bound) {
    region.dataset.bound = '1';
    region.addEventListener('mouseenter', () => {
      toastPaused = true;
      region.dataset.expanded = 'true';
      for (const item of region.children) clearTimeout(item._timer);
    });
    region.addEventListener('mouseleave', () => {
      toastPaused = false;
      region.dataset.expanded = 'false';
      for (const item of region.children) scheduleToast(item, TOAST_LINGER_MS);
    });
  }
  return region;
}

function layoutToasts(region) {
  const live = Array.from(region.children).filter((item) => !item.dataset.leaving);
  live.reverse().forEach((item, index) => {
    item.style.setProperty('--i', String(index));
    item.dataset.front = index === 0 ? 'true' : 'false';
  });
}

function dismissToast(item) {
  if (!item || item.dataset.leaving) return;
  clearTimeout(item._timer);
  item.dataset.leaving = 'true';
  const region = item.parentElement;
  if (region) layoutToasts(region);
  const remove = () => item.remove();
  item.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 400);
}

function scheduleToast(item, duration) {
  clearTimeout(item._timer);
  if (toastPaused) return;
  item._timer = setTimeout(() => dismissToast(item), duration);
}

function toast(message, duration = 3200) {
  const region = toastRegion();
  const text = String(message || '');
  if (!region || !text) return;
  const wait = typeof duration === 'number' ? duration : 3200;
  const same = Array.from(region.children).find((item) => item.dataset.text === text && !item.dataset.leaving);
  if (same) {
    same.classList.remove('is-bump');
    void same.offsetWidth;
    same.classList.add('is-bump');
    region.appendChild(same);
    layoutToasts(region);
    scheduleToast(same, wait);
    return;
  }
  const item = document.createElement('li');
  item.className = 'toast-item';
  item.dataset.text = text;
  item.textContent = text;
  region.appendChild(item);
  const live = Array.from(region.children).filter((node) => !node.dataset.leaving);
  while (live.length > TOAST_MAX) dismissToast(live.shift());
  layoutToasts(region);
  scheduleToast(item, wait);
}

function applyTheme(theme) {
  const mapped = RETIRED_THEMES[theme] || theme;
  const next = THEMES.includes(mapped) ? mapped : DEFAULT_THEME;
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (_) {
    /* ignore */
  }
  const select = document.getElementById('themeSelect');
  if (select && select.value !== next) select.value = next;
  notifyTheme(next);
}

function bootTheme() {
  let saved = DEFAULT_THEME;
  try {
    saved = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
  } catch (_) {
    saved = DEFAULT_THEME;
  }
  applyTheme(saved);
}

function detachMenuCloseListener() {
  if (!menuCloseListener) return;
  document.removeEventListener('click', menuCloseListener);
  menuCloseListener = null;
}

// 金幣一律是真的帳本餘額（測試金幣模式已關閉）；只有一般遊戲不扣金幣。
function balanceLabel(value) {
  return `${formatCoins(value)} 金幣`;
}

function renderChrome() {
  detachMenuCloseListener();
  const user = getUser();
  const pill = document.getElementById('balancePill');
  if (pill) {
    if (user) {
      pill.hidden = false;
      // Arc Slot text：餘額變動時數字逐位捲動（減少動態時直接換字）。
      setRollingText(pill, balanceLabel(getBalance()));
    } else {
      pill.hidden = true;
    }
  }
  const slot = document.getElementById('authSlot');
  if (!slot) return;
  slot.className = 'auth-slot';
  if (!user && !sessionSettled) {
    // 還不知道有沒有登入：先留白，免得已登入的人看到「登入」按鈕閃一下。
    slot.innerHTML = '';
    return;
  }
  if (user) {
    const name = user.displayName || user.username;
    slot.innerHTML = `<div class="user-menu" id="userMenu">
        <button type="button" class="user-menu-toggle secondary-button" id="userMenuToggle" aria-expanded="false" aria-haspopup="true" aria-label="使用者選單">${escapeHtml(name)}</button>
        <div class="user-menu-panel" id="userMenuPanel">
          <span class="user-name">${escapeHtml(name)}</span>
          <button type="button" class="secondary-button" id="logoutBtn">登出</button>
        </div>
      </div>`;
    const menu = slot.querySelector('#userMenu');
    const toggle = slot.querySelector('#userMenuToggle');
    // 「點外面關閉」的 listener 只在選單開著時掛著，關閉與重畫頂欄時都移除。
    const closeMenu = () => {
      menu.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
      detachMenuCloseListener();
    };
    const openMenu = () => {
      menu.classList.add('is-open');
      toggle.setAttribute('aria-expanded', 'true');
      detachMenuCloseListener();
      menuCloseListener = (ev) => {
        if (!menu.contains(ev.target)) closeMenu();
      };
      document.addEventListener('click', menuCloseListener);
    };
    toggle.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (menu.classList.contains('is-open')) closeMenu();
      else openMenu();
    });
    slot.querySelector('#logoutBtn').addEventListener('click', async () => {
      // apiLogout() 不論伺服器怎麼回都會清本地狀態。
      const { response, payload } = await apiLogout();
      const serverDone = response.ok || response.status === 401 || response.status === 403;
      renderChrome();
      if (location.hash && location.hash !== '#/') location.hash = '#/';
      else route();
      toast(serverDone ? '已登出' : `${(payload && payload.error) || '登出失敗'}，已在本機登出`);
    });
  } else {
    slot.innerHTML = `<a class="primary-button" href="#/login">登入</a>`;
  }
}

function parseRoute() {
  const raw = (location.hash || '#/').replace(/^#/, '') || '/';
  const path = raw.split('?')[0];
  if (path === '/login') return { name: 'login' };
  const game = path.match(/^\/game\/([^/]+)\/?$/);
  if (game) return { name: 'game', id: decodeURIComponent(game[1]) };
  return { name: 'lobby' };
}

function applyCasinoList(payload) {
  const games = payload && Array.isArray(payload.games) ? payload.games : [];
  catalog.casinoById = new Map(games.map((g) => [g.id, g]));
  catalog.casinoLoaded = true;
}

function ensureCasinoList() {
  if (catalog.casinoLoaded) return Promise.resolve();
  if (!casinoPromise) {
    casinoPromise = fetchCommunity()
      .catch(() => ({ response: { ok: false }, payload: {} }))
      .then((res) => {
        applyCasinoList(res.response.ok ? res.payload : null);
      });
  }
  return casinoPromise;
}

async function fetchSubmissions() {
  const indexJson = await fetch(`${CONTENT_ORIGIN}/games/community/index.json`, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : { games: [] }))
    .catch(() => ({ games: [] }));

  const ids = [];
  for (const item of indexJson.games || []) {
    if (typeof item === 'string') ids.push(item);
    else if (item && item.id) ids.push(item.id);
  }

  const results = await Promise.all(ids.map(async (id) => {
    try {
      const res = await fetch(`${CONTENT_ORIGIN}/games/community/${encodeURIComponent(id)}/game.json`, {
        credentials: 'omit',
      });
      if (!res.ok) return null;
      const json = await res.json();
      // id 與資料夾不一致的遊戲直接丟掉：拿它當 key 會對錯規格、也開錯 iframe。
      if (!json || json.id !== id) return null;
      return json;
    } catch (_) {
      return null;
    }
  }));
  return results.filter(Boolean);
}

function ensureCatalog() {
  if (catalog.loaded) return Promise.resolve();
  if (!catalogPromise) {
    catalogPromise = fetchSubmissions().then((games) => {
      catalog.submissions = games;
      catalog.loaded = true;
    });
  }
  return catalogPromise;
}

function applyBootData(data) {
  if (!data) return;
  if (typeof data.release === 'string' && data.release) catalog.release = data.release;
  if (Array.isArray(data.games)) {
    catalog.submissions = data.games.filter((g) => g && typeof g.id === 'string');
    catalog.loaded = true;
  }
  if (data.casino && Array.isArray(data.casino.games)) applyCasinoList(data.casino);
}

function ensureSession() {
  if (!sessionPromise) {
    sessionPromise = fetchSession().finally(() => {
      sessionSettled = true;
    });
  }
  return sessionPromise;
}

function cardHtml(game, extraTags = [], { community = false } = {}) {
  const tags = [];
  const seen = new Set();
  for (const t of [...(game.tags || []), ...extraTags]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
  }
  const data = community ? ` data-community="${escapeHtml(game.id)}"` : '';
  return `<a class="game-card" href="#/game/${encodeURIComponent(game.id)}"${data}>
    <h3>${escapeHtml(game.name || game.id)}</h3>
    ${game.author ? `<p class="author">${escapeHtml(game.author)}</p>` : ''}
    ${game.description ? `<p class="desc">${escapeHtml(game.description)}</p>` : ''}
    <div class="tag-row">${tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
  </a>`;
}

function partitionSubmissions() {
  const coin = [];
  const free = [];
  const multi = [];
  for (const g of catalog.submissions) {
    if (g.multiplayer) {
      multi.push(g);
      continue;
    }
    if (g.kind === 'coin') {
      if (catalog.casinoById.has(g.id)) coin.push(g);
      continue;
    }
    free.push(g);
  }
  return { coin, free, multi };
}

function renderLobby(view) {
  const { coin, free, multi } = partitionSubmissions();
  const officialCards = OFFICIAL_GAMES.map((g) => cardHtml({
    id: g.id,
    name: g.name,
    description: g.description,
    tags: ['官方'],
  })).join('');
  let coinCards = '<p class="empty-hint">載入金幣遊戲中…</p>';
  if (catalog.casinoLoaded) {
    coinCards = coin.length
      ? coin.map((g) => cardHtml(g, ['金幣'], { community: true })).join('')
      : '<p class="empty-hint">目前沒有通過驗證的金幣遊戲。</p>';
  }
  const freeCards = free.length
    ? free.map((g) => cardHtml(g, [], { community: true })).join('')
    : '<p class="empty-hint">目前沒有一般遊戲。</p>';
  const multiCards = multi.length
    ? multi.map((g) => cardHtml(g, ['多人'], { community: true })).join('')
    : '<p class="empty-hint">目前沒有多人遊戲。</p>';

  view.innerHTML = `
    <h1 class="page-heading">大廳</h1>
    <p class="page-lead">官方遊戲與投稿遊戲。金幣遊戲的下注由外框送出。</p>
    <section class="lobby-section" id="lobbyOfficial">
      <h2>官方遊戲</h2>
      <div class="card-grid">${officialCards}</div>
    </section>
    <section class="lobby-section" id="lobbyCoin">
      <h2>金幣遊戲</h2>
      <div class="card-grid">${coinCards}</div>
    </section>
    <section class="lobby-section" id="lobbyFree">
      <h2>一般遊戲</h2>
      <div class="card-grid">${freeCards}</div>
    </section>
    <section class="lobby-section" id="lobbyMulti">
      <h2>多人遊戲</h2>
      <div class="card-grid">${multiCards}</div>
    </section>
  `;
}

function submissionById(id) {
  return catalog.submissions.find((g) => g.id === id) || null;
}

function saveData() {
  const conn = navigator.connection;
  return Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
}

/** 大廳畫好之後：閒下來時預熱投稿遊戲；指到卡片時立刻預熱那一款。 */
function scheduleLobbyWarm(view, seq) {
  if (!catalog.release) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));
  if (!saveData()) {
    idle(() => {
      if (seq !== routeSeq) return;
      for (const card of view.querySelectorAll('a.game-card[data-community]')) {
        const game = submissionById(card.dataset.community);
        if (game) warmCommunity(game, catalog.release);
      }
    });
  }
  if (view.dataset.warmBound) return;
  view.dataset.warmBound = '1';
  const onIntent = (ev) => {
    const card = ev.target && ev.target.closest ? ev.target.closest('a.game-card[data-community]') : null;
    if (!card) return;
    const game = submissionById(card.dataset.community);
    if (game) warmCommunity(game, catalog.release, { urgent: true });
  };
  view.addEventListener('pointerover', onIntent, { passive: true });
  view.addEventListener('touchstart', onIntent, { passive: true });
  view.addEventListener('focusin', onIntent);
}

function loginFormHtml() {
  return `<form class="auth-form" id="loginForm">
        <label>使用者名稱
          <input name="username" autocomplete="username" required>
        </label>
        <label>密碼
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <p class="auth-error" id="loginError" role="alert"></p>
        <button type="submit" class="primary-button">登入</button>
      </form>
      <p class="auth-register">還沒有帳號？<a href="${escapeHtml(REGISTER_URL)}" target="_blank" rel="noopener">到股票大亂鬥註冊</a></p>`;
}

function bindLoginForm(scope, onSuccess) {
  const form = scope.querySelector('#loginForm');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const username = String(data.get('username') || '');
    const password = String(data.get('password') || '');
    const errEl = scope.querySelector('#loginError');
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { response, payload } = await apiLogin(username, password);
    btn.disabled = false;
    if (!response.ok) {
      const msg = (payload && payload.error) || '登入失敗';
      if (errEl) errEl.textContent = msg;
      toast(msg);
      return;
    }
    onSuccess();
  });
}

function renderLogin(view) {
  view.innerHTML = `
    <section class="auth-card">
      <h1>登入</h1>
      <p class="page-lead">使用股票大亂鬥帳號。外框帶著登入呼叫賭場 API。</p>
      ${loginFormHtml()}
    </section>
  `;
  bindLoginForm(view, () => {
    renderChrome();
    toast('登入成功');
    location.hash = '#/';
  });
}

function closeLoginDialog() {
  if (!loginDialog) return;
  loginDialog.remove();
  loginDialog = null;
}

/** 401 時就地叫出登入框：遊戲頁留在原處，登入後可以直接繼續。 */
function openLoginDialog() {
  if (loginDialog) return;
  const el = document.createElement('div');
  el.className = 'login-dialog-backdrop';
  el.id = 'loginDialog';
  el.innerHTML = `<section class="auth-card login-dialog" role="dialog" aria-modal="true" aria-labelledby="loginDialogTitle">
      <h1 id="loginDialogTitle">請重新登入</h1>
      <p class="page-lead">登入狀態已失效。登入後可以留在這一頁繼續。</p>
      ${loginFormHtml()}
      <button type="button" class="secondary-button" id="loginDialogClose">稍後再說</button>
    </section>`;
  document.body.appendChild(el);
  loginDialog = el;
  el.querySelector('#loginDialogClose').addEventListener('click', closeLoginDialog);
  bindLoginForm(el, () => {
    closeLoginDialog();
    renderChrome();
    toast('登入成功');
    // 重新掛載這一頁：金幣下注列與官方遊戲的 sdk 都是在 mount 時拿 user，
    // 不重掛的話登入後下注列還是停在「登入後才能下注」。
    void route();
  });
  const first = el.querySelector('input[name="username"]');
  if (first) first.focus();
}

function showLoginFrom401() {
  if (parseRoute().name === 'login') {
    renderChrome();
    route();
    return;
  }
  // 同一頁可能同時打好幾個請求都拿到 401：登入框已經開著就不再疊 toast。
  const alreadyPrompted = Boolean(loginDialog);
  renderChrome();
  openLoginDialog();
  if (!alreadyPrompted) toast('請先登入');
}

async function refreshGameHistory(historyRoot, historyGame, gameId) {
  if (!getUser()) {
    historyRoot.innerHTML = `<section class="history-block"><h2>我的紀錄</h2><p class="empty-hint">登入後可查看紀錄。</p></section>`;
    return;
  }
  const opts = { limit: 20 };
  if (historyGame === 'community' && gameId) opts.gameId = gameId;
  const { response, payload } = await fetchHistory(historyGame, opts);
  if (!response.ok) {
    historyRoot.innerHTML = `<section class="history-block"><h2>我的紀錄</h2><p class="empty-hint">${escapeHtml((payload && payload.error) || '載入紀錄失敗')}</p></section>`;
    return;
  }
  renderHistory(historyRoot, payload, historyGame);
}

function unmountGame() {
  unmountCommunity();
  if (currentOfficial && typeof currentOfficial.unmount === 'function') {
    try { currentOfficial.unmount(); } catch (_) { /* ignore */ }
  }
  currentOfficial = null;
}

function officialModuleUrl(id) {
  return new URL(`./official/${id}/game.js`, import.meta.url).href;
}

/** 點進官方遊戲的第一時間：模組、CSS、第一個 API 一起出發，不要等前一個做完。 */
function warmOfficial(meta) {
  const cssHref = new URL(`./official/${meta.id}/game.css`, import.meta.url).href;
  if (!document.querySelector(`link[rel="preload"][href="${cssHref}"]`)
    && !document.querySelector(`link[data-pg-official-style="${cssHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'style';
    link.href = cssHref;
    document.head.appendChild(link);
  }
  if (meta.firstGet) prefetch(meta.firstGet);
  return import(officialModuleUrl(meta.id));
}

function gameHeadHtml(title, { fullscreen = true } = {}) {
  // 回大廳在最左邊、全螢幕在最右邊；每款遊戲同一個位置，不必找。
  return `<div class="game-page-head">
      <a class="back-button" href="#/" aria-label="回大廳"><span aria-hidden="true">‹</span> 大廳</a>
      <h1>${escapeHtml(title)}</h1>
      ${fullscreen ? '<button type="button" class="secondary-button game-fullscreen" id="gameFullscreen" aria-label="全螢幕">全螢幕</button>' : ''}
    </div>`;
}

function bindFullscreen(view, getTarget) {
  const btn = view.querySelector('#gameFullscreen');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const target = getTarget();
    if (target && target.requestFullscreen) target.requestFullscreen();
  });
}

async function renderOfficialGame(view, meta) {
  view.innerHTML = `
    ${gameHeadHtml(meta.name)}
    <div id="officialRoot" class="game-stage"><p class="empty-hint">載入中…</p></div>
    <div id="historyRoot"></div>
  `;
  const root = view.querySelector('#officialRoot');
  bindFullscreen(view, () => root);
  const historyRoot = view.querySelector('#historyRoot');
  let mod;
  try {
    [mod] = await Promise.all([warmOfficial(meta), ensureSession()]);
  } catch (_) {
    if (root.isConnected) {
      root.innerHTML = '<p class="empty-hint">遊戲載入失敗，請重新整理再試一次。</p>';
    }
    return;
  }
  const activeRoute = parseRoute();
  if (!root.isConnected || activeRoute.name !== 'game' || activeRoute.id !== meta.id) return;
  root.replaceChildren();
  const sdk = createOfficialSdk({
    api,
    getBalance,
    setBalance: (n) => {
      setBalance(n);
      renderChrome();
    },
    toast,
    refreshHistory: () => refreshGameHistory(historyRoot, meta.historyGame),
    roundId: casinoRoundId,
    user: getUser(),
  });
  mod.mount(root, sdk);
  currentOfficial = mod;
  await refreshGameHistory(historyRoot, meta.historyGame);
}

function renderCoinUnavailable(view, game) {
  // 伺服器沒有通過驗證的規格就不能下注，直接開網址時要說清楚，不要給一條空下注列。
  view.innerHTML = `
    ${gameHeadHtml(game.name || game.id, { fullscreen: false })}
    <p class="empty-hint">這個遊戲目前不能玩：伺服器還沒有通過驗證的金幣規格。</p>
  `;
}

async function renderCommunityGame(view, game, seq) {
  const isCoin = game.kind === 'coin';
  if (isCoin && catalog.casinoLoaded && !catalog.casinoById.get(game.id)) {
    renderCoinUnavailable(view, game);
    return;
  }
  view.innerHTML = `
    ${gameHeadHtml(game.name || game.id)}
    <div id="communityRoot" class="game-stage is-community"></div>
    <div id="historyRoot"></div>
  `;
  const root = view.querySelector('#communityRoot');
  const fsBtn = view.querySelector('#gameFullscreen');
  if (fsBtn) fsBtn.addEventListener('click', requestCommunityFullscreen);
  const historyRoot = view.querySelector('#historyRoot');
  const refresh = isCoin
    ? () => refreshGameHistory(historyRoot, 'community', game.id)
    : null;
  // iframe 先開始下載；登入狀態與規格回來之後才回 pg:init、畫下注列。
  mountCommunity(root, {
    game,
    release: catalog.release,
    toast,
    refreshHistory: refresh,
    onBalance: () => renderChrome(),
  });
  await Promise.all([ensureSession(), isCoin ? ensureCasinoList() : null]);
  if (seq !== routeSeq) return;
  const spec = isCoin ? catalog.casinoById.get(game.id) : null;
  if (isCoin && !spec) {
    unmountCommunity();
    renderCoinUnavailable(view, game);
    return;
  }
  activateCommunity({ spec });
  if (refresh) await refresh();
}

async function route() {
  const seq = ++routeSeq;
  closeLoginDialog();
  unmountGame();
  cancelWarmQueue();
  const view = document.getElementById('view');
  if (!view) return;
  const r = parseRoute();
  if (r.name === 'login') {
    renderLogin(view);
    return;
  }
  if (r.name === 'game' && OFFICIAL_BY_ID[r.id]) {
    // 官方遊戲不需要投稿目錄。
    await renderOfficialGame(view, OFFICIAL_BY_ID[r.id]);
    return;
  }
  if (!catalog.loaded) {
    view.innerHTML = '<p class="empty-hint">載入大廳中…</p>';
    await ensureCatalog();
    if (seq !== routeSeq) return;
  }
  if (r.name === 'lobby') {
    renderLobby(view);
    if (!catalog.casinoLoaded) {
      await ensureCasinoList();
      if (seq !== routeSeq || parseRoute().name !== 'lobby') return;
      renderLobby(view);
    }
    scheduleLobbyWarm(view, seq);
    return;
  }
  if (r.name === 'game') {
    const game = catalog.submissions.find((g) => g.id === r.id);
    if (game) {
      await renderCommunityGame(view, game, seq);
      return;
    }
    view.innerHTML = `<p class="empty-hint">找不到遊戲。</p><p><a href="#/">回大廳</a></p>`;
  }
}

function boot() {
  applyBootData(readBootData());
  bootTheme();
  setUnauthorizedHandler(showLoginFrom401);
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  }
  // 登入狀態、投稿目錄、金幣清單同時出發；畫面不必等登入狀態就先畫出來。
  ensureSession().then(() => renderChrome());
  if (!catalog.loaded) void ensureCatalog();
  if (!catalog.casinoLoaded) void ensureCasinoList();
  renderChrome();
  window.addEventListener('hashchange', () => {
    // 換頁動畫只包住同步換畫面那一段：route() 在第一個 await 之前就把新頁面畫好了。
    swapView(() => {
      renderChrome();
      void route();
    });
  });
  void route();
}

boot();
