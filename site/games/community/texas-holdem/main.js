/**
 * 德州撲克：房主的瀏覽器跑規則引擎（engine.js）、發牌並裁定；其他人只收公開狀態與自己的底牌。
 * 公開狀態走 setState('table')，底牌用 send(data, to) 私訊。房主離開時由新房主用公開狀態重建（進行中的那手作廢、退回投入）。
 */
import PieGame from '../../../sdk/pie-game-sdk.js';
import { Holdem } from './engine.js';

const TURN_SECONDS = 30;
const NEXT_HAND_MS = 6000;
const FIRST_HAND_MS = 2500;

const $ = (id) => document.getElementById(id);
const el = {
  lobby: $('lobby'), table: $('table'), rooms: $('rooms'), hello: $('hello'), meta: $('meta'), net: $('net'),
  seats: $('seats'), board: $('board'), pot: $('pot'), msg: $('msg'), mine: $('mine'), actions: $('actions'),
  result: $('resultLine'), code: $('code'), fold: $('fold'), checkcall: $('checkcall'), raise: $('raise'),
  range: $('raiseRange'), input: $('raiseInput'), raiseBox: $('raiseBox'),
};

let client = null;
let engine = null; // 只有房主有
let view = null; // 最新公開狀態
let viewAt = 0;
let roster = []; // 房內玩家 [{id, username, displayName}]
let myHole = { handNo: 0, cards: [] };
let hostId = null;
let turnTimer = null;
let nextTimer = null;
let tick = null;

function applyTheme(theme) {
  document.documentElement.dataset.theme = (theme === 'cyber' || theme === 'studio') ? 'cyber' : 'playful';
}

const meId = () => (client && client.me ? client.me.id : null);
const nameOf = (p) => p.displayName || p.username || '玩家';
const fmt = (n) => Number(n || 0).toLocaleString('zh-TW');

// ---------- 牌面 ----------
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
function cardHtml(card, extra = '') {
  if (!card || card === '??') return `<span class="card back ${extra}" aria-label="暗牌"></span>`;
  const rank = card[0] === 'T' ? '10' : card[0];
  const red = card[1] === 'h' || card[1] === 'd' ? ' red' : '';
  return `<span class="card${red} ${extra}" aria-label="${rank}${SUIT[card[1]]}"><b>${rank}</b><i>${SUIT[card[1]]}</i></span>`;
}

// ---------- 房主：引擎 ----------
function syncRoster() {
  if (!engine) return;
  for (const p of roster) engine.addPlayer(p.id, nameOf(p));
  for (const p of [...engine.players]) if (!roster.some((r) => r.id === p.id)) engine.removePlayer(p.id);
}

function becomeHost() {
  if (engine) return;
  engine = view ? Holdem.restore(view) : new Holdem();
  syncRoster();
  publish();
  scheduleNext(FIRST_HAND_MS);
}

function publish() {
  if (!engine) return;
  clearTimeout(turnTimer);
  const pub = { ...engine.publicView(), turnSeconds: TURN_SECONDS };
  view = pub;
  viewAt = performance.now();
  client.setState('table', pub);
  if (engine.inProgress() && engine.actorId) {
    const { handNo, actorId } = engine;
    turnTimer = setTimeout(() => {
      if (!engine || engine.handNo !== handNo || engine.actorId !== actorId) return;
      const legal = engine.legalActions(actorId);
      engine.act(actorId, legal && legal.check ? 'check' : 'fold');
      afterEngineChange();
    }, TURN_SECONDS * 1000);
  }
  render();
}

function sendHoles() {
  if (!engine) return;
  for (const p of engine.players) {
    if (!p.inHand || !p.hole.length) continue;
    if (p.id === meId()) myHole = { handNo: engine.handNo, cards: p.hole.slice() };
    else client.send({ type: 'hole', handNo: engine.handNo, cards: p.hole.slice() }, p.id);
  }
}

function afterEngineChange() {
  publish();
  if (!engine.inProgress() && engine.result) scheduleNext(NEXT_HAND_MS);
}

function scheduleNext(ms) {
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    nextTimer = null;
    if (!engine || engine.inProgress()) return;
    syncRoster();
    if (engine.canStart()) {
      engine.startHand();
      sendHoles();
      publish();
    } else {
      publish();
    }
  }, ms);
}

