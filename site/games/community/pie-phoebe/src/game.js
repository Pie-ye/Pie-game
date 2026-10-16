// 遊戲核心：世界狀態、武器、瑞吉、敵人、渲染。
import { THREE, Layer } from './gfx.js';
import { WEAPONS, PASSIVES, PET, ENEMIES, CHARACTERS, SYNERGIES, SYN_LV, BOSS_SCHEDULE, ENDLESS_ORDER, WIN_TIME, xpNeed, spawnTable } from './data.js';
import { BOSS_AI, BOSS_HINT } from './bosses.js';
import { sfx } from './audio.js';
import { skillStats, skillSummary, petStats, clampArena, ARENA_RADIUS } from './skills.js';

const TAU = Math.PI * 2;
const rnd = Math.random;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
/** 貼紙式彈出：開頭快速彈出（略微過衝），結尾縮小一點再消失。q 是 0..1 的進度。 */
const stickerPop = (q, inEnd = 0.3) => (q < inEnd ? Math.max(0.001, easeOutBack(q / inEnd)) : 1 - Math.max(0, q - 0.75) / 0.25 * 0.3);
const d2 = (ax, az, bx, bz) => { const dx = ax - bx; const dz = az - bz; return dx * dx + dz * dz; };
const CS = 2;                       // 空間雜湊格子大小
const MAX_ENEMY_R = 1.9;
const PRAYER_MAX = 120;
const MODE_TIME = 15;
const BEST_KEY = 'pg-phoebe-best';

const CHAR_KEY = 'pg-phoebe-char';
export function loadChar() {
  try { const v = localStorage.getItem(CHAR_KEY); return CHARACTERS[v] ? v : 'phoebe'; } catch { return 'phoebe'; }
}

