// 程式合成的聲音：海浪、偶爾的鳥叫、輕快的木琴小調，以及跳躍與表情的提示音。
// 不用音檔；要等使用者第一次點擊後才能開始（瀏覽器規定）。

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];            // 大調五聲音階
const CHORDS = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];   // I vi IV V
const BPM = 96;

export function createAudio() {
  let ctx = null, master, sfxGain, musicGain, ambGain, timer = 0, beat = 0, nextAt = 0;
  const state = { sfx: true, music: true };

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.7; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.32; musicGain.connect(master);
    ambGain = ctx.createGain(); ambGain.gain.value = 0.5; ambGain.connect(master);
    waves();
    nextAt = ctx.currentTime + 0.2;
    timer = setInterval(schedule, 120);
  }

  function waves() {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.985 * b + 0.015 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); g.gain.value = 0.25;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(ambGain);
    src.start(); lfo.start();
  }

  function pluck(t, semis, dur = 0.5, vol = 0.22, type = 'triangle', dest = musicGain) {
    const f = 392 * Math.pow(2, semis / 12);
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g); g.connect(dest);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  function chirp(t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    const g = ctx.createGain();
    const base = 2400 + Math.random() * 1400;
    for (let i = 0; i < 3; i++) {
      o.frequency.setValueAtTime(base, t + i * 0.12);
      o.frequency.exponentialRampToValueAtTime(base * 1.5, t + i * 0.12 + 0.06);
    }
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) { g.gain.linearRampToValueAtTime(0.05, t + i * 0.12 + 0.02); g.gain.linearRampToValueAtTime(0, t + i * 0.12 + 0.08); }
    o.connect(g).connect(ambGain);
    o.start(t); o.stop(t + 0.45);
  }

  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const spb = 60 / BPM / 2;       // 八分音符
    while (nextAt < ctx.currentTime + 0.4) {
      const bar = Math.floor(beat / 8) % CHORDS.length, pos = beat % 8;
      const chord = CHORDS[bar];
      if (state.music) {
        if (pos === 0) chord.forEach((n) => pluck(nextAt, n - 12, 1.6, 0.07, 'sine'));
        if (pos === 0 || pos === 3 || pos === 6) pluck(nextAt, chord[0] - 24, 0.5, 0.12, 'sine');
        // 旋律：偶數拍多半有音，順著和弦走
        if (pos % 2 === 0 || Math.random() < 0.3) {
          const n = Math.random() < 0.6 ? chord[Math.floor(Math.random() * 3)] + 12 : SCALE[Math.floor(Math.random() * SCALE.length)];
          if (Math.random() < 0.85) pluck(nextAt, n, 0.45, 0.13);
        }
      }
      if (Math.random() < 0.012) chirp(nextAt);
      nextAt += spb; beat++;
    }
  }

  const blip = (notes, vol = 0.18, gap = 0.07) => {
    if (!ctx || !state.sfx) return;
    const t = ctx.currentTime;
    notes.forEach((n, i) => pluck(t + i * gap, n, 0.25, vol, 'square', sfxGain));
  };

  return {
    state,
    start() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    toggleSfx() { state.sfx = !state.sfx; if (ambGain) ambGain.gain.value = state.sfx ? 0.5 : 0; return state.sfx; },
    toggleMusic() { state.music = !state.music; return state.music; },
    jump() { blip([7, 12], 0.06, 0.05); },
    emote() { blip([12, 16, 19], 0.06, 0.06); },
    ui() { blip([16], 0.05); },
    hello() { blip([7, 12, 16, 19], 0.05, 0.08); },
    stop() { clearInterval(timer); if (ctx) ctx.close(); ctx = null; },
  };
}
