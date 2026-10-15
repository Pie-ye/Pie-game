// 技能傷害平衡量測：在固定人群／單一頭目假人前，量每種技能各等級的每秒傷害與傷害占比。
// 用法：node tools/pie-phoebe/balance.mjs [--seeds 3] [--profile early|mid|late] [--dur 90] [--json out.json] [--ref ref.json] [--quick]
// 方法：玩家沿圓形路徑移動（光痕才有作用）、無敵、不撿魚、不升級；敵人數量固定補滿，
//       所以 AoE 技能不會因為自己清太快而被低估。同一組亂數種子重複多次取平均。
import { writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

globalThis.localStorage = { getItem: () => null, setItem() {} };
let rng = () => 0.5;
Math.random = () => rng();            // game.js 於載入時捕捉 Math.random，所以先換成可切換的包裝
const mulberry32 = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const { Game } = await import('../../site/games/community/pie-phoebe/src/game.js');
const { WEAPONS, PET, SYNERGIES, ENEMIES, spawnTable } = await import('../../site/games/community/pie-phoebe/src/data.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const SEEDS = Number(opt('--seeds', 3));
const QUICK = args.includes('--quick');
const PROFILE = opt('--profile', 'mid');
const CHAR = opt('--char', 'phoebe');
const REF = opt('--ref', null);        // 以另一個角色的量測結果（JSON）作為 100 的基準，讓不同角色的整體強度相當
const DUR = Number(opt('--dur', 90));
const JSON_OUT = opt('--json', null);

// 時間與玩家等級的對應：與 bot 實測的升級節奏相近。
export const PROFILES = { early: { t: 60, lvl: 6 }, mid: { t: 240, lvl: 16 }, late: { t: 420, lvl: 26 } };
const WARM = 5; const DT = 1 / 30; const CROWD = 60;
const ELITE_N = 24; const ELITE_TYPES = ['golem', 'golem', 'mortar', 'splitter'];   // 高血量精英群：大招不會被雜兵血量限制

function makeGame() {
  const g = Object.create(Game.prototype);
  g.charId = CHAR;
  g.ui = { setSlots() {}, banner() {}, end() {}, hideScreen() {}, showHud() {}, levelup() {} };
  g.camPos = {}; g.grid = new Map(); g.input = { x: 0, z: 0 }; g.clock = 0;
  g.newRun(); g.mode = 'play';
  return g;
}

/** 回傳 { dps: {來源: 每秒傷害}, kills: 每分鐘擊殺 } */
export function run({ weapons, pet, profile = 'mid', scenario = 'crowd', seed = 1, maestro = false }) {
  rng = mulberry32(seed * 7919 + 13);
  const P = PROFILES[profile];
  const g = makeGame();
  g.t = P.t; g.weapons = { ...weapons }; g.petSkills = { ...pet };
  g.cd = Object.fromEntries(Object.keys(g.cd).map((k) => [k, 0.3]));
  g.bossIdx = 99; g.swarmIdx = 99;     // 不要自然出頭目與包圍
  let dummy = null;
  if (scenario === 'boss') {
    dummy = g.makeEnemy('golem', 5, 0);          // 沒有 AI 的頭目假人：免疫暈眩與擊退、會慢慢追玩家
    Object.assign(dummy, { hp: 1e12, maxhp: 1e12, boss: true, r: 1.5, speed: 1.15, bossId: 'dummy' }); g.boss = dummy;
  }
  let killsAtWarm = 0; let snap = null;
  const steps = Math.round((WARM + DUR) / DT);
  for (let i = 0; i < steps; i++) {
    const w = i * DT * 1.4;
    g.input.x = Math.cos(w); g.input.z = Math.sin(w);
    g.p.hp = g.p.maxhp; g.p.xp = 0; g.p.lvl = P.lvl; g.p.prayer = 0; g.pending = 0; g.pickups.length = 0;
    if ('coda' in weapons) g.notes = Math.min(6, g.notes + 0.8 * DT);   // 終章的音符平常由斬／轉生之夢產生，單項測試時以固定速率補上
    if (maestro) { g.p.mode = 'maestro'; g.p.modeT = 9; if (!g.hecate) g.hecate = { x: 1, z: -1, ang: 0, cd: 0.3, n: 0, face: 1, bob: 0 }; }
    if (scenario === 'crowd' || scenario === 'elite') {
      g.buildGrid();
      let n = g.enemies.filter((e) => !e.dead).length;
      const want = scenario === 'crowd' ? CROWD : ELITE_N;
      while (n < want) {
        const type = scenario === 'crowd' ? g.pickType() : ELITE_TYPES[Math.floor(rng() * ELITE_TYPES.length)];
        g.spawnAround(type, 9 + rng() * 5); n++;
      }
    } else if (dummy) {
      // 把假人以外的雜兵清掉，量單體輸出。
      g.enemies = g.enemies.filter((e) => e === dummy);
    }
    g.update(DT);
    if (i === Math.round(WARM / DT)) { snap = { ...g.damageBySkill }; killsAtWarm = g.kills; }
  }
  const dps = {};
  for (const [k, v] of Object.entries(g.damageBySkill)) dps[k] = (v - (snap[k] || 0)) / DUR;
  return { dps, kills: (g.kills - killsAtWarm) * 60 / DUR };
}

function avg(configs) {
  const out = { dps: {}, kills: 0 };
  for (let s = 1; s <= SEEDS; s++) {
    const r = run({ ...configs, seed: s });
    for (const [k, v] of Object.entries(r.dps)) out.dps[k] = (out.dps[k] || 0) + v / SEEDS;
    out.kills += r.kills / SEEDS;
  }
  return out;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const r0 = (n) => Math.round(n);

const levels = QUICK ? [1, 4, 8] : [1, 2, 3, 4, 5, 6, 7, 8];
const base = { roar: 1 };
const SCEN = ['crowd', 'elite', 'boss'];
const SCEN_NAME = { crowd: '雜兵群（60 隻，AoE 清場）', elite: '精英群（24 隻高血量）', boss: '單一頭目假人（單體）' };
const BUILDS = CHAR === 'phrolova' ? {
  '全技能 (斬/夢/終章/花環)': ['scythe', 'dream', 'coda', 'lily'],
  '全技能＋樂章 (赫卡忒)': ['scythe', 'dream', 'coda', 'lily'],
  '近戰 (斬/花環)': ['scythe', 'lily'],
  '音符流 (斬/夢/終章)': ['scythe', 'dream', 'coda'],
} : {
  '輸出型 (三連/重擊/啟明/折射/領域)': ['star', 'litany', 'rain', 'chain', 'field'],
  '控場型 (鏡環/停滯/光痕/迴響/三連)': ['ring', 'frost', 'trail', 'echo', 'star'],
  '連攜型 (三連/折射/鏡環/重擊/停滯)': ['star', 'chain', 'ring', 'litany', 'frost'],
  '範圍型 (領域/迴響/啟明/光痕/重擊)': ['field', 'echo', 'rain', 'trail', 'litany'],
};
const PET_SOURCE = { roar: 'roar', slide: 'slide' };

/** 一個工作單元：回傳可合併的部分結果。每個工作單元由獨立行程執行，所以可以平行。 */
function runTask(task) {
  const out = {};
  if (task.type === 'solo') {
    for (const scenario of SCEN) for (const lv of levels) {
      const r = avg({ weapons: { [task.key]: lv }, pet: base, scenario, profile: PROFILE });
      ((out.solo ||= {})[task.key] ||= {})[`${scenario}${lv}`] = { own: r.dps[task.key] || 0, frazzle: r.dps.frazzle || 0 };
    }
  } else if (task.type === 'pet') {
    for (const lv of levels) for (const scenario of SCEN) {
      const pet = task.key === 'roar' ? { roar: lv } : { roar: 1, slide: lv };
      const r = avg({ weapons: {}, pet, scenario, profile: PROFILE });
      ((out.pet ||= {})[task.key] ||= {})[`${scenario}${lv}`] = { own: r.dps[PET_SOURCE[task.key]] || 0 };
    }
  } else if (task.type === 'build') {
    const weapons = Object.fromEntries(BUILDS[task.name].map((k) => [k, task.lv || 5]));
    for (const scenario of SCEN) {
      const r = avg({ weapons, pet: { roar: task.lv || 5, slide: task.lv || 5 }, scenario, profile: PROFILE, maestro: task.name.includes('樂章') });
      ((out.builds ||= {})[task.name] ||= {})[scenario] = r;
    }
  }
  return out;
}

if (opt('--task', null)) {
  process.stdout.write(JSON.stringify(runTask(JSON.parse(opt('--task')))));
  process.exit(0);
}

const WEAPON_KEYS = Object.keys(WEAPONS).filter((k) => (WEAPONS[k].owner || 'phoebe') === CHAR);
const tasks = [
  ...WEAPON_KEYS.map((key) => ({ type: 'solo', key })),
  ...Object.keys(PET).map((key) => ({ type: 'pet', key })),
  ...Object.keys(BUILDS).map((name) => ({ type: 'build', name })),
];
const here = fileURLToPath(import.meta.url);
const forwarded = args.filter((a, i) => a !== '--json' && args[i - 1] !== '--json');
const result = { solo: {}, pet: {}, builds: {} };
function merge(dst, src) { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v)) merge(dst[k] ||= {}, v); else dst[k] = v; } }
await Promise.all(tasks.map((task) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [here, ...forwarded, '--task', JSON.stringify(task)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let buf = '';
  child.stdout.on('data', (d) => { buf += d; });
  child.on('close', (code) => { if (code) return reject(new Error(`task failed ${JSON.stringify(task)}`)); merge(result, JSON.parse(buf)); resolve(); });
})));

