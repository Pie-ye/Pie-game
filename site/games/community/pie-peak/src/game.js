// Game facade: world, player, vitals, inventory, loot, hazards and item effects. No rendering.
import { generate, biomeAt } from './worldgen.js';
import { Player, TUNING } from './player.js';
import { Vitals } from './status.js';
import { ITEMS, itemWeightTotal, LOOT } from './items.js';
import { updateHazards, makeHazards, zoneFlags } from './hazards.js';
import { PLAYER } from './solids.js';
import { mulberry32 } from './rng.js';

const BASE_SLOTS = 4;

export class Game {
  constructor(seed, opts = {}) {
    this.seed = seed;
    this.rng = mulberry32(seed ^ 0x9e3779b1);
    this.level = generate(seed);
    this.world = this.level.world;
    this.v = new Vitals();
    this.character = opts.character || 'phoebe';
    this.mods = this.character === 'fluorolo' ? { climb: 1, cold: 0.7 } : { climb: 0.95, cold: 1 };
    this.player = new Player(this.level.start.x, this.level.start.y, this.level.start.z);
    this.player.yaw = Math.PI;
    this.slots = [];
    this.selected = 0;
    this.time = 0;
    this.events = [];
    this.hazards = makeHazards(this.level);
    this.projectiles = [];
    this.stoves = []; this.flares = []; this.baits = []; this.bombs = []; this.ropes = []; this.pitons = [];
    this.lantern = false;
    this.items = this.level.items.map((it, i) => ({ ...it, id: it.id, uid: i, taken: false }));
    this.luggage = this.level.luggage;
    this.shrines = this.level.shrines;
    this.checkpoint = { x: this.level.start.x, y: 0, z: this.level.start.z, name: '海灘' };
    this.stats = { maxAlt: 0, badges: 0, opened: 0, falls: 0, deaths: 0, itemsUsed: 0, distance: 0, shrines: 0 };
    this.mode = 'play';          // play | over | won
    this.flags = {};
    this.wind = null; this.rain = false; this.updraft = 0;
    this.toastLog = [];
    this.revealUntil = 0;
    this.glideReady = false; this.groundBox = null; this.onIce = false; this.slowZone = false;
    this.cooldowns = { bedroll: 0 };
    this.openProgress = 0; this.openTarget = null;
    this.env = {};
    this.biome = this.level.biomes[0];
    this.lastAlt = 0;
    // starter kit: a snack so the first lesson is about eating, not dying
    this.give('snack_pack');
    this.syncWeight();
  }

  // ---------- helpers used by Player / hazards ----------
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  toast(msg, tone = '') { this.emit('toast', { msg, tone }); }
  refuse(msg) { this.toast(msg, 'warn'); return false; }
  has(id) { return this.slots.some((s) => s && s.id === id); }
  tierAt(h) { return this.level.tiers.find((t) => h.y >= t.y0 - 0.5 && h.y <= t.y1 + 0.5 && h.z <= t.zFront + 12 && h.z >= t.zBack - 1); }
  baitNear(x, z, r) { return this.baits.find((b) => Math.hypot(b.x - x, b.z - z) < r) || null; }
  flareNear(x, y, z, r) { return this.flares.find((f) => Math.hypot(f.x - x, f.y - y, f.z - z) < r) || null; }
  hurt(amount, cause) {
    this.v.add('injury', amount);
    this.emit('hurt', { amount, cause });
  }
  breakBox(box) { this.world.removeBox(box); this.emit('break', { box }); }
  get capacity() { return BASE_SLOTS + (this.has('backpack') ? 3 : 0); }

