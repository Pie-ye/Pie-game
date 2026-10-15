// Player controller: ground / air / wall climb / ceiling shimmy / pole climb / mantle / glide / grapple pull / faint.
// Pure simulation (no rendering). `g` is the Game facade: g.world, g.v (Vitals), g.has(itemId), g.emit(name, data).
import { PLAYER, moveBody } from './solids.js';

export const TUNING = {
  walk: 3.1, run: 5.4, gravity: 21, jump: 8.2, airControl: 6,
  climb: 1.75, climbReach: 0.7, hangDrain: 2.2, moveDrain: 4.2,
  lungeV: 7.6, lungeCost: 16, jumpCost: 6, runCost: 5.5,
  regenIdle: 18, regenMove: 7, terminal: 38, glideFall: 2.4, glideSpeed: 5.2, glideTime: 14,
};
// per-surface-kind climbing modifiers
export const SURFACE = {
  rock:    { speed: 1,    drain: 1,    slide: 0 },
  sand:    { speed: 1.05, drain: 0.9,  slide: 0 },
  moss:    { speed: 0.9,  drain: 1.2,  slide: 0.25 },
  snow:    { speed: 0.9,  drain: 1.15, slide: 0 },
  ice:     { speed: 0.8,  drain: 1.8,  slide: 0.8 },
  hold:    { speed: 1.15, drain: 0.35, slide: 0 },
  crystal: { speed: 1.2,  drain: 0.25, slide: 0 },
  ladder:  { speed: 1.35, drain: 0.12, slide: 0 },
  wood:    { speed: 1.2,  drain: 0.5,  slide: 0 },
  fragile: { speed: 1,    drain: 1,    slide: 0, breaks: 1.3 },
  lava:    { speed: 0.9,  drain: 1.2,  slide: 0, burn: true },
  thorn:   { speed: 0.9,  drain: 1.2,  slide: 0, prick: true },
  basalt:  { speed: 0.95, drain: 1.1,  slide: 0 },
};
const POLE = {
  vine:   { speed: 1.9, hang: 0.7, move: 2.6 },
  rope:   { speed: 2.2, hang: 0.0, move: 1.6 },
  tree:   { speed: 1.6, hang: 2.0, move: 3.8 },
  palm:   { speed: 1.5, hang: 2.4, move: 4.4 },
  bamboo: { speed: 1.4, hang: 2.6, move: 4.8 },
  spire:  { speed: 1.4, hang: 2.6, move: 4.8 },
};
export const CLIMB_STATES = new Set(['climb', 'ceiling', 'pole']);

export class Player {
  constructor(x = 0, y = 0, z = 0) {
    Object.assign(this, { x, y, z, vx: 0, vy: 0, vz: 0, yaw: Math.PI, state: 'air', grounded: false,
      coyote: 0, fallPeak: y, surf: null, pole: null, poleAngle: 0, attachCooldown: 0, lungeCooldown: 0,
      mantle: null, glide: 0, pull: null, breakTimer: 0, ceilingPress: 0, moveAmt: 0, running: false,
      hangTime: 0, pitonAnchored: false, lastGround: { x, y, z }, stun: 0, slip: 0, climbDir: { x: 0, y: 0 } });
  }
  get climbing() { return CLIMB_STATES.has(this.state); }
  get chest() { return this.y + PLAYER.height * 0.58; }

