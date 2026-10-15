// v1.4 頭目 AI：六隻頭目各有自己的機制。每隻回傳這一幀的移動意圖 { ux, uz, sp }。
// g 是 Game，e 是頭目實體（e.ai 放它的私有狀態），c 是 { dx, dz, d, ux, uz, sp }（朝玩家的方向與預設速度）。
import { sfx } from './audio.js';
import { ARENA_RADIUS, clampArena } from './skills.js';

const TAU = Math.PI * 2;
const frac = (e) => e.hp / e.maxhp;
const aim = (g, e) => Math.atan2(g.p.z - e.z, g.p.x - e.x);
const moveOf = (c, sp) => ({ ux: c.ux, uz: c.uz, sp });
const still = (c) => ({ ux: c.ux, uz: c.uz, sp: 0 });
/** 保持距離：太近後退、太遠靠近、中間繞圈走。 */
function keepDistance(c, near, far, sp) {
  if (c.d < near) return { ux: -c.ux, uz: -c.uz, sp };
  if (c.d > far) return { ux: c.ux, uz: c.uz, sp };
  return { ux: -c.uz, uz: c.ux, sp: sp * 0.6 };
}
const slowed = (e) => (e.slowT > 0 ? e.slowMul : 1);

/** 把頭目設成「破防」狀態：受到的傷害 ×mul，持續 sec 秒。 */
export function stagger(g, e, sec, mul, text) {
  e.vuln = Math.max(e.vuln || 0, sec); e.vulnMul = mul;
  g.popup(e.x, e.z, e.size * 1.1, text, '#ffe36b');
  g.fxRing(e.x, e.z, 3.4, 0.5, [1, .85, .35]);
  g.shake = Math.max(g.shake, .3);
}

// ───────────────────────── 破陣者：誘導衝鋒撞牆 ─────────────────────────
function vanguard(g, e, dt, c) {
  const ai = e.ai ||= { mode: 'walk', t: 2.2, n: 0 };
  const rage = frac(e) < 0.4;
  const speed = e.speed * slowed(e) * (rage ? 1.3 : 1);
  e.tele = null;
  if (ai.mode === 'walk') {
    ai.t -= dt;
    if (ai.t <= 0) {
      const act = ai.n++ % 4;
      if (act === 3 && frac(e) < 0.75) {
        g.ui.banner('破陣者召喚雜兵！', '#ff8ca8');
        for (let i = 0; i < 6; i++) g.spawnAround(i % 3 === 0 ? 'bat' : 'hum', 10);
        ai.t = 2;
      } else if (act % 2 === 0) {
        const a = aim(g, e);
        e.cdx = Math.cos(a); e.cdz = Math.sin(a);
        ai.mode = 'windup'; ai.t = rage ? 0.9 : 1.15;
        g.ui.banner('衝鋒預警：站在牆邊，側身讓他撞牆破防！', '#ff8ca8');
      } else {
        g.warnBlast(e, g.p.x, g.p.z, 3.2, 1.3);
        if (rage) { g.warnBlast(e, g.p.x + 3.4, g.p.z, 2.4, 1.6); g.warnBlast(e, g.p.x - 3.4, g.p.z, 2.4, 1.6); }
        ai.mode = 'slam'; ai.t = 1.9;
        g.ui.banner('震地預警：離開紅圈！', '#ff8ca8');
      }
    }
    return moveOf(c, speed);
  }
  if (ai.mode === 'windup') {
    ai.t -= dt;
    e.tele = { dx: e.cdx, dz: e.cdz, len: 24, w: e.r * 2 + 0.8 };
    if (ai.t <= 0) { ai.mode = 'rush'; ai.t = 2.6; sfx('boss', 0.1); }
    return still(c);
  }
  if (ai.mode === 'rush') {
    ai.t -= dt;
    if (Math.hypot(e.x, e.z) >= ARENA_RADIUS - 1.3) {
      // 撞牆：衝擊波＋破防。
      g.fxRing(e.x, e.z, 3.8, 0.45, [1, .3, .3]);
      if ((g.p.x - e.x) ** 2 + (g.p.z - e.z) ** 2 < 3.9 ** 2) g.hurtPlayer(e.dmg * 1.2);
      stagger(g, e, 3.5, 1.6, '撞牆破防！');
      g.ui.banner('撞牆破防！3.5 秒內傷害 +60%', '#ffe36b');
      sfx('boom', 0.1);
      ai.mode = 'stagger'; ai.t = 3.5;
      return still(c);
    }
    if (ai.t <= 0) { ai.mode = 'walk'; ai.t = 1.3; return still(c); }
    return { ux: e.cdx, uz: e.cdz, sp: 12 };
  }
  if (ai.mode === 'slam') { ai.t -= dt; if (ai.t <= 0) { ai.mode = 'walk'; ai.t = rage ? 1.2 : 1.8; } return still(c); }
  // stagger
  ai.t -= dt;
  if (ai.t <= 0) { ai.mode = 'walk'; ai.t = 1.2; }
  return still(c);
}

