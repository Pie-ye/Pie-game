// 派派新區：商店街東邊的開發區。全鎮工程在這裡一棟棟蓋起來（溫室、海釣碼頭、煙火台）。
// 地圖依全鎮工程狀態產生：蓋好的畫完成的建築，正在蓋的依進度畫工地，還沒輪到的是空地。
import { Grid, KIND } from '../engine/grid.js';
import { obj, finalizeMap, scatter } from '../engine/world.js';
import { mulberry } from '../logic.js';

export const FRONTIER = { w: 36, h: 20, roadY: 9, shoreY: 16 };
/** 工程地點（底部中心，原生像素）。pier 是南岸的碼頭入口。 */
export const SITES = {
  greenhouse: { x: 152, y: 128, k: 'buildGreenhouse', name: '派派溫室' },
  pier: { x: 296, y: 250, k: null, name: '海釣碼頭' },
  fireworks: { x: 440, y: 128, k: 'buildFireworks', name: '煙火台' },
};
const PIER = { tx: 18, len: 4 };       // 碼頭：第 18、19 欄，從岸邊往海裡 4 格

/** town：{ done: [...], cur, p }（伺服器 'town' 公開狀態）。 */
export function buildFrontier(town = { done: [], cur: 'greenhouse', p: 0 }) {
  const { w, h, roadY, shoreY } = FRONTIER;
  const g = new Grid(w, h, KIND.GRASS);
  g.rect(0, shoreY, w - 1, h - 1, KIND.WATER);
  g.rect(0, roadY, w - 1, roadY + 1, KIND.DIRT);                     // 東西向主路
  g.rect(PIER.tx, roadY + 2, PIER.tx + 1, shoreY - 1, KIND.DIRT);     // 往南岸的小路
  const done = new Set(town.done || []);
  const objects = [], signs = [];
  for (const [id, s] of Object.entries(SITES)) {
    const built = done.has(id), current = town.cur === id;
    if (id === 'pier') {
      if (built) {
        g.rect(PIER.tx, shoreY, PIER.tx + 1, shoreY + PIER.len - 1, KIND.BRIDGE);
        signs.push({ x: s.x, y: s.y - 16, title: s.name, lines: ['海釣碼頭蓋好了！', '走到碼頭上，拿釣竿面向海按空白鍵。這裡有章魚和大蝦。'], reach: 20 });
      } else {
        objects.push(obj(current ? siteKey(town.p) : 'buildSite0', s.x, s.y - 10, { foot: [56, 20] }));
        signs.push(siteSign(id, s, current, town.p, -10));
      }
      continue;
    }
    if (built) {
      objects.push(obj(s.k, s.x, s.y, { foot: [56, 24] }));
      signs.push({ x: s.x, y: s.y + 4, title: s.name, lines: [id === 'greenhouse' ? '派派溫室蓋好了！全鎮的作物都長得比較快。' : '煙火台蓋好了！每晚 21:00 在廣場放煙火，到場的人都有小禮物。'], reach: 26 });
    } else {
      objects.push(obj(current ? siteKey(town.p) : 'buildSite0', s.x, s.y, { foot: [56, 20] }));
      signs.push(siteSign(id, s, current, town.p, 4));
    }
  }
  // 建設委員會：工頭與看板
  objects.push(obj('bulletinBoard', 280, 126, { foot: [24, 6] }), obj('signPost', 30, roadY * 16 - 4));
  objects.push(obj('crate', 320, 120), obj('barrel', 336, 122), obj('sack', 232, 124, { foot: [10, 5] }));
  signs.push({ x: 280, y: 126, title: '建設委員會看板', lines: ['派派新區建設委員會：大家一起蓋。'], action: 'town', reach: 22, hint: 'E 看工程' });
  signs.push({ x: 30, y: roadY * 16 - 4, title: '路牌', lines: ['派派新區', '← 西邊回商店街', '全鎮一起捐材料，把這裡蓋起來！'] });
  // 四周樹林與野地（開發區還很荒）
  for (let x = 24; x < w * 16; x += 56) objects.push(obj(x % 112 ? 'treeClump' : 'pineClump', x, 40));
  for (let y = 70; y < shoreY * 16 - 8; y += 48) objects.push(obj('treeBig', w * 16 - 18, y));
  const rnd = mulberry(20261101);
  const near = (tx, ty) => objects.some((o) => Math.abs(o.x - (tx * 16 + 8)) < (o.w || 16) / 2 + 10 && ty * 16 + 13 > o.y - (o.h || 16) - 6 && ty * 16 + 13 < o.y + 14);
  const decor = scatter(rnd, g, [KIND.GRASS], 160, ['weedA', 'weedB', 'weedC', 'fern', 'grayRockS', 'brownRockS', 'flowerY', 'mushA', 'pebble'], objects,
    (tx, ty) => g.get(tx, ty - 1) !== KIND.GRASS || g.get(tx, ty + 1) === KIND.WATER || near(tx, ty));
  return finalizeMap({
    id: 'frontier', title: '派派新區', grid: g, base: 'water', shared: false, objects: [...objects, ...decor.map((d) => ({ ...d, foot: null }))],
    warps: [{ x0: -8, y0: roadY * 16, x1: 8, y1: roadY * 16 + 32, to: 'town', entry: 'east', label: '商店街' }],
    entries: { west: { x: 20, y: roadY * 16 + 18, dir: 3 } },
    signs,
    npcs: [{ id: 'foreman', name: '工頭阿土', sprite: 'oldman', x: 256, y: 150, dir: 0, wander: 0,
      lines: ['我是工頭阿土！派派新區要靠大家一起蓋。', '去看板那邊看看這一期缺什麼：木材、石頭、作物、魚，還有金幣。', '蓋好以後，每個出過力的人都有回饋金，全鎮都會受益！'], action: 'town' }],
    bridges: done.has('pier') ? Array.from({ length: PIER.len / 2 }, (_, i) => ({ x: PIER.tx * 16, y: (shoreY + i * 2) * 16, v: true })) : [],
    pier: done.has('pier') ? { x0: PIER.tx * 16, x1: (PIER.tx + 2) * 16, y0: shoreY * 16, y1: (shoreY + PIER.len) * 16 } : null,
  });
}

function siteKey(p) { return p >= 0.67 ? 'buildSite2' : p >= 0.34 ? 'buildSite1' : 'buildSite0'; }

function siteSign(id, s, current, p, dy) {
  const lines = current
    ? [`${s.name}正在施工（${Math.round((p || 0) * 100)}%）。`, '到建設委員會看板或找工頭阿土捐材料。']
    : [`${s.name}預定地。`, '等前面的工程蓋好就輪到這裡。'];
  return { x: s.x, y: s.y + dy, title: s.name, lines, action: current ? 'town' : null, reach: 30, hint: current ? 'E 捐材料' : undefined };
}
