// 廣場砸罐：純函式。第三人倒數、最多八人；罐子冒出來時走近按 E 砸中計分。對標 carnival whack-a-mole / Epic Minigames Whack-a-Block。
import { BOTS } from './party.js';

export const SMASH_JOIN = { x: 312, y: 256, k: 'jarRed' };

export const SMASH = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  upMs: 1800,
  downMs: 1200,
  payout: [40, 20, 10],
  restPay: 5,
};

const fail = (code, msg) => ({ ok: false, code, msg });

export function newSmash() {
  return { status: 'open', players: {}, order: [], scores: {}, lastHit: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

export function smashPop(round, now) {
  if (!round || round.status !== 'live') return -1;
  const t = Math.max(0, now - (round.startedAt || 0));
  const cycle = SMASH.upMs + SMASH.downMs;
  return Math.floor(t / cycle);
}

export function smashUp(round, now) {
  if (!round || round.status !== 'live') return false;
  const t = Math.max(0, now - (round.startedAt || 0));
  const cycle = SMASH.upMs + SMASH.downMs;
  return (t % cycle) < SMASH.upMs;
}

/** 世界視覺用：沒開場時罐子一直看得到；開場後跟 smashUp 同一拍。 */
export function smashUpFromPublic(pub, now) {
  if (!pub || pub.status !== 'live') return true;
  const t = Math.max(0, now - (pub.startedAt || 0));
  const up = pub.upMs || SMASH.upMs;
  const down = pub.downMs || SMASH.downMs;
  return (t % (up + down)) < up;
}

function settle(round, now) {
  const scores = round.scores || {};
  const ranking = [...round.order].sort((a, b) => (scores[b] | 0) - (scores[a] | 0) || round.order.indexOf(a) - round.order.indexOf(b));
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < SMASH.payout.length ? SMASH.payout[i] : SMASH.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.lastHit = {};
  rnd.order.forEach((id) => { rnd.scores[id] = rnd.scores[id] | 0; });
}

export function maybeExpireSmash(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + SMASH.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= SMASH.roundMs) settle(round, now);
  return round;
}

export function smashPublic(round, now = 0) {
  maybeExpireSmash(round, now);
  const rnd = round || newSmash();
  const players = rnd.order.map((id) => ({
    id, name: rnd.players[id].name, score: rnd.scores[id] | 0,
  }));
  return {
    status: rnd.status, players, scores: { ...rnd.scores },
    up: smashUp(rnd, now), pop: smashPop(rnd, now),
    startedAt: rnd.startedAt, endedAt: rnd.endedAt,
    payouts: rnd.payouts ? { ...rnd.payouts } : null,
    rank: rnd.rank ? [...rnd.rank] : [],
    min: SMASH.min, max: SMASH.max, countdownMs: SMASH.countdownMs, roundMs: SMASH.roundMs,
    upMs: SMASH.upMs, downMs: SMASH.downMs,
    join: { ...SMASH_JOIN },
  };
}

export function smashView(round, uid, now = 0) {
  const v = smashPublic(round, now);
  v.you = uid;
  v.payout = (round && round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function smashJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newSmash() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('smash_live', '砸罐已經開始了'), round: rnd };
  if (rnd.order.length >= SMASH.max) return { ...fail('smash_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  if (rnd.order.length >= SMASH.max) goLive(rnd, now);
  else if (rnd.order.length >= SMASH.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearJoin(x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - SMASH_JOIN.x, py - SMASH_JOIN.y) > SMASH.reach) return fail('too_far', '再走近紅罐一點');
  return null;
}

export function smashHit(round, uid, x, y, now) {
  if (!round) return fail('smash_none', '現在沒有砸罐');
  maybeExpireSmash(round, now);
  if (round.status === 'over') return { ...fail('smash_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去南岸紅罐報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_smash', '你不在這一輪'), round };
  const bad = nearJoin(x, y);
  if (bad) return { ...bad, round };
  if (!smashUp(round, now)) return { ...fail('not_up', '罐子還沒冒出來'), round };
  const pop = smashPop(round, now);
  if (round.lastHit[uid] === pop) return { ...fail('already_hit', '這一波你已經砸過了'), round };
  round.lastHit[uid] = pop;
  round.scores[uid] = (round.scores[uid] | 0) + 1;
  return { ok: true, round, pop, score: round.scores[uid] };
}

export function smashLeave(round, uid, now) {
  if (!round) return fail('smash_none', '現在沒有砸罐');
  maybeExpireSmash(round, now);
  if (round.status === 'over') return { ...fail('smash_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_smash', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('smash_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < SMASH.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applySmashGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillSmashBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = smashJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  if (rnd && rnd.status === 'live') {
    const bot = BOTS.find((b) => rnd.players[b.id]);
    if (bot) {
      const r = smashHit(rnd, bot.id, SMASH_JOIN.x, SMASH_JOIN.y, now);
      if (r.ok) rnd = r.round;
    }
  }
  return rnd;
}
