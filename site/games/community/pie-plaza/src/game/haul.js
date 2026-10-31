// 廣場搬寶：純函式。第三人倒數、最多八人；走近木桶按 E 扛起，扛到東北大鍋按 E 放下得分。對標 Toontown Treasure Dive。
import { BOTS } from './party.js';

export const HAUL_JOIN = { x: 104, y: 168, k: 'barrel' };
export const HAUL_DROP = { x: 368, y: 72, k: 'cauldron' };

export const HAUL = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  payout: [40, 20, 10],
  restPay: 5,
};

const fail = (code, msg) => ({ ok: false, code, msg });

export function newHaul() {
  return { status: 'open', players: {}, order: [], holder: null, scores: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

function settle(round, now) {
  const scores = round.scores || {};
  const ranking = [...round.order].sort((a, b) => (scores[b] | 0) - (scores[a] | 0) || round.order.indexOf(a) - round.order.indexOf(b));
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < HAUL.payout.length ? HAUL.payout[i] : HAUL.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.holder = null;
  rnd.order.forEach((id) => { rnd.scores[id] = rnd.scores[id] | 0; });
}

export function maybeExpireHaul(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + HAUL.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= HAUL.roundMs) settle(round, now);
  return round;
}

export function haulPublic(round, now = 0) {
  maybeExpireHaul(round, now);
  const players = round.order.map((id) => ({
    id, name: round.players[id].name, holder: round.holder === id, score: round.scores[id] | 0,
  }));
  return {
    status: round.status, players, holder: round.holder, scores: { ...round.scores },
    startedAt: round.startedAt, endedAt: round.endedAt,
    payouts: round.payouts ? { ...round.payouts } : null,
    rank: round.rank ? [...round.rank] : [],
    min: HAUL.min, max: HAUL.max, countdownMs: HAUL.countdownMs, roundMs: HAUL.roundMs,
    join: { ...HAUL_JOIN }, drop: { ...HAUL_DROP },
  };
}

export function haulView(round, uid, now = 0) {
  const v = haulPublic(round, now);
  v.you = uid;
  v.payout = (round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function haulJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newHaul() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('haul_live', '搬寶已經開始了'), round: rnd };
  if (rnd.order.length >= HAUL.max) return { ...fail('haul_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  rnd.scores[uid] = 0;
  if (rnd.order.length >= HAUL.max) goLive(rnd, now);
  else if (rnd.order.length >= HAUL.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearAt(spot, x, y, msg) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - spot.x, py - spot.y) > HAUL.reach) return fail('too_far', msg);
  return null;
}

export function haulTake(round, uid, x, y, now) {
  if (!round) return fail('haul_none', '現在沒有搬寶');
  maybeExpireHaul(round, now);
  if (round.status === 'over') return { ...fail('haul_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去西邊木桶報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_haul', '你不在這一輪'), round };
  if (round.holder === uid) return { ...fail('already_holding', '寶物已經在你手上'), round };
  const bad = nearAt(HAUL_JOIN, x, y, '再走近木桶一點');
  if (bad) return { ...bad, round };
  round.holder = uid;
  return { ok: true, round, holder: uid };
}

export function haulDrop(round, uid, x, y, now) {
  if (!round) return fail('haul_none', '現在沒有搬寶');
  maybeExpireHaul(round, now);
  if (round.status === 'over') return { ...fail('haul_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去西邊木桶報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_haul', '你不在這一輪'), round };
  if (round.holder !== uid) return { ...fail('empty_hands', '你手上沒有寶物'), round };
  const bad = nearAt(HAUL_DROP, x, y, '再走近大鍋一點');
  if (bad) return { ...bad, round };
  round.scores[uid] = (round.scores[uid] | 0) + 1;
  round.holder = null;
  return { ok: true, round, score: round.scores[uid] };
}

export function haulLeave(round, uid, now) {
  if (!round) return fail('haul_none', '現在沒有搬寶');
  maybeExpireHaul(round, now);
  if (round.status === 'over') return { ...fail('haul_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_haul', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('haul_live', '開始後就不能退出'), round };
  delete round.players[uid];
  delete round.scores[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < HAUL.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applyHaulGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillHaulBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = haulJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  if (rnd && rnd.status === 'live') {
    const bot = BOTS.find((b) => rnd.players[b.id] && rnd.holder !== b.id);
    if (bot) {
      const r = haulTake(rnd, bot.id, HAUL_JOIN.x, HAUL_JOIN.y, now);
      if (r.ok) rnd = r.round;
    }
  }
  return rnd;
}
