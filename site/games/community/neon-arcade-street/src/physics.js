// 第一人稱移動與碰撞：玩家是水平圓，場景是有向長方體（大樓、投幣機…）與圓柱（路燈、樹）。
// 純函式、不依賴 three.js，可在 node 直接測試（tests/neon-street-physics.test.mjs）。

export const WALK = 3.6, RUN = 6.6, RADIUS = 0.36, JUMP_V = 4.4, GRAVITY = 12;

export function pushOutObb(p, r, c) {
  const dx = p.x - c.cx, dz = p.z - c.cz;
  const a = dx * c.ax + dz * c.az, b = -dx * c.az + dz * c.ax;
  const qa = Math.max(-c.hw, Math.min(c.hw, a)), qb = Math.max(-c.hd, Math.min(c.hd, b));
  const da = a - qa, db = b - qb, d2 = da * da + db * db;
  let na, nb;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    if (d >= r) return false;
    const k = (r - d) / d;
    na = a + da * k; nb = b + db * k;
  } else { // 圓心在框內：往最近的面推出去
    const pa = c.hw - Math.abs(a), pb = c.hd - Math.abs(b);
    if (pa < pb) { na = (a < 0 ? -1 : 1) * (c.hw + r); nb = b; }
    else { na = a; nb = (b < 0 ? -1 : 1) * (c.hd + r); }
  }
  p.x = c.cx + na * c.ax - nb * c.az;
  p.z = c.cz + na * c.az + nb * c.ax;
  return true;
}

export function pushOutCircle(p, r, c) {
  const dx = p.x - c.cx, dz = p.z - c.cz, rr = r + c.r, d2 = dx * dx + dz * dz;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2) || 1e-6;
  const k = rr / d;
  p.x = c.cx + (d2 > 1e-12 ? dx * k : rr);
  p.z = c.cz + (d2 > 1e-12 ? dz * k : 0);
  return true;
}

// 粗篩：每個碰撞體預先算外接圓，離玩家太遠的直接略過。
export function prepare(colliders) {
  return colliders.map((c) => ({
    ...c,
    reach: c.t === 'obb' ? Math.hypot(c.hw, c.hd) : c.r,
  }));
}

export function resolve(p, r, colliders, bounds) {
  // Street bounds are symmetric; interiors may live away from the street origin.
  const b = typeof bounds === 'number'
    ? { minX: -bounds, maxX: bounds, minZ: -bounds, maxZ: bounds } : bounds;
  let hit = false;
  for (let it = 0; it < 3; it++) {
    let any = false;
    for (const c of colliders) {
      const dx = p.x - c.cx, dz = p.z - c.cz, reach = c.reach + r + 0.01;
      if (dx * dx + dz * dz > reach * reach) continue;
      if (c.t === 'obb' ? pushOutObb(p, r, c) : pushOutCircle(p, r, c)) any = true;
    }
    p.x = Math.max(b.minX, Math.min(b.maxX, p.x));
    p.z = Math.max(b.minZ, Math.min(b.maxZ, p.z));
    if (!any) break;
    hit = true;
  }
  return hit;
}

/**
 * 推進玩家一步。state: {x,z,y,vx,vz,vy,yaw,bob}，input: {fx,fz,run,jump}（fx 右、fz 前，皆 -1..1）。
 * 回傳 {moved, speed, landed}。
 */
export function step(state, input, dt, world) {
  dt = Math.min(dt, 0.05);
  let fx = input.fx, fz = input.fz;
  const len = Math.hypot(fx, fz);
  if (len > 1) { fx /= len; fz /= len; }
  const sy = Math.sin(state.yaw), cy = Math.cos(state.yaw);
  const speed = input.run ? RUN : WALK;
  // 前向 (-sin, -cos)，右向 (cos, -sin)
  const tx = (cy * fx - sy * fz) * speed, tz = (-sy * fx - cy * fz) * speed;
  const air = state.y > 0.001;
  const k = Math.min(1, dt * (air ? 2.5 : 11));
  state.vx += (tx - state.vx) * k;
  state.vz += (tz - state.vz) * k;
  const before = { x: state.x, z: state.z };
  state.x += state.vx * dt;
  state.z += state.vz * dt;
  resolve(state, RADIUS, world.colliders, world.bounds);
  // 被牆擋住時把速度換成實際位移，避免貼牆「空走」
  // 被牆擋住時，速度改成實際位移（沿牆滑）。上限是奔跑速度：被傳送到碰撞體內時，
  // 脫困的那一大步位移不能當成速度，否則人會被彈飛。
  let nvx = (state.x - before.x) / Math.max(dt, 1e-6), nvz = (state.z - before.z) / Math.max(dt, 1e-6);
  const nv = Math.hypot(nvx, nvz), cap = RUN * 1.05;
  if (nv > cap) { nvx *= cap / nv; nvz *= cap / nv; }
  state.vx = nvx; state.vz = nvz;
  let landed = false;
  if (input.jump && !air) state.vy = JUMP_V;
  if (state.vy !== 0 || air) {
    state.vy -= GRAVITY * dt;
    state.y += state.vy * dt;
    if (state.y <= 0) { state.y = 0; if (state.vy < -1) landed = true; state.vy = 0; }
  }
  const moved = Math.hypot(state.x - before.x, state.z - before.z);
  const v = moved / Math.max(dt, 1e-6);
  if (!air && v > 0.3) state.bob += moved * 2.1; // 每步約 0.6 m
  return { moved, speed: v, landed };
}

// 所在區域：P 廣場、N/E/S/W 四條大道
export function zoneAt(x, z, ring = 27) {
  if (Math.hypot(x, z) < ring + 1) return 'P';
  if (Math.abs(x) < Math.abs(z)) return z < 0 ? 'N' : 'S';
  return x > 0 ? 'E' : 'W';
}
