// 圖片載入與角色換色。
import { SHEETS } from './atlas.js';
import { hueOf } from '../logic.js';

const base = new URL('../../assets/', import.meta.url);
export const assetUrl = (name) => new URL(name, base).href;
const loadImg = (name) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`素材載入失敗：${name}`));
  img.src = assetUrl(name);
});

export const NPC_SPRITES = ['oldman2', 'hunter', 'woman', 'villager4', 'cavegirl2', 'oldman', 'noble', 'child', 'oldwoman', 'villager3'];
const EXTRA = ['sprout/grass.png', 'sprout/water.png', 'sprout/dirt.png', 'sprout/tilled.png', 'ninja/boy.png', 'ninja/dialog.png', 'ninja/interior_floor.png',
  ...NPC_SPRITES.map((n) => `ninja/npc/${n}.png`)];

export async function loadImages() {
  const imgs = {};
  const names = [...new Set([...SHEETS, ...EXTRA])];
  await Promise.all(names.map(async (n) => { imgs[n] = await loadImg(n); }));
  if (document.fonts) await document.fonts.load('12px Zpix', '你好abc').catch(() => {});
  return { imgs, sheets: new Map(), grounds: new Map() };
}

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; }

// ---------- 玩家角色（Ninja Adventure Boy：16x16，4 方向 × 7 列，前 4 列是走路） ----------
const SHIRT = [227, 241, 245];
const PANTS = [84, 135, 137];
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
/** 角色圖：上衣依 id 換成穩定的隨機色相，褲子取鄰近色相的暗色。 */
export function farmerSheet(scene, id) {
  const key = String(id);
  if (scene.sheets.has(key)) return scene.sheets.get(key);
  const img = scene.imgs['ninja/boy.png'], [c, x] = canvas(img.width, img.height);
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data, h = hueOf(key);
  const shirt = hsl(h, 0.68, 0.6), pants = hsl((h + 35) % 360, 0.35, 0.34);
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    if (p[i] === SHIRT[0] && p[i + 1] === SHIRT[1] && p[i + 2] === SHIRT[2]) { p[i] = shirt[0]; p[i + 1] = shirt[1]; p[i + 2] = shirt[2]; }
    else if (p[i] === PANTS[0] && p[i + 1] === PANTS[1] && p[i + 2] === PANTS[2]) { p[i] = pants[0]; p[i + 1] = pants[1]; p[i + 2] = pants[2]; }
  }
  x.putImageData(d, 0, 0);
  scene.sheets.set(key, c);
  return c;
}
export const WALK_FPS = 8;
export function walkFrame(moving, now) { return moving ? Math.floor(now / (1000 / WALK_FPS)) % 4 : 0; }
