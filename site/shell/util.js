export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatCoins(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('zh-TW');
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('zh-TW');
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function rtpPercent(rtp) {
  const n = Number(rtp);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

// 上一次寫進去的 HTML。用完整字串比較而不是雜湊：雜湊碰撞會讓畫面卡在舊內容，
// 而 WeakMap 不會把整份 HTML 塞進 DOM 的 dataset，元素被丟掉時也會自動回收。
const lastRenderedHtml = new WeakMap();

/** Replace HTML only when it changed, so controls keep focus during polling. */
export function renderIfChanged(element, html) {
  if (!element) return false;
  const next = String(html);
  if (lastRenderedHtml.get(element) === next) return false;
  element.innerHTML = next;
  lastRenderedHtml.set(element, next);
  return true;
}

export function motionEnabled() {
  return !window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Mount one module stylesheet and return a cleanup function. */
export function mountStylesheet(url) {
  const href = String(url);
  let link = Array.from(document.querySelectorAll('link[data-pg-official-style]'))
    .find((node) => node.href === href);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.pgOfficialStyle = href;
    link.dataset.refCount = '0';
    document.head.appendChild(link);
  }
  link.dataset.refCount = String((Number(link.dataset.refCount) || 0) + 1);
  return () => {
    const remaining = Math.max(0, (Number(link.dataset.refCount) || 1) - 1);
    link.dataset.refCount = String(remaining);
    if (remaining === 0) link.remove();
  };
}
