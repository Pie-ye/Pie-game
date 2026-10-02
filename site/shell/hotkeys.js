/**
 * 遊戲控制列（.pg-dock）的快捷鍵與按鍵提示。
 *
 * 每款遊戲的控制列都是同一個順序：選項（.pg-dock-pick）→ 押注（.pg-dock-bet）→ 動作（.pg-dock-act），
 * 主要按鈕永遠在最右邊。玩家不必移動滑鼠也能玩：
 *   空白鍵／Enter  主要按鈕（帶 data-key="Space"，或動作區唯一的 .primary-button）
 *   1–9            押注籌碼（.pg-dock-bet 裡帶 data-bet 的按鈕，依畫面順序）
 *   其他字母       帶 data-key="h" 之類的按鈕（可用空白分隔多個鍵，例如 data-key="a ArrowLeft"）
 * 按鍵提示用 data-kbd 畫在按鈕右上角（只在有實體鍵盤與滑鼠的裝置顯示）。
 */

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const KEY_LABELS = { Space: '␣', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

function usable(el) {
  return Boolean(el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.getClientRects().length);
}

function docks(scope) {
  if (!scope) return [];
  const list = scope.matches && scope.matches('.pg-dock') ? [scope] : [];
  return list.concat(Array.from(scope.querySelectorAll('.pg-dock')));
}

function primaryOf(dock) {
  const explicit = Array.from(dock.querySelectorAll('[data-key]'))
    .filter((el) => el.dataset.key.split(/\s+/).includes('Space'));
  if (explicit.length) return explicit;
  const primaries = Array.from(dock.querySelectorAll('.pg-dock-act .primary-button'));
  return primaries.length === 1 ? primaries : [];
}

function chipsOf(dock) {
  return Array.from(dock.querySelectorAll('.pg-dock-bet button[data-bet]'));
}

function normalizeKey(ev) {
  if (ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Enter') return 'Space';
  if (ev.key.length === 1) return ev.key.toLowerCase();
  return ev.key;
}

/** 在控制列按鈕上標出快捷鍵。重畫之後再呼叫一次即可（同一個值不會重寫屬性）。 */
export function annotateDock(scope) {
  for (const dock of docks(scope)) {
    const setKbd = (el, label) => {
      if (el.dataset.kbd !== label) el.dataset.kbd = label;
    };
    chipsOf(dock).slice(0, 9).forEach((el, i) => setKbd(el, String(i + 1)));
    for (const el of dock.querySelectorAll('[data-key]')) {
      const first = el.dataset.key.split(/\s+/)[0];
      setKbd(el, KEY_LABELS[first] || first.toUpperCase());
    }
    for (const el of primaryOf(dock)) setKbd(el, KEY_LABELS.Space);
  }
}

function findTarget(scope, key) {
  for (const dock of docks(scope)) {
    if (key === 'Space') {
      const hit = primaryOf(dock).find(usable);
      if (hit) return hit;
      continue;
    }
    if (/^[1-9]$/.test(key)) {
      const chip = chipsOf(dock).filter((el) => el.getClientRects().length)[Number(key) - 1];
      if (usable(chip)) return chip;
      continue;
    }
    const hit = Array.from(dock.querySelectorAll('[data-key]'))
      .find((el) => el.dataset.key.split(/\s+/).some((k) => (k.length === 1 ? k.toLowerCase() : k) === key) && usable(el));
    if (hit) return hit;
  }
  return null;
}

/**
 * 掛上快捷鍵：getScope() 回傳目前遊戲的根元素。回傳解除函式。
 * 正在打字、按著修飾鍵、或有對話框（aria-modal）開著時一律不攔。
 */
export function bindDockHotkeys(getScope) {
  let pending = false;
  const onKey = (ev) => {
    if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
    const scope = getScope();
    if (!scope || !scope.isConnected) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (target && target.closest(TYPING)) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    const key = normalizeKey(ev);
    // 用鍵盤 Tab 到某顆按鈕時，空白／Enter 照瀏覽器原本的意思按那一顆；用滑鼠點過留下的焦點才轉給主要按鈕。
    if (key === 'Space' && target && target.closest('button, a, summary') && target.matches(':focus-visible')) return;
    const hit = findTarget(scope, key);
    if (!hit) return;
    if (ev.repeat && key === 'Space') {
      ev.preventDefault();
      return;
    }
    ev.preventDefault();
    hit.click();
    pulse(hit);
  };
  document.addEventListener('keydown', onKey);

  const annotate = () => {
    pending = false;
    annotateDock(getScope());
  };
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    queueMicrotask(annotate);
  });
  const scope = getScope();
  if (scope) {
    observer.observe(scope, { childList: true, subtree: true });
    annotate();
  }
  return () => {
    document.removeEventListener('keydown', onKey);
    observer.disconnect();
  };
}

/** 用鍵盤觸發時讓按鈕也有按壓回饋（Arc Button 的 press scale）。 */
function pulse(el) {
  el.classList.remove('is-key-press');
  void el.offsetWidth;
  el.classList.add('is-key-press');
  setTimeout(() => el.classList.remove('is-key-press'), 180);
}