  update(dt, input, g) {
    this.attachCooldown = Math.max(0, this.attachCooldown - dt);
    this.lungeCooldown = Math.max(0, this.lungeCooldown - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.latch = Math.max(0, (this.latch || 0) - dt);
    if (this.latch > 0) input = { ...input, grab: true };
    const v = g.v;
    if (this.state === 'faint') { this.vx = this.vz = 0; return; }
    if (v.down && this.state !== 'faint') { this.faint(g); return; }
    if (v.sleepTimer > 0 && this.state !== 'sleep') { this.release(g); this.state = 'sleep'; }
    if (this.state === 'sleep') { this.stepSleep(dt, g); return; }
    switch (this.state) {
      case 'ground': case 'air': this.stepFree(dt, input, g); break;
      case 'climb': this.stepClimb(dt, input, g); break;
      case 'ceiling': this.stepCeiling(dt, input, g); break;
      case 'pole': this.stepPole(dt, input, g); break;
      case 'mantle': this.stepMantle(dt, g); break;
      case 'glide': this.stepGlide(dt, input, g); break;
      case 'pull': this.stepPull(dt, input, g); break;
    }
  }

  faint(g) { this.release(g); this.state = 'faint'; g.emit('faint'); }
  stepSleep(dt, g) {
    this.vx *= 0.8; this.vz *= 0.8; this.vy -= TUNING.gravity * dt;
    const hit = moveBody(g.world, this, dt);
    if (hit.ground) { this.vy = 0; this.grounded = true; }
    if (g.v.sleepTimer <= 0) this.state = this.grounded ? 'ground' : 'air';
    g.v.restore(dt * 10);
  }
  release(g, impulse = null) {
    if (this.climbing) { this.attachCooldown = 0.25; }
    this.surf = null; this.pole = null; this.fallPeak = this.y;
    this.state = 'air';
    if (impulse) { this.vx += impulse.x || 0; this.vy += impulse.y || 0; this.vz += impulse.z || 0; }
  }
  launch(g, vy, vx = 0, vz = 0) {
    if (this.climbing) this.release(g);
    this.state = 'air'; this.vy = vy; this.vx = vx; this.vz = vz; this.grounded = false; this.fallPeak = this.y; this.attachCooldown = 0.3;
  }
  knock(g, dx, dz, power = 4, up = 3) {
    if (this.climbing) this.release(g);
    this.state = 'air'; this.vx = dx * power; this.vz = dz * power; this.vy = up; this.stun = 0.35; this.attachCooldown = 0.5;
  }

  // ---------- free movement ----------
  stepFree(dt, input, g) {
    const v = g.v, T = TUNING;
    const wantX = Math.cos(input.camYaw) * input.ix - Math.sin(input.camYaw) * input.iy;
    const wantZ = -Math.sin(input.camYaw) * input.ix - Math.cos(input.camYaw) * input.iy;
    const mag = Math.min(1, Math.hypot(wantX, wantZ));
    const heavy = 1 - Math.min(0.22, v.aff.weight * 0.008);
    let speed = T.walk, running = false;
    if (input.run && mag > 0.1 && this.grounded && v.stamina > 1 && this.stun <= 0) { speed = T.run; running = true; }
    if (v.has('fast')) speed *= 1.35;
    speed *= heavy * (this.stun > 0 ? 0.3 : 1) * (g.slowZone ? 0.7 : 1);
    this.running = running;
    const dirX = mag > 0 ? wantX / Math.max(1, Math.hypot(wantX, wantZ)) : 0, dirZ = mag > 0 ? wantZ / Math.max(1, Math.hypot(wantX, wantZ)) : 0;
    const icy = this.grounded && g.onIce && !g.has('spike_boots');
    const accel = this.grounded ? (icy ? 2.2 : 14) : T.airControl;
    const tx = dirX * speed * mag, tz = dirZ * speed * mag;
    const k = Math.min(1, accel * dt);
    this.vx += (tx - this.vx) * k; this.vz += (tz - this.vz) * k;
    if (g.wind) { this.vx += g.wind.x * dt; this.vz += g.wind.z * dt; }
    this.moveAmt = Math.hypot(this.vx, this.vz);
    if (this.moveAmt > 0.4 && this.stun <= 0) this.yaw = Math.atan2(this.vx, this.vz);

    if (this.grounded) this.coyote = 0.12; else this.coyote = Math.max(0, this.coyote - dt);
    if (input.jump && this.coyote > 0 && this.stun <= 0 && v.stamina >= 1) {
      v.spend(T.jumpCost); this.vy = T.jump * (v.has('fast') ? 1.12 : 1); this.grounded = false; this.coyote = 0; this.state = 'air';
      this.fallPeak = this.y; g.emit('jump');
    } else if (input.jump && !this.grounded && g.glideReady) {
      g.tryGlide();
    }
    this.vy = Math.max(-T.terminal, this.vy - T.gravity * dt);
    const wasGrounded = this.grounded;
    const hit = moveBody(g.world, this, dt);
    if (hit.ground && this.vy <= 0.001) {
      if (!wasGrounded && this.state === 'air') this.land(g, hit.ground);
      this.grounded = true; this.state = 'ground'; this.vy = 0;
      g.onIce = hit.ground.kind === 'ice' || hit.ground.kind === 'snow' && false;
      this.lastGround = { x: this.x, y: this.y, z: this.z };
      g.groundBox = hit.ground;
    } else if (!hit.ground) {
      if (this.grounded) { this.fallPeak = this.y; }
      this.grounded = false; this.state = 'air'; g.groundBox = null;
      this.fallPeak = Math.max(this.fallPeak, this.y);
    }
    if (hit.ceiling && this.vy > 0) this.vy = 0;
    // Stamina: running drains, standing recovers.
    if (running) v.spend(T.runCost * dt);
    else if (this.grounded) v.restore(dt * (this.moveAmt < 0.3 ? T.regenIdle : T.regenMove) * (g.restBonus || 1));
    if (running && v.stamina <= 0) this.running = false;
    // Grab: attach to a wall or pole
    if (input.grab && this.attachCooldown <= 0 && this.stun <= 0 && v.stamina > 3) this.tryAttach(input, g);
  }

  land(g, box) {
    const drop = this.fallPeak - this.y;
    g.emit('land', { drop, box });
    if (box.kind === 'bounce') { this.vy = 13; this.grounded = false; this.state = 'air'; this.fallPeak = this.y; g.emit('bounce'); return; }
    if (!g.noFallDamage) {
      const dmg = g.v.fallDamage(drop);
      if (dmg > 0) { g.emit('hurt', { amount: dmg, cause: 'fall' }); this.stun = Math.min(1.2, 0.3 + dmg * 0.04); }
    }
  }

  // ---------- attaching ----------
  tryAttach(input, g) {
    const w = g.world, T = TUNING;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dirs = [[fx, fz]];
    const mag = Math.hypot(input.ix, input.iy);
    if (mag > 0.2) {
      const wx = Math.cos(input.camYaw) * input.ix - Math.sin(input.camYaw) * input.iy;
      const wz = -Math.sin(input.camYaw) * input.ix - Math.cos(input.camYaw) * input.iy;
      dirs.unshift([wx / Math.hypot(wx, wz), wz / Math.hypot(wx, wz)]);
    }
    // poles first when very close
    const pole = w.nearestPole(this.x, this.y, this.z, 0.55);
    if (pole) { this.attachPole(pole, g); return true; }
    let best = null;
    for (const [dx, dz] of dirs) {
      for (const hy of [0.28, 0.62, 0.95]) {
        const hit = w.raycast(this.x, this.y + hy, this.z, dx, 0, dz, T.climbReach);
        if (hit && hit.ny === 0 && hit.box.y1 > this.y + 0.9 && hit.box.kind !== 'bounce' && (!best || hit.t < best.t)) best = hit;
      }
    }
    if (!best) {
      const p2 = w.nearestPole(this.x, this.y, this.z, T.climbReach);
      if (p2) { this.attachPole(p2, g); return true; }
      // jump-up grab of a ledge above head
      return false;
    }
    const kind = best.box.kind;
    if (kind === 'lava' && !input.force) { /* allowed, but it hurts */ }
    this.attachWall(best, g);
    return true;
  }
  attachWall(hit, g) {
    const r = PLAYER.radius;
    const fall = this.fallPeak - this.y;
    this.surf = { box: hit.box, nx: hit.nx, nz: hit.nz };
    // hit point on the wall plane
    if (hit.nx !== 0) this.x = (hit.nx > 0 ? hit.box.x1 : hit.box.x0) + hit.nx * (r + 0.02);
    else this.z = (hit.nz > 0 ? hit.box.z1 : hit.box.z0) + hit.nz * (r + 0.02);
    this.yaw = Math.atan2(-hit.nx, -hit.nz);
    this.state = 'climb'; this.vx = this.vy = this.vz = 0; this.grounded = false; this.hangTime = 0; this.breakTimer = 0;
    if (fall > 2.5) { g.v.spend(6 + fall * 1.5); g.emit('catch', { fall }); }
    this.fallPeak = this.y;
    g.emit('attach', { kind: hit.box.kind });
  }
  attachPole(pole, g) {
    this.pole = pole; this.state = 'pole'; this.vx = this.vy = this.vz = 0; this.grounded = false;
    this.poleAngle = Math.atan2(this.x - pole.x, this.z - pole.z);
    this.snapPole();
    this.fallPeak = this.y; this.hangTime = 0;
    g.emit('attach', { kind: pole.kind });
  }
  snapPole() {
    const p = this.pole, rr = (p.r || 0.15) + PLAYER.radius + 0.02;
    this.x = p.x + Math.sin(this.poleAngle) * rr; this.z = p.z + Math.cos(this.poleAngle) * rr;
    this.yaw = Math.atan2(-Math.sin(this.poleAngle), -Math.cos(this.poleAngle));
  }
  climbCost(kindMult, moving, g, dt) {
    return this.drainRaw((TUNING.hangDrain + (moving ? TUNING.moveDrain : 0)) * kindMult, g, dt);
  }
  drainRaw(rate, g, dt) {
    const v = g.v;
    let c = rate;
    if (g.has('climb_gloves')) c *= 0.78;
    if (g.wind) c *= 1.7;
    c *= g.mods ? g.mods.climb : 1;
    if (this.pitonAnchored) c = 0;
    return v.spend(c * dt);
  }

  // ---------- wall climbing ----------
  stepClimb(dt, input, g) {
    const w = g.world, T = TUNING, v = g.v, r = PLAYER.radius, h = PLAYER.height;
    const s = this.surf, box = s.box;
    if (!box.solid) { this.release(g); return; }
    const tr = { x: s.nz, z: -s.nx };
    const cr = { x: Math.cos(input.camYaw), z: -Math.sin(input.camYaw) };
    const dotR = cr.x * tr.x + cr.z * tr.z;
    const ix = Math.abs(dotR) > 0.35 ? input.ix * Math.sign(dotR) : input.ix;
    const sy = input.iy; // forward key = up the wall
    const mod = SURFACE[box.kind] || SURFACE.rock;
    let kindMult = mod.drain, speedMult = mod.speed;
    let sliding = mod.slide;
    if (box.kind === 'ice') {
      if (g.has('ice_axe')) { kindMult = 0.7; sliding = 0; speedMult = 1.05; }
      else if (g.has('spike_boots')) { kindMult = 1.3; sliding = 0.15; }
    }
    const grip = w.holdNear(this.x - s.nx * 0.3, this.y + h * 0.85, this.z - s.nz * 0.3, 0.8);
    if (grip) { const gm = SURFACE[grip.kind] || SURFACE.hold; kindMult = Math.min(kindMult, gm.drain); speedMult = Math.max(speedMult, gm.speed); sliding = 0; this.onHold = true; } else this.onHold = false;
    if (box.kind === 'moss' && g.has('climb_gloves')) sliding = 0;
    if (g.rain && (box.kind === 'moss' || box.kind === 'rock')) { kindMult *= 1.15; }
    if (v.has('fast')) speedMult *= 1.25;
    const mx = ix, my = sy + (sliding ? -sliding * 0.9 : 0);
    const moving = Math.hypot(ix, sy) > 0.15;
    this.climbDir.x = ix; this.climbDir.y = sy;
    this.moveAmt = Math.hypot(ix, sy);
    if (!this.climbCost(kindMult, moving, g, dt)) { g.emit('exhausted'); this.release(g, { x: s.nx * 1.5 }); return; }
    if (!input.grab) { this.release(g, { x: s.nx * 1.2, z: s.nz * 1.2, y: 1 }); return; }
    // lunge (dyno)
    if (input.jump && this.lungeCooldown <= 0 && v.stamina >= 2) {
      v.spend(T.lungeCost);
      const sx = ix * tr.x * 4, sz = ix * tr.z * 4;
      this.release(g, { x: s.nx * 0.6 + sx, z: s.nz * 0.6 + sz });
      this.vy = T.lungeV * (sy < -0.3 ? 0.4 : 1) * (v.has('fast') ? 1.1 : 1); this.state = 'air'; this.lungeCooldown = 0.4; this.attachCooldown = 0.18;
      g.emit('lunge');
      return;
    }
    // fragile / lava / thorn
    if (mod.breaks) {
      this.breakTimer += dt;
      if (this.breakTimer > mod.breaks) { g.breakBox(box); this.release(g, { x: s.nx * 1, z: s.nz * 1 }); return; }
    }
    if (mod.burn) { v.add('injury', 6 * dt); v.add('hot', 8 * dt); if (g.tickHurt) g.tickHurt('lava', dt); }
    if (mod.prick) { v.add('injury', 5 * dt); }
    // move
    const sp = T.climb * speedMult * (1 - Math.min(0.25, v.aff.weight * 0.01));
    const old = { x: this.x, y: this.y, z: this.z };
    this.vx = tr.x * mx * sp; this.vz = tr.z * mx * sp; this.vy = my * sp;
    if (g.wind) { this.vx += g.wind.x * 0.2; this.vz += g.wind.z * 0.2; }
    const hit = moveBody(w, this, dt, { step: 0 });
    // keep attached: re-snap to the wall plane (only along normal), hold the original standoff
    const plane = s.nx !== 0 ? (s.nx > 0 ? box.x1 : box.x0) : (s.nz > 0 ? box.z1 : box.z0);
    if (s.nx !== 0) this.x = plane + s.nx * (r + 0.02); else this.z = plane + s.nz * (r + 0.02);
    this.vx = this.vy = this.vz = 0;
    this.hangTime += dt;
    // does the surface still exist under the hands / chest / feet?
    const probe = (py) => this.surfaceAt(g, s, py);
    const handsY = this.y + h + 0.1, chestY = this.y + h * 0.58, feetY = this.y + 0.15;
    const nextBox = probe(chestY) || probe(handsY) || probe(feetY);
    if (nextBox) { s.box = nextBox; }
    else {
      // ran off the face: mantle over the top, or slip off
      if (this.tryMantleFromWall(g, s)) return;
      // lateral edge or bottom: undo
      this.x = old.x; this.y = old.y; this.z = old.z;
      if (this.y < box.y0 + 0.2 && sy < 0) { this.release(g); return; }
    }
    // reaching the top of the wall → mantle
    if (my > 0.2 && !probe(this.y + h + 0.22)) this.tryMantleFromWall(g, s);
    // ground contact when descending
    if (sy < -0.3) {
      const gb = w.groundBelow(this.x, this.y + 0.05, this.z, r * 0.5, 0.2);
      if (gb && this.y - gb.y1 < 0.12 && gb !== s.box && gb.y1 <= this.y + 0.12) { this.y = gb.y1; this.state = 'ground'; this.surf = null; this.grounded = true; return; }
    }
    // concave corner: blocked by a ceiling while pressing up → shimmy under it
    if (hit.ceiling && sy > 0.3) {
      this.ceilingPress += dt;
      if (this.ceilingPress > 0.2) { this.attachCeiling(hit.ceiling, g); return; }
    } else this.ceilingPress = Math.max(0, this.ceilingPress - dt);
  }
  // Solid box (with matching face) near the player's body at height py, or null.
  surfaceAt(g, s, py) {
    const r = PLAYER.radius, d = r + 0.12;
    const x = this.x - s.nx * d, z = this.z - s.nz * d;
    const b = g.world.pointInside(x, py, z);
    return b && b.kind !== 'bounce' ? b : null;
  }
  tryMantleFromWall(g, s) {
    const w = g.world, h = PLAYER.height;
    const x = this.x - s.nx * 0.55, z = this.z - s.nz * 0.55;
    // find a top surface under that point close to the hands
    let top = null;
    for (const b of w.query(x - 0.05, this.y - 0.6, z - 0.05, x + 0.05, this.y + h + 0.7, z + 0.05)) {
      if (b.y1 > this.y + 0.2 && b.y1 < this.y + h + 0.55 && x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) {
        if (!top || b.y1 > top.y1) top = b;
      }
    }
    if (!top || w.pointInside(x, top.y1 + h * 0.6, z)) return false;
    this.beginMantle(g, { x, y: top.y1, z });
    return true;
  }
  beginMantle(g, to) {
    this.mantle = { from: { x: this.x, y: this.y, z: this.z }, to, t: 0, dur: 0.55 };
    this.state = 'mantle'; this.surf = null; this.pole = null; this.vx = this.vy = this.vz = 0;
    g.v.spend(4);
    g.emit('mantle');
  }
  stepMantle(dt, g) {
    const m = this.mantle; m.t += dt;
    const k = Math.min(1, m.t / m.dur), e = k * k * (3 - 2 * k);
    this.x = m.from.x + (m.to.x - m.from.x) * e;
    this.z = m.from.z + (m.to.z - m.from.z) * e;
    const rise = Math.min(1, e * 1.6);
    this.y = m.from.y + (m.to.y - m.from.y) * rise;
    this.yaw = Math.atan2(m.to.x - m.from.x, m.to.z - m.from.z) || this.yaw;
    if (k >= 1) { this.state = 'ground'; this.grounded = true; this.mantle = null; this.vx = this.vy = this.vz = 0; this.fallPeak = this.y; }
  }

  // ---------- ceiling shimmy ----------
  attachCeiling(box, g) {
    this.surf = { box, nx: 0, ny: -1, nz: 0 }; this.state = 'ceiling'; this.y = box.y0 - PLAYER.height - 0.08;
    this.vx = this.vy = this.vz = 0; this.hangTime = 0; this.ceilingPress = 0; g.emit('attach', { kind: 'ceiling' });
  }
  stepCeiling(dt, input, g) {
    const w = g.world, T = TUNING, v = g.v, h = PLAYER.height, r = PLAYER.radius;
    const box = this.surf.box;
    if (!box.solid || !input.grab) { this.release(g); return; }
    const wantX = Math.cos(input.camYaw) * input.ix - Math.sin(input.camYaw) * input.iy;
    const wantZ = -Math.sin(input.camYaw) * input.ix - Math.cos(input.camYaw) * input.iy;
    const mag = Math.min(1, Math.hypot(wantX, wantZ));
    this.moveAmt = mag;
    if (!this.climbCost(2.1, mag > 0.1, g, dt)) { g.emit('exhausted'); this.release(g); return; }
    if (input.jump && v.stamina > 2) { v.spend(T.lungeCost); this.release(g); this.vy = -2; this.vx = wantX * 3; this.vz = wantZ * 3; return; }
    const sp = 1.25 * (v.has('fast') ? 1.25 : 1);
    const tx = this.x + (mag > 0 ? wantX / Math.hypot(wantX, wantZ) : 0) * mag * sp * dt;
    const tz = this.z + (mag > 0 ? wantZ / Math.hypot(wantX, wantZ) : 0) * mag * sp * dt;
    if (mag > 0.1) this.yaw = Math.atan2(wantX, wantZ);
    // blocked horizontally by a wall (the cliff behind the overhang)?
    const probeY = this.y + h * 0.5;
    const blocked = w.pointInside(tx + Math.sign(tx - this.x) * r, probeY, tz + Math.sign(tz - this.z) * r);
    if (!blocked || blocked === box) { this.x = tx; this.z = tz; }
    // still under the slab?
    const under = w.pointInside(this.x, box.y0 + 0.05, this.z);
    if (!under || under !== box) {
      // beyond the lip: swing up onto the top if possible
      const hint = { x: this.x, z: this.z };
      let landed = null;
      for (const b of w.query(this.x - 1.2, box.y0 - 0.2, this.z - 1.2, this.x + 1.2, box.y1 + 0.2, this.z + 1.2)) {
        if (b === box && b.y1 - this.y < h + 2) landed = b;
      }
      if (landed) {
        const tx2 = Math.min(landed.x1 - 0.5, Math.max(landed.x0 + 0.5, this.x)), tz2 = Math.min(landed.z1 - 0.5, Math.max(landed.z0 + 0.5, this.z));
        if (!w.pointInside(tx2, landed.y1 + 0.6, tz2)) { this.beginMantle(g, { x: tx2, y: landed.y1, z: tz2 }); return; }
      }
      this.x -= (tx - this.x) * 0; // stay
      this.release(g);
    }
  }

  // ---------- pole climbing ----------
  stepPole(dt, input, g) {
    const T = TUNING, v = g.v, h = PLAYER.height;
    const p = this.pole;
    if (!p || p.active === false) { this.release(g); return; }
    const mod = POLE[p.kind] || POLE.vine;
    const moving = Math.abs(input.iy) > 0.15 || Math.abs(input.ix) > 0.15;
    this.moveAmt = Math.hypot(input.ix, input.iy);
    if (!this.drainRaw(moving ? mod.move : mod.hang, g, dt)) { g.emit('exhausted'); this.release(g); return; }
    if (!input.grab) { this.release(g); this.vx = Math.sin(this.poleAngle) * 1.5; this.vz = Math.cos(this.poleAngle) * 1.5; return; }
    if (input.jump && v.stamina >= 2) {
      v.spend(T.lungeCost);
      this.release(g, { x: Math.sin(this.poleAngle) * 4 + Math.cos(input.camYaw) * input.ix * 3, z: Math.cos(this.poleAngle) * 4 });
      this.vy = T.lungeV * 0.9; this.lungeCooldown = 0.4; this.attachCooldown = 0.2; g.emit('lunge'); return;
    }
    const sp = mod.speed * (v.has('fast') ? 1.25 : 1);
    this.y += input.iy * sp * dt;
    this.poleAngle -= input.ix * 1.6 * dt;
    if (p.sway) this.poleAngle += Math.sin(g.time * 1.4) * 0.002;
    this.snapPole();
    this.hangTime += dt;
    if (this.y + h > p.y1 + 0.25) {
      // top of pole: step onto something nearby or hold
      this.y = Math.min(this.y, p.y1 - h + 0.25);
      const top = this.findTopNear(g);
      if (top && input.iy > 0) { this.beginMantle(g, top); return; }
    }
    if (this.y < p.y0) { this.y = p.y0; if (input.iy < 0) { this.state = 'air'; this.pole = null; } }
    const gb = g.world.groundBelow(this.x, this.y + 0.05, this.z, 0.2, 0.2);
    if (gb && input.iy < -0.3 && this.y - gb.y1 < 0.1) { this.y = gb.y1; this.state = 'ground'; this.pole = null; this.grounded = true; }
  }
  findTopNear(g) {
    const w = g.world, h = PLAYER.height;
    const p = this.pole;
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4;
      for (const dist of [0.6, 1.0, 1.4]) {
        const x = p.x + Math.sin(ang) * dist, z = p.z + Math.cos(ang) * dist;
        const b = w.groundBelow(x, this.y + h + 0.8, z, 0.25, 2.2);
        if (b && b.y1 > this.y + 0.4 && b.y1 < this.y + h + 0.8 && !w.pointInside(x, b.y1 + 0.7, z)) return { x, y: b.y1, z };
      }
    }
    return null;
  }

