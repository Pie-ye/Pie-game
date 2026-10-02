/**
 * Pie Game 投稿 SDK：包裝外框 postMessage 與多人 WebSocket。
 * 同時掛 window.PieGame 並 export default，script 與 ES module 都能用。
 */
const INIT_TIMEOUT_MS = 2000;
const TICKET_TIMEOUT_MS = 5000;
const RECONNECT_MIN_MS = 400;
const RECONNECT_MAX_MS = 15000;
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

  function postToParent(payload) {
    if (!inIframe()) return;
    window.parent.postMessage(payload, '*');
  }

  function flushTicket(ticket) {
    unusedTicket = ticket || null;
    const waiters = ticketWaiters.splice(0, ticketWaiters.length);
    waiters.forEach((fn) => fn(ticket));
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
      if (!inIframe()) {
        initState = standaloneInit();
        applyTheme(initState.theme);
        resolve(publicInit(initState));
        return;
      }
      postToParent({ type: 'pg:ready' });
      const started = Date.now();
      const timer = setInterval(() => {
        if (initState) {
          clearInterval(timer);
          resolve(publicInit(initState));
          return;
        }
        if (Date.now() - started >= INIT_TIMEOUT_MS) {
          clearInterval(timer);
          initState = standaloneInit();
          applyTheme(initState.theme);
          resolve(publicInit(initState));
        }
      }, 20);
    });
    return initPromise;
  }

  function onTheme(cb) {
    if (typeof cb === 'function') themeListeners.push(cb);
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
      }, TICKET_TIMEOUT_MS);
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

class MultiplayerClient {
  constructor({ gameId, takeTicket }) {
    this.me = null;
    this.room = null;
    this._gameId = gameId;
    this._takeTicket = takeTicket;
    this._ws = null;
    this._handlers = Object.create(null);
    this._pending = null;
    this._hostId = null;
    this._rejoin = null;
    this._alive = true;
    this._manualClose = false;
    this._backoff = RECONNECT_MIN_MS;
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
      const timer = setTimeout(() => {
        reject(new Error('ws timeout'));
        try { ws.close(); } catch (_err) { /* ignore */ }
      }, TICKET_TIMEOUT_MS);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        ws.send(JSON.stringify({ type: 'auth', ticket, gameId: this._gameId }));
      });
      ws.addEventListener('message', (ev) => {
        const msg = this._parse(ev.data);
        if (!msg) return;
        if (msg.type === 'welcome') {
          this.me = msg.you;
          resolve();
          return;
        }
        if (msg.type === 'error') {
          clearTimeout(timer);
          reject(Object.assign(new Error(msg.code || 'error'), { code: msg.code }));
        }
      }, { once: false });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('ws error'));
      });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        reject(new Error('ws closed'));
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
      this._pending = { type: expectType, resolve, reject };
      this._send(body);
    });
  }

  _finishPending(ok, payload) {
    const pending = this._pending;
    if (!pending) return false;
    this._pending = null;
    if (ok) pending.resolve(payload);
    else pending.reject(Object.assign(new Error(payload && payload.code ? payload.code : 'error'), payload || {}));
    return true;
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
      this._finishPending(false, msg);
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
      this._finishPending(true, msg);
      this._emit('joined', msg);
      return;
    }
    if (msg.type === 'rooms') {
      this._finishPending(true, msg);
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
    if (!this._alive || this._manualClose) return;
    this._emit('disconnected', {});
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._reconnectTimer || !this._alive) return;
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, RECONNECT_MAX_MS);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this._connectOnce();
        this._backoff = RECONNECT_MIN_MS;
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
