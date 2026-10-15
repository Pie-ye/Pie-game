// v1.3 共用數值來源：實際施放與升級說明都讀取這裡。
// 原作機制改編為倖存玩法；數值不是《鳴潮》的角色倍率。
export function skillStats(key, lv) {
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
    default: throw new Error(`Unknown skill: ${key}`);
  }
}

const f = (n) => Number(n.toFixed(2));
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
  }
}

export const ARENA_RADIUS = 22;
export function clampArena(x, z, radius = ARENA_RADIUS) {
  const d = Math.hypot(x, z);
  return d > radius ? { x: x / d * radius, z: z / d * radius } : { x, z };
}
