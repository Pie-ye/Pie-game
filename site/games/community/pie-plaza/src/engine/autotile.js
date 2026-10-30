// Sprout Lands 地形圖的共用排列（Grass、Tilled_Dirt、Tilled_Dirt_v2 都一樣）：
//   (0..2, 0..2) 3×3 方塊（圓角）、第 3 欄 0..2 列是直條、第 3 列 0..2 欄是橫條、(3,3) 單格。
// 只看上下左右四個鄰格，回傳 [欄, 列]（單位：格）。
export function blobTile(n, e, s, w) {
  const h = w || e, v = n || s;
  const col = w && e ? 1 : e ? 0 : 2;
  const row = n && s ? 1 : s ? 0 : 2;
  if (!h && !v) return [3, 3];
  if (h && !v) return [col, 3];
  if (v && !h) return [3, row];
  return [col, row];
}