function hostAct(id, action, amount) {
  if (!engine) return;
  const r = engine.act(id, action, amount);
  if (!r.ok) {
    if (id !== meId()) client.send({ type: 'err', error: r.error }, id);
    else flash(`不能這樣做：${r.error}`);
    return;
  }
  afterEngineChange();
}

// ---------- 動作 ----------
function myAct(action, amount) {
  if (client.isHost) hostAct(meId(), action, amount);
  else client.send({ type: 'act', action, amount }, hostId);
}

function flash(text) {
  el.msg.textContent = text;
  setTimeout(() => { if (el.msg.textContent === text) el.msg.textContent = ''; render(); }, 2500);
}

function myPlayer() {
  return view && view.players.find((p) => p.id === meId());
}

function legalFromView() {
  const me = myPlayer();
  if (!view || !me || view.actorId !== me.id || !['preflop', 'flop', 'turn', 'river'].includes(view.phase)) return null;
  const toCall = Math.max(0, view.currentBet - me.bet);
  const maxTo = me.bet + me.chips;
  return {
    toCall,
    check: toCall === 0,
    call: Math.min(toCall, me.chips),
    raise: maxTo > view.currentBet,
    minTo: Math.min(maxTo, view.currentBet + view.minRaise),
    maxTo,
  };
}

// ---------- 畫面 ----------
const SLOTS = [[50, 90], [11, 70], [11, 24], [50, 8], [89, 24], [89, 70]];

function seatHtml(p, slot, secondsLeft) {
  const [x, y] = SLOTS[slot];
  const isMe = p.id === meId();
  const res = view.result && view.result.players.find((r) => r.id === p.id);
  const live = view.phase !== 'waiting';
  const classes = ['seat'];
  if (isMe) classes.push('me');
  if (p.folded) classes.push('folded');
  if (view.actorId === p.id) classes.push('actor');
  let cards = '';
  if (live && p.inHand && !p.folded) cards = `<div class="cards small">${cardHtml('??')}${cardHtml('??')}</div>`;
  else if (!live && res && res.cards) cards = `<div class="cards small">${res.cards.map((c) => cardHtml(c)).join('')}</div>`;
  const badges = [
    view.dealerId === p.id ? '<span class="badge d" title="莊家">D</span>' : '',
    live && view.sbId === p.id ? '<span class="badge" title="小盲">SB</span>' : '',
    live && view.bbId === p.id ? '<span class="badge" title="大盲">BB</span>' : '',
  ].join('');
  let status = '';
  if (p.folded && live) status = '棄牌';
  else if (p.allIn && live) status = '全下';
  else if (res && !live) status = res.net > 0 ? `+${fmt(res.net)}` : (res.folded ? '棄牌' : fmt(res.net));
  const timer = view.actorId === p.id ? `<span class="timer">${secondsLeft}</span>` : '';
  const bet = p.bet > 0 ? `<span class="bet">${fmt(p.bet)}</span>` : '';
  return `<div class="${classes.join(' ')}" style="left:${x}%;top:${y}%">
    ${bet}${cards}
    <div class="plate"><span class="nm">${escapeText(p.name)}${isMe ? '（你）' : ''}</span>${badges}
      <span class="chips">${fmt(p.chips)}</span>${status ? `<span class="status">${status}</span>` : ''}${timer}</div>
  </div>`;
}

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resultText() {
  const r = view && view.result;
  if (!r || view.phase !== 'waiting') return '';
  const wins = r.players.filter((p) => p.won > 0).map((p) => {
    const how = r.uncontested ? '其他人都棄牌' : (p.handName || '');
    return `${escapeText(p.name)} 贏 ${fmt(p.won)}${how ? `（${how}）` : ''}`;
  });
  return `第 ${r.handNo} 手：${wins.join('；')}`;
}

