/** 本機 ?mock=1 用的假 API，覆蓋外框會打的每一個端點。 */
import { USE_MOCK } from './config.js';

const COIN_FLIP_CHOICES = [
  { id: 'heads', label: '正面', rtp: 0.96 },
  { id: 'tails', label: '反面', rtp: 0.90 },
];

const COIN_FLIP_OUTCOMES = {
  heads: [
    { id: 'win', label: '正面', weight: 48, return: 2, display: '正面朝上' },
    { id: 'lose', label: '反面', weight: 52, return: 0, display: '反面朝上' },
  ],
  tails: [
    { id: 'win', label: '反面', weight: 48, return: 2, display: '反面朝上' },
    { id: 'lose', label: '正面', weight: 52, return: 0, display: '正面朝上' },
  ],
};

const state = {
  user: null,
  balance: 1000,
  csrfToken: 'mock-csrf-token',
  history: [],
};

function json(status, body) {
  return {
    response: { ok: status >= 200 && status < 300, status },
    payload: body,
  };
}

function pickWeighted(outcomes) {
  const total = outcomes.reduce((sum, o) => sum + Number(o.weight || 0), 0);
  let roll = Math.random() * (total || 1);
  for (const o of outcomes) {
    roll -= Number(o.weight || 0);
    if (roll <= 0) return o;
  }
  return outcomes[outcomes.length - 1];
}

function publicUser() {
  if (!state.user) return null;
  return {
    id: state.user.id,
    username: state.user.username,
    displayName: state.user.displayName,
  };
}

export function mockReset() {
  state.user = null;
  state.balance = 1000;
  state.history = [];
}

/** 模擬伺服器端 session 失效（之後的請求都回 401），外框的登入狀態不動。 */
export function mockExpireSession() {
  state.user = null;
}

// 只有 ?mock=1（localhost）時掛上，給本機 e2e 操作假伺服器狀態。
if (USE_MOCK && typeof window !== 'undefined') {
  window.__pgMock = { expireSession: mockExpireSession, reset: mockReset };
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    }
  });
}

const COMMUNITY_GAMES = [
  {
    id: 'coin-flip',
    name: '猜硬幣',
    author: 'Pie-ye',
    minBet: 5,
    maxBet: 100,
    choices: COIN_FLIP_CHOICES,
    sha256: 'mock-coin-flip-sha256',
  },
  {
    id: 'tight-spread',
    name: '窄押注',
    author: 'Pie-ye',
    minBet: 6,
    maxBet: 9,
    choices: [{ id: 'a', label: '甲', rtp: 0.9 }],
    sha256: 'mock-tight-sha256',
  },
];

export async function mockRequest(path, { method = 'GET', body, signal } = {}) {
  const url = new URL(path, 'http://mock.local');
  const p = url.pathname;
  const m = method.toUpperCase();
  if (signal && signal.aborted) {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  }

  if (m === 'POST' && p === '/api/auth/login') {
    const username = String(body?.username || '');
    const password = String(body?.password || '');
    if (username !== 'pgtest' || password !== 'previewpass123') {
      return json(401, { error: '使用者名稱或密碼錯誤' });
    }
    state.user = { id: 'u-pgtest', username: 'pgtest', displayName: 'pgtest' };
    return json(200, { user: publicUser(), csrfToken: state.csrfToken });
  }

  if (m === 'POST' && p === '/api/auth/logout') {
    // session 已失效時伺服器會回 401；外框仍要把本機狀態清掉。
    if (!state.user) return json(401, { error: '未登入' });
    state.user = null;
    return json(200, { ok: true });
  }

  if (m === 'GET' && p === '/api/casino/session') {
    if (!state.user) return json(401, { error: '未登入' });
    return json(200, {
      user: publicUser(),
      balance: state.balance,
      csrfToken: state.csrfToken,
    });
  }

  if (m === 'GET' && p === '/api/casino/history') {
    if (!state.user) return json(401, { error: '未登入' });
    const game = url.searchParams.get('game') || '';
    const gameId = url.searchParams.get('gameId') || '';
    const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const items = state.history
      .filter((it) => it.game === game && (!gameId || it.gameId === gameId))
      .slice(0, limit);
    const summary = items.reduce(
      (acc, it) => {
        acc.rounds += 1;
        acc.bet += it.bet;
        acc.payout += it.payout;
        acc.net += it.net;
        return acc;
      },
      { rounds: 0, bet: 0, payout: 0, net: 0 },
    );
    return json(200, { game, items, summary });
  }

  if (m === 'GET' && p === '/api/casino/community') {
    return json(200, {
      games: COMMUNITY_GAMES,
      rejected: [
        { id: 'bad-game', reason: '規格未通過' },
      ],
    });
  }

  const playMatch = p.match(/^\/api\/casino\/community\/([^/]+)\/play$/);
  if (m === 'POST' && playMatch) {
    if (!state.user) return json(401, { error: '未登入' });
    const gameId = decodeURIComponent(playMatch[1]);
    const spec = COMMUNITY_GAMES.find((g) => g.id === gameId);
    if (!spec) return json(404, { error: '找不到遊戲' });
    const choice = String(body?.choice || '');
    const bet = Number(body?.bet);
    if (!spec.choices.some((c) => c.id === choice)) return json(400, { error: '無效的選項' });
    const outcomes = COIN_FLIP_OUTCOMES[choice] || [
      { id: 'win', label: '中', weight: 45, return: 2, display: '中' },
      { id: 'lose', label: '沒中', weight: 55, return: 0, display: '沒中' },
    ];
    if (!Number.isFinite(bet) || bet < spec.minBet || bet > spec.maxBet) return json(400, { error: '無效的押注' });
    if (bet > state.balance) return json(400, { error: '金幣不足' });
    await wait(350, signal);
    const picked = pickWeighted(outcomes);
    const payout = Math.floor(bet * Number(picked.return || 0));
    const net = payout - bet;
    state.balance += net;
    const roundId = String(body?.clientRoundId || `mock-${Date.now()}`);
    const item = {
      id: roundId,
      at: new Date().toISOString(),
      game: 'community',
      gameId,
      choice,
      outcome: { id: picked.id, label: picked.label },
      outcomeLabel: picked.label,
      display: picked.display,
      bet,
      payout,
      net,
    };
    state.history.unshift(item);
    return json(200, {
      roundId,
      gameId,
      choice,
      outcome: { id: picked.id, label: picked.label },
      outcomeLabel: picked.label,
      display: picked.display,
      bet,
      payout,
      net,
      balance: state.balance,
    });
  }

  if (m === 'POST' && p === '/api/casino/play-ticket') {
    if (!state.user) return json(401, { error: '未登入' });
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const ticket = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return json(200, { ticket, expiresIn: 60 });
  }

  return json(404, { error: 'not found' });
}