// ───────────────────────── 織音者：共鳴柱護盾 ─────────────────────────
function spawnPillars(g, e, n) {
  const base = aim(g, e) + Math.PI;
  for (let i = 0; i < n; i++) {
    const a = base + (i / n) * TAU + 0.4;
    const pos = clampArena(g.p.x + Math.cos(a) * 6, g.p.z + Math.sin(a) * 6, ARENA_RADIUS - 1.2);
    const pillar = g.spawnProp('pillar', pos.x, pos.z, e);
    pillar.hp = pillar.maxhp = e.maxhp * 0.025;
  }
}
function weaver(g, e, dt, c) {
  const ai = e.ai ||= { wave: 0, t: 3, spiral: 0, fireT: 0, wardT: 0, hadWard: false };
  const thresholds = [1, 0.5];
  const alive = g.enemies.filter((o) => o.owner === e.id && o.type === 'pillar' && !o.dead).length;
  if (ai.wave < 2 && alive === 0 && frac(e) <= thresholds[ai.wave]) {
    spawnPillars(g, e, 3);
    ai.wave++; ai.wardT = 0; ai.discordT = 3.5;
    g.ui.banner('共鳴柱：先擊破三根共鳴柱，織音者才會受傷！', '#7deaff');
    sfx('boss', 0.1);
    ai.hadWard = true;
    e.ward = 0.15;
    return still(c);
  }
  e.ward = alive > 0 ? 0.15 : 1;
  if (alive === 0 && ai.hadWard) {
    ai.hadWard = false;
    stagger(g, e, 4, 1.5, '共鳴中斷！');
    g.ui.banner('共鳴中斷！4 秒內傷害 +50%', '#ffe36b');
    ai.t = 2.5;
  }
  if (alive > 0) {
    // 護盾期：旋轉音符彈幕；拖太久會追加環形彈幕。
    ai.wardT += dt;
    ai.fireT -= dt;
    if (ai.fireT <= 0) {
      ai.fireT = 0.3;
      ai.spiral += 0.5;
      for (const off of [0, Math.PI]) g.enemyFan(e, ai.spiral + off, 1, 0, 4.2);
    }
    ai.discordT -= dt;
    if (ai.wardT > 14 && ai.discordT <= 0) {
      ai.discordT = 4.2;
      const gap = aim(g, e);
      g.enemyFan(e, gap + Math.PI, 24, TAU - 1.2, 3.6);
      g.ui.banner('不和諧音！沿缺口閃避', '#7deaff');
    }
    return keepDistance(c, 5, 9, e.speed * slowed(e));
  }
  ai.t -= dt;
  if (ai.t <= 0) {
    ai.t = frac(e) < 0.4 ? 3 : 3.8;
    if ((ai.n = (ai.n || 0) + 1) % 2) {
      g.enemyFan(e, aim(g, e), 9, 1.3, 4.4);
      g.ui.banner('音波齊射！', '#7deaff');
    } else {
      for (let i = -1; i <= 1; i++) g.warnBlast(e, g.p.x + i * 2.6, g.p.z + (i ? 0 : 2), 1.7, 1.15 + Math.abs(i) * 0.2);
      g.ui.banner('落雷預警：離開紅圈！', '#ff8ca8');
    }
  }
  return keepDistance(c, 5, 9, e.speed * slowed(e));
}

