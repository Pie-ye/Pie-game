// Hazards, projectiles and zone effects. Pure simulation; the renderer reads `g.hazards`, `g.projectiles`, `g.events`.
import { moveBody, PLAYER } from './solids.js';

export function makeHazards(level) {
  return level.hazards.map((h, i) => ({ ...h, id: i, state: h.state || 'idle', timer: h.timer ?? 0, asleep: 0, active: false, cd: 0, t: 0 }));
}

const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

function spawnProjectile(g, p) {
  g.projectiles.push({ vx: 0, vy: 0, vz: 0, r: 0.5, dmg: 10, life: 12, ...p });
}

export function updateHazards(g, dt) {
  const pl = g.player;
  for (const h of g.hazards) {
    h.t += dt;
    if (h.asleep > 0) { h.asleep -= dt; continue; }
    if (Math.abs(h.y - pl.y) > 40 || Math.abs(h.z - pl.z) > 60) continue;
    switch (h.type) {
      case 'coconut': {
        h.timer -= dt;
        const near = dist2(h.x, h.z, pl.x, pl.z) < 7 && pl.y > h.y - 9 && pl.y < h.y + 2;
        if (h.timer <= 0 && near) {
          h.timer = 5 + g.rng() * 4;
          g.emit('rustle', { x: h.x, y: h.y, z: h.z });
          spawnProjectile(g, { type: 'coconut', x: h.x + (g.rng() - 0.5) * 0.6, y: h.y, z: h.z + 0.4, r: 0.28, dmg: 8, delay: 0.7 });
        } else if (!near) h.timer = Math.max(h.timer, 1);
        break;
      }
      case 'boulder': {
        const tier = g.tierAt(h);
        const climbingHere = tier && pl.y > tier.y0 + 1 && pl.y < tier.y1 - 0.5 && pl.z > tier.zFront - 3 && pl.z < tier.zFront + 4;
        h.timer -= dt;
        if (h.timer <= 0 && climbingHere) {
          h.timer = h.period;
          const x = Math.max(tier.cx - 16, Math.min(tier.cx + 16, pl.x + (g.rng() - 0.5) * 2.5));
          g.emit('rumble', { x, y: tier.y1, z: tier.zFront });
          spawnProjectile(g, { type: h.lava ? 'lavarock' : h.snow ? 'snowball' : 'boulder', x, y: tier.y1 + 0.62, z: tier.zFront - 0.35, vz: 0.9, r: 0.55, dmg: 16, delay: 1.1, big: true });
        } else if (!climbingHere) h.timer = Math.max(h.timer, 1.5);
        break;
      }
      case 'icicle': {
        if (h.state === 'hang') {
          const under = Math.abs(pl.x - h.x) < 2.4 && pl.y < h.y - 0.5 && pl.y > h.y - 9 && Math.abs(pl.z - h.z) < 3;
          if (under) { h.timer += dt; if (h.timer > 0.9) { h.state = 'fall'; g.emit('icicle', { index: h.id }); spawnProjectile(g, { type: 'icicle', x: h.x, y: h.y - 1.2, z: h.z, r: 0.25, dmg: 12 }); h.timer = 0; } }
          else h.timer = Math.max(0, h.timer - dt);
        } else { h.timer += dt; if (h.timer > 30) { h.state = 'hang'; h.timer = 0; g.emit('icicle-reset', { index: h.id }); } }
        break;
      }
      case 'flytrap': {
        h.cd -= dt;
        const bait = g.baitNear(h.x, h.z, 6);
        const target = bait || pl;
        const d = dist2(h.x, h.z, target.x, target.z), dy = Math.abs((target.y ?? pl.y) - h.y);
        h.alert = d < 4.2 && dy < 2;
        if (d < 2.0 && dy < 1.6 && h.cd <= 0) {
          h.cd = 2.6; h.state = 'snap'; h.snapT = 0.5;
          if (!bait && pl.state !== 'faint') {
            g.hurt(9, 'flytrap'); g.v.poisonTicks = Math.max(g.v.poisonTicks, 3);
            const dx = pl.x - h.x, dz = pl.z - h.z, m = Math.hypot(dx, dz) || 1; pl.knock(g, dx / m, dz / m, 5, 4);
          }
          g.emit('snap', { x: h.x, y: h.y, z: h.z });
        }
        if (h.snapT > 0) { h.snapT -= dt; if (h.snapT <= 0) h.state = 'idle'; }
        break;
      }
      case 'bees': {
        if (!h.sx) { h.sx = h.x; h.sy = h.y; h.sz = h.z; }
        const flare = g.flareNear(h.x, h.y, h.z, 9);
        const bait = g.baitNear(h.x, h.z, 12);
        const tgt = bait || pl;
        const d = Math.hypot(h.x - pl.x, h.y - pl.y, h.z - pl.z);
        if (!h.active && !flare && d < 7 && pl.state !== 'faint') { h.active = true; h.chase = 22; g.emit('bees-angry'); }
        if (h.active) {
          h.chase -= dt;
          const dx = tgt.x - h.x, dy = (tgt.y ?? pl.y) + 0.7 - h.y, dz = tgt.z - h.z, m = Math.hypot(dx, dy, dz) || 1;
          const sp = 3.3 * (flare ? -1 : 1);
          h.x += dx / m * sp * dt; h.y += dy / m * sp * dt; h.z += dz / m * sp * dt;
          if (!bait && d < 1.1) { g.v.add('injury', 2.6 * dt); g.v.spend(2.5 * dt); if (!h.stung || h.t - h.stung > 1) { h.stung = h.t; g.emit('sting'); } }
          if (h.chase <= 0 || d > 16) { h.active = false; }
        } else {
          h.x += (h.sx - h.x) * dt; h.y += (h.sy - h.y) * dt; h.z += (h.sz - h.z) * dt;
        }
        break;
      }
      case 'geyser': {
        h.timer -= dt;
        if (h.state === 'idle' && h.timer <= 0) { h.state = 'warn'; h.timer = 1.3; g.emit('geyser-warn', { x: h.x, y: h.y, z: h.z }); }
        else if (h.state === 'warn' && h.timer <= 0) { h.state = 'erupt'; h.timer = 1.5; g.emit('geyser', { x: h.x, y: h.y, z: h.z }); }
        else if (h.state === 'erupt') {
          if (h.timer <= 0) { h.state = 'idle'; h.timer = h.period; }
          const d = dist2(h.x, h.z, pl.x, pl.z);
          if (d < 1.05 && pl.y > h.y - 0.3 && pl.y < h.y + 9 && !h.hit) {
            h.hit = true; g.v.add('hot', 8); g.v.add('injury', 3);
            pl.launch(g, 15.5, (pl.x - h.x) * 1.5, (pl.z - h.z) * 1.5); g.emit('launch');
          }
        } else h.hit = false;
        if (h.state !== 'erupt') h.hit = false;
        break;
      }
      case 'steam': {
        h.timer -= dt;
        if (h.timer <= 0) { h.active = !h.active; h.timer = h.active ? 2.8 : h.period; }
        if (h.active && dist2(h.x, h.z, pl.x, pl.z) < 2.6 && Math.abs(pl.y - h.y) < 4) { g.v.add('hot', 7 * dt); g.v.add('injury', 1.2 * dt); }
        break;
      }
    }
  }
  updateProjectiles(g, dt);
}

