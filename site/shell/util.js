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
