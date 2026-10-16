/**
 * 進遊戲的轉場：鏡頭推向一台復古街機，螢幕「啪」一聲亮起、跑開機文字，
 * 最後白閃一下換成遊戲畫面，再像老電視一樣收成一條線。
 * 整段約 3 秒，按任意鍵或點一下可以快轉（換頁仍會發生）。
 */
import { escapeHtml, motionEnabled } from '../util.js';
import { loadArt } from './assets.js';
import { sfx } from './audio.js';

// 街機貼圖裡螢幕的位置（佔整張圖的比例）。換貼圖時只要改這四個數字。
export const SCREEN = { left: 0.13, top: 0.17, width: 0.74, height: 0.40 };

let running = false;

export function preloadArcade() {
  return loadArt('arcade.webp', { trim: true });
}

const wait = (ms, ctl) => new Promise((resolve) => {
  if (ctl.skip) { resolve(); return; }
  const timer = setTimeout(resolve, ms);
  ctl.wakers.add(() => { clearTimeout(timer); resolve(); });
});

function animate(el, frames, options, ctl) {
  if (!el || typeof el.animate !== 'function') return Promise.resolve();
  const anim = el.animate(frames, { fill: 'forwards', ...options });
  const stop = () => { try { anim.finish(); } catch (_) { /* ignore */ } };
  ctl.wakers.add(stop);
  return anim.finished.catch(() => {}).then(() => ctl.wakers.delete(stop));
}

/**
 * 播開機動畫。onSwitch 在畫面全白那一刻呼叫（導向遊戲頁）。
 * 動畫跑完或被中斷都會把畫面清乾淨；不管怎樣回傳的 Promise 一定會 resolve。
 */
