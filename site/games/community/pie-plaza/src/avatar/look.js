// 捏臉資料（純函式）：外觀是 5 個整數 [底版, 髮色, 膚色, 上衣, 褲子]，網路收到一律檢查範圍。
import { BODIES } from '../engine/bodies.js';
import { hueOf } from '../logic.js';

// 目標顏色 [色相, 飽和度, 亮度]（0–360, 0–1, 0–1）；null 表示維持原色
export const HAIR = [null, [25, 0.15, 0.18], [25, 0.45, 0.32], [15, 0.55, 0.42], [5, 0.7, 0.45], [30, 0.85, 0.55], [45, 0.75, 0.68], [210, 0.08, 0.75], [330, 0.6, 0.65], [210, 0.6, 0.5], [130, 0.45, 0.42], [275, 0.45, 0.5]];
export const HAIR_NAMES = ['原色', '黑', '深棕', '栗色', '紅', '橘', '金', '銀白', '粉紅', '藍', '綠', '紫'];
export const SKIN = [null, [28, 0.75, 0.82], [26, 0.7, 0.68], [24, 0.55, 0.52], [20, 0.45, 0.38]];
export const SKIN_NAMES = ['原色', '白皙', '自然', '小麥', '深色'];
export const TOP = [null, [0, 0.7, 0.55], [25, 0.8, 0.55], [48, 0.8, 0.58], [100, 0.5, 0.48], [150, 0.5, 0.42], [195, 0.6, 0.5], [220, 0.6, 0.5], [265, 0.45, 0.55], [320, 0.55, 0.62], [30, 0.25, 0.85], [220, 0.12, 0.3]];
export const TOP_NAMES = ['原色', '紅', '橘', '黃', '草綠', '森林綠', '天藍', '藍', '紫', '粉紅', '米白', '黑'];
export const BOTTOM = [null, [215, 0.4, 0.3], [25, 0.4, 0.3], [90, 0.25, 0.3], [0, 0.45, 0.32], [220, 0.1, 0.22], [35, 0.3, 0.55], [200, 0.35, 0.55]];
export const BOTTOM_NAMES = ['原色', '牛仔藍', '咖啡', '橄欖', '酒紅', '黑', '卡其', '淺藍'];
export const FIELDS = [
  { key: 'b', name: '臉型', size: () => BODIES.length },
  { key: 'h', name: '髮色', size: () => HAIR.length, names: HAIR_NAMES, colors: HAIR },
  { key: 's', name: '膚色', size: () => SKIN.length, names: SKIN_NAMES, colors: SKIN },
  { key: 't', name: '上衣', size: () => TOP.length, names: TOP_NAMES, colors: TOP },
  { key: 'p', name: '褲子', size: () => BOTTOM.length, names: BOTTOM_NAMES, colors: BOTTOM },
];

/** 沒捏過臉的人：依 id 給一個穩定的預設（上衣顏色隨機）。 */
export function defaultLook(id) {
  const h = hueOf(String(id));
  return [0, 0, 0, 1 + (h % (TOP.length - 1)), 0];
}
export function sanitizeLook(l) {
  if (!Array.isArray(l) || l.length !== FIELDS.length) return null;
  const out = [];
  for (let i = 0; i < FIELDS.length; i++) {
    const v = l[i];
    if (!Number.isInteger(v) || v < 0 || v >= FIELDS[i].size()) return null;
    out.push(v);
  }
  return out;
}
export function randomLook(rand = Math.random) { return FIELDS.map((f) => Math.floor(rand() * f.size())); }
export const lookKey = (l) => l.join('.');

// ---------- 換色 ----------
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
/**
 * 一組原始顏色換成目標色：保留組內的明暗差（以組內平均亮度為基準），
 * 色相與飽和度用目標值。回傳 Map("r,g,b" -> [r,g,b])。
 */
export function rolePalette(colors, target) {
  const m = new Map();
  if (!target || !colors.length) return m;
  const hsl = colors.map(rgbToHsl), mean = hsl.reduce((a, c) => a + c[2], 0) / hsl.length;
  colors.forEach((c, i) => {
    const l = Math.max(0.06, Math.min(0.95, target[2] + (hsl[i][2] - mean)));
    m.set(c.join(','), hslToRgb([target[0], target[1], l]));
  });
  return m;
}
/** 整個外觀的換色表。 */
export function lookPalette(look) {
  const body = BODIES[look[0]] || BODIES[0];
  const m = new Map();
  for (const [i, role] of [[1, 'hair'], [2, 'skin'], [3, 'top'], [4, 'bottom']]) {
    for (const [k, v] of rolePalette(body[role], FIELDS[i].colors[look[i]])) m.set(k, v);
  }
  return { body: body.id, map: m };
}
