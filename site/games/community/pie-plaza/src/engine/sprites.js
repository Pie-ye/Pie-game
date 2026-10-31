// 圖片載入與角色換色。
import { SHEETS } from './atlas.js';
import { BODIES } from './bodies.js';
import { lookPalette, lookKey } from '../avatar/look.js';

const base = new URL('../../assets/', import.meta.url);
export const assetUrl = (name) => new URL(name, base).href;
const loadImg = (name) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`素材載入失敗：${name}`));
  img.src = assetUrl(name);
});

export const NPC_SPRITES = ['oldman2', 'hunter', 'woman', 'villager4', 'cavegirl2', 'oldman', 'noble', 'child', 'oldwoman', 'villager3', 'inspector'];
const NPC_DIR = { inspector: 'ninja/body' };
export const npcSheet = (n) => `${NPC_DIR[n] || 'ninja/npc'}/${n}.png`;
export const npcFace = (n) => `${NPC_DIR[n] || 'ninja/npc'}/${n}_face.png`;
const EXTRA = ['sprout/grass.png', 'sprout/water.png', 'sprout/dirt.png', 'sprout/tilled.png', 'ninja/dialog.png', 'ninja/interior_floor.png',
  'ninja/fx/coin.png', 'ninja/fx/goldcup.png', 'ninja/fx/smoke.png', 'ninja/fx/spark.png', 'ninja/fx/stamp.png',
  ...NPC_SPRITES.map(npcSheet)];

export async function loadImages() {
  const imgs = {};
  const names = [...new Set([...SHEETS, ...EXTRA])];
  await Promise.all([...names.map(async (n) => { imgs[n] = await loadImg(n); }), preloadBodies()]);
  if (document.fonts) await document.fonts.load('12px Zpix', '你好abc').catch(() => {});
  return { imgs, sheets: new Map(), grounds: new Map() };
}

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }

// ---------- 玩家角色（Ninja Adventure 角色：16x16，4 方向 × 7 列，前 4 列是走路） ----------
const bodyImgs = new Map();
function bodyImage(id) {
  if (!bodyImgs.has(id)) {
    const p = new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = assetUrl(`ninja/body/${id}.png`); });
    const entry = { img: null, p };
    p.then((im) => { entry.img = im; }).catch(() => {});
    bodyImgs.set(id, entry);
  }
  return bodyImgs.get(id);
}
export const preloadBodies = () => Promise.all(BODIES.map((b) => bodyImage(b.id).p));
/** 依外觀換色後的角色圖（快取）；底版圖還沒載入時回傳 null。 */
export function lookSheet(scene, look) {
  const key = lookKey(look);
  if (scene.sheets.has(key)) return scene.sheets.get(key);
  const { body, map } = lookPalette(look);
  const entry = bodyImage(body);
  if (!entry.img) return null;
  const img = entry.img, [c, x] = canvas(img.width, img.height);
  x.drawImage(img, 0, 0);
  if (map.size) {
    const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const to = map.get(`${p[i]},${p[i + 1]},${p[i + 2]}`);
      if (to) { p[i] = to[0]; p[i + 1] = to[1]; p[i + 2] = to[2]; }
    }
    x.putImageData(d, 0, 0);
  }
  scene.sheets.set(key, c);
  return c;
}
export const WALK_FPS = 8;
export function walkFrame(moving, now) { return moving ? Math.floor(now / (1000 / WALK_FPS)) % 4 : 0; }
