// 廣場拔河：純函式。第三人倒數、最多八人；單數左岸、雙數右岸，走近乾草樁按 E 拉。
import { BOTS } from './party.js';

export const TUG_JOIN = { x: 360, y: 180, k: 'hay' };

export const TUG = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  payout: [40, 20, 10],
  restPay: 5,
  winPay: 40,
  losePay: 5,
  tiePay: 10,
  spots: [
    { id: 'L', k: 'hay', x: 328, y: 180, name: '左岸' },
    { id: 'R', k: 'hay', x: 392, y: 180, name: '右岸' },
  ],
};

const SPOT_BY = Object.fromEntries(TUG.spots.map((s) => [s.id, s]));
const fail = (code, msg) => ({ ok: false, code, msg });

export function newTug() {
  return { status: 'open', players: {}, order: [], team: {}, pulls: {}, score: { L: 0, R: 0 }, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [], winner: null };
}

function sideOf(i) {
  return i % 2 === 0 ? 'L' : 'R';
}

function settle(round, now) {
  const L = round.score.L | 0, R = round.score.R | 0;
  let winner = null;
  if (L > R) winner = 'L';
  else if (R > L) winner = 'R';
  const ranking = [...round.order].sort((a, b) => {
    const ta = round.team[a], tb = round.team[b];
    if (winner) {
      const aw = ta === winner ? 0 : 1, bw = tb === winner ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }
    return (round.pulls[b] | 0) - (round.pulls[a] | 0) || round.order.indexOf(a) - round.order.indexOf(b);
  });
  const payouts = {};
  if (!winner) {
    ranking.forEach((uid, i) => { payouts[uid] = i < TUG.payout.length ? TUG.payout[i] : TUG.restPay; });
  } else {
    ranking.forEach((uid, i) => {
      payouts[uid] = round.team[uid] === winner
        ? (i < TUG.payout.length ? TUG.payout[i] : TUG.winPay)
        : TUG.losePay;
    });
    // winning-side ranks occupy the front of `ranking`, so 40/20/10 go to the hardest pullers on the winning side.
  }
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
  round.winner = winner;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.order.forEach((id, i) => { rnd.team[id] = sideOf(i); rnd.pulls[id] = rnd.pulls[id] | 0; });
}

export function maybeExpireTug(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + TUG.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= TUG.roundMs) settle(round, now);
  return round;
}

export function tugPublic(round, now = 0) {
  maybeExpireTug(round, now);
  const players = round.order.map((id) => ({
    id, name: round.players[id].name, team: round.team[id] || null, pulls: round.pulls[id] | 0,
  }));
  return {
    status: round.status, players, score: { ...round.score }, winner: round.winner,
    startedAt: round.startedAt, endedAt: round.endedAt,
    payouts: round.payouts ? { ...round.payouts } : null,
    rank: round.rank ? [...round.rank] : [],
    min: TUG.min, max: TUG.max, countdownMs: TUG.countdownMs, roundMs: TUG.roundMs,
    spots: TUG.spots.map((s) => ({ ...s })),
  };
}

export function tugView(round, uid, now = 0) {
  const v = tugPublic(round, now);
  v.you = uid;
  v.payout = (round.payouts && round.payouts[uid]) || 0;
  v.yourTeam = round.team[uid] || null;
  return v;
}

export function tugJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newTug() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('tug_live', '拔河已經開始了'), round: rnd };
  if (rnd.order.length >= TUG.max) return { ...fail('tug_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  if (rnd.order.length >= TUG.max) goLive(rnd, now);
  else if (rnd.order.length >= TUG.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearSpot(spot, x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - spot.x, py - spot.y) > TUG.reach) return fail('too_far', '再走近乾草樁一點');
  return null;
}

export function tugPull(round, uid, side, x, y, now) {
  if (!round) return fail('tug_none', '現在沒有拔河');
  maybeExpireTug(round, now);
  if (round.status === 'over') return { ...fail('tug_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去東邊草地報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_tug', '你不在這一輪'), round };
  const s = SPOT_BY[side];
  if (!s) return { ...fail('bad_message', '沒有這一岸'), round };
  const team = round.team[uid];
  if (team && team !== s.id) return { ...fail('wrong_side', '你是另一岸的人'), round };
  const bad = nearSpot(s, x, y);
  if (bad) return { ...bad, round };
  round.pulls[uid] = (round.pulls[uid] | 0) + 1;
  round.score[s.id] = (round.score[s.id] | 0) + 1;
  return { ok: true, round, pulled: s.id };
}

export function tugLeave(round, uid, now) {
  if (!round) return fail('tug_none', '現在沒有拔河');
  maybeExpireTug(round, now);
  if (round.status === 'over') return { ...fail('tug_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_tug', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('tug_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < TUG.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applyTugGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillTugBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = tugJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  if (rnd && rnd.status === 'live') {
    for (const bot of BOTS) {
      if (!rnd.players[bot.id]) continue;
      const side = rnd.team[bot.id];
      const s = SPOT_BY[side];
      if (!s) continue;
      for (let i = 0; i < 3; i++) {
        const r = tugPull(rnd, bot.id, s.id, s.x, s.y, now);
        if (r.ok) rnd = r.round;
      }
    }
  }
  return rnd;
}
