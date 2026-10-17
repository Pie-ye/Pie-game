/**
 * 遊戲框架（Pie City UI v2）。每款遊戲都是整個視窗大的主題場景：
 * 左上「回城市」、招牌標題、工具（全螢幕／紀錄）、中央舞台、右側紀錄抽屜。
 * 外觀由 ui/games/<id>.css 決定（配色、背景、字體、按鈕形狀），舞台裡的遊戲畫面由各遊戲自己的 CSS 負責。
 */
import { escapeHtml, mountStylesheet } from './util.js';
import { LOOKS } from './city/layout.js';
import { sfx } from './city/audio.js';

const KICKERS = {
  slots: 'NEON SLOT CABINET',
  blackjack: 'VELVET TABLE 21',
  baccarat: 'VIP BACCARAT SALON',
  niuniu: 'BULL ARENA',
  dragon: 'DRAGON GATE',
  'texas-holdem': "HOLD'EM LOUNGE",
  'coin-flip': 'COIN TOSS BOOTH',
  'lucky-wheel': 'FORTUNE WHEEL',
  'pie-phoebe': 'STARLIGHT STAGE',
  'phoebe-egg': 'EGG DELIVERY',
  'phoebe-peak': 'PEAK CLIMB',
  snake: 'SNAKE CABINET',
  'tic-tac-toe': 'X · O DUEL',
};

// 有專屬外觀檔的遊戲（ui/games/<id>.css）；其他投稿遊戲用預設的暗色霓虹框架。
const SKINNED = new Set(Object.keys(KICKERS));

const ART_BASE = new URL('./city/assets/', import.meta.url);

export function buildFrame(view, {
  id, title, stageId, community = false, fullscreen = null, history = true,
}) {
  const look = LOOKS[id] || null;
  const release = SKINNED.has(id) ? mountStylesheet(new URL(`./ui/games/${id}.css`, import.meta.url)) : () => {};
  view.className = 'page-content gx-page';
  // 電玩巷的外牆壁畫是棕色木紋街機，當全螢幕背景會像舊皮膚：改用純深藍格線底（見 ui/games/<id>.css）。
  const art = look && look.art && look.district !== 'arcade' ? new URL(`fac-${look.art}.webp`, ART_BASE).href : '';
  view.innerHTML = `
    <div class="gx gx-${escapeHtml(id)}" data-game="${escapeHtml(id)}" data-district="${look ? look.district : 'arcade'}"
      style="${art ? `--gx-bg:url('${art}');` : ''}${look ? `--gx-accent:${look.accent};` : ''}">
      <div class="gx-bg" aria-hidden="true"></div>
      <div class="gx-fx" aria-hidden="true"></div>
      <header class="gx-bar">
        <a class="gx-back back-button" href="#/" aria-label="回城市"><span aria-hidden="true">◀</span><span>回城市</span></a>
        <div class="gx-title"><small>${escapeHtml(KICKERS[id] || 'GAME')}</small><b>${escapeHtml(title)}</b></div>
        <div class="gx-tools">
          ${history ? '<button type="button" class="gx-tool" id="gxHistory" aria-expanded="false">紀錄</button>' : ''}
          <button type="button" class="gx-tool game-fullscreen" id="gameFullscreen" aria-label="全螢幕">⛶</button>
        </div>
      </header>
      <main class="gx-stage${community ? ' is-community' : ''}" id="${escapeHtml(stageId)}"></main>
      <div class="gx-scrim" id="gxScrim" hidden></div>
      <aside class="gx-drawer" id="gxDrawer" aria-label="遊戲紀錄">
        <button type="button" class="gx-tool gx-drawer-close" id="gxDrawerClose" aria-label="關閉紀錄">✕</button>
        <div id="historyRoot"></div>
      </aside>
    </div>`;
  const gx = view.querySelector('.gx');
  const stage = view.querySelector(`#${stageId}`);
  const drawer = view.querySelector('#gxDrawer');
  const scrim = view.querySelector('#gxScrim');
  const historyBtn = view.querySelector('#gxHistory');
  const setDrawer = (open) => {
    drawer.classList.toggle('is-open', open);
    scrim.hidden = !open;
    if (historyBtn) historyBtn.setAttribute('aria-expanded', String(open));
  };
  if (historyBtn) historyBtn.addEventListener('click', () => { sfx('blip'); setDrawer(!drawer.classList.contains('is-open')); });
  view.querySelector('#gxDrawerClose').addEventListener('click', () => setDrawer(false));
  scrim.addEventListener('click', () => setDrawer(false));
  const onKey = (ev) => { if (ev.key === 'Escape') setDrawer(false); };
  document.addEventListener('keydown', onKey);
  view.querySelector('#gameFullscreen').addEventListener('click', () => {
    if (typeof fullscreen === 'function') fullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
  });
  return {
    gx,
    stage,
    historyRoot: view.querySelector('#historyRoot'),
    openHistory: () => setDrawer(true),
    destroy() {
      document.removeEventListener('keydown', onKey);
      release();
    },
  };
}
