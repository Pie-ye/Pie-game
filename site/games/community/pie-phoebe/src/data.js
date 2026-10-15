// 技能、被動、敵人、頭目的設定。
// 菲比的設計依據（鳴潮）：衍射（Spectro）共鳴者；招牌是疊加「光噪效應」，
// 以及用「祈願」在「赦罪（輸出）」與「告解（輔助）」之間切換。技能名稱與效果是本遊戲的改編，不是原作數值。
// 瑞吉的設計依據：網路上的海獅「瑞吉」——愛吃小魚、胖嘟嘟、愛張大嘴巴大叫。

export const WEAPONS = {
  chain: {
    name: '連鎖雷光', icon: 'ϟ', max: 8, kind: 'phoebe',
    desc: '雷光在附近敵人間跳躍，每次命中疊加光噪。',
    lv: ['', '跳躍 3 個目標', '傷害提高', '+1 目標', '冷卻縮短', '+1 目標', '傷害提高', '+1 目標', '傷害與跳躍距離提高'],
  },
  frost: {
    name: '冰晶祈願', icon: '❄', max: 8, kind: 'phoebe',
    desc: '冰凍最近敵群並持續減速；頭目只減速。',
    lv: ['', '冰晶爆發', '傷害提高', '範圍提高', '冷卻縮短', '範圍提高', '傷害提高', '範圍提高', '減速延長'],
  },
  trail: {
    name: '巡星光痕', icon: '⋆', max: 8, kind: 'phoebe',
    desc: '移動時留下持續灼傷的光痕；重疊光痕不重複計算傷害。',
    lv: ['', '移動留下光痕', '傷害提高', '範圍提高', '持續時間提高', '傷害提高', '範圍提高', '持續時間提高', '傷害大幅提高'],
  },
  star: {
    name: '星輝', icon: '✦', max: 8, kind: 'phoebe',
    desc: '發射追蹤敵人的衍射星光，命中疊加光噪。',
    lv: ['', '1 顆星輝', '+1 顆', '傷害提高', '+1 顆', '穿透 1 次', '+1 顆', '傷害大幅提高', '+1 顆、穿透 2 次'],
  },
  ring: {
    name: '鏡之環', icon: '◎', max: 8, kind: 'phoebe',
    desc: '鏡環繞身旋轉，撞傷敵人並反射敵方子彈。',
    lv: ['', '1 個鏡環', '範圍變大', '+1 個鏡環', '傷害提高', '轉速提高', '+1 個鏡環', '範圍變大', '+1 個鏡環、傷害提高'],
  },
  litany: {
    name: '聖祷', icon: '❖', max: 8, kind: 'phoebe',
    desc: '重擊：一道貫穿的光束，對光噪層數越高的敵人傷害越大。',
    lv: ['', '1 道光束', '傷害提高', '冷卻縮短', '+1 道光束', '光束變寬', '冷卻縮短', '+1 道光束', '傷害大幅提高'],
  },
  field: {
    name: '默禱領域', icon: '◌', max: 8, kind: 'phoebe',
    desc: '腳下展開禱告領域，持續疊加光噪並減速敵人。',
    lv: ['', '小範圍領域', '範圍變大', '傷害提高', '減速加強', '範圍變大', '傷害提高', '範圍變大', '傷害大幅提高'],
  },
  echo: {
    name: '告解迴響', icon: '☉', max: 8, kind: 'phoebe',
    desc: '向外擴散的聲波，擊退敵人並一口氣疊 2 層光噪。',
    lv: ['', '迴響', '範圍變大', '冷卻縮短', '傷害提高', '範圍變大', '冷卻縮短', '傷害提高', '雙重迴響'],
  },
  rain: {
    name: '星屑雨', icon: '☄', max: 8, kind: 'phoebe',
    desc: '標記敵人腳下，下一刻星屑墜落爆炸。',
    lv: ['', '1 顆星屑', '傷害提高', '+1 顆', '爆炸變大', '+1 顆', '傷害提高', '+1 顆', '冷卻縮短'],
  },
};

export const PASSIVES = {
  might: { name: '聖潔', icon: '✚', max: 5, desc: '攻擊力 +12%', stat: '攻擊' },
  haste: { name: '輕盈', icon: '≫', max: 5, desc: '技能冷卻 -8%', stat: '冷卻' },
  speed: { name: '疾行', icon: '➤', max: 5, desc: '移動速度 +10%', stat: '移速' },
  vital: { name: '堅毅', icon: '♥', max: 5, desc: '最大生命 +20，並回復 20', stat: '生命' },
  area: { name: '遠音', icon: '◯', max: 5, desc: '技能範圍 +12%', stat: '範圍' },
  prayer: { name: '虔誠', icon: '✧', max: 5, desc: '祈願充能速度 +20%', stat: '祈願' },
  magnet: { name: '招魚', icon: '⌁', max: 5, desc: '小魚吸取範圍 +30%', stat: '吸魚' },
};

