/**
 * 多人遊戲範本：連線 → 列房／建房／加入。
 * 斷線時 SDK 會自動要新 ticket、指數退避重連，並嘗試回到原房。
 */
import PieGame from '../../../sdk/pie-game-sdk.js';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'studio' ? 'studio' : 'playful';
}

const statusEl = document.getElementById('status');
const roomsEl = document.getElementById('rooms');

const init = await PieGame.ready();
applyTheme(init.theme);
PieGame.onTheme(applyTheme);
PieGame.setHeight(document.documentElement.scrollHeight);

if (!init.user) {
  statusEl.textContent = '獨立模式或未登入：無法連多人服務。請在外框登入後再開。';
} else {
  try {
    const client = await PieGame.multiplayer.connect();
    statusEl.textContent = `已連線，我是 ${client.me && client.me.displayName}`;
    client.on('joined', (msg) => {
      statusEl.textContent = `已加入 ${msg.room && msg.room.id}，房主？ ${client.isHost}`;
    });
    client.on('disconnected', () => { statusEl.textContent = '連線中斷，重連中…'; });
    client.on('reconnected', () => { statusEl.textContent = '已重連'; });
    client.on('error', (err) => { statusEl.textContent = `錯誤：${err.code || ''}`; });

    async function refresh() {
      const rooms = await client.list();
      roomsEl.innerHTML = '';
      rooms.forEach((room) => {
        const li = document.createElement('li');
        li.textContent = `${room.name || room.id}（${room.playerCount}/${room.maxPlayers}）`;
        li.addEventListener('click', () => client.join(room.id));
        roomsEl.appendChild(li);
      });
    }

    document.getElementById('refresh').addEventListener('click', refresh);
    document.getElementById('create').addEventListener('click', () => client.create({ maxPlayers: 4, private: false, name: '範本房' }));
    document.getElementById('join').addEventListener('click', () => {
      const code = document.getElementById('code').value.trim();
      if (code) client.join(code);
    });
    await refresh();
  } catch (err) {
    statusEl.textContent = `連線失敗：${err.message || err}`;
  }
}
