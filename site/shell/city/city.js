/**
 * 賽博城市首頁：橫向卷軸，人物左右走動，走到房子門前按 ↑ 進入遊戲。
 * 畫面全部畫在一張 canvas 上（CSP 不允許 blob: 圖片，canvas 也比較省 DOM）；
 * 地圖、提示牌、觸控按鈕是 DOM，鍵盤與讀屏使用者另外有一份隱藏的遊戲連結清單。
 */
import { escapeHtml, motionEnabled } from '../util.js';
import { loadArt } from './assets.js';
import {
  BPM, sfx, setCityActive, unlockAudio,
} from './audio.js';
import { bootArcade, preloadArcade } from './arcade-boot.js';
import {
  DISTRICTS, GROUND_Y, WALK_SPEED, WALK_Y, WORLD_H,
  cameraFor, doorAt, layoutCity, stepPlayer, themeAt,
} from './layout.js';
import {
  FACADE_W, THEMES, drawBackdrop, drawFacade, drawFacadeReflection, drawGate, drawGround, drawLamps, drawWeather,
  facadeHeight,
} from './scene.js';

const STATE_KEY = 'pg_city_state';
const INTRO_KEY = 'pg_city_intro';
const HERO_H = 190;
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

function readState() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    if (raw && Number.isFinite(raw.x)) return raw;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function writeState(state) {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (_) {
    /* ignore */
  }
}

/**
 * 掛上城市。games: [{id,name,description,tags,official,kind,multiplayer}]
 * open(game): 開機動畫演到「換畫面」那一刻呼叫，由外框導向遊戲頁。
 * 回傳 { unmount }。
 */