function render() {
  if (!view || el.table.hidden) return;
  const secondsLeft = Math.max(0, Math.ceil((view.turnSeconds || TURN_SECONDS) - (performance.now() - viewAt) / 1000));
  const room = client && client.room;
  el.meta.textContent = `${room && room.code ? `代碼 ${room.code}　` : ''}盲注 ${view.blinds[0]}／${view.blinds[1]}　${client && client.isHost ? '你是房主' : ''}`;
  const players = view.players;
  const myIdx = Math.max(0, players.findIndex((p) => p.id === meId()));
  const n = players.length;
  el.seats.innerHTML = players.map((p, i) => {
    const rel = (i - myIdx + n) % n;
    const slot = n === 1 ? 0 : Math.round((rel * 6) / n) % 6;
    return seatHtml(p, slot, secondsLeft);
  }).join('');
  const board = view.board || [];
  el.board.innerHTML = [0, 1, 2, 3, 4].map((i) => (board[i] ? cardHtml(board[i]) : '<span class="card empty"></span>')).join('');
  el.pot.textContent = view.pot > 0 ? `底池 ${fmt(view.pot)}` : '';
  if (view.phase === 'waiting' && n < 2) el.msg.textContent = '等待其他玩家入座…';
  else if (view.phase === 'waiting' && !view.result) el.msg.textContent = '即將開始…';
  else if (view.phase === 'waiting') el.msg.textContent = '下一手即將開始…';
  else if (!el.msg.dataset.flash) el.msg.textContent = '';
  el.result.textContent = resultText();

  // 我的底牌
  const me = myPlayer();
  const hole = myHole.handNo === view.handNo && view.phase !== 'waiting' ? myHole.cards : [];
  el.mine.innerHTML = hole.length && me && !me.folded
    ? `<div class="cards">${hole.map((c) => cardHtml(c)).join('')}</div>` : '';

  // 動作列
  const legal = legalFromView();
  el.actions.hidden = !legal;
  if (legal) {
    el.checkcall.textContent = legal.check ? '過牌' : `跟注 ${fmt(legal.call)}${legal.call < legal.toCall ? '（全下）' : ''}`;
    el.raiseBox.hidden = !legal.raise;
    if (legal.raise) {
      el.range.min = legal.minTo; el.range.max = legal.maxTo; el.input.min = legal.minTo; el.input.max = legal.maxTo;
      if (document.activeElement !== el.input && document.activeElement !== el.range) {
        const keep = Number(el.input.value);
        const v = keep >= legal.minTo && keep <= legal.maxTo ? keep : legal.minTo;
        el.range.value = v; el.input.value = v;
      }
      el.raise.textContent = Number(el.input.value) >= legal.maxTo ? '全下' : (legal.toCall === 0 && view.currentBet === 0 ? '下注' : '加注');
    }
  }
  PieGame.setHeight();
}

function bindActions() {
  el.fold.addEventListener('click', () => myAct('fold'));
  el.checkcall.addEventListener('click', () => {
    const legal = legalFromView();
    if (legal) myAct(legal.check ? 'check' : 'call');
  });
  el.raise.addEventListener('click', () => myAct('raise', Number(el.input.value)));
  el.range.addEventListener('input', () => { el.input.value = el.range.value; render(); });
  el.input.addEventListener('input', () => { el.range.value = el.input.value; });
  el.actions.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const legal = legalFromView();
    if (!legal) return;
    const pot = view.pot + legal.toCall;
    const q = b.dataset.q;
    let v = legal.minTo;
    if (q === 'half') v = view.currentBet + Math.round(pot / 2);
    else if (q === 'pot') v = view.currentBet + pot;
    else if (q === 'all') v = legal.maxTo;
    v = Math.max(legal.minTo, Math.min(legal.maxTo, v));
    el.range.value = v; el.input.value = v; render();
  }));
}

// ---------- 大廳 ----------
function renderRooms(rooms) {
  el.rooms.innerHTML = '';
  if (!rooms.length) {
    const li = document.createElement('li');
    li.textContent = '目前沒有公開牌桌';
    li.style.cursor = 'default';
    el.rooms.appendChild(li);
  }
  rooms.forEach((room) => {
    const li = document.createElement('li');
    li.textContent = `${room.name || '德州撲克'}　${room.playerCount}/${room.maxPlayers}`;
    li.addEventListener('click', async () => {
      try { await client.join(room.id); } catch (err) { el.hello.textContent = `錯誤：${(err && (err.code || err.message)) || err}`; }
    });
    el.rooms.appendChild(li);
  });
  PieGame.setHeight();
}

async function refreshRooms() {
  try { renderRooms(await client.list()); } catch (err) { el.hello.textContent = `讀取牌桌列表失敗：${(err && (err.code || err.message)) || err}`; }
}

function showLobby() {
  clearTimeout(turnTimer); clearTimeout(nextTimer); clearInterval(tick);
  engine = null; view = null; roster = []; myHole = { handNo: 0, cards: [] };
  el.lobby.hidden = false; el.table.hidden = true;
  PieGame.setHeight();
}

