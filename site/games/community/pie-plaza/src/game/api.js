// 遊戲操作的統一入口：登入時送到伺服器（權威），未登入時用本機沙盒（同一套規則、同樣的回覆格式，不存檔）。
import * as F from '../farm/state.js';
import { defaultDecor, sanitizeDecor } from '../house/catalog.js';
import { sanitizeLook } from '../avatar/look.js';
import { FISH, FISH_PRICES, rollFish, fishSize } from '../fish/fishing.js';
import { taipei } from '../events/schedule.js';
import { guestQuotes } from './exchange.js';
import { newParty, partyJoin, partyGrab, partyLeave, partyView, applyPartyGold, fillBots, botsGrabRest, maybeExpire } from './party.js';
import { fishingSlot, contestCatch, contestView, applyContestGold, maybeExpireContest } from './contest.js';
import { newSeek, seekJoin, seekHide, seekCheck, seekLeave, seekView, applySeekGold, fillSeekBots, maybeExpireSeek } from './seek.js';
import { newHot, hotJoin, hotTake, hotLeave, hotView, applyHotGold, fillHotBots, maybeExpireHot } from './hot.js';
import { newTug, tugJoin, tugPull, tugLeave, tugView, applyTugGold, fillTugBots, maybeExpireTug } from './tug.js';
import { newHaul, haulJoin, haulTake, haulDrop, haulLeave, haulView, applyHaulGold, fillHaulBots, maybeExpireHaul } from './haul.js';
import { newLight, lightJoin, lightDash, lightLeave, lightView, applyLightGold, fillLightBots, botsDashOnGreen, maybeExpireLight } from './light.js';
import { newHill, hillJoin, hillTake, hillLeave, hillView, applyHillGold, fillHillBots, maybeExpireHill } from './hill.js';
import { newSmash, smashJoin, smashHit, smashLeave, smashView, applySmashGold, fillSmashBots, maybeExpireSmash } from './smash.js';
import { newVase, vaseJoin, vaseTake, vaseLeave, vaseView, applyVaseGold, fillVaseBots, maybeExpireVase } from './vase.js';

/** 伺服器版：net.game(op, data)。 */
export function createServerApi(net) {
  return { server: true, call: (op, data = {}) => net.game(op, data) };
}

const err = (code, msg = '') => Object.assign(new Error(msg || code), { code, msg });

