/**
 * 城市的純邏輯：哪棟房子放哪裡、人怎麼走、站在哪扇門前。
 * 沒有 DOM／canvas，可以直接用 node 測。座標單位是「邏輯像素」：畫面高度固定當 720。
 */

export const WORLD_H = 720;
export const GROUND_Y = 612; // 房子底邊
export const WALK_Y = 650; // 人站的位置（稍微在房子前面）
export const SPACING = 470; // 兩棟房子的中心距離
export const DISTRICT_GAP = 330; // 街區之間多留的空地
export const EDGE_PAD = 640; // 城市兩端的空地（放城門）
export const DOOR_RADIUS = 110;
export const WALK_SPEED = 205;
export const AUTO_SPEED = 420; // 切換遊戲時自動跑到門口的速度
export const BLEND_HALF = 280; // 兩個街區交界處風格漸變的半寬

// 每款已知遊戲的外觀；沒登記的遊戲（之後有人投稿）用 districtFor 的預設加上自動配色。
export const LOOKS = {
  slots: { art: 'slots', accent: '#ff3b5c', district: 'casino', sign: '拉霸' },
  blackjack: { art: 'blackjack', accent: '#22e08a', district: 'casino', sign: '21 點' },
  baccarat: { art: 'baccarat', accent: '#b66cff', district: 'casino', sign: '百家樂' },
  niuniu: { art: 'niuniu', accent: '#ff8a1f', district: 'casino', sign: '妞妞' },
  dragon: { art: 'dragon', accent: '#ffd23a', district: 'casino', sign: '射龍門' },
  'texas-holdem': { art: 'texas', accent: '#ff7a2f', district: 'casino', sign: '德州撲克' },
  'coin-flip': { art: 'coinflip', accent: '#ffc61a', district: 'casino', sign: '猜硬幣' },
  'lucky-wheel': { art: 'wheel', accent: '#ff4fd8', district: 'casino', sign: '幸運轉盤' },
  'pie-phoebe': { art: 'phoebe', accent: '#ff8fd0', district: 'phoebe', sign: '星光亂鬥' },
  'phoebe-egg': { art: 'egg', accent: '#ffb86b', district: 'phoebe', sign: '搬蛋大作戰' },
  'phoebe-peak': { art: 'peak', accent: '#5ee1ff', district: 'phoebe', sign: '攀登' },
  snake: { art: 'snake', accent: '#9dff3a', district: 'arcade', sign: '貪吃蛇' },
  'tic-tac-toe': { art: 'tictactoe', accent: '#4f9dff', district: 'arcade', sign: '井字棋' },
};

export const DISTRICTS = [
  { id: 'casino', name: '賭場街', color: '#ff3b5c' },
  { id: 'phoebe', name: '菲比廣場', color: '#ff8fd0' },
  { id: 'arcade', name: '電玩巷', color: '#ffd23a' },
];

const DISTRICT_ORDER = Object.fromEntries(DISTRICTS.map((d, i) => [d.id, i]));
const FALLBACK_ACCENTS = ['#35f0ff', '#ff4fd8', '#9dff3a', '#ffd23a', '#8f7bff', '#ff7a2f'];

