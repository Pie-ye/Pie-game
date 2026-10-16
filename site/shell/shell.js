import { CONTENT_ORIGIN } from './config.js';
import {
  api,
  casinoRoundId,
  clearAuth,
  fetchCommunity,
  fetchHistory,
  fetchSession,
  getBalance,
  getUser,
  logout as apiLogout,
  prefetch,
  setBalance,
  setUnauthorizedHandler,
} from './api.js';
import { createOfficialSdk } from './official-sdk.js';
import { escapeHtml, formatCoins, mountStylesheet } from './util.js';
import { renderHistory } from './history.js';
import {
  activateCommunity,
  cancelWarmQueue,
  mountCommunity,
  requestCommunityFullscreen,
  unmountCommunity,
  warmCommunity,
} from './community-host.js';
import { swapView } from './motion.js';
import { mountCity } from './city/city.js';
import {
  isMuted, isMusicPref, setMuted, setMusicPref, sfx, unlockAudio,
} from './city/audio.js';
import { buildFrame } from './frame.js';
import { mountLoginScene } from './login.js';

// firstGet：遊戲掛上後第一個打的 GET。點進遊戲時先預取，跟下載遊戲模組同時跑。
export const OFFICIAL_GAMES = [
  { id: 'slots', name: '拉霸', description: '三輪拉霸', historyGame: 'slots', firstGet: '/api/casino/slots/config' },
  { id: 'blackjack', name: '21 點', description: '對莊家比點', historyGame: 'blackjack', firstGet: '/api/casino/blackjack' },
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
let currentCity = null;
let routeSeq = 0;
let menuCloseListener = null;
let loginScene = null;
let currentFrame = null;

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

function detachMenuCloseListener() {
  if (!menuCloseListener) return;
  document.removeEventListener('click', menuCloseListener);
  menuCloseListener = null;
}

// ---------- 金幣顯示 ----------
// 以前用「數字逐位捲動」動畫，換位數時會出現亂掉的中間狀態（例如 99▫）。
// 現在一律直接換字：以伺服器回報的整數為準，漲跌時閃一下顏色。
let shownBalance = null;

function balanceNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function paintBalance() {
  const pill = document.getElementById('balancePill');
  if (!pill) return;
  const user = getUser();
  if (!user) {
    pill.hidden = true;
    shownBalance = null;
    return;
  }
  const value = balanceNumber(getBalance());
  pill.hidden = false;
  if (shownBalance === value && pill.firstElementChild) return;
  pill.innerHTML = `<b>${escapeHtml(formatCoins(value))}</b><small>金幣</small>`;
  pill.setAttribute('aria-label', `金幣 ${formatCoins(value)}`);
  if (shownBalance !== null && shownBalance !== value) {
    pill.classList.remove('is-gain', 'is-loss');
    void pill.offsetWidth;
    pill.classList.add(value > shownBalance ? 'is-gain' : 'is-loss');
  }
  shownBalance = value;
}

/** 向伺服器重新對一次帳（回到分頁、離開遊戲、登入之後）：畫面上的金幣永遠以帳本為準。 */
async function syncBalance() {
  if (!getUser()) return;
  await fetchSession();
  paintBalance();
}

function renderChrome() {
  detachMenuCloseListener();
  const user = getUser();
  paintBalance();
  const slot = document.getElementById('authSlot');
  if (!slot) return;
  slot.className = 'auth-slot';
  const name = user ? (user.displayName || user.username) : (sessionSettled ? '選單' : '');
  const switchRow = (id, label, on) => `<button type="button" class="menu-row" id="${id}" role="switch" aria-checked="${on}">
      <span>${label}</span><b>${on ? '開' : '關'}</b></button>`;
  slot.innerHTML = `<div class="user-menu" id="userMenu">
      <button type="button" class="user-menu-toggle" id="userMenuToggle" aria-expanded="false" aria-haspopup="true" aria-label="選單">
        <span class="menu-icon" aria-hidden="true">☰</span><span class="menu-name">${escapeHtml(name)}</span></button>
      <div class="user-menu-panel" id="userMenuPanel">
        ${user ? `<span class="user-name">${escapeHtml(name)}</span>` : ''}
        ${switchRow('menuSound', '音效', !isMuted())}
        ${switchRow('menuMusic', '節奏音樂（遊戲城）', isMusicPref())}
        <button type="button" class="menu-row" id="menuFullscreen"><span>全螢幕</span><b>⛶</b></button>
        ${user
    ? '<button type="button" class="secondary-button menu-logout" id="logoutBtn">登出</button>'
    : '<a class="primary-button menu-logout" href="#/login" id="menuLogin">登入</a>'}
      </div>
    </div>`;
  const menu = slot.querySelector('#userMenu');
  const toggle = slot.querySelector('#userMenuToggle');
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
  const flip = (btn, on) => {
    btn.setAttribute('aria-checked', String(on));
    btn.querySelector('b').textContent = on ? '開' : '關';
  };
  const soundBtn = slot.querySelector('#menuSound');
  soundBtn.addEventListener('click', () => {
    setMuted(!isMuted());
    flip(soundBtn, !isMuted());
    if (!isMuted()) sfx('near');
  });
  const musicBtn = slot.querySelector('#menuMusic');
  musicBtn.addEventListener('click', () => {
    unlockAudio();
    setMusicPref(!isMusicPref());
    flip(musicBtn, isMusicPref());
  });
  slot.querySelector('#menuFullscreen').addEventListener('click', () => {
    const doc = document;
    if (doc.fullscreenElement) doc.exitFullscreen();
    else if (doc.documentElement.requestFullscreen) doc.documentElement.requestFullscreen().catch(() => {});
    closeMenu();
  });
  const logout = slot.querySelector('#logoutBtn');
  if (logout) {
    logout.addEventListener('click', async () => {
      // apiLogout() 不論伺服器怎麼回都會清本地狀態。
      const { response, payload } = await apiLogout();
      const serverDone = response.ok || response.status === 401 || response.status === 403;
      renderChrome();
      if (location.hash && location.hash !== '#/') location.hash = '#/';
      else route();
      toast(serverDone ? '已登出' : `${(payload && payload.error) || '登出失敗'}，已在本機登出`);
    });
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

function cityGames() {
  const { coin, free, multi } = partitionSubmissions();
  const official = OFFICIAL_GAMES.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    tags: ['官方'],
    official: true,
  }));
  return [
    ...official,
    ...coin.map((g) => ({ ...g, tags: [...(g.tags || []), '金幣'] })),
    ...free,
    ...multi,
  ];
}

