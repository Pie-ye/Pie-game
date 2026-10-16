/**
 * 德州撲克規則引擎（純邏輯、不碰 DOM、不連網），由房主的瀏覽器執行。
 * 牌用兩字元：點數 2-9 T J Q K A ＋ 花色 s h d c，例如 "As"、"Td"。
 * 籌碼是遊戲內虛擬籌碼，不是平台金幣（多人遊戲依平台規定不能用金幣）。
 */
export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const HAND_NAMES = ['高牌', '一對', '兩對', '三條', '順子', '同花', '葫蘆', '四條', '同花順'];

/** 五張牌的分數：[牌型, 決勝點數…]，用 compareScores 比大小。 */
function score5(cards) {
  const ranks = cards.map((c) => RANKS.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let straightHigh = 0;
  const uniq = [...new Set(ranks)];
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5) straightHigh = 5; // A-2-3-4-5
  }
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, groups[0][0], groups[1][0], groups[2][0]];
  if (groups[0][1] === 2) return [1, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  return [0, ...ranks];
}

export function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 5~7 張牌取最好的五張。回 { score, name }。 */
export function bestHand(cards) {
  let best = null;
  const n = cards.length;
  const pick = [];
  function walk(start) {
    if (pick.length === 5) {
      const s = score5(pick);
      if (!best || compareScores(s, best) > 0) best = s;
      return;
    }
    for (let i = start; i < n; i += 1) {
      pick.push(cards[i]);
      walk(i + 1);
      pick.pop();
    }
  }
  walk(0);
  const name = best[0] === 8 && best[1] === 14 ? '皇家同花順' : HAND_NAMES[best[0]];
  return { score: best, name };
}

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class Holdem {
  constructor({ smallBlind = 10, bigBlind = 20, startChips = 1000, maxSeats = 6, rng = Math.random } = {}) {
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.startChips = startChips;
    this.maxSeats = maxSeats;
    this.rng = rng;
    this.players = []; // { id, name, chips, hole, bet, total, folded, allIn, acted, inHand }
    this.dealerId = null;
    this.handNo = 0;
    this.phase = 'waiting'; // waiting | preflop | flop | turn | river | showdown
    this.board = [];
    this.deck = [];
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.actorId = null;
    this.result = null; // 上一手結果
    this.log = [];
  }

  // ---------- 座位 ----------
  addPlayer(id, name, chips = this.startChips) {
    if (this.players.some((p) => p.id === id)) return false;
    if (this.players.length >= this.maxSeats) return false;
    this.players.push({ id, name, chips, hole: [], bet: 0, total: 0, folded: false, allIn: false, acted: false, inHand: false });
    return true;
  }

  removePlayer(id) {
    const p = this.player(id);
    if (!p) return;
    if (this.inProgress() && p.inHand && !p.folded) {
      if (this.actorId === id) this.act(id, 'fold');
      else {
        p.folded = true;
        this.afterAction();
      }
    }
    // 已投入的籌碼留在底池（離桌＝棄牌）
    this.players = this.players.filter((x) => x.id !== id);
  }

  player(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  inProgress() {
    return STREETS.includes(this.phase);
  }

  fundedCount() {
    return this.players.filter((p) => p.chips > 0).length;
  }

  canStart() {
    return !this.inProgress() && this.fundedCount() >= 2;
  }

  // ---------- 開局 ----------
  /** 沒籌碼的人自動補到起始籌碼（虛擬籌碼）。 */
  rebuy() {
    for (const p of this.players) if (p.chips <= 0) p.chips = this.startChips;
  }

  startHand() {
    if (this.inProgress()) return false;
    this.rebuy();
    if (this.players.length < 2) return false;
    this.handNo += 1;
    this.result = null;
    this.board = [];
    this.deck = shuffle(newDeck(), this.rng);
    for (const p of this.players) {
      p.hole = [];
      p.bet = 0;
      p.total = 0;
      p.folded = false;
      p.allIn = false;
      p.acted = false;
      p.inHand = p.chips > 0;
    }
    const seated = this.players.filter((p) => p.inHand);
    // 莊家位置：上一手莊家的下一位
    let dealerIdx = this.players.findIndex((p) => p.id === this.dealerId);
    do {
      dealerIdx = (dealerIdx + 1) % this.players.length;
    } while (!this.players[dealerIdx].inHand);
    this.dealerId = this.players[dealerIdx].id;
    const headsUp = seated.length === 2;
    const sbP = headsUp ? this.players[dealerIdx] : this.nextInHand(this.dealerId);
    const bbP = this.nextInHand(sbP.id);
    this.post(sbP, this.smallBlind);
    this.post(bbP, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    for (let i = 0; i < 2; i += 1) for (const p of seated) p.hole.push(this.deck.pop());
    this.phase = 'preflop';
    this.sbId = sbP.id;
    this.bbId = bbP.id;
    this.actorId = (headsUp ? sbP : this.nextInHand(bbP.id)).id;
    this.fixActor();
    return true;
  }

  post(p, amount) {
    const pay = Math.min(amount, p.chips);
    p.chips -= pay;
    p.bet += pay;
    p.total += pay;
    if (p.chips === 0) p.allIn = true;
  }

  /** dealer 之後下一位仍在這手牌的人。 */
  nextInHand(id, pred = (p) => p.inHand) {
    const idx = this.players.findIndex((p) => p.id === id);
    for (let i = 1; i <= this.players.length; i += 1) {
      const p = this.players[(idx + i) % this.players.length];
      if (pred(p)) return p;
    }
    return null;
  }

  canAct(p) {
    return p.inHand && !p.folded && !p.allIn;
  }

  /** 若目前行動者其實不能行動（全下），往後找；找不到就推進牌局。 */
  fixActor() {
    const a = this.player(this.actorId);
    if (a && this.canAct(a) && !(a.acted && a.bet === this.currentBet)) return;
    this.afterAction(true);
  }

  // ---------- 行動 ----------
  toCall(p) {
    return Math.max(0, this.currentBet - p.bet);
  }

  legalActions(id) {
    const p = this.player(id);
    if (!p || this.actorId !== id || !this.inProgress()) return null;
    const toCall = this.toCall(p);
    const maxTo = p.bet + p.chips;
    const minTo = Math.min(maxTo, this.currentBet + this.minRaise);
    return {
      fold: true,
      check: toCall === 0,
      call: toCall > 0 ? Math.min(toCall, p.chips) : 0,
      raise: maxTo > this.currentBet,
      minTo,
      maxTo,
    };
  }

  /** action: fold | check | call | raise（amount＝加注到的總額，含本輪已下的）。 */
  act(id, action, amount) {
    const p = this.player(id);
    if (!p || !this.inProgress()) return { ok: false, error: 'no_hand' };
    if (this.actorId !== id) return { ok: false, error: 'not_your_turn' };
    const legal = this.legalActions(id);
    if (action === 'fold') {
      p.folded = true;
    } else if (action === 'check') {
      if (!legal.check) return { ok: false, error: 'cannot_check' };
      p.acted = true;
    } else if (action === 'call') {
      if (legal.check) return { ok: false, error: 'nothing_to_call' };
      const pay = legal.call;
      p.chips -= pay;
      p.bet += pay;
      p.total += pay;
      if (p.chips === 0) p.allIn = true;
      p.acted = true;
    } else if (action === 'raise') {
      const to = Math.floor(Number(amount));
      if (!Number.isFinite(to) || !legal.raise) return { ok: false, error: 'cannot_raise' };
      if (to > legal.maxTo || to <= this.currentBet) return { ok: false, error: 'bad_amount' };
      if (to < legal.minTo) return { ok: false, error: 'below_min_raise' };
      const pay = to - p.bet;
      const raiseSize = to - this.currentBet;
      p.chips -= pay;
      p.bet = to;
      p.total += pay;
      if (p.chips === 0) p.allIn = true;
      if (raiseSize >= this.minRaise) this.minRaise = raiseSize;
      this.currentBet = to;
      for (const o of this.players) if (o !== p) o.acted = false;
      p.acted = true;
    } else {
      return { ok: false, error: 'bad_action' };
    }
    this.afterAction();
    return { ok: true };
  }

  contenders() {
    return this.players.filter((p) => p.inHand && !p.folded);
  }

  roundDone() {
    return this.contenders().every((p) => p.allIn || (p.acted && p.bet === this.currentBet));
  }

  afterAction(force = false) {
    if (!this.inProgress()) return;
    const alive = this.contenders();
    if (alive.length === 1) {
      this.finish([alive[0]], true);
      return;
    }
    if (!force || this.roundDone()) {
      if (this.roundDone()) {
        this.nextStreet();
        return;
      }
    }
    // 下一位需要行動的人
    const cur = this.player(this.actorId) || this.players.find((p) => p.id === this.dealerId);
    const next = this.nextInHand(cur.id, (p) => this.canAct(p) && !(p.acted && p.bet === this.currentBet));
    this.actorId = next ? next.id : null;
    if (!next) this.nextStreet();
  }

  nextStreet() {
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    const idx = STREETS.indexOf(this.phase);
    if (idx === STREETS.length - 1) {
      this.showdown();
      return;
    }
    this.phase = STREETS[idx + 1];
    this.deck.pop(); // 燒牌
    const n = this.phase === 'flop' ? 3 : 1;
    for (let i = 0; i < n; i += 1) this.board.push(this.deck.pop());
    const canBet = this.contenders().filter((p) => !p.allIn);
    if (canBet.length < 2) {
      // 剩不到兩人能下注：直接發完公共牌
      this.nextStreet();
      return;
    }
    const first = this.nextInHand(this.dealerId, (p) => this.canAct(p));
    this.actorId = first.id;
  }

  // ---------- 結算 ----------
  showdown() {
    this.phase = 'showdown';
    const alive = this.contenders();
    const hands = new Map(alive.map((p) => [p.id, bestHand([...p.hole, ...this.board])]));
    this.finish(alive, false, hands);
  }

  /** 邊池：依各人累計投入分層，每層只有投入夠多且沒棄牌的人能分。 */
  buildPots() {
    const inPot = this.players.filter((p) => p.total > 0);
    const levels = [...new Set(inPot.filter((p) => !p.folded).map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of inPot) amount += Math.max(0, Math.min(p.total, level) - prev);
      const eligible = inPot.filter((p) => !p.folded && p.total >= level).map((p) => p.id);
      if (amount > 0) pots.push({ amount, eligible });
      prev = level;
    }
    // 棄牌者投入超過任何存活者的部分（不會發生，但保險起見併入最後一層）
    const leftover = inPot.reduce((s, p) => s + p.total, 0) - pots.reduce((s, x) => s + x.amount, 0);
    if (leftover > 0 && pots.length) pots[pots.length - 1].amount += leftover;
    return pots;
  }

  finish(winners, uncontested, hands = new Map()) {
    const pots = this.buildPots();
    const won = new Map();
    const order = this.players.map((p) => p.id);
    const dealerIdx = order.indexOf(this.dealerId);
    for (const pot of pots) {
      const eligible = pot.eligible.map((id) => this.player(id)).filter(Boolean);
      let best = [];
      if (uncontested || eligible.length === 1) best = eligible;
      else {
        let top = null;
        for (const p of eligible) {
          const h = hands.get(p.id);
          const c = top ? compareScores(h.score, top) : 1;
          if (c > 0) { top = h.score; best = [p]; } else if (c === 0) best.push(p);
        }
      }
      const share = Math.floor(pot.amount / best.length);
      let rest = pot.amount - share * best.length;
      // 零頭給最靠近莊家左手邊的贏家
      best.sort((a, b) => ((order.indexOf(a.id) - dealerIdx + order.length) % order.length) - ((order.indexOf(b.id) - dealerIdx + order.length) % order.length));
      for (const p of best) {
        const gain = share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest -= 1;
        p.chips += gain;
        won.set(p.id, (won.get(p.id) || 0) + gain);
      }
    }
    this.result = {
      handNo: this.handNo,
      uncontested,
      board: this.board.slice(),
      pots: pots.map((p) => p.amount),
      players: this.players.filter((p) => p.inHand).map((p) => ({
        id: p.id,
        name: p.name,
        folded: p.folded,
        net: (won.get(p.id) || 0) - p.total,
        won: won.get(p.id) || 0,
        cards: !uncontested && !p.folded ? p.hole.slice() : null,
        handName: hands.get(p.id) ? hands.get(p.id).name : null,
      })),
    };
    this.phase = 'waiting';
    this.actorId = null;
    for (const p of this.players) {
      p.bet = 0;
      p.total = 0;
      p.acted = false;
    }
  }

  // ---------- 對外視圖 ----------
  pot() {
    return this.players.reduce((s, p) => s + p.total, 0);
  }

  /** 全桌看得到的狀態（不含任何人的底牌）。 */
  publicView() {
    return {
      handNo: this.handNo,
      phase: this.phase,
      board: this.board.slice(),
      pot: this.pot(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerId: this.dealerId,
      sbId: this.sbId || null,
      bbId: this.bbId || null,
      actorId: this.actorId,
      blinds: [this.smallBlind, this.bigBlind],
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        total: p.total,
        folded: p.folded,
        allIn: p.allIn,
        inHand: p.inHand && this.inProgress(),
      })),
      result: this.result,
    };
  }

  /** 房主換人時，由公開狀態重建（進行中的那手作廢，投入的籌碼退回）。 */
  static restore(view, opts = {}) {
    const t = new Holdem(opts);
    t.handNo = view.handNo || 0;
    t.dealerId = view.dealerId || null;
    const inProgress = STREETS.includes(view.phase);
    for (const p of view.players || []) {
      t.addPlayer(p.id, p.name, p.chips + (inProgress ? p.total : 0));
    }
    t.result = view.result || null;
    return t;
  }
}
