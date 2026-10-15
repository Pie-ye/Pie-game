// 遊戲核心：世界狀態、武器、瑞吉、敵人、渲染。
import { THREE, Layer } from './gfx.js';
import { WEAPONS, PASSIVES, PET, ENEMIES, SYNERGIES, WIN_TIME, xpNeed, spawnTable } from './data.js';
import { sfx } from './audio.js';
import { skillStats, skillSummary, clampArena, ARENA_RADIUS } from './skills.js';

const TAU = Math.PI * 2;
const rnd = Math.random;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const d2 = (ax, az, bx, bz) => { const dx = ax - bx; const dz = az - bz; return dx * dx + dz * dz; };
const CS = 2;                       // 空間雜湊格子大小
const MAX_ENEMY_R = 1.9;
const PRAYER_MAX = 120;
const MODE_TIME = 15;
const BEST_KEY = 'pg-phoebe-best';

export function loadBest() {
  try { const v = JSON.parse(localStorage.getItem(BEST_KEY)); return v && v.time ? v : null; } catch { return null; }
}

export class Game {
  constructor(canvas, numsCanvas, assets, ui) {
    this.canvas = canvas;
    this.numsCanvas = numsCanvas;
    this.nctx = numsCanvas.getContext('2d');
    this.assets = assets;
    this.ui = ui;
    this.mode = 'title';
    this.input = { x: 0, z: 0 };
    this.bot = false;
    this.grid = new Map();
    this.clock = 0;

    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setClearColor(0x0b1026);
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.5, 200);
    this.camDist = 1;
    this.camPos = { x: 0, z: 0 };

