import { escapeHtml, formatCoins, formatDateTime } from './util.js';

const TITLES = {
  slots: '拉霸機紀錄',
  blackjack: '21 點紀錄',
  poker: '德州撲克紀錄',
  dragon: '射龍門紀錄',
  dragon_gate: '射龍門紀錄',
  niuniu: '妞妞紀錄',
  niu_niu: '妞妞紀錄',
  baccarat: '百家樂紀錄',
  community: '金幣遊戲紀錄',
};

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const BJ_OUTCOME = { blackjack: '黑傑克', win: '贏', push: '平手', lose: '輸' };

function cardText(card) {
  const raw = String(card || '');
  if (raw.length < 2) return '';
  const rank = raw[0] === 'T' ? '10' : raw[0];
  const suit = raw[1];
  const red = suit === 'h' || suit === 'd';
  return `<span class="hist-card${red ? ' is-red' : ''}">${escapeHtml(rank)}${SUIT[suit] || ''}</span>`;
}

function cardsText(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return list.length ? list.map(cardText).join(' ') : '—';
}

function netHtml(net) {
  const n = Number(net || 0);
  const cls = n > 0 ? 'is-gain' : (n < 0 ? 'is-loss' : '');
  const sign = n > 0 ? '+' : (n < 0 ? '−' : '');
  return `<span class="hist-net ${cls}">${sign}${formatCoins(Math.abs(n))}</span>`;
}

function emptyText(game) {
  const map = {
    slots: '還沒轉過拉霸，轉一次就會出現在這裡。',
    blackjack: '還沒打過 21 點。',
    poker: '還沒打過德撲，坐下打完一手就會出現在這裡。',
    dragon: '還沒玩過射龍門。',
    dragon_gate: '還沒玩過射龍門。',
    niuniu: '還沒玩過妞妞。',
    niu_niu: '還沒玩過妞妞。',
    baccarat: '還沒玩過百家樂。',
    community: '還沒玩過這款金幣遊戲。',
  };
  return map[game] || '還沒有紀錄。';
}

