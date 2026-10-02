/**
 * Arc 動效的原生 JS 移植（Arc：github.com/kuratlielia/arc-library，MIT）。
 * Arc 本身是 React＋Motion；外框沒有建置流程、CSP 只允許同源腳本，所以只搬手法：
 * - setRollingText：Slot text 的數字逐位捲動（同股票大亂鬥 v1.2.3 的移植）
 * - swapView：路由切換時舊畫面淡出、新畫面淡入上浮（View Transitions API，沒有就直接換）
 */
import { motionEnabled } from './util.js';

const ROLL_MAX_MS = 900;

function parseRollNumber(text) {
  const m = String(text).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

/** 數字變了就逐位捲到新值；不是數字、看不到、或關掉動態時直接換字。 */
export function setRollingText(el, nextText) {
  if (!el) return;
  const next = String(nextText);
  // 捲動中 textContent 混著捲軸節點，只能信 dataset；靜止時以畫面上的字為準。
  const prev = el._rollAnims ? (el.dataset.rollValue || '') : el.textContent;
  el.dataset.rollValue = next;
  if (el._rollAnims) {
    el._rollAnims.forEach((a) => { try { a.cancel(); } catch (_) { /* ignore */ } });
    el._rollAnims = null;
  }
  const canRoll = prev !== next
    && motionEnabled()
    && !document.hidden
    && typeof el.animate === 'function'
    && el.getClientRects().length > 0
    && /\d/.test(prev) && /\d/.test(next)
    && Math.abs(prev.length - next.length) <= 3;
  if (!canRoll) {
    if (el.textContent !== next || el.childElementCount) el.textContent = next;
    return;
  }

  const rising = !(parseRollNumber(next) < parseRollNumber(prev));
  const a = Array.from(prev);
  const b = Array.from(next);
  // 由尾端對齊：999 → 1,000 是左邊多長出一位，個位數仍跟個位數比。
  const pad = b.length - a.length;
  const reels = document.createElement('span');
  reels.className = 'roll';
  reels.setAttribute('aria-hidden', 'true');
  const jobs = [];
  b.forEach((to, i) => {
    const from = a[i - pad];
    const slot = document.createElement('span');
    if (from === to) {
      slot.textContent = to;
      reels.appendChild(slot);
      return;
    }
    slot.className = 'roll-slot';
    const sizer = document.createElement('span');
    sizer.className = 'roll-sizer';
    sizer.textContent = to;
    slot.appendChild(sizer);
    let cells;
    if (/\d/.test(to) && from !== undefined && /\d/.test(from)) {
      const x = Number(from);
      const y = Number(to);
      const steps = rising ? (y - x + 10) % 10 : (x - y + 10) % 10;
      cells = Array.from({ length: steps + 1 }, (_, k) => String((x + (rising ? k : -k) + 10) % 10));
    } else {
      cells = [from === undefined ? ' ' : from, to];
    }
    if (!rising) cells.reverse();
    const strip = document.createElement('span');
    strip.className = 'roll-strip';
    for (const c of cells) {
      const cell = document.createElement('span');
      cell.className = 'roll-cell';
      cell.textContent = c;
      strip.appendChild(cell);
    }
    const win = document.createElement('span');
    win.className = 'roll-window';
    win.appendChild(strip);
    slot.appendChild(win);
    reels.appendChild(slot);
    jobs.push([strip, cells.length]);
  });

  const sr = document.createElement('span');
  sr.className = 'roll-sr';
  sr.textContent = next;
  el.replaceChildren(sr, reels);

  const last = Math.max(1, jobs.length - 1);
  const anims = jobs.map(([strip, n], order) => {
    const span = ((n - 1) / n) * 100;
    const fromY = rising ? 0 : -span;
    const toY = rising ? -span : 0;
    const duration = Math.min(ROLL_MAX_MS, 520 + Math.min(n, 6) * 25 + (order / last) * 160);
    // Arc 的速度模糊：快速轉動的前段微糊、落定前清楚。
    const blur = n > 3 ? 'blur(0.9px)' : 'blur(0.4px)';
    return strip.animate(
      [
        { transform: `translateY(${fromY}%)`, filter: blur },
        { offset: 0.55, filter: 'blur(0px)' },
        { transform: `translateY(${toY}%)`, filter: 'blur(0px)' },
      ],
      { duration, easing: 'cubic-bezier(0.12, 0.8, 0.16, 1)', fill: 'both' },
    );
  });
  el._rollAnims = anims;
  Promise.all(anims.map((anim) => anim.finished)).then(() => {
    if (el._rollAnims !== anims) return;
    el._rollAnims = null;
    el.textContent = next;
  }).catch(() => { /* 被下一次更新 cancel 掉：由下一次負責收尾 */ });
}

/**
 * 換頁動畫：舊畫面淡出、新畫面淡入上浮（CSS 在 ::view-transition-*）。
 * update 可以是 async；不支援 View Transitions 或關掉動態時直接執行。
 * 只包住「同步換掉 DOM」那一段，網路等待不能放進來，否則畫面會凍住。
 */
export function swapView(update) {
  if (!motionEnabled() || typeof document.startViewTransition !== 'function' || document.hidden) {
    update();
    return;
  }
  let transition;
  try {
    transition = document.startViewTransition(update);
  } catch (_) {
    update();
    return;
  }
  // 連續換頁時前一個轉場會被跳過，promise 以 AbortError 結束；那是正常狀況，不要讓它變成未處理的錯誤。
  const ignore = () => {};
  transition.ready.catch(ignore);
  transition.finished.catch(ignore);
  transition.updateCallbackDone.catch(ignore);
}
