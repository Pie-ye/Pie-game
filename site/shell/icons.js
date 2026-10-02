const ICONS = {
  trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5 7.5 11 12 4l4.5 7L21 7.5 19.2 19H4.8L3 7.5Z"/><path d="M4.4 15.2h15.2"/></svg>',
  candles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="5" height="8" rx="1.2"/><path d="M6.5 4v4M6.5 16v4"/><rect x="15" y="6" width="5" height="6" rx="1.2"/><path d="M17.5 3v3M17.5 12v6"/></svg>',
  coins: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="9.5" r="6.5"/><path d="M9.5 6.2v6.6M7.6 8h3.2"/><path d="M14.2 5.6a6.5 6.5 0 1 1-4.6 12.2"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 9.5v8M9.8 9.5v8M14.2 9.5v8M18.5 9.5v8"/><path d="M3 20.5h18"/></svg>',
  gem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h11l3.5 6L12 20.5 1.5 9.5l3.5-6Z"/><path d="M1.5 9.5h21"/><path d="m9.5 3.5-2 6 4.5 11 4.5-11-2-6"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c3.4 3 5 6.6 5 10.2L14 17h-4l-3-4.3c0-3.6 1.6-7.2 5-10.2Z"/><circle cx="12" cy="9.5" r="2"/><path d="m9.2 17-2.7 4.5 3.7-1.4M14.8 17l2.7 4.5-3.7-1.4"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5a6.2 6.2 0 0 0 6.2-6.2c0-4.3-3.2-6.6-4.4-9.8-2 1.6-3.1 3.7-3.1 5.9-1.1-.7-1.7-1.9-1.7-3.2C7 10 5.8 12.4 5.8 15.3A6.2 6.2 0 0 0 12 21.5Z"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 8.5h.01M12 12h.01M15.5 15.5h.01"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5 11.8 8l5.5 1.8-5.5 1.8L10 17l-1.8-5.4-5.5-1.8L8.2 8 10 2.5Z"/><path d="M17.5 15.5 18.3 18l2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8.8-2.5Z"/></svg>',
  'x-close': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6 18 18M18 6 6 18"/></svg>',
};

ICONS.brand = ICONS.candles;
ICONS.sparkles = ICONS.sparkle;

export function mountIcons(root = document) {
  const nodes = [];
  if (root && root.matches && root.matches('[data-icon]')) nodes.push(root);
  if (root && root.querySelectorAll) nodes.push(...root.querySelectorAll('[data-icon]'));
  for (const element of nodes) {
    const name = element.dataset.icon;
    const svg = ICONS[name];
    if (!svg || element.dataset.iconMounted === name) continue;
    element.innerHTML = svg;
    element.dataset.iconMounted = name;
    const svgElement = element.firstElementChild;
    if (svgElement) {
      svgElement.setAttribute('aria-hidden', 'true');
      svgElement.setAttribute('focusable', 'false');
    }
  }
}

export { ICONS };
