// 整局模擬：機器人（會躲預警）自動選卡，從 0 秒玩到死亡或勝利，記錄各時間點的等級與每隻頭目的出場／擊敗時間。
// 用法：node tools/pie-phoebe/run-sim.mjs [--seeds 12] [--max 900] [--char phoebe|phrolova] [--detail]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const SEEDS = Number(opt('--seeds', 12)); const MAX = Number(opt('--max', 900)); const CHAR = opt('--char', 'phoebe');

if (opt('--worker', null)) {
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  let rng = () => 0.5;
  Math.random = () => rng();
  const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const seed = Number(opt('--worker'));
  rng = mulberry32(seed * 7919 + 3);
  const { Game } = await import('../../site/games/community/pie-phoebe/src/game.js');
  const g = Object.create(Game.prototype);
  g.charId = CHAR;
  const ev = [];
  g.ui = { setSlots() {}, banner() {}, end() {}, hideScreen() {}, showHud() {}, levelup() {} };
  g.camPos = {}; g.grid = new Map(); g.input = { x: 0, z: 0 }; g.clock = 0;
  g.newRun(); g.mode = 'play'; g.bot = true;
  const origKill = g.kill.bind(g);
  g.kill = (e) => { if (e.boss && !e.dead) ev.push({ t: +g.t.toFixed(1), what: `kill:${e.bossId}` }); origKill(e); };
  const origSpawn = g.spawnBoss.bind(g);
  g.spawnBoss = (id, entry) => { ev.push({ t: +g.t.toFixed(1), what: `spawn:${id}` }); return origSpawn(id, entry); };
  let hurt = 0;
  const hp = g.hurtPlayer.bind(g);
  g.hurtPlayer = (d) => { if (g.p.inv <= 0 && g.mode === 'play') hurt += d * (1 + g.t / 900); hp(d); };
  const snaps = {};
  // 選卡：優先補齊連攜，其次技能，再來被動（生命、攻擊優先）
  const prio = (c) => (c.syn ? 100 : 0) + (c.type === 'weapon' ? (c.isNew ? 55 : 60) : c.type === 'pet' ? 40 : c.type === 'passive' ? ({ vital: 50, might: 52, haste: 45, area: 35, speed: 30, magnet: 20, prayer: 15 }[c.key] || 10) : 1) + rng();
  let end = 'timeout';
  const dt = 1 / 30;
  for (let i = 0; i < MAX * 30; i++) {
    g.update(dt);
    if (g.mode === 'levelup' && g.pendingCards) {
      let best = 0;
      g.pendingCards.forEach((c, k) => { if (prio(c) > prio(g.pendingCards[best])) best = k; });
      g.pick(best);
    }
    for (const t of [60, 120, 180, 300, 420, 540, 660]) if (!snaps[t] && g.t >= t) snaps[t] = { lvl: g.p.lvl, hp: Math.round(g.p.hp), w: Object.values(g.weapons).reduce((a, b) => a + b, 0), kills: g.kills };
    if (g.mode === 'over') { end = 'dead'; break; }
    if (g.mode === 'win') { end = 'win'; break; }
  }
  console.log(JSON.stringify({ seed, end, t: +g.t.toFixed(0), lvl: g.p.lvl, hurt: Math.round(hurt), snaps, ev, weapons: g.weapons, pet: g.petSkills, passives: g.passives }));
  process.exit(0);
}

const here = fileURLToPath(import.meta.url);
const runs = await Promise.all(Array.from({ length: SEEDS }, (_, i) => new Promise((resolve, reject) => {
  const c = spawn(process.execPath, [here, '--worker', String(i + 1), '--max', String(MAX), '--char', CHAR], { stdio: ['ignore', 'pipe', 'inherit'] });
  let b = ''; c.stdout.on('data', (d) => { b += d; });
  c.on('close', (code) => (code ? reject(new Error('worker failed')) : resolve(JSON.parse(b.trim().split('\n').pop()))));
})));
const wins = runs.filter((r) => r.end === 'win').length;
console.log(`局數 ${SEEDS}：勝利 ${wins}、死亡 ${runs.filter((r) => r.end === 'dead').length}、逾時 ${runs.filter((r) => r.end === 'timeout').length}`);
console.log(`死亡時間（秒）：${runs.map((r) => `${r.end[0]}${r.t}`).sort().join(' ')}`);
const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '-');
console.log('| 時間 | 仍存活局數 | 平均等級 | 平均技能總等級 |\n| --- | --- | --- | --- |');
for (const t of [60, 120, 180, 300, 420, 540, 660]) {
  const alive = runs.filter((r) => r.snaps[t]);
  console.log(`| ${t}s | ${alive.length}/${SEEDS} | ${avg(alive.map((r) => r.snaps[t].lvl))} | ${avg(alive.map((r) => r.snaps[t].w))} |`);
}
const bossIds = ['crab', 'vanguard', 'lighthouse', 'weaver', 'hive', 'conductor'];
console.log('| 頭目 | 出場 | 擊敗 | 平均擊敗用時 | 打到一半死亡 |\n| --- | --- | --- | --- | --- |');
for (const id of bossIds) {
  const sp = runs.filter((r) => r.ev.some((e) => e.what === `spawn:${id}`));
  const kl = sp.filter((r) => r.ev.some((e) => e.what === `kill:${id}`));
  const dur = kl.map((r) => r.ev.find((e) => e.what === `kill:${id}`).t - r.ev.find((e) => e.what === `spawn:${id}`).t);
  console.log(`| ${id} | ${sp.length} | ${kl.length} | ${avg(dur)}s | ${sp.filter((r) => r.end === 'dead' && !r.ev.some((e) => e.what === `kill:${id}`)).length} |`);
}
console.log(`平均受到傷害 ${avg(runs.map((r) => r.hurt))}`);
if (args.includes('--detail')) for (const r of runs) console.log(JSON.stringify({ seed: r.seed, end: r.end, t: r.t, w: r.weapons, pet: r.pet, passives: r.passives }));
