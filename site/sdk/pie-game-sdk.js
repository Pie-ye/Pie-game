/**
 * Pie Game 投稿 SDK：包裝外框 postMessage 與多人 WebSocket。
 * 同時掛 window.PieGame 並 export default，script 與 ES module 都能用。
 */
export const SDK = {
  // 外框要等登入狀態回來才回 pg:init；慢網路下 2 秒太短，會讓遊戲誤判成獨立模式（user=null）。
  // 不在 iframe 裡時不會等，直接獨立模式。
  initTimeoutMs: 8000,
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

/** 外框 origin：referrer 拿得到就先用，否則等第一則外框訊息記下來。 */
function referrerOrigin() {
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch (_err) {
    /* referrer 不是合法 URL */
  }
  return null;
}

function inferGameId() {
  const parts = String(location.pathname || '').split('/').filter(Boolean);
  const idx = parts.lastIndexOf('community');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  if (parts.length >= 2) return parts[parts.length - 2];
  return 'local';
}

function standaloneInit() {
  return { gameId: inferGameId(), user: null, ticket: null };
}

function publicInit(state) {
  return {
    gameId: state.gameId,
    user: state.user,
  };
}


/**
 * 遊戲內容實際多高。不能用 documentElement.scrollHeight：iframe 裡它至少等於 iframe 本身的高度，
 * 回報它只會讓外框維持原本的大小，永遠縮不回來。這裡量 body 每個子元素的底部。
 */
function contentHeight() {
  if (typeof document === 'undefined' || !document.body) return 0;
  const body = document.body;
  const style = getComputedStyle(body);
  let bottom = 0;
  for (const child of body.children) {
    const pos = getComputedStyle(child).position;
    if (pos === 'fixed' || pos === 'absolute') continue;
    const rect = child.getBoundingClientRect();
    const margin = parseFloat(getComputedStyle(child).marginBottom) || 0;
    bottom = Math.max(bottom, rect.bottom + margin);
  }
  if (!bottom) return 0;
  const pad = (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.marginBottom) || 0);
  return Math.ceil(bottom + (window.scrollY || 0) + pad);
}

function wsUrl() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/mp`;
}

function createSdk() {
  const resultListeners = [];
  const ticketWaiters = [];
  let initState = null;
  let initPromise = null;
  let unusedTicket = null;
  let mpClient = null;
  let settleReady = null;
  let readyTimer = null;
  let parentOrigin = referrerOrigin();

  function postToParent(payload) {
    if (!inIframe()) return;
    // 知道外框 origin 之後一律指定，別讓訊息（例如 pg:ticket 的請求）廣播給任何父窗。
    window.parent.postMessage(payload, parentOrigin || '*');
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
    // iframe 用 referrerpolicy=no-referrer，所以 origin 常常只能從第一則 pg:init
    // 記下來；之後入站訊息的 origin 必須相同。
    if (parentOrigin === null) {
      if (!event.origin || event.origin === 'null') return;
      parentOrigin = event.origin;
    } else if (event.origin !== parentOrigin) {
      return;
    }
    const data = event.data || {};
    const type = data.type;
    if (type === 'pg:init') {
      initState = {
        gameId: data.gameId || inferGameId(),
        user: data.user == null ? null : data.user,
        ticket: data.ticket || null,
      };
      unusedTicket = initState.ticket;
      finishReady(initState);
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
            finishReady(initState);
        }
      }, SDK.initTimeoutMs);
    });
    return initPromise;
  }

  let autoHeight = false;
  let lastHeight = 0;
  let heightFrame = 0;

  function reportHeight(px) {
    const n = Math.ceil(px);
    if (!Number.isFinite(n) || n <= 0 || Math.abs(n - lastHeight) < 2) return;
    lastHeight = n;
    postToParent({ type: 'pg:height', px: n });
  }

  function followContent() {
    if (autoHeight || typeof ResizeObserver === 'undefined' || !document.body) return;
    autoHeight = true;
    const observer = new ResizeObserver(() => {
      if (heightFrame) return;
      heightFrame = requestAnimationFrame(() => {
        heightFrame = 0;
        const measured = contentHeight();
        if (measured > 40) reportHeight(measured);
      });
    });
    observer.observe(document.body);
    for (const child of document.body.children) observer.observe(child);
  }

  /**
   * 告訴外框遊戲畫面要多高。不帶參數（建議）＝SDK 自己量內容高度，之後內容變高變矮也會自動跟著。
   * 帶數字時，若剛好是「整個 iframe 的高度」（舊範本傳 documentElement.scrollHeight），也改用量到的內容高度。
   */
  function setHeight(px) {
    let n = Number(px);
    const measured = contentHeight();
    const viewport = typeof window !== 'undefined' ? window.innerHeight : 0;
    if (!Number.isFinite(n) || (measured > 40 && n >= viewport - 1)) n = measured;
    if (!Number.isFinite(n) || n <= 0) return;
    reportHeight(n);
    if (px == null) followContent();
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

  /** 事件：'rooms'（大廳列表有變，payload `{ rooms, total }`）、'joined'、'playerJoined'、'playerLeft'、'hostChanged'、'state'、'message'。 */
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
    // 訂閱大廳：房間增減、人數變動由伺服器主動推（'rooms' 事件），不必手動重新整理。
    // 重連後這裡會再執行一次，所以訂閱不會因斷線而失效。
    this._send({ type: 'subscribe' });
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
    if (msg.type === 'lobby') {
      this._emit('rooms', { rooms: msg.rooms || [], total: msg.total || 0 });
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