export function mountCity(view, { games, open, onNear }) {
  const reduce = !motionEnabled();
  const world = layoutCity(games);
  const { buildings, gates } = world;

  view.classList.add('is-city');
  view.innerHTML = `
    <section class="city" aria-label="賽博城市：按住左右鍵走路，走到房子門前按上鍵進入遊戲">
      <canvas class="city-canvas" tabindex="0"></canvas>
      <div class="city-scan" aria-hidden="true"></div>
      <div class="city-hud">
        <div class="city-top">
          <a class="city-btn city-list-link" href="#/list">清單</a>
          <nav class="city-map" aria-label="城市地圖"><div class="city-map-track"></div></nav>
        </div>
        <div class="city-plaque" id="cityPlaque" role="status" aria-live="polite" hidden></div>
        <p class="city-help" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> 按住走路　<kbd>↑</kbd> 進入</p>
        <div class="city-touch" aria-hidden="true">
          <button type="button" data-hold="left" tabindex="-1">◀</button>
          <button type="button" data-hold="right" tabindex="-1">▶</button>
          <button type="button" class="city-up" data-hold="up" tabindex="-1">▲ 進入</button>
        </div>
        <div class="city-banner" id="cityBanner" aria-hidden="true"></div>
      </div>
      <ul class="visually-hidden" aria-label="遊戲清單">
        ${buildings.map((b) => `<li><a href="#/game/${encodeURIComponent(b.id)}">${escapeHtml(b.game.name || b.id)}</a></li>`).join('')}
      </ul>
    </section>`;

  const root = view.querySelector('.city');
  const canvas = root.querySelector('.city-canvas');
  const g = canvas.getContext('2d');
  const plaque = root.querySelector('#cityPlaque');
  const track = root.querySelector('.city-map-track');
  const banner = root.querySelector('#cityBanner');

  // ---------- 狀態 ----------
  const saved = readState();
  const startX = saved && saved.x > 0 && saved.x < world.width ? saved.x : 420;
  const player = { x: startX, vx: 0, facing: saved && saved.facing === -1 ? -1 : 1, target: null, autoRun: false, moving: false };
  const input = { left: false, right: false, up: false };
  const touchHeld = { left: false, right: false };
  let cam = 0;
  let k = 1; // 一個邏輯像素 = k 個裝置像素
  let viewW = 1280;
  let topPad = 0;
  let raf = 0;
  let last = 0;
  let near = null;
  let entering = false;
  let disposed = false;
  let walkPhase = 0;
  let stepClock = 0;
  let dominant = null;
  let bannerTimer = 0;
  const born = performance.now();
  const art = { hero: null, robot: null };
  const faded = { hero: 0 };
  const dust = [];
  const S = {
    g,
    art,
    cam: 0,
    topPad: 0,
    viewW: 1280,
    t: 0,
    pulse: 0,
    parts: Array.from({ length: reduce ? 0 : 110 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 })),
    stars: Array.from({ length: 90 }, () => ({ x: Math.random() * 3000, y: Math.random() * 330, r: 0.6 + Math.random() * 1.6, p: Math.random() * 6.28 })),
    cars: Array.from({ length: 4 }, (_, i) => ({ y: 90 + i * 55, speed: (i % 2 ? -1 : 1) * (50 + i * 22), x: Math.random() * 2400, hue: ['#35f0ff', '#ff4fd8', '#ffd23a', '#9dff3a'][i] })),
  };
  const robot = { x: startX - 90 };

  // ---------- 地圖 ----------
  const markers = [];
  for (const gate of gates) {
    const label = document.createElement('span');
    label.className = 'city-map-district';
    label.style.left = `${(gate.x / world.width) * 100}%`;
    label.style.setProperty('--c', gate.district.color);
    label.textContent = gate.district.name;
    track.appendChild(label);
  }
  for (const b of buildings) {
    // 地圖只是位置指示，不能點：要自己走到門口。
    const dot = document.createElement('i');
    dot.className = 'city-map-dot';
    dot.style.left = `${(b.doorX / world.width) * 100}%`;
    dot.style.setProperty('--c', b.look.accent);
    dot.title = b.game.name || b.id;
    track.appendChild(dot);
    markers.push(dot);
  }
  const me = document.createElement('i');
  me.className = 'city-map-me';
  track.appendChild(me);

  // ---------- 貼圖 ----------
  loadArt('hero.webp', { trim: true }).then((a) => { art.hero = a; });
  loadArt('robot.webp', { trim: true }).then((a) => { art.robot = a; });
  for (const id of Object.keys(THEMES)) {
    loadArt(THEMES[id].bg).then((a) => { art[`bg-${id}`] = a; });
  }
  preloadArcade();
  for (const b of buildings) {
    b.art = null;
    b.h = facadeHeight(b);
    b.w = FACADE_W;
    if (!b.look.art) continue;
    loadArt(`fac-${b.look.art}.webp`).then((a) => {
      if (!disposed && a) b.art = a;
    });
  }

  // ---------- 尺寸 ----------
  function resize() {
    const rect = root.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // 直式螢幕：至少要看得到約 560 邏輯寬，場景貼齊畫面底部，上方多出來的是天空。
    k = Math.min(canvas.height / WORLD_H, Math.max(canvas.width / 560, 0.0001));
    if (canvas.width / canvas.height >= 0.78) k = canvas.height / WORLD_H;
    viewW = canvas.width / k;
    topPad = Math.max(0, canvas.height / k - WORLD_H);
  }
  resize();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(root);
  else window.addEventListener('resize', resize);

  // ---------- 主角（走路動畫：腿分成前後兩段繞著髖部擺動，上半身跟著步伐彈跳） ----------
  // 貼圖裡腿的位置（佔整張圖的比例）；換人物貼圖時要重新量。
  const LEG_TOP = 0.77;
  const LEG_SPLIT = 0.36;
  const BACK_HIP = [0.3, 0.77];
  const FRONT_HIP = [0.46, 0.77];

  function drawHeroSprite(a, h, swing, liftBack, liftFront) {
    const w = (a.sw / a.sh) * h;
    const left = -w / 2;
    const top = -h;
    const sx = (fx) => a.sx + a.sw * fx;
    const sy = (fy) => a.sy + a.sh * fy;
    const legTopY = top + h * LEG_TOP;
    const piece = (srcX0, srcX1, hipFrac, angle, raise) => {
      const px = left + w * hipFrac[0];
      const py = top + h * hipFrac[1];
      g.save();
      g.translate(px, py - raise);
      g.rotate(angle);
      const dx0 = left + w * ((srcX0 - a.sx) / a.sw);
      g.drawImage(a.img, srcX0, sy(LEG_TOP - 0.01), srcX1 - srcX0, a.sh * (1 - LEG_TOP + 0.01),
        dx0 - px, legTopY - 0.01 * h - py, ((srcX1 - srcX0) / a.sw) * w, h * (1 - LEG_TOP + 0.01));
      g.restore();
    };
    if (swing === 0) {
      g.drawImage(a.img, a.sx, a.sy, a.sw, a.sh, left, top, w, h);
      return;
    }
    // 後腿、前腿（反向擺動），再蓋上身體（身體畫到髖部上方一點，把接縫遮掉）
    piece(a.sx, sx(LEG_SPLIT), BACK_HIP, -swing, liftBack);
    piece(sx(LEG_SPLIT), a.sx + a.sw, FRONT_HIP, swing, liftFront);
    g.drawImage(a.img, a.sx, a.sy, a.sw, a.sh * (LEG_TOP + 0.015), left, top, w, h * (LEG_TOP + 0.015));
  }

  function drawHero(t, mirror) {
    const a = art.hero;
    const speed = Math.min(1, Math.abs(player.vx) / WALK_SPEED);
    const beat = ((t * BPM) / 60) % 1;
    const pulse = Math.exp(-beat * 5);
    const s = Math.sin(walkPhase);
    const bounce = player.moving ? Math.abs(s) * 9 * Math.max(0.5, speed) : Math.sin(t * 2) * 2 + pulse * 3;
    const squash = player.moving ? 1 + Math.cos(walkPhase * 2) * 0.025 : 1 + pulse * 0.035;
    const lean = (player.vx / WALK_SPEED) * 0.07;
    const swing = player.moving ? s * 0.5 : 0;
    const liftFront = player.moving ? Math.max(0, Math.cos(walkPhase)) * 9 : 0;
    const liftBack = player.moving ? Math.max(0, -Math.cos(walkPhase)) * 9 : 0;
    const px = player.x - cam;
    g.save();
    if (mirror) {
      g.translate(0, WALK_Y * 2);
      g.scale(1, -1);
      g.globalAlpha = 0.28;
    }
    if (!mirror) {
      // 角色後方壓一塊暗色光暈，橘色外套才不會融進背景。
      const halo = g.createRadialGradient(px, WALK_Y - HERO_H * 0.5, 10, px, WALK_Y - HERO_H * 0.5, HERO_H * 0.95);
      halo.addColorStop(0, 'rgba(6,2,16,0.55)');
      halo.addColorStop(1, 'rgba(6,2,16,0)');
      g.fillStyle = halo;
      g.fillRect(px - HERO_H, WALK_Y - HERO_H * 1.5, HERO_H * 2, HERO_H * 1.7);
      g.fillStyle = 'rgba(0,0,0,0.42)';
      g.beginPath();
      g.ellipse(px, WALK_Y + 4, 50 - bounce * 0.8, 10, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.translate(px, WALK_Y - bounce);
    g.rotate(lean);
    g.scale(player.facing * (1 / squash), squash);
    if (a) {
      const h = HERO_H * faded.hero;
      if (!mirror) {
        g.shadowColor = 'rgba(255,255,255,0.7)';
        g.shadowBlur = 7;
      }
      drawHeroSprite(a, h, swing, liftBack, liftFront);
    } else {
      g.fillStyle = '#ff8a1f';
      g.fillRect(-24, -110, 48, 110);
    }
    g.restore();
  }

  function drawDust(dt) {
    for (let i = dust.length - 1; i >= 0; i -= 1) {
      const d = dust[i];
      d.life -= dt;
      if (d.life <= 0) {
        dust.splice(i, 1);
        continue;
      }
      d.x += d.vx * dt;
      d.y -= 18 * dt;
      g.globalAlpha = Math.max(0, d.life / 0.45) * 0.5;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(d.x - cam, d.y, d.r * (1.4 - d.life), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawRobot(t, dtScale) {
    const a = art.robot;
    if (!a) return;
    const targetX = player.x - player.facing * 95;
    robot.x += (targetX - robot.x) * Math.min(1, dtScale * 4);
    const bob = Math.sin(t * 3.2) * 9;
    const h = 66;
    const w = (a.sw / a.sh) * h;
    g.save();
    g.translate(robot.x - cam, WALK_Y - HERO_H * 0.72 + bob);
    g.scale(robot.x < player.x ? 1 : -1, 1);
    g.shadowColor = '#35f0ff';
    g.shadowBlur = 14;
    g.drawImage(a.img, a.sx, a.sy, a.sw, a.sh, -w / 2, -h / 2, w, h);
    g.restore();
  }

  function visible(margin = 0) {
    const lo = cam - margin - 300;
    const hi = cam + viewW + margin + 300;
    return buildings.filter((b) => b.doorX > lo && b.doorX < hi);
  }

  // ---------- 提示牌 ----------
  function updateNear(next) {
    if (next === near) return;
    near = next;
    if (near) {
      sfx('near');
      if (onNear) onNear(near.game);
      const tags = [...(near.game.tags || [])].slice(0, 4);
      plaque.hidden = false;
      plaque.style.setProperty('--c', near.look.accent);
      plaque.innerHTML = `
        <div class="city-plaque-head"><b>${escapeHtml(near.game.name || near.id)}</b>
          <span class="city-chip">${escapeHtml((DISTRICTS.find((d) => d.id === near.look.district) || {}).name || '')}</span></div>
        ${near.game.description ? `<p>${escapeHtml(near.game.description)}</p>` : ''}
        ${tags.length ? `<div class="city-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <button type="button" class="city-enter" id="cityEnter">▲ 進入</button>`;
      plaque.querySelector('#cityEnter').addEventListener('click', enterNear);
    } else {
      plaque.hidden = true;
      plaque.textContent = '';
    }
    markers.forEach((dot, i) => dot.classList.toggle('is-near', buildings[i] === near));
  }

  async function enterNear() {
    if (entering || !near) return;
    const building = near;
    entering = true;
    input.left = false;
    input.right = false;
    player.vx = 0;
    player.target = null;
    writeState({ x: building.doorX, facing: player.facing });
    root.classList.add('is-entering');
    try {
      await bootArcade({
        name: building.game.name || building.id,
        description: building.game.description || '',
        accent: building.look.accent,
        artUrl: building.art ? building.art.img.src : '',
        onSwitch: () => open(building.game),
      });
    } finally {
      // 開機動畫失敗或被中斷也要讓城市能繼續玩（成功時頁面已經換掉，這裡沒有作用）。
      if (!disposed) {
        entering = false;
        root.classList.remove('is-entering');
      }
    }
  }

  function showBanner(id) {
    const info = DISTRICTS.find((d) => d.id === id);
    if (!info) return;
    banner.textContent = info.name;
    banner.style.setProperty('--c', info.color);
    banner.className = `city-banner is-${id}`;
    void banner.offsetWidth;
    banner.classList.add('is-show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('is-show'), 2200);
  }

  // ---------- 主迴圈 ----------
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const t = (now - born) / 1000;
    // 鍵盤重複事件約每 30ms 一次（第一次要等約 0.5 秒）；超過 1.5 秒都沒有任何事件，
    // 代表 keyup 掉了（切視窗、輸入法吃掉等），自動放開，避免人物自己一路走下去。
    for (const side of ['left', 'right']) {
      if (input[side] && now - lastSeen[side] > 1500 && !touchHeld[side]) input[side] = false;
    }
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (!entering) stepPlayer(player, { dir }, dt, world.width);
    if (player.moving) {
      // 一個完整步伐（兩步）約 150 邏輯像素
      const prev = walkPhase;
      walkPhase += (Math.abs(player.vx) / 150) * dt * Math.PI * 2;
      // 每次腳落地（sin 過零）一下腳步聲與一小團灰塵
      if (Math.floor(prev / Math.PI) !== Math.floor(walkPhase / Math.PI)) {
        sfx('step');
        if (!reduce) dust.push({ x: player.x - player.facing * 18, y: WALK_Y + 2, vx: -player.facing * 30, r: 7, life: 0.45 });
      }
    } else {
      walkPhase = 0;
    }
    if (!entering) updateNear(doorAt(buildings, player.x));
    if (input.up && near && !entering) {
      input.up = false;
      enterNear();
    }
    cam = cameraFor(player.x, player.facing, viewW, world.width);
    if (art.hero && faded.hero < 1) faded.hero = Math.min(1, faded.hero + dt * 2.5);

    const beat = ((t * BPM) / 60) % 1;
    const pulse = Math.exp(-beat * 5);
    S.topPad = topPad;
    S.cam = cam;
    S.viewW = viewW;
    S.t = t;
    S.pulse = pulse;
    const theme = themeAt(gates, cam + viewW / 2);
    const main = theme.b && theme.t > 0.5 ? theme.b : theme.a;
    if (main !== dominant) {
      const first = dominant === null;
      dominant = main;
      root.dataset.theme = main;
      root.style.setProperty('--scan', String(THEMES[main].scan));
      if (!first) showBanner(main);
    }
    g.setTransform(k, 0, 0, k, 0, topPad * k);
    g.clearRect(0, -topPad, viewW, WORLD_H + topPad);
    g.fillStyle = THEMES[theme.a].sky[0];
    g.fillRect(0, -topPad, viewW, topPad + 2);
    drawBackdrop(S, theme.a, 1);
    if (theme.b) drawBackdrop(S, theme.b, theme.t);
    drawGround(S, theme.a, 1);
    if (theme.b) drawGround(S, theme.b, theme.t);
    // 倒影：夾在地面與房子之間（只畫地面那塊）
    g.save();
    g.beginPath();
    g.rect(0, GROUND_Y, viewW, WORLD_H - GROUND_Y);
    g.clip();
    const vis = visible(300);
    for (const b of vis) drawFacadeReflection(S, b);
    drawHero(t, true);
    const fade = g.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 150);
    fade.addColorStop(0, 'rgba(10,4,24,0.25)');
    fade.addColorStop(1, 'rgba(10,4,24,0.92)');
    g.fillStyle = fade;
    g.fillRect(0, GROUND_Y, viewW, WORLD_H - GROUND_Y);
    g.restore();
    drawLamps(S, theme.a);
    for (const gate of gates) drawGate(S, gate, pulse);
    for (const b of vis) drawFacade(S, b, b === near, pulse);
    drawRobot(t, dt);
    drawDust(dt);
    drawHero(t, false);
    drawWeather(S, theme.a, 1 - theme.t);
    if (theme.b) drawWeather(S, theme.b, theme.t);
    me.style.left = `${(player.x / world.width) * 100}%`;
  }

  // ---------- 輸入 ----------
  // 用 ev.code（實體按鍵位置）而不是 ev.key：中文輸入法開著時 key 會變成 "Process"，
  // keydown 收得到但 keyup 對不上，按鍵就卡在「按住」狀態，人物會一路走下去。
  const CODES = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
  };
  const lastSeen = { left: 0, right: 0 };
  // 只擋打字與對話框；輸入法組字中（isComposing）仍然要能走路。
  function blocked(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return true;
    const el = ev.target instanceof Element ? ev.target : null;
    if (el && el.closest(TYPING)) return true;
    return Boolean(document.querySelector('[aria-modal="true"]'));
  }
  function onKeyDown(ev) {
    if (blocked(ev)) return;
    const action = CODES[ev.code];
    if (!action) return;
    ev.preventDefault();
    unlockAudio();
    if (entering) return;
    if (action === 'up') {
      if (!ev.repeat) input.up = true;
      return;
    }
    input[action] = true;
    lastSeen[action] = performance.now();
  }
  function onKeyUp(ev) {
    const action = CODES[ev.code];
    // 「進入」是一次性的要求：放開按鍵不能取消，不然一個畫格內按下又放開就被吃掉。
    if (action && action !== 'up') input[action] = false;
  }
  function onBlur() {
    input.left = false;
    input.right = false;
    input.up = false;
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // 點房子：只有已經站在門前時才進入。不會自動走過去。
  canvas.addEventListener('pointerdown', (ev) => {
    if (entering) return;
    unlockAudio();
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * viewW + cam;
    const hit = buildings.find((b) => Math.abs(b.doorX - x) < FACADE_W / 2);
    if (hit && hit === near) enterNear();
  });

  for (const btn of root.querySelectorAll('[data-hold]')) {
    const name = btn.dataset.hold;
    const press = (ev) => {
      ev.preventDefault();
      unlockAudio();
      if (entering) return;
      if (name === 'up') input.up = true;
      else {
        input[name] = true;
        touchHeld[name] = true;
      }
    };
    const release = () => {
      if (name !== 'up') {
        input[name] = false;
        touchHeld[name] = false;
      }
    };
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
  }

  // 分頁看不到的時候停掉迴圈，回來再開。
  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !disposed) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  // 第一次進城的標題卡
  let intro = null;
  let seenIntro = false;
  try { seenIntro = sessionStorage.getItem(INTRO_KEY) === '1'; } catch (_) { seenIntro = false; }
  if (!seenIntro && !reduce) {
    intro = document.createElement('div');
    intro.className = 'city-intro';
    intro.setAttribute('aria-hidden', 'true');
    intro.innerHTML = '<b>PIE CITY</b><span>歡迎來到遊戲城</span>';
    root.appendChild(intro);
    intro.addEventListener('animationend', () => { intro.remove(); intro = null; });
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch (_) { /* ignore */ }
  }

  setCityActive(true);
  canvas.focus({ preventScroll: true });
  raf = requestAnimationFrame(frame);

  return {
    unmount() {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(bannerTimer);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      setCityActive(false);
      view.classList.remove('is-city');
    },
  };
}
