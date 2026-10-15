// Procedural mountain: four biomes of stacked cliff tiers, each with ledges, holds, overhangs, ladders, vines, loot and hazards.
// The daily seed rotates variants like the original game. Pure data: the renderer builds meshes from the description.
import { World } from './solids.js';
import { mulberry32 } from './rng.js';
import { LOOT, RARE } from './items.js';

export const BIOMES = [
  { id: 'shore',   name: '海灘',   sub: '墜機的沙灘',  tiers: 5, h: [8, 11],  rock: 'sand',   tex: 'rock_beach',   ground: 'ground_sand',   sky: 'sky_beach',   fog: 0xbfe6ff, fogFar: 170, sun: 0xfff2d6, amb: 0xdff1ff },
  { id: 'jungle',  name: '熱帶叢林', sub: '濕滑的苔蘚岩壁', tiers: 5, h: [9, 13],  rock: 'moss',   tex: 'rock_jungle',  ground: 'ground_jungle', sky: 'sky_jungle',  fog: 0x9fd3b0, fogFar: 120, sun: 0xfff0c0, amb: 0xc8e8d0 },
  { id: 'alpine',  name: '高山雪原', sub: '寒風與冰壁',   tiers: 5, h: [10, 14], rock: 'snow',   tex: 'rock_alpine',  ground: 'ground_snow',   sky: 'sky_alpine',  fog: 0xcfe0f2, fogFar: 110, sun: 0xeaf2ff, amb: 0xdbe8ff },
  { id: 'volcano', name: '火山口',  sub: '熔岩與間歇泉', tiers: 5, h: [10, 14], rock: 'basalt', tex: 'rock_volcano', ground: 'ground_ash',    sky: 'sky_volcano', fog: 0x5a2f3a, fogFar: 100, sun: 0xffb27a, amb: 0xc88a8a },
];
const W = 36, D = 10;

