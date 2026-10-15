// Synthesised sound effects and a wind bed (no audio files, so nothing to license or download).
let ctx = null, master = null, muted = false, wind = null, windGain = null, noiseBuf = null;
export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  wind = ctx.createBufferSource(); wind.buffer = noiseBuf; wind.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.6;
  windGain = ctx.createGain(); windGain.gain.value = 0.0; wind.connect(f); f.connect(windGain); windGain.connect(master); wind.start();
}
export function toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; }
export function setWind(v) { if (windGain) windGain.gain.value = Math.min(0.25, v * 0.25); }
function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, attack = 0.005 } = {}) {
  if (!ctx) return; const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { vol = 0.3, freq = 1200, q = 0.8, type = 'bandpass', delay = 0, slide = 0 } = {}) {
  if (!ctx) return; const t = ctx.currentTime + delay, s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur); f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
const S = {
  jump: () => { tone(280, 0.16, { slide: 260, vol: 0.18, type: 'triangle' }); },
  land: (v = 1) => { noise(0.18, { vol: 0.35 * v, freq: 300, type: 'lowpass' }); tone(80, 0.15, { vol: 0.3 * v, slide: -30 }); },
  attach: () => { noise(0.07, { vol: 0.22, freq: 2400 }); tone(180, 0.08, { vol: 0.12, type: 'square' }); },
  climb: () => { noise(0.05, { vol: 0.12, freq: 2800 + Math.random() * 800, q: 2 }); },
  lunge: () => { noise(0.25, { vol: 0.2, freq: 600, slide: 1600 }); tone(220, 0.2, { slide: 320, vol: 0.12, type: 'sawtooth' }); },
  mantle: () => { noise(0.15, { vol: 0.2, freq: 900 }); },
  pickup: () => { tone(660, 0.1, { vol: 0.2 }); tone(990, 0.16, { vol: 0.2, delay: 0.08 }); },
  use: () => { tone(520, 0.08, { vol: 0.16, type: 'square' }); tone(780, 0.1, { vol: 0.14, type: 'square', delay: 0.06 }); },
  hurt: () => { tone(200, 0.3, { type: 'sawtooth', slide: -140, vol: 0.28 }); noise(0.2, { vol: 0.3, freq: 700 }); },
  exhausted: () => { tone(320, 0.4, { type: 'triangle', slide: -200, vol: 0.2 }); },
  toast: () => {},
  luggage: () => { noise(0.12, { vol: 0.25, freq: 900 }); tone(420, 0.12, { vol: 0.14, type: 'triangle', delay: 0.05 }); tone(840, 0.16, { vol: 0.16, delay: 0.12 }); },
  shrine: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.7, { vol: 0.2, delay: i * 0.12 })); },
  biome: () => { [392, 494, 587].forEach((f, i) => tone(f, 1.2, { vol: 0.16, delay: i * 0.18, type: 'triangle' })); },
  geyser: () => { noise(0.9, { vol: 0.35, freq: 500, slide: 1400 }); },
  rumble: () => { noise(1.0, { vol: 0.3, freq: 120, type: 'lowpass' }); tone(55, 1.0, { vol: 0.3, type: 'sawtooth' }); },
  smash: () => { noise(0.25, { vol: 0.3, freq: 500, type: 'lowpass' }); },
  explode: () => { noise(0.9, { vol: 0.55, freq: 220, type: 'lowpass' }); tone(60, 0.7, { vol: 0.5, slide: -30 }); },
  snap: () => { noise(0.08, { vol: 0.35, freq: 2000 }); tone(150, 0.15, { type: 'square', vol: 0.25 }); },
  sting: () => { tone(900, 0.08, { type: 'sawtooth', vol: 0.12 }); },
  fuse: () => { noise(0.5, { vol: 0.2, freq: 3000, q: 3 }); },
  faint: () => { tone(300, 1.2, { slide: -240, type: 'triangle', vol: 0.3 }); },
  revive: () => { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, { vol: 0.22, delay: i * 0.09 })); },
  win: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.45, { vol: 0.24, delay: i * 0.14, type: 'triangle' })); },
  grapple: () => { noise(0.2, { vol: 0.3, freq: 3000, slide: -2000 }); tone(140, 0.25, { vol: 0.3, type: 'square' }); },
  glide: () => { noise(0.3, { vol: 0.2, freq: 900, slide: 500 }); },
  dart: () => { noise(0.1, { vol: 0.2, freq: 3500, q: 3 }); },
  reggie: () => { for (let i = 0; i < 3; i++) { tone(300 + i * 20, 0.2, { type: 'sawtooth', vol: 0.16, slide: -90, delay: i * 0.22 }); tone(640, 0.18, { type: 'square', vol: 0.05, slide: -200, delay: i * 0.22 }); } },
  rustle: () => { noise(0.5, { vol: 0.15, freq: 2500, q: 0.5 }); },
  bounce: () => { tone(200, 0.3, { slide: 500, vol: 0.25, type: 'triangle' }); },
  launch: () => { noise(0.4, { vol: 0.3, freq: 400, slide: 2000 }); },
  click: () => { tone(900, 0.04, { vol: 0.1, type: 'square' }); },
  badge: () => { tone(880, 0.12, { vol: 0.2 }); tone(1320, 0.3, { vol: 0.2, delay: 0.1 }); },
};
let last = {};
export function play(name, arg) {
  if (!ctx || muted) return;
  const now = performance.now(); if (last[name] && now - last[name] < 60) return; last[name] = now;
  try { S[name]?.(arg); } catch { /* ignore audio errors */ }
}
