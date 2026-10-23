// 捏臉資料：每個欄位都是「選項清單裡的索引」，存檔與網路傳輸都只傳整數陣列。
// 選項、色票、預設角色全部照美術總監（grok）的「暖蘋果」規格：tools/pie-island/art/design/spec.json
// 純資料模組，不碰 three.js，可在 node 測試。

export const SKIN = ['#F8E0D0', '#F3C6A8', '#E8B08C', '#D09268', '#C47B4E', '#A5653E', '#8A4E32', '#6B3C2A'];
export const HAIR_COLORS = ['#2C2622', '#5A3A2A', '#8D5A34', '#C9843C', '#E8C56B', '#F4E6C4', '#E07A6A', '#F0A0B8', '#7B8FD4', '#6AA8C8', '#6E9A62', '#3E4654'];
export const EYE_COLORS = ['#3A2C24', '#6A4632', '#3E6A9A', '#3E7A52', '#7A5098', '#C45A68'];
export const CLOTH_COLORS = ['#FFF9F2', '#F4E2C4', '#F08A86', '#F07AA0', '#F0A45A', '#F2D56A', '#8FCB78', '#5BB89A', '#7EC8E0', '#6A94E0', '#A894E0', '#E0A8D4', '#8D6A48', '#4A5568'];

export const FIELDS = [
  { key: 'faceShape', label: '臉型', group: 'face', options: ['蘋果臉', '圓臉', '小瓜臉'] },
  { key: 'skin', label: '膚色', group: 'face', colors: SKIN },
  { key: 'eyes', label: '眼睛', group: 'face', options: ['圓圓眼', '閃亮眼', '瞇瞇眼', '杏仁眼', '睫毛眼', '星星眼', '豆豆眼', '下垂眼'] },
  { key: 'eyeColor', label: '眼珠顏色', group: 'face', colors: EYE_COLORS },
  { key: 'brows', label: '眉毛', group: 'face', options: ['無眉', '細弧眉', '粗平眉', '八字眉', '挑眉', '短點眉'] },
  { key: 'nose', label: '鼻子', group: 'face', options: ['無鼻', '小點', '小勾', '圓鼻', '橫線'] },
  { key: 'mouth', label: '嘴巴', group: 'face', options: ['微笑', '開笑', '貓嘴', '小圓嘴', '嘟嘴', '抿嘴', '齒笑', '吐舌'] },
  { key: 'blush', label: '腮紅', group: 'face', options: ['無腮紅', '圓暈', '短線', '雀斑'] },
  { key: 'hair', label: '髮型', group: 'hair', options: ['短圓蓋', '旁分', '鮑伯', '雙丸子', '高馬尾', '雙馬尾', '長髮', '刺刺頭', '側捲', '光頭'] },
  { key: 'hairColor', label: '髮色', group: 'hair', colors: HAIR_COLORS },
  { key: 'ears', label: '耳朵', group: 'hair', options: ['人耳', '貓耳', '熊耳', '兔耳'] },
  { key: 'top', label: '上衣', group: 'outfit', options: ['T 恤', '連身裙', '帽 T', '背心'] },
  { key: 'topColor', label: '上衣顏色', group: 'outfit', colors: CLOTH_COLORS },
  { key: 'pattern', label: '花紋', group: 'outfit', options: ['素色', '寬條紋', '大圓點', '大星星', '大花'] },
  { key: 'bottom', label: '下身', group: 'outfit', options: ['長褲', '短褲', '裙子'] },
  { key: 'bottomColor', label: '下身顏色', group: 'outfit', colors: CLOTH_COLORS },
  { key: 'shoes', label: '鞋子顏色', group: 'outfit', colors: CLOTH_COLORS },
  { key: 'hat', label: '帽子', group: 'extra', options: ['無', '草帽', '毛帽', '棒球帽', '花冠', '葉芽'] },
  { key: 'glasses', label: '眼鏡', group: 'extra', options: ['無', '圓框', '方框', '淺墨鏡'] },
];

export const GROUPS = [
  { id: 'face', label: '臉' },
  { id: 'hair', label: '髮型' },
  { id: 'outfit', label: '服裝' },
  { id: 'extra', label: '配件' },
];

