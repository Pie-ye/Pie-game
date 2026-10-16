// DOM 介面：HUD、標題、升級選單、暫停、結算。
import { WEAPONS, PASSIVES, PET, SYNERGIES, SYN_LV, CHARACTERS } from './data.js';
import { isMuted } from './audio.js';
import { skillSummary } from './skills.js';

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export { fmt };

function damageReport(damage = {}, synergy = {}) {
  const entries = Object.entries(damage).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  const total = entries.reduce((sum, [, n]) => sum + n, 0) || 1;
  return `<details class="skill-guide"><summary>本局傷害貢獻</summary><div class="damage-report">${Object.entries(synergy).filter(([, n]) => n > 0).map(([id, n]) => `<div class="syn"><span>⚡ ${SYNERGIES.find((s) => s.id === id)?.name || id}（連攜額外傷害，已含在上方）</span><b>${Math.round(n).toLocaleString()}</b></div>`).join('')}${entries.map(([key, n]) => `<div><span>${WEAPONS[key]?.name || ({ pet: '瑞吉', hecate: '赫卡忒', roar: '瑞吉・張嘴吼', slide: '瑞吉・環繞滑行', burp: '瑞吉', prayer: '祈願爆發', frazzle: '光噪持續傷害' })[key] || key}</span><b>${Math.round(n).toLocaleString()} · ${Math.round(n / total * 100)}%</b></div>`).join('')}</div></details>`;
}

export class UI {
  constructor(h) {
    this.h = h;
    this.hud = $('hud');
    this.screen = $('screen');
    this.cache = {};
    $('btn-pause').addEventListener('click', () => h.onPause());
    $('btn-mute').addEventListener('click', () => h.onMute());
    $('btn-fx').addEventListener('click', () => h.onFx());
    $('mode-q').addEventListener('click', () => h.onMode(this.cache.modesChar === 'phrolova' ? 'maestro' : 'absolve'));
    $('mode-e').addEventListener('click', () => h.onMode('confess'));
    this.refreshMute();
  }

  refreshFx(name) { $('btn-fx').textContent = `✨${name}`; }
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
    const ph = s.charId === 'phrolova';
    this.style('pr-fill', 'width', `${(s.prayer / s.prayerMax * 100).toFixed(1)}%`);
    const notes = ph ? `｜音符 ${'♪'.repeat(s.notes)}${'·'.repeat(Math.max(0, s.notesNeed - s.notes))}` : '';
    this.set('pr-text', 'textContent', (s.mode ? `${ph ? '樂章' : '祈願'} ・ 發動中` : ready ? `${ph ? '樂章' : '祈願'}已滿！` : `${ph ? '樂章' : '祈願'} ${Math.floor(s.prayer)}/${s.prayerMax}`) + notes);
    this.toggle('pr-fill', 'x', false);
    this.toggle('pr-text', 'x', false);
    $('pr-fill').parentElement.classList.toggle('ready', ready);
    $('modes').hidden = !ready;
    if (this.cache.modesChar !== s.charId) {
      this.cache.modesChar = s.charId;
      $('mode-e').hidden = ph;
      $('mode-q').innerHTML = ph ? '<kbd>Q</kbd><b>樂章</b><small>召喚赫卡忒 15 秒</small>' : '<kbd>Q</kbd><b>赦罪</b><small>輸出強化</small>';
    }
    const ms = $('modestate');
    ms.hidden = !s.mode;
    if (s.mode) {
      ms.className = `modestate ${s.mode}`;
      this.set('modestate', 'textContent', `${s.mode === 'absolve' ? '赦罪' : s.mode === 'maestro' ? '樂章' : '告解'} ${Math.ceil(s.modeLeft)}s`);
    }

    const p = s.pet;
    const roarReady = p.roar <= 0;
    this.style('pet-fill', 'width', `${(roarReady ? 1 : 1 - Math.min(1, p.roar / p.roarMax)) * 100}%`);
    $('pet-fill').parentElement.classList.toggle('full', roarReady);
    this.set('pet-text', 'textContent', `瑞吉 ${p.busy || (roarReady ? '吼 就緒' : `吼 ${p.roar.toFixed(1)}s`)}${p.slide != null && !p.busy ? (p.slide <= 0 ? '｜滑行 就緒' : `｜滑行 ${p.slide.toFixed(1)}s`) : ''}`);

