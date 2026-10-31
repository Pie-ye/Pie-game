// 派派大作戰：前端用的常數與純函式。規則在伺服器（server/games/arena.py），這裡的數字必須和那邊一致（測試會比對）。
export const ARENA = {
  field: [64, 48, 416, 240],     // x0, y0, x1, y1
  cell: 32,
  cols: 11,
  rows: 6,
  desk: [176, 262],
  deskReach: 28,
  inset: 6,
  dailyPaid: 8,
  minPlayers: 4,
  maxPlayers: 8,
  gold: [60, 40, 25],
  goldRest: 10,
};

export const ROUNDS = {
  coin: { name: '金幣雨', icon: '🪙', how: '撿金幣！碰到就算，金色派餅 5 分。', color: '#f5c542' },
  pie: { name: '派餅大戰', icon: '🥧', how: '空白鍵或點畫面丟派。打中 +1，被打中會暈一下。', color: '#f08a5d' },
  floor: { name: '落地板', icon: '🕳️', how: '地板閃紅就快跑！掉下去就出局，撐到最後的人贏。', color: '#7ec4cf' },
  quiz: { name: '派派問答', icon: '❓', how: '走到答案的色塊上！揭曉時站錯的地方會塌，答對 +1。', color: '#b48ef0' },
};

export const QUAD = { labels: ['A', 'B', 'C', 'D'], colors: ['rgba(229,115,115,.42)', 'rgba(100,181,246,.42)', 'rgba(129,199,132,.42)', 'rgba(255,213,79,.48)'] };

/** 格子屬於哪一區：0=A 左上、1=B 右上、2=C 左下、3=D 右下；中間一欄是分隔線（-1）。和伺服器 arena.quadrant 一致。 */
export function quadrant(i) {
  const c = i % ARENA.cols, r = Math.floor(i / ARENA.cols), mid = Math.floor(ARENA.cols / 2);
  if (c === mid) return -1;
  return (r >= Math.floor(ARENA.rows / 2) ? 2 : 0) + (c > mid ? 1 : 0);
}

/** 一區的中心（原生像素）。 */
export function quadrantCenter(q) {
  const [x0, y0] = ARENA.field, mid = Math.floor(ARENA.cols / 2), hr = Math.floor(ARENA.rows / 2);
  const cx = q % 2 ? x0 + (mid + 1 + (ARENA.cols - mid - 1) / 2) * ARENA.cell : x0 + (mid / 2) * ARENA.cell;
  const cy = q >= 2 ? y0 + (hr + (ARENA.rows - hr) / 2) * ARENA.cell : y0 + (hr / 2) * ARENA.cell;
  return [cx, cy];
}

export const PHASE_TEXT = { idle: '等待報名', queue: '報名中', intro: '準備', live: '比賽中', result: '回合結算', final: '頒獎' };

/** 腳底在場內（含內縮）。 */
export function inField(x, y, inset = ARENA.inset) {
  const [x0, y0, x1, y1] = ARENA.field;
  return x >= x0 + inset && x <= x1 - inset && y >= y0 + inset + 4 && y <= y1 - 2;
}

/** 場地的矩形碰撞（不參賽的人進不去）。 */
export function fieldRect() {
  const [x0, y0, x1, y1] = ARENA.field;
  return { x0: x0 - 2, y0: y0 - 2, x1: x1 + 2, y1: y1 + 6 };
}

export function cellOf(x, y) {
  const [x0, y0] = ARENA.field;
  const c = Math.max(0, Math.min(ARENA.cols - 1, Math.floor((x - x0) / ARENA.cell)));
  const r = Math.max(0, Math.min(ARENA.rows - 1, Math.floor((y - y0) / ARENA.cell)));
  return r * ARENA.cols + c;
}

export const nearDesk = (x, y) => Math.hypot(x - ARENA.desk[0], y - ARENA.desk[1]) <= ARENA.deskReach;

/** 伺服器 P 陣列一列 → 物件。 */
export function unpackPlayer(row) {
  const [id, name, x, y, dir, flags, score, total, ammo, look, gain] = row;
  return {
    id: String(id), name: String(name || ''), x: +x || 0, y: +y || 0, dir: dir | 0, score: score | 0, total: total | 0, ammo: ammo | 0,
    bot: !!(flags & 1), stunned: !!(flags & 2), out: !!(flags & 4), gone: !!(flags & 8), shield: !!(flags & 16),
    sprite: typeof look === 'string' ? look : null, look: Array.isArray(look) ? look : null, gain: gain | 0,
  };
}

/** 名次（同分同名次），回傳 [{ ...p, rank }]，依總分排序。 */
export function standings(players, key = 'total') {
  const list = [...players].sort((a, b) => b[key] - a[key]);
  let prev = null, rank = 0;
  return list.map((p, i) => { if (p[key] !== prev) { rank = i + 1; prev = p[key]; } return { ...p, rank }; });
}

export const goldFor = (rank) => (rank - 1 < ARENA.gold.length ? ARENA.gold[rank - 1] : ARENA.goldRest);

/** 剩餘秒數（伺服器時間）。 */
export const secondsLeft = (snap, serverNow) => Math.max(0, Math.ceil(((snap && snap.end) - serverNow) / 1000));

/** 朝向 → 丟派方向；有按方向鍵時用按鍵（可斜向）。 */
export function throwDir(dir, dx = 0, dy = 0) {
  if (dx || dy) { const n = Math.hypot(dx, dy); return [dx / n, dy / n]; }
  return [[0, 1], [0, -1], [-1, 0], [1, 0]][dir | 0];
}
