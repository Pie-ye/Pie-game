// 營火捉迷藏：純函式。第三人倒數、最多八人；第一人當尋人，其他人藏進圓木／樹／石頭。
import { BOTS } from './party.js';

export const SEEK_JOIN = { x: 140, y: 214, k: 'log' };

export const SEEK = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  payout: [40, 20, 10],
  restPay: 5,
  spots: [
    { id: 'logW', k: 'log', x: 196, y: 184, name: '西邊圓木' },
    { id: 'logE', k: 'log', x: 284, y: 184, name: '東邊圓木' },
    { id: 'stump', k: 'stump', x: 292, y: 112, name: '樹樁' },
    { id: 'treeSW', k: 'treeRound', x: 50, y: 210, name: '西南大樹' },
    { id: 'treeS', k: 'treeApple', x: 62, y: 254, name: '南邊蘋果樹' },
    { id: 'treeSE', k: 'treeRound', x: 120, y: 258, name: '南邊大樹' },
    { id: 'rock', k: 'rockBig', x: 96, y: 250, name: '大石頭' },
    { id: 'bushS', k: 'treeSmall', x: 190, y: 246, name: '南邊小樹' },
  ],
};

const SPOT_BY = Object.fromEntries(SEEK.spots.map((s) => [s.id, s]));
const fail = (code, msg) => ({ ok: false, code, msg });

export function newSeek() {
  return { status: 'open', players: {}, order: [], seeker: null, hidden: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

function settle(round, now) {
  const hiders = round.order.filter((id) => round.hidden[id]);
  const ranking = (hiders.length ? hiders : [...round.order]).sort((a, b) => round.order.indexOf(a) - round.order.indexOf(b));
  if (hiders.length) {
    for (const id of round.order) if (!hiders.includes(id)) ranking.push(id);
  }
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < SEEK.payout.length ? SEEK.payout[i] : SEEK.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.seeker = rnd.order[0];
}

export function maybeExpireSeek(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + SEEK.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= SEEK.roundMs) settle(round, now);
  return round;
}

export function seekPublic(round, now = 0) {
  maybeExpireSeek(round, now);
  const spots = SEEK.spots.map((s) => ({ ...s, takenBy: Object.entries(round.hidden).find(([, id]) => id === s.id)?.[0] || null }));
  const players = round.order.map((id) => ({
    id, name: round.players[id].name, seeker: round.seeker === id, hidden: !!round.hidden[id],
  }));
  return {
    status: round.status, players, spots, seeker: round.seeker, hidden: { ...round.hidden },
    startedAt: round.startedAt, endedAt: round.endedAt,
    payouts: round.payouts ? { ...round.payouts } : null,
    rank: round.rank ? [...round.rank] : [],
    min: SEEK.min, max: SEEK.max, countdownMs: SEEK.countdownMs, roundMs: SEEK.roundMs,
  };
}

export function seekView(round, uid, now = 0) {
  const v = seekPublic(round, now);
  v.you = uid;
  v.payout = (round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function seekJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newSeek() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('seek_live', '捉迷藏已經開始了'), round: rnd };
  if (rnd.order.length >= SEEK.max) return { ...fail('seek_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  if (rnd.order.length >= SEEK.max) goLive(rnd, now);
  else if (rnd.order.length >= SEEK.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearSpot(spot, x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - spot.x, py - spot.y) > SEEK.reach) return fail('too_far', '再走近一點');
  return null;
}

export function seekHide(round, uid, spot, x, y, now) {
  if (!round) return fail('seek_none', '現在沒有捉迷藏');
  maybeExpireSeek(round, now);
  if (round.status === 'over') return { ...fail('seek_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去西南草地報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_seek', '你不在這一輪'), round };
  if (round.seeker === uid) return { ...fail('not_hider', '尋人要去檢查藏點，不能自己藏'), round };
  if (round.hidden[uid]) return { ...fail('already_hidden', '你已經藏好了'), round };
  const s = SPOT_BY[spot];
  if (!s) return { ...fail('bad_message', '沒有這個藏點'), round };
  if (Object.values(round.hidden).includes(s.id)) return { ...fail('spot_taken', '這裡已經有人了'), round };
  const bad = nearSpot(s, x, y);
  if (bad) return { ...bad, round };
  round.hidden[uid] = s.id;
  return { ok: true, round, hid: s.id };
}

export function seekCheck(round, uid, spot, x, y, now) {
  if (!round) return fail('seek_none', '現在沒有捉迷藏');
  maybeExpireSeek(round, now);
  if (round.status === 'over') return { ...fail('seek_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去西南草地報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_seek', '你不在這一輪'), round };
  if (round.seeker !== uid) return { ...fail('not_seeker', '你不是尋人'), round };
  const s = SPOT_BY[spot];
  if (!s) return { ...fail('bad_message', '沒有這個藏點'), round };
  const bad = nearSpot(s, x, y);
  if (bad) return { ...bad, round };
  const found = Object.entries(round.hidden).find(([, id]) => id === s.id);
  if (!found) return { ...fail('empty_spot', '這裡沒有人'), round };
  const [hidUid] = found;
  delete round.hidden[hidUid];
  round.seeker = hidUid;
  return { ok: true, round, found: hidUid };
}

export function seekLeave(round, uid, now) {
  if (!round) return fail('seek_none', '現在沒有捉迷藏');
  maybeExpireSeek(round, now);
  if (round.status === 'over') return { ...fail('seek_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_seek', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('seek_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < SEEK.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applySeekGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillSeekBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = seekJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  if (rnd && rnd.status === 'live') {
    for (const bot of BOTS) {
      if (!rnd.players[bot.id] || rnd.seeker === bot.id || rnd.hidden[bot.id]) continue;
      const free = SEEK.spots.find((s) => !Object.values(rnd.hidden).includes(s.id));
      if (!free) break;
      const r = seekHide(rnd, bot.id, free.id, free.x, free.y, now);
      if (r.ok) rnd = r.round;
    }
  }
  return rnd;
}
