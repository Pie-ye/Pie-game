/**
 * Pie Game 投稿 SDK：包裝外框 postMessage 與多人 WebSocket。
 * 同時掛 window.PieGame 並 export default，script 與 ES module 都能用。
 */
export const SDK = {
  initTimeoutMs: 2000,
  ticketTimeoutMs: 5000,
  requestTimeoutMs: 10000,
  reconnectMinMs: 400,
  reconnectMaxMs: 15000,
};

const PRIVATE_CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/i;

function inIframe() {
  try {
    return window.parent != null && window.parent !== window;
  } catch (_err) {
    return true;
  }
}

function inferGameId() {
  const parts = String(location.pathname || '').split('/').filter(Boolean);
  const idx = parts.lastIndexOf('community');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  if (parts.length >= 2) return parts[parts.length - 2];
  return 'local';
}

function standaloneInit() {
  return { gameId: inferGameId(), user: null, theme: 'playful', ticket: null };
}

function publicInit(state) {
  return {
    gameId: state.gameId,
    user: state.user,
    theme: state.theme,
  };
}

function applyTheme(theme) {
  if (typeof document === 'undefined' || !theme) return;
  document.documentElement.dataset.theme = theme;
}

function wsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/mp`;
}

function createSdk() {
  const themeListeners = [];
  const resultListeners = [];
  const ticketWaiters = [];
  let initState = null;
  let initPromise = null;
  let unusedTicket = null;
  let mpClient = null;
  let settleReady = null;
  let readyTimer = null;

  function postToParent(payload) {
    if (!inIframe()) return;
    window.parent.postMessage(payload, '*');
  }

  function flushTicket(ticket) {
    unusedTicket = ticket || null;
    const waiters = ticketWaiters.splice(0, ticketWaiters.length);
    waiters.forEach((fn) => fn(ticket));
  }

  function finishReady(state) {
    if (!settleReady) return;
    const resolve = settleReady;
    settleReady = null;
    if (readyTimer != null) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    resolve(publicInit(state));
  }

  function onParentMessage(event) {
    if (event.source !== window.parent) return;
    const data = event.data || {};
    const type = data.type;
    if (type === 'pg:init') {
      initState = {
        gameId: data.gameId || inferGameId(),
        user: data.user == null ? null : data.user,
        theme: data.theme || 'playful',
        ticket: data.ticket || null,
      };
      unusedTicket = initState.ticket;
      applyTheme(initState.theme);
      themeListeners.forEach((cb) => cb(initState.theme));
      finishReady(initState);
      return;
    }
    if (type === 'pg:theme') {
      const theme = data.theme || 'playful';
      if (initState) initState.theme = theme;
      applyTheme(theme);
      themeListeners.forEach((cb) => cb(theme));
      return;
    }
    if (type === 'pg:result') {
      resultListeners.forEach((cb) => cb(data));
      return;
    }
    if (type === 'pg:ticket') {
      if (initState) initState.ticket = data.ticket || null;
      flushTicket(data.ticket || null);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('message', onParentMessage);
  }

  function ready() {
    if (initPromise) return initPromise;
    initPromise = new Promise((resolve) => {
      settleReady = resolve;
      if (!inIframe()) {
        initState = standaloneInit();
        applyTheme(initState.theme);
        finishReady(initState);
        return;
      }
      if (initState) {
        finishReady(initState);
        return;
      }
      postToParent({ type: 'pg:ready' });
      readyTimer = setTimeout(() => {
        if (!initState) {
          initState = standaloneInit();
          applyTheme(initState.theme);
          finishReady(initState);
        }
      }, SDK.initTimeoutMs);
    });
    return initPromise;
  }

  function onTheme(cb) {
    if (typeof cb !== 'function') return;
    themeListeners.push(cb);
    if (initState && initState.theme) cb(initState.theme);
  }

  function setHeight(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return;
    postToParent({ type: 'pg:height', px: n });
  }

  function takeTicket() {
    if (unusedTicket) {
      const ticket = unusedTicket;
      unusedTicket = null;
      return Promise.resolve(ticket);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = ticketWaiters.indexOf(onTicket);
        if (idx >= 0) ticketWaiters.splice(idx, 1);
        reject(new Error('ticket timeout'));
      }, SDK.ticketTimeoutMs);
      function onTicket(ticket) {
        clearTimeout(timer);
        unusedTicket = null;
        resolve(ticket);
      }
      ticketWaiters.push(onTicket);
      postToParent({ type: 'pg:ticket' });
    });
  }

  const coin = {
    onResult(cb) {
      if (typeof cb === 'function') resultListeners.push(cb);
    },
    select(choiceId) {
      if (!choiceId) return;
      postToParent({ type: 'pg:select', choice: choiceId });
    },
  };

  const multiplayer = {
    async connect() {
      await ready();
      if (mpClient && mpClient._alive) return mpClient;
      mpClient = new MultiplayerClient({
        gameId: initState ? initState.gameId : inferGameId(),
        takeTicket,
      });
      await mpClient._open();
      return mpClient;
    },
  };

  return {
    ready,
    onTheme,
    setHeight,
    coin,
    multiplayer,
    get user() {
      return initState ? initState.user : null;
    },
  };
}

export class MultiplayerClient {
  constructor({ gameId, takeTicket }) {
    this.me = null;
    this.room = null;
    this._gameId = gameId;
    this._takeTicket = takeTicket;
    this._ws = null;
    this._handlers = Object.create(null);
    this._queue = [];
    this._hostId = null;
    this._rejoin = null;
    this._alive = true;
    this._manualClose = false;
    this._backoff = SDK.reconnectMinMs;
    this._reconnectTimer = null;
    this._openPromise = null;
  }

  get isHost() {
    return this.me != null && this._hostId != null && this.me.id === this._hostId;
  }

  on(event, cb) {
    if (!event || typeof cb !== 'function') return;
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(cb);
  }

  async list() {
    const payload = await this._request({ type: 'list' }, 'rooms');
    return payload.rooms || [];
  }

  async create(opts = {}) {
    const body = { type: 'create' };
    if (opts.maxPlayers != null) body.maxPlayers = opts.maxPlayers;
    if (opts.private != null) body.private = Boolean(opts.private);
    if (opts.name != null) body.name = opts.name;
    return this._request(body, 'joined');
  }

  async join(roomIdOrCode) {
    const token = String(roomIdOrCode || '');
    const body = PRIVATE_CODE_RE.test(token)
      ? { type: 'join', code: token.toUpperCase() }
      : { type: 'join', roomId: token };
    return this._request(body, 'joined');
  }

  async leave() {
    this._rejoin = null;
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._send({ type: 'leave' });
    this.room = null;
    this._hostId = null;
  }

  send(data, to) {
    const body = { type: 'send', data };
    if (to != null) body.to = to;
    this._send(body);
  }

  setState(key, value) {
    this._send({ type: 'setState', key, value });
  }

  kick(playerId) {
    this._send({ type: 'kick', playerId });
  }

  async _open() {
    if (this._openPromise) return this._openPromise;
    this._openPromise = this._connectOnce();
    try {
      await this._openPromise;
    } finally {
      this._openPromise = null;
    }
  }

  async _connectOnce() {
    const ticket = await this._takeTicket();
    if (!ticket) throw new Error('missing ticket');
    const ws = new WebSocket(wsUrl());
    this._ws = ws;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) resolve();
        else reject(err);
      };
      const timer = setTimeout(() => {
        finish(false, new Error('ws timeout'));
        try { ws.close(); } catch (_err) { /* ignore */ }
      }, SDK.ticketTimeoutMs);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'auth', ticket, gameId: this._gameId }));
      });
      ws.addEventListener('message', (ev) => {
        const msg = this._parse(ev.data);
        if (!msg) return;
        if (msg.type === 'welcome') {
          this.me = msg.you;
          finish(true);
          return;
        }
        if (msg.type === 'error') {
          finish(false, Object.assign(new Error(msg.code || 'error'), { code: msg.code }));
        }
      });
      ws.addEventListener('error', () => {
        finish(false, new Error('ws error'));
      });
      ws.addEventListener('close', () => {
        finish(false, new Error('ws closed'));
      }, { once: true });
    });
    ws.addEventListener('message', (ev) => this._onMessage(ev.data));
    ws.addEventListener('close', () => this._onClose());
  }

  _parse(raw) {
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  _emit(event, payload) {
    const list = this._handlers[event] || [];
    list.forEach((cb) => {
      try { cb(payload); } catch (_err) { /* 遊戲回呼例外不中斷 SDK */ }
    });
  }

  _send(obj) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    this._ws.send(JSON.stringify(obj));
  }

  _request(body, expectType) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        reject(Object.assign(new Error('not_connected'), { code: 'not_connected' }));
        return;
      }
      const entry = { type: expectType, resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx >= 0) this._queue.splice(idx, 1);
        reject(Object.assign(new Error('timeout'), { code: 'timeout' }));
      }, SDK.requestTimeoutMs);
      this._queue.push(entry);
      this._send(body);
    });
  }

  _takeQueued(expectType) {
    const idx = expectType
      ? this._queue.findIndex((item) => item.type === expectType)
      : (this._queue.length ? 0 : -1);
    if (idx < 0) return null;
    const entry = this._queue.splice(idx, 1)[0];
    clearTimeout(entry.timer);
    return entry;
  }

  _rejectAll(code) {
    const pending = this._queue.splice(0, this._queue.length);
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(code), { code }));
    });
  }

  _onMessage(raw) {
    const msg = this._parse(raw);
    if (!msg || !msg.type) return;
    if (msg.type === 'ping') {
      this._send({ type: 'pong' });
      return;
    }
    if (msg.type === 'pong' || msg.type === 'welcome') return;
    if (msg.type === 'error') {
      this._emit('error', msg);
      const waiting = this._takeQueued(null);
      if (waiting) waiting.reject(Object.assign(new Error(msg.code || 'error'), { code: msg.code }));
      return;
    }
    if (msg.type === 'joined') {
      this.room = msg.room;
      this._hostId = msg.hostId;
      if (msg.room) {
        this._rejoin = msg.room.private && msg.room.code
          ? { code: msg.room.code }
          : { roomId: msg.room.id };
      }
      const waiting = this._takeQueued('joined');
      if (waiting) waiting.resolve(msg);
      this._emit('joined', msg);
      return;
    }
    if (msg.type === 'rooms') {
      const waiting = this._takeQueued('rooms');
      if (waiting) waiting.resolve(msg);
      return;
    }
    if (msg.type === 'playerJoined') {
      this._emit('playerJoined', msg);
      return;
    }
    if (msg.type === 'playerLeft') {
      this._emit('playerLeft', msg);
      return;
    }
    if (msg.type === 'hostChanged') {
      this._hostId = msg.hostId;
      this._emit('hostChanged', msg);
      return;
    }
    if (msg.type === 'message') {
      this._emit('message', msg);
      return;
    }
    if (msg.type === 'state') {
      this._emit('state', msg);
    }
  }

  _onClose() {
    this._ws = null;
    this._rejectAll('disconnected');
    if (!this._alive || this._manualClose) return;
    this._emit('disconnected', {});
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._alive) return;
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, SDK.reconnectMaxMs);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._connectOnce();
        this._backoff = SDK.reconnectMinMs;
        if (this._rejoin) {
          try {
            if (this._rejoin.code) await this.join(this._rejoin.code);
            else if (this._rejoin.roomId) await this.join(this._rejoin.roomId);
          } catch (_err) {
            this._emit('error', { type: 'error', code: 'rejoin_failed' });
          }
        }
        this._emit('reconnected', {});
      } catch (_err) {
        this._scheduleReconnect();
      }
    }, delay);
  }
}

const PieGame = createSdk();
if (typeof window !== 'undefined') {
  window.PieGame = PieGame;
}
export default PieGame;