export const PET = {
  roar: {
    name: '瑞吉・張嘴吼', icon: '🦭', max: 8, kind: 'pet',
    desc: '瑞吉張大嘴巴大叫，震退並暈眩周圍的敵人。',
    lv: ['', '吼叫', '範圍變大', '冷卻縮短', '傷害提高', '範圍變大', '暈眩更久', '冷卻縮短', '傷害大幅提高'],
  },
  slide: {
    name: '瑞吉・肚皮滑行', icon: '🌊', max: 8, kind: 'pet',
    desc: '瑞吉趴下，朝敵群肚皮滑行衝撞。',
    lv: ['', '滑行', '傷害提高', '冷卻縮短', '範圍變大', '傷害提高', '冷卻縮短', '範圍變大', '來回滑行'],
  },
  glutton: {
    name: '瑞吉・貪吃', icon: '🐟', max: 8, kind: 'pet',
    desc: '瑞吉會衝去吃小魚；吃飽後變胖變強，並打一個大嗝。',
    lv: ['', '吃魚範圍變大', '吃飽門檻降低', '吃飽更久', '吃魚範圍變大', '吃飽門檻降低', '吃魚回血', '吃飽更久', '吃飽時傷害加倍'],
  },
};

export const ENEMIES = {
  charger: { name: '尖嘯衝鋒獸', hp: 42, speed: 1.6, dmg: 10, r: 0.55, size: 1.4, fish: 2, from: 75, skin: 'bat', tint: [1.5, 0.65, 0.5] },
  fan: { name: '散音水母', hp: 38, speed: 1.1, dmg: 7, r: 0.5, size: 1.3, fish: 2, from: 145, skin: 'shooter', tint: [0.6, 1.3, 1.5] },
  mortar: { name: '落雷石偶', hp: 80, speed: 0.8, dmg: 11, r: 0.7, size: 1.7, fish: 4, from: 225, skin: 'golem', tint: [1.4, 0.6, 1.3] },
  splitter: { name: '裂音母體', hp: 64, speed: 1.4, dmg: 8, r: 0.65, size: 1.6, fish: 3, from: 300, skin: 'hum', tint: [0.6, 1.5, 0.7] },
  hum:     { name: '噪音團',   hp: 14,  speed: 1.7, dmg: 6,  r: 0.42, size: 1.0, fish: 1, from: 0 },
  bat:     { name: '噪音蝠',   hp: 9,   speed: 3.3, dmg: 5,  r: 0.34, size: 0.95, fish: 1, from: 50, wobble: true },
  golem:   { name: '巨噪石偶', hp: 100, speed: 1.05, dmg: 12, r: 0.8,  size: 1.9, fish: 4, from: 120 },
  shooter: { name: '鳴音射手', hp: 26,  speed: 1.3, dmg: 6,  r: 0.5,  size: 1.2, fish: 2, from: 170, ranged: true },
  boss:    { name: '失序者',   hp: 1800, speed: 1.15, dmg: 13, r: 1.7, size: 4.4, fish: 30, from: 1e9, boss: true },
};

export const BOSS_TIMES = [180, 360, 540];
export const SYNERGIES = [
  { name: '雷光共鳴', a: 'star', b: 'chain', desc: '星輝＋連鎖雷光各 Lv3：雷光多跳 2 次' },
  { name: '碎晶聖祷', a: 'litany', b: 'frost', desc: '聖祷＋冰晶祈願各 Lv3：光束對減速敵人傷害 +60%' },
  { name: '踏浪巡星', a: 'trail', b: 'slide', pet: true, desc: '巡星光痕＋瑞吉滑行各 Lv3：滑行留下 1.5 倍傷害光痕' },
];
export const WIN_TIME = 720;

export function xpNeed(level) {
  return Math.round(6 + level * 5 + level * level * 0.55);
}

/** 目前時間（秒）的敵人池與權重 */
export function spawnTable(t) {
  const list = [['hum', 10]];
  for (const k of ['charger', 'fan', 'mortar', 'splitter']) {
    if (t >= ENEMIES[k].from) list.push([k, 1.5 + Math.min(2, (t - ENEMIES[k].from) / 120)]);
  }
  if (t >= ENEMIES.bat.from) list.push(['bat', 4 + Math.min(6, (t - 50) / 40)]);
  if (t >= ENEMIES.golem.from) list.push(['golem', 1.2 + Math.min(3, (t - 120) / 120)]);
  if (t >= ENEMIES.shooter.from) list.push(['shooter', 1.6 + Math.min(3, (t - 170) / 120)]);
  return list;
}