// ── 輸出 ──
const line = (...c) => `| ${c.join(' | ')} |`;
const out = [];
out.push(`# 技能傷害平衡量測（${SEEDS} 個種子平均，${PROFILE}：t=${PROFILES[PROFILE].t}s、玩家 Lv${PROFILES[PROFILE].lvl}，人群 ${CROWD} 隻、每場 ${DUR}s）`, '');
out.push('數字是每秒傷害（含暴擊期望，不含光噪持續傷害，光噪另列）。');
for (const scenario of SCEN) {
  out.push('', `## 角色技能：${SCEN_NAME[scenario]}`, '');
  out.push(line('技能', ...levels.map((l) => `Lv${l}`), 'Lv8/Lv1', '光噪Lv8'), line('---', ...levels.map(() => '---'), '---', '---'));
  for (const key of WEAPON_KEYS) {
    const row = levels.map((l) => result.solo[key][`${scenario}${l}`].own);
    const f = result.solo[key][`${scenario}${levels[levels.length - 1]}`].frazzle;
    out.push(line(`${WEAPONS[key].name}`, ...row.map(r0), (row[row.length - 1] / (row[0] || 1)).toFixed(1), r0(f)));
  }
}
// 相對強度指數：每個情境、每個等級先除以本角色所有技能的中位數，再把三個情境取平均。100＝中位數。
const median = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const index = {};
for (const key of WEAPON_KEYS) index[key] = {};
for (const lv of levels) {
  const base = REF ? JSON.parse(readFileSync(REF, 'utf8')).solo : result.solo;
  const per = Object.fromEntries(SCEN.map((sc) => [sc, median(Object.keys(base).map((k) => base[k][`${sc}${lv}`].own)) || 1]));
  for (const key of WEAPON_KEYS) {
    index[key][lv] = SCEN.reduce((a, sc) => a + result.solo[key][`${sc}${lv}`].own / per[sc], 0) / SCEN.length * 100;
  }
}
result.index = index;
out.push('', '## 相對強度指數（三個情境平均，100＝本角色所有技能的中位數；目標區間 80–125）', '');
out.push(line('技能', ...levels.map((l) => `Lv${l}`), '最高', '最低'), line('---', ...levels.map(() => '---'), '---', '---'));
for (const key of WEAPON_KEYS) {
  const row = levels.map((l) => index[key][l]);
  out.push(line(WEAPONS[key].name, ...row.map(r0), r0(Math.max(...row)), r0(Math.min(...row))));
}
const outOfBand = [];
for (const key of WEAPON_KEYS) for (const lv of levels) {
  const v = index[key][lv];
  if (v < 80 || v > 125) outOfBand.push(`${WEAPONS[key].name} Lv${lv}=${r0(v)}`);
}
out.push('', `**超出區間 ${outOfBand.length}/${WEAPON_KEYS.length * levels.length}**：${outOfBand.join('、') || '無'}`);
out.push('', '## 瑞吉（預設張嘴吼 Lv1 為基線；沒有角色技能）', '');
out.push(line('技能', ...levels.map((l) => `Lv${l}`)), line('---', ...levels.map(() => '---')));
for (const key of Object.keys(result.pet)) for (const sc of SCEN) {
  out.push(line(`${PET[key].name}／${SCEN_NAME[sc].split('（')[0]}`, ...levels.map((l) => r0(result.pet[key][`${sc}${l}`].own))));
}
out.push('', '## 典型配置（每項 Lv5，瑞吉張嘴吼＋滑行 Lv5）', '');
for (const [name, v] of Object.entries(result.builds)) {
  for (const scenario of SCEN) {
    const d = v[scenario].dps; const total = sum(d);
    const petShare = ((d.roar || 0) + (d.slide || 0) + (d.burp || 0) + (d.pet || 0)) / total;
    const parts = Object.entries(d).sort((a, b) => b[1] - a[1]).map(([k, x]) => `${WEAPONS[k]?.name || { roar: '瑞吉吼', slide: '瑞吉滑行', burp: '嗝', hecate: '赫卡忒', prayer: '祈願爆發', frazzle: '光噪／侵蝕' }[k] || k} ${(x / total * 100).toFixed(0)}%`);
    out.push(`- **${name}／${SCEN_NAME[scenario].split('（')[0]}**：總 ${r0(total)} dps，瑞吉占 ${(petShare * 100).toFixed(0)}%。${parts.join('，')}`);
  }
}
console.log(out.join('\n'));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 1));
