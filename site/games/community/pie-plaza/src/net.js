// 連線：所有人進同一個「廣場大廳」房間（滿 16 人才開分流），廣播位置（含所在區域）與聊天。
import PieGame from '../../../../sdk/pie-game-sdk.js';
import { parsePos, parseChat } from './logic.js';

export const PLAZA_NAME = '廣場大廳';
const MAX_PLAYERS = 16, MERGE_MS = 6000;
const label = (p) => (p && (p.displayName || p.username)) || '訪客';
export const errText = (e) => ({ room_full: '房間已滿', room_not_found: '找不到房間', already_joined: '已在房間內' }[e && e.code] || (e && (e.code || e.message)) || '未知錯誤');

/**
 * cb：{ joined(players), playerJoined(p), playerLeft(id), pose(id, {x,y,area}), chat(id, text), other(id, data), status(text) }
 * 回傳 { me, sendPose(pose, to), sendChat(text), get count }
 */
export async function connectPlaza(cb) {
  const init = await PieGame.ready();
  PieGame.setHeight && PieGame.setHeight();
  if (!init || !init.user) return { offline: true, reason: '請先在外框登入股票大亂鬥帳號，才能進入廣場。' };
  const client = await PieGame.multiplayer.connect();
  const myId = String(client.me && client.me.id != null ? client.me.id : init.user.id);
  const me = { id: myId, name: label(client.me || init.user) };
  const others = new Map();
  let joining = false;

  const rooms = async () => (await client.list()).filter((r) => r.name === PLAZA_NAME && !r.private && r.playerCount < r.maxPlayers).sort((a, b) => b.playerCount - a.playerCount);
  async function join() {
    if (joining) return;
    joining = true;
    try {
      for (let i = 0; i < 3; i++) {
        const list = await rooms();
        try {
          if (list.length) await client.join(list[0].id);
          else await client.create({ maxPlayers: MAX_PLAYERS, private: false, name: PLAZA_NAME });
          return;
        } catch (err) {
          if (err && err.code === 'already_joined') return;
          if (!['room_full', 'room_not_found'].includes(err && err.code)) throw err;
        }
      }
      throw new Error('加入失敗，請重新整理頁面');
    } finally { joining = false; }
  }
  // 兩人同時開房會各開一間：自己一個人時定期併到人更多的同名房
  async function merge() {
    if (!client.room || others.size > 0 || joining) return;
    try {
      const list = (await rooms()).filter((r) => r.id !== client.room.id && r.playerCount > 0);
      if (!list.length) return;
      joining = true;
      await client.leave();
      await client.join(list[0].id);
    } catch (_e) { /* 下一輪再試 */ } finally { joining = false; }
  }

  client.on('joined', (msg) => {
    others.clear();
    for (const p of msg.players || []) if (String(p.id) !== myId) others.set(String(p.id), label(p));
    cb.joined([...others].map(([id, name]) => ({ id, name })));
  });
  client.on('playerJoined', (m) => { const id = String(m.player.id); if (id === myId) return; others.set(id, label(m.player)); cb.playerJoined({ id, name: label(m.player) }); });
  client.on('playerLeft', (m) => { const id = String(m.playerId); others.delete(id); cb.playerLeft(id); });
  client.on('message', (msg) => {
    const id = String(msg.from);
    if (id === myId) return;
    const pos = parsePos(msg.data);
    if (pos) { cb.pose(id, pos); return; }
    const text = parseChat(msg.data);
    if (text) { cb.chat(id, text); return; }
    if (msg.data && typeof msg.data === 'object' && cb.other) cb.other(id, msg.data);
  });
  client.on('disconnected', () => cb.status('連線中斷，重連中…'));
  client.on('reconnected', () => cb.status(null));
  client.on('error', (e) => { if (e && e.code === 'rejoin_failed') join().catch(() => {}); else cb.status(`錯誤：${errText(e)}`); });
  await join();
  setInterval(merge, MERGE_MS);
  return {
    me,
    /** 雲端存檔（SDK client.storage）；舊版 SDK 沒有時為 null。 */
    storage: client.storage || null,
    get online() { return others.size + 1; },
    nameOf: (id) => others.get(String(id)) || '訪客',
    sendPose(p, to) { if (client.room) client.send({ k: 'p', p: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10], a: p.area }, to); },
    sendChat(text) { if (client.room) client.send({ k: 'c', t: text }); },
    /** 其他訊息（外觀 l、釣魚大賽 f）；收到端一律自行檢查。 */
    send(data, to) { if (client.room) client.send(data, to); },
  };
}
