// 技能、被動、敵人、頭目的設定。
// 菲比的設計依據（鳴潮）：衍射（Spectro）共鳴者；招牌是疊加「光噪效應」，
// 以及用「祈願」在「赦罪（輸出）」與「告解（輔助）」之間切換。技能名稱與效果是本遊戲的改編，不是原作數值。
// 瑞吉的設計依據：網路上的海獅「瑞吉」——愛吃小魚、胖嘟嘟、愛張大嘴巴大叫。
import { skillSummary, petSummary } from './skills.js';

export const WEAPONS = {
  chain: {
    name: '折射聖輝', icon: '◇', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '清群／衍射：聖光經鏡片折射，跳向不同敵人並疊 1 層光噪。由原作鏡環折射延伸。',
    lv: ['', '跳躍 3 個目標', '傷害提高', '+1 目標', '冷卻縮短', '+1 目標', '傷害提高', '+1 目標', '傷害與跳躍距離提高'],
  },
  frost: {
    name: '鏡光停滯', icon: '❖', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '控場／衍射：鏡晶使敵群停滯 0.8 秒、減速 60%、易傷 20%，並疊 2 層光噪。頭目只減速 20%；由原作停滯延伸。',
    lv: ['', '冰晶爆發', '傷害提高', '範圍提高', '冷卻縮短', '範圍提高', '傷害提高', '範圍提高', '減速延長'],
  },
  trail: {
    name: '巡星光痕', icon: '⋆', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '走位／衍射：移動鋪設光印，追兵踏入會持續受傷並疊光噪。重疊不加倍；本作延伸技能。',
    lv: ['', '移動留下光痕', '傷害提高', '範圍提高', '持續時間提高', '傷害提高', '範圍提高', '持續時間提高', '傷害大幅提高'],
  },
  star: {
    name: '聖光三連', icon: '✦', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '持續輸出：追蹤聖光疊 1 層光噪，每第三輪傷害 ×1.5。站入鏡環變為夏彌爾之星，傷害再 +35%；穿透後保留 65% 傷害。',
    lv: ['', '1 顆星輝', '+1 顆', '傷害提高', '+1 顆', '穿透 1 次', '+1 顆', '傷害大幅提高', '+1 顆、穿透 2 次'],
  },
  ring: {
    name: '鏡之環', icon: '◎', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '聚怪／防守：在敵人處召喚持續 5 秒的鏡環，停滯、牽引並攔截邊緣子彈。普攻命中環內目標會折射 35% 範圍傷害，間隔 0.5 秒。',
    lv: ['', '1 個鏡環', '範圍變大', '+1 個鏡環', '傷害提高', '轉速提高', '+1 個鏡環', '範圍變大', '+1 個鏡環、傷害提高'],
  },
  litany: {
    name: '重擊・星輝', icon: '✧', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '破王：貫穿光束接落地星柱，每層光噪使本次重擊 +4%。赦罪時對光噪目標再 +40%；告解時疊 6 層。',
    lv: ['', '1 道光束', '傷害提高', '冷卻縮短', '+1 道光束', '光束變寬', '冷卻縮短', '+1 道光束', '傷害大幅提高'],
  },
  field: {
    name: '默禱領域', icon: '◌', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '疊層：隨身法陣持續疊 1 層光噪並減速 30%（Lv4 起 45%）。告解時範圍 +30%；由原作默禱效果延伸。',
    lv: ['', '小範圍領域', '範圍變大', '傷害提高', '減速加強', '範圍變大', '傷害提高', '範圍變大', '傷害大幅提高'],
  },
  echo: {
    name: '告解迴響', icon: '☉', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '解圍：擴散光環擊退、疊 2 層光噪並清除沿途子彈。可搭配默禱引爆高光噪目標；本作延伸技能。',
    lv: ['', '迴響', '範圍變大', '冷卻縮短', '傷害提高', '範圍變大', '冷卻縮短', '傷害提高', '雙重迴響'],
  },
  rain: {
    name: '啟明之鏡', icon: '☀', max: 8, kind: 'phoebe', owner: 'phoebe',
    desc: '爆發：凝聚啟明之鏡、砸碎造成大範圍傷害並清彈。赦罪傷害 +50%；告解疊 9 層光噪。依原作共鳴解放改編。',
    lv: ['', '1 顆星屑', '傷害提高', '+1 顆', '爆炸變大', '+1 顆', '傷害提高', '+1 顆', '冷卻縮短'],
  },
  // ── 弗洛洛（湮滅，參考鳴潮：彼岸花、轉生、不穩定音符、緋紅終章、赫卡忒）。名稱與數值是本遊戲的改編。 ──
  scythe: {
    name: '彼岸斬', icon: '☾', max: 8, kind: 'phoebe', owner: 'phrolova',
    desc: '持續輸出／近身：朝最近的敵人揮出彼岸花鐮弧斬，命中範圍內所有敵人並疊 1 層湮滅侵蝕，每次命中產生 1 個不穩定音符。Lv4 追加反手斬，Lv7 追加第三斬。',
    lv: [],
  },
  dream: {
    name: '轉生之夢', icon: '❀', max: 8, kind: 'phoebe', owner: 'phrolova',
    desc: '控場／產音：在敵群處綻放彼岸花，凝滯 0.9 秒並減速，疊 2 層湮滅侵蝕，產生 2 個不穩定音符。由原作共鳴技轉生延伸。',
    lv: [],
  },
  coda: {
    name: '緋紅終章', icon: '♪', max: 8, kind: 'phoebe', owner: 'phrolova',
    desc: '爆發：累積 6 個不穩定音符時自動施放，把周圍敵人牽引到中心後重擊並疊 3 層侵蝕。由原作重擊「緋紅終章」改編。',
    lv: [],
  },
  lily: {
    name: '彼岸花環', icon: '✿', max: 8, kind: 'phoebe', owner: 'phrolova',
    desc: '護身／疊層：數片彼岸花瓣繞身旋轉，持續切割靠近的敵人並疊侵蝕。',
    lv: [],
  },
};