function showTable() {
  el.lobby.hidden = true; el.table.hidden = false;
  clearInterval(tick);
  tick = setInterval(() => { if (view && view.actorId) render(); }, 1000);
  render();
}

// ---------- 連線 ----------
function onJoined(msg) {
  roster = (msg.players || []).slice();
  hostId = msg.hostId;
  view = msg.state && msg.state.table ? msg.state.table : null;
  viewAt = performance.now();
  engine = null;
  myHole = { handNo: 0, cards: [] };
  showTable();
  if (client.isHost) becomeHost();
  else if (hostId) client.send({ type: 'need-hole' }, hostId);
  if (!view && !client.isHost) el.msg.textContent = '等待房主…';
}

async function main() {
  const init = await PieGame.ready();
  applyTheme(init.theme);
  PieGame.onTheme(applyTheme);
  bindActions();
  if (!init.user) {
    el.hello.textContent = '請先在外框登入，才能加入牌桌。';
    PieGame.setHeight();
    return;
  }
  try {
    client = await PieGame.multiplayer.connect();
  } catch (err) {
    el.hello.textContent = `連線失敗：${err.message || err}`;
    PieGame.setHeight();
    return;
  }
  el.hello.textContent = `你好，${client.me.displayName}。開桌或加入一桌（2–6 人）。`;
  client.on('rooms', (msg) => { if (!client.room) renderRooms(msg.rooms); });
  client.on('joined', onJoined);
  client.on('playerJoined', (msg) => {
    if (msg.player && !roster.some((p) => p.id === msg.player.id)) roster.push(msg.player);
    if (!client.isHost || !engine) return;
    syncRoster();
    const seat = engine.player(msg.player.id);
    if (seat && seat.inHand && seat.hole.length && engine.inProgress()) client.send({ type: 'hole', handNo: engine.handNo, cards: seat.hole.slice() }, seat.id);
    publish();
    if (!engine.inProgress() && !nextTimer && engine.canStart()) scheduleNext(FIRST_HAND_MS);
  });
  client.on('playerLeft', (msg) => {
    roster = roster.filter((p) => p.id !== msg.playerId);
    if (!client.isHost || !engine) return;
    engine.removePlayer(msg.playerId);
    afterEngineChange();
  });
  client.on('hostChanged', (msg) => {
    hostId = msg.hostId;
    if (client.isHost) becomeHost();
    else client.send({ type: 'need-hole' }, hostId);
  });
  client.on('state', (msg) => {
    if (msg.key !== 'table' || client.isHost) return;
    view = msg.value;
    viewAt = performance.now();
    render();
  });
  client.on('message', (msg) => {
    const d = msg.data || {};
    if (client.isHost && engine) {
      if (d.type === 'act') hostAct(msg.from, d.action, d.amount);
      else if (d.type === 'need-hole') {
        const seat = engine.player(msg.from);
        if (seat && seat.hole.length && engine.inProgress()) client.send({ type: 'hole', handNo: engine.handNo, cards: seat.hole.slice() }, msg.from);
      }
    } else if (d.type === 'hole' && Array.isArray(d.cards)) {
      myHole = { handNo: d.handNo, cards: d.cards.slice(0, 2) };
      render();
    } else if (d.type === 'err') {
      flash(`不能這樣做：${d.error}`);
    }
  });
  client.on('disconnected', () => { el.net.hidden = false; });
  client.on('reconnected', () => { el.net.hidden = true; if (client.room) showTable(); });
  client.on('error', (err) => { el.hello.textContent = `錯誤：${err.code || ''}`; });

  const roomError = (err) => { el.hello.textContent = `錯誤：${(err && (err.code || err.message)) || err}`; };
  $('createPublic').addEventListener('click', () => client.create({ maxPlayers: 6, private: false, name: '德州撲克' }).catch(roomError));
  $('createPrivate').addEventListener('click', () => client.create({ maxPlayers: 6, private: true, name: '德州撲克' }).catch(roomError));
  $('refresh').addEventListener('click', refreshRooms);
  $('joinCode').addEventListener('click', () => {
    const code = el.code.value.trim();
    if (code) client.join(code).catch(roomError);
  });
  $('leave').addEventListener('click', async () => {
    await client.leave();
    showLobby();
    refreshRooms();
  });
  await refreshRooms();
  PieGame.setHeight();
}

main();
