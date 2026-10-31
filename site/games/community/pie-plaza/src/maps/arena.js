// 派對競技場：廣場北邊木橋過來。中央是比賽場地（地板由 ui/arena.js 依比賽狀態畫），南邊是大廳與報名台。
import { Grid, KIND } from '../engine/grid.js';
import { obj, finalizeMap, scatter } from '../engine/world.js';
import { mulberry } from '../logic.js';
import { ARENA } from '../game/arena.js';

export function buildArena() {
  const g = new Grid(30, 18, KIND.GRASS);
  const [x0, y0, x1, y1] = ARENA.field.map((v) => v / 16);
  g.rect(x0, y0, x1 - 1, y1 - 1, KIND.PAVE);         // 場地
  g.rect(3, 15, 26, 17, KIND.DIRT);                  // 大廳
  g.rect(14, 17, 15, 17, KIND.BRIDGE);
  const [dx, dy] = ARENA.desk;
  const objects = [
    // 北邊看台與旗子
    ...[100, 156, 212, 268, 324, 380].map((x) => obj('showBench', x, 30, { foot: [26, 5] })),
    ...[72, 128, 184, 296, 352, 408].map((x, i) => obj(`banner${(i % 6) + 1}`, x, 44)),
    obj('bulletinBoard', 240, 40, { foot: [24, 6] }),
    // 大廳：報名台、記分板、路燈
    obj('arenaDesk', dx, dy + 10, { foot: [44, 8] }),
    obj('bulletinBoard', 312, 268, { foot: [24, 6] }),
    obj('lampPost', 72, 270, { foot: [6, 4] }), obj('lampPost', 408, 270, { foot: [6, 4] }),
    obj('treeRound', 28, 92), obj('treeApple', 26, 180), obj('treeRound', 452, 96), obj('treeApple', 454, 186),
    obj('treeSmall', 30, 262), obj('treeSmall', 450, 262), obj('barrel', 116, 280), obj('crate', 362, 282), obj('hay', 380, 282),
  ];
  const rnd = mulberry(20261031);
  const fx = ARENA.field;
  const decor = scatter(rnd, g, [KIND.GRASS], 40, ['flowerY', 'flowerP', 'flowerB', 'mushA', 'pebble'], objects,
    (tx, ty) => tx * 16 + 8 > fx[0] - 12 && tx * 16 + 8 < fx[2] + 12 && ty * 16 > fx[1] - 20 && ty * 16 < fx[3] + 12);
  return finalizeMap({
    id: 'arena', title: '派對競技場', grid: g, base: 'grass',
    objects: [...objects, ...decor],
    entries: { south: { x: 240, y: 272, dir: 1 } },
    warps: [{ x0: 222, y0: 282, x1: 258, y1: 296, to: 'plaza', entry: 'north', label: '回廣場' }],
    npcs: [{ id: 'mc', name: '路易斯鎮長', sprite: 'noble', x: dx - 30, y: dy - 2, dir: 0, wander: 0,
      lines: ['歡迎來到派對競技場！我是今天的司儀。', '在報名台按 E 報名「派派大作戰」。人不夠的話，鎮上的朋友會來湊熱鬧。',
        '一場三回合：金幣雨、派餅大戰，最後是落地板決勝。', '每回合依名次拿積分，總分最高的人戴上皇冠！每天前 8 場有金幣獎勵。'] }],
    signs: [
      { x: dx, y: dy, title: '報名台', lines: ['派派大作戰：三回合派對秀。'], action: 'arenaDesk', reach: ARENA.deskReach, hint: 'E 報名' },
      { x: 312, y: 268, title: '記分板', lines: ['派派大作戰記分板。'], action: 'arenaBoard', reach: 20, hint: 'E 看戰績' },
      { x: 240, y: 40, title: '看台告示', lines: ['派派大作戰：金幣雨、派餅大戰、落地板。', '名次積分 10／7／5／3／2／1，總分最高戴皇冠。'], reach: 24 },
    ],
  });
}
