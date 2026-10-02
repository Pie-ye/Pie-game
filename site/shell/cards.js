import { escapeHtml } from './util.js';

const SUIT_SYMBOLS = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
};

export function renderPcard(card, opts) {
  const o = opts || {};
  const extraClass = o.extraClass || '';
  const extraAttrs = o.extraAttrs || '';
  if (card === '??') {
    return `<div class="pcard is-back${extraClass}"${extraAttrs} aria-label="暗牌"></div>`;
  }
  const raw = String(card || '');
  const rank = raw[0];
  const suitChar = raw[1] || '';
  const isRed = suitChar === 'h' || suitChar === 'd';
  const suitUnicode = SUIT_SYMBOLS[suitChar] || suitChar;
  const displayRank = rank === 'T' ? '10' : rank;
  const redClass = isRed ? ' is-red' : '';
  return `
    <div class="pcard${redClass}${extraClass}"${extraAttrs} aria-label="${escapeHtml(displayRank)} ${escapeHtml(suitUnicode)}">
      <div class="pcard-corner">
        <span class="pcard-rank">${escapeHtml(displayRank)}</span>
        <span class="pcard-suit">${escapeHtml(suitUnicode)}</span>
      </div>
      <div class="pcard-center" aria-hidden="true">${escapeHtml(suitUnicode)}</div>
    </div>
  `;
}
