// 商店街的居民：店主（站在店內櫃台後）與在街上走動的路人。
// sprite 對應 assets/ninja/npc/<sprite>.png 與 <sprite>_face.png（Ninja Adventure）。
export const SHOPS = [
  { id: 'general', title: '皮爺爺雜貨店', k: 'shopRed', cx: 72, floor: 'tan', wall: 'cream',
    npc: { name: '皮爺爺', sprite: 'oldman2', lines: ['歡迎光臨！我是皮爺爺。', '種子、肥料、日用品，雜貨店什麼都有。', '聽說你在西邊有一塊地？先把雜草清一清，春天才好播種喔。', '要買點種子嗎？'], action: 'shop' },
    props: [['shelfBig', 40, 50], ['bookcaseBig', 280, 50], ['shelfN', 80, 50], ['sack', 30, 186], ['sack2', 48, 186], ['basket', 66, 186], ['crate', 260, 186], ['barrel', 278, 186], ['barrel', 294, 186], ['plantN', 240, 50]] },
  { id: 'bakery', title: '瑪莉麵包店', k: 'shopBakery', cx: 168, floor: 'yellow', wall: 'orange',
    npc: { name: '瑪莉', sprite: 'woman', lines: ['剛出爐的麵包，要不要聞聞看？', '每天早上五點我就開始揉麵團了。', '如果你種了小麥，記得拿來給我，我幫你烤成麵包！'] },
    props: [['bread', 132, 82], ['bread', 148, 82], ['pot', 260, 50], ['cauldron', 280, 50], ['shelfBig', 40, 50], ['tableLong', 70, 170], ['chairN', 40, 170], ['tableLong', 250, 170], ['barrel', 294, 186]] },
  { id: 'diner', title: '星星餐館', k: 'shopBurger', cx: 256, floor: 'cream', wall: 'sage',
    npc: { name: '阿胖', sprite: 'villager4', lines: ['歡迎來到星星餐館！今天的特餐是甜菜湯。', '晚上大家都會來這裡聊天，很熱鬧的。', '（點餐功能準備中，先坐一下吧。）'] },
    props: [['redTable', 60, 150], ['chairN', 44, 150], ['chairN', 76, 150], ['redTable', 260, 150], ['chairN', 244, 150], ['chairN', 276, 150], ['redTableLong', 160, 186], ['jarRed', 280, 50], ['shelfN', 40, 50], ['plantN', 300, 186]] },
  { id: 'smith', title: '克林鐵匠鋪', k: 'shopDark', cx: 616, floor: 'dark', wall: 'sage',
    npc: { name: '克林', sprite: 'hunter', lines: ['……要升級工具？', '十字鎬敲久了會鈍，拿石頭和礦石來，我幫你打一把更好的。', '（升級功能之後開放。）'] },
    props: [['barrel', 30, 186], ['crate', 46, 186], ['crate', 46, 170], ['cauldron', 270, 50], ['shelfN', 40, 50], ['shelfBig', 80, 50], ['chestN', 290, 186]] },
  { id: 'carpenter', title: '蘿蘋木匠屋', k: 'houseBeige', cx: 712, floor: 'tan', wall: 'orange',
    npc: { name: '蘿蘋', sprite: 'cavegirl2', lines: ['嗨！我是木匠蘿蘋。', '想換小屋的樣子嗎？在你的農場對著小屋旁的告示牌按 E 就能改。', '要我幫你改造小屋嗎？'], action: 'houseDesign' },
    props: [['tableLong', 80, 170], ['hay', 290, 186], ['crate', 30, 186], ['crate', 30, 170], ['bookcase', 280, 50], ['bookcaseBig', 40, 50], ['plantN', 250, 50], ['sofa', 250, 150]] },
  { id: 'clinic', title: '哈醫生診所', k: 'houseAngle', cx: 808, floor: 'cream', wall: 'cream',
    npc: { name: '哈醫生', sprite: 'oldman', lines: ['我是哈醫生。身體不舒服嗎？', '在田裡工作別忘了休息，體力用完會暈倒的。', '（看診功能準備中。）'] },
    props: [['bedBlue', 40, 160], ['bedBlue', 60, 160], ['bedBlue', 280, 160], ['plantN', 26, 50], ['cabinetN', 290, 50], ['drawerN', 270, 50], ['vase', 160, 186], ['bookcase', 60, 50]] },
];

export const TOWNSFOLK = [
  { id: 'mayor', name: '路易斯鎮長', sprite: 'noble', x: 448, y: 300, dir: 0, wander: 40,
    lines: ['歡迎來到派派鎮！我是鎮長路易斯。', '商店街的大家都很友善，有空多來走走。', '每個人都能在西邊分到一塊地，好好經營吧！'],
    event: { flower: ['週末花祭快樂！看看這些彩旗，是大家一起掛的喔。'], market: ['早市的時候整條街最熱鬧了。'] } },
  { id: 'kid', name: '小傑', sprite: 'child', x: 400, y: 340, dir: 0, wander: 70,
    lines: ['嘿！你要跟我玩捉迷藏嗎？', '我知道池塘邊有一隻青蛙，可是牠跳太快了！'],
    event: { flower: ['花祭耶！我要把花戴在頭上！'] } },
  { id: 'granny', name: '艾芙琳奶奶', sprite: 'oldwoman', x: 520, y: 330, dir: 0, wander: 0,
    lines: ['哎呀，年輕人，今天天氣真好。', '我年輕的時候也在農場種過向日葵喔。'],
    event: { flower: ['這些花讓我想起年輕的時候。'] } },
  { id: 'sam', name: '山姆', sprite: 'villager3', x: 380, y: 196, dir: 0, wander: 30,
    lines: ['這些水果都是早上剛到的。', '我在等我的樂團朋友，你會彈吉他嗎？'],
    event: { market: ['早市特賣！種子通通八折！'] }, eventAction: { market: 'market' } },
];
