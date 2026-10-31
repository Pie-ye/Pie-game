// 廣場紅綠燈：純函式。第三人倒數、最多八人；綠燈走近下一樁按 E，紅燈按 E 出局。
import { BOTS } from './party.js';

export const LIGHT_JOIN = { x: 64, y: 40, k: 'railing' };

export const LIGHT = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  greenMs: 2500,
  redMs: 1800,
  payout: [40, 20, 10],
  restPay: 5,
  spots: [
    { id: 'a', k: 'stumpSmall', x: 128, y: 40, name: '第一樁' },
    { id: 'b', k: 'stumpSmall', x: 192, y: 40, name: '第二樁' },
    { id: 'c', k: 'stumpSmall', x: 256, y: 40, name: '第三樁' },
    { id: 'fin', k: 'railing', x: 320, y: 40, name: '終點' },
  ],
};

const SPOT_BY = Object.fromEntries(LIGHT.spots.map((s) => [s.id, s]));
const fail = (code, msg) => ({ ok: false, code, msg });

export function newLight() {
  return { status: 'open', players: {}, order: [], out: {}, done: {}, finishAt: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

export function lightOf(round, now) {
  if (!round || round.status !== 'live') return 'green';
  const t = Math.max(0, now - (round.startedAt || 0));
  const cycle = LIGHT.greenMs + LIGHT.redMs;
  return (t % cycle) < LIGHT.greenMs ? 'green' : 'red';
}

/** 世界視覺用：沒開場不畫燈；開場後跟 lightOf 同一拍。 */
export function lightFromPublic(pub, now) {
  if (!pub || pub.status !== 'live') return null;
  const t = Math.max(0, now - (pub.startedAt || 0));
  const g = pub.greenMs || LIGHT.greenMs;
  const r = pub.redMs || LIGHT.redMs;
  return (t % (g + r)) < g ? 'green' : 'red';
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
}

function settle(round, now) {
  const ranking = [...round.order].sort((a, b) => {
    const da = round.done[a] ? 0 : round.out[a] ? 2 : 1;
    const db = round.done[b] ? 0 : round.out[b] ? 2 : 1;
    if (da !== db) return da - db;
    if (round.done[a] && round.done[b]) return (round.finishAt[a] || 0) - (round.finishAt[b] || 0);
    const ds = (round.players[b].score | 0) - (round.players[a].score | 0);
    if (ds !== 0) return ds;
    return round.order.indexOf(a) - round.order.indexOf(b);
  });
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < LIGHT.payout.length ? LIGHT.payout[i] : LIGHT.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function remaining(round) {
  return round.order.filter((id) => !round.out[id] && !round.done[id]);
}

export function maybeExpireLight(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + LIGHT.countdownMs;
    if (now < liveAt) return round;
    goLive(round, liveAt);
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= LIGHT.roundMs || remaining(round).length === 0) settle(round, now);
  return round;
}

export function lightPublic(round, now = 0) {
  maybeExpireLight(round, now);
  const rnd = round || newLight();
  const players = rnd.order.map((id) => ({
    id, name: rnd.players[id].name, score: rnd.players[id].score | 0,
    out: !!rnd.out[id], done: !!rnd.done[id],
  }));
  return {
    status: rnd.status,
    players,
    spots: LIGHT.spots.map((s) => ({ ...s })),
    light: lightOf(rnd, now),
    startedAt: rnd.startedAt,
    endedAt: rnd.endedAt,
    payouts: rnd.payouts ? { ...rnd.payouts } : null,
    rank: rnd.rank ? [...rnd.rank] : [],
    min: LIGHT.min,
    max: LIGHT.max,
    countdownMs: LIGHT.countdownMs,
    roundMs: LIGHT.roundMs,
    greenMs: LIGHT.greenMs,
    redMs: LIGHT.redMs,
  };
}

export function lightView(round, uid, now = 0) {
  const v = lightPublic(round, now);
  v.you = uid;
  v.payout = (round && round.payouts && round.payouts[uid]) || 0;
  const me = (v.players || []).find((p) => p.id === uid);
  v.yourScore = me ? me.score : 0;
  v.yourOut = !!(me && me.out);
  v.yourDone = !!(me && me.done);
  return v;
}

export function lightJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newLight() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('light_live', '紅綠燈已經開始了'), round: rnd };
  if (rnd.order.length >= LIGHT.max) return { ...fail('light_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16), score: 0 };
  rnd.order.push(uid);
  if (rnd.order.length >= LIGHT.max) goLive(rnd, now);
  else if (rnd.order.length >= LIGHT.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

export function lightDash(round, uid, spot, x, y, now) {
  if (!round) return fail('light_none', '現在沒有紅綠燈');
  maybeExpireLight(round, now);
  if (round.status === 'over') return { ...fail('light_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去北邊欄杆報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_light', '你不在這一輪'), round };
  if (round.out[uid]) return { ...fail('already_out', '紅燈時動了，這輪出局'), round };
  if (round.done[uid]) return { ...fail('already_done', '你已經到終點了'), round };
  const s = SPOT_BY[spot];
  if (!s) return { ...fail('bad_message', '沒有這個樁'), round };
  const need = LIGHT.spots[round.players[uid].score | 0];
  if (!need || need.id !== s.id) return { ...fail('wrong_spot', '要依序踩下一樁'), round };
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { ...fail('bad_message', '位置不對'), round };
  if (Math.hypot(px - s.x, py - s.y) > LIGHT.reach) return { ...fail('too_far', '再走近一點'), round };
  if (lightOf(round, now) === 'red') {
    round.out[uid] = true;
    if (remaining(round).length === 0) settle(round, now);
    return { ok: true, round, out: true, light: 'red' };
  }
  round.players[uid].score = (round.players[uid].score | 0) + 1;
  if (round.players[uid].score >= LIGHT.spots.length) {
    round.done[uid] = true;
    round.finishAt[uid] = now;
  }
  if (remaining(round).length === 0) settle(round, now);
  return { ok: true, round, stepped: s.id, done: !!round.done[uid] };
}

export function lightLeave(round, uid, now) {
  if (!round) return fail('light_none', '現在沒有紅綠燈');
  maybeExpireLight(round, now);
  if (round.status === 'over') return { ...fail('light_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_light', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('light_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < LIGHT.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

export function applyLightGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

export function fillLightBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = lightJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  return rnd;
}

/** 訪客沙盒：綠燈時機器人踩下一樁，讓回合能結束。 */
export function botsDashOnGreen(round, now) {
  let rnd = round;
  maybeExpireLight(rnd, now);
  if (!rnd || rnd.status !== 'live' || lightOf(rnd, now) !== 'green') return rnd;
  for (const bot of BOTS) {
    if (!rnd.players[bot.id] || rnd.out[bot.id] || rnd.done[bot.id]) continue;
    const s = LIGHT.spots[rnd.players[bot.id].score | 0];
    if (!s) continue;
    const r = lightDash(rnd, bot.id, s.id, s.x, s.y, now);
    if (r.ok) rnd = r.round;
    if (!rnd || rnd.status !== 'live') break;
  }
  return rnd;
}