for (const [key, weapon] of Object.entries(WEAPONS)) {
  weapon.lv = ['', ...Array.from({ length: weapon.max }, (_, i) => skillSummary(key, i + 1))];
}

export const CHARACTERS = {
  phoebe: {
    id: 'phoebe', name: '菲比啾比', sprite: 'phoebe', start: 'star', hp: 100, element: '衍射', color: '#ffd966',
    blurb: '衍射｜光噪疊層、祈願二選一（赦罪／告解）',
    kit: '攻守均衡：鏡之環聚怪、聖光折射、星輝重擊。祈願滿後按 Q 赦罪或 E 告解。',
  },
  phrolova: {
    id: 'phrolova', name: '弗洛洛', sprite: 'phrolova', start: 'scythe', hp: 120, element: '湮滅', color: '#ff5470',
    blurb: '湮滅｜彼岸花鐮斬、不穩定音符、赫卡忒樂章',
    kit: '近身高輸出、生命 120：彼岸斬命中會回血，與轉生之夢累積 6 個音符，自動施放緋紅終章。樂章充滿按 Q 召喚赫卡忒 15 秒。',
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
    desc: '控場：瑞吉張大嘴巴大叫，震退並暈眩周圍的敵人。傷害低，重點是把敵人推開。',
    lv: [],
  },
  slide: {
    name: '瑞吉・環繞滑行', icon: '🌊', max: 8, kind: 'pet',
    desc: '清場：瑞吉趴下，繞著你滑一圈撞擊沿途敵人，結束後回到你身邊。Lv8 繞兩圈。',
    lv: [],
  },
};
for (const [key, pet] of Object.entries(PET)) pet.lv = ['', ...Array.from({ length: pet.max }, (_, i) => petSummary(key, i + 1))];

