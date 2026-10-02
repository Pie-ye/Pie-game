import { CONTENT_ORIGIN } from './config.js';
import { casinoRoundId, getUser, playCommunity, playTicket, setBalance } from './api.js';
import { escapeHtml, rtpPercent } from './util.js';

const BETS = [5, 10, 20, 50, 100];

let listener = null;
let iframe = null;
let current = null;

function defaultHeight() {
  return Math.min(window.innerHeight * 0.8, 720);
}

function clampHeight(px) {
  const n = Number(px);
  if (!Number.isFinite(n) || n <= 0) return defaultHeight();
  return Math.min(Math.max(n, 80), 1200);
}

function postToGame(payload) {
  if (!iframe || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(payload, CONTENT_ORIGIN);
}

function currentTheme() {
  return document.documentElement.dataset.theme || 'playful';
}

function userPayload() {
  const user = getUser();
  if (!user) return null;
  return { id: user.id, displayName: user.displayName || user.username };
}

async function sendInit() {
  if (!current || !current.ready) return;
  const { game } = current;
  const payload = {
    type: 'pg:init',
    gameId: game.id,
    user: userPayload(),
    theme: currentTheme(),
  };
  if (game.multiplayer && getUser()) {
    const { response, payload: ticketBody } = await playTicket(game.id);
    if (response.ok && ticketBody && ticketBody.ticket) {
      payload.ticket = ticketBody.ticket;
    }
  }
  postToGame(payload);
}

async function sendFreshTicket() {
  if (!current || !getUser()) return;
  const { response, payload } = await playTicket(current.game.id);
  if (response.ok && payload && payload.ticket) {
    postToGame({ type: 'pg:ticket', ticket: payload.ticket });
  }
}

function allowedBets(spec) {
  const min = Number(spec && spec.minBet != null ? spec.minBet : 5);
  const max = Number(spec && spec.maxBet != null ? spec.maxBet : 100);
  return BETS.filter((b) => b >= min && b <= max);
}

function renderBetBar(root, { game, spec, onPlay, toast }) {
  const bar = document.createElement('div');
  bar.className = 'casino-sticky-actions';
  bar.id = 'coinBetBar';

  if (!getUser()) {
    bar.innerHTML = `<a class="primary-button" href="#/login">登入後才能下注</a>
      <p class="rtp-note">金幣遊戲的下注由外框送出，長期玩一定虧。</p>`;
    root.appendChild(bar);
    return bar;
  }

  const choices = (spec && spec.choices) || [];
  current.choice = current.choice || (choices[0] && choices[0].id) || '';
  const bets = allowedBets(spec);
  current.bet = bets.includes(current.bet) ? current.bet : (bets[0] || 5);

  const choiceHtml = choices.map((c) => {
    const pct = rtpPercent(c.rtp);
    const rtp = pct != null ? `回饋率 ${pct}%` : '';
    return `<button type="button" class="choice-btn${c.id === current.choice ? ' is-active' : ''}" data-choice="${escapeHtml(c.id)}" aria-pressed="${c.id === current.choice ? 'true' : 'false'}">${escapeHtml(c.label || c.id)}${rtp ? `<small> ${escapeHtml(rtp)}</small>` : ''}</button>`;
  }).join('');

  const betHtml = bets.map((b) => (
    `<button type="button" class="bet-btn${b === current.bet ? ' is-active' : ''}" data-bet="${b}" aria-pressed="${b === current.bet ? 'true' : 'false'}">${b}</button>`
  )).join('');

  const selected = choices.find((c) => c.id === current.choice);
  const selectedPct = selected ? rtpPercent(selected.rtp) : null;
  const rtpLine = selectedPct != null
    ? `回饋率 ${selectedPct}%，長期玩一定虧`
    : '長期玩一定虧';

  bar.innerHTML = `
    <div class="choice-row" role="group" aria-label="選項">${choiceHtml}</div>
    <div class="bet-row" role="group" aria-label="押注">${betHtml}</div>
    <div class="play-row">
      <button type="button" class="primary-button" id="playBtn">下注</button>
      <p class="rtp-note">${escapeHtml(rtpLine)}</p>
    </div>
  `;
  root.appendChild(bar);

  bar.addEventListener('click', async (ev) => {
    const choiceBtn = ev.target.closest('[data-choice]');
    if (choiceBtn) {
      current.choice = choiceBtn.getAttribute('data-choice');
      bar.querySelectorAll('[data-choice]').forEach((el) => {
        const on = el.getAttribute('data-choice') === current.choice;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const next = choices.find((c) => c.id === current.choice);
      const pct = next ? rtpPercent(next.rtp) : null;
      const note = bar.querySelector('.rtp-note');
      if (note) note.textContent = pct != null ? `回饋率 ${pct}%，長期玩一定虧` : '長期玩一定虧';
      return;
    }
    const betBtn = ev.target.closest('[data-bet]');
    if (betBtn) {
      current.bet = Number(betBtn.getAttribute('data-bet'));
      bar.querySelectorAll('[data-bet]').forEach((el) => {
        const on = Number(el.getAttribute('data-bet')) === current.bet;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      return;
    }
    if (ev.target.closest('#playBtn')) {
      if (current.playing) return;
      current.playing = true;
      bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      try {
        await onPlay({ choice: current.choice, bet: current.bet });
      } finally {
        current.playing = false;
        bar.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      }
    }
  });

  return bar;
}

function onMessage(event) {
  if (!iframe || event.source !== iframe.contentWindow) return;
  if (event.origin !== CONTENT_ORIGIN) return;
  const data = event.data || {};
  const type = data.type;
  if (type === 'pg:ready') {
    current.ready = true;
    sendInit();
    return;
  }
  if (type === 'pg:height') {
    const px = data.px != null ? data.px : data.height;
    iframe.style.height = `${clampHeight(px)}px`;
    return;
  }
  if (type === 'pg:select') {
    const choice = data.choice;
    if (!choice || !current) return;
    current.choice = choice;
    const bar = document.getElementById('coinBetBar');
    if (bar) {
      bar.querySelectorAll('[data-choice]').forEach((el) => {
        const on = el.getAttribute('data-choice') === choice;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    return;
  }
  if (type === 'pg:ticket') {
    sendFreshTicket();
  }
}

export function unmountCommunity() {
  if (listener) {
    window.removeEventListener('message', listener);
    listener = null;
  }
  iframe = null;
  current = null;
}

export function mountCommunity(root, { game, spec, toast, refreshHistory, onBalance }) {
  unmountCommunity();
  current = { game, spec, ready: false, choice: '', bet: 5, playing: false };

  if (game.multiplayer && !getUser()) {
    const banner = document.createElement('p');
    banner.className = 'mp-banner';
    banner.textContent = '登入後才能加入多人房間';
    root.appendChild(banner);
  }

  const toolbar = document.createElement('div');
  toolbar.className = 'frame-toolbar';
  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'secondary-button';
  fsBtn.setAttribute('aria-label', '全螢幕');
  fsBtn.textContent = '全螢幕';
  fsBtn.addEventListener('click', () => {
    if (iframe && iframe.requestFullscreen) iframe.requestFullscreen();
  });
  toolbar.appendChild(fsBtn);
  root.appendChild(toolbar);

  const wrap = document.createElement('div');
  wrap.className = 'community-frame-wrap';
  iframe = document.createElement('iframe');
  iframe.className = 'community-frame';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
  iframe.setAttribute('allow', 'fullscreen; gamepad; autoplay');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.title = game.name || game.id;
  iframe.src = `${CONTENT_ORIGIN}/games/community/${encodeURIComponent(game.id)}/${game.entry || 'index.html'}`;
  wrap.appendChild(iframe);
  root.appendChild(wrap);

  listener = onMessage;
  window.addEventListener('message', listener);

  if (game.kind === 'coin') {
    renderBetBar(root, {
      game,
      spec,
      toast,
      onPlay: async ({ choice, bet }) => {
        const { response, payload } = await playCommunity(game.id, {
          choice,
          bet,
          clientRoundId: casinoRoundId(),
        });
        if (!response.ok) {
          toast((payload && payload.error) || '下注失敗');
          return;
        }
        if (payload.balance != null) {
          setBalance(payload.balance);
          if (onBalance) onBalance(payload.balance);
        }
        postToGame({
          type: 'pg:result',
          choice: payload.choice,
          outcome: payload.outcome,
          display: payload.display,
          bet: payload.bet,
          payout: payload.payout,
          net: payload.net,
        });
        const net = Number(payload.net || 0);
        const sign = net > 0 ? '+' : (net < 0 ? '−' : '');
        toast(`${payload.display || '開獎'} · 淨 ${sign}${Math.abs(net)}`);
        if (refreshHistory) await refreshHistory();
      },
    });
  }
}

export function notifyTheme(theme) {
  postToGame({ type: 'pg:theme', theme });
}
