import { pathToFileURL } from 'node:url';
import path from 'node:path';

const OPEN = 1;
const CLOSED = 3;
const sockets = [];
const messageListeners = [];
const parent = {
  postMessage(data) {
    parent.sent.push(data);
  },
  sent: [],
};

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = OPEN;
  static CLOSING = 2;
  static CLOSED = CLOSED;
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this._listeners = { open: [], message: [], error: [], close: [] };
    sockets.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this._emit('open');
    });
  }
  addEventListener(type, fn, opts = {}) {
    this._listeners[type].push({ fn, once: Boolean(opts.once) });
  }
  send(raw) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.type === 'auth') {
      queueMicrotask(() => {
        this.peer({ type: 'welcome', you: { id: 'u1', username: 'u1', displayName: 'U1' } });
      });
    }
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this._emit('close');
  }
  _emit(type, event = {}) {
    const list = this._listeners[type].slice();
    for (const item of list) {
      item.fn(event);
      if (item.once) {
        const idx = this._listeners[type].indexOf(item);
        if (idx >= 0) this._listeners[type].splice(idx, 1);
      }
    }
  }
  peer(obj) {
    this._emit('message', { data: JSON.stringify(obj) });
  }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.window = {
  parent,
  addEventListener(type, fn) {
    if (type === 'message') messageListeners.push(fn);
  },
};
globalThis.location = {
  protocol: 'http:',
  host: '127.0.0.1:54471',
  pathname: '/games/community/demo/index.html',
};
globalThis.document = { documentElement: { dataset: {} } };

const sdkUrl = pathToFileURL(path.resolve('site/sdk/pie-game-sdk.js')).href;
const { default: PieGame, MultiplayerClient, SDK } = await import(sdkUrl);

function fromParent(data) {
  for (const fn of messageListeners) {
    fn({ source: parent, data });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

SDK.requestTimeoutMs = 40;

const client = new MultiplayerClient({
  gameId: 'demo',
  takeTicket: async () => 'ticket-1',
});

try {
  await client.list();
  throw new Error('list should reject when disconnected');
} catch (err) {
  assert(err.code === 'not_connected', `expected not_connected, got ${err.code}`);
}

await client._open();
const ws = sockets[0];
assert(ws.sent[0].type === 'auth', 'first frame should be auth');

const listPromise = client.list();
assert(ws.sent.some((m) => m.type === 'list'), 'list should send');
ws.peer({ type: 'rooms', rooms: [{ id: 'r1' }] });
const rooms = await listPromise;
assert(rooms.length === 1 && rooms[0].id === 'r1', 'list should resolve rooms');

const createPromise = client.create({ maxPlayers: 2 });
const list2 = client.list();
ws.peer({ type: 'rooms', rooms: [] });
assert((await list2).length === 0, 'queued rooms should match list not create');
ws.peer({
  type: 'joined',
  room: { id: 'r2', private: false },
  hostId: 'u1',
  players: [],
  state: {},
});
const joined = await createPromise;
assert(joined.room.id === 'r2', 'create should resolve joined');

const slow = client.list();
try {
  await slow;
  throw new Error('list should time out');
} catch (err) {
  assert(err.code === 'timeout', `expected timeout, got ${err.code}`);
}

PieGame.onTheme(undefined);
fromParent({ type: 'pg:init', gameId: 'demo', user: { id: 'u1', displayName: 'U1' }, theme: 'playful', ticket: 't' });
const init = await PieGame.ready();
assert(init.gameId === 'demo', 'ready should resolve from pg:init');

console.log('sdk_request_test ok');