export const KEYS = FIELDS.map((f) => f.key);
export const sizeOf = (f) => (f.colors || f.options).length;

// 規格裡的基準角色「小麥芽」
export const DEFAULT_LOOK = Object.freeze({
  faceShape: 0, skin: 1, eyes: 0, eyeColor: 0, brows: 1, nose: 1, mouth: 0, blush: 1,
  hair: 0, hairColor: 3, ears: 0,
  top: 0, topColor: 1, pattern: 0, bottom: 1, bottomColor: 6, shoes: 12,
  hat: 0, glasses: 0,
});

// 規格 showcase 的六個展示角色（隨機按鈕偶爾會給這些）
export const SHOWCASE = [
  { ...DEFAULT_LOOK },
  { ...DEFAULT_LOOK, skin: 7, hair: 3, hairColor: 0, eyes: 2, eyeColor: 1, top: 1, topColor: 5, bottom: 2, bottomColor: 5, shoes: 12, hat: 1 },
  { ...DEFAULT_LOOK, skin: 3, hair: 5, hairColor: 7, eyes: 4, eyeColor: 2, top: 0, topColor: 8, bottom: 1, bottomColor: 0, shoes: 0, glasses: 1 },
  { ...DEFAULT_LOOK, skin: 6, hair: 7, hairColor: 1, eyes: 6, eyeColor: 3, top: 3, topColor: 7, bottom: 1, bottomColor: 1, shoes: 13, hat: 2 },
  { ...DEFAULT_LOOK, skin: 0, hair: 1, hairColor: 4, eyes: 3, eyeColor: 1, top: 0, topColor: 9, pattern: 1, bottom: 0, bottomColor: 13, shoes: 0, hat: 3 },
  { ...DEFAULT_LOOK, skin: 4, hair: 2, hairColor: 6, eyes: 1, eyeColor: 5, top: 2, topColor: 2, bottom: 2, bottomColor: 1, shoes: 4, hat: 4 },
].map(Object.freeze);

/** 把任何輸入（存檔、網路訊息）變成合法外觀；不合法的欄位用預設值 */
export function sanitize(input) {
  const out = {};
  const src = Array.isArray(input) ? Object.fromEntries(KEYS.map((k, i) => [k, input[i]])) : (input && typeof input === 'object' ? input : {});
  for (const f of FIELDS) {
    const v = src[f.key];
    out[f.key] = Number.isInteger(v) && v >= 0 && v < sizeOf(f) ? v : DEFAULT_LOOK[f.key];
  }
  return out;
}

export const encode = (look) => KEYS.map((k) => look[k]);
/** 網路與存檔格式：長度不對（舊版 18 欄）一律當成預設，避免欄位錯位變成怪臉 */
export const decode = (arr) => sanitize(Array.isArray(arr) && arr.length === KEYS.length ? arr : null);
export const sameLook = (a, b) => KEYS.every((k) => a[k] === b[k]);

/** 隨機外觀；rand 可注入（測試用固定亂數） */
export function randomLook(rand = Math.random) {
  const pick = (n) => Math.floor(rand() * n) % n;
  if (rand() < 0.15) return { ...SHOWCASE[pick(SHOWCASE.length)] };
  const look = {};
  for (const f of FIELDS) look[f.key] = pick(sizeOf(f));
  // 讓隨機結果比較好看：配件與動物耳少一點、不搭的組合修掉
  if (rand() < 0.55) look.hat = 0;
  if (rand() < 0.7) look.glasses = 0;
  if (rand() < 0.65) look.ears = 0;
  if (rand() < 0.5) look.pattern = 0;
  if (look.top === 1) look.bottom = 2;
  return look;
}

const STORE_KEY = 'pie-island.look.v2';
export function loadLook(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length === KEYS.length ? decode(arr) : null;
  } catch (_err) { return null; }
}
export function saveLook(look, storage = globalThis.localStorage) {
  try { storage && storage.setItem(STORE_KEY, JSON.stringify(encode(look))); } catch (_err) { /* 無痕模式 */ }
}
