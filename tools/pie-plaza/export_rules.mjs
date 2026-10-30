// 把派派鎮的規則資料從前端模組匯出成 server/games/plaza_rules.json，伺服器與前端共用同一份數字。
// 用法：node tools/pie-plaza/export_rules.mjs
import { writeFileSync } from 'node:fs';
const SRC = new URL('../../site/games/community/pie-plaza/src/', import.meta.url);
const F = await import(new URL('farm/state.js', SRC));
const C = await import(new URL('house/catalog.js', SRC));
const X = await import(new URL('house/exterior.js', SRC));
const L = await import(new URL('avatar/look.js', SRC));
const FI = await import(new URL('fish/fishing.js', SRC));
const EV = await import(new URL('events/schedule.js', SRC));
const { ROOM } = await import(new URL('maps/interior.js', SRC));
const rules = {
  farm: { ...F.FARM, pathX: F.PATH_X, pathY: F.PATH_Y, pond: F.POND, growMs: F.GROW_MS, starterSeeds: F.STARTER_SEEDS, starterGold: F.newFarm('x').gold },
  debris: Object.fromEntries(Object.entries(F.DEBRIS).map(([k, d]) => [k, { tool: d.tool, hp: d.hp, drop: d.drop, looks: d.looks.length }])),
  crops: Object.fromEntries(Object.entries(F.CROPS).map(([k, c]) => [k, { name: c.name, seed: c.seed, sell: c.sell, grow: c.grow }])),
  itemNames: F.ITEM_NAMES,
  fish: FI.FISH,
  furniture: C.FURNITURE, floors: Object.keys(C.FLOORS), walls: Object.keys(C.WALLS), houseStyles: Object.keys(C.HOUSE_STYLES),
  room: ROOM,
  exterior: { roof: X.ROOF.length, wall: X.WALL.length, yard: X.YARD.length },
  look: L.FIELDS.map((f) => f.size()),
  events: EV.EVENTS.map((e) => ({ id: e.id, slots: e.slots, days: e.days || null })),
};
writeFileSync(new URL('../../server/games/plaza_rules.json', import.meta.url), JSON.stringify(rules, null, 1) + '\n');
console.log('匯出', Object.keys(rules).join(', '));
