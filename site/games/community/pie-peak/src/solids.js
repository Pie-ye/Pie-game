// Axis-aligned collision world: boxes (cliffs, ledges, platforms) and poles (trees, vines, ropes, bamboo).
// Pure data + math, no rendering imports, so the simulation can be unit tested in node.
export const PLAYER = { radius: 0.3, height: 1.15, step: 0.38 };

const CELL = 8;
const key = (i, j, k) => `${i},${j},${k}`;

export class World {
  constructor() {
    this.boxes = [];
    this.poles = [];
    this.holds = [];      // small grips on a wall: not solid, they only make climbing cheaper
    this._grid = new Map();
    this._dirty = true;
  }
  addBox(box) {
    const b = { kind: 'rock', solid: true, id: this.boxes.length, ...box };
    this.boxes.push(b);
    this._dirty = true;
    return b;
  }
  addPole(pole) {
    const p = { kind: 'vine', id: this.poles.length, ...pole };
    this.poles.push(p);
    return p;
  }
  addHold(h) { const o = { kind: 'hold', ...h }; this.holds.push(o); return o; }
  holdNear(x, y, z, r = 0.75) {
    for (const h of this.holds) if (Math.abs(h.y - y) < r && Math.hypot(h.x - x, h.z - z) < r) return h;
    return null;
  }
  removeBox(box) { box.solid = false; this._dirty = true; }
  _build() {
    this._grid.clear();
    for (const b of this.boxes) {
      if (!b.solid) continue;
      for (let i = Math.floor(b.x0 / CELL); i <= Math.floor(b.x1 / CELL); i++)
        for (let j = Math.floor(b.y0 / CELL); j <= Math.floor(b.y1 / CELL); j++)
          for (let k = Math.floor(b.z0 / CELL); k <= Math.floor(b.z1 / CELL); k++) {
            const id = key(i, j, k);
            let list = this._grid.get(id);
            if (!list) this._grid.set(id, list = []);
            list.push(b);
          }
    }
    this._dirty = false;
  }
  // Solid boxes overlapping the AABB (deduplicated).
  query(x0, y0, z0, x1, y1, z1) {
    if (this._dirty) this._build();
    const out = [], seen = new Set();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++)
        for (let k = Math.floor(z0 / CELL); k <= Math.floor(z1 / CELL); k++) {
          const list = this._grid.get(key(i, j, k));
          if (!list) continue;
          for (const b of list) {
            if (seen.has(b.id) || !b.solid) continue;
            seen.add(b.id);
            if (b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1 && b.z1 > z0 && b.z0 < z1) out.push(b);
          }
        }
    return out;
  }
  pointInside(x, y, z, pad = 0) {
    for (const b of this.query(x - pad, y - pad, z - pad, x + pad, y + pad, z + pad)) {
      if (x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad && z > b.z0 - pad && z < b.z1 + pad) return b;
    }
    return null;
  }
  // Highest standable top below y (within footprint).
  groundBelow(x, y, z, r = PLAYER.radius, maxDrop = 200) {
    let best = null;
    for (const b of this.query(x - r, y - maxDrop, z - r, x + r, y + 0.01, z + r)) {
      if (b.y1 <= y + 0.01 && (!best || b.y1 > best.y1)) best = b;
    }
    return best;
  }
  // Ray vs boxes; returns {t, box, nx, ny, nz} for nearest hit within maxT.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT;
    let best = null;
    for (const b of this.query(Math.min(ox, ex) - 0.01, Math.min(oy, ey) - 0.01, Math.min(oz, ez) - 0.01,
                               Math.max(ox, ex) + 0.01, Math.max(oy, ey) + 0.01, Math.max(oz, ez) + 0.01)) {
      let tmin = 0, tmax = maxT, axis = -1, sign = 0;
      const o = [ox, oy, oz], d = [dx, dy, dz], lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
      let ok = true;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) { if (o[a] < lo[a] || o[a] > hi[a]) { ok = false; break; } continue; }
        let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a], s = -1;
        if (t1 > t2) { [t1, t2] = [t2, t1]; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
      if (!ok || axis < 0) continue;
      if (!best || tmin < best.t) {
        const n = [0, 0, 0]; n[axis] = sign;
        best = { t: tmin, box: b, nx: n[0], ny: n[1], nz: n[2] };
      }
    }
    return best;
  }
  nearestPole(x, y, z, reach = 0.75) {
    let best = null, bd = reach;
    for (const p of this.poles) {
      if (p.active === false || y + PLAYER.height < p.y0 || y > p.y1) continue;
      const d = Math.hypot(p.x - x, p.z - z) - (p.r || 0.15);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}

// Move an AABB body (feet-centred) with axis-separated collision. Returns contact flags.
// body: {x,y,z,vx,vy,vz}; modifies position and zeroes blocked velocity.
export function moveBody(world, body, dt, opts = {}) {
  const r = opts.radius ?? PLAYER.radius, h = opts.height ?? PLAYER.height, step = opts.step ?? PLAYER.step;
  const hit = { ground: null, ceiling: null, wallX: null, wallZ: null, stepped: false };
  const maxMove = 0.2;
  const total = Math.max(Math.abs(body.vx), Math.abs(body.vy), Math.abs(body.vz)) * dt;
  const n = Math.max(1, Math.ceil(total / maxMove));
  const sdt = dt / n;
  for (let s = 0; s < n; s++) {
    // X
    body.x += body.vx * sdt;
    for (const b of world.query(body.x - r, body.y, body.z - r, body.x + r, body.y + h, body.z + r)) {
      if (body.x + r > b.x0 && body.x - r < b.x1 && body.y + h > b.y0 && body.y < b.y1 && body.z + r > b.z0 && body.z - r < b.z1) {
        if (opts.step !== 0 && b.y1 - body.y <= step && b.y1 - body.y > 0.001 && !world.pointInside(body.x, b.y1 + h * 0.5, body.z, 0)) {
          body.y = b.y1; hit.stepped = true; continue;
        }
        if (body.vx > 0) body.x = b.x0 - r; else if (body.vx < 0) body.x = b.x1 + r; else body.x -= 0;
        hit.wallX = b; body.vx = 0;
      }
    }
    // Z
    body.z += body.vz * sdt;
    for (const b of world.query(body.x - r, body.y, body.z - r, body.x + r, body.y + h, body.z + r)) {
      if (body.x + r > b.x0 && body.x - r < b.x1 && body.y + h > b.y0 && body.y < b.y1 && body.z + r > b.z0 && body.z - r < b.z1) {
        if (opts.step !== 0 && b.y1 - body.y <= step && b.y1 - body.y > 0.001 && !world.pointInside(body.x, b.y1 + h * 0.5, body.z, 0)) {
          body.y = b.y1; hit.stepped = true; continue;
        }
        if (body.vz > 0) body.z = b.z0 - r; else if (body.vz < 0) body.z = b.z1 + r;
        hit.wallZ = b; body.vz = 0;
      }
    }
    // Y
    body.y += body.vy * sdt;
    for (const b of world.query(body.x - r, body.y, body.z - r, body.x + r, body.y + h, body.z + r)) {
      if (body.x + r > b.x0 && body.x - r < b.x1 && body.y + h > b.y0 && body.y < b.y1 && body.z + r > b.z0 && body.z - r < b.z1) {
        if (body.vy <= 0) { body.y = b.y1; hit.ground = b; } else { body.y = b.y0 - h; hit.ceiling = b; }
        body.vy = 0;
      }
    }
  }
  if (!hit.ground) {
    const g = world.groundBelow(body.x, body.y + 0.02, body.z, r * 0.8, 0.05);
    if (g && body.y - g.y1 < 0.03 && body.vy <= 0) { hit.ground = g; body.y = g.y1; body.vy = 0; }
  }
  return hit;
}
