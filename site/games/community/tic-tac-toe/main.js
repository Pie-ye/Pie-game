import PieGame from '../../../sdk/pie-game-sdk.js';

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'studio' ? 'studio' : 'playful';
}

function emptyGame() {
  return {
    board: Array(9).fill(''),
    xId: null,
    oId: null,
    turn: 'X',
    status: 'waiting',
  };
}

function winnerOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return 'draw';
  return null;
}

const lobby = document.getElementById('lobby');
const table = document.getElementById('table');
const roomsEl = document.getElementById('rooms');
const hello = document.getElementById('hello');
const meta = document.getElementById('meta');
const turnEl = document.getElementById('turn');
const netEl = document.getElementById('net');
const boardEl = document.getElementById('board');
const codeInput = document.getElementById('code');

let client = null;
let game = emptyGame();
let players = [];

function markFor(userId) {
  if (userId && userId === game.xId) return 'X';
  if (userId && userId === game.oId) return 'O';
  return '';
}

function showLobby() {
  lobby.hidden = false;
  table.hidden = true;
  PieGame.setHeight(document.documentElement.scrollHeight);
}

function showTable() {
  lobby.hidden = true;
  table.hidden = false;
  renderBoard();
  PieGame.setHeight(document.documentElement.scrollHeight);
}

function renderBoard() {
  const meId = client && client.me ? client.me.id : null;
  const mine = markFor(meId);
  const room = client && client.room;
  const code = room && room.code ? `　代碼 ${room.code}` : '';
  meta.textContent = `你是 ${mine || '觀戰'}${client && client.isHost ? '（房主）' : ''}${code}`;
  if (game.status === 'waiting') turnEl.textContent = '等待對手加入';
  else if (game.status === 'x-win') turnEl.textContent = 'X 勝';
  else if (game.status === 'o-win') turnEl.textContent = 'O 勝';
  else if (game.status === 'draw') turnEl.textContent = '平手';
  else turnEl.textContent = `輪到 ${game.turn}`;

  boardEl.innerHTML = '';
  game.board.forEach((cell, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cell';
    btn.textContent = cell || '';
    const canPlay = game.status === 'playing' && !cell && mine === game.turn;
    btn.disabled = !canPlay;
    btn.addEventListener('click', () => playCell(i));
    boardEl.appendChild(btn);
  });
}

function publish(next) {
  game = next;
  if (!client || !client.isHost) return;
  client.setState('game', next);
  renderBoard();
}

function applyState(value) {
  if (!value || !Array.isArray(value.board)) return;
  game = {
    board: value.board.slice(0, 9).map((c) => (c === 'X' || c === 'O' ? c : '')),
    xId: value.xId,
    oId: value.oId,
    turn: value.turn === 'O' ? 'O' : 'X',
    status: value.status || 'waiting',
  };
  renderBoard();
}

function seatPlayers(list) {
  players = list || players;
  if (!client || !client.isHost) return;
  const ids = players.map((p) => p.id);
  if (!ids.length) return;
  const xId = game.xId && ids.includes(game.xId) ? game.xId : ids[0];
  const others = ids.filter((id) => id !== xId);
  const oId = game.oId && others.includes(game.oId) ? game.oId : (others[0] || null);
  const next = { ...game, xId, oId };
  const boardEmpty = next.board.every((cell) => !cell);
  if (next.oId && next.status === 'waiting') {
    next.status = 'playing';
    if (boardEmpty) next.turn = 'X';
  }
  if (next.xId !== game.xId || next.oId !== game.oId || next.status !== game.status) {
    publish(next);
  }
}

function playCell(i) {
  if (!client || !client.me) return;
  if (game.status !== 'playing' || game.board[i]) return;
  if (markFor(client.me.id) !== game.turn) return;
  if (client.isHost) applyMove(client.me.id, i);
  else client.send({ type: 'move', cell: i });
}

function applyMove(fromId, i) {
  if (!client || !client.isHost) return;
  if (game.status !== 'playing') return;
  if (typeof i !== 'number' || i < 0 || i > 8 || game.board[i]) return;
  const mark = markFor(fromId);
  if (mark !== game.turn) return;
  const board = game.board.slice();
  board[i] = mark;
  const win = winnerOf(board);
  let status = 'playing';
  if (win === 'X') status = 'x-win';
  else if (win === 'O') status = 'o-win';
  else if (win === 'draw') status = 'draw';
  publish({
    ...game,
    board,
    turn: mark === 'X' ? 'O' : 'X',
    status,
  });
}

async function refreshRooms() {
  if (!client) return;
  const rooms = await client.list();
  roomsEl.innerHTML = '';
  if (!rooms.length) {
    const li = document.createElement('li');
    li.textContent = '目前沒有公開房';
    li.style.cursor = 'default';
    roomsEl.appendChild(li);
    return;
  }
  rooms.forEach((room) => {
    const li = document.createElement('li');
    li.textContent = `${room.name || '井字棋'}　${room.playerCount}/${room.maxPlayers}`;
    li.addEventListener('click', () => client.join(room.id));
    roomsEl.appendChild(li);
  });
}

function onJoined(msg) {
  players = msg.players || [];
  if (msg.state && msg.state.game) applyState(msg.state.game);
  else game = emptyGame();
  showTable();
  seatPlayers(players);
  renderBoard();
}

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme(applyTheme);

if (!init.user) {
  hello.textContent = '請先在外框登入，才能加入房間。';
  PieGame.setHeight(document.documentElement.scrollHeight);
} else {
  try {
    client = await PieGame.multiplayer.connect();
    hello.textContent = `你好，${client.me.displayName}。開房或加入一場兩人對戰。`;
    client.on('joined', onJoined);
    client.on('playerJoined', (msg) => {
      if (msg.player) players.push(msg.player);
      seatPlayers(players);
    });
    client.on('playerLeft', (msg) => {
      players = players.filter((p) => p.id !== msg.playerId);
      seatPlayers(players);
    });
    client.on('hostChanged', () => {
      seatPlayers(players);
      renderBoard();
    });
    client.on('state', (msg) => {
      if (msg.key === 'game') applyState(msg.value);
    });
    client.on('message', (msg) => {
      if (client.isHost && msg.data && msg.data.type === 'move') {
        applyMove(msg.from, msg.data.cell);
      }
    });
    client.on('disconnected', () => { netEl.hidden = false; });
    client.on('reconnected', () => {
      netEl.hidden = true;
      if (client.room) showTable();
    });
    client.on('error', (err) => {
      hello.textContent = `錯誤：${err.code || ''}`;
    });
    document.getElementById('createPublic').addEventListener('click', () => {
      client.create({ maxPlayers: 2, private: false, name: '井字棋' });
    });
    document.getElementById('createPrivate').addEventListener('click', () => {
      client.create({ maxPlayers: 2, private: true, name: '井字棋' });
    });
    document.getElementById('refresh').addEventListener('click', refreshRooms);
    document.getElementById('joinCode').addEventListener('click', () => {
      const code = codeInput.value.trim();
      if (code) client.join(code);
    });
    document.getElementById('leave').addEventListener('click', async () => {
      await client.leave();
      game = emptyGame();
      showLobby();
      refreshRooms();
    });
    await refreshRooms();
    PieGame.setHeight(document.documentElement.scrollHeight);
  } catch (err) {
    hello.textContent = `連線失敗：${err.message || err}`;
    PieGame.setHeight(document.documentElement.scrollHeight);
  }
}