export const ENEMIES = {
  charger: { name: '尖嘯衝鋒獸', hp: 42, speed: 1.6, dmg: 10, r: 0.55, size: 1.4, fish: 2, from: 75, skin: 'bat', tint: [1.5, 0.65, 0.5] },
  fan: { name: '散音水母', hp: 38, speed: 1.1, dmg: 7, r: 0.5, size: 1.3, fish: 2, from: 145, skin: 'shooter', tint: [0.6, 1.3, 1.5] },
  mortar: { name: '落雷石偶', hp: 80, speed: 0.8, dmg: 11, r: 0.7, size: 1.7, fish: 4, from: 225, skin: 'golem', tint: [1.4, 0.6, 1.3] },
  splitter: { name: '裂音母體', hp: 64, speed: 1.4, dmg: 8, r: 0.65, size: 1.6, fish: 3, from: 300, skin: 'hum', tint: [0.6, 1.5, 0.7] },
  hum:     { name: '噪音團',   hp: 14,  speed: 1.7, dmg: 6,  r: 0.42, size: 1.0, fish: 1, from: 0 },
  bat:     { name: '噪音蝠',   hp: 9,   speed: 3.3, dmg: 5,  r: 0.34, size: 0.95, fish: 1, from: 50, wobble: true },
  golem:   { name: '巨噪石偶', hp: 100, speed: 1.05, dmg: 12, r: 0.8,  size: 1.9, fish: 4, from: 120 },
  shooter: { name: '鳴音射手', hp: 26,  speed: 1.3, dmg: 6,  r: 0.5,  size: 1.2, fish: 2, from: 170, ranged: true },
  // v1.4 頭目：每隻都有自己的圖與機制（見 bosses.js）。hp 是基準值，實際血量再乘時間成長。
  vanguard:   { name: '破陣者',   hp: 5400,  speed: 1.25, dmg: 13, r: 1.5, size: 4.4, fish: 30, from: 1e9, boss: true, skin: 'vanguard' },
  weaver:     { name: '織音者',   hp: 7200,  speed: 0.9,  dmg: 12, r: 1.4, size: 4.2, fish: 30, from: 1e9, boss: true, skin: 'weaver' },
  conductor:  { name: '終曲指揮', hp: 14000,  speed: 1.0,  dmg: 14, r: 1.5, size: 4.8, fish: 30, from: 1e9, boss: true, skin: 'conductor' },
  crab:       { name: '潮鳴蟹將', hp: 3200,  speed: 1.2,  dmg: 11, r: 1.4, size: 3.6, fish: 18, from: 1e9, boss: true, elite: true, skin: 'crab' },
  lighthouse: { name: '迴光燈塔', hp: 4800,  speed: 0.5,  dmg: 12, r: 1.3, size: 4.6, fish: 18, from: 1e9, boss: true, elite: true, skin: 'lighthouse' },
  hive:       { name: '噪潮母巢', hp: 7200,  speed: 0.6,  dmg: 12, r: 1.6, size: 4.0, fish: 18, from: 1e9, boss: true, elite: true, skin: 'hive' },
  pillar:     { name: '共鳴柱',   hp: 60,    speed: 0,    dmg: 0,  r: 0.7, size: 2.3, fish: 0, from: 1e9, prop: true, skin: 'obelisk' },
  egg:        { name: '噪卵',     hp: 40,    speed: 0,    dmg: 0,  r: 0.5, size: 1.4, fish: 0, from: 1e9, prop: true, skin: 'egg' },
};

/** 頭目時間表：main＝主線頭目（擊敗三隻且撐滿 12 分鐘才算勝利），其餘是精英頭目（掉寶箱，不影響勝利）。 */
export const BOSS_SCHEDULE = [
  { id: 'crab', at: 100 },
  { id: 'vanguard', at: 180, main: true },
  { id: 'lighthouse', at: 280 },
  { id: 'weaver', at: 360, main: true },
  { id: 'hive', at: 460 },
  { id: 'conductor', at: 540, main: true },
];
/** 無盡模式：每 150 秒從全部六隻輪流出場，之後每輪多一隻同時出場。 */
export const ENDLESS_ORDER = ['crab', 'vanguard', 'lighthouse', 'weaver', 'hive', 'conductor'];
// v1.4：連攜門檻由雙方 Lv3 降到 Lv2，觸發時有畫面與文字提示，升級卡會優先補齊缺的另一半。
export const SYN_LV = 2;
export const SYNERGIES = [
  { id: 'refract', name: '聖輝折射', a: 'star', b: 'chain', desc: '折射聖輝額外跳 2 個目標，額外目標傷害 +25%，金色光線標示' },
  { id: 'shatter', name: '停滯星輝', a: 'litany', b: 'frost', desc: '重擊星輝命中被減速的敵人時碎裂，傷害 +60% 並顯示「碎！」' },
  { id: 'tide', name: '踏浪巡星', a: 'trail', b: 'slide', pet: true, desc: '瑞吉環繞滑行時留下 2 倍傷害的青色光痕' },
  { id: 'mirrorstar', name: '鏡映星輝', a: 'ring', b: 'litany', desc: '召喚鏡環時落下範圍星柱，傷害為重擊的 100%' },
  { id: 'echoboom', name: '默禱迴響', a: 'field', b: 'echo', desc: '迴響命中 3 層以上光噪的敵人時引爆：傷害 +80%，並消耗 3 層光噪' },
  { id: 'dreamcut', name: '夢中斬', a: 'scythe', b: 'dream', char: 'phrolova', desc: '彼岸斬砍中被凝滯的敵人時傷害 +60%，並顯示「斬！」' },
  { id: 'finale', name: '花海終章', a: 'coda', b: 'lily', char: 'phrolova', desc: '緋紅終章引爆 3 層以上侵蝕的敵人：傷害 +70%，消耗 3 層，並在原地綻放花瓣爆發' },
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
