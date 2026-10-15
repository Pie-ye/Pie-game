// 頭目戰模擬：機器人（會躲預警）帶一組隨時間成長的配置，打各隻頭目，量擊敗時間、承受傷害與死亡次數。
// 用法：node tools/pie-phoebe/boss-sim.mjs [--seeds 5] [--cap 150] [--boss crab,vanguard] [--mobs 0.4] [--solo] [--noboss]
// --mobs 是一般雜兵出生速度倍率（機器人遠不如真人會處理雜兵，0.4 約相當於中等玩家的壓力）；--solo 完全沒有雜兵。
// 配置依頭目出場時間決定：技能等級 ≈ t/90（整局模擬顯示 180 秒時技能平均約 Lv2），玩家等級 ≈ 1 + t/18。
globalThis.localStorage = { getItem: () => null, setItem() {} };
let rng = () => 0.5;
Math.random = () => rng();
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const { Game } = await import('../../site/games/community/pie-phoebe/src/game.js');
const { WEAPONS, BOSS_SCHEDULE, ENEMIES } = await import('../../site/games/community/pie-phoebe/src/data.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const SEEDS = Number(opt('--seeds', 5)); const CAP = Number(opt('--cap', 150));
const ONLY = opt('--boss', null)?.split(',');
const BUILDS = [['star', 'litany', 'rain', 'chain', 'field'], ['ring', 'frost', 'trail', 'echo', 'star'], ['star', 'chain', 'ring', 'litany', 'frost']];

function run(entry, buildIdx, seed) {
  rng = mulberry32(seed * 9973 + buildIdx * 31 + 7);
  const g = Object.create(Game.prototype);
  g.ui = { setSlots() {}, banner() {}, end() {}, hideScreen() {}, showHud() {}, levelup() {} };
  g.camPos = {}; g.grid = new Map(); g.input = { x: 0, z: 0 }; g.clock = 0;
  g.newRun(); g.mode = 'play'; g.bossIdx = 99; g.swarmIdx = 99; g.bot = true;
  const mobs = Number(opt('--mobs', 1)); const st = g.spawnTick.bind(g); g.spawnTick = (dt) => st(dt * mobs);
  if (args.includes('--solo')) g.spawnAcc = -1e9;      // 只有頭目與它自己的召喚物，沒有一般雜兵
  const t0 = entry.at;
  const L = Math.max(1, Math.min(8, Math.round(t0 / 90)));
  g.t = t0; g.p.lvl = Math.round(1 + t0 / 18);
  g.weapons = Object.fromEntries(BUILDS[buildIdx].map((k) => [k, L]));
  g.petSkills = { roar: L, slide: L }; g.cd = Object.fromEntries(Object.keys(g.cd).map((k) => [k, 0.3]));
  g.refreshSynergies(false);
  let lost = 0; let deaths = 0; let hits = 0;
  const hp = g.hurtPlayer.bind(g);
  g.hurtPlayer = (d) => { const inv = g.p.inv > 0; if (!inv && g.mode === 'play') { lost += d * (1 + g.t / 900); hits++; } hp(d); };
  g.die = () => { deaths++; g.p.hp = g.p.maxhp; };
  const boss = args.includes('--noboss') ? Object.assign(g.makeEnemy('hum', 500, 500), { maxhp: 1, hp: 1e9, boss: false }) : g.spawnBoss(entry.id, entry);
  if (args.includes('--noboss')) { boss.hp = 1e9; boss.maxhp = 1e9; }
  const hpMax = boss.maxhp;
  let stag = 0; let lastVuln = 0;
  const dt = 1 / 30; let t = 0;
  while (t < CAP && !boss.dead) {
    if (args.includes('--solo')) g.spawnAcc = -1e9;
    g.p.xp = 0; g.pending = 0; g.mode = 'play';
    g.update(dt); t += dt;
    if (boss.vuln > 0 && lastVuln <= 0) stag++;
    lastVuln = boss.vuln;
  }
  return { ttk: boss.dead ? t : CAP, killed: boss.dead, lost, deaths, hits, stag, hpLeft: boss.dead ? 0 : boss.hp / hpMax, hpMax };
}

console.log('| 頭目 | 出場 | 血量 | 配置Lv | 擊敗率 | 平均擊敗時間 | 受到傷害 | 死亡 | 破綻次數 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const entry of BOSS_SCHEDULE) {
  if (ONLY && !ONLY.includes(entry.id)) continue;
  const rows = [];
  for (let b = 0; b < BUILDS.length; b++) for (let s = 1; s <= SEEDS; s++) rows.push(run(entry, b, s));
  const m = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const L = Math.max(1, Math.min(8, Math.round(entry.at / 90)));
  console.log(`| ${ENEMIES[entry.id].name} | ${entry.at}s | ${Math.round(rows[0].hpMax)} | Lv${L} | ${(m((r) => r.killed ? 1 : 0) * 100).toFixed(0)}% | ${m((r) => r.ttk).toFixed(0)}s | ${m((r) => r.lost).toFixed(0)} | ${m((r) => r.deaths).toFixed(1)} | ${m((r) => r.stag).toFixed(1)} |`);
}