/** 本機沙盒：給沒登入的訪客試玩；重新整理就消失。 */
export function createLocalApi(name = '訪客') {
  const farm = F.newFarm('guest');
  const rec = {
    name, farm: { debris: farm.debris, tilled: farm.tilled, crops: farm.crops }, inv: farm.inv, seeds: farm.seeds, seedSel: farm.seedSel, gold: farm.gold,
    shares: {}, decor: defaultDecor(), look: null, social: { open: true, friends: [], coop: [], likes: 0, liked: {} },
  };
  let cast = null;
  let round = newParty();
  let board = null;
  let hide = newSeek();
  let potato = newHot();
  let rope = newTug();
  let crate = newHaul();
  let lamps = newLight();
  let mat = newHill();
  let jar = newSmash();
  let flask = newVase();
  const uid = 'guest';
  const mine = () => ({ inv: rec.inv, gold: rec.gold, seeds: rec.seeds, seedSel: rec.seedSel });
  const state = () => ({ ...rec.farm, inv: rec.inv, seeds: rec.seeds, get seedSel() { return rec.seedSel; }, set seedSel(v) { rec.seedSel = v; }, gold: rec.gold });
  const ops = {
    load: () => ({ me: { ...rec, farm: F.packFarm({ ...rec.farm, inv: {}, seeds: {}, gold: 0 }), shares: rec.shares, now: Date.now() } }),
    view: () => ({ role: 'owner', home: { owner: 'guest', name: rec.name, look: rec.look, decor: rec.decor, farm: F.packFarm({ ...rec.farm, inv: {}, seeds: {}, gold: 0 }), likes: 0, coop: false, online: true, now: Date.now() } }),
    leave: () => ({}),
    tool: ({ tool, x, y }) => {
      const s = state(); const now = Date.now();
      F.grow(s, now);
      const result = F.useTool(s, tool, x, y, now);
      rec.gold = s.gold;
      const k = `${x},${y}`;
      return { result, tile: { [k]: { d: rec.farm.debris[k] || null, t: rec.farm.tilled[k] || null, c: rec.farm.crops[k] || null } }, ...mine() };
    },
    seed: ({ crop }) => { if (!rec.seeds[crop]) throw err('no_seed'); rec.seedSel = crop; return mine(); },
    buy: ({ crop, n, market }) => {
      const s = { ...mine(), seeds: rec.seeds };
      if (market) { const c = F.CROPS[crop]; const price = Math.ceil(c.seed * 0.8) * n; if (s.gold < price) throw err('buy_failed', '金幣不夠'); s.gold -= price; rec.seeds[crop] = (rec.seeds[crop] || 0) + n; rec.gold = s.gold; return { msg: `買了 ${n} 包${c.name}種子`, ...mine() }; }
      const r = F.buySeed(s, crop, n); if (!r.ok) throw err('buy_failed', r.msg); rec.gold = s.gold; rec.seedSel = s.seedSel; return { msg: r.msg, ...mine() }; },
    ship: () => { const s = { inv: rec.inv, gold: rec.gold }; const r = F.shipAll(s, { ...F.CROP_PRICES, ...FISH_PRICES }); rec.gold = s.gold; return { total: r.total, sold: r.sold, ...mine() }; },
    cast: ({ where, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      const on = where === 'sea' && !!fishingSlot(now);
      const f = rollFish(where, taipei(now).h, on);
      const bite = 1500 + Math.random() * 4500;
      cast = { id: Date.now(), fish: f, bite: now + bite, contest: on };
      return { cast: cast.id, bite, diff: f.diff, contest: on };
    },
    land: ({ cast: id, ok, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      const c = cast; cast = null;
      if (!c || c.id !== id) throw err('no_cast', '沒有在釣魚');
      maybeExpireContest(board, now);
      let payout = applyContestGold(rec, uid, board);
      if (!ok) return { fish: c.fish.id, caught: false, payout, ...mine() };
      const size = fishSize(c.fish);
      if (!c.fish.junk) rec.inv[`fish_${c.fish.id}`] = (rec.inv[`fish_${c.fish.id}`] || 0) + 1;
      if (c.contest && !c.fish.junk) {
        const r = contestCatch(board, uid, rec.name, c.fish.id, size, now);
        if (r.round) board = r.round;
      }
      payout += applyContestGold(rec, uid, board);
      return { fish: c.fish.id, caught: true, size, contest: !!c.contest, board: contestView(board, uid, now), payout, ...mine() };
    },
    look: ({ look }) => { rec.look = sanitizeLook(look); return {}; },
    decor: ({ decor }) => { rec.decor = sanitizeDecor({ v: 1, ...decor }); return { decor: rec.decor }; },
    social: (p) => { if ('open' in p) rec.social.open = !!p.open; return { social: rec.social }; },
    wish: () => {
      if (rec.gold < 10) throw err('no_gold', '許願要投 10 G');
      rec.gold -= 10;
      const r = Math.random();
      let reward = { kind: 'none' };
      if (r < 0.2) { rec.gold += 50; reward = { kind: 'gold', n: 50 }; } else if (r < 0.5) { rec.seeds.wheat = (rec.seeds.wheat || 0) + 3; reward = { kind: 'seed', item: 'wheat', n: 3 }; }
      return { reward, ...mine() };
    },
    feed: ({ item }) => {
      if (!(rec.inv[item] > 0) || !item.startsWith('fish_')) throw err('no_item', '背包裡沒有魚');
      rec.inv[item] -= 1; if (!rec.inv[item]) delete rec.inv[item];
      rec.seeds.carrot = (rec.seeds.carrot || 0) + 2;
      return { reward: { kind: 'seed', item: 'carrot', n: 2 }, ...mine() };
    },
    /** 只有試玩沙盒有：測試用，塞東西進背包（伺服器沒有這個指令）。 */
    sandboxGive: ({ item, n }) => { rec.inv[item] = (rec.inv[item] || 0) + n; return mine(); },
    directory: () => ({ items: [] }),
    market: () => ({ items: [] }),
    quote: () => ({ ...guestQuotes(Date.now(), rec.shares), gold: rec.gold, shares: rec.shares }),
    trade: () => { throw err('login_required', '登入後才能買賣指數'); },
    party: ({ act, spot, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpire(round, now);
      let payout = applyPartyGold(rec, uid, round);
      let r;
      if (act === 'join') {
        r = partyJoin(round, uid, rec.name, now);
        if (r.round) round = r.round;
        if (r.ok) round = fillBots(round, now);
        else throw err(r.code, r.msg);
      } else if (act === 'grab') {
        r = partyGrab(round, uid, spot, x, y, now);
        if (r.round) round = r.round;
        if (!r.ok) throw err(r.code, r.msg);
        round = botsGrabRest(round, now);
      } else if (act === 'leave') {
        r = partyLeave(round, uid, now);
        if (r.round) round = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的搶寶動作');
      payout += applyPartyGold(rec, uid, round);
      return { party: partyView(round, uid, now), payout, ...mine() };
    },
    contest: ({ now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireContest(board, now);
      const payout = applyContestGold(rec, uid, board);
      return { contest: contestView(board, uid, now), payout, ...mine() };
    },
    seek: ({ act, spot, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireSeek(hide, now);
      let payout = applySeekGold(rec, uid, hide);
      let r;
      if (act === 'join') {
        r = seekJoin(hide, uid, rec.name, now);
        if (r.round) hide = r.round;
        if (r.ok) hide = fillSeekBots(hide, now);
        else throw err(r.code, r.msg);
      } else if (act === 'hide') {
        r = seekHide(hide, uid, spot, x, y, now);
        if (r.round) hide = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'check') {
        r = seekCheck(hide, uid, spot, x, y, now);
        if (r.round) hide = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = seekLeave(hide, uid, now);
        if (r.round) hide = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的捉迷藏動作');
      payout += applySeekGold(rec, uid, hide);
      return { seek: seekView(hide, uid, now), payout, ...mine() };
    },
    hot: ({ act, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireHot(potato, now);
      let payout = applyHotGold(rec, uid, potato);
      let r;
      if (act === 'join') {
        r = hotJoin(potato, uid, rec.name, now);
        if (r.round) potato = r.round;
        if (r.ok) potato = fillHotBots(potato, now);
        else throw err(r.code, r.msg);
      } else if (act === 'take') {
        r = hotTake(potato, uid, x, y, now);
        if (r.round) potato = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = hotLeave(potato, uid, now);
        if (r.round) potato = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的傳南瓜動作');
      payout += applyHotGold(rec, uid, potato);
      return { hot: hotView(potato, uid, now), payout, ...mine() };
    },
    tug: ({ act, side, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireTug(rope, now);
      let payout = applyTugGold(rec, uid, rope);
      let r;
      if (act === 'join') {
        r = tugJoin(rope, uid, rec.name, now);
        if (r.round) rope = r.round;
        if (r.ok) rope = fillTugBots(rope, now);
        else throw err(r.code, r.msg);
      } else if (act === 'pull') {
        r = tugPull(rope, uid, side, x, y, now);
        if (r.round) rope = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = tugLeave(rope, uid, now);
        if (r.round) rope = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的拔河動作');
      payout += applyTugGold(rec, uid, rope);
      return { tug: tugView(rope, uid, now), payout, ...mine() };
    },
    haul: ({ act, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireHaul(crate, now);
      let payout = applyHaulGold(rec, uid, crate);
      let r;
      if (act === 'join') {
        r = haulJoin(crate, uid, rec.name, now);
        if (r.round) crate = r.round;
        if (r.ok) crate = fillHaulBots(crate, now);
        else throw err(r.code, r.msg);
      } else if (act === 'take') {
        r = haulTake(crate, uid, x, y, now);
        if (r.round) crate = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'drop') {
        r = haulDrop(crate, uid, x, y, now);
        if (r.round) crate = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = haulLeave(crate, uid, now);
        if (r.round) crate = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的搬寶動作');
      payout += applyHaulGold(rec, uid, crate);
      return { haul: haulView(crate, uid, now), payout, ...mine() };
    },
    light: ({ act, spot, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireLight(lamps, now);
      let payout = applyLightGold(rec, uid, lamps);
      let r;
      if (act === 'join') {
        r = lightJoin(lamps, uid, rec.name, now);
        if (r.round) lamps = r.round;
        if (r.ok) lamps = fillLightBots(lamps, now);
        else throw err(r.code, r.msg);
      } else if (act === 'dash') {
        r = lightDash(lamps, uid, spot, x, y, now);
        if (r.round) lamps = r.round;
        if (!r.ok) throw err(r.code, r.msg);
        lamps = botsDashOnGreen(lamps, now);
      } else if (act === 'leave') {
        r = lightLeave(lamps, uid, now);
        if (r.round) lamps = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的紅綠燈動作');
      payout += applyLightGold(rec, uid, lamps);
      return { light: lightView(lamps, uid, now), payout, ...mine() };
    },
    hill: ({ act, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireHill(mat, now);
      let payout = applyHillGold(rec, uid, mat);
      let r;
      if (act === 'join') {
        r = hillJoin(mat, uid, rec.name, now);
        if (r.round) mat = r.round;
        if (r.ok) mat = fillHillBots(mat, now);
        else throw err(r.code, r.msg);
      } else if (act === 'take') {
        r = hillTake(mat, uid, x, y, now);
        if (r.round) mat = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = hillLeave(mat, uid, now);
        if (r.round) mat = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的占席動作');
      payout += applyHillGold(rec, uid, mat);
      return { hill: hillView(mat, uid, now), payout, ...mine() };
    },
    smash: ({ act, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireSmash(jar, now);
      let payout = applySmashGold(rec, uid, jar);
      let r;
      if (act === 'join') {
        r = smashJoin(jar, uid, rec.name, now);
        if (r.round) jar = r.round;
        if (r.ok) jar = fillSmashBots(jar, now);
        else throw err(r.code, r.msg);
      } else if (act === 'hit') {
        r = smashHit(jar, uid, x, y, now);
        if (r.round) jar = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = smashLeave(jar, uid, now);
        if (r.round) jar = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的砸罐動作');
      payout += applySmashGold(rec, uid, jar);
      return { smash: smashView(jar, uid, now), payout, ...mine() };
    },
    vase: ({ act, x, y, now: at } = {}) => {
      const now = Number.isFinite(at) ? at : Date.now();
      maybeExpireVase(flask, now);
      let payout = applyVaseGold(rec, uid, flask);
      let r;
      if (act === 'join') {
        r = vaseJoin(flask, uid, rec.name, now);
        if (r.round) flask = r.round;
        if (r.ok) flask = fillVaseBots(flask, now);
        else throw err(r.code, r.msg);
      } else if (act === 'take') {
        r = vaseTake(flask, uid, x, y, now);
        if (r.round) flask = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act === 'leave') {
        r = vaseLeave(flask, uid, now);
        if (r.round) flask = r.round;
        if (!r.ok) throw err(r.code, r.msg);
      } else if (act !== 'view') throw err('bad_message', '無效的搶瓶動作');
      payout += applyVaseGold(rec, uid, flask);
      return { vase: vaseView(flask, uid, now), payout, ...mine() };
    },
  };
  const offline = () => { throw err('login_required', '登入後才能使用'); };
  return {
    server: false,
    call: async (op, data = {}) => (ops[op] || offline)(data),
    /** 測試或除錯用 */
    get fishList() { return FISH; },
  };
}
