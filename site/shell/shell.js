import { CONTENT_ORIGIN, REGISTER_URL } from './config.js';
import {
  api,
  casinoRoundId,
  clearAuth,
  fetchCommunity,
  fetchHistory,
  fetchSession,
  getBalance,
  getSession,
  getUser,
  login as apiLogin,
  logout as apiLogout,
  setBalance,
  setUnauthorizedHandler,
} from './api.js';
import { createOfficialSdk } from './official-sdk.js';
import { escapeHtml, formatCoins } from './util.js';
import { renderHistory } from './history.js';
import { mountCommunity, unmountCommunity, notifyTheme } from './community-host.js';

const THEMES = ['playful', 'studio', 'classic'];
const THEME_KEY = 'pg_theme';

export const OFFICIAL_GAMES = [
  { id: 'slots', name: '拉霸', description: '三輪拉霸', historyGame: 'slots' },
  { id: 'blackjack', name: '21 點', description: '對莊家比點', historyGame: 'blackjack' },
  { id: 'poker', name: '德州撲克', description: '多人牌桌', historyGame: 'poker' },
  { id: 'dragon', name: '射龍門', description: '門柱比大小', historyGame: 'dragon_gate' },
  { id: 'niuniu', name: '妞妞', description: '五張比牌型', historyGame: 'niu_niu' },
  { id: 'baccarat', name: '百家樂', description: '閒莊和', historyGame: 'baccarat' },
];

const OFFICIAL_BY_ID = Object.fromEntries(OFFICIAL_GAMES.map((g) => [g.id, g]));

const catalog = {
  submissions: [],
  casinoById: new Map(),
  loaded: false,
};

let toastTimer = null;
let currentOfficial = null;
let routeSeq = 0;
let menuCloseListener = null;
let loginDialog = null;

function toast(message, duration = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message || '';
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('is-visible');
  }, typeof duration === 'number' ? duration : 3200);
}

function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'playful';
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
  let saved = 'playful';
  try {
    saved = localStorage.getItem(THEME_KEY) || 'playful';
  } catch (_) {
    saved = 'playful';
  }
  applyTheme(saved);
}

function detachMenuCloseListener() {
  if (!menuCloseListener) return;
  document.removeEventListener('click', menuCloseListener);
  menuCloseListener = null;
}

// 不從其他模組 import 新名字：舊版模組可能還在瀏覽器或 CDN 快取裡，缺 export 會讓整個外框載入失敗。
function playMoneyActive() {
  const sess = getSession();
  return Boolean(sess && sess.playMoney);
}

function balanceLabel(value) {
  return playMoneyActive() ? '無限測試金幣' : `${formatCoins(value)} 金幣`;
}

