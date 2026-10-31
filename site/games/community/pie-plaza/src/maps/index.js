// 地圖註冊：依區域代號建立地圖（共用地圖只建一次）。
import { buildPlaza } from './plaza.js';
import { buildTown } from './town.js';
import { buildFarm } from './farm.js';
import { buildShop, buildHouse } from './interior.js';
import { buildArena } from './arena.js';

const cache = new Map();
/** area：'plaza'、'town'、'shop:<id>'、'farm:<owner>'、'house:<owner>'。ctx 提供個人資料（小屋樣式、裝潢）。 */
export function getMap(area, ctx = {}) {
  const [kind, arg] = area.split(':');
  if (kind === 'farm' || kind === 'house') {            // 個人地圖：資料可能改變，每次重建
    if (kind === 'farm') return buildFarm(arg, ctx.decor || {});
    return buildHouse(arg, ctx.decor);
  }
  if (!cache.has(area)) {
    const m = kind === 'plaza' ? buildPlaza() : kind === 'town' ? buildTown() : kind === 'arena' ? buildArena() : kind === 'shop' ? buildShop(arg) : null;
    if (!m) return null;
    cache.set(area, m);
  }
  return cache.get(area);
}
export const AREA_NAMES = { plaza: '廣場', town: '商店街', arena: '派對競技場', farm: '我的農場', house: '我的小屋' };
