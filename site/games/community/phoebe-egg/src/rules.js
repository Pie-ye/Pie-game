// Shared world description: collision, renderer, AI and minimap use these same surfaces.
export const CAMP = { x: 0, z: 23, y: 0 };
export const NEST = { x: 0, z: -23, y: 0 };
export const LIMIT = 29;
export const PLATFORM = { x1: -14, x2: -3, z1: -14, z2: 9, y: 3.2 };
export const RAMP = { x1: -12, x2: -5, z1: -23, z2: -14, y: 3.2 };
export const CLIMBS = [
  { x: -8.5, z: 10.1, topX: -8.5, topZ: 7.8, y: 3.2 },
  { x: -1.9, z: -1, topX: -4.3, topZ: -1, y: 3.2 },
];
export const ROCKS = [
  { x: 1, z: 7, r: 2.7, h: 3.8 }, { x: 5, z: -5, r: 2.6, h: 4.5 },
  { x: 7, z: -12, r: 2.1, h: 3.7 }, { x: 16, z: 4, r: 2.4, h: 3.4 },
  { x: 14, z: -17, r: 2.8, h: 5 }, { x: -23, z: 18, r: 2, h: 4 },
];
export const inside = (x, z, b) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
export function ground(x, z) {
  if (inside(x, z, PLATFORM)) return PLATFORM.y;
  if (inside(x, z, RAMP)) return (z - RAMP.z1) / (RAMP.z2 - RAMP.z1) * RAMP.y;
  return 0;
}
export function blocked(x, z, y, radius = .42) {
  if (Math.abs(x) > LIMIT - radius || Math.abs(z) > LIMIT - radius) return true;
  for (const rock of ROCKS) if (Math.hypot(x - rock.x, z - rock.z) < rock.r + radius && y < rock.h) return true;
  // Sample footprint so the capsule cannot clip an elevated ledge or ramp side.
  for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
    if (ground(x + dx, z + dz) > y + .38) return true;
  }
  return false;
}
export function move(entity, dx, dz, radius = .42) {
  const pieces = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .15));
  let collided = false;
  for (let i = 0; i < pieces; i++) {
    if (!blocked(entity.x + dx / pieces, entity.z, entity.y, radius)) entity.x += dx / pieces;
    else collided = true;
    if (!blocked(entity.x, entity.z + dz / pieces, entity.y, radius)) entity.z += dz / pieces;
    else collided = true;
    const h = ground(entity.x, entity.z);
    if (h > entity.y && h - entity.y < .4) entity.y = h;
  }
  return collided;
}
export function lineClear(a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / .35));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const y = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t + .6;
    if (ground(x, z) > y) return false;
    if (ROCKS.some(r => Math.hypot(x - r.x, z - r.z) < r.r && y < r.h)) return false;
  }
  return true;
}
// Grid A* routes Reggie around rocks and onto the ramp, rather than through cliffs.
// lowlandOnly: Reggie is a sea lion and cannot use the ramp, so the plateau is a safe route for Phoebe.
export function findPath(from, to, lowlandOnly = false) {
  const step = 2, key = (x, z) => `${x},${z}`;
  const sx = Math.round(from.x / step), sz = Math.round(from.z / step);
  const tx = Math.round(to.x / step), tz = Math.round(to.z / step);
  const open = [{ x: sx, z: sz, g: 0, f: 0, parent: null }], costs = new Map([[key(sx, sz), 0]]);
  let best = open[0], bestDistance = Infinity;
  for (let count = 0; open.length && count < 1300; count++) {
    open.sort((a, b) => a.f - b.f);
    const node = open.shift(), distance = Math.hypot(tx - node.x, tz - node.z);
    if (distance < bestDistance) { best = node; bestDistance = distance; }
    if (distance < 1) { best = node; break; }
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const x = node.x + dx, z = node.z + dz;
      const y = ground(node.x * step, node.z * step), nextY = ground(x * step, z * step);
      if ((lowlandOnly && nextY > .05) || Math.abs(nextY - y) > 1 || blocked(x * step, z * step, nextY, .9)) continue;
      if (!lineClear({ x:node.x*step,z:node.z*step,y:y+1 }, { x:x*step,z:z*step,y:nextY+1 })) continue;
      const g = node.g + 1;
      if ((costs.get(key(x,z)) ?? Infinity) <= g) continue;
      costs.set(key(x,z),g);
      open.push({ x,z,g,f:g+Math.hypot(tx-x,tz-z),parent:node });
    }
  }
  const result = [];
  while (best.parent) { result.unshift({x:best.x*step,z:best.z*step}); best = best.parent; }
  return result;
}
export function inAttack(type, enemy, player, direction) {
  if (Math.abs(enemy.y - player.y) > 1.6 || !lineClear(enemy, player)) return false;
  const dx = player.x - enemy.x, dz = player.z - enemy.z, d = Math.hypot(dx, dz);
  if (type === 'charge') return d < 2.25;
  if (type === 'roar') return d < 6;
  if (type === 'slam') return d < 4.8;
  return d < 3.8 && (dx * direction.x + dz * direction.z) > -d * .25;
}
