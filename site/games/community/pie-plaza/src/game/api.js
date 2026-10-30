// 遊戲操作的統一入口：登入時送到伺服器（權威），未登入時用本機沙盒（同一套規則、同樣的回覆格式，不存檔）。
import * as F from '../farm/state.js';
import { defaultDecor, sanitizeDecor } from '../house/catalog.js';
import { sanitizeLook } from '../avatar/look.js';
import { FISH, FISH_PRICES, rollFish, fishSize } from '../fish/fishing.js';
import { taipei } from '../events/schedule.js';
import { guestQuotes } from './exchange.js';

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
    cast: ({ where }) => {
      const f = rollFish(where, taipei().h, false);
      const bite = 1500 + Math.random() * 4500;
      cast = { id: Date.now(), fish: f, bite: Date.now() + bite };
      return { cast: cast.id, bite, diff: f.diff, contest: false };
    },
    land: ({ cast: id, ok }) => {
      const c = cast; cast = null;
      if (!c || c.id !== id) throw err('no_cast', '沒有在釣魚');
      if (!ok) return { fish: c.fish.id, caught: false };
      if (!c.fish.junk) rec.inv[`fish_${c.fish.id}`] = (rec.inv[`fish_${c.fish.id}`] || 0) + 1;
      return { fish: c.fish.id, caught: true, size: fishSize(c.fish), contest: false, ...mine() };
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
  };
  const offline = () => { throw err('login_required', '登入後才能使用'); };
  return {
    server: false,
    call: async (op, data = {}) => (ops[op] || offline)(data),
    /** 測試或除錯用 */
    get fishList() { return FISH; },
  };
}
