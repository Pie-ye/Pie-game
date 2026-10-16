/**
 * 登入畫面：街機螢幕就是登入表單。背景是賭場街夜景，旁邊站著主角（跟城市裡同一張貼圖）。
 * dialog=true 時蓋在目前頁面上（登入狀態失效時），登入後由外框重掛當前頁面。
 */
import { REGISTER_URL } from './config.js';
import { login as apiLogin } from './api.js';
import { escapeHtml } from './util.js';
import { sfx } from './city/audio.js';

const ART = new URL('./city/assets/', import.meta.url);

export function mountLoginScene(parent, { dialog = false, onSuccess, onClose }) {
  const host = document.createElement('div');
  if (dialog) host.className = 'lg-dialog';
  host.innerHTML = `
    <section class="lg" style="--lg-bg:url('${new URL('bg-casino.webp', ART).href}')" ${dialog ? 'role="dialog" aria-modal="true" aria-labelledby="lgTitle"' : ''}>
      <div class="lg-bg" aria-hidden="true"></div>
      ${dialog ? '' : '<a class="gx-back lg-back" href="#/"><span aria-hidden="true">◀</span><span>回城市</span></a>'}
      <h2 class="lg-logo" aria-hidden="true">PIE CITY</h2>
      <div class="lg-stage">
        <div class="lg-cab">
          <img src="${new URL('arcade.webp', ART).href}" alt="" draggable="false">
          <div class="lg-screen">
            <form class="lg-form" id="loginForm" autocomplete="on">
              <h1 id="lgTitle">${dialog ? 'CONTINUE?' : 'INSERT COIN'}</h1>
              <p>${dialog ? '登入狀態已失效，重新登入就能留在這一頁繼續。' : '使用股票大亂鬥帳號登入。'}</p>
              <label>帳號<input name="username" autocomplete="username" required></label>
              <label>密碼<input name="password" type="password" autocomplete="current-password" required></label>
              <p class="lg-error" id="loginError" role="alert"></p>
              <div class="lg-actions">
                <button type="submit" class="lg-go">START</button>
                ${dialog ? '<button type="button" class="lg-reg" id="loginDialogClose" style="background:none;border:0;cursor:pointer;color:inherit;text-decoration:underline">稍後再說</button>' : `<span class="lg-reg">沒有帳號？<a href="${escapeHtml(REGISTER_URL)}" target="_blank" rel="noopener">到股票大亂鬥註冊</a></span>`}
              </div>
            </form>
          </div>
        </div>
        <img class="lg-hero" src="${new URL('hero.webp', ART).href}" alt="" draggable="false">
      </div>
    </section>`;
  if (dialog) parent.appendChild(host);
  else parent.replaceChildren(host);
  const form = host.querySelector('#loginForm');
  const errEl = host.querySelector('#loginError');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    errEl.textContent = '';
    const { response, payload } = await apiLogin(String(data.get('username') || ''), String(data.get('password') || ''));
    btn.disabled = false;
    if (!response.ok) {
      errEl.textContent = (payload && payload.error) || '登入失敗';
      sfx('off');
      return;
    }
    sfx('chime');
    if (onSuccess) onSuccess();
  });
  const closeBtn = host.querySelector('#loginDialogClose');
  if (closeBtn && onClose) closeBtn.addEventListener('click', onClose);
  const first = form.querySelector('input[name="username"]');
  if (first) first.focus();
  return { destroy() { host.remove(); } };
}
