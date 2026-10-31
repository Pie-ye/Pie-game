// 廣場搶寶：純函式。訪客沙盒與伺服器（plaza_logic.py）用同一套數字與規則。
export const JOIN = { x: 200, y: 126, k: 'chest' };

export const PARTY = {
  min: 3,
  max: 8,
  reach: 20,
  countdownMs: 9000,
  roundMs: 45000,
  payout: [40, 20, 10],
  restPay: 5,
  spots: [
    { id: 'crateA', k: 'crate', x: 180, y: 106, name: '木箱' },
    { id: 'sackA', k: 'sack', x: 228, y: 106, name: '麻袋' },
    { id: 'sack2', k: 'sack2', x: 180, y: 150, name: '小麻袋' },
    { id: 'chestN', k: 'chestN', x: 228, y: 150, name: '小寶箱' },
    { id: 'basket', k: 'basket', x: 256, y: 128, name: '竹籃' },
    { id: 'crateB', k: 'crate', x: 176, y: 128, name: '木箱' },
  ],
};

export const BOTS = [
  { id: 'npc:kid', name: '小傑' },
  { id: 'npc:granny', name: '艾芙琳奶奶' },
];

const SPOT_BY = Object.fromEntries(PARTY.spots.map((s) => [s.id, s]));

const fail = (code, msg) => ({ ok: false, code, msg });

export function newParty() {
  return { status: 'open', players: {}, order: [], taken: {}, startedAt: null, endedAt: null, payouts: null, paid: {}, rank: [] };
}

export function partyPublic(round, now = 0) {
  maybeExpire(round, now);
  const spots = PARTY.spots.map((s) => ({ ...s, takenBy: round.taken[s.id] || null }));
  const players = round.order.map((id) => ({ id, name: round.players[id].name, score: round.players[id].score }));
  return {
    status: round.status,
    players,
    spots,
    taken: { ...round.taken },
    startedAt: round.startedAt,
    endedAt: round.endedAt,
    payouts: round.payouts ? { ...round.payouts } : null,
    rank: round.rank ? [...round.rank] : [],
    min: PARTY.min,
    max: PARTY.max,
    countdownMs: PARTY.countdownMs,
    roundMs: PARTY.roundMs,
  };
}

export function partyView(round, uid, now = 0) {
  const v = partyPublic(round, now);
  v.you = uid;
  v.payout = (round.payouts && round.payouts[uid]) || 0;
  return v;
}

export function maybeExpire(round, now) {
  if (!round) return round;
  if (round.status === 'countdown') {
    const liveAt = (round.startedAt || 0) + PARTY.countdownMs;
    if (now < liveAt) return round;
    round.status = 'live';
    round.startedAt = liveAt;
  }
  if (round.status !== 'live') return round;
  if (now - (round.startedAt || 0) >= PARTY.roundMs) settle(round, now);
  return round;
}

function settle(round, now) {
  const ranking = [...round.order].sort((a, b) => {
    const ds = round.players[b].score - round.players[a].score;
    return ds !== 0 ? ds : round.order.indexOf(a) - round.order.indexOf(b);
  });
  const payouts = {};
  ranking.forEach((uid, i) => { payouts[uid] = i < PARTY.payout.length ? PARTY.payout[i] : PARTY.restPay; });
  round.status = 'over';
  round.endedAt = now;
  round.payouts = payouts;
  round.rank = ranking;
}

function goLive(rnd, now) {
  rnd.status = 'live';
  rnd.startedAt = now;
}

