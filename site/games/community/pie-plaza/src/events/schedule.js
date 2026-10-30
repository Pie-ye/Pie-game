// 定時活動與日夜（純函式）：一律用台北時間（UTC+8），所有玩家看到的活動時間一致，不需要伺服器。
export const TZ_OFFSET_H = 8;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 台北時間的年月日、星期、時分。 */
export function taipei(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_H * 3600_000);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}

// slots：[開始時, 結束時]（含頭不含尾）；days：星期幾（0=日），省略表示每天
export const EVENTS = [
  { id: 'market', name: '早市', area: 'town', slots: [[7, 10]], icon: '🧺',
    desc: '商店街市集的攤位全部開張，山姆在廣場特賣種子（八折）。' },
  { id: 'fishing', name: '釣魚大賽', area: 'plaza', slots: [[12, 13], [18, 19]], icon: '🎣',
    desc: '在廣場的海邊釣魚！金色鯉魚比較容易上鉤，每條魚都會公布在聊天室。' },
  { id: 'campfire', name: '營火晚會', area: 'plaza', slots: [[20, 23]], icon: '🔥',
    desc: '廣場中央點起營火、掛上燈籠，鎮長也會來跟大家聊天。' },
  { id: 'flower', name: '週末花祭', area: 'town', slots: [[9, 21]], days: [0, 6], icon: '🌸',
    desc: '週末的商店街掛滿彩旗和花，居民都換上節慶的台詞。' },
];
export const eventById = (id) => EVENTS.find((e) => e.id === id);

const onDay = (e, dow) => !e.days || e.days.includes(dow);
export function isActive(e, t) { return onDay(e, t.dow) && e.slots.some(([a, b]) => t.h >= a && t.h < b); }
export function activeEvents(ms = Date.now()) { const t = taipei(ms); return EVENTS.filter((e) => isActive(e, t)); }
export const activeIn = (area, ms) => activeEvents(ms).filter((e) => e.area === area);

/** 今天的活動表：[{ e, from, to, state: 'past'|'now'|'soon' }]，依開始時間排序。 */
export function todaySchedule(ms = Date.now()) {
  const t = taipei(ms), out = [];
  for (const e of EVENTS) {
    if (!onDay(e, t.dow)) continue;
    for (const [a, b] of e.slots) out.push({ e, from: a, to: b, state: t.h >= b ? 'past' : t.h >= a ? 'now' : 'soon' });
  }
  return out.sort((x, y) => x.from - y.from);
}
export const dayLabel = (ms = Date.now()) => { const t = taipei(ms); return `${t.mo} 月 ${t.d} 日（${WEEK[t.dow]}）`; };
export const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;

/**
 * 日夜：回傳 { dark: 0..1（夜晚深藍）、warm: 0..1（黃昏橘）}。
 * 06–17 白天、17–19 黃昏漸暗、19–05 夜晚、05–06 天亮。
 */
export function daylight(ms = Date.now()) {
  const t = taipei(ms), x = t.h + t.min / 60;
  if (x >= 6 && x < 17) return { dark: 0, warm: 0 };
  if (x >= 17 && x < 19) { const k = (x - 17) / 2; return { dark: k * 0.55, warm: Math.sin(k * Math.PI) * 0.6 + (1 - k) * 0.2 }; }
  if (x >= 5 && x < 6) { const k = 1 - (x - 5); return { dark: k * 0.55, warm: (1 - k) * 0.3 }; }
  return { dark: 0.55, warm: 0 };
}
