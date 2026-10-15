// Static design data: zones, items, ascents. Numbers are tuned by tests/phoebe-peak.test.mjs and the bot.
export const CELL=10;                       // metres per ledge cell
export const PLAYER={radius:.3,wallOffset:.5,height:1.5};

// Boxes are assigned to zones in order; the final altitude of a zone is where its last box ends.
export const ZONES=[
  {id:'beach',  name:'海灘',   boxes:8, rise:[6,9],   wall:'beach_wall',   ledge:'beach_ledge',   sky:'sky_beach',   fog:0xcfe6f2, fogNear:80, fogFar:260, temp:0,  hunger:1,   reggie:1},
  {id:'jungle', name:'熱帶',   boxes:9, rise:[8,11],  wall:'jungle_wall',  ledge:'jungle_ledge',  sky:'sky_jungle',  fog:0xc9dba8, fogNear:60, fogFar:200, temp:0,  hunger:1.2, reggie:1},
  {id:'alpine', name:'高山',   boxes:9, rise:[9,12],  wall:'alpine_wall',  ledge:'alpine_ledge',  sky:'sky_alpine',  fog:0xdbe6ee, fogNear:55, fogFar:190, temp:-1, hunger:1.1, reggie:2},
  {id:'caldera',name:'火山口', boxes:9, rise:[10,13], wall:'caldera_wall', ledge:'caldera_ledge', sky:'sky_caldera', fog:0x6b3a30, fogNear:45, fogFar:170, temp:1,  hunger:1.1, reggie:2},
  {id:'forge',  name:'熔爐',   boxes:9, rise:[10,14], wall:'forge_wall',   ledge:'forge_ledge',   sky:'sky_forge',   fog:0x4a2a2a, fogNear:40, fogFar:150, temp:2,  hunger:1.2, reggie:3},
  {id:'citadel',name:'城塞',   boxes:5, rise:[11,15], wall:'citadel_wall', ledge:'citadel_ledge', sky:'sky_citadel', fog:0xd3b8d8, fogNear:50, fogFar:200, temp:-1, hunger:1.3, reggie:3},
];
export const GLOOM_ZONES=['alpine','caldera'];  // the daily seed may turn one of them into a dark, spore-filled variant

// Items. weight is in "stamina cap percent"; kind groups the use handler.
export const ITEMS={
  snack:         {name:'航空零食',   kind:'food',  weight:.8, hunger:-35, desc:'安全的零食，大幅緩解飢餓'},
  coconut:       {name:'椰子',       kind:'food',  weight:1.4,hunger:-18, stamina:25, desc:'安全，立刻回復體力'},
  berry_red:     {name:'紅野莓',     kind:'food',  weight:.4, hunger:-10, poisonChance:.35, desc:'可能有毒的野莓'},
  berry_blue:    {name:'藍野莓',     kind:'food',  weight:.4, hunger:-10, poisonChance:.35, desc:'可能有毒的野莓'},
  mushroom_item: {name:'蘑菇',       kind:'food',  weight:.5, hunger:-16, poisonChance:.45, desc:'吃了很補，但常常有毒'},
  energy_drink:  {name:'能量飲料',   kind:'drink', weight:.9, desc:'25 秒快速攀爬，之後會昏睡'},
  medkit:        {name:'急救箱',     kind:'heal',  weight:1.6, injury:-40, desc:'治療大部分受傷'},
  bandage:       {name:'繃帶',       kind:'heal',  weight:.5, injury:-15, desc:'處理輕傷'},
  antidote:      {name:'解毒劑',     kind:'cure',  weight:.5, desc:'清除中毒'},
  hot_tea:       {name:'熱茶',       kind:'warm',  weight:.8, cold:-55, hunger:-6, desc:'驅散寒冷'},
  ice_pack:      {name:'冰敷袋',     kind:'cool',  weight:.7, heat:-55, desc:'消除燥熱'},
  rope_spool:    {name:'繩索捲',     kind:'rope',  weight:2.2, length:18, desc:'在平台邊緣垂下一條可攀爬的繩'},
  piton:         {name:'岩釘',       kind:'piton', weight:.9, charges:3, desc:'釘進岩壁：附近可休息，體力歸零時救你一次'},
  chain_launcher:{name:'鏈條發射器', kind:'chain', weight:2.4, ammo:3, desc:'射向上方岩壁，把自己拉上去'},
  blowdart:      {name:'吹箭',       kind:'dart',  weight:1.1, ammo:3, desc:'讓瑞吉睡著 12 秒'},
  lantern_item:  {name:'提燈',       kind:'light', weight:1.3, desc:'幽暗區域視野變遠（持有即生效）'},
};
// Loot tables per zone: [item, weight]
export const LOOT={
  beach:  [['snack',5],['coconut',5],['bandage',3],['berry_red',2],['rope_spool',1.2],['piton',1.2],['energy_drink',1]],
  jungle: [['berry_red',4],['berry_blue',4],['mushroom_item',4],['snack',3],['coconut',3],['antidote',2],['bandage',2],['rope_spool',1.5],['piton',1.5],['blowdart',1]],
  alpine: [['snack',4],['hot_tea',4],['bandage',3],['medkit',1.5],['piton',2],['rope_spool',1.5],['chain_launcher',1.2],['energy_drink',1.5],['antidote',1]],
  caldera:[['ice_pack',4],['snack',3],['medkit',2],['antidote',2],['energy_drink',2],['chain_launcher',1.5],['piton',2],['blowdart',1.5],['lantern_item',1.5]],
  forge:  [['ice_pack',3],['medkit',2.5],['snack',3],['energy_drink',2],['chain_launcher',2],['piton',2],['blowdart',2],['antidote',1.5],['lantern_item',1]],
  citadel:[['hot_tea',3],['medkit',2],['snack',3],['energy_drink',2],['chain_launcher',2],['blowdart',2],['piton',2],['rope_spool',2]],
};
export const ASCENTS=[
  {name:'第 0 階 · 新手營',   hunger:1,    poison:1,    hazards:1,   reggie:1,    loot:1.15},
  {name:'第 1 階 · 山徑',     hunger:1.2,  poison:1.15, hazards:1.2, reggie:1.15, loot:1},
  {name:'第 2 階 · 峭壁',     hunger:1.4,  poison:1.3,  hazards:1.4, reggie:1.3,  loot:.9},
  {name:'第 3 階 · 暴風',     hunger:1.65, poison:1.5,  hazards:1.65,reggie:1.5,  loot:.8},
  {name:'第 4 階 · 極限',     hunger:2,    poison:1.8,  hazards:2,   reggie:1.8,  loot:.7},
];
// Stamina model: climbing costs per second (before zone / affliction multipliers).
export const COST={climbUp:5.6,climbSide:4.6,climbDown:2.8,hang:3.2,lunge:20,jump:7,sprint:6,rope:2.2,chain:14,ropeIdle:.6};