function hashString(text) {
  let h = 2166136261;
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** 一款遊戲屬於哪個街區：登記過的照登記，沒登記的金幣遊戲進賭場、其餘進電玩巷。 */
export function districtFor(game) {
  const look = LOOKS[game.id];
  if (look) return look.district;
  if (game.kind === 'coin' || game.official) return 'casino';
  return 'arcade';
}

export function lookFor(game) {
  const known = LOOKS[game.id];
  const accent = known ? known.accent : FALLBACK_ACCENTS[hashString(game.id) % FALLBACK_ACCENTS.length];
  return {
    art: known ? known.art : null,
    accent,
    district: districtFor(game),
    sign: (known && known.sign) || game.name || game.id,
  };
}

/**
 * 把遊戲排成一條街。回傳 { buildings, gates, width }。
 * 排序：街區順序 → 登記順序（LOOKS 的順序）→ 其餘照原本順序。
 */
export function layoutCity(games) {
  const knownOrder = Object.keys(LOOKS);
  const decorated = games.map((game, index) => {
    const look = lookFor(game);
    const known = knownOrder.indexOf(game.id);
    return { game, look, index, known: known === -1 ? 999 : known };
  });
  decorated.sort((a, b) => (
    DISTRICT_ORDER[a.look.district] - DISTRICT_ORDER[b.look.district]
    || a.known - b.known
    || a.index - b.index
  ));

  const buildings = [];
  const gates = [];
  let x = EDGE_PAD;
  let lastDistrict = null;
  for (const item of decorated) {
    if (lastDistrict !== null && item.look.district !== lastDistrict) x += DISTRICT_GAP;
    if (item.look.district !== lastDistrict) {
      const info = DISTRICTS.find((d) => d.id === item.look.district);
      // 城門立在兩個街區之間的空地正中央（兩側房子各留約 400 的位置）。
      gates.push({ district: info, x: x - (SPACING + DISTRICT_GAP) / 2 });
    }
    lastDistrict = item.look.district;
    buildings.push({
      id: item.game.id,
      game: item.game,
      look: item.look,
      doorX: x,
      index: buildings.length,
    });
    x += SPACING;
  }
  const width = Math.max(x - SPACING + EDGE_PAD, 2400);
  return { buildings, gates, width };
}

/** 站在 x 時最近的一扇門（距離在 DOOR_RADIUS 內才算），沒有就是 null。 */
export function doorAt(buildings, x, radius = DOOR_RADIUS) {
  let best = null;
  let bestDist = radius;
  for (const b of buildings) {
    const d = Math.abs(b.doorX - x);
    if (d <= bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** 每次操作從已選定的目標切換一棟；途中連按也不會重複選到同一棟。 */
export function selectAdjacentGame(state, buildings, direction) {
  if (!buildings.length || ![-1, 1].includes(direction)) return null;
  const anchor = state.target ?? state.x;
  let index = 0;
  for (let i = 1; i < buildings.length; i += 1) {
    if (Math.abs(buildings[i].doorX - anchor) < Math.abs(buildings[index].doorX - anchor)) index = i;
  }
  const next = buildings[clamp(index + direction, 0, buildings.length - 1)];
  state.target = next.doorX;
  state.autoRun = true;
  // 反向切換時先停下，避免沿舊方向滑行。
  if (Math.sign(state.vx) !== Math.sign(state.target - state.x)) state.vx = 0;
  state.runSpeed = null;
  return next;
}

/**
 * 從導覽列點某款遊戲：整條街快速奔跑過去，鏡頭跟著人平移。
 * 距離越遠跑越快，但全程控制在約 RUN_MAX_SECONDS 秒內。
 */
export const RUN_MAX_SECONDS = 1.8;
export const RUN_MAX_SPEED = 2600;
export function runToGame(state, building) {
  if (!building) return null;
  const gap = building.doorX - state.x;
  if (Math.abs(gap) < 6) return building;
  state.target = building.doorX;
  state.autoRun = true;
  state.runSpeed = clamp(Math.abs(gap) / RUN_MAX_SECONDS, AUTO_SPEED, RUN_MAX_SPEED);
  if (Math.sign(state.vx) !== Math.sign(gap)) state.vx = 0;
  return building;
}

/**
 * 人往前走一步。state: { x, vx, facing, target }；input: { dir: -1|0|1 }。
 * 只有按住方向鍵才會走，放開就停（點一下只動一小步）。
 * 有 target（點地圖或點房子）而且沒有按方向鍵時自動走過去，到了就清掉。
 * 回傳 state（原地修改），多一個 moving 欄位。
 */
export function stepPlayer(state, input, dt, worldWidth) {
  const margin = 120;
  let dir = input.dir;
  let top = WALK_SPEED;
  if (dir !== 0) {
    state.target = null; state.runSpeed = null;
    state.autoRun = false;
    // 剛按下去先給一點初速，輕點一下也看得到腳步。
    if (state.vx === 0 || Math.sign(state.vx) !== dir) state.vx = dir * Math.min(top, 60);
  } else if (state.target != null) {
    const gap = state.target - state.x;
    if (Math.abs(gap) < 6) {
      state.x = state.target;
      state.vx = 0;
      state.target = null; state.runSpeed = null;
      state.autoRun = false;
      state.moving = false;
      return state;
    }
    dir = Math.sign(gap);
    top = state.runSpeed || AUTO_SPEED;
  }
  const want = dir * top;
  // 加速快、煞車更快：放開按鍵立刻停下，不會滑到下一棟。
  const rate = dir === 0 ? 4800 : Math.max(1500, top * 4);
  const delta = want - state.vx;
  const stepV = rate * dt;
  state.vx = Math.abs(delta) <= stepV ? want : state.vx + Math.sign(delta) * stepV;
  if (state.target != null) {
    // 不要衝過頭：離目標很近時直接收斂。
    const gap = state.target - state.x;
    const move = state.vx * dt;
    if (Math.sign(gap) === Math.sign(move) && Math.abs(move) >= Math.abs(gap)) {
      state.x = state.target;
      state.vx = 0;
      state.target = null; state.runSpeed = null;
      state.autoRun = false;
    } else {
      state.x += move;
    }
  } else {
    state.x += state.vx * dt;
  }
  state.x = clamp(state.x, margin, worldWidth - margin);
  if (state.x === margin || state.x === worldWidth - margin) state.vx = 0;
  if (Math.abs(state.vx) > 8) state.facing = Math.sign(state.vx);
  state.moving = Math.abs(state.vx) > 8;
  return state;
}

/**
 * 站在 x 時畫面風格該是哪個街區：{ a, b, t }。
 * 兩個街區交界（城門）前後各 BLEND_HALF 之內，a 淡出、b（下一個街區或上一個）淡入，t 是 b 的比例。
 */
export function themeAt(gates, x) {
  if (!gates.length) return { a: 'casino', b: null, t: 0 };
  let index = 0;
  for (let i = 1; i < gates.length; i += 1) if (x >= gates[i].x) index = i;
  const here = gates[index].district.id;
  const smooth = (v) => v * v * (3 - 2 * v);
  const next = gates[index + 1];
  if (next && x > next.x - BLEND_HALF) {
    return { a: here, b: next.district.id, t: smooth(clamp((x - (next.x - BLEND_HALF)) / (BLEND_HALF * 2), 0, 1)) };
  }
  if (index > 0 && x < gates[index].x + BLEND_HALF) {
    const t = smooth(clamp((x - (gates[index].x - BLEND_HALF)) / (BLEND_HALF * 2), 0, 1));
    return { a: gates[index - 1].district.id, b: here, t };
  }
  return { a: here, b: null, t: 0 };
}

/** 鏡頭：人盡量留在畫面中間偏前進方向，兩端不露出世界外。 */
export function cameraFor(playerX, facing, viewW, worldWidth) {
  const lead = facing * viewW * 0.08;
  return clamp(playerX + lead - viewW / 2, 0, Math.max(0, worldWidth - viewW));
}
