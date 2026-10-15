// 技能、被動、敵人、頭目的設定。
// 菲比的設計依據（鳴潮）：衍射（Spectro）共鳴者；招牌是疊加「光噪效應」，
// 以及用「祈願」在「赦罪（輸出）」與「告解（輔助）」之間切換。技能名稱與效果是本遊戲的改編，不是原作數值。
// 瑞吉的設計依據：網路上的海獅「瑞吉」——愛吃小魚、胖嘟嘟、愛張大嘴巴大叫。
import { skillSummary } from './skills.js';

export const WEAPONS = {
  chain: {
    name: '折射聖輝', icon: '◇', max: 8, kind: 'phoebe',
    desc: '清群／衍射：聖光經鏡片折射，跳向不同敵人並疊 1 層光噪。由原作鏡環折射延伸。',
    lv: ['', '跳躍 3 個目標', '傷害提高', '+1 目標', '冷卻縮短', '+1 目標', '傷害提高', '+1 目標', '傷害與跳躍距離提高'],
  },
  frost: {
    name: '鏡光停滯', icon: '❖', max: 8, kind: 'phoebe',
    desc: '控場／衍射：鏡晶使敵群停滯 0.8 秒、減速 60%、易傷 20%，並疊 2 層光噪。頭目只減速 20%；由原作停滯延伸。',
    lv: ['', '冰晶爆發', '傷害提高', '範圍提高', '冷卻縮短', '範圍提高', '傷害提高', '範圍提高', '減速延長'],
  },
  trail: {
    name: '巡星光痕', icon: '⋆', max: 8, kind: 'phoebe',
    desc: '走位／衍射：移動鋪設光印，追兵踏入會持續受傷並疊光噪。重疊不加倍；本作延伸技能。',
    lv: ['', '移動留下光痕', '傷害提高', '範圍提高', '持續時間提高', '傷害提高', '範圍提高', '持續時間提高', '傷害大幅提高'],
  },
  star: {
    name: '聖光三連', icon: '✦', max: 8, kind: 'phoebe',
    desc: '持續輸出：追蹤聖光疊 1 層光噪，每第三輪傷害 ×1.5。站入鏡環變為夏彌爾之星，傷害再 +35%；穿透後保留 65% 傷害。',
    lv: ['', '1 顆星輝', '+1 顆', '傷害提高', '+1 顆', '穿透 1 次', '+1 顆', '傷害大幅提高', '+1 顆、穿透 2 次'],
  },
  ring: {
    name: '鏡之環', icon: '◎', max: 8, kind: 'phoebe',
    desc: '聚怪／防守：在敵人處召喚持續 5 秒的鏡環，停滯、牽引並攔截邊緣子彈。普攻命中環內目標會折射 35% 範圍傷害，間隔 0.5 秒。',
    lv: ['', '1 個鏡環', '範圍變大', '+1 個鏡環', '傷害提高', '轉速提高', '+1 個鏡環', '範圍變大', '+1 個鏡環、傷害提高'],
  },
  litany: {
    name: '重擊・星輝', icon: '✧', max: 8, kind: 'phoebe',
    desc: '破王：貫穿光束接落地星柱，每層光噪使本次重擊 +4%。赦罪時對光噪目標再 +40%；告解時疊 6 層。',
    lv: ['', '1 道光束', '傷害提高', '冷卻縮短', '+1 道光束', '光束變寬', '冷卻縮短', '+1 道光束', '傷害大幅提高'],
  },
  field: {
    name: '默禱領域', icon: '◌', max: 8, kind: 'phoebe',
    desc: '疊層：隨身法陣持續疊 1 層光噪並減速 30%（Lv4 起 45%）。告解時範圍 +30%；由原作默禱效果延伸。',
    lv: ['', '小範圍領域', '範圍變大', '傷害提高', '減速加強', '範圍變大', '傷害提高', '範圍變大', '傷害大幅提高'],
  },
  echo: {
    name: '告解迴響', icon: '☉', max: 8, kind: 'phoebe',
    desc: '解圍：擴散光環擊退、疊 2 層光噪並清除沿途子彈。可搭配默禱引爆高光噪目標；本作延伸技能。',
    lv: ['', '迴響', '範圍變大', '冷卻縮短', '傷害提高', '範圍變大', '冷卻縮短', '傷害提高', '雙重迴響'],
  },
  rain: {
    name: '啟明之鏡', icon: '☀', max: 8, kind: 'phoebe',
    desc: '爆發：凝聚啟明之鏡、砸碎造成大範圍傷害並清彈。赦罪傷害 +50%；告解疊 9 層光噪。依原作共鳴解放改編。',
    lv: ['', '1 顆星屑', '傷害提高', '+1 顆', '爆炸變大', '+1 顆', '傷害提高', '+1 顆', '冷卻縮短'],
  },
};

for (const [key, weapon] of Object.entries(WEAPONS)) {
  weapon.lv = ['', ...Array.from({ length: weapon.max }, (_, i) => skillSummary(key, i + 1))];
}

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
  { name: '聖輝折射', a: 'star', b: 'chain', desc: '聖光三連＋折射聖輝各 Lv3：額外折射 2 個目標' },
  { name: '停滯星輝', a: 'litany', b: 'frost', desc: '重擊星輝＋鏡光停滯各 Lv3：光束對減速敵人傷害 +40%' },
  { name: '踏浪巡星', a: 'trail', b: 'slide', pet: true, desc: '巡星光痕＋瑞吉滑行各 Lv3：滑行留下 1.5 倍傷害光痕' },
  { name: '鏡映星輝', a: 'ring', b: 'litany', desc: '鏡之環＋重擊星輝各 Lv3：召鏡時追加 60% 重擊基礎傷害的範圍星柱' },
  { name: '默禱迴響', a: 'field', b: 'echo', desc: '默禱領域＋告解迴響各 Lv3：迴響對 4 層以上光噪目標傷害 +50%' },
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
