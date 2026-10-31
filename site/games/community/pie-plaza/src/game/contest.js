// 釣魚大賽：純函式。廣場海釣在 12–13、18–19（台北）寫進共現記分板，時段結束發 G。
import { eventById, isActive, taipei } from '../events/schedule.js';

export const BOARD = { x: 240, y: 268, k: 'signSmall' };

export const CONTEST = {
  payout: [40, 20, 10],
  restPay: 5,
  goldenMult: 2,
};

const fail = (code, msg) => ({ ok: false, code, msg });

export function fishingSlot(ms) {
  const t = taipei(ms);
  const e = eventById('fishing');
  if (!e || !isActive(e, t)) return null;
  const slot = e.slots.find(([a, b]) => t.h >= a && t.h < b);
  return slot ? `${slot[0]}-${slot[1]}` : null;
}

export function newContest(slot = null) {
  return { status: 'open', slot, players: {}, order: [], startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

function settle(round, now) {
  const ranking = [...round.order].sort((a, b) => {
    const ds = round.players[b].score - round.players[a].score;
    return ds !== 0 ? ds : round.order.indexOf(a) - round.order.indexOf(b);
  });
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < CONTEST.payout.length ? CONTEST.payout[i] : CONTEST.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

/** 時段結束就把目前榜結算。沒人上榜也標 over，讓下一場能開新局。 */
export function maybeExpireContest(round, now) {
  if (!round || round.status !== 'open') return round;
  const slot = fishingSlot(now);
  if (slot && slot === round.slot) return round;
  if (round.order.length) settle(round, now);
  else {
    round.status = 'over';
    round.endedAt = now;
  }
  return round;
}

export function contestPublic(round, now = 0) {
  if (round) maybeExpireContest(round, now);
  const rnd = round || newContest(fishingSlot(now));
  const players = (rnd.order || []).map((id) => ({
    id, name: rnd.players[id].name, score: rnd.players[id].score, n: rnd.players[id].n,
  }));
  return {
    status: rnd.status,
    slot: rnd.slot,
    active: !!fishingSlot(now),
    players,
    startedAt: rnd.startedAt,
    endedAt: rnd.endedAt,
    payouts: rnd.payouts ? { ...rnd.payouts } : null,
    rank: rnd.rank ? [...rnd.rank] : [],
  };
}

export function contestView(round, uid, now = 0) {
  const v = contestPublic(round, now);
  v.you = uid;
  v.payout = (round && round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function contestCatch(round, uid, name, fishId, size, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  const slot = fishingSlot(now);
  if (!slot) return { ...fail('contest_closed', '現在不是釣魚大賽時段'), round };
  const sz = Math.max(0, Number(size) | 0);
  if (!sz) return { ok: true, round, points: 0 };
  let rnd = (!round || round.status === 'over' || round.slot !== slot) ? newContest(slot) : round;
  if (!rnd.players[uid]) {
    rnd.players[uid] = { name: String(name || '訪客').slice(0, 16), score: 0, n: 0 };
    rnd.order.push(uid);
    if (!rnd.startedAt) rnd.startedAt = now;
  }
  const pts = fishId === 'golden' ? sz * CONTEST.goldenMult : sz;
  rnd.players[uid].score += pts;
  rnd.players[uid].n += 1;
  return { ok: true, round: rnd, points: pts };
}

export function applyContestGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}