export function partyJoin(round, uid, name, now) {
  if (typeof uid !== 'string' || !uid) return fail('bad_message', '無效的玩家');
  let rnd = (!round || round.status === 'over') ? newParty() : round;
  if (rnd.players[uid]) return { ...fail('already_in', '你已經在隊伍裡'), round: rnd };
  if (rnd.status === 'live') return { ...fail('party_live', '搶寶已經開始了'), round: rnd };
  if (rnd.order.length >= PARTY.max) return { ...fail('party_full', '人滿了'), round: rnd };
  rnd.players[uid] = { name: String(name || '訪客').slice(0, 16), score: 0 };
  rnd.order.push(uid);
  if (rnd.order.length >= PARTY.max) goLive(rnd, now);
  else if (rnd.order.length >= PARTY.min && rnd.status === 'open') {
    rnd.status = 'countdown';
    rnd.startedAt = now;
  }
  return { ok: true, round: rnd };
}

export function partyGrab(round, uid, spot, x, y, now) {
  if (!round) return fail('party_none', '現在沒有搶寶');
  maybeExpire(round, now);
  if (round.status === 'over') return { ...fail('party_over', '這一輪已經結束'), round };
  if (round.status !== 'live') return { ...fail('not_live', '還沒開始，先去寶箱報名'), round };
  if (!round.players[uid]) return { ...fail('not_in_party', '你不在這一輪'), round };
  const s = SPOT_BY[spot];
  if (!s) return { ...fail('bad_message', '沒有這個寶點'), round };
  if (round.taken[s.id]) return { ...fail('spot_taken', '已經被拿走了'), round };
  const px = Number(x), py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return { ...fail('bad_message', '位置不對'), round };
  if (Math.hypot(px - s.x, py - s.y) > PARTY.reach) return { ...fail('too_far', '再走近一點'), round };
  round.taken[s.id] = uid;
  round.players[uid].score += 1;
  if (Object.keys(round.taken).length >= PARTY.spots.length) settle(round, now);
  return { ok: true, round, grabbed: s.id };
}

export function partyLeave(round, uid, now) {
  if (!round) return fail('party_none', '現在沒有搶寶');
  maybeExpire(round, now);
  if (round.status === 'over') return { ...fail('party_over', '這一輪已經結束'), round };
  if (!round.players[uid]) return { ...fail('not_in_party', '你不在這一輪'), round };
  if (round.status === 'live') return { ...fail('party_live', '開始後就不能退出'), round };
  delete round.players[uid];
  round.order = round.order.filter((id) => id !== uid);
  if (round.status === 'countdown' && round.order.length < PARTY.min) {
    round.status = 'open';
    round.startedAt = null;
  }
  return { ok: true, round };
}

/** 把這一輪的獎金寫進 rec.gold；同一人只發一次。回傳這次發放的 G。 */
export function applyPartyGold(rec, uid, round) {
  if (!round || round.status !== 'over' || !round.payouts) return 0;
  if (round.paid[uid]) return 0;
  const n = round.payouts[uid] | 0;
  rec.gold = (rec.gold | 0) + n;
  round.paid[uid] = n;
  return n;
}

/** 訪客沙盒：把 NPC 補進空位，讓一個人也能打完一局。 */
export function fillBots(round, now) {
  let rnd = round;
  for (const bot of BOTS) {
    if (!rnd || rnd.status === 'live' || rnd.status === 'over') break;
    const r = partyJoin(rnd, bot.id, bot.name, now);
    if (r.ok) rnd = r.round;
  }
  if (rnd && rnd.status === 'countdown') goLive(rnd, now);
  return rnd;
}

/** 訪客沙盒：真人搶完一格後，機器人把剩下的拿走，讓回合能結束。 */
export function botsGrabRest(round, now) {
  let rnd = round;
  for (let n = 0; n < 12 && rnd && rnd.status === 'live'; n++) {
    let did = false;
    for (const bot of BOTS) {
      if (!rnd.players[bot.id]) continue;
      const free = PARTY.spots.find((s) => !rnd.taken[s.id]);
      if (!free) break;
      const r = partyGrab(rnd, bot.id, free.id, free.x, free.y, now);
      if (r.ok) { rnd = r.round; did = true; }
    }
    if (!did) break;
  }
  return rnd;
}