function rowsFor(game, items) {
  if (game === 'slots') {
    const head = '<th>時間</th><th>中線</th><th class="num">押注</th><th class="num">派彩</th><th class="num">輸贏</th>';
    const rows = items.map((it) => `<tr>
      <td>${escapeHtml(formatDateTime(it.at))}</td>
      <td>${(it.line || []).map((sym) => escapeHtml(sym)).join(' ') || '—'}</td>
      <td class="num">${formatCoins(it.bet)}</td>
      <td class="num">${formatCoins(it.payout)}</td>
      <td class="num">${netHtml(it.net)}</td>
    </tr>`).join('');
    return { head, rows };
  }
  if (game === 'blackjack') {
    const head = '<th>時間</th><th>你的牌</th><th>莊家</th><th>結果</th><th class="num">押注</th><th class="num">輸贏</th>';
    const rows = items.map((it) => {
      const hands = it.hands || [];
      const handsHtml = hands.map((h) => `${cardsText(h.cards)} <small>(${escapeHtml(String(h.total ?? ''))})</small>`).join('<br>');
      const outcomes = hands.map((h) => escapeHtml(BJ_OUTCOME[h.outcome] || h.outcome || '')).join(' / ');
      return `<tr>
        <td>${escapeHtml(formatDateTime(it.at))}</td>
        <td>${handsHtml || '—'}</td>
        <td>${cardsText(it.dealer)} <small>(${escapeHtml(String(it.dealerTotal ?? ''))})</small></td>
        <td>${outcomes}</td>
        <td class="num">${formatCoins(it.bet)}</td>
        <td class="num">${netHtml(it.net)}</td>
      </tr>`;
    }).join('');
    return { head, rows };
  }
  if (game === 'poker') {
    const head = '<th>時間</th><th>牌桌</th><th>你的底牌</th><th>公共牌</th><th>結果</th><th class="num">輸贏</th>';
    const rows = items.map((it) => {
      const result = it.folded ? '棄牌' : (it.handName || (it.net > 0 ? '無人跟注勝出' : '—'));
      return `<tr>
        <td>${escapeHtml(formatDateTime(it.at))}</td>
        <td>${escapeHtml(it.table || '')} <small>第 ${escapeHtml(String(it.handNo ?? ''))} 手</small></td>
        <td>${cardsText(it.cards)}</td>
        <td>${cardsText(it.board)}</td>
        <td>${escapeHtml(result)}</td>
        <td class="num">${netHtml(it.net)}</td>
      </tr>`;
    }).join('');
    return { head, rows };
  }
  if (game === 'dragon' || game === 'dragon_gate') {
    const head = '<th>時間</th><th>門柱</th><th>第三張</th><th>結果</th><th class="num">押注</th><th class="num">輸贏</th>';
    const rows = items.map((it) => {
      const outcomeMap = { win: '進門', lose: '沒進', pillar: '撞柱' };
      const outcomeText = outcomeMap[it.outcome] || it.outcome || '—';
      const choicePrefix = it.pair ? (it.choice === 'high' ? '猜大 ' : (it.choice === 'low' ? '猜小 ' : '')) : '';
      return `<tr>
        <td>${escapeHtml(formatDateTime(it.at))}</td>
        <td>${cardsText(it.gates)}</td>
        <td>${cardsText(it.third ? [it.third] : [])}</td>
        <td>${escapeHtml(`${choicePrefix}${outcomeText}`)}</td>
        <td class="num">${formatCoins(it.bet)}</td>
        <td class="num">${netHtml(it.net)}</td>
      </tr>`;
    }).join('');
    return { head, rows };
  }
  if (game === 'niuniu' || game === 'niu_niu') {
    const head = '<th>時間</th><th>你的牌</th><th>莊家</th><th>結果</th><th class="num">押注</th><th class="num">輸贏</th>';
    const rows = items.map((it) => {
      const playerHand = it.playerHandName ? ` <small>(${escapeHtml(it.playerHandName)})</small>` : '';
      const bankerHand = it.bankerHandName ? ` <small>(${escapeHtml(it.bankerHandName)})</small>` : '';
      const multStr = it.mult != null ? ` ×${it.mult}` : '';
      let resultText = '—';
      if (it.winner === 'player' || it.net > 0) resultText = `贏${multStr}`;
      else if (it.winner === 'banker' || it.net < 0) resultText = `輸${multStr}`;
      else if (it.winner === 'push' || it.net === 0) resultText = '平手';
      return `<tr>
        <td>${escapeHtml(formatDateTime(it.at))}</td>
        <td>${cardsText(it.player)}${playerHand}</td>
        <td>${cardsText(it.banker)}${bankerHand}</td>
        <td>${escapeHtml(resultText)}</td>
        <td class="num">${formatCoins(it.bet)}</td>
        <td class="num">${netHtml(it.net)}</td>
      </tr>`;
    }).join('');
    return { head, rows };
  }
  if (game === 'baccarat') {
    const head = '<th>時間</th><th>閒</th><th>莊</th><th>開出</th><th>你押</th><th class="num">押注</th><th class="num">輸贏</th>';
    const rows = items.map((it) => {
      const sideNameMap = { player: '閒', banker: '莊', tie: '和' };
      return `<tr>
        <td>${escapeHtml(formatDateTime(it.at))}</td>
        <td>${cardsText(it.player)}${it.playerTotal != null ? ` <small>(${escapeHtml(String(it.playerTotal))} 點)</small>` : ''}</td>
        <td>${cardsText(it.banker)}${it.bankerTotal != null ? ` <small>(${escapeHtml(String(it.bankerTotal))} 點)</small>` : ''}</td>
        <td>${escapeHtml(sideNameMap[it.result] || it.result || '—')}</td>
        <td>${escapeHtml(sideNameMap[it.side] || it.side || '—')}</td>
        <td class="num">${formatCoins(it.bet)}</td>
        <td class="num">${netHtml(it.net)}</td>
      </tr>`;
    }).join('');
    return { head, rows };
  }
  const head = '<th>時間</th><th>選擇</th><th>結果</th><th class="num">押注</th><th class="num">派彩</th><th class="num">輸贏</th>';
  const rows = items.map((it) => {
    const choice = it.choice && it.choice.label ? it.choice.label : it.choice;
    const outcome = it.outcome && it.outcome.label ? it.outcome.label : (it.display || it.outcome);
    return `<tr>
      <td>${escapeHtml(formatDateTime(it.at))}</td>
      <td>${escapeHtml(choice || '—')}</td>
      <td>${escapeHtml(outcome || '—')}</td>
      <td class="num">${formatCoins(it.bet)}</td>
      <td class="num">${formatCoins(it.payout)}</td>
      <td class="num">${netHtml(it.net)}</td>
    </tr>`;
  }).join('');
  return { head, rows };
}

export function renderHistory(container, data, fallbackGame) {
  if (!container) return;
  const game = (data && data.game) || fallbackGame || '';
  const title = TITLES[game] || '我的紀錄';
  if (!data) {
    container.innerHTML = `<section class="history-block" id="historyBlock">
      <h2 id="historyTitle">${escapeHtml(title)}</h2>
      <p class="empty-hint">載入紀錄中…</p>
    </section>`;
    return;
  }
  const sum = data.summary || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const summary = game === 'poker'
    ? `累計淨 ${netHtml(sum.net)}`
    : `共 ${formatCoins(sum.rounds)} 局 · 押注 ${formatCoins(sum.bet)} · 派彩 ${formatCoins(sum.payout)} · 淨 ${netHtml(sum.net)}`;
  if (!items.length) {
    container.innerHTML = `<section class="history-block" id="historyBlock">
      <h2 id="historyTitle">${escapeHtml(title)}</h2>
      <p class="history-summary">${summary}</p>
      <p class="empty-hint">${escapeHtml(emptyText(game))}</p>
    </section>`;
    return;
  }
  const { head, rows } = rowsFor(game, items);
  container.innerHTML = `<section class="history-block" id="historyBlock">
    <h2 id="historyTitle">${escapeHtml(title)}</h2>
    <p class="history-summary">${summary}</p>
    <table class="casino-history-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

export function historyTitle(game) {
  return TITLES[game] || '我的紀錄';
}