  // ---------- inventory ----------
  syncWeight() {
    this.v.setWeight(itemWeightTotal(this.slots) * 1.4);
  }
  give(id) {
    const def = ITEMS[id];
    if (def.kind === 'badge') { this.stats.badges++; this.emit('badge'); this.toast(`獲得童軍徽章（${this.stats.badges}）`, 'good'); return true; }
    const idx = this.slots.findIndex((s) => !s);
    if (idx < 0 && this.slots.length >= this.capacity) return false;
    const inst = { id, charges: def.charges || 0 };
    if (idx >= 0) this.slots[idx] = inst; else this.slots.push(inst);
    this.syncWeight();
    return true;
  }
  take(index) {
    const s = this.slots[index];
    if (!s) return;
    this.slots[index] = null;
    while (this.slots.length && !this.slots[this.slots.length - 1]) this.slots.pop();
    this.syncWeight();
    return s;
  }
  selectSlot(i) { this.selected = Math.max(0, Math.min(this.capacity - 1, i)); }
  useSelected() { return this.use(this.selected); }
  use(index) {
    const s = this.slots[index];
    if (!s) return false;
    const def = ITEMS[s.id];
    if (this.player.state === 'faint' || this.mode !== 'play') return false;
    this._using = s;
    const ok = def.use(this);
    this._using = null;
    if (ok) {
      this.stats.itemsUsed++;
      if (def.charges) { s.charges--; if (s.charges <= 0) this.take(index); }
      else if (def.kind !== 'tool' || def.consume !== false) { if (!['bedroll', 'lantern_camp', 'binoculars'].includes(s.id)) this.take(index); }
      this.syncWeight();
      this.emit('use', { id: s.id });
    }
    return ok;
  }
  drop(index) {
    const s = this.take(index);
    if (!s) return;
    const dx = this.player.x + Math.sin(this.player.yaw) * 0.9, dz = this.player.z + Math.cos(this.player.yaw) * 0.9;
    const gb = this.world.groundBelow(dx, this.player.y + 0.6, dz, 0.1, 60);
    this.items.push({ id: s.id, x: dx, y: gb ? gb.y1 : this.player.y, z: dz, uid: this.items.length, taken: false, charges: s.charges, dropped: true });
    this.toast(`丟下 ${ITEMS[s.id].name}`);
  }

