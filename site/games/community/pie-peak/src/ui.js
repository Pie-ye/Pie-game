// DOM HUD: stamina bar with affliction segments, bag, altimeter, toasts, banners and modals.
import { ITEMS } from './items.js';
import { AFFLICTIONS, ORDER } from './status.js';
import { BIOMES } from './worldgen.js';

const $ = (id) => document.getElementById(id);
const STATE_TEXT = { ground: '', air: '空中', climb: '攀爬', ceiling: '吊掛前進', pole: '攀繩／柱', mantle: '翻上平台', glide: '滑翔', pull: '鉤爪牽引', faint: '昏倒', sleep: '睡著了' };
const BUFF_TEXT = { boost: '爆發', infinite: '無限體力', fast: '加速', warmed: '保暖', cooled: '降溫' };

export class UI {
  constructor() {
    this.bagSig = ''; this.acc = 0; this.bannerTimer = 0; this.infoTimer = 0; this.afflSig = '';
    this.el = { stamina: $('stamina'), fill: document.querySelector('#stamina .fill'), segs: document.querySelector('#stamina .segs'), aff: $('afflictions'),
      alt: $('alt'), biome: $('biome-name'), timer: $('timer'), ladder: $('ladder-dot'), bag: $('bag'), info: $('item-info'), hint: $('hint'), open: $('open-bar'),
      toasts: $('toasts'), banner: $('banner'), hurt: $('hurt-flash'), dark: $('dark-veil'), cold: $('cold-veil'), heat: $('heat-veil'), status: $('status-line'), who: $('who-name'), reticle: $('reticle') };
  }
  toast(msg, tone = '') {
    const d = document.createElement('div'); d.textContent = msg; if (tone) d.className = tone;
    this.el.toasts.appendChild(d); setTimeout(() => d.remove(), 3700);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  }
  banner(title, sub = '') {
    this.el.banner.innerHTML = `${title}<small>${sub}</small>`; this.el.banner.classList.add('show'); this.bannerTimer = 3;
  }
  flashHurt() { this.el.hurt.style.opacity = 1; setTimeout(() => (this.el.hurt.style.opacity = 0), 160); }
  showInfo(text) { this.el.info.textContent = text; this.el.info.classList.add('show'); this.infoTimer = 3.2; }
  update(g, dt, handlers) {
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.el.banner.classList.remove('show');
    if (this.infoTimer > 0 && (this.infoTimer -= dt) <= 0) this.el.info.classList.remove('show');
    this.acc += dt; if (this.acc < 0.05) return; this.acc = 0;
    const v = g.v, p = g.player;
    this.el.who.textContent = g.character === 'fluorolo' ? '弗洛洛' : '菲比';
    this.el.fill.style.width = `${Math.max(0, v.stamina)}%`;
    this.el.stamina.classList.toggle('low', v.stamina < 22); this.el.stamina.classList.toggle('boost', v.has('boost') || v.has('infinite'));
    // affliction segments from the right edge
    const sig = ORDER.map((k) => Math.round(v.aff[k] * 2)).join(',');
    if (sig !== this.afflSig) {
      this.afflSig = sig;
      this.el.segs.innerHTML = ORDER.filter((k) => v.aff[k] > 0.3).map((k) => `<i style="width:${v.aff[k]}%;background:${AFFLICTIONS[k].color}" title="${AFFLICTIONS[k].label}"></i>`).join('');
    }
    const chips = ORDER.filter((k) => v.aff[k] >= 1).map((k) => `<span style="--c:${AFFLICTIONS[k].color}">${AFFLICTIONS[k].label} ${Math.round(v.aff[k])}</span>`);
    for (const [b, t] of Object.entries(v.buffs)) if (BUFF_TEXT[b]) chips.push(`<span class="buff">${BUFF_TEXT[b]} ${Math.ceil(t)}s</span>`);
    if (g.lantern) chips.push('<span class="buff">提燈</span>');
    const html = chips.join(''); if (html !== this._chips) { this._chips = html; this.el.aff.innerHTML = html; }
    this.el.status.textContent = `${STATE_TEXT[p.state] || ''}${p.pitonAnchored ? ' · 已固定' : ''}`;
    this.el.alt.textContent = `${Math.max(0, p.y).toFixed(0)} m`;
    this.el.biome.textContent = g.biome.name;
    const top = g.level.top; this.el.ladder.style.bottom = `${Math.min(100, Math.max(0, p.y / top * 100)) * 0.93}%`;
    const t = Math.floor(g.time); this.el.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    // veils
    this.el.dark.style.opacity = g.env.dark && !g.lantern && !g.flares.length ? 1 : 0;
    this.el.cold.style.opacity = Math.min(0.9, v.aff.cold / 60); this.el.heat.style.opacity = Math.min(0.9, v.aff.hot / 60);
    // interaction
    const tg = g.interactTarget();
    this.el.hint.textContent = tg ? `${handlers.touch ? '' : 'E '}${tg.label}` : g.nearWall ? (handlers.touch ? '點「抓牆」開始攀爬' : '按住 F／滑鼠左鍵 抓牆') : '';
    this.updateCompass(g, handlers);
    this.el.open.hidden = !(tg && tg.kind === 'luggage' && g.openProgress > 0); this.el.open.value = g.openProgress;
    const sel = g.slots[g.selected];
    this.el.reticle.hidden = !(sel && ['grapple_gun', 'blowdart'].includes(sel.id));
    this.renderBag(g, handlers);
  }
  updateCompass(g, handlers) {
    const el = $('compass'); if (!el) return;
    const has = g.has('compass') || g.time < g.revealUntil; el.hidden = !has; if (!has) return;
    const p = g.player; let t = g.shrines.find((s) => !s.used && s.y > p.y - 2) || g.level.summit;
    const dx = t.x - p.x, dz = t.z - p.z, ang = Math.atan2(dx, -dz) - (handlers.camYaw?.() || 0);
    el.firstElementChild.style.transform = `rotate(${(ang * 180 / Math.PI).toFixed(0)}deg)`;
    el.lastElementChild.textContent = `${Math.round(Math.hypot(dx, t.y - p.y, dz))} m ↑${Math.max(0, Math.round(t.y - p.y))}`;
  }
  renderBag(g, handlers) {
    const cap = g.capacity;
    const sig = `${g.selected}|${cap}|` + Array.from({ length: 7 }, (_, i) => (g.slots[i] ? `${g.slots[i].id}:${g.slots[i].charges}` : '-')).join(',');
    if (sig === this.bagSig) return; this.bagSig = sig;
    const bag = this.el.bag; bag.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const s = g.slots[i], b = document.createElement('button'); b.className = 'slot'; b.type = 'button';
      if (i >= cap) b.classList.add('locked'); else if (!s) b.classList.add('empty');
      if (i === g.selected) b.classList.add('sel');
      b.innerHTML = `<b>${i + 1}</b>` + (s ? `<img alt="${ITEMS[s.id].name}" src="./assets/ui/${ITEMS[s.id].model}.jpg">${s.charges ? `<em>${s.charges}</em>` : ''}` : '');
      b.onclick = () => { handlers.select(i); };
      b.ondblclick = () => handlers.use(i);
      bag.appendChild(b);
    }
    const sel = g.slots[g.selected];
    if (sel) this.showInfo(`${ITEMS[sel.id].name}：${ITEMS[sel.id].desc}`);
  }
}
