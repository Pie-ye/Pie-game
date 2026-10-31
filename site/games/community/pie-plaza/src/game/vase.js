// 廣場搶瓶：純函式。第三人倒數、最多八人；單數紅隊雙數藍隊，走近東岸花瓶按 E 搶給自己的隊。隊友占著不能搶。對標 team king-of-the-hill。
import { BOTS } from './party.js';

export const VASE_JOIN = { x: 440, y: 200, k: 'vase' };

export const VASE = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  payout: [40, 20, 10],
  restPay: 5,
  winPay: 40,
  losePay: 5,
};

const fail = (code, msg) => ({ ok: false, code, msg });
const sideOf = (i) => (i % 2 === 0 ? 'red' : 'blue');

export function newVase() {
  return {
    status: 'open', players: {}, order: [], team: {}, holder: null, heldAt: null,
    scores: {}, teamScore: { red: 0, blue: 0 }, startedAt: null, endedAt: null,
    payouts: null, paid: {}, rank: [], winner: null,
  };
}

function credit(round, now) {
  if (!round.holder || round.heldAt == null) return;
  const dt = Math.max(0, now - round.heldAt);
  round.scores[round.holder] = (round.scores[round.holder] | 0) + dt;
  const side = round.team[round.holder];
  if (side) round.teamScore[side] = (round.teamScore[side] | 0) + dt;
  round.heldAt = now;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
  rnd.holder = null;
  rnd.heldAt = null;
  rnd.teamScore = { red: 0, blue: 0 };
  rnd.order.forEach((id, i) => {
    rnd.team[id] = sideOf(i);
    rnd.scores[id] = rnd.scores[id] | 0;
  });
}

function settle(round, now) {
  credit(round, now);
  const red = round.teamScore.red | 0, blue = round.teamScore.blue | 0;
  let winner = null;
  if (red > blue) winner = 'red';
  else if (blue > red) winner = 'blue';
  const ranking = [...round.order].sort((a, b) => {
    if (winner) {
      const aw = round.team[a] === winner ? 0 : 1, bw = round.team[b] === winner ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }
    return (round.scores[b] | 0) - (round.scores[a] | 0) || round.order.indexOf(a) - round.order.indexOf(b);
  });
  const payouts = {};
  if (!winner) {
    ranking.forEach((uid, i) => { payouts[uid] = i < VASE.payout.length ? VASE.payout[i] : VASE.restPay; });
  } else {
    ranking.forEach((uid, i) => {
      payouts[uid] = round.team[uid] === winner
        ? (i < VASE.payout.length ? VASE.payout[i] : VASE.winPay)
        : VASE.losePay;
    });
  }
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
  round.winner = winner;
}

export function maybeExpireVase(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + VASE.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= VASE.roundMs) settle(round, now);
  return round;
}

export function vasePublic(round, now = 0) {
  maybeExpireVase(round, now);
  const rnd = round || newVase();
  const players = rnd.order.map((id) => ({
    id, name: rnd.players[id].name, team: rnd.team[id] || null,
    holder: rnd.holder === id, score: rnd.scores[id] | 0,
  }));
  return {
    status: rnd.status, players, holder: rnd.holder, heldAt: rnd.heldAt, scores: { ...rnd.scores },
    teamScore: { ...rnd.teamScore }, winner: rnd.winner,
    startedAt: rnd.startedAt, endedAt: rnd.endedAt,
    payouts: rnd.payouts ? { ...rnd.payouts } : null,
    rank: rnd.rank ? [...rnd.rank] : [],
    min: VASE.min, max: VASE.max, countdownMs: VASE.countdownMs, roundMs: VASE.roundMs,
    join: { ...VASE_JOIN },
  };
}

export function vaseView(round, uid, now = 0) {
  const v = vasePublic(round, now);
  v.you = uid;
  v.payout = (round && round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function vaseJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newVase() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('vase_live', '搶瓶已經開始了'), round: rnd };
  if (rnd.order.length >= VASE.max) return { ...fail('vase_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16) };
  rnd.order.push(uid);
  if (rnd.order.length >= VASE.max) goLive(rnd, now);
  else if (rnd.order.length >= VASE.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

function nearJoin(x, y) {
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message', '位置不對');
  if (Math.hypot(px - VASE_JOIN.x, py - VASE_JOIN.y) > VASE.reach) return fail('too_far', '再走近花瓶一點');
  return null;
}

export function vaseTake(round, uid, x, y, now) {
  if (!round) return fail('vase_none', '現在沒有搶瓶');
  maybeExpireVase(round, now);
  if (round.status === 'over') return { ...fail('vase_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去東岸花瓶報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_vase', '你不在這一輪'), round };
  if (round.holder === uid) return { ...fail('already_holding', '花瓶已經是你的'), round };
  if (round.holder && round.team[round.holder] === round.team[uid]) {
    return { ...fail('already_ours', '花瓶是隊友的，守住就好'), round };
  }
  const bad = nearJoin(x, y);
  if (bad) return { ...bad, round };
  credit(round, now);
  round.holder = uid;
  round.heldAt = now;
  return { ok: true, round, holder: uid };
}

export function vaseLeave(round, uid, now) {
  if (!round) return fail('vase_none', '現在沒有搶瓶');
  maybeExpireVase(round, now);
  if (round.status === 'over') return { ...fail('vase_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_vase', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('vase_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < VASE.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applyVaseGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillVaseBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = vaseJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  if (rnd && rnd.status === 'live') {
    const bot = BOTS.find((b) => rnd.players[b.id]);
    if (bot) {
      const r = vaseTake(rnd, bot.id, VASE_JOIN.x, VASE_JOIN.y, now);
      if (r.ok) rnd = r.round;
    }
  }
  return rnd;
}