  // ---------- item effects ----------
  placeRope() {
    const p = this.player;
    let x = p.x, z = p.z;
    if (!p.climbing) { x += Math.sin(p.yaw) * 1.1; z += Math.cos(p.yaw) * 1.1; }
    const y1 = p.y + (p.climbing ? 1.3 : 0.4);
    const gb = this.world.groundBelow(x, y1 - 0.5, z, 0.2, 40);
    const y0 = Math.max(gb ? gb.y1 : y1 - 14, y1 - 14);
    if (y1 - y0 < 2) return this.refuse('這裡不需要繩子');
    const rope = this.world.addPole({ x, z, y0, y1, kind: 'rope', r: 0.05 });
    this.ropes.push(rope);
    this.emit('rope', { pole: rope });
    this.toast('繩子垂下了', 'good');
    return true;
  }
  placePiton() {
    const p = this.player;
    if (!(p.state === 'climb' || p.state === 'ceiling' || p.state === 'pole')) return this.refuse('要在攀爬時才能釘岩釘');
    const pt = { x: p.x, y: p.y + 1.0, z: p.z, nx: p.surf ? p.surf.nx : 0, nz: p.surf ? p.surf.nz : 0 };
    this.pitons.push(pt); this.emit('piton', pt);
    this.toast('岩釘固定！在這裡休息不耗體力', 'good');
    return true;
  }
  aimRay() { return this.aim || { ox: this.player.x, oy: this.player.y + 1, oz: this.player.z, dx: Math.sin(this.player.yaw), dy: 0.3, dz: Math.cos(this.player.yaw) }; }
  fireGrapple() {
    const a = this.aimRay(), p = this.player;
    const hit = this.world.raycast(a.ox, a.oy, a.oz, a.dx, a.dy, a.dz, 24);
    if (!hit) return this.refuse('射程內沒有可以勾住的地方');
    const px = a.ox + a.dx * hit.t, py = a.oy + a.dy * hit.t, pz = a.oz + a.dz * hit.t;
    let target, wall = null;
    if (hit.ny === 0) {
      const r = PLAYER.radius + 0.04;
      target = { x: px + hit.nx * r, y: py - 0.8, z: pz + hit.nz * r };
      wall = { box: hit.box, nx: hit.nx, nz: hit.nz, t: 0 };
    } else if (hit.ny > 0) target = { x: px, y: py + 0.05, z: pz };
    else return this.refuse('鉤不住天花板');
    this.emit('grapple', { from: { x: p.x, y: p.y + 0.9, z: p.z }, to: { x: px, y: py, z: pz } });
    p.startPull(target, wall);
    this.toast('鏈條發射！', 'good');
    return true;
  }
  reloadGrapple(n) {
    const gun = this.slots.find((s) => s && s.id === 'grapple_gun');
    if (!gun) return this.refuse('需要先有鏈條發射槍');
    gun.charges += n; this.toast(`鉤爪 +${n}`, 'good'); return true;
  }
  startGlide() {
    const p = this.player;
    if (p.grounded || p.state === 'ground') return this.refuse('要在空中才能撐開滑翔傘');
    if (p.climbing) { p.release(this); }
    p.startGlide(); this.emit('glide'); return true;
  }
  tryGlide() {
    const idx = this.slots.findIndex((s) => s && s.id === 'glider_umbrella');
    if (idx >= 0 && this.player.vy < -2) this.use(idx);
  }
  fireDart() {
    const a = this.aimRay();
    let best = null, bd = 1e9;
    for (const h of this.hazards) {
      if (!['flytrap', 'bees'].includes(h.type) || h.asleep > 0) continue;
      const dx = h.x - a.ox, dy = h.y + 0.5 - a.oy, dz = h.z - a.oz, d = Math.hypot(dx, dy, dz);
      if (d > 16) continue;
      const dot = (dx * a.dx + dy * a.dy + dz * a.dz) / d;
      if (dot > 0.93 && d < bd) { bd = d; best = h; }
    }
    this.emit('dart', { from: { x: a.ox, y: a.oy, z: a.oz }, to: best ? { x: best.x, y: best.y + 0.5, z: best.z } : { x: a.ox + a.dx * 12, y: a.oy + a.dy * 12, z: a.oz + a.dz * 12 } });
    if (!best) { this.toast('沒有射中目標', 'warn'); return true; }
    best.asleep = 20; best.active = false; this.toast('目標睡著了 😴', 'good'); return true;
  }
  toggleLantern() { this.lantern = !this.lantern; this.toast(this.lantern ? '提燈點亮' : '提燈熄滅'); return true; }
  throwFlare() {
    const p = this.player;
    this.flares.push({ x: p.x + Math.sin(p.yaw) * 1.2, y: p.y + 0.8, z: p.z + Math.cos(p.yaw) * 1.2, until: this.time + 40 });
    this.emit('flare'); this.toast('信號彈點燃', 'good'); return true;
  }
  useBinoculars() {
    this.revealUntil = this.time + 40; this.toast('偵測 70 公尺內的目標', 'good'); this.emit('reveal'); return true;
  }
  placeStove() {
    const p = this.player;
    if (!p.grounded) return this.refuse('要站穩才能架爐子');
    this.stoves.push({ x: p.x + Math.sin(p.yaw) * 0.9, y: p.y, z: p.z + Math.cos(p.yaw) * 0.9, until: this.time + 90 });
    this.emit('stove'); this.toast('爐子點燃：範圍內取暖、恢復', 'good'); return true;
  }
  sleepBedroll() {
    const p = this.player;
    if (!p.grounded) return this.refuse('要站穩才能睡覺');
    if (this.time < this.cooldowns.bedroll) return this.refuse('剛睡醒，睡不著');
    this.v.sleepTimer = 4.5; this.v.stamina = this.v.cap; this.v.add('injury', -15); this.v.add('hunger', 14);
    this.cooldowns.bedroll = this.time + 120; this.toast('呼呼…睡飽了', 'good'); return true;
  }
  throwDynamite() {
    const p = this.player;
    this.bombs.push({ x: p.x + Math.sin(p.yaw) * 1.4, y: p.y + 0.8, z: p.z + Math.cos(p.yaw) * 1.4, vx: Math.sin(p.yaw) * 3, vy: 3, vz: Math.cos(p.yaw) * 3, t: 3 });
    this.emit('fuse'); this.toast('快跑！3 秒後爆炸', 'warn'); return true;
  }
  dropBait() {
    const p = this.player;
    this.baits.push({ x: p.x + Math.sin(p.yaw) * 1.5, y: p.y, z: p.z + Math.cos(p.yaw) * 1.5, until: this.time + 25 });
    this.toast('誘餌放好了', 'good'); return true;
  }
  explode(b) {
    const R = 4.2;
    for (const box of this.world.boxes) {
      if (!box.solid || !(box.rubble || box.fragile || box.kind === 'fragile' || box.kind === 'rubble')) continue;
      const cx = Math.max(box.x0, Math.min(b.x, box.x1)), cy = Math.max(box.y0, Math.min(b.y, box.y1)), cz = Math.max(box.z0, Math.min(b.z, box.z1));
      if (Math.hypot(cx - b.x, cy - b.y, cz - b.z) < R) this.breakBox(box);
    }
    const p = this.player, d = Math.hypot(p.x - b.x, p.y + 0.5 - b.y, p.z - b.z);
    if (d < 3.2) { this.hurt(18, 'bomb'); const m = Math.hypot(p.x - b.x, p.z - b.z) || 1; p.knock(this, (p.x - b.x) / m, (p.z - b.z) / m, 6, 5); }
    this.emit('explode', { x: b.x, y: b.y, z: b.z });
  }

