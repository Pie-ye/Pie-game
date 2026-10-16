/**
 * 城市貼圖載入。每張圖載完會自動裁掉四周透明邊（去背輸出會留白），算出真正的內容範圍，
 * 之後畫的時候用裁好的範圍，房子底邊才會貼在地面上。載入失敗就是 null，畫面改用程式畫的替代品。
 */
const BASE = new URL('./assets/', import.meta.url);
const cache = new Map();

function trimBounds(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) return { sx: 0, sy: 0, sw: w, sh: h };
    return { sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 };
  } catch (_) {
    return { sx: 0, sy: 0, sw: w, sh: h };
  }
}

/** 回傳 Promise<{img, sx, sy, sw, sh} | null>；同一張圖只載一次。 */
export function loadArt(name, { trim = false } = {}) {
  const key = `${name}|${trim}`;
  if (cache.has(key)) return cache.get(key);
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const box = trim ? trimBounds(img) : { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight };
      resolve({ img, ...box });
    };
    img.onerror = () => resolve(null);
    img.src = new URL(name, BASE).href;
  });
  cache.set(key, promise);
  return promise;
}

/** 圖片周圍的光暈：把輪廓染成指定顏色再模糊，畫的時候疊加（lighter）就像霓虹打在牆上。 */
export function makeGlow(art, color, blur = 26) {
  const pad = blur * 2;
  const c = document.createElement('canvas');
  c.width = art.sw + pad * 2;
  c.height = art.sh + pad * 2;
  const g = c.getContext('2d');
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.drawImage(art.img, art.sx, art.sy, art.sw, art.sh, pad, pad, art.sw, art.sh);
  g.shadowBlur = 0;
  // 挖掉本體，只留外圈的光。
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(art.img, art.sx, art.sy, art.sw, art.sh, pad, pad, art.sw, art.sh);
  return { canvas: c, pad };
}
