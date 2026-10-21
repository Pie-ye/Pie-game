// 連線：進同一條街的公開房間，互相廣播位置，看得到其他使用者。
// 沒登入（獨立模式）、?solo=1 或連線失敗時退回單機，不影響逛街。
import PieGame from '../../../../sdk/pie-game-sdk.js';
import { createAvatars } from './avatars.js';

const ROOM_NAME = '霓虹電玩街';
const MAX_PLAYERS = 16;
const TICK_MS = 100;           // 送位置的檢查間隔（relay 上限每連線 20 則／秒）
const IDLE_MS = 1000;          // 站著不動時的心跳
const MERGE_MS = 6000;         // 獨自在房時，每隔多久看看有沒有人數更多的同名房

// 注意：SDK 的連線逾時是 5 秒牆上時鐘，連線失敗後客戶端不會自己重連。
// 所以要在載入模型、編譯著色器（會卡住主執行緒）之前就開始連，連上後才不怕卡頓。
export function createMultiplayer({ scene, getPose, toast, onStatus }) {
  const avatars = createAvatars(scene);
  const status = { mode: 'solo', online: 1, reason: '' };
  let client = null, myId = null, timer = null, mergeTimer = null;
  let lastSent = null, lastSentAt = 0, joining = false;
  let lastArea = 'street';
  const names = new Map();   // id → displayName

  const publish = () => { status.online = avatars.count + 1; onStatus && onStatus({ ...status }); };
  const label = (p) => (p && (p.displayName || p.username)) || '玩家';
  const sid = (id) => String(id);

  function sendPose(to, force) {
    if (!client || !client.room) return;
    const p = getPose();
    if (!p) return;
    const s = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(3)];
    const now = performance.now();
    const area = p.area === 'arcade' ? 'arcade' : 'street';
    const changed = area !== lastArea || !lastSent || s.some((v, i) => Math.abs(v - lastSent[i]) > (i === 3 ? 0.01 : 0.02));
    if (!force && !changed && now - lastSentAt < IDLE_MS) return;
    lastSent = s; lastSentAt = now; lastArea = area;
    client.send({ k: 's', s, a: area }, to);
  }

  function onMessage(msg) {
    const d = msg.data;
    if (!d || d.k !== 's' || !Array.isArray(d.s) || d.s.length < 4) return;
    const id = sid(msg.from);
    if (id === myId) return;
    if (!d.s.every((v) => Number.isFinite(v))) return;
    if (d.a !== undefined && d.a !== 'arcade' && d.a !== 'street') return;
    const fresh = !avatars.has(id);
    avatars.push(id, names.get(id) || '玩家', d.s, d.a || 'street');
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
    sendPose(undefined, true);
  }

  async function joinStreet() {
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
          // 房間剛好滿了或剛被關掉：重新查一次
          if (!['room_full', 'room_not_found', 'already_joined'].includes(err && err.code)) throw err;
          if (err.code === 'already_joined') return;
        }
      }
      throw new Error('join_failed');
    } finally { joining = false; }
  }

  // 兩個人幾乎同時開房會各自開成一間：獨自在房時定期找人更多的同名房，併過去
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
    if (!init || !init.user) { status.reason = '未登入：單機逛街'; publish(); return status; }
    try {
      client = await PieGame.multiplayer.connect();
      myId = sid(client.me && client.me.id != null ? client.me.id : init.user.id);
      if (client.me) names.set(myId, label(client.me));
      client.on('joined', adopt);
      client.on('playerJoined', (msg) => {
        const id = sid(msg.player.id);
        names.set(id, label(msg.player));
        if (id === myId) return;
        avatars.add(id, label(msg.player));
        toast(`${label(msg.player)} 走進了街區`);
        publish();
        sendPose(msg.player.id, true);      // 讓新來的人馬上看到我
      });
      client.on('playerLeft', (msg) => {
        const id = sid(msg.playerId);
        if (id !== myId && avatars.has(id)) toast(`${names.get(id) || '玩家'} 離開了`);
        avatars.remove(id); names.delete(id); publish();
      });
      client.on('message', onMessage);
      client.on('disconnected', () => { status.mode = 'reconnecting'; avatars.clear(); publish(); });
      client.on('reconnected', () => { status.mode = 'online'; publish(); sendPose(undefined, true); });
      client.on('error', (err) => { if (err && err.code === 'rejoin_failed') joinStreet().catch(() => {}); });
      await joinStreet();
      timer = setInterval(() => sendPose(), TICK_MS);
      mergeTimer = setInterval(mergeCheck, MERGE_MS);
    } catch (err) {
      console.warn('多人連線失敗，改單機', err);
      status.mode = 'solo'; status.reason = '連線失敗：單機逛街'; publish();
      toast('多人連線失敗，先單機逛街');
    }
    return status;
  }

  return {
    start, avatars, status,
    update(dt, camPos) { avatars.update(dt, camPos, getPose()?.area || 'street'); },
    stop() { clearInterval(timer); clearInterval(mergeTimer); if (client) client.leave().catch(() => {}); avatars.clear(); },
  };
}