    this.buildScene();
    this.newRun();
    this.resize();
  }

  // ───────────────────────── 場景 ─────────────────────────
  buildScene() {
    const { tex, aspect } = this.assets;
    const sc = this.scene;
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(58, 58),
      new THREE.MeshBasicMaterial({ map: tex['rinascita-plaza'], toneMapped: false, color: new THREE.Color(0.62, 0.69, 0.78) }),
    );
    tex.ground.repeat.set(28, 28);
    g.rotation.x = -Math.PI / 2;
    this.ground = g;
    sc.add(g);
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshBasicMaterial({ color: 0x123c50 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -0.05; sc.add(sea);
    const edge = new THREE.Mesh(new THREE.RingGeometry(ARENA_RADIUS - .06, ARENA_RADIUS, 128),
      new THREE.MeshBasicMaterial({ color: 0x83b8c8, transparent: true, opacity: .5, depthWrite: false, side: THREE.DoubleSide }));
    edge.rotation.x = -Math.PI / 2; edge.position.y = .025; sc.add(edge);

    const solid = (t, max, order) => new Layer(sc, t, max, { alphaTest: 0.45, order });
    const add = (t, max, order, extra = {}) => new Layer(sc, t, max, { additive: true, order, ...extra });
    const L = this.L = {};
    L.decorA = solid(tex.decor_crystal, 160, 1);
    L.decorB = solid(tex.decor_grass, 160, 1);
    L.shadow = new Layer(sc, tex.shadow, 700, { flat: true, order: 2 });
    L.hum = solid(tex.enemy_hum, 500, 3);
    L.bat = solid(tex.enemy_bat, 400, 3);
    L.golem = solid(tex.enemy_golem, 400, 3);
    L.shooter = solid(tex.enemy_shooter, 400, 3);
    L.boss = solid(tex.enemy_boss, 4, 3);
    L.fish = solid(tex.fish_blue, 400, 4);
    L.gold = solid(tex.fish_gold, 120, 4);
    L.heart = solid(tex.heart, 40, 4);
    L.chest = solid(tex.chest, 8, 4);
    L.phoebe = solid(tex.phoebe, 2, 5);
    L.rc = solid(tex.reggie_closed, 2, 5);
    L.ro = solid(tex.reggie_open, 2, 5);
    L.disc = add(tex.disc, 160, 6, { flat: true, opacity: .3 });
    L.ring = add(tex.ring, 160, 7, { flat: true, opacity: .45 });
    L.beam = add(tex.beam, 180, 7, { flat: true, opacity: .55 });
    L.sigil = add(tex.sigil, 90, 7, { flat: true, opacity: .45 });
    L.prism = add(tex.prism, 180, 8, { center: true, opacity: .65 });
    L.pillar = add(tex.pillar, 70, 8, { opacity: .45 });
    // 獨立危險圖層最後繪製，避免技能亮光遮住頭目預警。
    L.dangerRing = add(tex.ring, 64, 11, { flat: true });
    L.dangerBeam = add(tex.beam, 180, 11, { flat: true });
    L.halo = add(tex.halo, 4, 8, { center: true });
    L.mirror = add(tex.fx_mirror, 24, 8, { center: true });
    L.star = add(tex.fx_star, 700, 9, { center: true });
    L.glow = add(tex.glow, 900, 9, { center: true, opacity: .45 });
    L.eshot = add(tex.fx_shot, 600, 9, { center: true });

    // 尺寸（高度，世界單位）
    this.sz = {
      phoebe: 1.95,
      reggie: 2.15 / aspect.reggie_closed,
      hum: 1.2, bat: 1.15, golem: 1.85, shooter: 1.25, boss: 5.0,
    };
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 500;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.numsCanvas.width = Math.round(w * dpr);
    this.numsCanvas.height = Math.round(h * dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.camDist = 1.15 * Math.max(1, 1.62 / (w / h)) * clamp(500 / h, 0.85, 1.15);
    this.w = w; this.h = h; this.dpr = dpr;
  }

  // ───────────────────────── 流程 ─────────────────────────
  newRun() {
    this.t = 0; this.kills = 0; this.fishEaten = 0;
    this.p = {
      x: 0, z: 0, hp: 100, maxhp: 100, face: 1, inv: 0, lvl: 1, xp: 0, need: xpNeed(1),
      walk: 0, moving: false, prayer: 0, mode: null, modeT: 0, hurt: 0, regen: 0,
    };
    this.weapons = { star: 1 };
    this.passives = {};
    this.petSkills = { roar: 1 };
    this.cd = { star: 0.4, ring: 0, litany: 2, field: 0, echo: 2.5, rain: 1.5, chain: 1, frost: 2, trail: 0 };
    this.hazards = []; this.trails = []; this.petTrailCd = 0; this.bossKills = 0;
    this.mirrorZone = null; this.starStage = 0; this.damageBySkill = {};
    this.fieldT = 0;
    this.pet = {
      x: -1.6, z: 0.9, vx: 0, vz: 0, face: 1, fullness: 0, full: false, fullT: 0, fullDur: 10,
      roarCd: 4, slideCd: 5, pose: 0, poseFired: true, slide: 0, sdx: 1, sdz: 0, slideId: 0, back: 0, bob: 0, burp: 0,
    };
    this.enemies = []; this.shots = []; this.eshots = []; this.pickups = []; this.parts = [];
    this.fxs = []; this.nums = []; this.strikes = []; this.waves = [];
    this.spawnAcc = 0; this.bossIdx = 0; this.swarmIdx = 0; this.nextId = 1; this.pending = 0;
    this.camPos.x = 0; this.camPos.z = 0;
    this.shake = 0; this.won = false; this.boss = null; this.endless = false; this.pendingCards = null;
    this.ui.setSlots(this);
  }

  start() {
    this.newRun();
    this.mode = 'play';
    this.ui.hideScreen();
    this.ui.showHud(true);
    this.ui.banner('菲比啾比，出發！', '#ffd966');
    sfx('chibi', 0.5);
  }

  pause() {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    this.ui.pause(this);
  }

  resume() {
    if (this.mode !== 'pause') return;
    this.mode = 'play';
    this.ui.hideScreen();
  }

  quit() {
    this.die();
  }

  continueEndless() {
    this.endless = true;
    this.mode = 'play';
    this.ui.hideScreen();
    this.ui.banner('無盡模式', '#6fd0ff');
  }

  die() {
    this.mode = 'over';
    sfx('lose');
    this.finish(false);
  }

  finish(win) {
    const st = { time: this.t, kills: this.kills, lvl: this.p.lvl, fish: this.fishEaten, newBest: false, damageBySkill: this.damageBySkill };
    let best = loadBest();
    if (!best || this.t > best.time) {
      best = { time: this.t, kills: this.kills };
      st.newBest = true;
      try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch { /* 無痕模式 */ }
    }
    this.ui.end(win, st, best);
  }

  // ───────────────────────── 派生屬性 ─────────────────────────
  get absolve() { return this.p.mode === 'absolve'; }
  get confess() { return this.p.mode === 'confess'; }
  get atk() { return (1 + Math.min(.9, (this.p.lvl - 1) * .025)) * (1 + 0.12 * (this.passives.might || 0)) * (this.absolve ? 1.35 : 1); }
  get cdm() { return Math.max(0.35, 1 - 0.08 * (this.passives.haste || 0)); }
  get area() { return 1 + 0.12 * (this.passives.area || 0); }
  get speed() { return 4.4 * (1 + 0.1 * (this.passives.speed || 0)); }
  get magnet() { return 2.4 * (1 + 0.3 * (this.passives.magnet || 0)); }
  get petAtk() {
    const gl = this.petSkills.glutton || 0;
    return (1 + 0.12 * (this.passives.might || 0)) * (this.confess ? 1.3 : 1) * (this.pet.full ? (gl >= 8 ? 2 : 1.5) : 1);
  }

  setMode(m) {
    const p = this.p;
    if (this.mode !== 'play' || p.mode || p.prayer < PRAYER_MAX) return;
    p.mode = m; p.modeT = MODE_TIME; p.prayer = 0;
    this.buildGrid();
    this.forNear(p.x, p.z, 7, (e) => this.hurt(e, m === 'absolve' ? 90 : 40, { stacks: m === 'absolve' ? 1 : 3, source: 'prayer' }));
    this.sigilFx(p.x, p.z, 7, 'liberation');
    sfx('mode');
    this.shake = Math.max(this.shake, 0.25);
    if (m === 'absolve') {
      this.ui.banner('赦罪 ・ 聖祷降臨', '#ffd966');
      this.fxRing(p.x, p.z, 7, 0.7, [1, 0.85, 0.35]);
      this.burst(p.x, 1, p.z, 40, { kind: 'star', color: [1, 0.85, 0.4], speed: 6, life: 0.9, size: 0.5 });
    } else {
      this.ui.banner('告解 ・ 默禱展開', '#6fd0ff');
      this.fxRing(p.x, p.z, 11, 0.8, [0.5, 0.85, 1]);
      this.burst(p.x, 1, p.z, 40, { kind: 'glow', color: [0.5, 0.85, 1], speed: 6, life: 0.9, size: 0.7 });
      for (const e of this.enemies) if (!e.dead && d2(e.x, e.z, p.x, p.z) < 144) this.addFrazzle(e, 3);
    }
  }

  // ───────────────────────── 升級 ─────────────────────────
  addXp(v) {
    const p = this.p;
    p.xp += v;
    while (p.xp >= p.need) { p.xp -= p.need; p.lvl++; p.need = xpNeed(p.lvl); this.pending++; }
  }

  makeCards() {
    const pool = [];
    const wOwned = Object.keys(this.weapons).length;
    for (const [k, w] of Object.entries(WEAPONS)) {
      const lv = this.weapons[k] || 0;
      if (lv && lv < w.max) pool.push({ type: 'weapon', key: k, w: 1.4 });
      else if (!lv && wOwned < 5) pool.push({ type: 'weapon', key: k, w: 1 });
    }
    const pOwned = Object.keys(this.passives).length;
    for (const [k, w] of Object.entries(PASSIVES)) {
      const lv = this.passives[k] || 0;
      if (lv < w.max && (lv || pOwned < 6)) pool.push({ type: 'passive', key: k, w: lv ? 1 : 0.8 });
    }
    for (const [k, w] of Object.entries(PET)) {
      const lv = this.petSkills[k] || 0;
      if (lv < w.max) pool.push({ type: 'pet', key: k, w: lv ? 1.3 : 1.1 });
    }
    const out = [];
    while (out.length < 3 && pool.length) {
      const sum = pool.reduce((s, c) => s + c.w, 0);
      let r = rnd() * sum; let i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
      out.push(pool.splice(i, 1)[0]);
    }
    while (out.length < 3) out.push({ type: 'heal' });
    return out.map((c) => this.describeCard(c));
  }

  describeCard(c) {
    if (c.type === 'heal') return { ...c, icon: '🐟', name: '回復', lv: '', now: '回復 40 生命', desc: '大餐一頓！', kind: '' };
    if (c.type === 'passive') {
      const d = PASSIVES[c.key]; const lv = (this.passives[c.key] || 0) + 1;
      return { ...c, icon: d.icon, name: d.name, lv: `Lv ${lv}`, now: d.desc, desc: `被動強化（${d.stat}）`, kind: '', isNew: lv === 1 };
    }
    const d = c.type === 'weapon' ? WEAPONS[c.key] : PET[c.key];
    const cur = (c.type === 'weapon' ? this.weapons : this.petSkills)[c.key] || 0;
    const combo = SYNERGIES.find((s) => (s.a === c.key || s.b === c.key) && ((s.a === c.key ? (s.pet ? this.petSkills : this.weapons)[s.b] : this.weapons[s.a]) || 0) > 0)
      || SYNERGIES.find((s) => s.a === c.key || s.b === c.key);
    const hint = combo ? `｜連攜 ${combo.desc}（目前 ${this.weapons[combo.a] || 0}/${(combo.pet ? this.petSkills : this.weapons)[combo.b] || 0}）` : '';
    const now = c.type === 'weapon' ? `${cur ? skillSummary(c.key, cur) + ' → ' : ''}${skillSummary(c.key, cur + 1)}` : d.lv[cur + 1];
    return { ...c, icon: d.icon, name: d.name, lv: `Lv ${cur + 1}`, now, desc: d.desc + hint, kind: c.type === 'pet' ? 'pet' : '', isNew: cur === 0 };
  }

  openLevelUp() {
    this.mode = 'levelup';
    this.pendingCards = this.makeCards();
    sfx('level');
    this.ui.levelup(this.p.lvl - this.pending + 1, this.pendingCards);
  }

  pick(i) {
    if (this.mode !== 'levelup' || !this.pendingCards) return;
    const c = this.pendingCards[i];
    if (!c) return;
    if (c.type === 'heal') this.p.hp = Math.min(this.p.maxhp, this.p.hp + 40);
    else if (c.type === 'weapon') this.weapons[c.key] = (this.weapons[c.key] || 0) + 1;
    else if (c.type === 'pet') this.petSkills[c.key] = (this.petSkills[c.key] || 0) + 1;
    else {
      this.passives[c.key] = (this.passives[c.key] || 0) + 1;
      if (c.key === 'vital') { this.p.maxhp += 20; this.p.hp = Math.min(this.p.maxhp, this.p.hp + 20); }
    }
    this.pending--;
    this.pendingCards = null;
    this.ui.setSlots(this);
    if (this.pending > 0) this.openLevelUp();
    else { this.mode = 'play'; this.ui.hideScreen(); }
  }

  // ───────────────────────── 空間查詢 ─────────────────────────
  buildGrid() {
    const g = this.grid;
    g.clear();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const k = Math.floor(e.x / CS) * 8192 + Math.floor(e.z / CS);
      const a = g.get(k);
      if (a) a.push(e); else g.set(k, [e]);
    }
  }

  forNear(x, z, r, fn) {
    const R = r + MAX_ENEMY_R;
    const x0 = Math.floor((x - R) / CS); const x1 = Math.floor((x + R) / CS);
    const z0 = Math.floor((z - R) / CS); const z1 = Math.floor((z + R) / CS);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const a = this.grid.get(cx * 8192 + cz);
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const e = a[i];
          if (e.dead) continue;
          const rr = r + e.r;
          if (d2(x, z, e.x, e.z) <= rr * rr) fn(e);
        }
      }
    }
  }

  nearest(x, z, n, maxD) {
    const out = [];
    const md = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = d2(x, z, e.x, e.z);
      if (d > md) continue;
      if (out.length < n || d < out[out.length - 1].d) {
        let i = out.length;
        out.push(null);
        while (i > 0 && out[i - 1].d > d) { out[i] = out[i - 1]; i--; }
        out[i] = { e, d };
        if (out.length > n) out.pop();
      }
    }
    return out.map((o) => o.e);
  }

  // ───────────────────────── 傷害 ─────────────────────────
  addFrazzle(e, n) {
    const add = n * (this.confess ? 3 : 1);
    const before = e.frz;
    e.frz = Math.min(12, e.frz + add);
    if (!before) e.frzT = 0.9;
  }

  /** 對敵人造成傷害。opts：mul 傷害倍率（預設玩家攻擊）、stacks 光噪層數、kx/kz 擊退方向、knock、stun */
  hurt(e, base, opts = {}) {
    if (e.dead) return;
    const mul = opts.mul != null ? opts.mul : this.atk;
    let d = base * mul;
    if (e.frz > 0) d *= 1 + e.frz * (this.absolve ? 0.09 : 0.03);
    if (this.confess) d *= 1.2;
    if (e.exposed > 0) d *= 1.2;
    const crit = rnd() < 0.08;
    if (crit) d *= 1.8;
    const applied = Math.min(e.hp, d);
    e.hp -= d;
    const source = opts.source || 'pet';
    this.damageBySkill[source] = (this.damageBySkill[source] || 0) + Math.max(0, applied);
    e.flash = 0.09;
    if (opts.stacks) this.addFrazzle(e, opts.stacks);
    if (opts.knock && !e.boss) {
      const k = opts.knock * (e.r > 0.7 ? 0.45 : 1);
      e.kx += (opts.kx || 0) * k; e.kz += (opts.kz || 0) * k;
    }
    if (opts.stun && !e.boss) e.stun = Math.max(e.stun, opts.stun);
    this.num(e.x, e.z, e.size * 0.9, Math.round(d), crit ? '#ffe36b' : '#ffffff', crit ? 1.35 : 1);
    sfx('hit', 0.04);
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    sfx('kill', 0.05);
    this.burst(e.x, 0.5 * e.size, e.z, e.boss ? 60 : 6, { kind: 'glow', color: [0.85, 0.5, 1], speed: e.boss ? 8 : 3, life: 0.5, size: e.boss ? 1.2 : 0.4 });
    const def = ENEMIES[e.type];
    if (e.boss) {
      this.bossKills++;
      this.hazards = this.hazards.filter((h) => h.owner !== e.id);
      this.drop('chest', e.x, e.z, 0);
      for (let i = 0; i < 8; i++) this.drop('gold', e.x + (rnd() - 0.5) * 3, e.z + (rnd() - 0.5) * 3, 5);
      for (let i = 0; i < 2; i++) this.drop('heart', e.x + (rnd() - 0.5) * 2, e.z + (rnd() - 0.5) * 2, 18);
      this.boss = this.enemies.find((o) => o.boss && !o.dead) || null;
      this.shake = 0.6;
      this.ui.banner('失序者 被擊敗！', '#ffd966');
      sfx('boom');
      sfx('chibi', 0.2);
    } else if (def.fish >= 4) this.drop('gold', e.x, e.z, def.fish);
    else {
      for (let i = 0; i < def.fish; i++) this.drop('fish', e.x + (rnd() - 0.5) * 0.6, e.z + (rnd() - 0.5) * 0.6, 1);
      if (rnd() < 0.012) this.drop('heart', e.x, e.z, 15);
    }
    if (e.type === 'splitter' && this.enemies.length < 335) {
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        const child = this.makeEnemy('bat', e.x + Math.cos(a), e.z + Math.sin(a));
        child.hp *= 0.5; child.maxhp = child.hp;
      }
    }
  }

  drop(kind, x, z, v) {
    ({ x, z } = clampArena(x, z, ARENA_RADIUS - .5));
    let mag = false;
    if (kind === 'fish' && this.pickups.length > 260) mag = true;
    this.pickups.push({ kind, x, z, v, mag, vx: 0, vz: 0, t: rnd() * 6, y: 0 });
  }

  hurtPlayer(d) {
    const p = this.p;
    if (p.inv > 0 || this.mode !== 'play') return;
    d *= 1 + this.t / 900;
    p.hp -= d;
    p.inv = 0.6; p.hurt = 0.25;
    this.shake = Math.max(this.shake, 0.3);
    sfx('hurt', 0.1);
    this.num(p.x, p.z, 2.1, Math.round(d), '#ff6f8f', 1.3);
    if (p.hp <= 0) { p.hp = 0; this.die(); }
  }

  // ───────────────────────── 特效輔助 ─────────────────────────
  num(x, z, h, text, color, size = 1) {
    if (size < 1.2 && this.nums.length > 40 && rnd() < 0.6) return;
    if (this.nums.length > 70) this.nums.shift();
    this.nums.push({ x: x + (rnd() - 0.5) * 0.4, z, h, text: String(text), color, size, t: 0, life: 0.75 });
  }

  popup(x, z, h, text, color) {
    this.nums.push({ x, z, h, text, color, size: 1.8, t: 0, life: 1.1 });
  }

  fxRing(x, z, r, life, color, tex = 'ring') {
    this.fxs.push({ kind: 'ring', x, z, r, t: 0, life, color, tex });
  }

  burst(x, y, z, n, o) {
    const room = 900 - this.parts.length;
    n = Math.min(n, room);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU; const s = (0.3 + rnd() * 0.7) * (o.speed || 3);
      this.parts.push({
        x, y, z, vx: Math.cos(a) * s, vy: (o.up != null ? o.up : 1.5) * rnd() + 0.4, vz: Math.sin(a) * s,
        t: 0, life: (o.life || 0.6) * (0.6 + rnd() * 0.6), size: (o.size || 0.4) * (0.6 + rnd() * 0.6), c: o.color || [1, 1, 1], kind: o.kind || 'glow', g: o.g != null ? o.g : 4,
      });
    }
  }

  // ───────────────────────── 更新 ─────────────────────────
  update(dtRaw) {
    this.clock += dtRaw;
    this.lastDt = Math.min(dtRaw, 0.1);
    if (this.mode !== 'play') return;
    const dt = Math.min(dtRaw, 0.05);
    this.t += dt;
    const p = this.p;
    if (this.bot) this.botInput();

    // 移動
    let ix = this.input.x; let iz = this.input.z;
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }
    p.moving = il > 0.05;
    p.x += ix * this.speed * dt; p.z += iz * this.speed * dt;
    Object.assign(p, clampArena(p.x, p.z));
    if (ix > 0.1) p.face = 1; else if (ix < -0.1) p.face = -1;
    if (p.moving) p.walk += dt * (0.6 + il);
    p.inv = Math.max(0, p.inv - dt); p.hurt = Math.max(0, p.hurt - dt);
    p.hp = Math.min(p.maxhp, p.hp + (this.confess ? 2.25 : 0.25) * dt);

    // 祈願
    if (p.mode) { p.modeT -= dt; if (p.modeT <= 0) { p.mode = null; p.modeT = 0; } }
    else p.prayer = Math.min(PRAYER_MAX, p.prayer + 5 * (1 + 0.2 * (this.passives.prayer || 0)) * dt);

    this.buildGrid();
    this.updateWeapons(dt);
    this.updatePet(dt);
    Object.assign(this.pet, clampArena(this.pet.x, this.pet.z, ARENA_RADIUS + 1));
    this.updateEnemies(dt);
    this.updateHazards(dt);
    this.updateShots(dt);
    this.updateMisc(dt);
    this.updatePickups(dt);
    this.spawnTick(dt);

    if (this.pending > 0 && this.mode === 'play') this.openLevelUp();
    if (!this.won && !this.endless && this.t >= WIN_TIME && this.bossKills >= 3 && !this.enemies.some((e) => e.boss && !e.dead) && this.mode === 'play') {
      this.won = true; this.mode = 'win'; sfx('win'); this.finish(true);
    }
  }

  // ───────────────────────── 武器 ─────────────────────────
  sigilFx(x, z, r, style = 'starflash') {
    if (this.fxs.length > 140) return;
    this.fxs.push({ kind: 'sigil', style, x, z, r, t: 0, life: style === 'liberation' ? 1.1 : .65, color: this.confess ? [.35, .85, 1] : [1, .8, .3] });
  }

  updateMirror(dt) {
    const lv = this.weapons.ring;
    if (!lv) { this.mirrorZone = null; return; }
    const s = skillStats('ring', lv);
    if (this.cd.ring <= 0) {
      const e = this.nearest(this.p.x, this.p.z, 1, 10)[0];
      if (e) {
        this.cd.ring = s.cooldown * this.cdm;
        this.mirrorZone = { x: e.x, z: e.z, r: s.radius * this.area, life: s.duration, tick: 0, refract: 0 };
        this.sigilFx(e.x, e.z, this.mirrorZone.r, 'mirror');
        this.forNear(e.x, e.z, this.mirrorZone.r, (o) => this.hurt(o, s.damage, { stacks: 1, stun: .7, source: 'ring' }));
        if (lv >= 3 && this.weapons.litany >= 3) {
          this.strikes.push({ x: e.x, z: e.z, r: this.mirrorZone.r, t: .35, max: .35,
            dmg: skillStats('litany', this.weapons.litany).damage * .6, source: 'litany', style: 'starflash' });
        }
      } else this.cd.ring = .2;
    }
    const m = this.mirrorZone;
    if (!m) return;
    m.life -= dt; m.tick -= dt; m.refract = Math.max(0, m.refract - dt);
    if (m.life <= 0) { this.mirrorZone = null; return; }
    if (m.tick <= 0) {
      m.tick = s.tick * this.cdm;
      this.forNear(m.x, m.z, m.r, (e) => {
        const dx = m.x - e.x; const dz = m.z - e.z; const d = Math.hypot(dx, dz) || 1;
        this.hurt(e, s.damage, { stacks: 1, knock: Math.min(3, d * 2), kx: dx / d, kz: dz / d, source: 'ring' });
      });
    }
    // 攔截範圍固定於鏡環邊緣；場外彈幕仍需走位。
    for (const b of this.eshots) {
      if (!b.dead && Math.abs(Math.hypot(b.x - m.x, b.z - m.z) - m.r) < .4) b.dead = true;
    }
  }

  updateWeapons(dt) {
    const p = this.p;
    const W = this.weapons;
    const cd = this.cd;
    for (const k of Object.keys(W)) cd[k] -= dt;
    this.updateNewWeapons(dt);
    this.updateMirror(dt);

    if (W.star && cd.star <= 0) {
      const lv = W.star;
      const stats = skillStats('star', lv);
      const cnt = stats.count;
      const ts = this.nearest(p.x, p.z, cnt, 15);
      if (ts.length) {
        cd.star = stats.cooldown * this.cdm * (this.absolve ? 0.8 : 1);
        this.starStage = (this.starStage + 1) % 3;
        const empowered = this.mirrorZone && d2(p.x, p.z, this.mirrorZone.x, this.mirrorZone.z) <= this.mirrorZone.r ** 2;
        const dmg = stats.damage * (this.starStage === 0 ? 1.5 : 1) * (empowered ? 1.35 : 1);
        const pierce = stats.pierce;
        for (let i = 0; i < cnt; i++) {
          const t = ts[i % ts.length];
          let a = Math.atan2(t.z - p.z, t.x - p.x);
          if (i >= ts.length) a += (i - ts.length + 1) * 0.16 * (i % 2 ? 1 : -1);
          this.shots.push({ x: p.x, z: p.z, vx: Math.cos(a) * 10.5, vz: Math.sin(a) * 10.5, life: 2.4, dmg, pierce, hit: [], target: t, empowered: empowered || this.starStage === 0 });
        }
        sfx('shoot', 0.08);
      } else cd.star = 0.25;
    }

    if (W.litany && cd.litany <= 0) {
      const lv = W.litany;
      const stats = skillStats('litany', lv);
      const cnt = stats.count;
      const ts = this.nearest(p.x, p.z, cnt, 14);
      if (ts.length) {
        cd.litany = stats.cooldown * this.cdm;
        const w = stats.width * this.area;
        const dmg = stats.damage;
        for (let i = 0; i < cnt; i++) {
          const t = ts[i % ts.length];
          let a = Math.atan2(t.z - p.z, t.x - p.x);
          if (i >= ts.length) a += 0.35 * (i % 2 ? 1 : -1);
          this.fireBeam(a, w, dmg * (i ? .55 : 1));
          this.sigilFx(t.x, t.z, w, 'starflash');
        }
        sfx('beam', 0.1);
        this.shake = Math.max(this.shake, 0.12);
      } else cd.litany = 0.3;
    }

    if (W.field) {
      const lv = W.field;
      const stats = skillStats('field', lv);
      const R = stats.radius * this.area * (this.confess ? 1.3 : 1);
      this.fieldR = R;
      this.fieldT -= dt;
      if (this.fieldT <= 0) {
        this.fieldT = stats.cooldown * this.cdm;
        const dmg = stats.damage;
        this.forNear(p.x, p.z, R, (e) => {
          this.hurt(e, dmg, { stacks: 1, source: 'field' });
          this.slow(e, .7, lv >= 4 ? .55 : .7);
        });
      }
    }

    if (W.echo && cd.echo <= 0) {
      const lv = W.echo;
      if (this.nearest(p.x, p.z, 1, 9).length) {
        const stats = skillStats('echo', lv);
        cd.echo = stats.cooldown * this.cdm;
        const max = Math.min(11, stats.radius * this.area);
        const dmg = stats.damage;
        this.sigilFx(p.x, p.z, 2.5, 'echo');
        this.waves.push({ x: p.x, z: p.z, r: 0.5, max, dmg, id: ++this.nextId, delay: 0 });
        if (lv >= 8) this.waves.push({ x: p.x, z: p.z, r: 0.5, max, dmg, id: ++this.nextId, delay: 0.4 });
        sfx('echo', 0.1);
      } else cd.echo = 0.3;
    }

    if (W.rain && cd.rain <= 0) {
      const lv = W.rain;
      const pool = this.nearest(p.x, p.z, 18, 11);
      if (pool.length) {
        const stats = skillStats('rain', lv);
        cd.rain = stats.cooldown * this.cdm;
        const n = stats.count;
        for (let i = 0; i < n; i++) {
          const t = pool[i % pool.length];
          this.strikes.push({ x: t.x, z: t.z, t: .65 + i * .18, max: .65 + i * .18, dmg: stats.damage, r: stats.radius * this.area, source: 'rain', style: 'liberation' });
        }
        sfx('rain', 0.1);
      } else cd.rain = 0.3;
    }
  }

  updateNewWeapons(dt) {
    const W = this.weapons; const p = this.p;
    if (W.chain && this.cd.chain <= 0) {
      const stats = skillStats('chain', W.chain);
      this.cd.chain = stats.cooldown * this.cdm;
      let x = p.x; let z = p.z;
      const hit = new Set();
      const count = stats.count + (W.star >= 3 && W.chain >= 3 ? 2 : 0);
      for (let i = 0; i < count; i++) {
        const e = this.nearest(x, z, count + 1, i ? stats.reach : 10).find((o) => !hit.has(o.id));
        if (!e) break;
        hit.add(e.id);
        const len = Math.hypot(e.x - x, e.z - z) || 0.01;
        this.fxs.push({ kind: 'beam', x, z, dx: (e.x - x) / len, dz: (e.z - z) / len, len, w: 0.18, t: 0, life: 0.3, refract: true });
        this.sigilFx(e.x, e.z, .65, 'refraction');
        this.hurt(e, stats.damage, { stacks: 1, source: 'chain' });
        x = e.x; z = e.z;
      }
      if (hit.size) sfx('beam', 0.3);
      else this.cd.chain = .2;
    }
    if (W.frost && this.cd.frost <= 0) {
      const stats = skillStats('frost', W.frost);
      this.cd.frost = stats.cooldown * this.cdm;
      const target = this.nearest(p.x, p.z, 1, 10)[0];
      if (target) {
        const r = stats.radius * this.area;
        this.sigilFx(target.x, target.z, r, 'stasis');
        this.forNear(target.x, target.z, r, (e) => {
          this.hurt(e, stats.damage, { stacks: 2, stun: .8, source: 'frost' });
          e.exposed = stats.duration;
          this.slow(e, stats.duration, .4);
        });
      } else this.cd.frost = .2;
    }
    if (W.trail && p.moving && this.cd.trail <= 0) {
      this.cd.trail = skillStats('trail', W.trail).cooldown * this.cdm;
      this.leaveTrail(p.x, p.z, 1);
    }
    this.petTrailCd -= dt;
    if (W.trail >= 3 && this.petSkills.slide >= 3 && this.pet.slide > 0 && this.petTrailCd <= 0) {
      this.petTrailCd = 0.18;
      this.leaveTrail(this.pet.x, this.pet.z, 1.5);
    }
    for (const f of this.trails) {
      f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = .45 * this.cdm;
        this.forNear(f.x, f.z, f.r, (e) => {
          // 重疊光痕每半秒只命中一次，避免原地繞圈傷害無限堆疊。
          if ((e.trailHit || -1) > this.t) return;
          e.trailHit = this.t + f.tick - .01;
          this.hurt(e, f.dmg, { stacks: 1, source: 'trail' });
        });
      }
    }
    this.trails = this.trails.filter((f) => f.life > 0);
  }

  leaveTrail(x, z, mul) {
    const lv = this.weapons.trail;
    const stats = skillStats('trail', lv);
    if (this.trails.length >= 60) this.trails.shift();
    this.trails.push({ x, z, r: stats.radius * this.area, life: stats.duration, tick: 0, dmg: stats.damage * mul });
  }

  slow(e, duration, multiplier) {
    const mul = e.boss ? Math.max(.8, multiplier) : multiplier;
    e.slows ||= {};
    e.slows[mul] = Math.max(e.slows[mul] || 0, duration);
    this.updateSlow(e, 0);
  }

  updateSlow(e, dt) {
    if (!e.slows) { e.slowT = Math.max(0, e.slowT - dt); return; }
    e.slowT = 0; e.slowMul = 1;
    for (const [mul, duration] of Object.entries(e.slows)) {
      const left = duration - dt;
      if (left <= 0) { delete e.slows[mul]; continue; }
      e.slows[mul] = left;
      e.slowT = Math.max(e.slowT, left);
      e.slowMul = Math.min(e.slowMul, Number(mul));
    }
  }

  fireBeam(a, w, dmg) {
    const p = this.p;
    const dx = Math.cos(a); const dz = Math.sin(a);
    const len = 15;
    this.fxs.push({ kind: 'beam', x: p.x, z: p.z, dx, dz, len, w, t: 0, life: 0.42 });
    this.burst(p.x + dx, 1, p.z + dz, 14, { kind: 'star', color: [1, 0.9, 0.5], speed: 5, life: 0.5, size: 0.5 });
    for (const e of this.enemies) {
      if (e.dead) continue;
      const rx = e.x - p.x; const rz = e.z - p.z;
      const along = rx * dx + rz * dz;
      if (along < -0.5 || along > len) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      if (perp > w / 2 + e.r) continue;
      const shatter = this.weapons.frost >= 3 && this.weapons.litany >= 3 && e.slowT > 0;
      this.hurt(e, dmg * (1 + 0.04 * e.frz) * (shatter ? 1.4 : 1) * (this.absolve && e.frz > 0 ? 1.4 : 1), { stacks: this.confess ? 2 : 1, knock: 1.5, kx: dx, kz: dz, source: 'litany' });
    }
  }

  updateShots(dt) {
    const p = this.p;
    for (const s of this.shots) {
      if (s.target && s.target.dead) s.target = this.nearest(s.x, s.z, 1, 8)[0] || null;
      if (s.target) {
        const want = Math.atan2(s.target.z - s.z, s.target.x - s.x);
        let cur = Math.atan2(s.vz, s.vx);
        let df = want - cur;
        while (df > Math.PI) df -= TAU;
        while (df < -Math.PI) df += TAU;
        cur += clamp(df, -7 * dt, 7 * dt);
        s.vx = Math.cos(cur) * 10.5; s.vz = Math.sin(cur) * 10.5;
      }
      s.x += s.vx * dt; s.z += s.vz * dt;
      s.life -= dt;
      if (s.life <= 0) { s.dead = true; continue; }
      this.forNear(s.x, s.z, 0.4, (e) => {
        if (s.dead || s.hit.includes(e.id)) return;
        s.hit.push(e.id);
        const l = Math.hypot(s.vx, s.vz) || 1;
        this.hurt(e, s.dmg, { stacks: 1, knock: 1.2, kx: s.vx / l, kz: s.vz / l, source: 'star' });
        const m = this.mirrorZone;
        if (m && m.refract <= 0 && d2(e.x, e.z, m.x, m.z) <= m.r ** 2) {
          m.refract = .5;
          this.sigilFx(m.x, m.z, m.r, 'refraction');
          this.forNear(m.x, m.z, m.r, (o) => this.hurt(o, s.dmg * .35, { stacks: 1, source: 'ring' }));
        }
        this.burst(s.x, 0.8, s.z, 4, { kind: 'star', color: [1, 0.9, 0.5], speed: 3, life: 0.3, size: 0.35 });
        if (s.pierce > 0) { s.pierce--; s.dmg *= .65; } else s.dead = true;
      });
    }
    this.shots = this.shots.filter((s) => !s.dead);

    for (const s of this.eshots) {
      if (s.dead) continue;
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      if (s.life <= 0) s.dead = true;
      else if (d2(s.x, s.z, p.x, p.z) < 0.5 * 0.5) { s.dead = true; this.hurtPlayer(s.dmg); }
    }
    this.eshots = this.eshots.filter((s) => !s.dead);
  }

  updateMisc(dt) {
    const p = this.p;
    for (const w of this.waves) {
      if (w.delay > 0) { w.delay -= dt; continue; }
      w.hit ||= new Set();
      const prev = w.r;
      w.r += 9 * dt;
      w.x += (p.x - w.x) * Math.min(1, dt * 3);
      w.z += (p.z - w.z) * Math.min(1, dt * 3);
      for (const e of this.enemies) {
        if (e.dead || w.hit.has(e.id)) continue;
        const d = Math.hypot(e.x - w.x, e.z - w.z);
        if (d + e.r >= prev - 0.2 && d - e.r <= w.r + 0.2) {
          w.hit.add(e.id);
          const combo = this.weapons.echo >= 3 && this.weapons.field >= 3 && e.frz >= 4;
          this.hurt(e, w.dmg * (combo ? 1.5 : 1), { stacks: 2, knock: 5, kx: (e.x - w.x) / (d || 1), kz: (e.z - w.z) / (d || 1), source: 'echo' });
        }
      }
      for (const b of this.eshots) if (!b.dead && d2(b.x, b.z, w.x, w.z) <= w.r ** 2) b.dead = true;
      if (w.r >= w.max) w.dead = true;
    }
    this.waves = this.waves.filter((w) => !w.dead);

    for (const s of this.strikes) {
      s.t -= dt;
      if (s.t <= 0) {
        s.dead = true;
        this.forNear(s.x, s.z, s.r, (e) => {
          const dd = Math.hypot(e.x - s.x, e.z - s.z) || 1;
          this.hurt(e, s.dmg * (this.absolve && s.source === 'rain' ? 1.5 : 1), { stacks: this.confess ? 3 : 2, knock: 3, kx: (e.x - s.x) / dd, kz: (e.z - s.z) / dd, source: s.source || 'rain' });
        });
        this.sigilFx(s.x, s.z, s.r, s.style || 'liberation');
        if (s.source === 'rain') for (const b of this.eshots) if (d2(b.x, b.z, s.x, s.z) <= s.r ** 2) b.dead = true;
        this.fxRing(s.x, s.z, s.r * 1.5, 0.4, [1, 0.9, 0.5]);
        this.burst(s.x, 0.4, s.z, 18, { kind: 'star', color: [1, 0.9, 0.5], speed: 5, life: 0.6, size: 0.55 });
        sfx('boom', 0.06);
        this.shake = Math.max(this.shake, 0.1);
      }
    }
    this.strikes = this.strikes.filter((s) => !s.dead);

    for (const f of this.fxs) { f.t += dt; if (f.t >= f.life) f.dead = true; }
    this.fxs = this.fxs.filter((f) => !f.dead);
    for (const q of this.parts) {
      q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vy -= q.g * dt;
      if (q.y < 0.05) { q.y = 0.05; q.vy *= -0.3; }
    }
    this.parts = this.parts.filter((q) => q.t < q.life);
    for (const n of this.nums) n.t += dt;
    this.nums = this.nums.filter((n) => n.t < n.life);
    this.shake = Math.max(0, this.shake - dt * 1.5);

    // 祈願模式的特效
    if (p.mode && rnd() < dt * 20) {
      const a = rnd() * TAU;
      this.parts.push({ x: p.x + Math.cos(a) * 0.9, y: 0.1, z: p.z + Math.sin(a) * 0.9, vx: 0, vy: 1.6, vz: 0, t: 0, life: 0.8, size: 0.35, c: p.mode === 'absolve' ? [1, 0.85, 0.4] : [0.5, 0.85, 1], kind: 'star', g: -0.5 });
    }
  }

  // ───────────────────────── 瑞吉 ─────────────────────────
  updatePet(dt) {
    const pt = this.pet; const p = this.p;
    const lv = this.petSkills;
    const gl = lv.glutton || 0;

    // 吃飽
    const need = 12 - (gl >= 2 ? 2 : 0) - (gl >= 5 ? 2 : 0);
    const dur = 10 + (gl >= 3 ? 2 : 0) + (gl >= 7 ? 3 : 0);
    pt.need = need; pt.fullDur = dur;
    if (!pt.full && pt.fullness >= need) {
      pt.full = true; pt.fullT = dur; pt.fullness = 0; pt.burp = 0.9;
      this.ui.banner('瑞吉吃飽了！', '#ffd966');
      sfx('burp');
      this.fxRing(pt.x, pt.z, 4, 0.5, [1, 0.85, 0.4]);
      this.popup(pt.x, pt.z, 2.6, '嗝！', '#ffe58a');
      this.forNear(pt.x, pt.z, 3.6, (e) => {
        const d = Math.hypot(e.x - pt.x, e.z - pt.z) || 1;
        this.hurt(e, 40, { mul: this.petAtk, knock: 5, kx: (e.x - pt.x) / d, kz: (e.z - pt.z) / d, stun: 0.6 });
      });
    }
    if (pt.full) { pt.fullT -= dt; if (pt.fullT <= 0) { pt.full = false; pt.fullness = 0; } }
    pt.burp = Math.max(0, pt.burp - dt);
    const fm = pt.full ? 0.6 : 1;

    pt.roarCd -= dt * 1; pt.slideCd -= dt;
    pt.bob += dt;

    let tx; let tz; let sp = 6.2;
    const busy = pt.pose > 0 || pt.slide > 0;

    if (pt.slide > 0) {
      pt.slide -= dt;
      const sl = lv.slide || 1;
      const dir = pt.back > 0 && pt.slide < 0.35 ? -1 : 1;
      pt.x += pt.sdx * 15 * dt * dir; pt.z += pt.sdz * 15 * dt * dir;
      pt.face = pt.sdx * dir >= 0 ? 1 : -1;
      const hr = (1.0 + (sl >= 4 ? 0.3 : 0) + (sl >= 7 ? 0.3 : 0));
      const dmg = 20 + 8 * sl + (sl >= 5 ? 8 : 0);
      this.forNear(pt.x, pt.z, hr, (e) => {
        if (e.slideId === pt.slideId) return;
        e.slideId = pt.slideId;
        this.hurt(e, dmg, { mul: this.petAtk, stacks: 1, knock: 4, kx: pt.sdx * dir, kz: pt.sdz * dir });
      });
      if (rnd() < 0.8) this.burst(pt.x, 0.3, pt.z, 2, { kind: 'glow', color: [0.5, 0.8, 1], speed: 1.5, life: 0.5, size: 0.5, up: 2.5 });
      if (pt.slide <= 0 && pt.back > 0) { pt.back = 0; }
    } else if (pt.pose > 0) {
      // 張嘴吼：先蓄力，再放出聲波
      const r = lv.roar || 1;
      pt.pose -= dt;
      const total = 0.85;
      if (!pt.poseFired && pt.pose <= total - 0.4) {
        pt.poseFired = true;
        const R = (2.9 + 0.35 * r) * this.area * (pt.full ? 1.2 : 1);
        const dmg = 24 + 9 * r + (r >= 8 ? 14 : 0) + (r >= 4 ? 5 : 0);
        const stun = r >= 6 ? 1.5 : 0.9;
        this.forNear(pt.x, pt.z, R, (e) => {
          const d = Math.hypot(e.x - pt.x, e.z - pt.z) || 1;
          this.hurt(e, dmg, { mul: this.petAtk, knock: 6, kx: (e.x - pt.x) / d, kz: (e.z - pt.z) / d, stun, stacks: 1 });
        });
        this.fxRing(pt.x, pt.z, R, 0.45, [0.7, 0.9, 1]);
        this.fxRing(pt.x, pt.z, R * 0.7, 0.35, [1, 1, 1]);
        this.popup(pt.x, pt.z, 2.7, '嗷！', '#bfe6ff');
        this.shake = Math.max(this.shake, 0.22);
      }
    } else {
      // 跟隨玩家，並且去吃附近的小魚
      const gr = 3.2 + (gl >= 1 ? 1.2 : 0) + (gl >= 4 ? 1.4 : 0);
      let best = null; let bd = gr * gr;
      for (const f of this.pickups) {
        if (f.kind !== 'fish' && f.kind !== 'gold') continue;
        const d = d2(f.x, f.z, pt.x, pt.z);
        if (d < bd && d2(f.x, f.z, p.x, p.z) < 100) { bd = d; best = f; }
      }
      if (best) { tx = best.x; tz = best.z; sp = 8.5; } else {
        tx = p.x - p.face * 1.7; tz = p.z + 0.9 + Math.sin(pt.bob * 1.5) * 0.25;
      }
      const dx = tx - pt.x; const dz = tz - pt.z; const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const s = Math.min(d * 5, sp * (d > 8 ? 2.2 : 1)) * dt;
        pt.x += (dx / d) * s; pt.z += (dz / d) * s;
        if (Math.abs(dx) > 0.15) pt.face = dx > 0 ? 1 : -1;
      }
      if (d2(pt.x, pt.z, p.x, p.z) > 144) { pt.x = p.x - 2; pt.z = p.z + 1; }
    }

    if (!busy) {
      const r = lv.roar || 1;
      if (pt.roarCd <= 0) {
        const R = (2.9 + 0.35 * r) * this.area;
        let near = 0;
        this.forNear(pt.x, pt.z, R + 1.2, () => { near++; });
        if (near >= 2) {
          pt.pose = 0.85; pt.poseFired = false;
          sfx('roar', 0.15);
          pt.roarCd = (6.2 - 0.45 * r) * this.cdm * fm;
          pt.face = (this.nearest(pt.x, pt.z, 1, 12)[0]?.x ?? pt.x + pt.face) >= pt.x ? 1 : -1;
        } else pt.roarCd = 0.4;
      } else if (lv.slide && pt.slideCd <= 0) {
        const sl = lv.slide;
        const cand = this.nearest(pt.x, pt.z, 14, 11);
        if (cand.length >= 3) {
          let best = cand[0]; let bs = -1;
          for (const c of cand) {
            let s = 0;
            for (const o of cand) if (d2(c.x, c.z, o.x, o.z) < 6) s++;
            if (s > bs) { bs = s; best = c; }
          }
          const dx = best.x - pt.x; const dz = best.z - pt.z; const d = Math.hypot(dx, dz) || 1;
          pt.sdx = dx / d; pt.sdz = dz / d; pt.slide = 0.7; pt.slideId = ++this.nextId;
          pt.back = sl >= 8 ? 1 : 0;
          if (pt.back) { pt.slide = 1.1; }
          pt.slideCd = (6.2 - 0.5 * sl) * this.cdm * fm;
          sfx('roar', 0.15);
        } else pt.slideCd = 0.5;
      }
    }
  }

  // ───────────────────────── 敵人 ─────────────────────────
  warnBlast(e, x, z, r = 2, delay = 1.2) {
    if (this.hazards.length >= 48) return;
    this.hazards.push({ owner: e.id, x, z, r, left: delay, max: delay, dmg: e.dmg, fired: false });
  }

  updateHazards(dt) {
    for (const h of this.hazards) {
      h.left -= dt;
      if (h.left <= 0 && !h.fired) {
        h.fired = true;
        if (d2(h.x, h.z, this.p.x, this.p.z) <= (h.r + 0.38) ** 2) this.hurtPlayer(h.dmg);
        this.fxRing(h.x, h.z, h.r, 0.35, [1, 0.15, 0.35]);
        sfx('boom', 0.2);
      }
    }
    this.hazards = this.hazards.filter((h) => h.left > -0.3);
  }

  enemyFan(e, angle, count, spread, speed = 4.2) {
    for (let i = 0; i < count && this.eshots.length < 560; i++) {
      const a = angle + (i / Math.max(1, count - 1) - 0.5) * spread;
      this.eshots.push({ x: e.x, z: e.z, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, life: 4, dmg: e.dmg * 0.65 });
    }
  }

  charge(e, dx, dz) {
    const d = Math.hypot(dx, dz) || 1;
    e.cdx = dx / d; e.cdz = dz / d;
    e.state = 2; e.stateT = e.boss ? 1.15 : 0.9;
    e.chargeSpeed = e.boss ? 9 : 8;
  }

  pickType() {
    const tab = spawnTable(this.t);
    const sum = tab.reduce((s, x) => s + x[1], 0);
    let r = rnd() * sum;
    for (const [k, w] of tab) { r -= w; if (r <= 0) return k; }
    return 'hum';
  }

  makeEnemy(type, x, z) {
    const d = ENEMIES[type];
    const hpMul = 1 + this.t * 0.0075 + (this.t / 300) ** 2 * 0.5;
    const e = {
      id: ++this.nextId, type, x, z, kx: 0, kz: 0, hp: d.hp * hpMul, maxhp: d.hp * hpMul, r: d.r, speed: d.speed * (1 + this.t / 1800),
      dmg: d.dmg, size: d.size, frz: 0, frzT: 0, flash: 0, stun: 0, slowT: 0, slowMul: 1, ringCd: 0, boss: !!d.boss, dead: false,
      shootT: type === 'fan' ? 2.4 + rnd() * 2.4 : 1 + rnd() * 1.5, ph: rnd() * TAU, atkT: 4, state: 0, slideId: 0, exposed: 0,
    };
    this.enemies.push(e);
    return e;
  }

  spawnAround(type, dist) {
    let point;
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU;
      point = clampArena(this.p.x + Math.cos(a) * dist, this.p.z + Math.sin(a) * dist * .75, ARENA_RADIUS + 1);
      if (d2(point.x, point.z, this.p.x, this.p.z) >= 64) break;
    }
    if (d2(point.x, point.z, this.p.x, this.p.z) < 64) {
      const a = Math.atan2(this.p.z, this.p.x) + Math.PI;
      point = { x: Math.cos(a) * (ARENA_RADIUS + 1), z: Math.sin(a) * (ARENA_RADIUS + 1) };
    }
    return this.makeEnemy(type, point.x, point.z);
  }

  spawnTick(dt) {
    const t = this.t;
    const cap = Math.min(340, 70 + t * 0.75);
    this.spawnAcc += (1.9 + 0.03 * t) * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc--;
      if (this.enemies.length < cap) this.spawnAround(this.pickType(), 13 + rnd() * 3);
    }
    const bt = this.bossIdx < 3 ? [180, 360, 540][this.bossIdx] : this.endless ? 540 + 150 * (this.bossIdx - 2) : Infinity;
    if (t >= bt) {
      this.bossIdx++;
      const e = this.spawnAround('boss', 12);
      e.hp = e.maxhp = ENEMIES.boss.hp * (1 + 0.9 * (this.bossIdx - 1)) * (1 + t / 600);
      this.boss = e;
      e.rank = this.bossIdx;
      e.name = ['破陣者', '織音者', '終曲指揮'][Math.min(2, e.rank - 1)];
      e.pattern = 0;
      this.ui.banner(`⚠ ${e.name}：避開紅色預警，尋找彈幕缺口！`, '#ff6ad5');
      sfx('boss');
      this.shake = 0.5;
    }
    const sw = [240, 480][this.swarmIdx];
    if (sw != null && t >= sw) {
      this.swarmIdx++;
      this.ui.banner('噪音包圍！', '#ff9ac8');
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        const type = i % 4 === 0 ? 'bat' : 'hum';
        const point = clampArena(this.p.x + Math.cos(a) * 11, this.p.z + Math.sin(a) * 8.5, ARENA_RADIUS + 1);
        if (d2(point.x, point.z, this.p.x, this.p.z) < 64) this.spawnAround(type, 13);
        else this.makeEnemy(type, point.x, point.z);
      }
    }
  }

  updateEnemies(dt) {
    const p = this.p;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.ringCd = Math.max(0, e.ringCd - dt);
      this.updateSlow(e, dt);
      e.exposed = Math.max(0, e.exposed - dt);
      const dx = p.x - e.x; const dz = p.z - e.z;
      const d = Math.hypot(dx, dz) || 1;
      let vx = 0; let vz = 0;
      if (e.stun > 0) e.stun -= dt;
      else {
        let sp = e.speed * (e.slowT > 0 ? e.slowMul : 1);
        let ux = dx / d; let uz = dz / d;
        if (e.type === 'shooter' || e.type === 'fan') {
          if (d < 4.6) { ux = -ux; uz = -uz; } else if (d < 6.8) { const t = ux; ux = -uz * 0.8; uz = t * 0.8; }
          e.shootT -= dt;
          if (e.shootT <= 0 && d < 11) {
            e.shootT = e.type === 'fan' ? 4.8 : 2.4;
            this.enemyFan(e, Math.atan2(dz, dx), e.type === 'fan' ? 5 : 1, 0.9);
          }
        } else if (e.type === 'mortar') {
          if (d < 7) sp = 0;
          e.atkT -= dt;
          if (e.atkT <= 0 && d < 12) {
            e.atkT = 4.5;
            this.warnBlast(e, p.x, p.z, 1.7, 1.35);
          }
        } else if (e.type === 'charger') {
          e.atkT -= dt;
          if (!e.state && e.atkT <= 0 && d < 10) { this.charge(e, dx, dz); e.atkT = 5; }
        } else if (e.type === 'bat') {
          const w = Math.sin(this.t * 5 + e.ph) * 0.9;
          const px = -uz; const pz = ux;
          ux += px * w; uz += pz * w;
        } else if (e.boss) {
          e.atkT -= dt;
          if (!e.state && e.atkT <= 0) {
            e.atkT = e.hp < e.maxhp * 0.45 ? 3.6 : 5;
            const pattern = (e.pattern++ + (e.rank || 1) - 1) % 3;
            if (pattern === 0) {
              this.charge(e, dx, dz);
              this.ui.banner('衝鋒預警：往紅線側面移動！', '#ff8ca8');
            } else if (pattern === 1) {
              // 留下朝向玩家的寬缺口；缺口方向在預警開始時固定。
              e.gap = Math.atan2(dz, dx); e.state = 4; e.stateT = 1.2;
              this.ui.banner('環形彈幕：移向青色缺口！', '#7deaff');
            } else {
              for (let i = 0; i < 5; i++) {
                this.warnBlast(e, p.x + (i - 2) * 2.5, p.z, 1.65, 1.1 + Math.abs(i - 2) * 0.18);
              }
              if ((e.rank || 1) >= 3) {
                this.warnBlast(e, p.x, p.z - 3.2, 1.5, 1.65);
                this.warnBlast(e, p.x, p.z + 3.2, 1.5, 1.65);
              }
              this.ui.banner('落雷預警：離開紅圈！', '#ff8ca8');
              e.state = 3; e.stateT = 1.8;
            }
          }
        }
        if (e.state === 2) {
          sp = 0; e.stateT -= dt;
          if (e.stateT <= 0) { e.state = 1; e.stateT = 0.85; }
        } else if (e.state === 1) {
          ux = e.cdx; uz = e.cdz; sp = e.chargeSpeed;
          e.stateT -= dt;
          if (e.stateT <= 0) { e.state = 3; e.stateT = 1; }
        } else if (e.state === 3 || e.state === 4) {
          sp = 0; e.stateT -= dt;
          if (e.stateT <= 0) {
            if (e.state === 4) {
              this.enemyFan(e, e.gap + Math.PI, 22, TAU - 1.15, 3.8);
              sfx('echo', 0.2);
            }
            e.state = 0;
          }
        }
        vx = ux * sp; vz = uz * sp;
      }
      e.x += (vx + e.kx) * dt; e.z += (vz + e.kz) * dt;
      Object.assign(e, clampArena(e.x, e.z, ARENA_RADIUS + 1));
      const k = Math.exp(-7 * dt);
      e.kx *= k; e.kz *= k;

      if (e.frz > 0) {
        e.frzT -= dt;
        if (e.frzT <= 0) {
          e.frzT = 0.9;
          const dmg = (3 + e.frz * 2.2) * this.atk * (this.confess ? 1.6 : 1);
          this.damageBySkill.frazzle = (this.damageBySkill.frazzle || 0) + Math.min(e.hp, dmg);
          e.hp -= dmg; e.flash = 0.05;
          this.num(e.x, e.z, e.size * 0.6, Math.round(dmg), '#ffd34d', 0.75);
          e.frz = Math.max(0, e.frz - 1);
          if (e.hp <= 0) { this.kill(e); continue; }
        }
      }

      if (d2(e.x, e.z, p.x, p.z) < (e.r + 0.38) ** 2) this.hurtPlayer(e.dmg);
      if (d > 30 && !e.state) {
        const a = rnd() * TAU;
        Object.assign(e, clampArena(p.x + Math.cos(a) * 14, p.z + Math.sin(a) * 10.5, ARENA_RADIUS + 1));
      }
    }

    // 敵人互相推開
    for (const e of this.enemies) {
      if (e.dead || e.boss) continue;
      this.forNear(e.x, e.z, e.r, (o) => {
        if (o === e) return;
        const dx = e.x - o.x; const dz = e.z - o.z;
        const dd = Math.hypot(dx, dz) || 0.01;
        const min = (e.r + o.r) * 0.85;
        if (dd < min) {
          const push = (min - dd) * 0.5 * (o.boss ? 1 : 0.5);
          e.x += (dx / dd) * push; e.z += (dz / dd) * push;
        }
      });
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  // ───────────────────────── 掉落物 ─────────────────────────
  updatePickups(dt) {
    const p = this.p; const pt = this.pet;
    const mr = this.magnet;
    const gl = this.petSkills.glutton || 0;
    for (const f of this.pickups) {
      f.t += dt;
      const dp = Math.hypot(p.x - f.x, p.z - f.z);
      if (f.kind === 'chest') {
        if (dp < 0.9) { f.dead = true; this.pending++; this.ui.banner('寶箱！額外升級', '#ffd966'); sfx('level'); }
        continue;
      }
      if (f.kind === 'heart') {
        if (dp < mr * 0.5) { f.mag = true; }
      } else if (dp < mr) f.mag = true;
      if (f.mag) {
        const sp = 9 + (3 - Math.min(3, dp)) * 4;
        f.x += ((p.x - f.x) / (dp || 1)) * sp * dt; f.z += ((p.z - f.z) / (dp || 1)) * sp * dt;
      }
      if (dp < 0.55) {
        f.dead = true;
        if (f.kind === 'heart') { p.hp = Math.min(p.maxhp, p.hp + f.v); this.num(p.x, p.z, 2.2, `+${f.v}`, '#7dffb0', 1.1); sfx('fish', 0.05); } else { this.addXp(f.v); sfx('fish', 0.04); }
        continue;
      }
      // 瑞吉吃魚
      if ((f.kind === 'fish' || f.kind === 'gold') && !f.dead && d2(f.x, f.z, pt.x, pt.z) < 0.9 * 0.9 && !(pt.pose > 0)) {
        f.dead = true;
        this.addXp(f.v);
        this.fishEaten++;
        if (!pt.full) pt.fullness += f.kind === 'gold' ? 2 : 1;
        if (gl >= 6) p.hp = Math.min(p.maxhp, p.hp + 0.6);
        pt.eat = 0.25;
        sfx('fish', 0.04);
        this.burst(pt.x + pt.face * 0.8, 0.9, pt.z, 3, { kind: 'star', color: [0.6, 0.9, 1], speed: 2, life: 0.4, size: 0.3 });
      }
    }
    this.pickups = this.pickups.filter((f) => !f.dead);
    pt.eat = Math.max(0, (pt.eat || 0) - dt);
  }

  // ───────────────────────── 測試用機器人 ─────────────────────────
  botInput() {
    const p = this.p;
    let x = 0; let z = 0;
    for (const e of this.enemies) {
      const dx = p.x - e.x; const dz = p.z - e.z; const d = Math.hypot(dx, dz);
      if (d < 4.5) { const w = (4.5 - d) / 4.5; x += (dx / (d || 1)) * w * 2; z += (dz / (d || 1)) * w * 2; }
    }
    let best = null; let bd = 64;
    for (const f of this.pickups) { const d = d2(f.x, f.z, p.x, p.z); if (d < bd) { bd = d; best = f; } }
    if (best) { const d = Math.sqrt(bd) || 1; x += ((best.x - p.x) / d) * 0.6; z += ((best.z - p.z) / d) * 0.6; }
    x += Math.cos(this.t * 0.3) * 0.2; z += Math.sin(this.t * 0.27) * 0.2;
    this.input.x = x; this.input.z = z;
    if (!p.mode && p.prayer >= PRAYER_MAX) this.setMode(Math.floor(this.t / 40) % 2 ? 'confess' : 'absolve');
  }

  // ───────────────────────── 渲染 ─────────────────────────
  render() {
    const cam = this.camera;
    const p = this.p;
    const { L } = this;
    const t = this.clock;

    // 鏡頭
    const lerp = 1 - Math.exp(-9 * (this.lastDt || 0.016));
    this.camPos.x += (p.x - this.camPos.x) * lerp;
    this.camPos.z += (p.z - this.camPos.z) * lerp;
    const sx = (rnd() - 0.5) * this.shake * 0.8; const sz = (rnd() - 0.5) * this.shake * 0.8;
    const cx = this.camPos.x + sx; const cz = this.camPos.z + sz;
    cam.position.set(cx, 14.5 * this.camDist, cz + 9.4 * this.camDist);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    Layer.camQuat.copy(cam.quaternion);

    this.ground.position.set(0, 0, 0);

    for (const k of Object.keys(L)) L[k].begin();

    const sh = L.shadow;
    // 敵人
    for (const e of this.enemies) {
      const def = ENEMIES[e.type];
      const skin = def.skin || e.type;
      const layer = L[skin];
      const h = def.skin ? def.size : this.sz[e.type];
      const w = Math.sin(t * (e.type === 'bat' ? 14 : 7) + e.ph);
      let sxs = 1; let sy = 1; let roll = 0; let y = 0;
      if (e.type === 'bat') { sxs = 1 + w * 0.12; sy = 1 - w * 0.08; y = 0.7 + Math.sin(t * 3 + e.ph) * 0.12; }
      else if (e.type === 'hum') { sy = 1 + w * 0.06; sxs = 1 - w * 0.05; roll = w * 0.05; }
      else if (e.type === 'shooter') { y = 0.35 + Math.sin(t * 2.2 + e.ph) * 0.1; roll = w * 0.03; }
      else if (e.type === 'golem') { roll = w * 0.04; sy = 1 + Math.abs(w) * 0.03; }
      else { sy = 1 + w * 0.02; }
      const asp = this.assets.aspect[`enemy_${skin}`];
      const f = e.flash > 0 ? 2.6 : 1;
      let r = f; let g = f; let b = f;
      if (f === 1 && def.tint) [r, g, b] = def.tint;
      if (!f || f === 1) {
        if (e.frz > 0) { const q = Math.min(1, e.frz / 8); r = 1 + 0.5 * q; g = 1 + 0.25 * q; b = 1 - 0.3 * q; }
        if (e.stun > 0) { r = 0.8; g = 0.9; b = 1.5; }
      }
      layer.add(e.x, y, e.z, h * asp * sxs, h * sy, roll, r, g, b, e.x > p.x && e.type !== 'hum' && e.type !== 'boss');
      sh.add(e.x, 0.02, e.z + 0.02, h * asp * 0.8, h * asp * 0.45, 0, 1, 1, 1);
      if (e.frz > 0) L.star.add(e.x, h * 1.08 + y, e.z, 0.3 + e.frz * 0.035, 0.3 + e.frz * 0.035, t * 2, 1, 0.85, 0.35);
    }

    // 掉落物
    for (const f of this.pickups) {
      const bob = Math.sin(f.t * 4) * 0.06;
      if (f.kind === 'fish') L.fish.add(f.x, 0.12 + bob, f.z, 0.62, 0.62 / this.assets.aspect.fish_blue, Math.sin(f.t * 3) * 0.2, 1, 1, 1);
      else if (f.kind === 'gold') L.gold.add(f.x, 0.14 + bob, f.z, 0.9, 0.9 / this.assets.aspect.fish_gold, Math.sin(f.t * 3) * 0.2, 1, 1, 1);
      else if (f.kind === 'heart') L.heart.add(f.x, 0.25 + bob, f.z, 0.62, 0.62, 0, 1, 1, 1);
      else if (f.kind === 'chest') { L.chest.add(f.x, 0.05, f.z, 1.15, 1.15 / this.assets.aspect.chest, 0, 1, 1, 1); L.glow.add(f.x, 0.6, f.z, 2 + Math.sin(f.t * 5) * 0.3, 2 + Math.sin(f.t * 5) * 0.3, 0, 1, 0.8, 0.3); }
      if (f.kind !== 'chest') sh.add(f.x, 0.02, f.z, 0.5, 0.3, 0, 1, 1, 1);
    }

    this.drawPlayer(t);
    this.drawPet(t);
    this.drawEffects(t);

    for (const k of Object.keys(L)) L[k].end();
    this.renderer.render(this.scene, cam);
    this.drawNums();
  }

  drawDecor(cx, cz) {
    const C = 2.6; const R = 17;
    const i0 = Math.floor((cx - R) / C); const i1 = Math.floor((cx + R) / C);
    const j0 = Math.floor((cz - R * 0.8) / C); const j1 = Math.floor((cz + R * 0.8) / C);
    const asp = this.assets.aspect;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        const u = (h & 1023) / 1023;
        if (u > 0.2) continue;
        const x = (i + ((h >>> 10) & 255) / 255) * C; const z = (j + ((h >>> 18) & 255) / 255) * C;
        if (u < 0.07) this.L.decorA.add(x, 0, z, 0.7, 0.7 / asp.decor_crystal, 0, 0.85, 0.85, 0.9);
        else this.L.decorB.add(x, 0, z, 0.62, 0.62 / asp.decor_grass, 0, 0.8, 0.85, 0.85);
      }
    }
  }

  drawPlayer(t) {
    const p = this.p; const L = this.L;
    const hh = this.sz.phoebe; const asp = this.assets.aspect.phoebe;
    const w = p.moving ? Math.sin(p.walk * 11) : Math.sin(t * 2.5) * 0.25;
    const bob = p.moving ? Math.abs(w) * 0.12 : (w + 1) * 0.02;
    const blink = p.inv > 0 && Math.floor(t * 20) % 2 === 0;
    let r = 1; let g = 1; let b = 1;
    if (p.hurt > 0) { r = 2; g = 0.8; b = 0.8; }
    if (blink) { r *= 0.6; g *= 0.6; b *= 0.6; }
    L.phoebe.add(p.x, bob, p.z, hh * asp * (1 - w * 0.03), hh * (1 + Math.abs(w) * 0.03), p.moving ? w * 0.06 : 0, r, g, b, p.face < 0);
    L.shadow.add(p.x, 0.02, p.z + 0.05, 1.5, 0.8, 0, 1, 1, 1);
    if (p.mode) {
      const c = p.mode === 'absolve' ? [1, 0.82, 0.3] : [0.45, 0.85, 1];
      L.halo.add(p.x, hh + 0.12 + Math.sin(t * 3) * 0.05, p.z, 1.5, 0.56, 0, c[0], c[1], c[2]);
      L.glow.add(p.x, 1, p.z, 3.4, 3.4, 0, c[0] * 0.35, c[1] * 0.35, c[2] * 0.35);
    }
  }

  drawPet(t) {
    const pt = this.pet; const L = this.L;
    const gl = this.petSkills.glutton || 0;
    const base = this.sz.reggie;
    let s = pt.full ? 1.2 : 1;
    if (pt.burp > 0) s *= 1 + Math.sin((pt.burp / 0.9) * Math.PI) * 0.15;
    let sx = 1; let sy = 1; let roll = 0; let y = 0;
    const open = pt.pose > 0 || pt.eat > 0;
    if (pt.slide > 0) { sy = 0.72; sx = 1.12; roll = -pt.sdz * 0.15; }
    else if (pt.pose > 0) {
      const q = 1 - pt.pose / 0.85;
      const pulse = q < 0.45 ? 1 + q * 0.5 : 1.22 - (q - 0.45) * 0.4;
      sx = pulse; sy = pulse; roll = -0.12 * pt.face * (q < 0.45 ? 1 : 0.2);
    } else {
      const hop = Math.abs(Math.sin(pt.bob * 5));
      const moving = d2(pt.x, pt.z, this.p.x, this.p.z) > 3 || this.p.moving;
      y = moving ? hop * 0.1 : 0;
      sy = 1 + (moving ? Math.sin(pt.bob * 10) * 0.025 : Math.sin(pt.bob * 2) * 0.015);
    }
    const layer = open ? L.ro : L.rc;
    const asp = this.assets.aspect[open ? 'reggie_open' : 'reggie_closed'];
    const h = base * s;
    const tint = pt.full ? [1.25, 1.12, 0.95] : [1, 1, 1];
    layer.add(pt.x, y, pt.z, h * asp * sx, h * sy, roll, tint[0], tint[1], tint[2], pt.face < 0);
    L.shadow.add(pt.x, 0.02, pt.z + 0.05, 2.2 * s, 0.9 * s, 0, 1, 1, 1);
    if (pt.full) L.glow.add(pt.x, 0.9, pt.z, 3.2 * s, 3.2 * s, 0, 0.5, 0.38, 0.12);
    if (gl >= 0 && pt.pose > 0 && pt.pose > 0.45) {
      const q = 1 - (pt.pose - 0.45) / 0.4;
      L.glow.add(pt.x + pt.face * 1.5, 1, pt.z, 1.2 + q * 0.6, 1.2 + q * 0.6, 0, 0.6 * q, 0.8 * q, 1 * q);
    }
  }

  drawEffects(t) {
    const L = this.L; const p = this.p;
    for (const h of this.hazards) {
      const q = clamp(1 - h.left / h.max, 0, 1);
      L.dangerRing.add(h.x, 0.065, h.z, h.r * 2, h.r * 2, 0, 1.4, 0.12, 0.25);
      L.disc.add(h.x, 0.06, h.z, h.r * 2 * q, h.r * 2 * q, 0, 0.7, 0.04, 0.12);
    }
    for (const e of this.enemies) {
      if (e.state === 2) {
        const len = e.chargeSpeed * 0.85;
        L.dangerBeam.add(e.x + e.cdx * len / 2, 0.07, e.z + e.cdz * len / 2, len, e.r * 2 + 0.76, Math.atan2(-e.cdz, e.cdx), 1.2, 0.1, 0.25);
      } else if (e.state === 4) {
        L.dangerRing.add(e.x, 0.07, e.z, 6, 6, 0, 1, 0.15, 0.35);
        L.dangerBeam.add(e.x + Math.cos(e.gap) * 4, 0.08, e.z + Math.sin(e.gap) * 4, 8, 1.4, -e.gap, 0.1, 0.9, 1);
      }
    }
    for (const f of this.trails) {
      const fade = Math.min(1, f.life);
      L.sigil.add(f.x, 0.04, f.z, f.r * 2, f.r * 2, t * .1, .5 * fade, .4 * fade, .18 * fade);
      L.prism.add(f.x, .2 + Math.sin(t * 2 + f.x) * .1, f.z, .15, .5, 0, .8 * fade, .7 * fade, .3 * fade);
    }

    // 默禱領域
    if (this.weapons.field) {
      const R = this.fieldR || 2;
      const c = this.confess ? [0.5, 0.85, 1] : this.absolve ? [1, 0.85, 0.4] : [1, 0.9, 0.55];
      const k = 0.6 + Math.sin(t * 3) * 0.1;
      L.disc.add(p.x, 0.03, p.z, R * 2, R * 2, t * 0.3, c[0] * k, c[1] * k, c[2] * k);
      L.ring.add(p.x, 0.035, p.z, R * 2, R * 2, -t * 0.5, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
      L.sigil.add(p.x, .04, p.z, R * 1.85, R * 1.85, t * .12, c[0] * .55, c[1] * .55, c[2] * .55);
    }

    // 鏡之環
    if (this.mirrorZone) {
      const m = this.mirrorZone; const fade = Math.min(1, m.life);
      const c = this.confess ? [.3, .8, 1] : [1, .75, .25];
      L.sigil.add(m.x, .055, m.z, m.r * 2, m.r * 2, -t * .12, c[0] * fade, c[1] * fade, c[2] * fade);
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + t * .22;
        const x = m.x + Math.cos(a) * m.r; const z = m.z + Math.sin(a) * m.r;
        L.prism.add(x, 1 + Math.sin(t * 2 + i) * .15, z, .6, 1.7, Math.sin(a) * .16, c[0] * fade, c[1] * fade, c[2] * fade);
      }
    }

    // 光環、聲波
    for (const f of this.fxs) {
      const q = f.t / f.life;
      if (f.kind === 'sigil') {
        const a = Math.sin(Math.PI * q) * .8;
        const c = f.style === 'stasis' ? [.45, .8, 1] : f.color;
        const r = f.r * (.85 + q * .25);
        L.sigil.add(f.x, .06, f.z, r * 2, r * 2, q * .25, c[0] * a, c[1] * a, c[2] * a);
        if (f.style === 'starflash' || f.style === 'liberation') {
          const height = f.style === 'liberation' ? 7 : 5;
          L.pillar.add(f.x, .1, f.z, r * 1.2, height * (1 - q * .25), 0, c[0] * a, c[1] * a, c[2] * a);
        }
        const n = f.style === 'refraction' ? 3 : 8;
        for (let i = 0; i < n; i++) {
          const angle = i * TAU / n + q * .7;
          const rad = r * (f.style === 'liberation' ? q : .75);
          L.prism.add(f.x + Math.cos(angle) * rad, .4 + q * 1.5, f.z + Math.sin(angle) * rad, .18 + a * .2, .5 + a * .7, angle, c[0] * a, c[1] * a, c[2] * a);
        }
      } else if (f.kind === 'ring') {
        const r = f.r * (0.15 + 0.85 * (1 - (1 - q) ** 2));
        const a = (1 - q) * 1.2;
        L.ring.add(f.x, 0.05, f.z, r * 2, r * 2, 0, f.color[0] * a, f.color[1] * a, f.color[2] * a);
      } else if (f.kind === 'beam') {
        const a = (1 - q) ** 0.6;
        const ang = Math.atan2(-f.dz, f.dx);
        const w = f.w * (1.2 - q * 0.5);
        L.beam.add(f.x + f.dx * f.len * 0.5, 0.06, f.z + f.dz * f.len * 0.5, f.len, w, ang, .7 * a, .58 * a, .28 * a);
        for (let i = 0; i < 3; i++) {
          const d = ((t * 14 + i * 5) % f.len);
          L.star.add(f.x + f.dx * d, 0.9, f.z + f.dz * d, 0.7 * a, 0.7 * a, t * 4, a, a * 0.9, a * 0.5);
        }
        if (!f.refract) L.glow.add(f.x + f.dx * 0.8, 1, f.z + f.dz * 0.8, 1.4 * a, 1.4 * a, 0, a * .5, .4 * a, .15 * a);
      }
    }
    for (const w of this.waves) {
      if (w.delay > 0) continue;
      const a = 1 - w.r / w.max;
      L.ring.add(w.x, 0.05, w.z, w.r * 2, w.r * 2, 0, 0.9 * a + 0.1, 0.75 * a + 0.1, 0.45 * a);
      L.ring.add(w.x, 0.05, w.z, w.r * 1.85, w.r * 1.85, 0, 0.5 * a, 0.4 * a, 0.25 * a);
    }

    // 星屑雨預告與墜落
    for (const s of this.strikes) {
      const q = 1 - s.t / s.max;
      L.sigil.add(s.x, 0.04, s.z, s.r * 2, s.r * 2, -q * .3, .7, .55, .2);
      L.ring.add(s.x, 0.045, s.z, s.r * 2, s.r * 2, 0, 0.9, 0.7, 0.3);
      const y = 4 * (1 - q) ** 2;
      L.prism.add(s.x, y + 1, s.z, 1.8, 2.8, q * .35, 1, .85, .5);
      L.pillar.add(s.x, .1, s.z, .6, y + 1, 0, .4 * q, .3 * q, .1 * q);
    }

    // 星輝彈
    for (const s of this.shots) {
      const size = s.empowered ? .85 : .55;
      L.prism.add(s.x, .9, s.z, size * .6, size, -Math.atan2(s.vz, s.vx), 1, .85, .4);
      L.glow.add(s.x - s.vx * .025, .9, s.z - s.vz * .025, size, size, 0, .3, .22, .05);
    }
    for (const s of this.eshots) L.eshot.add(s.x, 0.7, s.z, 0.8, 0.8, 0, 1, 1, 1);

    // 粒子
    for (const q of this.parts) {
      const a = 1 - q.t / q.life;
      const layer = q.kind === 'star' ? L.star : L.glow;
      const s = q.size * (0.4 + a * 0.8);
      layer.add(q.x, q.y, q.z, s, s, q.t * 4, q.c[0] * a, q.c[1] * a, q.c[2] * a);
    }
  }

  drawNums() {
    const ctx = this.nctx;
    const { dpr } = this;
    ctx.clearRect(0, 0, this.numsCanvas.width, this.numsCanvas.height);
    if (!this.nums.length) return;
    const v = new THREE.Vector3();
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const n of this.nums) {
      const q = n.t / n.life;
      v.set(n.x, n.h + q * 0.9, n.z).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.numsCanvas.width;
      const y = (-v.y * 0.5 + 0.5) * this.numsCanvas.height;
      const size = (13 + 5 * n.size) * dpr * (q < 0.12 ? 0.6 + q * 3.3 : 1);
      ctx.font = `900 ${size}px system-ui, sans-serif`;
      ctx.globalAlpha = q > 0.65 ? 1 - (q - 0.65) / 0.35 : 1;
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = 'rgba(20,10,40,0.9)';
      ctx.strokeText(n.text, x, y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────────────────── HUD ─────────────────────────
  hud() {
    const p = this.p; const pt = this.pet;
    this.ui.update({
      hp: p.hp, maxhp: p.maxhp, xp: p.xp, xpNeed: p.need, lvl: p.lvl, time: this.t, kills: this.kills, fish: this.fishEaten,
      prayer: p.prayer, prayerMax: PRAYER_MAX, mode: p.mode, modeLeft: p.modeT,
      pet: { fullness: Math.min(pt.fullness, pt.need || 12), need: pt.need || 12, full: pt.full, left: pt.fullT, dur: pt.fullDur },
      boss: this.boss ? { hp: this.boss.hp, maxhp: this.boss.maxhp, name: `${this.boss.name || ENEMIES.boss.name}${this.boss.hp < this.boss.maxhp * 0.45 ? ' · 狂暴' : ''}` } : null,
    });
  }
}
