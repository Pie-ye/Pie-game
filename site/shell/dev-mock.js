/** 本機 ?mock=1 用的假 API，覆蓋外框會打的每一個端點。 */

const COIN_FLIP_CHOICES = [
  { id: 'heads', label: '正面', rtp: 0.96 },
  { id: 'tails', label: '反面', rtp: 0.96 },
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

export async function mockRequest(path, { method = 'GET', body } = {}) {
  const url = new URL(path, 'http://mock.local');
  const p = url.pathname;
  const m = method.toUpperCase();

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
      games: [
        {
          id: 'coin-flip',
          name: '猜硬幣',
          author: 'Pie-ye',
          minBet: 5,
          maxBet: 100,
          choices: COIN_FLIP_CHOICES,
          sha256: 'mock-coin-flip-sha256',
        },
      ],
      rejected: [
        { id: 'bad-game', reason: '規格未通過' },
      ],
    });
  }

  const playMatch = p.match(/^\/api\/casino\/community\/([^/]+)\/play$/);
  if (m === 'POST' && playMatch) {
    if (!state.user) return json(401, { error: '未登入' });
    const gameId = decodeURIComponent(playMatch[1]);
    if (gameId !== 'coin-flip') return json(404, { error: '找不到遊戲' });
    const choice = String(body?.choice || '');
    const bet = Number(body?.bet);
    const outcomes = COIN_FLIP_OUTCOMES[choice];
    if (!outcomes) return json(400, { error: '無效的選項' });
    if (![5, 10, 20, 50, 100].includes(bet)) return json(400, { error: '無效的押注' });
    if (bet > state.balance) return json(400, { error: '金幣不足' });
    const outcome = pickWeighted(outcomes);
    const payout = Math.floor(bet * Number(outcome.return || 0));
    const net = payout - bet;
    state.balance += net;
    const roundId = String(body?.clientRoundId || `mock-${Date.now()}`);
    const item = {
      id: roundId,
      at: new Date().toISOString(),
      game: 'community',
      gameId,
      choice,
      outcome: { id: outcome.id, label: outcome.label },
      display: outcome.display,
      bet,
      payout,
      net,
    };
    state.history.unshift(item);
    return json(200, {
      roundId,
      gameId,
      choice,
      outcome: { id: outcome.id, label: outcome.label },
      display: outcome.display,
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
