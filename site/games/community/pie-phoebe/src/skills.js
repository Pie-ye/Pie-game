import { BAL } from './balance.js';

// v1.3 共用數值來源：實際施放與升級說明都讀取這裡。
// 原作機制改編為倖存玩法；數值不是《鳴潮》的角色倍率。
export function skillStats(key, lv) {
  const stats = baseStats(key, lv);
  const l = Math.max(1, Math.min(8, lv));
  stats.damage *= BAL[key]?.[l - 1] ?? 1;
  return stats;
}

function baseStats(key, lv) {
  const l = Math.max(1, Math.min(8, lv));
  switch (key) {
    case 'star': return { damage: 18 + 5 * l, cooldown: 1.02 - .04 * l, count: Math.min(3, 1 + Math.floor((l + 1) / 3)), pierce: l >= 4 ? 1 : 0 };
    case 'ring': return { damage: 16 + 6 * l, cooldown: 6.4 - .2 * l, radius: 2.5 + .16 * l, duration: 5, tick: .75 };
    case 'litany': return { damage: 45 + 13 * l, cooldown: 3.8 - .16 * l, count: l >= 6 ? 2 : 1, width: 1.5 + .12 * l };
    case 'field': return { damage: 7 + 3 * l, cooldown: .45, radius: 2.1 + .23 * l };
    case 'echo': return { damage: 30 + 10 * l, cooldown: 4.5 - .17 * l, radius: 5 + .35 * l, count: l >= 8 ? 2 : 1 };
    case 'rain': return { damage: 85 + 22 * l, cooldown: 6.4 - .22 * l, radius: 2.8 + .16 * l, count: l >= 6 ? 2 : 1 };
    case 'chain': return { damage: 40 + 9 * l, cooldown: 2.8 - .12 * l, count: 3 + Math.floor(l / 2), reach: 4.5 + .15 * l };
    case 'frost': return { damage: 22 + 7 * l, cooldown: 3.8 - .12 * l, radius: 2.1 + .18 * l, duration: 2.5 + .1 * l };
    case 'trail': return { damage: 11 + 3.5 * l, cooldown: .32, radius: .95 + .08 * l, duration: 3 + .25 * l, tick: .45 };
    case 'scythe': return { damage: 15 + 4.5 * l, cooldown: 1.0 - .04 * l, radius: 3 + .12 * l, arc: 2.1, swings: l >= 7 ? 3 : l >= 4 ? 2 : 1 };
    case 'dream': return { damage: 26 + 8 * l, cooldown: 5.2 - .2 * l, radius: 2.2 + .15 * l, duration: 2.2 };
    case 'coda': return { damage: 80 + 22 * l, cooldown: 3, radius: 4.6 + .2 * l, notes: l >= 6 ? 5 : 6 };
    case 'lily': return { damage: 7 + 2.5 * l, cooldown: .5, count: 2 + Math.floor(l / 2), radius: 2 + .12 * l, speed: 2.1 };
    default: throw new Error(`Unknown skill: ${key}`);
  }
}

/** 瑞吉技能數值（v1.4：吃魚移除；吼降傷；肚皮滑行改為繞玩家滑行）。 */
export function petStats(key, lv) {
  const l = Math.max(1, Math.min(8, lv));
  switch (key) {
    case 'roar': return { damage: 12 + 3.5 * l + (l >= 8 ? 6 : 0), cooldown: 6.8 - .4 * l, radius: 2.9 + .35 * l, stun: l >= 6 ? 1.5 : .9 };
    case 'slide': return { damage: 9 + 3 * l + (l >= 5 ? 4 : 0), cooldown: 7.2 - .4 * l, radius: 3 + .1 * l, hit: 1 + .08 * l, duration: 1.5 - .04 * l, laps: l >= 8 ? 2 : 1 };
    default: throw new Error(`Unknown pet skill: ${key}`);
  }
}

const f = (n) => Number(n.toFixed(2));
export function petSummary(key, lv) {
  const s = petStats(key, lv);
  if (key === 'roar') return `${f(s.damage)} 傷害／${f(s.cooldown)} 秒；半徑 ${f(s.radius)}，暈眩 ${s.stun} 秒`;
  return `繞圈 ${s.laps} 圈 × ${f(s.damage)} 傷害／${f(s.cooldown)} 秒；軌道半徑 ${f(s.radius)}，結束後回到身邊`;
}

export function skillSummary(key, lv) {
  const s = skillStats(key, lv);
  const damage = `${f(s.damage)} 傷害`;
  switch (key) {
    case 'star': return `${s.count} 發 × ${damage}／${f(s.cooldown)} 秒；穿透 ${s.pierce} 次`;
    case 'ring': return `每 ${f(s.cooldown)} 秒召鏡；半徑 ${f(s.radius)}，每 ${s.tick} 秒 ${damage}`;
    case 'litany': return `${damage}／${f(s.cooldown)} 秒${s.count > 1 ? '；追加 55% 傷害光束' : ''}；光噪每層 +4%`;
    case 'field': return `每 ${s.cooldown} 秒 ${damage}；半徑 ${f(s.radius)}`;
    case 'echo': return `${s.count} 波 × ${damage}／${f(s.cooldown)} 秒；範圍 ${f(s.radius)}`;
    case 'rain': return `${s.count} 面 × ${damage}／${f(s.cooldown)} 秒；爆炸半徑 ${f(s.radius)}`;
    case 'chain': return `${s.count} 個目標 × ${damage}／${f(s.cooldown)} 秒`;
    case 'frost': return `${damage}／${f(s.cooldown)} 秒；易傷 20% 持續 ${f(s.duration)} 秒`;
    case 'trail': return `每 ${s.tick} 秒 ${damage}；持續 ${f(s.duration)} 秒，半徑 ${f(s.radius)}`;
    case 'scythe': return `${s.swings} 斬 × ${damage}／${f(s.cooldown)} 秒；弧斬半徑 ${f(s.radius)}`;
    case 'dream': return `${damage}／${f(s.cooldown)} 秒；半徑 ${f(s.radius)}，凝滯並產 2 音符`;
    case 'coda': return `滿 ${s.notes} 音符時 ${damage}；牽引半徑 ${f(s.radius)}`;
    case 'lily': return `${s.count} 片花瓣，每片每 ${s.cooldown} 秒 ${damage}；環繞半徑 ${f(s.radius)}`;
  }
}

export const ARENA_RADIUS = 22;
export function clampArena(x, z, radius = ARENA_RADIUS) {
  const d = Math.hypot(x, z);
  return d > radius ? { x: x / d * radius, z: z / d * radius } : { x, z };
}
