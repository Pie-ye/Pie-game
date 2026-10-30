// 鎮民交易所的前端常數與訪客報價（登入後以伺服器為準）。
import { taipei } from '../events/schedule.js';

export const TICKERS = [
  { id: 'GROC', name: '雜貨', icon: 'sack', why: '鎮民買種子會推升' },
  { id: 'BAKE', name: '麵包', icon: 'bread', why: '出貨小麥會推升' },
  { id: 'SHOW', name: '劇場', icon: 'emote27', why: '餵瑞吉會推升' },
  { id: 'WISH', name: '許願', icon: 'emote29', why: '向噴水池許願會推升' },
  { id: 'FISH', name: '漁獲', icon: 'fishCarp', why: '釣魚或出貨魚會推升' },
];
export const X_HOURS = [9, 16];

export function marketOpen(ms = Date.now()) {
  const t = taipei(ms);
  return t.h >= X_HOURS[0] && t.h < X_HOURS[1];
}

/** 與伺服器 plaza_logic.spread 相同：買價、賣價。 */
export function spread(mid) {
  const m = mid | 0;
  const buy = Math.max(m + 1, Math.ceil(m * 1.01));
  const sell = Math.min(m - 1, Math.floor(m * 0.99));
  return { buy, sell };
}

/** 訪客沙盒用的假行情：依台北 5 分鐘時段輕輕擺動，不能交易。 */
export function guestQuotes(ms = Date.now(), shares = {}) {
  const t = taipei(ms);
  const slot = t.d * 288 + t.h * 12 + Math.floor(t.min / 5);
  const quotes = TICKERS.map((tk, i) => {
    const mid = 100 + Math.round(Math.sin(slot * 0.37 + i * 1.7) * 6);
    const { buy, sell } = spread(mid);
    const prev = 100 + Math.round(Math.sin((slot - 1) * 0.37 + i * 1.7) * 6);
    return { id: tk.id, name: tk.name, why: tk.why, mid, buy, sell, chg: mid - prev, day: mid - 100, hold: shares[tk.id] | 0 };
  });
  return { open: marketOpen(ms), hours: X_HOURS, quotes, shares: { ...shares }, gold: 0 };
}
