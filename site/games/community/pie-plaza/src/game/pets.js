// 寵物：跟在主人身後的小動物（Ninja Adventure 動物圖，兩格：坐著、走路側面）。
// 規則與擁有權在伺服器（server/games/pets.py），這份清單要和那邊一致（測試會比對）。
// unlock：[種類, 鍵, 門檻]，種類 stamp（有這枚章）、prog（累計數值）、stamps（章的總數）
export const PETS = [
  { id: 'cat', name: '小花貓', price: 0, unlock: null },
  { id: 'dog', name: '小黑狗', price: 200, unlock: null },
  { id: 'hamster', name: '倉鼠', price: 200, unlock: null },
  { id: 'pig', name: '粉紅小豬', price: 250, unlock: null },
  { id: 'cat_orange', name: '大橘貓', price: 300, unlock: null },
  { id: 'shiba', name: '柴犬', price: 300, unlock: null },
  { id: 'parrot', name: '藍鸚鵡', price: 400, unlock: null },
  { id: 'frog', name: '小蛙蛙', price: 0, unlock: ['stamp', 'boss_first', 1], how: '餵飽一次大胃王蛙' },
  { id: 'raccoon', name: '小浣熊', price: 0, unlock: ['prog', 'arena_win', 1], how: '在派派大作戰奪冠' },
  { id: 'cow', name: '小乳牛', price: 0, unlock: ['prog', 'town_build', 1], how: '出力蓋好一棟全鎮工程' },
  { id: 'monkey', name: '小猴子', price: 0, unlock: ['stamps', '', 15], how: '集到 15 枚章' },
  { id: 'lion', name: '小獅王', price: 0, unlock: ['prog', 'arena_win', 10], how: '在派派大作戰奪冠 10 次' },
];
export const PET_BY = Object.fromEntries(PETS.map((p) => [p.id, p]));
export const petSheet = (id) => `ninja/pets/${id}.png`;
export const PET_IMAGES = PETS.map((p) => petSheet(p.id));
export const cleanPet = (v) => (typeof v === 'string' && PET_BY[v] ? v : null);

/** 寵物跟著主人：目標在主人背後，距離遠了才走；回傳是否在走。純函式（給畫面用）。 */
export function followStep(pet, owner, dt) {
  const back = [[0, -10], [0, 10], [12, 2], [-12, 2]][owner.dir || 0];
  const gx = owner.x + back[0], gy = owner.y + back[1];
  const dx = gx - pet.x, dy = gy - pet.y, d = Math.hypot(dx, dy);
  if (d > 120) { pet.x = gx; pet.y = gy; return false; }      // 換區或傳送：直接跟上
  if (d < 6) return false;
  const v = Math.min(d, (d > 40 ? 110 : 62) * dt);
  pet.x += dx / d * v; pet.y += dy / d * v;
  if (Math.abs(dx) > 0.5) pet.flip = dx < 0;
  return true;
}
