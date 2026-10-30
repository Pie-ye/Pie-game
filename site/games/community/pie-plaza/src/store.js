// 遊戲資料都在伺服器（server/games/plaza.py），瀏覽器不再保存進度。這裡只剩送給伺服器的格式轉換。
export const decorData = (d) => ({ v: 1, floor: d.floor, wall: d.wall, style: d.style, ext: d.ext, items: d.items.map(({ k, tx, ty }) => ({ k, tx, ty })) });