function renderCity(view) {
  currentCity = mountCity(view, {
    games: cityGames(),
    open: (game) => { location.hash = `#/game/${encodeURIComponent(game.id)}`; },
    // 走到門前就先把這款遊戲預熱（投稿遊戲的 iframe），按進去時才會快。
    onNear: (game) => {
      const sub = submissionById(game.id);
      if (sub && catalog.release) warmCommunity(sub, catalog.release, { urgent: true });
    },
  });
}

function submissionById(id) {
  return catalog.submissions.find((g) => g.id === id) || null;
}

function showLoginFrom401() {
  if (parseRoute().name === 'login') {
    renderChrome();
    route();
    return;
  }
  // 同一頁可能同時打好幾個請求都拿到 401：登入畫面已經開著就不再疊 toast。
  const alreadyPrompted = Boolean(loginScene);
  renderChrome();
  openLoginDialog();
  if (!alreadyPrompted) toast('請先登入');
}

function closeLoginDialog() {
  if (!loginScene) return;
  loginScene.destroy();
  loginScene = null;
}

/** 401 時就地叫出登入畫面：遊戲頁留在原處，登入後重新掛載這一頁。 */
function openLoginDialog() {
  if (loginScene) return;
  loginScene = mountLoginScene(document.body, {
    dialog: true,
    onClose: closeLoginDialog,
    onSuccess: () => {
      closeLoginDialog();
      renderChrome();
      toast('登入成功');
      void route();
    },
  });
}

