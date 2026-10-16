// Static design data: zones, items, ascents, route styles. Numbers are tuned by tests/phoebe-peak.test.mjs and the bot.
export const CELL=10;                       // metres per ledge cell
export const GRID=17;                       // the mountain footprint is GRID x GRID cells
export const PLAYER={radius:.3,wallOffset:.5,height:1.5};
export const BASE_SLOTS=4,MAX_SLOTS=6;

// Zones are altitude bands. `rise` is the average height of one step (one row of cells) inside the zone.
export const ZONES=[
  {id:'beach',  name:'海灘',   rise:6.4,  wall:'beach_wall',   ledge:'beach_ledge',   sky:'sky_beach',   fog:0xcfe6f2, fogNear:80, fogFar:260, temp:0,  hunger:1,   reggie:2},
  {id:'jungle', name:'熱帶',   rise:7.2,  wall:'jungle_wall',  ledge:'jungle_ledge',  sky:'sky_jungle',  fog:0xc9dba8, fogNear:60, fogFar:200, temp:0,  hunger:1.2, reggie:3},
  {id:'alpine', name:'高山',   rise:7.6,  wall:'alpine_wall',  ledge:'alpine_ledge',  sky:'sky_alpine',  fog:0xdbe6ee, fogNear:55, fogFar:190, temp:-1, hunger:1.1, reggie:4},
  {id:'caldera',name:'火山口', rise:7.4,  wall:'caldera_wall', ledge:'caldera_ledge', sky:'sky_caldera', fog:0x6b3a30, fogNear:45, fogFar:170, temp:1,  hunger:1.1, reggie:5},
  {id:'forge',  name:'熔爐',   rise:8.4,  wall:'forge_wall',   ledge:'forge_ledge',   sky:'sky_forge',   fog:0x4a2a2a, fogNear:40, fogFar:150, temp:2,  hunger:1.2, reggie:4},
  {id:'citadel',name:'城塞',   rise:10.5, wall:'citadel_wall', ledge:'citadel_ledge', sky:'sky_citadel', fog:0xd3b8d8, fogNear:50, fogFar:200, temp:-1, hunger:1.3, reggie:3},
];
export const GLOOM_ZONES=['alpine','caldera'];  // the daily seed may turn one of them into a dark, spore-filled variant

// Each stage of the climb is three parallel lanes. A lane has a style that decides its steps, hazards and loot.
export const ROUTES={
  trail: {name:'緩徑',  short:'平緩安全', color:'#6ccf7a', desc:'階梯平緩、有長椅可歇，物資少、少有危險，但繞遠路會餓。', loot:.55, hazard:.4,  crate:.1,  guard:.25, bench:true,  vine:.25, piton:0},
  direct:{name:'直壁',  short:'高壁耗體力', color:'#6aa9ff', desc:'一段段高壁，中間有平地可歇；有垂藤與固定岩釘，很吃體力。', loot:.4,  hazard:.9,  crate:.1,  guard:.5,  bench:false, vine:.6,  piton:.5},
  risk:  {name:'險徑',  short:'資源多、危險多', color:'#ff7a5c', desc:'補給箱與水晶最多，但荊棘、冷熱、落石與瑞吉也最多。',      loot:1.1, hazard:1.7, crate:.4,  guard:1,    bench:false, vine:.1,  piton:0},
};

