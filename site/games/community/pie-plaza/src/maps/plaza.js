// 廣場：所有人共用的中心。西邊的橋通往自己的農場，東邊的橋通往商店街。
import { Grid, KIND } from '../engine/grid.js';
import { obj, finalizeMap, scatter } from '../engine/world.js';
import { mulberry } from '../logic.js';

export function buildPlaza() {
  const g = new Grid(30, 18, KIND.WATER);
  g.rect(2, 1, 27, 16, KIND.GRASS);
  g.rect(11, 6, 18, 11, KIND.DIRT);          // 中央廣場
  g.rect(14, 2, 15, 15, KIND.DIRT);          // 南北向
  g.rect(2, 8, 27, 9, KIND.DIRT);            // 東西向
  g.rect(0, 8, 1, 9, KIND.BRIDGE); g.rect(28, 8, 29, 9, KIND.BRIDGE);
  const objects = [
    obj('chickenHouse', 90, 104, { foot: [30, 10] }), obj('chest', 200, 126),
    obj('log', 196, 184, { foot: [16, 6] }), obj('log', 284, 184, { foot: [16, 6] }), obj('stump', 292, 112),
    obj('sunflower', 352, 100, { foot: null }), obj('sunflower', 374, 104, { foot: null }),
    obj('treeRound', 52, 92), obj('treeApple', 76, 66), obj('treeRound', 50, 210), obj('treeApple', 62, 254),
    obj('treeRound', 120, 258), obj('treeSmall', 150, 76), obj('treeRound', 300, 72), obj('treeApple', 412, 74),
    obj('treeRound', 430, 200), obj('treeRound', 418, 256), obj('treeApple', 348, 258), obj('treeSmall', 290, 246),
    obj('treeSmall', 190, 246), obj('treeRound', 268, 66), obj('rockBig', 380, 214), obj('rockBig', 96, 218),
    obj('signPost', 52, 126), obj('signPost', 428, 126),
  ];
  const rnd = mulberry(20261030);
  const decor = scatter(rnd, g, [KIND.GRASS], 120, ['flowerY', 'flowerY2', 'flowerP', 'flowerP2', 'flowerB', 'mushA', 'mushB', 'mushC', 'mushD', 'bush', 'bushBerry', 'pebble'],
    objects, (tx, ty) => g.get(tx, ty - 1) !== KIND.GRASS || objects.some((o) => Math.abs(o.x - (tx * 16 + 8)) < 24 && Math.abs(o.y - (ty * 16 + 13)) < 20));
  return finalizeMap({
    id: 'plaza', title: '廣場', grid: g, base: 'water', objects: [...objects, ...decor.filter((d) => d.k !== 'bush' && d.k !== 'bushBerry' ? true : (d.foot = null, true))],
    entries: { center: { x: 240, y: 150, dir: 0 }, west: { x: 30, y: 150, dir: 3 }, east: { x: 450, y: 150, dir: 2 } },
    warps: [
      { x0: -8, y0: 128, x1: 10, y1: 160, to: 'farm', entry: 'east', label: '我的農場' },
      { x0: 470, y0: 128, x1: 488, y1: 160, to: 'town', entry: 'west', label: '商店街' },
    ],
    signs: [
      { x: 52, y: 126, title: '告示牌', lines: ['← 西邊：我的農場', '每個人都有一塊自己的地，先把雜草和石頭清乾淨吧！'] },
      { x: 428, y: 126, title: '告示牌', lines: ['東邊：商店街 →', '雜貨店、麵包店、餐館、鐵匠鋪、木匠屋、診所都在那裡。'] },
    ],
    bridges: [{ x: 0, y: 128 }, { x: 448, y: 128 }],
  });
}