  // ---------- glide & pull ----------
  startGlide() { this.state = 'glide'; this.glide = TUNING.glideTime; this.fallPeak = this.y; }
  stepGlide(dt, input, g) {
    const T = TUNING;
    this.glide -= dt;
    const wantX = Math.cos(input.camYaw) * input.ix - Math.sin(input.camYaw) * input.iy;
    const wantZ = -Math.sin(input.camYaw) * input.ix - Math.cos(input.camYaw) * input.iy;
    const mag = Math.hypot(input.ix, input.iy) > 0.05 ? 1 : 0.35;
    const dirx = mag > 0.5 ? wantX / (Math.hypot(wantX, wantZ) || 1) : Math.sin(this.yaw);
    const dirz = mag > 0.5 ? wantZ / (Math.hypot(wantX, wantZ) || 1) : Math.cos(this.yaw);
    this.vx += (dirx * T.glideSpeed * mag - this.vx) * Math.min(1, dt * 3);
    this.vz += (dirz * T.glideSpeed * mag - this.vz) * Math.min(1, dt * 3);
    if (g.wind) { this.vx += g.wind.x * dt * 0.6; this.vz += g.wind.z * dt * 0.6; }
    this.vy = Math.max(-T.glideFall, this.vy - 8 * dt);
    if (g.updraft) this.vy = Math.max(this.vy, g.updraft);
    this.yaw = Math.atan2(this.vx, this.vz);
    const hit = moveBody(g.world, this, dt, { step: 0 });
    this.fallPeak = this.y; // gliding resets fall damage
    if (hit.ground) { this.state = 'ground'; this.grounded = true; this.vy = 0; this.glide = 0; return; }
    if (this.glide <= 0 || input.jump && this.glideReleaseOk) { this.state = 'air'; this.glide = 0; }
    if (input.grab && this.attachCooldown <= 0) { this.tryAttach(input, g); }
  }
  startPull(target, wall) { this.pull = { target, wall, t: 0 }; this.state = 'pull'; this.vx = this.vy = this.vz = 0; this.surf = null; this.pole = null; }
  stepPull(dt, input, g) {
    const p = this.pull; p.t += dt;
    const dx = p.target.x - this.x, dy = p.target.y - this.y, dz = p.target.z - this.z;
    const d = Math.hypot(dx, dy, dz), step = 20 * dt;
    this.yaw = Math.atan2(dx, dz) || this.yaw;
    if (d <= step + 0.05 || p.t > 2.5) {
      this.x = p.target.x; this.y = p.target.y; this.z = p.target.z; this.pull = null;
      this.fallPeak = this.y;
      if (p.wall) { this.attachWall(p.wall, g); this.latch = 1.4; } else this.state = 'air';
      return;
    }
    this.x += dx / d * step; this.y += dy / d * step; this.z += dz / d * step;
    this.fallPeak = this.y;
  }
}
