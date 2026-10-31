// 廣場：所有人共用的中心。西邊的橋通往自己的農場，東邊的橋通往商店街。
import { Grid, KIND } from '../engine/grid.js';
import { obj, finalizeMap, scatter } from '../engine/world.js';
import { mulberry } from '../logic.js';
import { JOIN, PARTY } from '../game/party.js';
import { BOARD } from '../game/contest.js';
import { SEEK_JOIN, SEEK } from '../game/seek.js';
import { HOT_JOIN, HOT } from '../game/hot.js';
import { TUG_JOIN, TUG } from '../game/tug.js';
import { LIGHT_JOIN, LIGHT } from '../game/light.js';
import { HAUL_JOIN, HAUL_DROP, HAUL } from '../game/haul.js';
import { HILL_JOIN, HILL } from '../game/hill.js';
import { SMASH_JOIN, SMASH } from '../game/smash.js';
import { VASE_JOIN, VASE } from '../game/vase.js';

export function buildPlaza() {
  const g = new Grid(30, 18, KIND.WATER);
  g.rect(2, 1, 28, 16, KIND.GRASS);
  g.rect(11, 6, 18, 11, KIND.DIRT);          // 中央廣場
  g.rect(14, 2, 15, 15, KIND.DIRT);          // 南北向
  g.rect(2, 8, 27, 9, KIND.DIRT);            // 東西向
  g.rect(0, 8, 1, 9, KIND.BRIDGE); g.rect(28, 8, 29, 9, KIND.BRIDGE);
  g.rect(14, 0, 15, 1, KIND.BRIDGE);         // 北橋：派對競技場
  const objects = [
    obj('chickenHouse', 90, 104, { foot: [30, 10] }), obj(JOIN.k, JOIN.x, JOIN.y),
    ...PARTY.spots.map((s) => obj(s.k, s.x, s.y)),
    obj('banner1', 190, 92), obj('banner3', 210, 92),
    // 原創地標：菲比啾比女神噴水池（廣場中央）
    obj('fountain0', 240, 182, { foot: [50, 18], anim: ['fountain0', 'fountain1', 'fountain2'], fps: 5 }),
    // 原創地標：瑞吉海獅秀（東南角的海邊劇場）
    obj('showStage', 390, 268, { foot: [70, 40] }), obj('reggieIdle', 389, 252, { foot: null, reggie: true, z: 30 }),
    obj('showBench', 322, 226, { foot: [26, 5] }), obj('showBench', 322, 250, { foot: [26, 5] }),
    obj('log', 196, 184, { foot: [16, 6] }), obj('log', 284, 184, { foot: [16, 6] }), obj('stump', 292, 112),
    obj('sunflower', 352, 100, { foot: null }), obj('sunflower', 374, 104, { foot: null }),
    obj('treeRound', 52, 92), obj('treeApple', 76, 66), obj('treeRound', 50, 210), obj('treeApple', 62, 254),
    obj('treeRound', 120, 258), obj('treeSmall', 150, 76), obj('treeRound', 300, 72), obj('treeApple', 412, 74),
    obj('treeRound', 440, 196), obj('treeSmall', 290, 246),
    obj('treeSmall', 190, 246), obj('treeRound', 268, 66), obj('rockBig', 96, 250),
    obj('signPost', 52, 126), obj('signPost', 428, 126),
    obj('bulletinBoard', 330, 122, { foot: [28, 6] }),
    obj('lampPost', 168, 124, { foot: [6, 4] }), obj('lampPost', 168, 206, { foot: [6, 4] }), obj('lampPost', 312, 206, { foot: [6, 4] }),
    obj(BOARD.k, BOARD.x, BOARD.y, { foot: [10, 5] }),
    obj(SEEK_JOIN.k, SEEK_JOIN.x, SEEK_JOIN.y, { foot: [16, 5] }),
    obj(HOT_JOIN.k, HOT_JOIN.x, HOT_JOIN.y, { foot: [12, 6] }),
    obj(TUG_JOIN.k, TUG_JOIN.x, TUG_JOIN.y, { foot: [14, 8] }),
    ...TUG.spots.map((s) => obj(s.k, s.x, s.y, { foot: [14, 8] })),
    obj(LIGHT_JOIN.k, LIGHT_JOIN.x, LIGHT_JOIN.y, { foot: null }),
    ...LIGHT.spots.map((s) => obj(s.k, s.x, s.y, { foot: s.k === 'railing' ? null : [6, 4] })),
    obj(HAUL_JOIN.k, HAUL_JOIN.x, HAUL_JOIN.y, { foot: [12, 8] }),
    obj(HAUL_DROP.k, HAUL_DROP.x, HAUL_DROP.y, { foot: [12, 8] }),
    obj(HILL_JOIN.k, HILL_JOIN.x, HILL_JOIN.y, { foot: null }),
    obj(SMASH_JOIN.k, SMASH_JOIN.x, SMASH_JOIN.y, { foot: [10, 5] }),
    obj(VASE_JOIN.k, VASE_JOIN.x, VASE_JOIN.y, { foot: [10, 5] }),
  ];
  const rnd = mulberry(20261030);
  const decor = scatter(rnd, g, [KIND.GRASS], 120, ['flowerY', 'flowerY2', 'flowerP', 'flowerP2', 'flowerB', 'mushA', 'mushB', 'mushC', 'mushD', 'bush', 'bushBerry', 'pebble'],
    objects, (tx, ty) => g.get(tx, ty - 1) !== KIND.GRASS || objects.some((o) => Math.abs(o.x - (tx * 16 + 8)) < 24 && Math.abs(o.y - (ty * 16 + 13)) < 20));
  return finalizeMap({
    id: 'plaza', title: '廣場', grid: g, base: 'water', objects: [...objects, ...decor.filter((d) => d.k !== 'bush' && d.k !== 'bushBerry' ? true : (d.foot = null, true))],
    entries: { center: { x: 240, y: 206, dir: 0 }, west: { x: 30, y: 150, dir: 3 }, east: { x: 450, y: 150, dir: 2 }, north: { x: 240, y: 30, dir: 0 } },
    warps: [
      { x0: -8, y0: 128, x1: 10, y1: 160, to: 'farm', entry: 'east', label: '我的農場' },
      { x0: 470, y0: 128, x1: 488, y1: 160, to: 'town', entry: 'west', label: '商店街' },
      { x0: 222, y0: -8, x1: 258, y1: 8, to: 'arena', entry: 'south', label: '派對競技場' },
    ],
    signs: [
      { x: 52, y: 126, title: '告示牌', lines: ['← 西邊：我的農場', '每個人都有一塊自己的地，先把雜草和石頭清乾淨吧！', '常駐派對：西邊搬寶、西南捉迷藏、雞舍傳南瓜。北邊搶寶與紅綠燈。'] },
      { x: 428, y: 126, title: '告示牌', lines: ['東邊：商店街 →', '雜貨店、麵包店、餐館、鐵匠鋪、木匠屋、診所都在那裡。', '常駐派對：東邊拔河、東岸搶瓶、東北占席、南岸砸罐。'] },
      { x: 330, y: 122, title: '公告欄', lines: ['派派鎮公告欄：今天的活動都貼在這裡。', '常駐派對：北邊搶寶、西南捉迷藏、雞舍傳南瓜、東邊拔河、西邊搬寶、北邊紅綠燈、東北占席、南岸砸罐、東岸搶瓶。'], action: 'events', reach: 20 },
      { x: JOIN.x, y: JOIN.y, title: '廣場搶寶', lines: ['三個人湊齊開始倒數，最多八人上車。', '走到木箱、麻袋、竹籃旁邊按 E 把東西拿走。', '搶最多的人拿 40 G，第二 20 G，第三 10 G。'], action: 'party', reach: PARTY.reach, hint: 'E 參加搶寶' },
      ...PARTY.spots.map((s) => ({ x: s.x, y: s.y, title: s.name, lines: ['搶寶開始後，走近按 E 就能拿走。'], action: 'partyGrab', spot: s.id, reach: PARTY.reach, hint: 'E 搶寶' })),
      { x: 240, y: 182, title: '菲比女神噴水池', lines: ['菲比啾比女神守護著派派鎮。', '據說投一枚硬幣（10 G）許願，女神會回應虔誠的人。'], action: 'wish', reach: 36, hit: 30, hint: 'E 許願（10 G）', hintY: 60 },
      { x: BOARD.x, y: BOARD.y, title: '釣魚大賽', lines: ['每天 12–13、18–19（台北）在海邊釣魚，公分寫上這塊板。', '金色鯉魚分數加倍。時段結束第一名 40 G，第二 20 G，第三 10 G。'], action: 'contest', reach: 20, hint: 'E 看記分板' },
      { x: SEEK_JOIN.x, y: SEEK_JOIN.y, title: '營火捉迷藏', lines: ['三個人湊齊開始倒數，最多八人。', '第一個加入的人當尋人，其他人藏進圓木、樹和石頭。', '沒被抓到的人拿 40／20／10 G。'], action: 'seek', reach: SEEK.reach, hint: 'E 參加捉迷藏' },
      { x: HOT_JOIN.x, y: HOT_JOIN.y, title: '傳南瓜', lines: ['三個人湊齊開始倒數，最多八人；只有你一個時，等一下鎮民會來湊。', '開場第一人拿著南瓜。拿著的人在雞舍旁按 E 傳給下一位，剛接到要等一下才能再傳。', '時間到手上有南瓜的人最後一名；其他人拿在手上越短越前面，40／20／10 G。'], action: 'hot', reach: HOT.reach, hint: 'E 傳南瓜' },
      { x: TUG_JOIN.x, y: TUG_JOIN.y, title: '廣場拔河', lines: ['三個人湊齊開始倒數，最多八人。', '單數左岸、雙數右岸，走到乾草樁按 E 拉。', '拉力高的岸 40／20／10 G，輸的岸 5 G。'], action: 'tug', reach: TUG.reach, hint: 'E 參加拔河' },
      ...TUG.spots.map((s) => ({ x: s.x, y: s.y, title: s.name, lines: ['拔河開始後，走近按 E 就能拉。'], action: 'tugPull', side: s.id, reach: TUG.reach, hint: 'E 拉' })),
      { x: LIGHT_JOIN.x, y: LIGHT_JOIN.y, title: '廣場紅綠燈', lines: ['三個人湊齊開始倒數，最多八人。', '綠燈時走到下一樁按 E，紅燈時不要按。', '先到終點的人 40／20／10 G，紅燈亂動會出局。'], action: 'light', reach: LIGHT.reach, hint: 'E 參加紅綠燈' },
      ...LIGHT.spots.map((s) => ({ x: s.x, y: s.y, title: s.name, lines: ['綠燈走近按 E 踩樁，紅燈按 E 會出局。'], action: 'lightDash', spot: s.id, reach: LIGHT.reach, hint: 'E 踩樁' })),
      { x: HAUL_JOIN.x, y: HAUL_JOIN.y, title: '廣場搬寶', lines: ['三個人湊齊開始倒數，最多八人。', '走近木桶按 E 扛起寶物，跑到東北大鍋按 E 放下得分。', '送最多的人拿 40 G，第二 20 G，第三 10 G。'], action: 'haul', reach: HAUL.reach, hint: 'E 參加搬寶' },
      { x: HAUL_DROP.x, y: HAUL_DROP.y, title: '搬寶大鍋', lines: ['搬寶開始後，扛著寶物走到這裡按 E 放下得分。'], action: 'haulDrop', reach: HAUL.reach, hint: 'E 放下寶物' },
      { x: HILL_JOIN.x, y: HILL_JOIN.y, title: '廣場占席', lines: ['三個人湊齊開始倒數，最多八人。', '走近東北草席按 E 占住，別人也可以搶。', '占最久的人拿 40 G，第二 20 G，第三 10 G。'], action: 'hill', reach: HILL.reach, hint: 'E 參加占席' },
      { x: SMASH_JOIN.x, y: SMASH_JOIN.y, title: '廣場砸罐', lines: ['三個人湊齊開始倒數，最多八人。', '罐子冒出來時走近按 E 砸中，縮回去就不要砸。', '砸最多的人拿 40 G，第二 20 G，第三 10 G。'], action: 'smash', reach: SMASH.reach, hint: 'E 參加砸罐' },
      { x: VASE_JOIN.x, y: VASE_JOIN.y, title: '廣場搶瓶', lines: ['三個人湊齊開始倒數，最多八人。', '單數紅隊、雙數藍隊，走近花瓶按 E 搶給自己的隊。', '隊友拿著就守住，對手才能搶。贏的隊 40／20／10 G。'], action: 'vase', reach: VASE.reach, hint: 'E 參加搶瓶' },
      ...SEEK.spots.map((s) => ({ x: s.x, y: s.y, title: s.name, lines: ['捉迷藏開始後，藏的人按 E 鑽進去，尋人按 E 檢查。'], action: 'seekSpot', spot: s.id, reach: SEEK.reach, hint: 'E 藏或檢查' })),
      { x: 389, y: 250, title: '瑞吉海獅劇場', lines: ['這裡是海獅瑞吉的劇場！', '表演時間：每天 10 點、15 點、19 點各一場。', '帶條魚來餵瑞吉，牠會送你種子當回禮。'], action: 'show', reach: 40, hit: 30, hint: 'E 餵瑞吉', hintY: 40 },
    ],
    bridges: [{ x: 0, y: 128 }, { x: 448, y: 128 }, { x: 224, y: 0, v: true }],
  });
}
