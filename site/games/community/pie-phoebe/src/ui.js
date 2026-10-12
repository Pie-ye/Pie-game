// DOM 介面：HUD、標題、升級選單、暫停、結算。
import { WEAPONS, PASSIVES, PET } from './data.js';
import { isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export { fmt };

export class UI {
  constructor(h) {
    this.h = h;
    this.hud = $('hud');
    this.screen = $('screen');
    this.cache = {};
    $('btn-pause').addEventListener('click', () => h.onPause());
    $('btn-mute').addEventListener('click', () => h.onMute());
    $('mode-q').addEventListener('click', () => h.onMode('absolve'));
    $('mode-e').addEventListener('click', () => h.onMode('confess'));
    this.refreshMute();
  }

  refreshMute() { $('btn-mute').textContent = isMuted() ? '🔇' : '🔊'; }
  showHud(v) { this.hud.hidden = !v; }
  hideScreen() { this.screen.hidden = true; this.screen.innerHTML = ''; }
  loaded() { $('loading').hidden = true; }

  set(id, prop, v) {
    const k = id + prop;
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    $(id)[prop] = v;
  }

  style(id, prop, v) {
    const k = `${id}:${prop}`;
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    $(id).style[prop] = v;
  }

  toggle(id, cls, on) {
    const k = `${id}.${cls}`;
    if (this.cache[k] === on) return;
    this.cache[k] = on;
    $(id).classList.toggle(cls, on);
  }

  update(s) {
    this.style('hp-fill', 'width', `${Math.max(0, (s.hp / s.maxhp) * 100).toFixed(1)}%`);
    this.set('hp-text', 'textContent', `${Math.ceil(Math.max(0, s.hp))} / ${s.maxhp}`);
    this.style('xp-fill', 'width', `${(s.xp / s.xpNeed * 100).toFixed(1)}%`);
    this.set('xp-text', 'textContent', `Lv ${s.lvl}`);
    this.set('time', 'textContent', fmt(s.time));
    this.set('kills', 'textContent', String(s.kills));
    this.set('fish', 'textContent', String(s.fish));

    const ready = s.prayer >= s.prayerMax && !s.mode;
    this.style('pr-fill', 'width', `${(s.prayer / s.prayerMax * 100).toFixed(1)}%`);
    this.set('pr-text', 'textContent', s.mode ? '祈願 ・ 發動中' : ready ? '祈願已滿！' : `祈願 ${Math.floor(s.prayer)}/${s.prayerMax}`);
    this.toggle('pr-fill', 'x', false);
    this.toggle('pr-text', 'x', false);
    $('pr-fill').parentElement.classList.toggle('ready', ready);
    $('modes').hidden = !ready;
    const ms = $('modestate');
    ms.hidden = !s.mode;
    if (s.mode) {
      ms.className = `modestate ${s.mode}`;
      this.set('modestate', 'textContent', `${s.mode === 'absolve' ? '赦罪' : '告解'} ${Math.ceil(s.modeLeft)}s`);
    }

    const p = s.pet;
    this.style('pet-fill', 'width', `${(p.full ? p.left / p.dur : p.fullness / p.need) * 100}%`);
    $('pet-fill').parentElement.classList.toggle('full', p.full);
    this.set('pet-text', 'textContent', p.full ? `瑞吉 吃飽啦！ ${Math.ceil(p.left)}s` : `瑞吉 ${p.fullness}/${p.need} 條魚`);

    const b = s.boss;
    $('boss-bar').hidden = !b;
    if (b) {
      this.style('boss-fill', 'width', `${Math.max(0, b.hp / b.maxhp * 100).toFixed(1)}%`);
      this.set('boss-name', 'textContent', b.name);
    }
  }

  setSlots(g) {
    const parts = [];
    for (const [k, lv] of Object.entries(g.weapons)) parts.push(`<div class="slot" title="${WEAPONS[k].name}">${WEAPONS[k].icon}<b>${lv}</b></div>`);
    for (const [k, lv] of Object.entries(g.petSkills)) parts.push(`<div class="slot pet" title="${PET[k].name}">${PET[k].icon}<b>${lv}</b></div>`);
    for (const [k, lv] of Object.entries(g.passives)) parts.push(`<div class="slot passive" title="${PASSIVES[k].name}">${PASSIVES[k].icon}<b>${lv}</b></div>`);
    $('slots').innerHTML = parts.join('');
  }

  banner(text, color = '#ffd966') {
    const old = $('banner');
    const el = old.cloneNode(false);
    el.id = 'banner';
    el.hidden = false;
    el.textContent = text;
    el.style.color = color;
    old.replaceWith(el);
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { el.hidden = true; }, 2700);
  }

  stick(show, x, y, dx, dy) {
    const s = $('stick');
    s.hidden = !show;
    if (!show) return;
    s.style.left = `${x}px`; s.style.top = `${y}px`;
    s.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  title(best) {
    this.showHud(false);
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <div class="logo">菲比啾比<br>星光倖存</div>
        <p class="sub">衍射共鳴者菲比啾比，帶著海獅瑞吉，撐過十二分鐘的失序噪音。</p>
        <div class="duo"><img src="./assets/phoebe.png" alt="菲比啾比"><img class="pet" src="./assets/reggie_open.png" alt="海獅瑞吉"></div>
        <button type="button" class="screen-btn" id="go">開始 <small>(Enter)</small></button>
        <div class="tips">
          <div><b>移動</b> WASD／方向鍵，或在畫面上按住拖曳。攻擊會自動施放。</div>
          <div><b>祈願</b> 充滿後按 <b>Q 赦罪</b>（輸出強化）或 <b>E 告解</b>（光噪疊 3 倍、全場易傷）。</div>
          <div><b>瑞吉</b> 會張嘴吼、肚皮滑行，還會去吃你打出來的小魚——吃飽就變胖變強。</div>
          <div>P／Esc 暫停　M 靜音　升級時按 1・2・3 選卡</div>
        </div>
        ${best ? `<div class="best">最佳存活 ${fmt(best.time)}　擊殺 ${best.kills}</div>` : ''}
      </div>`;
    $('go').addEventListener('click', () => this.h.onStart());
  }

  levelup(level, cards) {
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <h2 class="title-h">升級！ Lv ${level}</h2>
        <div class="cards">${cards.map((c, i) => `
          <button type="button" class="card ${c.kind || ''} ${c.isNew ? 'new' : ''}" data-i="${i}">
            <kbd>${i + 1}</kbd>
            <span class="ic">${c.icon}</span>
            <h3>${c.name}<em>${c.lv}</em></h3>
            <span class="now">${c.now}</span>
            <p>${c.desc}</p>
          </button>`).join('')}</div>
      </div>`;
    this.screen.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => this.h.onPick(Number(el.dataset.i))));
    const first = this.screen.querySelector('.card');
    if (first) first.focus({ preventScroll: true });
  }

  pause() {
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <h2 class="title-h">暫停</h2>
        <button type="button" class="screen-btn" id="resume">繼續 <small>(P)</small></button>
        <button type="button" class="screen-btn ghost" id="quit">放棄這局</button>
      </div>`;
    $('resume').addEventListener('click', () => this.h.onResume());
    $('quit').addEventListener('click', () => this.h.onQuit());
  }

  end(win, st, best) {
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <div class="logo" style="font-size:clamp(24px,4.6vw,44px)">${win ? '撐過來了！' : '菲比倒下了…'}</div>
        <p class="sub">${win ? '失序的噪音退去，瑞吉開心地吃起小魚。' : '瑞吉還在旁邊張著嘴，好像在說「再來一局啦」。'}</p>
        <div class="duo" style="height:clamp(90px,18vw,170px)"><img src="./assets/phoebe.png" alt=""><img class="pet" src="./assets/reggie_${win ? 'open' : 'closed'}.png" alt=""></div>
        <div class="stats">
          <div><b>${fmt(st.time)}</b><span>存活時間</span></div>
          <div><b>${st.kills}</b><span>擊殺</span></div>
          <div><b>Lv ${st.lvl}</b><span>等級</span></div>
          <div><b>${st.fish}</b><span>吃到的小魚</span></div>
        </div>
        ${best ? `<div class="best">${st.newBest ? '新紀錄！ ' : ''}最佳存活 ${fmt(best.time)}　擊殺 ${best.kills}</div>` : ''}
        <div>
          ${win ? '<button type="button" class="screen-btn" id="cont">繼續無盡模式</button>' : ''}
          <button type="button" class="screen-btn ${win ? 'ghost' : ''}" id="again">再來一局 <small>(Enter)</small></button>
        </div>
      </div>`;
    if (win) $('cont').addEventListener('click', () => this.h.onContinue());
    $('again').addEventListener('click', () => this.h.onStart());
  }
}
