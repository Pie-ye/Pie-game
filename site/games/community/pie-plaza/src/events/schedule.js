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
    desc: '在廣場海邊釣魚，公分寫上南岸記分板。金色鯉魚比較容易上鉤而且分數加倍，時段結束依名次發 40／20／10 G。' },
  { id: 'campfire', name: '營火晚會', area: 'plaza', slots: [[20, 23]], icon: '🔥',
    desc: '廣場西南邊的草地點起營火、掛上燈籠。西南圓木隨時可以湊人捉迷藏。' },
  { id: 'reggie', name: '瑞吉海獅秀', area: 'plaza', slots: [[10, 11], [15, 16], [19, 20]], icon: '🦭',
    desc: '廣場東南角的海獅劇場開演！瑞吉會頂球、跳躍，帶條魚去餵牠會收到回禮。' },
  { id: 'partynight', name: '派對之夜', area: 'arena', slots: [[20, 21]], icon: '🎉',
    desc: '派派大作戰獎金加倍！晚上 8 點到 9 點，大家一起到廣場北橋的競技場。' },
  { id: 'flower', name: '週末花祭', area: 'town', slots: [[9, 21]], days: [0, 6], icon: '🌸',
    desc: '週末的商店街掛滿彩旗和花，居民都換上節慶的台詞。' },
];
export const eventById = (id) => EVENTS.find((e) => e.id === id);

/** 廣場上隨時能湊人的共現派對（不佔時段表）。 */
export const ALWAYS_ON = [
  { id: 'party', name: '廣場搶寶', where: '北邊寶箱', icon: '🎁' },
  { id: 'seek', name: '營火捉迷藏', where: '西南圓木', icon: '🔥' },
  { id: 'hot', name: '傳南瓜', where: '雞舍旁南瓜', icon: '🎃' },
  { id: 'tug', name: '廣場拔河', where: '東邊乾草', icon: '🪢' },
  { id: 'haul', name: '廣場搬寶', where: '西邊木桶送到東北大鍋', icon: '🪣' },
  { id: 'light', name: '廣場紅綠燈', where: '北邊欄杆', icon: '🚦' },
  { id: 'hill', name: '廣場占席', where: '東北草席', icon: '🧺' },
  { id: 'smash', name: '廣場砸罐', where: '南岸紅罐', icon: '🏺' },
  { id: 'vase', name: '廣場搶瓶', where: '東岸花瓶', icon: '💐' },
];
export const STANDING = ALWAYS_ON;

/** 公告欄標籤：這一輪幾個人、開沒開。沒快照就當空場。 */
export function occupancyLine(snap) {
  const n = (snap && snap.players && snap.players.length) || 0;
  const min = (snap && snap.min) || 3;
  const max = (snap && snap.max) || 8;
  const st = snap && snap.status;
  if (st === 'countdown') return `倒數上車 ${n}/${max}`;
  if (st === 'live') return `進行中 ${n}/${max}`;
  if (st === 'over') return '剛結束';
  if (n > 0) return `等人中 ${n}/${min}`;
  return '等人中';
}

/**
 * 走近 join 地標的提示。live 且你在局裡回 null，讓畫面用「E 搶／砸」那些動作句。
 */
export function joinHint(base, snap, you) {
  if (!snap) return base;
  const n = (snap.players || []).length;
  const min = snap.min || 3;
  const max = snap.max || 8;
  const inIt = you != null && (snap.players || []).some((p) => p.id === you);
  if (snap.status === 'live') return inIt ? null : `進行中（${n}/${max}）`;
  if (snap.status === 'countdown') return `${base}（${n}/${max}）倒數中`;
  if (snap.status === 'open' && n > 0) return `${base}（${n}/${min}）`;
  return base;
}

/** 倒數上車時 join 地標亮淡黃條，路人看得見這攤要開了。live／等人不畫，避免跟持有標記搶色。 */
export function countdownMark(snap, x, y) {
  if (snap && snap.status === 'countdown') return { x, y, color: 'rgba(255,240,120,.95)' };
  return null;
}

/** 捉迷藏開場後 join 圓木亮紫條，路人看得見這攤在抓人。不畫藏點，免得爆位置。 */
export function seekLiveMark(snap, x, y) {
  if (snap && snap.status === 'live') return { x, y, color: 'rgba(190,70,210,.95)' };
  return null;
}

/**
 * 藏點上的 E 提示。路人只看到「進行中」，不爆有沒有人。
 * 尋人一律「E 檢查」；還沒藏的人看到空位「E 藏」、有人「已經有人了」。
 */
export function seekSpotHint(snap, you, spotId) {
  if (!snap || snap.status !== 'live') return null;
  const me = (snap.players || []).find((p) => p.id === you);
  if (!me) return '進行中';
  if (me.seeker) return 'E 檢查';
  if (me.hidden) return '你已經藏好了';
  const taken = (snap.spots || []).some((s) => s.id === spotId && s.takenBy);
  return taken ? '已經有人了' : 'E 藏';
}

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
