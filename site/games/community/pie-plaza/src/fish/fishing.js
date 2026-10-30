// 釣魚（純函式）：魚種表、依地點與時間抽魚、星露谷式的釣魚小遊戲物理。
// 小遊戲：一條直槽，魚在裡面上下亂竄；按住讓綠色捕捉條往上、放開往下掉。
// 魚在捕捉條裡進度上升，跑出去就下降；進度滿就釣到，歸零就跑掉。

// where：sea（廣場四周的海）、pond（農場池塘）；hours：出現時段（台北時間，含頭不含尾，可跨午夜）
export const FISH = [
  { id: 'sardine', name: '沙丁魚', where: ['sea'], price: 30, diff: 1, w: 30 },
  { id: 'tuna', name: '鮪魚', where: ['sea'], price: 120, diff: 3.5, w: 8 },
  { id: 'puffer', name: '河豚', where: ['sea'], price: 160, diff: 4, w: 4, hours: [12, 17] },
  { id: 'carp', name: '鯉魚', where: ['pond'], price: 35, diff: 1, w: 30 },
  { id: 'bass', name: '鱸魚', where: ['pond', 'sea'], price: 60, diff: 2, w: 16 },
  { id: 'catfish', name: '鯰魚', where: ['pond'], price: 90, diff: 3, w: 8, hours: [18, 6] },
  { id: 'trout', name: '虹鱒', where: ['pond'], price: 75, diff: 2.5, w: 10, hours: [6, 18] },
  { id: 'golden', name: '金色鯉魚', where: ['pond', 'sea'], price: 500, diff: 5, w: 0, contest: 3 },
  { id: 'boot', name: '舊靴子', where: ['pond', 'sea'], price: 0, diff: 0, w: 6, junk: true },
];
export const FISH_PRICES = Object.fromEntries(FISH.filter((f) => f.price).map((f) => [`fish_${f.id}`, f.price]));
export const fishName = (id) => (FISH.find((f) => f.id === id) || {}).name || id;
const inHours = (h, [a, b]) => (a <= b ? h >= a && h < b : h >= a || h < b);

/** 依地點、時間、是否在釣魚大賽抽一條魚。rand 可注入。 */
export function rollFish(where, hour, contest, rand = Math.random) {
  const pool = FISH.filter((f) => f.where.includes(where) && (!f.hours || inHours(hour, f.hours)))
    .map((f) => ({ f, w: f.w + (contest && f.contest ? f.contest : 0) }))
    .filter((x) => x.w > 0);
  let r = rand() * pool.reduce((a, x) => a + x.w, 0);
  for (const x of pool) { r -= x.w; if (r <= 0) return x.f; }
  return pool[pool.length - 1].f;
}

/** 魚的大小（公分），難度越高越大。 */
export const fishSize = (f, rand = Math.random) => (f.junk ? 0 : Math.round(12 + f.diff * 9 + rand() * (10 + f.diff * 8)));

export function newMinigame(fish) {
  const d = Math.max(0.5, fish.diff);
  return { fish: 0.5, fishV: 0, goal: 0.5, nextGoal: 0, bar: 0.2, barV: 0, size: Math.max(0.16, 0.3 - d * 0.025), progress: 0.3, diff: d, t: 0, done: null };
}

/** 前進 dt 秒；holding 是否按住。回傳同一個物件（done = 'caught' | 'escaped'）。 */
export function stepMinigame(g, dt, holding, rand = Math.random) {
  if (g.done) return g;
  g.t += dt;
  // 魚：每隔一段時間換目標，難度越高換得越勤、跳得越遠
  if (g.t >= g.nextGoal) {
    g.goal = Math.min(0.97, Math.max(0.03, g.fish + (rand() - 0.5) * (0.3 + g.diff * 0.14)));
    g.nextGoal = g.t + 1.2 - Math.min(0.9, g.diff * 0.16) + rand() * 0.6;
  }
  g.fishV += (g.goal - g.fish) * (3 + g.diff * 1.6) * dt;
  g.fishV *= Math.pow(0.12, dt);
  g.fish = Math.min(1, Math.max(0, g.fish + g.fishV * dt));
  // 捕捉條：按住往上（數值變大），放開受重力往下，碰底反彈一點
  g.barV += (holding ? 2.6 : -2.2) * dt;
  g.barV *= Math.pow(0.5, dt);
  g.bar += g.barV * dt;
  if (g.bar < 0) { g.bar = 0; g.barV = Math.abs(g.barV) * 0.3; }
  if (g.bar > 1 - g.size) { g.bar = 1 - g.size; g.barV = 0; }
  const inside = g.fish >= g.bar && g.fish <= g.bar + g.size;
  g.progress += (inside ? 0.34 : -0.2 - g.diff * 0.02) * dt;
  if (g.progress >= 1) { g.progress = 1; g.done = 'caught'; }
  if (g.progress <= 0) { g.progress = 0; g.done = 'escaped'; }
  return g;
}
