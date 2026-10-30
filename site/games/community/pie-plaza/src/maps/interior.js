// 室內：商店與玩家小屋共用。上方 3 列是牆，下方是地板，最下面中間是門。
import { Grid, KIND } from '../engine/grid.js';
import { obj, finalizeMap } from '../engine/world.js';
import { SHOPS } from './npcs.js';

export const ROOM = { w: 20, h: 13, wallRows: 3, floor: { x0: 1, y0: 3, x1: 18, y1: 11 }, door: { tx: 9, ty: 12 } };

export function roomGrid() {
  const { w, h, wallRows, floor, door } = ROOM;
  const g = new Grid(w, h, KIND.VOID);
  g.rect(floor.x0, 0, floor.x1, wallRows - 1, KIND.WALL);
  g.rect(floor.x0, floor.y0, floor.x1, floor.y1, KIND.FLOOR);
  g.rect(door.tx, door.ty, door.tx + 1, door.ty, KIND.FLOOR);
  return g;
}
const doorWarp = (to, entry) => ({ x0: ROOM.door.tx * 16, y0: ROOM.door.ty * 16 + 4, x1: ROOM.door.tx * 16 + 32, y1: ROOM.door.ty * 16 + 20, to, entry, dir: 0, label: '出去' });
const ENTRY = { door: { x: ROOM.door.tx * 16 + 16, y: ROOM.door.ty * 16 - 2, dir: 1 } };

export function buildShop(id) {
  const s = SHOPS.find((x) => x.id === id);
  if (!s) return null;
  const cx = (ROOM.w * 16) / 2;
  const objects = [obj('counterLong', cx, 100, { foot: [48, 10] }), obj('counterLong', cx - 48, 100, { foot: [48, 10] }), obj('rugGL', cx, 182, { foot: null })];
  for (const [k, x, y] of s.props) objects.push(obj(k, x, y));
  const npc = { id: `shop-${id}`, kind: 'npc', ...s.npc, x: cx - 24, y: 84, dir: 0, wander: 0, reach: 30 };
  return finalizeMap({
    id: `shop:${id}`, title: s.title, grid: roomGrid(), base: 'void', floor: s.floor, wall: s.wall,
    objects, npcs: [npc], warps: [doorWarp('town', `shop:${id}`)], entries: ENTRY,
  });
}

/** 玩家小屋室內；decor 來自存檔（家具清單、地板、牆紙）。 */
export function buildHouse(owner, decor) {
  const objects = (decor.items || []).map((it) => obj(it.k, it.x, it.y, it.wall ? { foot: null, wall: true } : {}));
  return finalizeMap({
    id: `house:${owner}`, title: '我的小屋', grid: roomGrid(), base: 'void', floor: decor.floor, wall: decor.wall,
    objects, warps: [doorWarp(`farm:${owner}`, 'door')], entries: ENTRY, shared: false, owner,
  });
}