// Items. weight is in "stamina cap percent"; kind groups the use handler. bonus = extra stamina that is spent first.
export const ITEMS={
  snack:         {name:'航空零食',   kind:'food',  weight:.8, hunger:-35, bonus:10, desc:'安全的零食，大幅緩解飢餓'},
  coconut:       {name:'椰子',       kind:'food',  weight:1.4,hunger:-18, stamina:25, desc:'安全，立刻回復體力'},
  berry_red:     {name:'紅野莓',     kind:'food',  weight:.4, hunger:-10, poisonChance:.35, desc:'可能有毒的野莓'},
  berry_blue:    {name:'藍野莓',     kind:'food',  weight:.4, hunger:-10, poisonChance:.35, desc:'可能有毒的野莓'},
  mushroom_item: {name:'蘑菇',       kind:'food',  weight:.5, hunger:-16, poisonChance:.45, desc:'吃了很補，但常常有毒'},
  granola_bar:   {name:'穀物棒',     kind:'food',  weight:.4, hunger:-15, bonus:25, desc:'少量飽足，附帶 25 點額外體力'},
  honeycomb:     {name:'蜂巢蜜',     kind:'food',  weight:.6, hunger:-10, bonus:40, desc:'從蜂巢取得，附帶 40 點額外體力'},
  winterberry:   {name:'冬莓',       kind:'food',  weight:.3, hunger:-18, cold:-35, desc:'高山的黃色漿果，吃了不怕冷'},
  energy_drink:  {name:'能量飲料',   kind:'drink', weight:.9, desc:'25 秒快速攀爬，之後會昏睡'},
  medkit:        {name:'急救箱',     kind:'heal',  weight:1.6, injury:-40, desc:'治療大部分受傷'},
  bandage:       {name:'繃帶',       kind:'heal',  weight:.5, injury:-15, desc:'處理輕傷'},
  antidote:      {name:'解毒劑',     kind:'cure',  weight:.5, desc:'清除中毒'},
  cure_all:      {name:'萬靈丹',     kind:'cureall', weight:.7, desc:'清除受傷、中毒、冷熱，並補滿體力'},
  hot_tea:       {name:'熱茶',       kind:'warm',  weight:.8, cold:-55, hunger:-6, desc:'驅散寒冷'},
  ice_pack:      {name:'冰敷袋',     kind:'cool',  weight:.7, heat:-55, desc:'消除燥熱'},
  aloe_vera:     {name:'蘆薈',       kind:'cool',  weight:.5, heat:-45, injury:-10, desc:'降溫並舒緩一點傷勢'},
  rope_spool:    {name:'繩索捲',     kind:'rope',  weight:2.2, length:18, desc:'在平台邊緣垂下一條可攀爬的繩'},
  piton:         {name:'岩釘',       kind:'piton', weight:.9, charges:3, desc:'釘進岩壁：附近可休息，體力歸零時救你一次'},
  chain_launcher:{name:'鏈條發射器', kind:'chain', weight:2.4, ammo:3, desc:'射向上方岩壁，把自己拉上去'},
  magic_bean:    {name:'魔豆',       kind:'bean',  weight:.4, desc:'種在高牆前，長出 12 公尺的藤蔓'},
  shelf_fungus:  {name:'棚架菇',     kind:'shelf', weight:.9, charges:2, desc:'在岩壁上長出可站立的平台，能維持 40 秒'},
  bounce_fungus: {name:'彈跳菇',     kind:'bounce',weight:.9, charges:2, desc:'放在地上，踩到會被彈高約 5 公尺'},
  parasol:       {name:'陽傘',       kind:'parasol',weight:1.5, desc:'拿在手上，空中會緩慢飄落且不會摔傷'},
  balloon:       {name:'氣球',       kind:'balloon',weight:.6, desc:'20 秒內重力變小，可以跳得更高'},
  compass:       {name:'指南針',     kind:'compass',weight:.4, desc:'持有即生效：畫面上會指出下一個營地'},
  checkpoint_flag:{name:'路標旗',    kind:'flag',  weight:1, desc:'插下後，昏迷時會在這裡醒來（一次）'},
  backpack:      {name:'登山背包',   kind:'pack',  weight:0, desc:'撿起後立刻增加 2 格背包空間'},
  blowdart:      {name:'吹箭',       kind:'dart',  weight:1.1, ammo:3, desc:'讓瑞吉睡著 12 秒'},
  lantern_item:  {name:'提燈',       kind:'light', weight:1.3, desc:'幽暗區域視野變遠（持有即生效）'},
};
export const PASSIVE=new Set(['light','compass']);
// Loot tables per zone: [item, weight]
export const LOOT={
  beach:  [['snack',5],['coconut',5],['bandage',3],['berry_red',2],['granola_bar',2],['rope_spool',1.2],['piton',1.4],['energy_drink',1],['parasol',.5],['compass',.5],['backpack',.35]],
  jungle: [['berry_red',4],['berry_blue',4],['mushroom_item',4],['snack',3],['coconut',3],['antidote',2],['bandage',2],['granola_bar',1.5],['rope_spool',1.5],['piton',1.5],['magic_bean',1.2],['bounce_fungus',1],['balloon',.8],['blowdart',1],['aloe_vera',1]],
  alpine: [['snack',4],['hot_tea',4],['winterberry',3],['bandage',3],['medkit',1.5],['piton',2],['rope_spool',1.5],['chain_launcher',1.2],['shelf_fungus',1.3],['energy_drink',1.5],['antidote',1],['checkpoint_flag',.7],['backpack',.3]],
  caldera:[['ice_pack',4],['aloe_vera',3],['snack',3],['medkit',2],['antidote',2],['energy_drink',2],['chain_launcher',1.5],['piton',2],['shelf_fungus',1.2],['balloon',1],['blowdart',1.5],['lantern_item',1.5],['cure_all',.5]],
  forge:  [['ice_pack',3],['aloe_vera',2],['medkit',2.5],['snack',3],['energy_drink',2],['chain_launcher',2],['piton',2],['blowdart',2],['antidote',1.5],['lantern_item',1],['shelf_fungus',1.2],['bounce_fungus',1],['cure_all',.6],['checkpoint_flag',.7]],
  citadel:[['hot_tea',3],['winterberry',2],['medkit',2],['snack',3],['granola_bar',2],['energy_drink',2],['chain_launcher',2],['blowdart',2],['piton',2],['rope_spool',2],['magic_bean',1.2],['parasol',.8],['cure_all',.8]],
};
// Like PEAK, each ascent keeps everything from the one before and adds one modifier.
export const ASCENTS=[
  {name:'新手營',       note:'攀爬耗體力 −30%、飢餓變慢、沒有上升的濃霧',          climb:.7, hunger:.7, poison:.8,  hazards:.8,  reggie:.6,  loot:1.2,  fall:1,  weight:1,   mist:0},
  {name:'登山客',       note:'標準難度：濃霧在 8 分鐘後從山腳升起',                climb:1,  hunger:1,  poison:1,   hazards:1,   reggie:1,   loot:1,    fall:1,  weight:1,   mist:.15},
  {name:'第 2 階 · 摔傷加倍', note:'所有摔落傷害 ×2',                               climb:1,  hunger:1,  poison:1.1, hazards:1.1, reggie:1.1, loot:.95,  fall:2,  weight:1,   mist:.17},
  {name:'第 3 階 · 飢餓',     note:'飢餓速度 +60%',                                 climb:1,  hunger:1.6,poison:1.2, hazards:1.2, reggie:1.2, loot:.9,   fall:2,  weight:1,   mist:.19},
  {name:'第 4 階 · 負重',     note:'所有道具重量 +60%',                             climb:1,  hunger:1.6,poison:1.3, hazards:1.3, reggie:1.3, loot:.85,  fall:2,  weight:1.6, mist:.21},
  {name:'第 5 階 · 寒夜',     note:'山上永遠很冷，營火更重要',                       climb:1,  hunger:1.6,poison:1.4, hazards:1.4, reggie:1.4, loot:.8,   fall:2,  weight:1.6, mist:.23, cold:true},
  {name:'第 6 階 · 筋疲力盡', note:'攀爬耗體力 +40%',                               climb:1.4,hunger:1.6,poison:1.5, hazards:1.5, reggie:1.5, loot:.75,  fall:2,  weight:1.6, mist:.25, cold:true},
  {name:'第 7 階 · 極限',     note:'瑞吉成群、補給更少',                             climb:1.4,hunger:1.8,poison:1.7, hazards:1.7, reggie:2,   loot:.65,  fall:2,  weight:1.6, mist:.28, cold:true},
];
export const MIST_START=480;                // seconds before the mist begins to rise
// Stamina model: climbing costs per second (before zone / affliction multipliers).
export const COST={climbUp:5.6,climbSide:4.6,climbDown:2.8,hang:3.2,lunge:20,jump:7,sprint:6,rope:2.2,chain:14,ropeIdle:.6};