export function generate(seed) {
  const rng = mulberry32(seed);
  const world = new World();
  const out = { seed, world, props: [], items: [], luggage: [], hazards: [], zones: [], shrines: [], pitons: [], biomes: [], tiers: [],
    start: { x: 0, y: 0, z: 14 }, summit: null, wallDecor: [] };

  // Beach floor + sea wall
  world.addBox({ x0: -60, x1: 60, y0: -6, y1: 0, z0: -D + 0.0, z1: 60, kind: 'sand', tex: 'ground_sand', ground: true, bio: 0 });
  let y = 0, z = 0, cx = 0, tierIndex = 0;

  const box = (o) => world.addBox(o);
  const prop = (model, x, yy, zz, o = {}) => { out.props.push({ model, x, y: yy, z: zz, ...o }); };
  const luggage = (x, yy, zz, bi, rich = 1) => {
    const table = LOOT[BIOMES[bi].id];
    const n = rng.int(1, 2 + (rich > 1 ? 1 : 0));
    const loot = [];
    for (let i = 0; i < n; i++) loot.push(rng.chance(0.08 * rich) ? rng.weighted(RARE) : rng.weighted(table));
    out.luggage.push({ x, y: yy, z: zz, loot, opened: false, bio: bi });
    return out.luggage[out.luggage.length - 1];
  };
  const looseItem = (id, x, yy, zz) => out.items.push({ id, x, y: yy, z: zz });

  // Crashed plane + tutorial luggage on the beach
  prop('crashed_plane', -9, 0, 16, { width: 11, rotY: 0.6 });
  luggage(-6, 0, 19, 0, 1.4); luggage(5, 0, 20, 0); luggage(1, 0, 11, 0);
  looseItem('snack_pack', 3, 0, 16); looseItem('apple', -3, 0, 13);
  prop('wooden_sign', 2.5, 0, 6, { height: 2.2, rotY: 0.2 });
  prop('campfire', -2, 0, 9, { width: 2.8 });
  out.zones.push({ type: 'warm', x0: -4, x1: 0, y0: 0, y1: 3, z0: 7, z1: 11 });
  for (let i = 0; i < 9; i++) prop('palm_tree', rng.range(-32, 32), 0, rng.range(24, 46), { height: rng.range(7, 10), rotY: rng.range(0, 6.28) });

  BIOMES.forEach((bio, bi) => {
    const biome = { ...bio, index: bi, y0: y, y1: y, tiers: [] };
    out.biomes.push(biome);
    for (let t = 0; t < bio.tiers; t++) {
      const last = t === bio.tiers - 1;
      const H = rng.range(bio.h[0], bio.h[1]);
      const top = y + H;
      const shift = rng.range(-7, 7);
      const ncx = Math.max(-10, Math.min(10, cx + shift));
      cx = ncx;
      const zFront = z, zBack = z - (last ? D + 6 : D);
      const tier = { bi, t, y0: y, y1: top, zFront, zBack, cx, kind: 'normal', index: tierIndex++ };
      out.tiers.push(tier); biome.tiers.push(tier);

      // --- wall sections (variety of surface per section, the route choice) ---
      const cuts = [-W / 2, -W / 2 + rng.range(10, 14), W / 2 - rng.range(10, 14), W / 2];
      const sections = [];
      for (let s = 0; s < 3; s++) {
        let kind = bio.rock;
        if (bio.id === 'jungle') kind = rng.chance(0.4) ? 'rock' : 'moss';
        if (bio.id === 'alpine') kind = s === 1 && t > 0 ? 'ice' : (rng.chance(0.5) ? 'snow' : 'rock');
        if (bio.id === 'volcano') kind = (s === 1 || rng.chance(0.2)) && t > 0 && t < 4 && rng.chance(0.7) ? 'lava' : 'basalt';
        if (bio.id === 'shore') kind = rng.chance(0.25) ? 'rock' : 'sand';
        const x0 = cx + cuts[s], x1 = cx + cuts[s + 1];
        const b = box({ x0, x1, y0: y - 2.5, y1: top, z0: zBack, z1: zFront, kind, tex: bio.tex, bio: bi, section: s });
        sections.push(b);
      }
      if (last) {
        // shrine plateau extends; the shrine sits in the middle
        const sx = cx + rng.range(-4, 4), sz = zBack + 6;
        prop('shrine_altar', sx, top, sz, { height: 3.4 });
        out.shrines.push({ x: sx, y: top, z: sz + 1.6, bi, name: bio.name, used: false, index: bi });
        prop('campfire', sx + 4, top, sz + 0.5, { width: 2.6 });
        out.zones.push({ type: 'shrine', x0: sx - 3.5, x1: sx + 3.5, y0: top - 0.5, y1: top + 3, z0: sz - 3, z1: sz + 4, bi });
        out.zones.push({ type: 'warm', x0: sx + 2.5, x1: sx + 5.5, y0: top - 0.2, y1: top + 3, z0: sz - 1.5, z1: sz + 2.5 });
        luggage(sx - 5, top, sz + 1, bi, 1.6); luggage(sx + 6, top, sz + 3, bi, 1.3);
        tier.kind = 'shrine';
      }

      // --- ledge staircase (guaranteed route) ---
      let lx = cx + rng.range(-8, 8), ly = y + rng.range(4.8, 6.2);
      const ledges = [];
      while (ly < top - 3.2) {
        const lw = rng.range(3.6, 5.6), depth = rng.range(2.2, 3.0);
        const lb = box({ x0: lx - lw / 2, x1: lx + lw / 2, y0: ly - 0.55, y1: ly, z0: zFront, z1: zFront + depth, kind: 'rock', tex: bio.tex, bio: bi, ledge: true });
        ledges.push(lb);
        if (rng.chance(0.55)) luggage(lx + rng.range(-1, 1), ly, zFront + depth * 0.55, bi);
        else if (rng.chance(0.5)) {
          const it = rng.weighted(LOOT[bio.id]); looseItem(it, lx + rng.range(-1, 1), ly, zFront + depth * 0.6);
        }
        lx = Math.max(cx - W / 2 + 3, Math.min(cx + W / 2 - 3, lx + rng.range(-9, 9)));
        ly += rng.range(5.2, 6.8);
      }
      tier.ledges = ledges;
      // grips on the face
      const nHold = rng.int(9, 16);
      for (let i = 0; i < nHold; i++) {
        const hx = cx + rng.range(-W / 2 + 2, W / 2 - 2), hy = y + rng.range(1.2, H - 1.2);
        const kind = bio.id === 'alpine' && rng.chance(0.4) ? 'crystal' : 'hold';
        world.addHold({ x: hx, y: hy, z: zFront + 0.17, kind, bi });
      }
      // overhang on part of the face
      if (t > 0 && rng.chance(0.55)) {
        const ox = cx + rng.range(-10, 10), oy = y + H * rng.range(0.4, 0.65), ow = rng.range(6, 9);
        box({ x0: ox - ow / 2, x1: ox + ow / 2, y0: oy, y1: oy + 0.9, z0: zFront, z1: zFront + 2.6, kind: 'rock', tex: bio.tex, bio: bi, overhang: true });
        tier.overhang = { x: ox, y: oy, w: ow };
      }
      // ladder on a random column (shore/jungle often)
      if ((bio.id === 'shore' && t < 4) || (bio.id === 'jungle' && rng.chance(0.4)) || (rng.chance(0.15))) {
        const lxp = cx + rng.range(-12, 12);
        box({ x0: lxp - 0.55, x1: lxp + 0.55, y0: y + 0.1, y1: top + 0.0, z0: zFront, z1: zFront + 0.28, kind: 'ladder', tex: 'wood_plank', bio: bi, model: 'wood_scaffold' });
        tier.ladder = lxp;
      }
      // fragile patch (the tempting shortcut)
      if (rng.chance(bio.id === 'shore' ? 0.3 : 0.6)) {
        const fx = cx + rng.range(-12, 12), fy = y + H * rng.range(0.25, 0.55);
        box({ x0: fx - 1.5, x1: fx + 1.5, y0: fy, y1: fy + 3.4, z0: zFront, z1: zFront + 0.5, kind: 'fragile', tex: 'rock_beach', bio: bi, fragile: true });
        prop('fragile_slab', fx, fy + 1.7, zFront + 0.55, { width: 3, rotX: Math.PI / 2, flat: true, deco: true });
      }

      // --- vines / palms / bamboo (pole climbs) ---
      if (bio.id === 'shore' || bio.id === 'jungle') {
        const px = cx + rng.range(-13, 13);
        if (bio.id === 'jungle' && rng.chance(0.8)) {
          out.world.addPole({ x: px, z: zFront + 0.5, y0: top - 8.5, y1: top - 0.2, kind: 'vine', r: 0.12 });
          prop('vine', px, top - 8.7, zFront + 0.5, { height: 8.6 });
        }
        if (rng.chance(0.7)) {
          const palmH = Math.min(H - 1.5, rng.range(5.5, 8.5)), qx = cx + rng.range(-14, 14), qz = zFront + rng.range(2.2, 3.6);
          out.world.addPole({ x: qx, z: qz, y0: y, y1: y + palmH, kind: 'palm', r: 0.28 });
          prop(bio.id === 'jungle' ? 'jungle_tree' : 'palm_tree', qx, y, qz, { height: palmH + 1.2, trunk: true });
          out.hazards.push({ type: 'coconut', x: qx, y: y + palmH, z: qz, timer: rng.range(2, 6), bi });
        }
        if (bio.id === 'jungle' && rng.chance(0.5)) {
          const bx = cx + rng.range(-14, 14);
          for (let k = 0; k < 3; k++) {
            const bxx = bx + k * 0.55, bzz = zFront + 1.6 + rng.range(0, 0.6), bh = Math.min(H, 9) + rng.range(-1, 1);
            out.world.addPole({ x: bxx, z: bzz, y0: y, y1: y + bh, kind: 'bamboo', r: 0.1 });
            prop('bamboo_cluster', bxx, y, bzz, { height: bh, single: true });
          }
        }
      }

      // --- plateau decor, luggage, hazards ---
      const mid = { x: cx + rng.range(-8, 8), z: zBack + D * 0.5 };
      if (!last) {
        luggage(mid.x, top, mid.z, bi);
        if (rng.chance(0.6)) luggage(mid.x + rng.range(-6, 6), top, zBack + rng.range(2, 8), bi);
        if (rng.chance(0.5)) { const it = rng.weighted(LOOT[bio.id]); looseItem(it, mid.x + rng.range(-3, 3), top, mid.z + rng.range(-2, 2)); }
        if (rng.chance(0.2)) looseItem('scout_badge', cx + rng.range(-14, 14), top, zBack + rng.range(2, 8));
        if (rng.chance(0.35)) { prop('campfire', mid.x - 3, top, mid.z + 1, { width: 2.4 }); out.zones.push({ type: 'warm', x0: mid.x - 5, x1: mid.x - 1, y0: top - 0.2, y1: top + 3, z0: mid.z - 1, z1: mid.z + 3 }); tier.camp = true; }
        if (rng.chance(0.3)) prop('wooden_sign', cx + rng.range(-10, 10), top, zFront - 1.2, { height: 2.1 });
      }
      // biome-specific features
      const edgeZ = zFront - 0.4;
      if (bio.id === 'shore') {
        if (t >= 2 && rng.chance(0.7)) out.hazards.push({ type: 'boulder', x: cx + rng.range(-10, 10), y: top - 0.2, z: zFront - 1.2, period: rng.range(7, 10), timer: rng.range(2, 6), bi });
        if (rng.chance(0.4)) { const sx = cx + rng.range(-12, 12); out.zones.push({ type: 'thorn', x0: sx - 1.2, x1: sx + 1.2, y0: top, y1: top + 1.2, z0: zBack + 3.8, z1: zBack + 6.2 }); prop('spike_trap', sx, top, zBack + 5, { width: 2.6 }); }
      }
      if (bio.id === 'jungle') {
        for (let k = 0; k < rng.int(1, 2); k++) {
          const fx = ledges.length ? ledges[Math.min(ledges.length - 1, k)].x0 + 1 : cx; const fb = ledges[Math.min(ledges.length - 1, k)];
          if (fb) out.hazards.push({ type: 'flytrap', x: fb.x0 + (fb.x1 - fb.x0) * rng.range(0.15, 0.85), y: fb.y1, z: fb.z1 - 0.8, asleep: 0, cd: 0, bi });
        }
        if (t >= 1 && rng.chance(0.65)) out.hazards.push({ type: 'bees', x: cx + rng.range(-12, 12), y: y + H * 0.55, z: zFront + 0.5, bi, home: null });
        if (rng.chance(0.55)) {
          const mx = cx + rng.range(-12, 12), mz = zBack + rng.range(2.5, 7.5);
          box({ x0: mx - 1.3, x1: mx + 1.3, y0: top, y1: top + 1.1, z0: mz - 1.3, z1: mz + 1.3, kind: 'bounce', tex: 'bounce', bio: bi, deco: true });
          prop('giant_mushroom', mx, top, mz, { width: 3 });
        }
        if (rng.chance(0.5)) { const bx = cx + rng.range(-12, 12), bz = zBack + rng.range(3, 8); out.zones.push({ type: 'thorn', x0: bx - 1.4, x1: bx + 1.4, y0: top, y1: top + 1.4, z0: bz - 1.4, z1: bz + 1.4 }); prop('thorn_bush', bx, top, bz, { width: 3 }); }
        if (rng.chance(0.4)) { prop('fern_patch', cx + rng.range(-14, 14), top, zBack + rng.range(2, 8), { width: 3 }); }
        if (t === 2) { // sheltered dark cave over the plateau
          const sx = cx + rng.range(-5, 5);
          box({ x0: sx - 8, x1: sx + 8, y0: top + 3.4, y1: top + 8, z0: zBack, z1: zFront - 0.5, kind: 'rock', tex: bio.tex, bio: bi, cave: true });
          out.zones.push({ type: 'dark', x0: sx - 8, x1: sx + 8, y0: top, y1: top + 3.4, z0: zBack, z1: zFront - 0.5 });
          out.zones.push({ type: 'shelter', x0: sx - 8, x1: sx + 8, y0: top, y1: top + 3.4, z0: zBack, z1: zFront - 0.5 });
          prop('cave_entrance', sx, top, zFront - 0.7, { width: 10, height: 4.2 });
          luggage(sx, top, zBack + 4, bi, 1.8); tier.cave = true;
        }
      }
      if (bio.id === 'alpine') {
        out.zones.push({ type: 'cold', x0: cx - W / 2, x1: cx + W / 2, y0: y, y1: top + 4, z0: zBack, z1: zFront + 4, strength: 1 });
        const ice = sections.find((s) => s.kind === 'ice');
        if (ice) for (let k = 0; k < 3; k++) {
          const ix = ice.x0 + (ice.x1 - ice.x0) * (0.2 + 0.3 * k + rng.range(-0.05, 0.05));
          out.hazards.push({ type: 'icicle', x: ix, y: top - 0.4, z: zFront + 0.5, state: 'hang', timer: 0, bi, floor: y });
          prop('icicle_cluster', ix, top - 2.2, zFront + 0.5, { height: 2.2, deco: true, icicle: out.hazards.length - 1 });
        }
        if (rng.chance(0.75)) { out.zones.push({ type: 'wind', x0: cx - W / 2, x1: cx + W / 2, y0: y, y1: top + 4, z0: zBack, z1: zFront + 6, dir: rng.chance(0.5) ? 1 : -1, period: rng.range(9, 14) }); prop('wind_totem', cx + rng.range(-14, 14), top, zBack + 3, { height: 3 }); }
        if (rng.chance(0.4)) { prop('tent_camp', mid.x + 5, top, mid.z, { width: 4 }); out.zones.push({ type: 'shelter', x0: mid.x + 3, x1: mid.x + 7, y0: top, y1: top + 2.5, z0: mid.z - 2, z1: mid.z + 2 }); }
        if (rng.chance(0.45)) prop('snow_pine', cx + rng.range(-14, 14), top, zBack + rng.range(2, 8), { height: rng.range(4, 6) });
        if (t >= 1 && rng.chance(0.6)) out.hazards.push({ type: 'boulder', x: cx + rng.range(-10, 10), y: top - 0.2, z: zFront - 1.2, period: rng.range(8, 11), timer: rng.range(3, 7), bi, snow: true });
      }
      if (bio.id === 'volcano') {
        out.zones.push({ type: 'heat', x0: cx - W / 2, x1: cx + W / 2, y0: y, y1: top + 4, z0: zBack, z1: zFront + 4 });
        for (let k = 0; k < rng.int(1, 2); k++) {
          const gx = cx + rng.range(-12, 12), gz = zBack + rng.range(3, 8);
          if (!last) { out.hazards.push({ type: 'geyser', x: gx, y: top, z: gz, period: rng.range(5.5, 8), timer: rng.range(0, 6), state: 'idle', bi }); prop('geyser', gx, top, gz, { width: 2.6 }); }
        }
        if (rng.chance(0.6)) { const vx = cx + rng.range(-12, 12), vz = zBack + rng.range(2, 8); out.hazards.push({ type: 'steam', x: vx, y: top, z: vz, period: rng.range(4, 7), timer: rng.range(0, 4), bi }); prop('steam_vent', vx, top, vz, { width: 2.2 }); }
        if (t >= 1 && rng.chance(0.75)) out.hazards.push({ type: 'boulder', x: cx + rng.range(-10, 10), y: top - 0.2, z: zFront - 1.2, period: rng.range(6, 9), timer: rng.range(2, 5), bi, lava: true });
        for (let k = 0; k < rng.int(1, 3); k++) prop('obsidian_spire', cx + rng.range(-15, 15), top, zBack + rng.range(1.2, 2.4), { height: rng.range(3, 6.5), rotY: rng.range(0, 6.28) });
        if (rng.chance(0.45)) { const lx2 = cx + rng.range(-12, 12), lz = zBack + rng.range(2.5, 7.5); box({ x0: lx2 - 1.2, x1: lx2 + 1.2, y0: top, y1: top + 0.7, z0: lz - 1.2, z1: lz + 1.2, kind: 'lava', tex: 'rock_volcano', bio: bi, deco: true }); prop('lava_rock', lx2, top, lz, { width: 2.6 }); }
        if (t === 2 || t === 3) { if (rng.chance(0.7)) { const rx = cx + rng.range(-12, 12); box({ x0: rx - 2, x1: rx + 2, y0: top - 1, y1: top + 3.4, z0: zBack + 1, z1: zBack + 2.6, kind: 'rubble', tex: 'rock_volcano', bio: bi, rubble: true }); for (const sd of [-1, 1]) { box({ x0: sd < 0 ? rx - 2.8 : rx + 2, x1: sd < 0 ? rx - 2 : rx + 2.8, y0: top - 1, y1: top + 3.4, z0: zBack, z1: zBack + 2.6, kind: 'rubble', tex: 'rock_volcano', bio: bi, rubble: true }); prop('boulder', rx + sd * 2.4, top, zBack + 1.3, { width: 2.4, rubble: true }); } prop('boulder', rx, top, zBack + 1.8, { width: 4.2, flat: false, rubble: true }); tier.rubble = rx; { const cache = luggage(rx, top, zBack + 0.6, bi, 3); cache.loot = [rng.weighted(RARE), rng.weighted(RARE), rng.weighted(LOOT[bio.id])]; } looseItem('scout_badge', rx + 1, top, zBack + 0.6); } }
      }
      // protective rock wall behind the shrine / summit ledge so the player cannot walk off backward
      if (last && bi === BIOMES.length - 1) {
        out.summit = { x: cx, y: top, z: zBack + 5 };
        prop('summit_beacon', cx, top, zBack + 5, { height: 9 });
        out.zones.push({ type: 'summit', x0: cx - 2.5, x1: cx + 2.5, y0: top - 1, y1: top + 6, z0: zBack + 2.5, z1: zBack + 7.5 });
      }

      y = top; z = zBack; biome.y1 = top;
    }
  });

  // Distant scenery: huge mountain silhouettes on each side (visual only)
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    out.wallDecor.push({ x: side * rng.range(60, 110), y: rng.range(-10, y * 0.6), z: rng.range(-z * 0.2 - 40, 40) + (-i * 12), w: rng.range(25, 50), h: rng.range(60, 120), d: rng.range(25, 50), bi: Math.min(3, Math.floor(i / 4.5)) });
  }
  out.top = y; out.depth = z;
  return out;
}

export function biomeAt(level, y) {
  for (let i = level.biomes.length - 1; i >= 0; i--) if (y >= level.biomes[i].y0 - 0.5) return level.biomes[i];
  return level.biomes[0];
}