export async function bootArcade({ name, description = '', accent = '#35f0ff', artUrl = '', onSwitch }) {
  if (running) return;
  running = true;
  const ctl = { skip: false, wakers: new Set() };
  const fastForward = () => {
    ctl.skip = true;
    for (const wake of [...ctl.wakers]) wake();
  };
  let switched = false;
  const doSwitch = () => {
    if (switched) return;
    switched = true;
    try { onSwitch(); } catch (_) { /* 導頁失敗也要收掉動畫 */ }
  };

  const el = document.createElement('div');
  el.id = 'arcadeBoot';
  el.className = 'ab';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--accent', accent);
  el.style.setProperty('--sl', `${SCREEN.left * 100}%`);
  el.style.setProperty('--st', `${SCREEN.top * 100}%`);
  el.style.setProperty('--sw', `${SCREEN.width * 100}%`);
  el.style.setProperty('--sh', `${SCREEN.height * 100}%`);

  try {
    if (!motionEnabled()) {
      el.className = 'ab ab-plain';
      el.innerHTML = `<div class="ab-plain-text">${escapeHtml(name)}</div>`;
      document.body.appendChild(el);
      await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 }, ctl);
      doSwitch();
      await wait(120, ctl);
      await animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 }, ctl);
      return;
    }

    const art = await Promise.race([preloadArcade(), new Promise((r) => setTimeout(() => r(null), 600))]);
    const aspect = art ? art.sw / art.sh : 0.68;
    el.style.setProperty('--aspect', String(aspect));
    el.innerHTML = `
      <div class="ab-room">
        <div class="ab-cabinet${art ? '' : ' is-fallback'}">
          ${art ? `<img class="ab-art" alt="" draggable="false" src="${escapeHtml(art.img.src)}">` : '<div class="ab-fallback"></div>'}
          <div class="ab-glass"></div>
        </div>
      </div>
      <div class="ab-crt" hidden>
        <div class="ab-line"></div>
        <div class="ab-content">
          <pre class="ab-log"></pre>
          <div class="ab-title">${artUrl ? `<img class="ab-house" alt="" src="${escapeHtml(artUrl)}">` : ''}<span class="ab-kicker">NOW LOADING</span><b>${escapeHtml(name)}</b><span class="ab-sub">${escapeHtml(description)}</span></div>
          <div class="ab-bar"><i></i></div>
          <div class="ab-start">PRESS START</div>
        </div>
        <div class="ab-scan"></div>
      </div>
      <div class="ab-flash"></div>`;
    document.body.appendChild(el);
    window.addEventListener('keydown', fastForward, { once: true });
    el.addEventListener('pointerdown', fastForward, { once: true });

    const room = el.querySelector('.ab-room');
    const cabinet = el.querySelector('.ab-cabinet');
    const crt = el.querySelector('.ab-crt');
    const content = el.querySelector('.ab-content');
    const log = el.querySelector('.ab-log');
    const bar = el.querySelector('.ab-bar i');
    const start = el.querySelector('.ab-start');
    const flash = el.querySelector('.ab-flash');
    content.style.visibility = 'hidden';

    // 1. 暗場淡入，街機從遠處出現
    await animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 260 }, ctl);

    // 2. 鏡頭推向螢幕。算出要放大多少才會讓螢幕剛好填滿視窗。
    const screenBox = cabinet.getBoundingClientRect();
    const sx = screenBox.left + screenBox.width * (SCREEN.left + SCREEN.width / 2);
    const sy = screenBox.top + screenBox.height * (SCREEN.top + SCREEN.height / 2);
    const sw = screenBox.width * SCREEN.width;
    const sh = screenBox.height * SCREEN.height;
    const zoom = Math.min((window.innerWidth * 0.94) / sw, (window.innerHeight * 0.9) / sh);
    room.style.transformOrigin = `${sx}px ${sy}px`;
    sfx('power');
    await wait(160, ctl);
    await animate(room, [{ transform: 'scale(1)' }, { transform: `scale(${zoom})` }], { duration: 900, easing: 'cubic-bezier(.6,.0,.25,1)' }, ctl);

    // 3. 放大完成：換成同樣大小、文字清楚的全尺寸螢幕，CRT 開機（一條白線撐開）
    crt.hidden = false;
    // 螢幕可能被放大到超出視窗；限制在視窗內置中，避免文字被切掉。
    const maxW = window.innerWidth * 0.94;
    const maxH = window.innerHeight * 0.9;
    const cw = Math.min(sw * zoom, maxW);
    const ch = Math.min(sh * zoom, maxH);
    crt.style.width = `${cw}px`;
    crt.style.height = `${ch}px`;
    crt.style.left = `${(window.innerWidth - cw) / 2}px`;
    crt.style.top = `${(window.innerHeight - ch) / 2}px`;
    crt.style.fontSize = `${Math.max(12, Math.min(cw / 46, ch / 15))}px`;
    const line = el.querySelector('.ab-line');
    await animate(line, [
      { transform: 'scale(0.002, 0.006)', opacity: 1, offset: 0 },
      { transform: 'scale(1, 0.006)', opacity: 1, offset: 0.55 },
      { transform: 'scale(1, 1)', opacity: 1, offset: 1 },
    ], { duration: 380, easing: 'cubic-bezier(.2,.8,.3,1)' }, ctl);
    line.style.display = 'none';
    content.style.visibility = 'visible';
    sfx('blip');

    // 4. 開機文字
    const lines = [
      'PIE-OS BIOS v1.0',
      'MEMORY CHECK .... 640K OK',
      'INSERT CARTRIDGE .... OK',
      `LOAD > ${name}`,
    ];
    for (const text of lines) {
      log.textContent += `${text}\n`;
      sfx('blip');
      await wait(150, ctl);
    }
    el.querySelector('.ab-title').classList.add('is-on');
    sfx('load');
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      bar.style.width = `${(i / steps) * 100}%`;
      if (i % 3 === 0) sfx('load');
      await wait(55, ctl);
    }
    start.classList.add('is-on');
    sfx('chime');
    await wait(420, ctl);

    // 5. 白閃、換頁
    sfx('power');
    await animate(flash, [{ opacity: 0 }, { opacity: 1 }], { duration: 110 }, ctl);
    doSwitch();
    await wait(380, ctl);

    // 6. 老電視關機：先壓成一條線，再縮成一個點
    sfx('off');
    crt.classList.add('is-closing');
    el.classList.add('is-closing');
    await animate(el, [
      { transform: 'scale(1, 1)', filter: 'brightness(1)', opacity: 1 },
      { transform: 'scale(1, 0.012)', filter: 'brightness(3)', opacity: 1, offset: 0.7 },
      { transform: 'scale(0.002, 0.012)', filter: 'brightness(6)', opacity: 0.9 },
    ], { duration: 380, easing: 'cubic-bezier(.5,0,.8,.4)' }, ctl);
    el.style.opacity = '0';
  } finally {
    window.removeEventListener('keydown', fastForward);
    // 沒導頁就被中斷（例如發生例外）時，仍然要把使用者帶去遊戲。
    doSwitch();
    el.remove();
    running = false;
  }
}
