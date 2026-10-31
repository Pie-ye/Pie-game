// 廣場占席：純函式。第三人倒數、最多八人；走近東北草席按 E 占住，持有時間最長的人拿 40 G。對標 king of the hill。
import { BOTS } from './party.js';

export const HILL_JOIN = { x: 424, y: 56, k: 'strawMat' };

export const HILL = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  payout: [40, 20, 10],
  restPay: 5,
};

const fail = (code, msg) => ({ ok: false, code, msg });

export function newHill() {
  return { status: 'open', players: {}, order: [], holder: null, heldAt: null, scores: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

function credit(round, now) {
  if (!round.holder || round.heldAt == null) return;
  const dt = Math.max(0, now - round.heldAt);
  round.scores[round.holder] = (round.scores[round.holder] | 0) + dt;
  round.heldAt = now;
}

function settle(round, now) {
  credit(round, now);
  const scores = round.scores || {};
  const ranking = [...round.order].sort((a, b) => (scores[b] | 0) - (scores[a] | 0) || round.order.indexOf(a) - round.order.indexOf(b));
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < HILL.payout.length ? HILL.payout[i] : HILL.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.holder = null;
  rnd.heldAt = null;
  rnd.order.forEach((id) => { rnd.scores[id] = rnd.scores[id] | 0; });
}

export function maybeExpireHill(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + HILL.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= HILL.roundMs) settle(round, now);
  return round;
}

export function hillPublic(round, now = 0) {
  maybeExpireHill(round, now);
  const rnd = round || newHill();
  const players = rnd.order.map((id) => ({
    id, name: rnd.players[id].name, holder: rnd.holder === id, score: rnd.scores[id] | 0,
  }));
  return {
    status: rnd.status, players, holder: rnd.holder, heldAt: rnd.heldAt, scores: { ...rnd.scores },
    startedAt: rnd.startedAt, endedAt: rnd.endedAt,
    payouts: rnd.payouts ? { ...rnd.payouts } : null,
    rank: rnd.rank ? [...rnd.rank] : [],
    min: HILL.min, max: HILL.max, countdownMs: HILL.countdownMs, roundMs: HILL.roundMs,
    join: { ...HILL_JOIN },
  };
}

export function hillView(round, uid, now = 0) {
  const v = hillPublic(round, now);
  v.you = uid;
  v.payout = (round && round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function hillJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newHill() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('hill_live', '占席已經開始了'), round: rnd };
  if (rnd.order.length >= HILL.max) return { ...fail('hill_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  if (rnd.order.length >= HILL.max) goLive(rnd, now);
  else if (rnd.order.length >= HILL.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearJoin(x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - HILL_JOIN.x, py - HILL_JOIN.y) > HILL.reach) return fail('too_far', '再走近草席一點');
  return null;
}

export function hillTake(round, uid, x, y, now) {
  if (!round) return fail('hill_none', '現在沒有占席');
  maybeExpireHill(round, now);
  if (round.status === 'over') return { ...fail('hill_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去東北草席報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_hill', '你不在這一輪'), round };
  if (round.holder === uid) return { ...fail('already_holding', '草席已經是你的'), round };
  const bad = nearJoin(x, y);
  if (bad) return { ...bad, round };
  credit(round, now);
  round.holder = uid;
  round.heldAt = now;
  return { ok: true, round, holder: uid };
}

export function hillLeave(round, uid, now) {
  if (!round) return fail('hill_none', '現在沒有占席');
  maybeExpireHill(round, now);
  if (round.status === 'over') return { ...fail('hill_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_hill', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('hill_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < HILL.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applyHillGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillHillBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = hillJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  if (rnd && rnd.status === 'live') {
    const bot = BOTS.find((b) => rnd.players[b.id]);
    if (bot) {
      const r = hillTake(rnd, bot.id, HILL_JOIN.x, HILL_JOIN.y, now);
      if (r.ok) rnd = r.round;
    }
  }
  return rnd;
}