// ───────────────────────── 終曲指揮：旋轉光束與安全扇區 ─────────────────────────
function conductor(g, e, dt, c) {
  const ai = e.ai ||= { t: 2.5, beamCd: 4, sectorCd: 4, addCd: 4, phase: 1, n: 0 };
  const f = frac(e);
  const phase = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  if (phase !== ai.phase) {
    ai.phase = phase; ai.beamCd = 2.5; ai.sectorCd = 3; ai.addCd = 1.5;
    g.ui.banner(phase === 2 ? '第二樂章：樂手登場，光束加速' : '終樂章：離開紅色扇區，找安全區！', '#ffd966');
    sfx('boss', 0.1); g.shake = Math.max(g.shake, .5);
  }
  const beams = g.hazards.filter((h) => h.kind === 'beam' && h.owner === e.id).length;
  // 落雷
  ai.t -= dt;
  if (ai.t <= 0) {
    ai.t = phase === 1 ? 3.6 : 3.0;
    if (phase === 1) for (let i = -1; i <= 1; i++) g.warnBlast(e, g.p.x + i * 2.5, g.p.z, 1.6, 1.15 + Math.abs(i) * 0.2);
    else {
      for (let i = -2; i <= 2; i++) g.warnBlast(e, g.p.x + i * 2.4, g.p.z, 1.6, 1.1 + Math.abs(i) * 0.18);
      g.warnBlast(e, g.p.x, g.p.z - 3.2, 1.5, 1.6); g.warnBlast(e, g.p.x, g.p.z + 3.2, 1.5, 1.6);
    }
  }
  // 指揮棒：對向兩道旋轉光束
  ai.beamCd -= dt;
  if (ai.beamCd <= 0 && phase <= 2 && beams === 0) {
    ai.beamCd = phase === 1 ? 9 : 7.5;
    const w = (phase === 1 ? 0.75 : 1.05) * (g.rnd() < 0.5 ? -1 : 1);
    const a = aim(g, e);
    g.addBeam(e, a, { w, warn: 1.3, dur: 3.6, len: 20, width: 1.5 });
    g.addBeam(e, a + Math.PI, { w, warn: 1.3, dur: 3.6, len: 20, width: 1.5 });
    g.ui.banner('指揮棒：沿著光束旋轉方向跑！', '#ff8ca8');
  }
  // 第二樂章：召喚樂手
  if (phase === 2) {
    ai.addCd -= dt;
    if (ai.addCd <= 0 && g.enemies.length < 150) {
      ai.addCd = 14;
      for (let i = 0; i < 3; i++) g.spawnAround('shooter', 11);
      for (let i = 0; i < 4; i++) g.spawnAround('hum', 11);
    }
  }
  // 終樂章：安全扇區＋慢速光束
  if (phase === 3) {
    if (beams === 0) g.addBeam(e, aim(g, e), { w: 0.65 * (g.rnd() < 0.5 ? -1 : 1), warn: 1.3, dur: 7, len: 20, width: 1.5 });
    ai.sectorCd -= dt;
    if (ai.sectorCd <= 0) {
      ai.sectorCd = 4.8;
      const off = g.rnd() * TAU;
      const safeA = Math.floor(g.rnd() * 6); const safeB = (safeA + 2 + Math.floor(g.rnd() * 3)) % 6;
      for (let i = 0; i < 6; i++) {
        if (i === safeA || i === safeB) continue;
        g.addSector(e, off + i * TAU / 6, off + (i + 1) * TAU / 6, ARENA_RADIUS + 3, 1.8);
      }
      g.ui.banner('離開紅色扇區！', '#ff8ca8');
    }
  }
  return keepDistance(c, 5, 8, e.speed * slowed(e));
}

// ───────────────────────── 潮鳴蟹將：護盾與破盾 ─────────────────────────
function crab(g, e, dt, c) {
  const ai = e.ai ||= { mode: 'walk', t: 2.5, n: 0, broken: false, regen: 0 };
  if (e.shield === undefined) { e.shieldMax = e.maxhp * 0.3; e.shield = e.shieldMax; }
  if (e.shield <= 0 && !ai.broken) {
    ai.broken = true; ai.regen = 14; ai.mode = 'stagger'; ai.t = 3.5;
    stagger(g, e, 3.5, 1.5, '護盾破碎！');
    g.ui.banner('護盾破碎！3.5 秒內傷害 +50%', '#ffe36b');
  }
  if (ai.broken) {
    ai.regen -= dt;
    if (ai.regen <= 0) { ai.broken = false; e.shield = e.shieldMax * 0.6; g.popup(e.x, e.z, e.size, '重組護盾', '#8fe0ff'); }
  }
  if (ai.mode === 'stagger') { ai.t -= dt; if (ai.t <= 0) { ai.mode = 'walk'; ai.t = 1.5; } return still(c); }
  if (ai.mode === 'cast') { ai.t -= dt; if (ai.t <= 0) { ai.mode = 'walk'; ai.t = frac(e) < 0.5 ? 2 : 2.8; } return still(c); }
  ai.t -= dt;
  if (ai.t <= 0) {
    const a = aim(g, e);
    if (ai.n++ % 2 === 0) {
      g.addCone(e, a, 1.75, 4.8, 1.0);
      if (frac(e) < 0.5) g.addCone(e, a + Math.PI, 1.75, 4.8, 1.3);
      g.ui.banner('蟹鉗橫掃：離開扇形！', '#ff8ca8');
    } else {
      g.enemyFan(e, a, 9, 1.5, 3.8);
      g.ui.banner('泡沫齊射！', '#7deaff');
    }
    ai.mode = 'cast'; ai.t = 1.4;
    return still(c);
  }
  return moveOf(c, e.speed * slowed(e));
}

