/** 倒數秒數文案（純函式，測得出）。phrase 接在「秒後」後面。 */
export function countdownText(p, phrase, now = Date.now()) {
  const n = (p.players || []).length;
  const left = Math.max(0, Math.ceil(((p.countdownMs || 9000) - (now - (p.startedAt || 0))) / 1000));
  return `倒數上車（${n}/${p.max}）。${left} 秒後${phrase}`;
}

/** 目前持有者這一棒已經拿了幾秒。countdown / 沒人拿都是 0。 */
export function holdSeconds(p, now = Date.now()) {
  if (!p || p.status !== 'live' || p.heldAt == null) return 0;
  return Math.max(0, Math.floor((now - p.heldAt) / 1000));
}

/** live 這一輪還剩幾秒。 */
export function liveLeftSeconds(p, now = Date.now()) {
  if (!p || p.status !== 'live') return 0;
  return Math.max(0, Math.ceil(((p.roundMs || 45000) - (now - (p.startedAt || 0))) / 1000));
}

/** 占席／搶瓶：已記入的毫秒 + 這一棒，換成秒。 */
export function liveScoreSeconds(p, uid, now = Date.now()) {
  const base = (p.scores && uid != null && p.scores[uid]) | 0;
  const extra = (p.status === 'live' && p.holder === uid && p.heldAt != null) ? Math.max(0, now - p.heldAt) : 0;
  return Math.floor((base + extra) / 1000);
}

/** 搶瓶紅藍隊目前秒數（含這一棒）。 */
export function liveTeamSeconds(p, now = Date.now()) {
  const extra = (p.status === 'live' && p.holder && p.heldAt != null) ? Math.max(0, now - p.heldAt) : 0;
  const holder = (p.players || []).find((x) => x.id === p.holder);
  const side = holder && holder.team;
  const ts = p.teamScore || { red: 0, blue: 0 };
  return {
    red: Math.floor(((ts.red | 0) + (side === 'red' ? extra : 0)) / 1000),
    blue: Math.floor(((ts.blue | 0) + (side === 'blue' ? extra : 0)) / 1000),
  };
}

/** 倒數期間刷新秒數；live 時若有 liveText 也刷新。paint 時 remember(round)；關面板時 stop。 */
export function attachCountdown(statusEl, phrase, liveText) {
  let last = null;
  const id = setInterval(() => {
    if (!last) return;
    if (last.status === 'countdown') statusEl.textContent = countdownText(last, phrase);
    else if (last.status === 'live' && typeof liveText === 'function') statusEl.textContent = liveText(last, Date.now());
  }, 200);
  return {
    remember(p) { last = p; },
    stop() { clearInterval(id); },
  };
}