function updateProjectiles(g, dt) {
  const pl = g.player;
  for (let i = g.projectiles.length - 1; i >= 0; i--) {
    const p = g.projectiles[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.life -= dt;
    p.vy = Math.max(-30, p.vy - 20 * dt);
    if (p.big && p.vy < -1) p.vz *= Math.max(0, 1 - 4 * dt); // falls hugging the cliff face
    const vyBefore = p.vy;
    const body = { x: p.x, y: p.y - p.r, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz };
    const hit = moveBody(g.world, body, dt, { radius: p.r, height: p.r * 2, step: 0 });
    p.x = body.x; p.y = body.y + p.r; p.z = body.z; p.vx = body.vx; p.vy = body.vy; p.vz = body.vz;
    // player hit
    const dx = pl.x - p.x, dz = pl.z - p.z, dy = (pl.y + PLAYER.height * 0.5) - p.y;
    if (pl.state !== 'faint' && Math.hypot(dx, dz) < p.r + PLAYER.radius && Math.abs(dy) < p.r + PLAYER.height * 0.5 && !p.hitDone) {
      p.hitDone = true; g.hurt(p.dmg, p.type);
      const m = Math.hypot(dx, dz) || 1; pl.knock(g, dx / m || 1, dz / m, 3, 2.5);
      g.emit('smash', { x: p.x, y: p.y, z: p.z, what: p.type }); g.projectiles.splice(i, 1); continue;
    }
    if (p.big && hit.ground && !hit.wallX && !hit.wallZ && vyBefore > -8 && p.life > 0) {
      // rolling across a plateau toward the edge instead of shattering
      p.vz = Math.max(p.vz, 1.6); p.vy = 0; continue;
    }
    if (hit.ground || hit.wallX || hit.wallZ || p.life <= 0) {
      g.emit('smash', { x: p.x, y: p.y, z: p.z, what: p.type });
      g.projectiles.splice(i, 1);
    }
  }
}

// Zone queries → environment flags for Vitals.tick
export function zoneFlags(g) {
  const pl = g.player, f = { exposedCold: false, exposedHot: false, warm: false, sheltered: false, wind: false, dark: false, shrine: null, thorn: false, summit: false, camp: false };
  const x = pl.x, y = pl.y + 0.5, z = pl.z;
  for (const zn of g.level.zones) {
    if (x < zn.x0 || x > zn.x1 || y < zn.y0 || y > zn.y1 || z < zn.z0 || z > zn.z1) continue;
    switch (zn.type) {
      case 'cold': f.exposedCold = true; break;
      case 'heat': f.exposedHot = true; break;
      case 'warm': f.warm = true; f.camp = true; break;
      case 'shelter': f.sheltered = true; break;
      case 'dark': f.dark = true; break;
      case 'shrine': f.shrine = zn; f.camp = true; break;
      case 'thorn': f.thorn = true; break;
      case 'summit': f.summit = true; break;
      case 'wind': f.windZone = zn; break;
    }
  }
  for (const s of g.stoves) if (Math.hypot(s.x - pl.x, s.z - pl.z) < 3.2 && Math.abs(s.y - pl.y) < 3) { f.warm = true; f.camp = true; }
  if (g.lantern) f.lanternWarm = true;
  return f;
}