// ───────────────────────── 迴光燈塔：旋轉光束與熄燈破綻 ─────────────────────────
function lighthouse(g, e, dt, c) {
  const ai = e.ai ||= { mode: 'dark', t: 2, n: 0, boltT: 4 };
  const rage = frac(e) < 0.5;
  const beams = g.hazards.filter((h) => h.kind === 'beam' && h.owner === e.id).length;
  if (ai.mode === 'lit') {
    ai.boltT -= dt;
    if (ai.boltT <= 0) { ai.boltT = 4.5; g.enemyFan(e, aim(g, e), 3, 0.5, 4.6); }
    if (beams === 0) {
      ai.mode = 'dark'; ai.t = 3;
      stagger(g, e, 3, 1.5, '熄燈！核心外露');
      g.ui.banner('熄燈！3 秒內傷害 +50%', '#ffe36b');
    }
  } else {
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.mode = 'lit'; ai.boltT = 2;
      const dir = (ai.n++ % 2 ? 1 : -1);
      const a = aim(g, e);
      const w = (rage ? 0.7 : 0.55) * dir;
      g.addBeam(e, a, { w, warn: 1.4, dur: 9.5, len: 17, width: 1.5 });
      if (rage) g.addBeam(e, a + Math.PI, { w, warn: 1.4, dur: 9.5, len: 17, width: 1.5 });
      g.ui.banner('燈塔旋轉光束：繞著它的轉向反方向跑！', '#ff8ca8');
    }
  }
  return keepDistance(c, 5, 8, e.speed * slowed(e));
}

// ───────────────────────── 噪潮母巢：噪卵孵化 ─────────────────────────
function hive(g, e, dt, c) {
  const ai = e.ai ||= { eggCd: 2.5, spitCd: 4, swarmCd: 9 };
  const rage = frac(e) < 0.5;
  ai.eggCd -= dt;
  const eggs = g.enemies.filter((o) => o.owner === e.id && o.type === 'egg' && !o.dead).length;
  if (ai.eggCd <= 0) {
    ai.eggCd = rage ? 6 : 8.5;
    if (eggs < 8) {
      g.ui.banner('噪卵孵化中：6 秒內擊破，否則孵出衝鋒獸！', '#ff8ca8');
      for (let i = 0; i < 3; i++) {
        const a = g.rnd() * TAU; const r = 3 + g.rnd() * 3;
        const pos = clampArena(e.x + Math.cos(a) * r, e.z + Math.sin(a) * r, ARENA_RADIUS - 1);
        const egg = g.spawnProp('egg', pos.x, pos.z, e);
        egg.hatch = 6;
      }
    }
  }
  ai.spitCd -= dt;
  if (ai.spitCd <= 0) { ai.spitCd = 4.2; g.enemyFan(e, aim(g, e), 5, 0.9, 3.4); }
  if (rage) {
    ai.swarmCd -= dt;
    if (ai.swarmCd <= 0 && g.enemies.length < 200) {
      ai.swarmCd = 10;
      g.ui.banner('母巢暴走：蝠群來襲！', '#ff8ca8');
      for (let i = 0; i < 8; i++) g.spawnAround('bat', 11);
    }
  }
  return keepDistance(c, 5, 8, e.speed * slowed(e));
}

export const BOSS_AI = { vanguard, weaver, conductor, crab, lighthouse, hive };
export const BOSS_HINT = {
  vanguard: '衝鋒時讓他撞牆就會破防，傷害 +60%',
  weaver: '先擊破共鳴柱，否則幾乎打不動',
  conductor: '三個樂章，躲光束、躲扇區',
  crab: '打破護盾後有破綻',
  lighthouse: '光束結束後熄燈，是輸出時機',
  hive: '快打掉噪卵，否則孵化衝鋒獸',
};
