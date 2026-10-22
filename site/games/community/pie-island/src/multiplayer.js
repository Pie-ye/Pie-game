// 連線：所有人進同一座島的公開房間，互相廣播位置、外觀與表情。
// 沒登入（獨立模式）、?solo=1 或連線失敗時退回單機，照樣可以逛島。
import PieGame from '../../../../sdk/pie-game-sdk.js';
import { createAvatars } from './avatars.js';
import { encode } from './look.js';
import { EMOTE_IDS } from './character.js';

export const ROOM_NAME = '小島樂園';
const MAX_PLAYERS = 16;
const TICK_MS = 100;           // 位置送出檢查間隔（relay 上限每連線 20 則／秒）
const IDLE_MS = 1000;          // 站著不動時的心跳
const MERGE_MS = 6000;         // 自己一個人時，每隔多久看看有沒有人更多的同名房
const ASK_MS = 3000;           // 還不知道對方長相時，多久再問一次

// 訊息格式：
//   { k:'s', s:[x,y,z,yaw] }   位置
//   { k:'l', l:[…整數] }       外觀（look.js 的 encode）
//   { k:'e', e:'wave' }        表情
//   { k:'q' }                  請對方把外觀與位置再送一次（密語）
export function createMultiplayer({ scene, getPose, getLook, toast, onStatus }) {
  const avatars = createAvatars(scene);
  const status = { mode: 'solo', online: 1, reason: '', name: '' };
  let client = null, myId = null, timer = null, mergeTimer = null;
  let lastSent = null, lastSentAt = 0, joining = false;
  const names = new Map();

  const publish = () => { status.online = avatars.count + 1; onStatus && onStatus({ ...status }); };
  const label = (p) => (p && (p.displayName || p.username)) || '島民';
  const sid = (id) => String(id);
  const nameOf = (id) => names.get(id) || '島民';

  function sendPose(to, force) {
    if (!client || !client.room) return;
    const p = getPose();
    if (!p) return;
    const s = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3)];
    const now = performance.now();
    const changed = !lastSent || s.some((v, i) => Math.abs(v - lastSent[i]) > (i === 3 ? 0.01 : 0.02));
    if (!force && !changed && now - lastSentAt < IDLE_MS) return;
    if (to == null) { lastSent = s; lastSentAt = now; }
    client.send({ k: 's', s }, to);
  }
  const sendLook = (to) => { if (client && client.room) client.send({ k: 'l', l: encode(getLook()) }, to); };

  function onMessage(msg) {
    const d = msg.data;
    if (!d || typeof d !== 'object') return;
    const id = sid(msg.from);
    if (id === myId) return;
    const fresh = !avatars.has(id);
    if (d.k === 's') {
      if (!Array.isArray(d.s) || d.s.length < 4 || !d.s.slice(0, 4).every((v) => Number.isFinite(v))) return;
      const p = avatars.push(id, nameOf(id), d.s);
      const now = performance.now();
      if (!p.lookKnown && now - p.asked > ASK_MS) { p.asked = now; client.send({ k: 'q' }, msg.from); }
    } else if (d.k === 'l') {
      if (!Array.isArray(d.l) || d.l.length > 64) return;
      avatars.setLook(id, nameOf(id), d.l);
    } else if (d.k === 'e') {
      if (!EMOTE_IDS.includes(d.e)) return;
      avatars.emote(id, nameOf(id), d.e);
    } else if (d.k === 'q') {
      sendLook(msg.from); sendPose(msg.from, true);
      return;
    } else return;
    if (fresh) publish();
  }

  function adopt(msg) {
    avatars.clear(); names.clear();
    for (const p of msg.players || []) {
      names.set(sid(p.id), label(p));
      if (sid(p.id) !== myId) avatars.add(sid(p.id), label(p));
    }
    status.mode = 'online';
    publish();
    sendLook();
    sendPose(undefined, true);
  }

  async function joinIsland() {
    if (joining) return;
    joining = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const rooms = (await client.list()).filter((r) => r.name === ROOM_NAME && !r.private && r.playerCount < r.maxPlayers);
        rooms.sort((a, b) => b.playerCount - a.playerCount);
        try {
          if (rooms.length) await client.join(rooms[0].id);
          else await client.create({ maxPlayers: MAX_PLAYERS, private: false, name: ROOM_NAME });
          return;
        } catch (err) {
          if (err && err.code === 'already_joined') return;
          if (!['room_full', 'room_not_found'].includes(err && err.code)) throw err;
        }
      }
      throw new Error('join_failed');
    } finally { joining = false; }
  }

  // 兩個人幾乎同時開房會各開一間：自己一個人時定期找人更多的同名房併過去
  async function mergeCheck() {
    if (!client || !client.room || avatars.count > 0 || joining) return;
    try {
      const rooms = (await client.list()).filter((r) => r.name === ROOM_NAME && !r.private && r.id !== client.room.id
        && r.playerCount > 0 && r.playerCount < r.maxPlayers);
      if (!rooms.length) return;
      rooms.sort((a, b) => b.playerCount - a.playerCount);
      await client.leave();
      avatars.clear(); names.clear();
      await client.join(rooms[0].id);
    } catch (_err) { /* 下一輪再試 */ }
  }

  async function start() {
    const params = new URLSearchParams(location.search);
    if (params.get('solo') === '1') { status.reason = '單機模式'; publish(); return status; }
    let init;
    try { init = await PieGame.ready(); } catch (_err) { init = { user: null }; }
    if (!init || !init.user) { status.reason = '未登入：單機逛島'; publish(); return status; }
    status.name = label(init.user);
    try {
      client = await PieGame.multiplayer.connect();
      myId = sid(client.me && client.me.id != null ? client.me.id : init.user.id);
      if (client.me) { names.set(myId, label(client.me)); status.name = label(client.me); }
      client.on('joined', adopt);
      client.on('playerJoined', (msg) => {
        const id = sid(msg.player.id);
        names.set(id, label(msg.player));
        if (id === myId) return;
        avatars.add(id, label(msg.player));
        avatars.rename(id, label(msg.player));
        toast(`${label(msg.player)} 來到島上了`);
        publish();
        sendLook(msg.player.id);                 // 讓新來的人馬上看到我長怎樣、在哪
        sendPose(msg.player.id, true);
      });
      client.on('playerLeft', (msg) => {
        const id = sid(msg.playerId);
        if (id !== myId && avatars.has(id)) toast(`${nameOf(id)} 回家了`);
        avatars.remove(id); names.delete(id); publish();
      });
      client.on('message', onMessage);
      client.on('disconnected', () => { status.mode = 'reconnecting'; avatars.clear(); publish(); });
      client.on('reconnected', () => { status.mode = 'online'; publish(); sendLook(); sendPose(undefined, true); });
      client.on('error', (err) => { if (err && err.code === 'rejoin_failed') joinIsland().catch(() => {}); });
      await joinIsland();
      timer = setInterval(() => sendPose(), TICK_MS);
      mergeTimer = setInterval(mergeCheck, MERGE_MS);
    } catch (err) {
      console.warn('多人連線失敗，改單機', err);
      status.mode = 'solo'; status.reason = '連線失敗：單機逛島'; publish();
      toast('多人連線失敗，先一個人逛島');
    }
    return status;
  }

  return {
    start, avatars, status,
    /** 外觀改了：廣播給所有人 */
    lookChanged() { sendLook(); },
    emote(e) { if (client && client.room && EMOTE_IDS.includes(e)) client.send({ k: 'e', e }); },
    update(dt, camPos) { avatars.update(dt, camPos); },
    stop() { clearInterval(timer); clearInterval(mergeTimer); if (client) client.leave().catch(() => {}); avatars.clear(); },
  };
}