const FX_KEY = 'pg-phoebe-fx';
export const FX_LEVELS = { low: { name: '低', scale: .55 }, mid: { name: '中', scale: 1 }, high: { name: '高', scale: 1.45 } };
export function loadFxLevel() {
  try { const v = localStorage.getItem(FX_KEY); return FX_LEVELS[v] ? v : 'mid'; } catch { return 'mid'; }
}

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
    for (const k of ['vanguard', 'weaver', 'conductor', 'crab', 'lighthouse', 'hive']) L[k] = solid(tex[`enemy_${k}`], 4, 3);
    L.obelisk = solid(tex.enemy_obelisk, 12, 3);
    L.egg = solid(tex.enemy_egg, 24, 3);
    L.fish = solid(tex.fish_blue, 400, 4);
    L.gold = solid(tex.fish_gold, 120, 4);
    L.heart = solid(tex.heart, 40, 4);
    L.chest = solid(tex.chest, 8, 4);
    L.phoebe = solid(tex.phoebe, 2, 5);
    L.phrolova = solid(tex.phrolova, 2, 5);
    L.phrolovaAtk = solid(tex.phrolova_atk, 2, 5);
    L.hecate = solid(tex.hecate, 2, 5);
    // 弗洛洛的特效是貼紙風的實心圖（不加亮），所以不受亮度設定影響，也不會過曝。
    // 貼地的圖案畫在角色之前、不寫入深度，所以永遠在角色與敵人腳下，不會遮住他們。
    const decal = (t, max, order) => new Layer(sc, t, max, { alphaTest: 0.4, flat: true, order, depthWrite: false });
    L.pslash = decal(tex.fx_slash, 40, 2.6);
    L.pflat = decal(tex.fx_lily_flat, 24, 2.5);
    L.pburst = decal(tex.fx_burst, 12, 2.4);
    L.pstand = new Layer(sc, tex.fx_lily_stand, 160, { alphaTest: 0.4, order: 8 });
    L.pnote = new Layer(sc, tex.fx_note, 60, { alphaTest: 0.4, center: true, order: 9 });
    L.rc = solid(tex.reggie_closed, 2, 5);
    L.ro = solid(tex.reggie_open, 2, 5);
    // v1.4：技能特效整體變淡（基準透明度約為 v1.3 的六成）。可用亮度設定再乘 0.55／1／1.45。
    L.disc = add(tex.disc, 160, 6, { flat: true, opacity: .18 });
    L.ring = add(tex.ring, 160, 7, { flat: true, opacity: .28 });
    L.beam = add(tex.beam, 180, 7, { flat: true, opacity: .32 });
    L.sigil = add(tex.sigil, 90, 7, { flat: true, opacity: .26 });
    L.prism = add(tex.prism, 180, 8, { center: true, opacity: .4 });
    L.pillar = add(tex.pillar, 70, 8, { opacity: .26 });
    // 獨立危險圖層最後繪製，不受亮度設定影響，避免技能亮光遮住頭目預警。
    L.dangerRing = add(tex.ring, 64, 11, { flat: true });
    L.dangerBeam = add(tex.beam, 180, 11, { flat: true });
    L.halo = add(tex.halo, 4, 8, { center: true, opacity: .6 });
    L.mirror = add(tex.fx_mirror, 24, 8, { center: true, opacity: .6 });
    L.star = add(tex.fx_star, 700, 9, { center: true, opacity: .55 });
    L.glow = add(tex.glow, 900, 9, { center: true, opacity: .28 });
    L.eshot = add(tex.fx_shot, 600, 9, { center: true });
    this.fxLayers = ['disc', 'ring', 'beam', 'sigil', 'prism', 'pillar', 'halo', 'mirror', 'star', 'glow'].map((k) => L[k]);
    this.setFxLevel(loadFxLevel());

    // 尺寸（高度，世界單位）
    this.sz = {
      phoebe: 1.95, phrolova: 2.1, hecate: 2.6,
      reggie: 2.15 / aspect.reggie_closed,
      hum: 1.2, bat: 1.15, golem: 1.85, shooter: 1.25,
    };
  }

  setChar(id) {
    this.charId = CHARACTERS[id] ? id : 'phoebe';
    try { localStorage.setItem(CHAR_KEY, this.charId); } catch { /* 私密模式 */ }
    return this.charId;
  }

  get char() { return CHARACTERS[this.charId || 'phoebe']; }

  /** 只有菲比會喊「菲比啾比」（真實取樣）；其他角色不播。 */
  voice(vol) { if ((this.charId || 'phoebe') === 'phoebe') sfx('chibi', vol); }

  setFxLevel(level) {
    this.fxLevel = FX_LEVELS[level] ? level : 'mid';
    for (const layer of this.fxLayers) layer.setScale(FX_LEVELS[this.fxLevel].scale);
    try { localStorage.setItem(FX_KEY, this.fxLevel); } catch { /* 私密模式 */ }
    return this.fxLevel;
  }

  cycleFxLevel() {
    const keys = Object.keys(FX_LEVELS);
    return this.setFxLevel(keys[(keys.indexOf(this.fxLevel) + 1) % keys.length]);
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
    this.charId ||= 'phoebe';
    this.p = {
      x: 0, z: 0, hp: CHARACTERS[this.charId || 'phoebe'].hp, maxhp: CHARACTERS[this.charId || 'phoebe'].hp, face: 1, inv: 0, lvl: 1, xp: 0, need: xpNeed(1),
      walk: 0, moving: false, prayer: 0, mode: null, modeT: 0, hurt: 0, regen: 0,
    };
    this.charId ||= 'phoebe';
    this.weapons = { [CHARACTERS[this.charId].start]: 1 };
    this.notes = 0; this.hecate = null; this.slashes = []; this.petalAng = 0;
    this.passives = {};
    this.petSkills = { roar: 1 };
    this.cd = { star: 0.4, ring: 0, litany: 2, field: 0, echo: 2.5, rain: 1.5, chain: 1, frost: 2, trail: 0, scythe: 0.3, dream: 1, coda: 0, lily: 0 };
    this.hazards = []; this.trails = []; this.petTrailCd = 0; this.bossKills = 0;
    this.mirrorZone = null; this.starStage = 0; this.damageBySkill = {}; this.synergyDamage = {}; this.synOn = new Set(); this.synFxCd = {};
    this.fieldT = 0;
    this.pet = {
      x: -1.6, z: 0.9, vx: 0, vz: 0, face: 1,
      roarCd: 4, slideCd: 5, pose: 0, poseFired: true, slide: 0, slideT: 0, slideDur: 1, slideLap: 0, slideX0: 0, slideZ0: 0, slideTheta0: 0,
      sdx: 0, sdz: 0, slideId: 0, bob: 0,
    };
    this.enemies = []; this.shots = []; this.eshots = []; this.pickups = []; this.parts = [];
    this.fxs = []; this.nums = []; this.strikes = []; this.waves = [];
    this.spawnAcc = 0; this.bossIdx = 0; this.swarmIdx = 0; this.nextId = 1; this.pending = 0;
    this.camPos.x = 0; this.camPos.z = 0;
    this.shake = 0; this.won = false; this.boss = null; this.endless = false; this.pendingCards = null;
    this.refreshSynergies(false);
    this.ui.setSlots(this);
  }

  start() {
    this.newRun();
    this.mode = 'play';
    this.ui.hideScreen();
    this.ui.showHud(true);
    this.ui.banner(this.charId === 'phrolova' ? '弗洛洛，出發！' : '菲比啾比，出發！', this.char.color);
    this.voice(0.5);
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
    const st = { charId: this.charId, time: this.t, kills: this.kills, lvl: this.p.lvl, fish: this.fishEaten, newBest: false, damageBySkill: this.damageBySkill, synergyDamage: this.synergyDamage };
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
  get synergies() { return SYNERGIES.filter((x) => (x.char || 'phoebe') === (this.charId || 'phoebe')); }
  get maestro() { return this.p.mode === 'maestro'; }
  get atk() { return (1 + Math.min(.9, (this.p.lvl - 1) * .025)) * (1 + 0.12 * (this.passives.might || 0)) * (this.absolve ? 1.35 : 1) * (this.maestro ? 1.25 : 1); }
  get cdm() { return Math.max(0.35, 1 - 0.08 * (this.passives.haste || 0)); }
  get area() { return 1 + 0.12 * (this.passives.area || 0); }
  get speed() { return 4.4 * (1 + 0.1 * (this.passives.speed || 0)); }
  get magnet() { return 2.4 * (1 + 0.3 * (this.passives.magnet || 0)); }
  get petAtk() { return (1 + 0.12 * (this.passives.might || 0)) * (this.confess ? 1.15 : 1); }

  setMode(m) {
    const p = this.p;
    if (this.mode !== 'play' || p.mode || p.prayer < PRAYER_MAX) return;
    const phrolova = this.charId === 'phrolova';
    if ((m === 'maestro') !== phrolova) return;          // 弗洛洛只有樂章；菲比只有赦罪／告解
    p.mode = m; p.modeT = MODE_TIME; p.prayer = 0;
    this.buildGrid();
    if (phrolova) {
      this.forNear(p.x, p.z, 7, (e) => this.hurt(e, 70, { stacks: 2, source: 'prayer' }));
      this.hecate = { x: p.x + 1.5, z: p.z - 1, ang: 0, cd: 0.3, n: 0, face: 1, bob: 0 };
      this.fxs.push({ kind: 'burst', x: p.x, z: p.z, r: 5.5, t: 0, life: 0.7 });
      p.atkT = 0.5;
      sfx('mode'); this.shake = Math.max(this.shake, 0.25);
      this.ui.banner('樂章 ・ 赫卡忒降臨', '#ff5470');
      this.flowerConfetti(p.x, p.z, 10);
      return;
    }
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
      if (w.owner && w.owner !== this.charId) continue;
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
    // 補齊連攜：夥伴技能已持有、自己還沒到 SYN_LV 的卡，被抽中的機率 ×2.5。
    for (const c of pool) {
      if (c.type === 'passive') continue;
      const mine = (c.type === 'pet' ? this.petSkills : this.weapons)[c.key] || 0;
      for (const sy of this.synergies) {
        const isA = sy.a === c.key && c.type === 'weapon'; const isB = sy.b === c.key && (sy.pet ? c.type === 'pet' : c.type === 'weapon');
        if (!isA && !isB) continue;
        const other = isA ? (sy.pet ? this.petSkills : this.weapons)[sy.b] : this.weapons[sy.a];
        if ((other || 0) >= 1 && mine < SYN_LV) { c.w *= 2.5; c.syn = sy.id; break; }
      }
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
    const combo = this.synergies.find((s) => (s.a === c.key && c.type === 'weapon') || (s.b === c.key && (s.pet ? c.type === 'pet' : c.type === 'weapon')));
    const lvOf = (k, pet) => (pet ? this.petSkills : this.weapons)[k] || 0;
    const hint = combo ? `｜⚡連攜 ${combo.name}（${WEAPONS[combo.a].name} Lv${lvOf(combo.a)}／${(combo.pet ? PET : WEAPONS)[combo.b].name} Lv${lvOf(combo.b, combo.pet)}，各需 Lv${SYN_LV}）${c.syn ? ' ★補齊連攜' : ''}` : '';
    const now = c.type === 'weapon' ? `${cur ? skillSummary(c.key, cur) + ' → ' : ''}${skillSummary(c.key, cur + 1)}` : d.lv[cur + 1];
    return { ...c, icon: d.icon, name: d.name, lv: `Lv ${cur + 1}`, now, desc: d.desc + hint, kind: c.type === 'pet' ? 'pet' : '', isNew: cur === 0, synHint: !!c.syn };
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
    this.refreshSynergies();
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
    if (e.dead) return 0;
    const mul = opts.mul != null ? opts.mul : this.atk;
    let d = base * mul;
    if (e.frz > 0) d *= 1 + e.frz * (this.absolve ? 0.09 : 0.03);
    if (this.confess) d *= 1.2;
    if (e.exposed > 0) d *= 1.2;
    const crit = rnd() < 0.08;
    if (crit) d *= 1.8;
    if (e.boss) d = this.bossDamage(e, d);
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
    return applied;
  }

  /** 頭目受傷修正：破防加成、共鳴護罩減傷、護盾吸收。回傳實際打到血量上的傷害。 */
  bossDamage(e, d) {
    if (e.vuln > 0) d *= e.vulnMul || 1.6;
    if (e.ward < 1) d *= e.ward;
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, d);
      e.shield -= absorbed; d -= absorbed;
      this.fxs.length < 90 && e.shield <= 0 && this.fxRing(e.x, e.z, 3.2, 0.4, [.5, .9, 1]);
    }
    return d;
  }

  /** 連攜是否啟動（雙方都達 SYN_LV）。 */
  syn(id) {
    const s = SYNERGIES.find((x) => x.id === id);
    return (this.weapons[s.a] || 0) >= SYN_LV && ((s.pet ? this.petSkills : this.weapons)[s.b] || 0) >= SYN_LV;
  }

  refreshSynergies(announce = true) {
    const now = new Set();
    for (const s of this.synergies) {
      const a = this.weapons[s.a] || 0; const b = (s.pet ? this.petSkills : this.weapons)[s.b] || 0;
      if (a >= SYN_LV && b >= SYN_LV) now.add(s.id);
    }
    if (announce) for (const s of this.synergies) if (now.has(s.id) && !this.synOn.has(s.id)) {
      this.ui.banner(`⚡ 連攜啟動：${s.name}`, '#7dffd2'); sfx('level');
      this.fxRing(this.p.x, this.p.z, 4.5, 0.7, [.5, 1, .85]);
    }
    this.synOn = now;
  }

  /** 記錄連攜貢獻的傷害，並限流顯示提示文字。 */
  addSyn(id, dmg, x, z, label) {
    this.synergyDamage[id] = (this.synergyDamage[id] || 0) + Math.max(0, dmg);
    if (label && (this.synFxCd[id] || 0) <= this.t) {
      this.synFxCd[id] = this.t + 0.7;
      this.popup(x, z, 2.4, label, '#7dffd2');
      this.fxRing(x, z, 1.6, 0.35, [.5, 1, .85]);
    }
  }

  kill(e) {
    if (e.dead) return;
    e.dead = true;
    this.kills++;
    sfx('kill', 0.05);
    this.burst(e.x, 0.5 * e.size, e.z, e.boss ? 60 : 6, { kind: 'glow', color: [0.85, 0.5, 1], speed: e.boss ? 8 : 3, life: 0.5, size: e.boss ? 1.2 : 0.4 });
    const def = ENEMIES[e.type];
    if (e.boss) {
      if (e.main) this.bossKills++; else this.eliteKills = (this.eliteKills || 0) + 1;
      this.hazards = this.hazards.filter((h) => h.owner !== e.id);
      for (const o of this.enemies) if (o.owner === e.id && !o.dead) o.dead = true;
      this.eshots = [];
      this.drop('chest', e.x, e.z, 0);
      const gold = e.elite ? 5 : 8;
      for (let i = 0; i < gold; i++) this.drop('gold', e.x + (rnd() - 0.5) * 3, e.z + (rnd() - 0.5) * 3, 5);
      for (let i = 0; i < 2; i++) this.drop('heart', e.x + (rnd() - 0.5) * 2, e.z + (rnd() - 0.5) * 2, 18);
      this.boss = this.enemies.find((o) => o.boss && !o.dead) || null;
      this.shake = 0.6;
      this.ui.banner(`${e.name} 被擊敗！`, '#ffd966');
      sfx('boom');
      if (e.main) this.voice(0.2);
    } else if (def.prop) {
      // 共鳴柱、噪卵：沒有掉落
    } else if (def.fish >= 4) this.drop('gold', e.x, e.z, def.fish);
    else {
      for (let i = 0; i < def.fish; i++) this.drop('fish', e.x + (rnd() - 0.5) * 0.6, e.z + (rnd() - 0.5) * 0.6, 1);
      if (rnd() < 0.012) this.drop('heart', e.x, e.z, 15);
    }
    if (e.type === 'egg' && e.hatching) return;
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
    p.inv = Math.max(0, p.inv - dt); p.hurt = Math.max(0, p.hurt - dt); p.atkT = Math.max(0, (p.atkT || 0) - dt);
    p.hp = Math.min(p.maxhp, p.hp + (this.confess ? 2.25 : 0.25) * dt);

    // 祈願
    if (p.mode) { p.modeT -= dt; if (p.modeT <= 0) { p.mode = null; p.modeT = 0; this.hecate = null; } }
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
    if (this.fxs.length > 90) return;
    this.fxs.push({ kind: 'sigil', style, x, z, r, t: 0, life: style === 'liberation' ? 1.1 : .65, color: this.charId === 'phrolova' ? [1, .25, .42] : this.confess ? [.35, .85, 1] : [1, .8, .3] });
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
        if (this.syn('mirrorstar')) {
          this.strikes.push({ x: e.x, z: e.z, r: this.mirrorZone.r, t: .35, max: .35,
            dmg: skillStats('litany', this.weapons.litany).damage, source: 'litany', style: 'starflash', syn: 'mirrorstar' });
          this.addSyn('mirrorstar', 0, e.x, e.z, '鏡映星柱！');
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
    this.updatePhrolova(dt);

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

  addNotes(n) {
    const gain = n * (this.maestro ? 2 : 1);
    this.notes = Math.min(6, this.notes + gain);
    for (let i = 0; i < Math.min(2, Math.ceil(gain)); i++) {
      this.fxs.push({ kind: 'note', x: this.p.x + (rnd() - 0.5) * 0.8, z: this.p.z, dx: (rnd() - 0.5) * 1.2, t: -i * 0.12, life: 0.8 });
    }
  }

  /** 地面上綻放的彼岸花：一朵平貼的大花加數朵站立的花，依序彈出。 */
  bloomFx(x, z, r, life, flowers) {
    const list = [];
    for (let i = 0; i < flowers; i++) list.push({ a: rnd() * TAU, rr: Math.sqrt(rnd()) * r * 0.8, delay: 0.05 + i * 0.07, sz: rnd() * 0.5 });
    this.fxs.push({ kind: 'bloom', x, z, r, t: 0, life, flowers: list });
  }

  /** 噴出的小朵彼岸花（貼紙風「彩帶」）。 */
  flowerConfetti(x, z, n, ang = null) {
    for (let i = 0; i < n; i++) {
      const a = ang == null ? rnd() * TAU : ang + (rnd() - 0.5) * 1.4;
      const v = 2.2 + rnd() * 2.6;
      this.fxs.push({ kind: 'flower', x, z, vx: Math.cos(a) * v, vz: Math.sin(a) * v, t: 0, life: 0.55 + rnd() * 0.2, spin: (rnd() - 0.5) * 3 });
    }
  }

  /** 弗洛洛的技能：彼岸斬、轉生之夢、緋紅終章、彼岸花環，以及樂章中的赫卡忒。 */
  updatePhrolova(dt) {
    const W = this.weapons; const p = this.p;
    if (W.scythe && this.cd.scythe <= 0) {
      const target = this.nearest(p.x, p.z, 1, 5.5)[0];
      if (target) {
        const s = skillStats('scythe', W.scythe);
        this.cd.scythe = s.cooldown * this.cdm * (this.maestro ? 0.8 : 1);
        const a = Math.atan2(target.z - p.z, target.x - p.x);
        for (let k = 0; k < s.swings; k++) this.slashes.push({ delay: k * 0.17, ang: k === 2 ? a + Math.PI : a, flip: k % 2 });
        p.face = Math.cos(a) >= 0 ? 1 : -1;
      } else this.cd.scythe = 0.2;
    }
    for (const sl of this.slashes) {
      sl.delay -= dt;
      if (sl.delay > 0 || sl.done) continue;
      sl.done = true;
      const s = skillStats('scythe', W.scythe || 1);
      const R = s.radius * this.area; let hit = 0;
      this.fxs.push({ kind: 'slash', x: p.x, z: p.z, ang: sl.ang, r: R, t: 0, life: 0.3, flip: sl.flip });
      p.atkT = 0.3; this.flowerConfetti(p.x + Math.cos(sl.ang) * R * 0.7, p.z + Math.sin(sl.ang) * R * 0.7, 2, sl.ang);
      this.forNear(p.x, p.z, R, (e) => {
        let df = Math.atan2(e.z - p.z, e.x - p.x) - sl.ang;
        while (df > Math.PI) df -= TAU; while (df < -Math.PI) df += TAU;
        if (Math.abs(df) > s.arc / 2 + 0.1) return;
        const cut = this.syn('dreamcut') && e.slowT > 0;
        const dealt = this.hurt(e, s.damage * (cut ? 1.6 : 1), { stacks: 1, knock: 1.2, kx: Math.cos(sl.ang), kz: Math.sin(sl.ang), source: 'scythe' });
        if (cut) this.addSyn('dreamcut', dealt * (1 - 1 / 1.6), e.x, e.z, '斬！');
        hit++;
      });
      if (hit) { this.addNotes(1); sfx('beam', 0.15); p.hp = Math.min(p.maxhp, p.hp + Math.min(2, hit * 0.3)); }
    }
    this.slashes = this.slashes.filter((sl) => !sl.done);

    if (W.dream && this.cd.dream <= 0) {
      const target = this.nearest(p.x, p.z, 1, 10)[0];
      if (target) {
        const s = skillStats('dream', W.dream);
        this.cd.dream = s.cooldown * this.cdm;
        const R = s.radius * this.area;
        this.bloomFx(target.x, target.z, R, 0.8, 4);
        p.atkT = 0.4;
        this.forNear(target.x, target.z, R, (e) => {
          this.hurt(e, s.damage, { stacks: 2, stun: 0.9, source: 'dream' });
          this.slow(e, s.duration, 0.45);
        });
        this.addNotes(2);
        sfx('rain', 0.1);
      } else this.cd.dream = 0.3;
    }

    if (W.coda) {
      const s = skillStats('coda', W.coda);
      if (this.notes >= s.notes && this.cd.coda <= 0 && this.nearest(p.x, p.z, 1, 9).length) {
        this.notes = 0; this.cd.coda = s.cooldown * this.cdm;
        const R = s.radius * this.area;
        this.fxs.push({ kind: 'burst', x: p.x, z: p.z, r: R, t: 0, life: 0.65 });
        p.atkT = 0.5;
        this.forNear(p.x, p.z, R, (e) => {
          const dx = p.x - e.x; const dz = p.z - e.z; const d = Math.hypot(dx, dz) || 1;
          const boom = this.syn('finale') && e.frz >= 3;
          if (boom) e.frz = Math.max(0, e.frz - 3);
          const dealt = this.hurt(e, s.damage * (boom ? 1.7 : 1), { stacks: 3, knock: Math.min(8, d * 2.2), kx: dx / d, kz: dz / d, source: 'coda' });
          if (boom) { this.addSyn('finale', dealt * (1 - 1 / 1.7), e.x, e.z, '花海！'); this.bloomFx(e.x, e.z, 1.4, 0.6, 1); }
        });
        this.ui.banner('緋紅終章！', '#ff5470'); sfx('boom', 0.1); this.shake = Math.max(this.shake, 0.3);
      }
    }

    if (W.lily) {
      const s = skillStats('lily', W.lily);
      this.petalAng += s.speed * dt;
      this.petalCd = (this.petalCd || 0) - dt;
      if (this.petalCd <= 0) {
        this.petalCd = s.cooldown * this.cdm;
        const R = s.radius * this.area;
        for (let i = 0; i < s.count; i++) {
          const a = this.petalAng + i * TAU / s.count;
          this.forNear(p.x + Math.cos(a) * R, p.z + Math.sin(a) * R, 0.85, (e) => this.hurt(e, s.damage, { stacks: 1, knock: 1, kx: Math.cos(a), kz: Math.sin(a), source: 'lily' }));
        }
      }
    }

    const h = this.hecate;
    if (h) {
      h.bob += dt; h.ang += dt * 1.1;
      const tx = p.x + Math.cos(h.ang) * 2.4; const tz = p.z + Math.sin(h.ang) * 2.4 - 0.6;
      h.x += (tx - h.x) * Math.min(1, dt * 5); h.z += (tz - h.z) * Math.min(1, dt * 5);
      h.cd -= dt;
      if (h.cd <= 0) {
        const tgt = this.nearest(h.x, h.z, 1, 9)[0];
        if (tgt) {
          h.cd = 0.55; h.n++;
          const big = h.n % 3 === 0;
          const a = Math.atan2(tgt.z - h.z, tgt.x - h.x);
          h.face = Math.cos(a) >= 0 ? 1 : -1;
          const R = (big ? 5.2 : 4.4) * this.area;
          this.fxs.push({ kind: 'slash', x: h.x, z: h.z, ang: a, r: R, t: 0, life: 0.34, flip: h.n % 2, hecate: true, full: big });
          const dmg = (30 + 1.6 * p.lvl) * (big ? 1.8 : 1);
          this.forNear(h.x, h.z, R, (e) => {
            if (!big) {
              let df = Math.atan2(e.z - h.z, e.x - h.x) - a;
              while (df > Math.PI) df -= TAU; while (df < -Math.PI) df += TAU;
              if (Math.abs(df) > 0.9) return;
            }
            this.hurt(e, dmg, { stacks: big ? 2 : 1, source: 'hecate' });
          });
        } else h.cd = 0.2;
      }
    }
  }

  updateNewWeapons(dt) {
    const W = this.weapons; const p = this.p;
    if (W.chain && this.cd.chain <= 0) {
      const stats = skillStats('chain', W.chain);
      this.cd.chain = stats.cooldown * this.cdm;
      let x = p.x; let z = p.z;
      const hit = new Set();
      const bonus = this.syn('refract') ? 2 : 0;
      const count = stats.count + bonus;
      for (let i = 0; i < count; i++) {
        const e = this.nearest(x, z, count + 1, i ? stats.reach : 10).find((o) => !hit.has(o.id));
        if (!e) break;
        hit.add(e.id);
        const len = Math.hypot(e.x - x, e.z - z) || 0.01;
        const extra = i >= stats.count;
        this.fxs.push({ kind: 'beam', x, z, dx: (e.x - x) / len, dz: (e.z - z) / len, len, w: extra ? 0.3 : 0.18, t: 0, life: extra ? 0.45 : 0.3, refract: true, color: extra ? [1, .85, .35] : null });
        this.sigilFx(e.x, e.z, extra ? .9 : .65, 'refraction');
        const dealt = this.hurt(e, stats.damage * (extra ? 1.25 : 1), { stacks: 1, source: 'chain' });
        if (extra) this.addSyn('refract', dealt, e.x, e.z, '折射連攜');
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
    if (this.syn('tide') && this.pet.slide > 0 && this.pet.slideT < this.pet.slideDur - .35 && this.petTrailCd <= 0) {
      this.petTrailCd = 0.18;
      this.leaveTrail(this.pet.x, this.pet.z, 2, true);
    }
    for (const f of this.trails) {
      f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = .45 * this.cdm;
        this.forNear(f.x, f.z, f.r, (e) => {
          // 重疊光痕每半秒只命中一次，避免原地繞圈傷害無限堆疊。
          if ((e.trailHit || -1) > this.t) return;
          e.trailHit = this.t + f.tick - .01;
          const dealt = this.hurt(e, f.dmg, { stacks: 1, source: 'trail' });
          if (f.tide) this.addSyn('tide', dealt * .5, e.x, e.z, '踏浪光痕');
        });
      }
    }
    this.trails = this.trails.filter((f) => f.life > 0);
  }

  leaveTrail(x, z, mul, tide = false) {
    const lv = this.weapons.trail;
    const stats = skillStats('trail', lv);
    if (this.trails.length >= 60) this.trails.shift();
    this.trails.push({ x, z, r: stats.radius * this.area, life: stats.duration, tick: 0, dmg: stats.damage * mul, tide });
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
      const shatter = this.syn('shatter') && e.slowT > 0;
      const dealt = this.hurt(e, dmg * (1 + 0.04 * e.frz) * (shatter ? 1.6 : 1) * (this.absolve && e.frz > 0 ? 1.4 : 1), { stacks: this.confess ? 2 : 1, knock: 1.5, kx: dx, kz: dz, source: 'litany' });
      if (shatter) { this.addSyn('shatter', dealt * (1 - 1 / 1.6), e.x, e.z, '碎！'); this.sigilFx(e.x, e.z, .8, 'refraction'); }
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
          const combo = this.syn('echoboom') && e.frz >= 3;
          if (combo) e.frz = Math.max(0, e.frz - 3);
          const dealt = this.hurt(e, w.dmg * (combo ? 1.8 : 1), { stacks: 2, knock: 5, kx: (e.x - w.x) / (d || 1), kz: (e.z - w.z) / (d || 1), source: 'echo' });
          if (combo) { this.addSyn('echoboom', dealt * (1 - 1 / 1.8), e.x, e.z, '引爆！'); this.sigilFx(e.x, e.z, 1.1, 'refraction'); }
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
          const dealt = this.hurt(e, s.dmg * (this.absolve && s.source === 'rain' ? 1.5 : 1), { stacks: this.confess ? 3 : 2, knock: 3, kx: (e.x - s.x) / dd, kz: (e.z - s.z) / dd, source: s.source || 'rain' });
          if (s.syn) this.addSyn(s.syn, dealt);
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
    pt.roarCd -= dt; pt.slideCd -= dt;
    pt.bob += dt;
    const home = () => ({ x: p.x - p.face * 1.7, z: p.z + 0.9 + Math.sin(pt.bob * 1.5) * 0.25 });

    if (pt.slide > 0) {
      // 肚皮滑行：以玩家為圓心繞圈（Lv8 兩圈），最後回到角色身旁。
      const sl = lv.slide || 1;
      const s = petStats('slide', sl);
      pt.slide -= dt; pt.slideT += dt;
      const moveT = pt.slideDur - 0.35;           // 最後 0.35 秒用來回到身邊
      let target;
      if (pt.slideT <= moveT) {
        const q = pt.slideT / moveT;
        const theta = pt.slideTheta0 + q * TAU * s.laps;
        const enter = Math.min(1, pt.slideT / 0.25);    // 前 0.25 秒從原位置滑入圓周
        const rr = s.radius * this.area;
        const ox = p.x + Math.cos(theta) * rr; const oz = p.z + Math.sin(theta) * rr;
        target = { x: pt.slideX0 + (ox - pt.slideX0) * enter, z: pt.slideZ0 + (oz - pt.slideZ0) * enter };
        pt.slideLap = Math.min(s.laps - 1, Math.floor(q * s.laps));
        pt.face = -Math.sin(theta) >= 0 ? 1 : -1;
        pt.sdx = -Math.sin(theta); pt.sdz = Math.cos(theta);
        const key = `${pt.slideId}:${pt.slideLap}`;
        this.forNear(pt.x, pt.z, s.hit * this.area, (e) => {
          if (e.slideKey === key) return;
          e.slideKey = key;
          this.hurt(e, s.damage, { mul: this.petAtk, stacks: 1, knock: 3, kx: pt.sdx, kz: pt.sdz, source: 'slide' });
        });
        if (rnd() < 0.8) this.burst(pt.x, 0.3, pt.z, 2, { kind: 'glow', color: [0.5, 0.8, 1], speed: 1.5, life: 0.5, size: 0.5, up: 2.5 });
      } else {
        const h = home(); const q = clamp((pt.slideT - moveT) / 0.35, 0, 1);
        pt.slideX1 = pt.slideX1 ?? pt.x; pt.slideZ1 = pt.slideZ1 ?? pt.z;
        target = { x: pt.slideX1 + (h.x - pt.slideX1) * q, z: pt.slideZ1 + (h.z - pt.slideZ1) * q };
        pt.sdx = 0; pt.sdz = 0;
      }
      pt.x = target.x; pt.z = target.z;
      if (pt.slide <= 0) { pt.slide = 0; pt.slideX1 = null; pt.slideZ1 = null; }
    } else if (pt.pose > 0) {
      // 張嘴吼：先蓄力，再放出聲波
      const r = lv.roar || 1;
      pt.pose -= dt;
      const total = 0.85;
      if (!pt.poseFired && pt.pose <= total - 0.4) {
        pt.poseFired = true;
        const s = petStats('roar', r);
        const R = s.radius * this.area;
        this.forNear(pt.x, pt.z, R, (e) => {
          const d = Math.hypot(e.x - pt.x, e.z - pt.z) || 1;
          this.hurt(e, s.damage, { mul: this.petAtk, knock: 6, kx: (e.x - pt.x) / d, kz: (e.z - pt.z) / d, stun: s.stun, stacks: 1, source: 'roar' });
        });
        this.fxRing(pt.x, pt.z, R, 0.45, [0.7, 0.9, 1]);
        this.fxRing(pt.x, pt.z, R * 0.7, 0.35, [1, 1, 1]);
        this.popup(pt.x, pt.z, 2.7, '嗷！', '#bfe6ff');
        this.shake = Math.max(this.shake, 0.22);
      }
    } else {
      // 跟隨玩家
      const h = home();
      const dx = h.x - pt.x; const dz = h.z - pt.z; const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const sp = 6.2;
        const s = Math.min(d * 5, sp * (d > 8 ? 2.2 : 1)) * dt;
        pt.x += (dx / d) * s; pt.z += (dz / d) * s;
        if (Math.abs(dx) > 0.15) pt.face = dx > 0 ? 1 : -1;
      }
      if (d2(pt.x, pt.z, p.x, p.z) > 144) { pt.x = p.x - 2; pt.z = p.z + 1; }
    }

    if (pt.pose <= 0 && pt.slide <= 0) {
      const r = lv.roar || 1;
      if (pt.roarCd <= 0) {
        const s = petStats('roar', r);
        const R = s.radius * this.area;
        let near = 0; let boss = false;
        this.forNear(pt.x, pt.z, R + 1.2, (e) => { near++; if (e.boss) boss = true; });
        if (near >= 2 || boss) {
          pt.pose = 0.85; pt.poseFired = false;
          sfx('roar', 0.15);
          pt.roarCd = s.cooldown * this.cdm;
          pt.face = (this.nearest(pt.x, pt.z, 1, 12)[0]?.x ?? pt.x + pt.face) >= pt.x ? 1 : -1;
        } else pt.roarCd = 0.4;
      } else if (lv.slide && pt.slideCd <= 0) {
        const s = petStats('slide', lv.slide);
        const R = s.radius * this.area;
        let near = 0;
        this.forNear(p.x, p.z, R + 2, () => { near++; });
        if (near >= 3) {
          pt.slide = pt.slideDur = s.duration * s.laps + 0.35; pt.slideT = 0; pt.slideLap = 0;
          pt.slideX0 = pt.x; pt.slideZ0 = pt.z; pt.slideTheta0 = Math.atan2(pt.z - p.z, pt.x - p.x);
          pt.slideId = ++this.nextId;
          pt.slideCd = s.cooldown * this.cdm;
          sfx('roar', 0.15);
        } else pt.slideCd = 0.5;
      }
    }
  }

  // ───────────────────────── 敵人 ─────────────────────────
  rnd() { return rnd(); }

  warnBlast(e, x, z, r = 2, delay = 1.2) {
    if (this.hazards.length >= 72) return;
    this.hazards.push({ kind: 'blast', owner: e.id, x, z, r, left: delay, max: delay, dmg: e.dmg, fired: false });
  }

  /** 旋轉光束：先預警 warn 秒，之後持續 dur 秒、每秒轉 w 弧度，起點跟著頭目。 */
  addBeam(e, ang, { w = 0.7, warn = 1.3, dur = 4, len = 18, width = 1.4 } = {}) {
    if (this.hazards.length >= 72) return;
    this.hazards.push({ kind: 'beam', owner: e.id, src: e, ang, w, left: warn, max: warn, dur, t: 0, len, width, dmg: e.dmg });
  }

  /** 以場地中心為圓心的扇形（安全區輪替用）。 */
  addSector(e, a0, a1, r, delay) {
    if (this.hazards.length >= 72) return;
    this.hazards.push({ kind: 'sector', owner: e.id, a0, a1, r, left: delay, max: delay, dmg: e.dmg * 1.2, fired: false });
  }

  /** 從頭目位置朝 ang 展開的扇形（蟹鉗橫掃）。 */
  addCone(e, ang, spread, r, delay) {
    if (this.hazards.length >= 72) return;
    this.hazards.push({ kind: 'cone', owner: e.id, x: e.x, z: e.z, ang, spread, r, left: delay, max: delay, dmg: e.dmg * 1.1, fired: false });
  }

  spawnProp(type, x, z, owner) {
    const e = this.makeEnemy(type, x, z);
    e.owner = owner.id;
    return e;
  }

  updateHazards(dt) {
    const p = this.p;
    const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
    for (const h of this.hazards) {
      if (h.kind === 'beam') {
        if (h.src.dead) { h.done = true; continue; }
        if (h.left > 0) { h.left -= dt; continue; }
        h.t += dt; h.ang += h.w * dt;
        if (h.t >= h.dur) { h.done = true; continue; }
        const ox = h.src.x; const oz = h.src.z;
        const rx = p.x - ox; const rz = p.z - oz;
        const along = rx * Math.cos(h.ang) + rz * Math.sin(h.ang);
        const perp = Math.abs(rx * Math.sin(h.ang) - rz * Math.cos(h.ang));
        if (along > 0 && along < h.len && perp < h.width / 2 + 0.38) this.hurtPlayer(h.dmg);
        continue;
      }
      h.left -= dt;
      if (h.left <= 0 && !h.fired) {
        h.fired = true;
        if (h.kind === 'sector') {
          const dist = Math.hypot(p.x, p.z);
          const mid = (h.a0 + h.a1) / 2; const half = (h.a1 - h.a0) / 2;
          if (dist <= h.r && Math.abs(angDiff(Math.atan2(p.z, p.x), mid)) <= half) this.hurtPlayer(h.dmg);
          this.fxRing(0, 0, ARENA_RADIUS, 0.4, [1, 0.15, 0.35]);
          sfx('boom', 0.2);
        } else if (h.kind === 'cone') {
          const dx = p.x - h.x; const dz = p.z - h.z;
          if (Math.hypot(dx, dz) <= h.r + 0.38 && Math.abs(angDiff(Math.atan2(dz, dx), h.ang)) <= h.spread / 2) this.hurtPlayer(h.dmg);
          this.fxRing(h.x, h.z, h.r, 0.35, [1, 0.15, 0.35]);
          sfx('boom', 0.2);
        } else {
          if (d2(h.x, h.z, p.x, p.z) <= (h.r + 0.38) ** 2) this.hurtPlayer(h.dmg);
          this.fxRing(h.x, h.z, h.r, 0.35, [1, 0.15, 0.35]);
          sfx('boom', 0.2);
        }
      }
    }
    this.hazards = this.hazards.filter((h) => (h.kind === 'beam' ? !h.done : h.left > -0.3));
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
      dmg: d.dmg, size: d.size, frz: 0, frzT: 0, flash: 0, stun: 0, slowT: 0, slowMul: 1, ringCd: 0, boss: !!d.boss, prop: !!d.prop, elite: !!d.elite, dead: false,
      name: d.name, vuln: 0, vulnMul: 1, ward: 1,
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
    this.spawnBosses();
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

  /** 依時間表出頭目；無盡模式依序輪替，每輪多一隻同時出場。 */
  spawnBosses() {
    const t = this.t;
    let entry = null;
    if (this.bossIdx < BOSS_SCHEDULE.length) {
      if (t >= BOSS_SCHEDULE[this.bossIdx].at) entry = BOSS_SCHEDULE[this.bossIdx];
    } else if (this.endless) {
      const n = this.bossIdx - BOSS_SCHEDULE.length;
      if (t >= 540 + 150 * (n + 1)) entry = { id: ENDLESS_ORDER[n % ENDLESS_ORDER.length], endless: true, extra: Math.floor(n / ENDLESS_ORDER.length) };
    }
    if (!entry) return;
    this.bossIdx++;
    this.spawnBoss(entry.id, entry);
    for (let i = 0; i < (entry.extra || 0); i++) this.spawnBoss(ENDLESS_ORDER[(this.bossIdx + i + 2) % ENDLESS_ORDER.length], { endless: true });
  }

  spawnBoss(id, entry = {}) {
    const def = ENEMIES[id];
    const e = this.spawnAround(id, 12);
    const growth = 1 + this.t / 600;
    e.hp = e.maxhp = def.hp * growth * (entry.endless ? 1.3 : 1);
    e.bossId = id; e.main = !!entry.main; e.ai = null;
    this.boss = this.boss && !this.boss.dead ? this.boss : e;
    this.ui.banner(`⚠ ${def.name}${def.elite ? '（精英）' : ''}：${BOSS_HINT[id]}`, def.elite ? '#7deaff' : '#ff6ad5');
    sfx('boss');
    this.shake = 0.5;
    return e;
  }

  updateEnemies(dt) {
    const p = this.p;
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.flash = Math.max(0, e.flash - dt);
      e.ringCd = Math.max(0, e.ringCd - dt);
      this.updateSlow(e, dt);
      e.exposed = Math.max(0, e.exposed - dt);
      if (e.vuln > 0) e.vuln -= dt;
      if (e.prop) {
        if (e.type === 'egg') {
          e.hatch -= dt;
          if (e.hatch <= 0) {
            e.hatching = true; e.dead = true;
            this.fxRing(e.x, e.z, 1.6, 0.4, [1, .3, .4]);
            const c = this.makeEnemy('charger', e.x, e.z); c.atkT = 0.8;
          }
        }
        continue;
      }
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
          const ai = BOSS_AI[e.bossId];
          if (ai) { const m = ai(this, e, dt, { dx, dz, d, ux, uz, sp }); ux = m.ux; uz = m.uz; sp = m.sp; }
        }
        if (e.boss) { /* 頭目自己管理狀態 */ } else if (e.state === 2) {
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

      if (e.dmg > 0 && d2(e.x, e.z, p.x, p.z) < (e.r + 0.38) ** 2) this.hurtPlayer(e.dmg);
      if (d > 30 && !e.state && !e.boss) {
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
    const p = this.p;
    const mr = this.magnet;
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
        if (f.kind === 'heart') { p.hp = Math.min(p.maxhp, p.hp + f.v); this.num(p.x, p.z, 2.2, `+${f.v}`, '#7dffb0', 1.1); sfx('fish', 0.05); } else { this.addXp(f.v); if (f.kind !== 'chest') this.fishEaten++; sfx('fish', 0.04); }
        continue;
      }
    }
    this.pickups = this.pickups.filter((f) => !f.dead);
  }

  // ───────────────────────── 測試用機器人 ─────────────────────────
  /** 某個地面點在 t 秒後的危險分數（預警圖形、光束、彈幕）。供測試機器人用。 */
  dangerAt(x, z, ahead = 0.45) {
    let danger = 0;
    for (const h of this.hazards) {
      if (h.kind === 'beam') {
        const ang = h.ang + (h.left > 0 ? 0 : h.w * ahead);
        const rx = x - h.src.x; const rz = z - h.src.z;
        const along = rx * Math.cos(ang) + rz * Math.sin(ang); const perp = Math.abs(rx * Math.sin(ang) - rz * Math.cos(ang));
        if (along > -1 && along < h.len + 1 && perp < h.width / 2 + 1.0) danger += h.left > 0 ? 3 : 8;
      } else if (h.left < 1.1 || h.kind === 'blast') {
        if (h.kind === 'sector') {
          const mid = (h.a0 + h.a1) / 2; const half = (h.a1 - h.a0) / 2;
          let df = Math.atan2(z, x) - mid; while (df > Math.PI) df -= TAU; while (df < -Math.PI) df += TAU;
          if (Math.abs(df) <= half + 0.1) danger += 10;
        } else if (h.kind === 'cone') {
          const dx = x - h.x; const dz = z - h.z;
          let df = Math.atan2(dz, dx) - h.ang; while (df > Math.PI) df -= TAU; while (df < -Math.PI) df += TAU;
          if (Math.hypot(dx, dz) <= h.r + 0.8 && Math.abs(df) <= h.spread / 2 + 0.15) danger += 10;
        } else if (d2(x, z, h.x, h.z) <= (h.r + 0.8) ** 2) danger += 10;
      }
    }
    for (const e of this.enemies) {
      if (e.tele) {
        const rx = x - e.x; const rz = z - e.z;
        const along = rx * e.tele.dx + rz * e.tele.dz; const perp = Math.abs(rx * e.tele.dz - rz * e.tele.dx);
        if (along > -1 && along < e.tele.len && perp < e.tele.w / 2 + 1) danger += 10;
      }
      if (e.dead || e.prop) continue;
      const rr = e.r + 0.9 + (e.boss ? 0.8 : 0);
      if (d2(x, z, e.x, e.z) < rr * rr) danger += e.boss ? 6 : 1.5;
    }
    for (const b of this.eshots) {
      const fx = b.x + b.vx * ahead; const fz = b.z + b.vz * ahead;
      if (d2(x, z, fx, fz) < 1.1 * 1.1) danger += 4;
    }
    return danger;
  }

  botInput() {
    const p = this.p;
    // 八個方向＋原地：預測短時間後的危險，挑分數最低且靠近撿取物的一個。
    let best = { x: 0, z: 0 }; let bs = Infinity;
    const wantX = p.x; const wantZ = p.z;
    let nearest = null; let nd = 64;
    for (const f of this.pickups) { const d = d2(f.x, f.z, p.x, p.z); if (d < nd) { nd = d; nearest = f; } }
    for (let k = -1; k < 8; k++) {
      const dx = k < 0 ? 0 : Math.cos(k * Math.PI / 4); const dz = k < 0 ? 0 : Math.sin(k * Math.PI / 4);
      const step = this.speed * 0.5;
      const q = clampArena(p.x + dx * step, p.z + dz * step, ARENA_RADIUS - 0.5);
      let score = this.dangerAt(q.x, q.z) * 3 + this.dangerAt(p.x + dx * step * 0.5, p.z + dz * step * 0.5, 0.2) * 2;
      // 靠牆扣分，避免被擠到角落
      score += Math.max(0, Math.hypot(q.x, q.z) - (ARENA_RADIUS - 4)) * 0.4;
      if (nearest) score -= (Math.hypot(wantX - nearest.x, wantZ - nearest.z) - Math.hypot(q.x - nearest.x, q.z - nearest.z)) * 0.5;
      // 沿圓周繞行（光痕才有輸出），沒有撿取物時慢慢轉圈
      score -= (dx * -Math.sin(this.t * 0.3) + dz * Math.cos(this.t * 0.3)) * 0.15;
      if (score < bs) { bs = score; best = { x: dx, z: dz }; }
    }
    this.input.x = best.x; this.input.z = best.z;
    if (!p.mode && p.prayer >= PRAYER_MAX) this.setMode(this.charId === 'phrolova' ? 'maestro' : Math.floor(this.t / 40) % 2 ? 'confess' : 'absolve');
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
        if (e.boss && e.vuln > 0) { r = 1.45; g = 1.25; b = 0.7; }
        else if (e.boss && e.ward < 1) { r = 0.7; g = 0.85; b = 1.35; }
        if (e.type === 'egg') { const q = clamp(1 - e.hatch / 6, 0, 1); r = 1 + q * 0.9; g = 1 - q * 0.4; b = 1 - q * 0.3; }
      }
      if (e.boss) y = Math.sin(t * 1.6 + e.ph) * 0.12;
      layer.add(e.x, y, e.z, h * asp * sxs, h * sy, roll, r, g, b, e.x > p.x && !def.boss && !def.prop && e.type !== 'hum');
      if (e.boss && e.shield > 0) L.glow.add(e.x, h * 0.5, e.z, h * 1.5, h * 1.5, 0, 0.2 + 0.2 * (e.shield / e.shieldMax), 0.5, 0.8);
      if (e.type === 'pillar') L.glow.add(e.x, h * 0.6, e.z, 2.6, 2.6, 0, 0.2, 0.55, 0.6);
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
    const phro = this.charId === 'phrolova';
    const key = phro ? 'phrolova' : 'phoebe';
    const spriteKey = phro && p.atkT > 0 ? 'phrolova_atk' : key;     // 施法時換成攻擊姿勢
    const hh = this.sz[key]; const asp = this.assets.aspect[spriteKey];
    const w = p.moving ? Math.sin(p.walk * 11) : Math.sin(t * 2.5) * 0.25;
    const bob = p.moving ? Math.abs(w) * 0.12 : (w + 1) * 0.02;
    const blink = p.inv > 0 && Math.floor(t * 20) % 2 === 0;
    let r = 1; let g = 1; let b = 1;
    if (p.hurt > 0) { r = 2; g = 0.8; b = 0.8; }
    if (blink) { r *= 0.6; g *= 0.6; b *= 0.6; }
    (spriteKey === 'phrolova_atk' ? L.phrolovaAtk : L[key]).add(p.x, bob, p.z, hh * asp * (1 - w * 0.03), hh * (1 + Math.abs(w) * 0.03), p.moving ? w * 0.06 : 0, r, g, b, p.face < 0);
    L.shadow.add(p.x, 0.02, p.z + 0.05, 1.5, 0.8, 0, 1, 1, 1);
    if (p.mode === 'maestro') L.pflat.add(p.x, 0.03, p.z + 0.1, 3.8, 3.8, t * 0.5, 1, 1, 1);
    else if (p.mode) {
      const c = p.mode === 'absolve' ? [1, 0.82, 0.3] : [0.45, 0.85, 1];
      L.halo.add(p.x, hh + 0.12 + Math.sin(t * 3) * 0.05, p.z, 1.5, 0.56, 0, c[0], c[1], c[2]);
      L.glow.add(p.x, 1, p.z, 3.4, 3.4, 0, c[0] * 0.35, c[1] * 0.35, c[2] * 0.35);
    }
    const h = this.hecate;
    if (h) {
      const ha = this.assets.aspect.hecate; const hs = this.sz.hecate;
      L.hecate.add(h.x, 0.35 + Math.sin(h.bob * 3) * 0.14, h.z, hs * ha, hs, Math.sin(h.bob * 2) * 0.05, 1, 1, 1, h.face < 0);
      L.shadow.add(h.x, 0.02, h.z + 0.05, 1.6, 0.8, 0, 1, 1, 1);
    }
    if (this.weapons.lily) {
      const s = skillStats('lily', this.weapons.lily); const R = s.radius * this.area;
      for (let i = 0; i < s.count; i++) {
        const a = this.petalAng + i * TAU / s.count;
        const fa = this.assets.aspect.fx_lily_stand;
        L.pstand.add(p.x + Math.cos(a) * R, 0.05, p.z + Math.sin(a) * R, 0.95 * fa, 0.95, Math.sin(a * 2 + t * 3) * 0.12, 1, 1, 1);
      }
    }
  }

  drawPet(t) {
    const pt = this.pet; const L = this.L;
    const base = this.sz.reggie;
    const s = 1;
    let sx = 1; let sy = 1; let roll = 0; let y = 0;
    const open = pt.pose > 0;
    if (pt.slide > 0) { sy = 0.72; sx = 1.12; roll = -pt.sdz * 0.15 * pt.face; }
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
    layer.add(pt.x, y, pt.z, h * asp * sx, h * sy, roll, 1, 1, 1, pt.face < 0);
    L.shadow.add(pt.x, 0.02, pt.z + 0.05, 2.2 * s, 0.9 * s, 0, 1, 1, 1);
    if (pt.pose > 0.45) {
      const q = 1 - (pt.pose - 0.45) / 0.4;
      L.glow.add(pt.x + pt.face * 1.5, 1, pt.z, 1.2 + q * 0.6, 1.2 + q * 0.6, 0, 0.6 * q, 0.8 * q, 1 * q);
    }
  }

  drawEffects(t) {
    const L = this.L; const p = this.p;
    for (const h of this.hazards) {
      const q = clamp(1 - h.left / h.max, 0, 1);
      if (h.kind === 'beam') {
        const o = h.src; const c = Math.cos(h.ang); const sn = Math.sin(h.ang);
        const live = h.left <= 0;
        const width = live ? h.width : 0.3 + Math.sin(t * 22) * 0.06;
        const k = live ? 1.15 : 0.7;
        L.dangerBeam.add(o.x + c * h.len / 2, 0.075, o.z + sn * h.len / 2, h.len, width, -h.ang, 1.3 * k, 0.12 * k, 0.28 * k);
        if (!live) L.dangerBeam.add(o.x + c * h.len / 2, 0.074, o.z + sn * h.len / 2, h.len * q, h.width, -h.ang, 0.35, 0.03, 0.06);
      } else if (h.kind === 'sector') {
        // 扇形用幾條同心環帶近似（每條是一塊不重疊的矩形），亮度隨預警進度增加。
        const mid = (h.a0 + h.a1) / 2; const span = h.a1 - h.a0; const bands = 6; const dr = h.r / bands;
        for (let i = 0; i < bands; i++) {
          const rm = dr * (i + 0.5);
          L.dangerBeam.add(Math.cos(mid) * rm, 0.066, Math.sin(mid) * rm, dr * 1.02, 2 * rm * Math.sin(span / 2) * 0.98, -mid, 0.22 + 0.5 * q, 0.03, 0.08);
        }
      } else if (h.kind === 'cone') {
        for (let i = -1; i <= 1; i++) {
          const a = h.ang + i * h.spread / 3;
          L.dangerBeam.add(h.x + Math.cos(a) * h.r / 2, 0.068, h.z + Math.sin(a) * h.r / 2, h.r, h.r * h.spread / 3 * 0.85, -a, 0.45 + 0.8 * q, 0.06, 0.14);
        }
      } else {
        L.dangerRing.add(h.x, 0.065, h.z, h.r * 2, h.r * 2, 0, 1.4, 0.12, 0.25);
        L.disc.add(h.x, 0.06, h.z, h.r * 2 * q, h.r * 2 * q, 0, 0.7, 0.04, 0.12);
      }
    }
    // 共鳴柱與織音者之間的連線
    for (const e of this.enemies) {
      if (e.type !== 'pillar' || e.dead) continue;
      const owner = this.enemies.find((o) => o.id === e.owner);
      if (!owner || owner.dead) continue;
      const dx = owner.x - e.x; const dz = owner.z - e.z; const len = Math.hypot(dx, dz) || 1;
      L.beam.add(e.x + dx / 2, 0.5, e.z + dz / 2, len, 0.3, Math.atan2(-dz, dx), 0.12, 0.35, 0.4);
    }
    for (const e of this.enemies) {
      if (e.tele) L.dangerBeam.add(e.x + e.tele.dx * e.tele.len / 2, 0.07, e.z + e.tele.dz * e.tele.len / 2, e.tele.len, e.tele.w, Math.atan2(-e.tele.dz, e.tele.dx), 1.2, 0.1, 0.25);
      if (e.state === 2) {
        const len = e.chargeSpeed * 0.85;
        L.dangerBeam.add(e.x + e.cdx * len / 2, 0.07, e.z + e.cdz * len / 2, len, e.r * 2 + 0.76, Math.atan2(-e.cdz, e.cdx), 1.2, 0.1, 0.25);
      }
    }
    for (const f of this.trails) {
      const fade = Math.min(1, f.life);
      const tc = f.tide ? [.2, .75, .8] : [.5, .4, .18]; const pc = f.tide ? [.3, .9, .9] : [.8, .7, .3];
      L.sigil.add(f.x, 0.04, f.z, f.r * 2, f.r * 2, t * .1, tc[0] * fade, tc[1] * fade, tc[2] * fade);
      L.prism.add(f.x, .2 + Math.sin(t * 2 + f.x) * .1, f.z, .15, .5, 0, pc[0] * fade, pc[1] * fade, pc[2] * fade);
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
      } else if (f.kind === 'slash') {
        // 貼紙風彎月斬：彈出、掃過、縮回。赫卡忒的斬偏紫。
        const sz = f.r * 2 * 0.95 * stickerPop(q, 0.35);
        const c = f.hecate ? [0.72, 0.5, 1] : [1, 1, 1];
        const base = -f.ang + (f.flip ? -1 : 1) * (0.6 - q * 1.2);
        if (f.full) {
          for (let k = 0; k < 2; k++) L.pslash.add(f.x, 0.08, f.z, sz * 1.1, sz * 1.1, base + k * Math.PI + q * Math.PI, c[0], c[1], c[2]);
        } else L.pslash.add(f.x, 0.08, f.z, sz, sz, base, c[0], c[1], c[2]);
      } else if (f.kind === 'bloom') {
        // 彼岸花綻放：平貼地面的大花，加上幾朵站立的花依序長出來。
        if (f.t < 0) continue;
        const s = stickerPop(q, 0.25);
        L.pflat.add(f.x, 0.05, f.z, f.r * 2.1 * s, f.r * 2.1 * s, q * 0.8, 1, 1, 1);
        const fa = this.assets.aspect.fx_lily_stand;
        for (const fl of f.flowers) {
          const lq = clamp((q - fl.delay) / 0.35, 0, 1);
          if (lq <= 0) continue;
          const hs = (1.1 + fl.sz) * stickerPop(lq, 0.5) * (1 - Math.max(0, q - 0.8) / 0.2 * 0.5);
          L.pstand.add(f.x + Math.cos(fl.a) * fl.rr, 0.02, f.z + Math.sin(fl.a) * fl.rr, hs * fa, hs, Math.sin(fl.a * 3) * 0.1, 1, 1, 1);
        }
      } else if (f.kind === 'burst') {
        // 緋紅終章／樂章：漫畫爆炸貼紙，音符被往中心牽引。
        const s = stickerPop(q, 0.2);
        L.pburst.add(f.x, 0.06, f.z, f.r * 1.7 * s, f.r * 1.7 * s, q * 0.5, 1, 1, 1);
        for (let i = 0; i < 8; i++) {
          const a = i * TAU / 8 + q * 3.2; const rr = f.r * (1 - q * 0.85);
          const ns = 0.8 * stickerPop(q, 0.2);
          L.pnote.add(f.x + Math.cos(a) * rr, 0.9 + Math.sin(q * 10 + i) * 0.12, f.z + Math.sin(a) * rr, ns, ns, Math.sin(q * 12 + i) * 0.2, 1, 1, 1);
        }
      } else if (f.kind === 'note') {
        if (f.t < 0) continue;
        const ns = 0.75 * stickerPop(q, 0.25);
        L.pnote.add(f.x + f.dx * q + Math.sin(q * 9) * 0.15, 1.9 + q * 1.3, f.z, ns, ns, Math.sin(q * 9) * 0.2, 1, 1, 1);
      } else if (f.kind === 'flower') {
        const fa = this.assets.aspect.fx_lily_stand;
        const hs = 0.55 * (1 - q * 0.5);
        L.pstand.add(f.x + f.vx * f.t, 0.3 + Math.sin(q * Math.PI) * 1.0, f.z + f.vz * f.t, hs * fa, hs, f.spin * f.t, 1, 1, 1);
      } else if (f.kind === 'ring') {
        const r = f.r * (0.15 + 0.85 * (1 - (1 - q) ** 2));
        const a = (1 - q) * 1.2;
        L.ring.add(f.x, 0.05, f.z, r * 2, r * 2, 0, f.color[0] * a, f.color[1] * a, f.color[2] * a);
      } else if (f.kind === 'beam') {
        const a = (1 - q) ** 0.6;
        const ang = Math.atan2(-f.dz, f.dx);
        const w = f.w * (1.2 - q * 0.5);
        const bc = f.color || [.7, .58, .28];
        L.beam.add(f.x + f.dx * f.len * 0.5, 0.06, f.z + f.dz * f.len * 0.5, f.len, w, ang, bc[0] * a, bc[1] * a, bc[2] * a);
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
      charId: this.charId, notes: Math.floor(this.notes || 0), notesNeed: this.weapons.coda ? skillStats('coda', this.weapons.coda).notes : 6, hasCoda: !!this.weapons.coda,
      pet: { roar: Math.max(0, pt.roarCd), roarMax: petStats('roar', this.petSkills.roar || 1).cooldown * this.cdm, slide: this.petSkills.slide ? Math.max(0, pt.slideCd) : null, busy: pt.slide > 0 ? '環繞中' : pt.pose > 0 ? '大叫中' : null },
      bosses: this.enemies.filter((o) => o.boss && !o.dead).slice(0, 3).map((o) => ({ id: o.id, name: o.name, elite: o.elite, hp: o.hp, maxhp: o.maxhp, shield: o.shield > 0 ? o.shield / o.shieldMax : 0, vuln: o.vuln > 0, ward: o.ward < 1, rage: o.hp < o.maxhp * 0.4 })),
    });
  }
}
