// 依 balance.mjs 的量測結果迭代調整 src/balance.js 的傷害倍率，使各技能相對強度收斂到 100 附近。
// 用法：node tools/pie-phoebe/calibrate.mjs [--rounds 5] [--seeds 3] [--dur 60] [--damp 0.7] [--char phoebe|phrolova] [--ref balance-ref-phoebe.json]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../site/games/community/pie-phoebe/src/balance.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const rounds = Number(opt('--rounds', 5)); const damp = Number(opt('--damp', 0.7));
const seeds = opt('--seeds', 3); const dur = opt('--dur', 60); const char = opt('--char', 'phoebe'); const ref = opt('--ref', null);

const load = () => {
  const src = readFileSync(target, 'utf8');
  const BAL = {};
  for (const m of src.matchAll(/^\s+(\w+): \[([^\]]+)\],$/gm)) BAL[m[1]] = m[2].split(',').map(Number);
  return BAL;
};
const save = (BAL) => {
  const head = readFileSync(target, 'utf8').split('export const BAL')[0];
  const body = Object.entries(BAL).map(([k, v]) => `  ${k}: [${v.map((x) => Number(x.toFixed(3))).join(', ')}],`).join('\n');
  writeFileSync(target, `${head}export const BAL = {\n${body}\n};\n`);
};

for (let r = 1; r <= rounds; r++) {
  const out = path.join('/tmp', `calib-${process.pid}.json`);
  execFileSync(process.execPath, [path.join(here, 'balance.mjs'), '--seeds', seeds, '--dur', dur, '--char', char, ...(ref ? ['--ref', ref] : []), '--json', out], { stdio: ['ignore', 'ignore', 'inherit'] });
  const { index } = JSON.parse(readFileSync(out, 'utf8'));
  const BAL = load();
  let worst = 0;
  for (const [key, row] of Object.entries(index)) {
    for (const [lv, v] of Object.entries(row)) {
      const f = (100 / Math.max(20, v)) ** damp;
      BAL[key][lv - 1] *= Math.min(2, Math.max(0.5, f));
      worst = Math.max(worst, Math.abs(v - 100));
    }
  }
  save(BAL);
  console.log(`round ${r}: 最大偏差 ${worst.toFixed(0)}`);
}
