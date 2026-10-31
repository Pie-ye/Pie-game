// 傳南瓜：純函式。第三人倒數、最多八人；開場第一人拿著。拿著的人在雞舍旁按 E 傳給下一位（剛接到要等 passMs 才能再傳）。
// 時間到手上有南瓜的人最後一名，其他人依拿在手上的總時間越短越前面。
import { BOTS } from './party.js';

export const HOT_JOIN = { x: 128, y: 100, k: 'pumpkinItem' };

export const HOT = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  passMs: 1200,
  payout: [40, 20, 10],
  restPay: 5,
};

const fail = (code, msg) => ({ ok: false, code, msg });

export function newHot() {
  return { status: 'open', players: {}, order: [], holder: null, heldAt: null, hold: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

function settle(round, now) {
  const holder = round.holder;
  const hold = round.hold || (round.hold = {});
  if (holder && round.heldAt != null) hold[holder] = (hold[holder] | 0) + Math.max(0, now - round.heldAt);
  const rest = round.order.filter((id) => id !== holder).sort((a, b) => (hold[a] | 0) - (hold[b] | 0) || round.order.indexOf(a) - round.order.indexOf(b));
  const ranking = holder && round.order.includes(holder) ? [...rest, holder] : [...round.order];
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < HOT.payout.length ? HOT.payout[i] : HOT.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.holder = rnd.order[0] || null;
  rnd.heldAt = rnd.holder ? now : null;
  rnd.hold = {};
}

export function maybeExpireHot(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + HOT.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= HOT.roundMs) settle(round, now);
  return round;
}

export function hotPublic(round, now = 0) {
  maybeExpireHot(round, now);
  const players = round.order.map((id) => ({
    id, name: round.players[id].name, holder: round.holder === id,
  }));
  return {
    status: round.status, players, holder: round.holder, heldAt: round.heldAt,
    startedAt: round.startedAt, endedAt: round.endedAt,
    payouts: round.payouts ? { ...round.payouts } : null,
    rank: round.rank ? [...round.rank] : [],
    min: HOT.min, max: HOT.max, countdownMs: HOT.countdownMs, roundMs: HOT.roundMs,
    join: { ...HOT_JOIN },
  };
}

export function hotView(round, uid, now = 0) {
  const v = hotPublic(round, now);
  v.you = uid;
  v.payout = (round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function hotJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newHot() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('hot_live', '傳南瓜已經開始了'), round: rnd };
  if (rnd.order.length >= HOT.max) return { ...fail('hot_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  if (rnd.order.length >= HOT.max) goLive(rnd, now);
  else if (rnd.order.length >= HOT.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearJoin(x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - HOT_JOIN.x, py - HOT_JOIN.y) > HOT.reach) return fail('too_far', '再走近南瓜一點');
  return null;
}

export function hotTake(round, uid, x, y, now) {
  if (!round) return fail('hot_none', '現在沒有傳南瓜');
  maybeExpireHot(round, now);
  if (round.status === 'over') return { ...fail('hot_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去雞舍旁邊報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_hot', '你不在這一輪'), round };
  if (round.holder !== uid) return { ...fail('not_holder', '南瓜不在你手上，看好下一個是誰'), round };
  if (now - (round.heldAt || 0) < HOT.passMs) return { ...fail('too_soon', '剛接到，等一下再傳'), round };
  const bad = nearJoin(x, y);
  if (bad) return { ...bad, round };
  const hold = round.hold || (round.hold = {});
  hold[uid] = (hold[uid] | 0) + Math.max(0, now - round.heldAt);
  const next = round.order[(round.order.indexOf(uid) + 1) % round.order.length];
  round.holder = next;
  round.heldAt = now;
  return { ok: true, round, holder: next, passed: uid };
}

export function hotLeave(round, uid, now) {
  if (!round) return fail('hot_none', '現在沒有傳南瓜');
  maybeExpireHot(round, now);
  if (round.status === 'over') return { ...fail('hot_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_hot', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('hot_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < HOT.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applyHotGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillHotBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = hotJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  return rnd;
}

/** 訪客沙盒：南瓜在機器人手上超過一下子就傳出去（每次呼叫最多傳一次）。 */
export function botsPassHot(round, now) {
  if (!round || round.status !== 'live' || !round.holder) return round;
  if (!BOTS.some((b) => b.id === round.holder)) return round;
  if (now - (round.heldAt || 0) < HOT.passMs + 800) return round;
  const r = hotTake(round, round.holder, HOT_JOIN.x, HOT_JOIN.y, now);
  return r.round || round;
}
