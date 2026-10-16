/**
 * 城市與開機畫面用的小音效（WebAudio 現場合成，沒有音檔）。
 * 瀏覽器要使用者操作過才會出聲，所以第一次 sfx() 才建立 AudioContext；失敗就靜音，不影響畫面。
 * 背景節奏是 110 BPM 的四拍子，預設關閉，由城市右上角的按鈕開。
 */
const KEY = 'pg_city_sound';
const MUSIC_KEY = 'pg_city_music';
export const BPM = 110;

let ctx = null;
let master = null;
let muted = false;
let musicOn = false;
let musicPref = false;
let cityActive = false;
let musicTimer = null;
let nextBeat = 0;
let beatNo = 0;

try {
  muted = localStorage.getItem(KEY) === 'off';
  musicPref = localStorage.getItem(MUSIC_KEY) === 'on';
} catch (_) {
  muted = false;
  musicPref = false;
}

function audio() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  } catch (_) {
    ctx = null;
  }
  return ctx;
}

function tone(freq, start, dur, { type = 'square', gain = 0.2, slideTo = null } = {}) {
  const c = audio();
  if (!c) return;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function noise(start, dur, gain = 0.15, highpass = 6000) {
  const c = audio();
  if (!c) return;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpass;
  const amp = c.createGain();
  amp.gain.setValueAtTime(gain, start);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(amp).connect(master);
  src.start(start);
}

const SFX = {
  // 站到門前：兩個上行的短音
  near: (t) => { tone(660, t, 0.07, { gain: 0.12 }); tone(990, t + 0.07, 0.09, { gain: 0.12 }); },
  step: (t) => noise(t, 0.04, 0.05, 2500),
  // 開機：低頻嗡一聲＋電子管亮起的高頻
  power: (t) => { tone(55, t, 0.5, { type: 'sawtooth', gain: 0.35, slideTo: 110 }); noise(t, 0.25, 0.12, 3000); },
  blip: (t) => tone(1200, t, 0.05, { gain: 0.1 }),
  load: (t) => { tone(440, t, 0.06, { gain: 0.1 }); tone(880, t + 0.06, 0.06, { gain: 0.1 }); },
  chime: (t) => { [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.22, { type: 'triangle', gain: 0.22 })); },
  off: (t) => tone(900, t, 0.25, { type: 'sawtooth', gain: 0.18, slideTo: 40 }),
};

export function sfx(name) {
  if (muted) return;
  const c = audio();
  if (!c || !SFX[name]) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  SFX[name](c.currentTime + 0.005);
}

function scheduleMusic() {
  const c = audio();
  if (!c || !musicOn || muted) return;
  const spb = 60 / BPM;
  while (nextBeat < c.currentTime + 0.4) {
    const bar = beatNo % 4;
    // 踢鼓在 1、3 拍，拍手在 2、4 拍，反拍有 hi-hat，低音走一個簡單的小調。
    if (bar === 0 || bar === 2) tone(120, nextBeat, 0.16, { type: 'sine', gain: 0.5, slideTo: 40 });
    else noise(nextBeat, 0.1, 0.18, 1800);
    noise(nextBeat + spb / 2, 0.04, 0.07, 7000);
    const bass = [55, 55, 65.4, 49][Math.floor(beatNo / 4) % 4];
    tone(bass * 2, nextBeat, spb * 0.45, { type: 'sawtooth', gain: 0.09 });
    tone(bass * 2, nextBeat + spb / 2, spb * 0.3, { type: 'sawtooth', gain: 0.06 });
    nextBeat += spb;
    beatNo += 1;
  }
}

export function setMusic(on) {
  musicOn = Boolean(on);
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  if (!musicOn) return;
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  nextBeat = c.currentTime + 0.05;
  beatNo = 0;
  musicTimer = setInterval(scheduleMusic, 120);
  scheduleMusic();
}

export function isMuted() {
  return muted;
}

function syncMusic() {
  setMusic(cityActive && musicPref && !muted);
}

export function setMuted(value) {
  muted = Boolean(value);
  try {
    localStorage.setItem(KEY, muted ? 'off' : 'on');
  } catch (_) {
    /* ignore */
  }
  syncMusic();
}

export function isMusicPref() {
  return musicPref;
}

/** 節奏音樂偏好（選單開關）；只有在城市裡才會真的播。 */
export function setMusicPref(on) {
  musicPref = Boolean(on);
  try {
    localStorage.setItem(MUSIC_KEY, musicPref ? 'on' : 'off');
  } catch (_) {
    /* ignore */
  }
  syncMusic();
}

/** 城市掛上／拆掉時呼叫：離開城市就停掉節奏（音效不用停）。 */
export function setCityActive(active) {
  cityActive = Boolean(active);
  syncMusic();
}

/** 瀏覽器要使用者操作過才准出聲：第一次按鍵或點擊時把 AudioContext 叫醒。 */
export function unlockAudio() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