function renderLogin(view) {
  loginScene = mountLoginScene(view, {
    dialog: false,
    onSuccess: () => {
      closeLoginDialog();
      renderChrome();
      toast('登入成功');
      location.hash = '#/';
    },
  });
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
  if (currentCity) {
    currentCity.unmount();
    currentCity = null;
  }
  unmountCommunity();
  if (currentOfficial && typeof currentOfficial.unmount === 'function') {
    try { currentOfficial.unmount(); } catch (_) { /* ignore */ }
  }
  currentOfficial = null;
  if (currentFrame) {
    currentFrame.destroy();
    currentFrame = null;
  }
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

async function renderOfficialGame(view, meta) {
  const frame = buildFrame(view, { id: meta.id, title: meta.name, stageId: 'officialRoot' });
  currentFrame = frame;
  const root = frame.stage;
  root.innerHTML = '<p class="empty-hint">載入中…</p>';
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
      paintBalance();
    },
    toast,
    refreshHistory: () => refreshGameHistory(frame.historyRoot, meta.historyGame),
    roundId: casinoRoundId,
    user: getUser(),
  });
  mod.mount(root, sdk);
  currentOfficial = mod;
  await refreshGameHistory(frame.historyRoot, meta.historyGame);
}

function renderCoinUnavailable(view, game) {
  // 伺服器沒有通過驗證的規格就不能下注，直接開網址時要說清楚，不要給一條空下注列。
  const frame = buildFrame(view, { id: game.id, title: game.name || game.id, stageId: 'communityRoot', community: true });
  currentFrame = frame;
  frame.stage.innerHTML = '<p class="empty-hint">這個遊戲目前不能玩：伺服器還沒有通過驗證的金幣規格。</p>';
}

async function renderCommunityGame(view, game, seq) {
  const isCoin = game.kind === 'coin';
  if (isCoin && catalog.casinoLoaded && !catalog.casinoById.get(game.id)) {
    renderCoinUnavailable(view, game);
    return;
  }
  const frame = buildFrame(view, {
    id: game.id,
    title: game.name || game.id,
    stageId: 'communityRoot',
    community: true,
    fullscreen: requestCommunityFullscreen,
  });
  currentFrame = frame;
  const root = frame.stage;
  const refresh = isCoin
    ? () => refreshGameHistory(frame.historyRoot, 'community', game.id)
    : null;
  // iframe 先開始下載；登入狀態與規格回來之後才回 pg:init、畫下注列。
  mountCommunity(root, {
    game,
    release: catalog.release,
    toast,
    refreshHistory: refresh,
    onBalance: () => paintBalance(),
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
  view.className = 'page-content';
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
    view.innerHTML = '<p class="empty-hint">載入中…</p>';
    await ensureCatalog();
    if (seq !== routeSeq) return;
  }
  if (r.name === 'lobby') {
    // 首頁是橫向卷軸的遊戲城；金幣遊戲要等通過驗證的清單回來才知道有哪幾款。
    if (!catalog.casinoLoaded) {
      view.innerHTML = '<p class="empty-hint">載入遊戲城中…</p>';
      await ensureCasinoList();
      if (seq !== routeSeq || parseRoute().name !== 'lobby') return;
    }
    renderCity(view);
    void syncBalance();
    return;
  }
  if (r.name === 'game') {
    const game = catalog.submissions.find((g) => g.id === r.id);
    if (game) {
      await renderCommunityGame(view, game, seq);
      return;
    }
    view.innerHTML = '<p class="empty-hint">找不到遊戲。</p><p><a href="#/">回城市</a></p>';
  }
}

function boot() {
  applyBootData(readBootData());
  setUnauthorizedHandler(showLoginFrom401);
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
  // 回到分頁時重新對帳，金幣永遠跟伺服器一致。
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncBalance();
  });
  void route();
}

boot();