function renderChrome() {
  detachMenuCloseListener();
  const user = getUser();
  const pill = document.getElementById('balancePill');
  if (pill) {
    if (user) {
      pill.hidden = false;
      pill.textContent = balanceLabel(getBalance());
    } else {
      pill.hidden = true;
    }
  }
  const slot = document.getElementById('authSlot');
  if (!slot) return;
  slot.className = 'auth-slot';
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

async function loadCatalog() {
  const [casinoRes, indexJson] = await Promise.all([
    fetchCommunity().catch(() => ({ response: { ok: false }, payload: {} })),
    fetch(`${CONTENT_ORIGIN}/games/community/index.json`, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .catch(() => ({ games: [] })),
  ]);

  const casinoGames = (casinoRes.response.ok && Array.isArray(casinoRes.payload.games))
    ? casinoRes.payload.games
    : [];
  catalog.casinoById = new Map(casinoGames.map((g) => [g.id, g]));

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
  catalog.submissions = results.filter(Boolean);
  catalog.loaded = true;
}

function cardHtml(game, extraTags = []) {
  const tags = [];
  const seen = new Set();
  for (const t of [...(game.tags || []), ...extraTags]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
  }
  return `<a class="game-card" href="#/game/${encodeURIComponent(game.id)}">
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
  const coinCards = coin.length
    ? coin.map((g) => cardHtml(g, ['金幣'])).join('')
    : '<p class="empty-hint">目前沒有通過驗證的金幣遊戲。</p>';
  const freeCards = free.length
    ? free.map((g) => cardHtml(g)).join('')
    : '<p class="empty-hint">目前沒有一般遊戲。</p>';
  const multiCards = multi.length
    ? multi.map((g) => cardHtml(g, ['多人'])).join('')
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

async function renderOfficialGame(view, meta) {
  view.innerHTML = `
    <div class="game-page-head">
      <h1>${escapeHtml(meta.name)}</h1>
      <a class="outlined-button" href="#/">回大廳</a>
    </div>
    <div id="officialRoot"></div>
    <div id="historyRoot"></div>
  `;
  const root = view.querySelector('#officialRoot');
  const historyRoot = view.querySelector('#historyRoot');
  const mod = await import(`./official/${meta.id}/game.js`);
  const activeRoute = parseRoute();
  if (!root.isConnected || activeRoute.name !== 'game' || activeRoute.id !== meta.id) return;
  const sdk = createOfficialSdk({
    api,
    getBalance,
    isPlayMoney: playMoneyActive,
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

async function renderCommunityGame(view, game) {
  const spec = game.kind === 'coin' ? catalog.casinoById.get(game.id) : null;
  const showHistory = game.kind === 'coin';
  if (game.kind === 'coin' && !spec) {
    // 伺服器沒有通過驗證的規格就不能下注，直接開網址時要說清楚，不要給一條空下注列。
    view.innerHTML = `
      <div class="game-page-head">
        <h1>${escapeHtml(game.name || game.id)}</h1>
        <a class="outlined-button" href="#/">回大廳</a>
      </div>
      <p class="empty-hint">這個遊戲目前不能玩：伺服器還沒有通過驗證的金幣規格。</p>
    `;
    return;
  }
  view.innerHTML = `
    <div class="game-page-head">
      <h1>${escapeHtml(game.name || game.id)}</h1>
      <a class="outlined-button" href="#/">回大廳</a>
    </div>
    <div id="communityRoot"></div>
    <div id="historyRoot"></div>
  `;
  const root = view.querySelector('#communityRoot');
  const historyRoot = view.querySelector('#historyRoot');
  const refresh = showHistory
    ? () => refreshGameHistory(historyRoot, 'community', game.id)
    : null;
  mountCommunity(root, {
    game,
    spec,
    toast,
    refreshHistory: refresh,
    onBalance: () => renderChrome(),
  });
  if (showHistory) await refresh();
}

async function route() {
  const seq = ++routeSeq;
  closeLoginDialog();
  unmountGame();
  const view = document.getElementById('view');
  if (!view) return;
  const r = parseRoute();
  if (r.name === 'login') {
    renderLogin(view);
    return;
  }
  if (!catalog.loaded) {
    view.innerHTML = '<p class="empty-hint">載入大廳中…</p>';
    await loadCatalog();
    if (seq !== routeSeq) return;
  }
  if (r.name === 'lobby') {
    renderLobby(view);
    return;
  }
  if (r.name === 'game') {
    const official = OFFICIAL_BY_ID[r.id];
    if (official) {
      await renderOfficialGame(view, official);
      return;
    }
    const game = catalog.submissions.find((g) => g.id === r.id);
    if (game) {
      await renderCommunityGame(view, game);
      return;
    }
    view.innerHTML = `<p class="empty-hint">找不到遊戲。</p><p><a href="#/">回大廳</a></p>`;
  }
}

async function boot() {
  bootTheme();
  setUnauthorizedHandler(showLoginFrom401);
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) {
    themeSelect.addEventListener('change', () => applyTheme(themeSelect.value));
  }
  await fetchSession();
  renderChrome();
  window.addEventListener('hashchange', () => {
    renderChrome();
    route();
  });
  await route();
}

boot();