  // ---------- interaction ----------
  nearest(list, range, filter = () => true) {
    const p = this.player; let best = null, bd = range;
    for (const o of list) {
      if (!filter(o)) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z) + Math.abs(o.y - p.y) * 0.6;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  interactTarget() {
    const loose = this.nearest(this.items, 1.7, (o) => !o.taken);
    if (loose) return { kind: 'item', ref: loose, label: `撿起 ${ITEMS[loose.id].name}` };
    const lug = this.nearest(this.luggage, 2.0, (o) => !o.opened);
    if (lug) return { kind: 'luggage', ref: lug, label: '打開行李箱（按住 E）' };
    const sh = this.nearest(this.shrines, 3.2);
    if (sh) return { kind: 'shrine', ref: sh, label: sh.used ? '祭壇（已祈禱）' : '向祭壇祈禱（E）' };
    return null;
  }
  interact(held, dt) {
    const t = this.interactTarget();
    if (!t) { this.openProgress = 0; this.openTarget = null; return null; }
    if (t.kind === 'item' && held) {
      if (this.openTarget !== t.ref) { this.openTarget = t.ref; this.openProgress = 0; }
      return this.pickup(t.ref);
    }
    if (t.kind === 'luggage') {
      if (held) {
        if (this.openTarget !== t.ref) { this.openTarget = t.ref; this.openProgress = 0; }
        this.openProgress += dt / 0.9;
        if (this.openProgress >= 1) { this.openLuggage(t.ref); this.openProgress = 0; this.openTarget = null; }
      } else this.openProgress = 0;
    }
    if (t.kind === 'shrine' && held && !this._shrineLatch) { this._shrineLatch = true; this.pray(t.ref); }
    if (!held) this._shrineLatch = false;
    return t;
  }
  pickup(o) {
    if (o.taken) return;
    if (this.give(o.id)) {
      o.taken = true; this.emit('pickup', { id: o.id });
      if (ITEMS[o.id].kind !== 'badge') this.toast(`獲得 ${ITEMS[o.id].name}`);
      if (o.charges) { const s = this.slots.find((x) => x && x.id === o.id); if (s && o.dropped) s.charges = o.charges; }
    } else if (!this._fullWarn || this.time - this._fullWarn > 1.5) { this._fullWarn = this.time; this.refuse('道具欄已滿（Q 丟棄）'); }
  }
  openLuggage(l) {
    l.opened = true; this.stats.opened++;
    this.emit('luggage', { ref: l });
    let i = 0;
    for (const id of l.loot) {
      if (!this.give(id)) this.items.push({ id, x: l.x + (i++ - 0.5) * 0.7, y: l.y, z: l.z + 0.9, uid: this.items.length, taken: false });
      else if (ITEMS[id].kind !== 'badge') this.toast(`獲得 ${ITEMS[id].name}`, 'good');
    }
  }
  pray(sh) {
    if (sh.used) { this.toast('祭壇已經祈禱過了'); return; }
    sh.used = true; this.stats.shrines++;
    this.v.stamina = this.v.cap;
    for (const k of ['injury', 'poison', 'cold', 'hot', 'drowsy']) this.v.add(k, -this.v.aff[k] * 0.7);
    this.v.add('hunger', -25); this.v.poisonTicks = 0;
    this.checkpoint = { x: sh.x, y: sh.y, z: sh.z, name: sh.name };
    this.emit('shrine', { ref: sh }); this.toast(`${sh.name}祭壇：已恢復，並記錄重生點`, 'good');
  }

  // ---------- life cycle ----------
  onFaint() {
    const idx = this.slots.findIndex((s) => s && s.id === 'revive_star');
    if (idx >= 0) {
      this.take(idx);
      for (const k of ['injury', 'poison', 'cold', 'hot', 'drowsy', 'hunger']) this.v.add(k, -this.v.aff[k] * 0.6);
      this.v.stamina = Math.min(this.v.cap, 50);
      this.player.state = 'air'; this.player.vy = 0; this.player.stun = 1;
      this.emit('revive'); this.toast('⭐ 復活星星救了你！', 'good');
      return;
    }
    this.mode = 'over';
    this.stats.deaths++;
    this.emit('over');
  }
  respawn() {
    const c = this.checkpoint, p = this.player;
    // penalty: lose half of the inventory (keep the first item slot of each kind of passive)
    for (let i = this.slots.length - 1; i >= 0; i--) if (this.slots[i] && this.rng() < 0.5) this.slots[i] = null;
    while (this.slots.length && !this.slots[this.slots.length - 1]) this.slots.pop();
    this.v = Object.assign(new Vitals(), { });
    this.v.add('hunger', 20);
    Object.assign(p, new Player(c.x, c.y + 0.05, c.z), { state: 'air', yaw: Math.PI });
    this.syncWeight();
    this.projectiles.length = 0;
    this.mode = 'play';
    this.emit('respawn'); this.toast(`在${c.name}祭壇醒來，丟失了部分行李`, 'warn');
  }
  win() { if (this.mode === 'play') { this.mode = 'won'; this.emit('win'); } }
  score() {
    const s = this.stats;
    return Math.round(s.maxAlt * 10 + s.badges * 500 + s.shrines * 200 + Math.max(0, 1800 - this.time) * (this.mode === 'won' ? 2 : 0) + (this.mode === 'won' ? 5000 : 0) - s.deaths * 300);
  }

  // ---------- main update ----------
  update(dt, input) {
    if (this.mode !== 'play') return;
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.cooldowns.bedroll = Math.max(this.cooldowns.bedroll, 0);
    const p = this.player;
    this.aim = input.aim;
    this.glideReady = this.has('glider_umbrella');
    // environment
    const f = zoneFlags(this);
    this.env = f;
    this.rain = this.biome.id === 'jungle' && ((this.time % 90) < 35);
    this.wind = null;
    if (f.windZone) {
      const zn = f.windZone, ph = (this.time % zn.period);
      if (ph < 3.6) { const s = Math.sin(ph / 3.6 * Math.PI); this.wind = { x: zn.dir * 14 * s, z: 0, gust: s }; }
    }
    this.slowZone = false;
    const hot = f.exposedHot, cold = f.exposedCold;
    this.v.tick(dt, { exposedCold: cold, exposedHot: hot, warm: f.warm || (this.lantern && cold && false), sheltered: f.sheltered, coldMul: this.mods.cold, wind: !!this.wind || (this.biome.id === 'alpine' && p.y > this.biome.y0 + 20), camp: f.camp,
      resting: p.grounded });
    if (this.lantern && cold) this.v.add('cold', -dt * 0.35);
    // equipment hooks
    this.restBonus = f.warm || f.shrine ? 1.5 : 1;
    // stoves tick
    this.stoves = this.stoves.filter((s) => s.until > this.time);
    for (const s of this.stoves) if (Math.hypot(s.x - p.x, s.z - p.z) < 3.2) { this.v.restore(dt * 4); this.v.add('injury', -dt * 0.8); }
    this.flares = this.flares.filter((x) => x.until > this.time);
    this.baits = this.baits.filter((x) => x.until > this.time);
    // bombs
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]; b.t -= dt; b.vy -= 20 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const g = this.world.groundBelow(b.x, b.y + 0.2, b.z, 0.1, 3);
      if (g && b.y < g.y1 + 0.15) { b.y = g.y1 + 0.15; b.vy = 0; b.vx *= 0.8; b.vz *= 0.8; }
      if (b.t <= 0) { this.explode(b); this.bombs.splice(i, 1); }
    }
    // piton anchoring: hanging near a piton is free
    p.pitonAnchored = false;
    if (p.climbing) for (const pt of this.pitons) if (Math.hypot(pt.x - p.x, pt.y - (p.y + 1), pt.z - p.z) < 1.3) { p.pitonAnchored = true; break; }
    // player + hazards
    p.update(dt, input, this);
    this.consumeEvents(p);
    updateHazards(this, dt);
    this.contactHazards(dt, f);
    // pickups / interaction
    this.interact(!!input.use, dt);
    this.updateExtras(dt);
    // altitude / biome bookkeeping
    this.stats.maxAlt = Math.max(this.stats.maxAlt, p.y);
    this.biome = biomeAt(this.level, p.y);
    if (this.biome.index !== this.lastBiome) { if (this.lastBiome !== undefined) this.emit('biome', { biome: this.biome }); this.lastBiome = this.biome.index; }
    if (f.summit) this.win();
    // safety net: fell out of the world
    if (p.y < -25) { const c = this.checkpoint; p.x = c.x; p.y = c.y + 0.5; p.z = c.z; p.vy = 0; this.hurt(15, 'void'); }
    // stay inside the mountain's width
    p.x = Math.max(-46, Math.min(46, p.x));
    p.z = Math.min(p.z, 60);
  }
  updateExtras(dt) {
    const p = this.player;
    // Reggie smells unopened luggage nearby
    this._sniffT = (this._sniffT || 0) - dt;
    if (this._sniffT <= 0) {
      this._sniffT = 1;
      for (const l of this.luggage) {
        if (l.opened || l.sniffed) continue;
        if (Math.hypot(l.x - p.x, l.z - p.z) < 13 && Math.abs(l.y - p.y) < 9) { l.sniffed = true; this.emit('sniff'); this.toast('🦭 瑞吉聞到行李箱的味道了！', 'good'); break; }
      }
    }
    // wall in front → tell the player they can grab
    this.nearWall = false;
    if (!p.climbing && (p.state === 'ground' || p.state === 'air')) {
      const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
      const hit = this.world.raycast(p.x, p.y + 0.6, p.z, fx, 0, fz, 0.9);
      this.nearWall = !!(hit && hit.ny === 0 && hit.box.y1 > p.y + 0.9);
    }
    // occasional supply drop near the player (needs a flat spot)
    this.nextDrop = this.nextDrop ?? 90;
    this.nextDrop -= dt;
    if (this.nextDrop <= 0 && p.grounded) {
      this.nextDrop = 110 + this.rng() * 60;
      for (let k = 0; k < 14; k++) {
        const x = p.x + (this.rng() - 0.5) * 16, z = p.z + (this.rng() - 0.5) * 12;
        const gb = this.world.groundBelow(x, p.y + 4, z, 0.4, 8);
        if (!gb || Math.abs(gb.y1 - p.y) > 4 || this.world.pointInside(x, gb.y1 + 0.6, z, 0.3) || gb.kind === 'lava') continue;
        const table = LOOT[this.biome.id];
        const pick = () => { let t = 0; for (const e of table) t += e[1]; let r = this.rng() * t; for (const [id, w] of table) { r -= w; if (r <= 0) return id; } return table[0][0]; };
        const l = { x, y: gb.y1, z, loot: [pick(), pick(), this.rng() < 0.25 ? 'revive_star' : pick()], opened: false, bio: this.biome.index, supply: true, sniffed: true };
        this.luggage.push(l); this.emit('drop', { ref: l }); this.toast('📦 補給箱空投在附近！', 'good');
        break;
      }
    }
  }
  consumeEvents(p) {
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.type === 'faint' && !e.handled) { e.handled = true; this.onFaint(); }
      if (e.type === 'hurt' && e.cause === 'fall') this.stats.falls++;
    }
  }
  contactHazards(dt, f) {
    const p = this.player;
    if (p.state === 'faint') return;
    if (f.thorn && p.grounded) { this.v.add('injury', 6 * dt); if (!this._thornCd || this.time - this._thornCd > 0.8) { this._thornCd = this.time; this.emit('prick'); p.knock(this, -Math.sin(p.yaw), -Math.cos(p.yaw), 3, 2.5); } }
    for (const b of this.world.query(p.x - 0.5, p.y - 0.1, p.z - 0.5, p.x + 0.5, p.y + 1.3, p.z + 0.5)) {
      if (b.kind === 'lava' && !p.climbing && b.deco) {
        if (!this._lavaCd || this.time - this._lavaCd > 0.7) { this._lavaCd = this.time; this.hurt(10, 'lava'); this.v.add('hot', 10); const dx = p.x - (b.x0 + b.x1) / 2, dz = p.z - (b.z0 + b.z1) / 2, m = Math.hypot(dx, dz) || 1; p.knock(this, dx / m, dz / m, 5, 4); }
      }
    }
  }
}