    const bosses = s.bosses || [];
    const key = bosses.map((o) => o.id).join(',');
    const box = $('boss-bars');
    if (this.cache.bossKey !== key) {
      this.cache.bossKey = key;
      box.innerHTML = bosses.map((o) => `<div class="bar boss${o.elite ? ' elite' : ''}" data-id="${o.id}"><i></i><u></u><span></span></div>`).join('');
    }
    box.hidden = !bosses.length;
    bosses.forEach((o, i) => {
      const el = box.children[i];
      if (!el) return;
      el.firstElementChild.style.width = `${Math.max(0, o.hp / o.maxhp * 100).toFixed(1)}%`;
      el.children[1].style.width = `${(o.shield * 100).toFixed(1)}%`;
      el.classList.toggle('vuln', o.vuln);
      el.classList.toggle('ward', o.ward);
      const text = `${o.name}${o.rage ? ' · 狂暴' : ''}${o.vuln ? ' · 破防' : o.ward ? ' · 護罩' : ''}`;
      if (el.lastElementChild.textContent !== text) el.lastElementChild.textContent = text;
    });
  }

  setSlots(g) {
    const parts = [];
    for (const [k, lv] of Object.entries(g.weapons)) parts.push(`<div class="slot" title="${WEAPONS[k].name}">${WEAPONS[k].icon}<b>${lv}</b></div>`);
    for (const [k, lv] of Object.entries(g.petSkills)) parts.push(`<div class="slot pet" title="${PET[k].name}">${PET[k].icon}<b>${lv}</b></div>`);
    for (const [k, lv] of Object.entries(g.passives)) parts.push(`<div class="slot passive" title="${PASSIVES[k].name}">${PASSIVES[k].icon}<b>${lv}</b></div>`);
    for (const s of g.synergies) {
      const la = g.weapons[s.a] || 0; const lb = (s.pet ? g.petSkills : g.weapons)[s.b] || 0;
      if (la >= SYN_LV && lb >= SYN_LV) parts.push(`<div class="slot combo" title="${s.desc}" aria-label="${s.name}已啟動">⚡ ${s.name}</div>`);
      else if (la >= 1 || lb >= 1) parts.push(`<div class="slot combo pending" title="${s.desc}（${WEAPONS[s.a].name} Lv${la}／${(s.pet ? PET : WEAPONS)[s.b].name} Lv${lb}，各需 Lv${SYN_LV}）">⚡ ${s.name} ${Math.min(la, SYN_LV)}/${SYN_LV}・${Math.min(lb, SYN_LV)}/${SYN_LV}</div>`);
    }
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

  title(best, charId = 'phoebe') {
    this.showHud(false);
    this.screen.hidden = false;
    const ch = CHARACTERS[charId];
    const pet = charId === 'phrolova' ? 'reggie_open' : 'reggie_open';
    this.screen.innerHTML = `
      <div class="card-wrap">
        <div class="logo">菲比啾比<br>星光亂鬥 v1.4.1</div>
        <p class="sub">黎那汐塔・啟明廣場｜選擇角色，帶著瑞吉撐過十二分鐘，擊敗三位主線頭目。</p>
        <div class="chars" role="radiogroup" aria-label="選擇角色">${Object.values(CHARACTERS).map((c) => `
          <button type="button" class="char ${c.id === charId ? 'on' : ''}" data-char="${c.id}" role="radio" aria-checked="${c.id === charId}">
            <img src="./assets/${c.sprite}.png" alt="${c.name}">
            <b>${c.name}</b><small>${c.blurb}</small>
          </button>`).join('')}</div>
        <p class="sub kit">${ch.kit}</p>
        <div class="duo"><img src="./assets/${ch.sprite}.png" alt="${ch.name}"><img class="pet" src="./assets/${pet}.png" alt="海獅瑞吉"></div>
        <button type="button" class="screen-btn" id="go">開始 <small>(Enter)</small></button>
        <div class="tips">
          <div><b>移動</b> WASD／方向鍵，或在畫面上按住拖曳。攻擊會自動施放。左右鍵切換角色。</div>
          <div><b>${charId === 'phrolova' ? '樂章' : '祈願'}</b> ${charId === 'phrolova' ? '充滿後按 <b>Q</b> 召喚赫卡忒 15 秒：傷害 +25%、音符加倍，赫卡忒會自己揮鐮。' : '充滿後按 <b>Q 赦罪</b>（重擊／碎鏡爆發）或 <b>E 告解</b>（光噪疊 3 倍、持續傷害 ×1.6）。'}</div>
          <div><b>瑞吉</b> 負責控場：張嘴吼震退暈眩、環繞滑行繞著你撞擊敵人，最後回到身邊。小魚由你自己撿。</div>
          <div><b>頭目</b> 共六隻，各有機制：衝鋒撞牆破防、擊破共鳴柱、躲光束與扇區、打破護盾、熄燈破綻、擊碎噪卵。</div>
          <div><b>走位</b> 紅線、紅圈、紅色扇形與光束都是預警，離開就不會受傷。</div>
          <div>P／Esc 暫停　M 靜音　F 特效亮度　升級時按 1・2・3 選卡（★ 表示補齊連攜）</div>
        </div>
        <details class="skill-guide"><summary>${ch.name}技能圖鑑與連攜（v1.4）</summary>
          <p>以鳴潮機制改編為自動施法；以下是本作 Lv1 基礎數值，未含成長、被動、暴擊與形態加成。</p>
          ${Object.entries(WEAPONS).filter(([, w]) => (w.owner || 'phoebe') === charId).map(([k, w]) => `<article><b>${w.icon} ${w.name}</b><p>${w.desc}</p><small>${skillSummary(k, 1)}</small></article>`).join('')}
          ${SYNERGIES.filter((s) => (s.char || 'phoebe') === charId).map((s) => `<p><b>${s.name}</b>：${s.desc}</p>`).join('')}
        </details>
        ${best ? `<div class="best">最佳存活 ${fmt(best.time)}　擊殺 ${best.kills}</div>` : ''}
      </div>`;
    $('go').addEventListener('click', () => this.h.onStart());
    this.screen.querySelectorAll('.char').forEach((el) => el.addEventListener('click', () => this.h.onChar(el.dataset.char)));
  }

  levelup(level, cards) {
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <h2 class="title-h">升級！ Lv ${level}</h2>
        <p class="sub">數值為基礎傷害／冷卻；兩項各 Lv2 自動啟動連攜（標有 ★ 的卡能補齊連攜）。</p>
        <div class="cards">${cards.map((c, i) => `
          <button type="button" class="card ${c.kind || ''} ${c.isNew ? 'new' : ''}" data-i="${i}">
            <kbd>${i + 1}</kbd>
            <span class="ic">${c.icon}</span>
            <h3>${c.name}<em>${c.lv}</em>${c.synHint ? '<i class="syn-star">★連攜</i>' : ''}</h3>
            <span class="now">${c.now}</span>
            <p>${c.desc}</p>
          </button>`).join('')}</div>
      </div>`;
    this.screen.querySelectorAll('.card').forEach((el) => el.addEventListener('click', () => this.h.onPick(Number(el.dataset.i))));
    const first = this.screen.querySelector('.card');
    if (first) first.focus({ preventScroll: true });
  }

  pause(g) {
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <h2 class="title-h">暫停</h2>
        <button type="button" class="screen-btn" id="resume">繼續 <small>(P)</small></button>
        <button type="button" class="screen-btn ghost" id="quit">放棄這局</button>
        ${damageReport(g?.damageBySkill, g?.synergyDamage)}
      </div>`;
    $('resume').addEventListener('click', () => this.h.onResume());
    $('quit').addEventListener('click', () => this.h.onQuit());
  }

  end(win, st, best) {
    this.screen.hidden = false;
    this.screen.innerHTML = `
      <div class="card-wrap">
        <div class="logo" style="font-size:clamp(24px,4.6vw,44px)">${win ? '撐過來了！' : `${CHARACTERS[st.charId || 'phoebe'].name}倒下了…`}</div>
        <p class="sub">${win ? '失序的噪音退去，瑞吉開心地搖著尾巴。' : '瑞吉還在旁邊張著嘴，好像在說「再來一局啦」。'}</p>
        <div class="duo" style="height:clamp(90px,18vw,170px)"><img src="./assets/${CHARACTERS[st.charId || 'phoebe'].sprite}.png" alt=""><img class="pet" src="./assets/reggie_${win ? 'open' : 'closed'}.png" alt=""></div>
        <div class="stats">
          <div><b>${fmt(st.time)}</b><span>存活時間</span></div>
          <div><b>${st.kills}</b><span>擊殺</span></div>
          <div><b>Lv ${st.lvl}</b><span>等級</span></div>
          <div><b>${st.fish}</b><span>吃到的小魚</span></div>
        </div>
        ${damageReport(st.damageBySkill, st.synergyDamage)}
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
