// 捏臉資料：每個欄位都是「選項清單裡的索引」，存檔與網路傳輸都只傳整數陣列。
// 純資料模組，不碰 three.js，可在 node 測試。

export const SKIN = ['#ffe3cc', '#f8d0ae', '#ecb98f', '#cf9466', '#a26a43', '#6e472d', '#c9e7a0', '#bfe0ff'];
export const HAIR_COLORS = ['#3a2a20', '#6b4428', '#a8683a', '#e6bf6c', '#f4efe2', '#e46a6a', '#ff9ec4', '#8f7bf0', '#4fb2e6', '#5dc48b', '#24242c', '#a3a8b0'];
export const EYE_COLORS = ['#2a2018', '#583a22', '#2d61aa', '#2d8a5b', '#8a4ab8', '#c4485a'];
export const CLOTH_COLORS = ['#ffffff', '#f2e3c6', '#ff8e8e', '#ff6f91', '#ffb35c', '#ffe066', '#9fe07a', '#5cc49a', '#6fd3f0', '#5b8def', '#a98bf0', '#e8a0e0', '#8d6b4a', '#3d4a5c'];

// 每一項：key、中文名稱、選項（顏色欄位用色票）
export const FIELDS = [
  { key: 'skin', label: '膚色', group: 'face', colors: SKIN },
  { key: 'eyes', label: '眼睛', group: 'face', options: ['圓圓眼', '閃亮眼', '瞇瞇眼', '杏仁眼', '睫毛眼', '星星眼', '豆豆眼', '下垂眼'] },
  { key: 'eyeColor', label: '眼珠顏色', group: 'face', colors: EYE_COLORS },
  { key: 'brows', label: '眉毛', group: 'face', options: ['無', '細眉', '粗眉', '八字眉', '挑眉'] },
  { key: 'nose', label: '鼻子', group: 'face', options: ['無', '小點', '三角鼻', '圓鼻'] },
  { key: 'mouth', label: '嘴巴', group: 'face', options: ['微笑', '大笑', '貓嘴', '小圓嘴', '虎牙', '抿嘴', '吐舌'] },
  { key: 'blush', label: '腮紅', group: 'face', options: ['無', '粉紅', '橘紅', '雀斑'] },
  { key: 'hair', label: '髮型', group: 'hair', options: ['短髮', '鮑伯頭', '雙馬尾', '丸子頭', '刺刺頭', '長直髮', '馬尾', '爆炸頭', '光頭'] },
  { key: 'hairColor', label: '髮色', group: 'hair', colors: HAIR_COLORS },
  { key: 'ears', label: '耳朵', group: 'hair', options: ['人耳', '貓耳', '熊耳', '兔耳'] },
  { key: 'top', label: '上衣', group: 'outfit', options: ['T 恤', '連身裙', '帽 T', '背心'] },
  { key: 'topColor', label: '上衣顏色', group: 'outfit', colors: CLOTH_COLORS },
  { key: 'pattern', label: '花紋', group: 'outfit', options: ['素色', '條紋', '圓點', '星星', '花朵'] },
  { key: 'bottom', label: '下身', group: 'outfit', options: ['長褲', '短褲', '裙子'] },
  { key: 'bottomColor', label: '下身顏色', group: 'outfit', colors: CLOTH_COLORS },
  { key: 'shoes', label: '鞋子顏色', group: 'outfit', colors: CLOTH_COLORS },
  { key: 'hat', label: '帽子', group: 'extra', options: ['無', '草帽', '毛帽', '棒球帽', '花冠', '小葉子'] },
  { key: 'glasses', label: '眼鏡', group: 'extra', options: ['無', '圓眼鏡', '墨鏡'] },
];

export const GROUPS = [
  { id: 'face', label: '臉' },
  { id: 'hair', label: '髮型' },
  { id: 'outfit', label: '服裝' },
  { id: 'extra', label: '配件' },
];

export const KEYS = FIELDS.map((f) => f.key);
export const sizeOf = (f) => (f.colors || f.options).length;

export const DEFAULT_LOOK = Object.freeze({
  skin: 1, eyes: 0, eyeColor: 0, brows: 1, nose: 1, mouth: 0, blush: 1,
  hair: 0, hairColor: 1, ears: 0,
  top: 0, topColor: 8, pattern: 0, bottom: 1, bottomColor: 9, shoes: 2,
  hat: 0, glasses: 0,
});

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
export const decode = (arr) => sanitize(Array.isArray(arr) ? arr : null);
export const sameLook = (a, b) => KEYS.every((k) => a[k] === b[k]);

/** 隨機外觀；rand 可注入（測試用固定亂數） */
export function randomLook(rand = Math.random) {
  const pick = (n) => Math.floor(rand() * n) % n;
  const look = {};
  for (const f of FIELDS) look[f.key] = pick(sizeOf(f));
  // 讓隨機結果比較常見、好看：配件機率低一點，膚色偏前面幾種
  if (rand() < 0.55) look.hat = 0;
  if (rand() < 0.7) look.glasses = 0;
  if (rand() < 0.6) look.ears = 0;
  if (rand() < 0.75) look.skin = pick(6);
  return look;
}

const STORE_KEY = 'pie-island.look.v1';
export function loadLook(storage = globalThis.localStorage) {
  try {
    const raw = storage && storage.getItem(STORE_KEY);
    if (!raw) return null;
    return decode(JSON.parse(raw));
  } catch (_err) { return null; }
}
export function saveLook(look, storage = globalThis.localStorage) {
  try { storage && storage.setItem(STORE_KEY, JSON.stringify(encode(look))); } catch (_err) { /* 無痕模式 */ }
}
