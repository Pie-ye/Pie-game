// 活動在各地區的擺設（純資料）：回傳要加進地圖的物件（overhead 畫在角色上方）與夜間光源。
import { ATLAS } from '../engine/atlas.js';
import { obj } from '../engine/world.js';
import { mulberry } from '../logic.js';

const has = (k) => !!ATLAS[k];
const pick = (...ks) => ks.find(has);

/** area：地圖 id；active：進行中的活動 id 陣列。 */
export function eventObjects(area, active) {
  const out = [];
  const on = (id) => active.includes(id);
  if (area === 'plaza') {
    if (on('campfire')) {
      // 廣場中央是女神噴水池，營火晚會辦在西南邊的草地
      const fire = pick('campfire', 'stump');
      out.push(obj(fire, 140, 214, { foot: [14, 7], light: 70, flicker: true }));
      const lan = pick('lanternString');
      if (lan) for (const [x, y] of [[176, 118], [304, 118], [104, 176], [176, 176]]) out.push(obj(lan, x, y, { foot: null, overhead: true, light: 26 }));
      out.push(obj('log', 114, 226, { foot: [16, 5] }), obj('log', 166, 226, { foot: [16, 5] }));
    }
    if (on('fishing')) {
      for (const [x, y, k] of [[60, 102, 'banner2'], [420, 102, 'banner3'], [60, 236, 'banner5'], [420, 236, 'banner4']]) out.push(obj(k, x, y, { foot: [8, 4] }));
      out.push(obj('signSmall', 240, 268, { foot: [10, 5] }));
    }
  }
  if (area === 'town') {
    if (on('market')) {
      for (const [x, y, k] of [[396, 230, 'fruitCrates'], [500, 230, 'potsA'], [396, 300, 'barrels']]) out.push(obj(k, x, y, { foot: [44, 8] }));
      out.push(obj('awningA', 396, 216, { foot: null, overhead: true }), obj('awningB', 500, 216, { foot: null, overhead: true }));
    }
    if (on('flower')) {
      const rnd = mulberry(77);
      for (let x = 24; x < 880; x += 26) {
        if (x > 340 && x < 560) continue;
        out.push(obj(['flowerP2', 'flowerY2', 'flowerB', 'flowerP'][Math.floor(rnd() * 4)], x, 214 + Math.round(rnd() * 3), { foot: null }));
        out.push(obj(['flowerP2', 'flowerY2', 'flowerB', 'flowerP'][Math.floor(rnd() * 4)], x + 9, 270 + Math.round(rnd() * 3), { foot: null }));
      }
      const lan = pick('lanternString');
      if (lan) for (let x = 60; x < 880; x += 96) out.push(obj(lan, x, 222, { foot: null, overhead: true, light: 22 }));
      for (const [x, k] of [[350, 'banner1'], [550, 'banner6'], [120, 'banner5'], [780, 'banner2']]) out.push(obj(k, x, 270, { foot: [8, 4] }));
    }
  }
  return out;
}

/** 光源：物件 light 欄位，或固定會發光的物件（路燈、營火）。 */
export const LIGHT_KEYS = { lampPost: 48, campfire: 70 };
export function lightsOf(objects) {
  const out = [];
  for (const o of objects) {
    const r = o.light || LIGHT_KEYS[o.k];
    if (r) out.push({ x: o.x, y: o.y - Math.min(o.h, 26), r, flicker: o.flicker || o.k === 'campfire' });
  }
  return out;
}
