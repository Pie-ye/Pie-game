// 極簡 WebAudio 合成音效（沒有音檔）。第一次互動後才會啟動。
let ac = null;
let master = null;
let muted = localStorage.getItem('pg-phoebe-mute') === '1';
const last = {};

function ensure() {
  if (ac) return ac;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ac = new Ctx();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.35;
  master.connect(ac.destination);
  return ac;
}

// 真實取樣：assets/audio/manifest.json 列出實際存在的檔案。
// chibi＝菲比團子的「菲比啾比」叫聲；reggie＝瑞吉的嗷嗷叫（目前清單是空的，用合成音代替）。
const raw = { chibi: [], reggie: [] };
const buffers = { chibi: [], reggie: [] };
let decoded = false;

/** 開機時先把檔案抓下來（不需要 AudioContext），第一次互動後才解碼。 */
export async function prefetchSamples() {
  try {
    const list = await (await fetch('./assets/audio/manifest.json')).json();
    await Promise.all(Object.keys(raw).flatMap((kind) => (list[kind] || []).map(async (n) => {
      const r = await fetch(`./assets/audio/${n}.mp3`);
      if (r.ok) raw[kind].push(await r.arrayBuffer());
    })));
  } catch { /* 沒有取樣就全部用合成音 */ }
}

function decodeSamples() {
  if (decoded || !ac) return;
  decoded = true;
  for (const kind of Object.keys(raw)) {
    for (const ab of raw[kind]) ac.decodeAudioData(ab.slice(0)).then((b) => buffers[kind].push(b)).catch(() => {});
  }
}

export function hasSample(kind) { return buffers[kind].length > 0; }

function sample(kind, { vol = 1, rate = 1, delay = 0 } = {}) {
  const list = buffers[kind];
  if (!ac || muted || !list.length) return false;
  const src = ac.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = rate * (0.97 + Math.random() * 0.08);
  const g = ac.createGain();
  g.gain.value = vol;
  src.connect(g); g.connect(master);
  src.start(ac.currentTime + delay);
  return true;
}

export function unlock() {
  const a = ensure();
  if (a && a.state === 'suspended') a.resume();
  decodeSamples();
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = v;
  localStorage.setItem('pg-phoebe-mute', v ? '1' : '0');
  if (master) master.gain.value = v ? 0 : 0.35;
}

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, vib = 0 } = {}) {
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  if (vib) {
    const l = ac.createOscillator(); const lg = ac.createGain();
    l.frequency.value = 28; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency);
    l.start(t0); l.stop(t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.2, freq = 1800, delay = 0 } = {}) {
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(); s.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = ac.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t0);
}

/** 一聲海獅吼：音高先衝高再下滑，通過帶通濾波做出「嗷」的母音感。 */
function bark(delay, f0, dur) {
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0 * 0.8, t0);
  o.frequency.linearRampToValueAtTime(f0 * 1.5, t0 + dur * 0.3);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + dur);
  const l = ac.createOscillator(); const lg = ac.createGain();
  l.frequency.value = 32; lg.gain.value = 18; l.connect(lg); lg.connect(o.frequency);
  const f = ac.createBiquadFilter();
  f.type = 'bandpass'; f.Q.value = 2.2;
  f.frequency.setValueAtTime(500, t0);
  f.frequency.linearRampToValueAtTime(950, t0 + dur * 0.4);
  f.frequency.linearRampToValueAtTime(600, t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(f); f.connect(g); g.connect(master);
  o.start(t0); l.start(t0); o.stop(t0 + dur + 0.05); l.stop(t0 + dur + 0.05);
}

const SOUNDS = {
  shoot: () => tone(880, 0.09, { type: 'triangle', vol: 0.08, slide: 500 }),
  hit: () => noise(0.05, { vol: 0.07, freq: 2400 }),
  kill: () => tone(300, 0.1, { type: 'square', vol: 0.05, slide: -160 }),
  fish: () => tone(1320, 0.07, { type: 'sine', vol: 0.1, slide: 440 }),
  hurt: () => { tone(160, 0.22, { type: 'sawtooth', vol: 0.22, slide: -80 }); noise(0.12, { vol: 0.15, freq: 600 }); },
  chibi: () => sample('chibi', { vol: 1.2 }),
  level: () => {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.1, delay: i * 0.07 }));
    sample('chibi', { vol: 1.1, delay: 0.25 });
  },
  beam: () => { tone(220, 0.4, { type: 'sawtooth', vol: 0.12, slide: 660 }); tone(880, 0.35, { type: 'sine', vol: 0.1, slide: 440 }); },
  echo: () => tone(300, 0.35, { type: 'sine', vol: 0.18, slide: -200 }),
  rain: () => tone(1400, 0.3, { type: 'sine', vol: 0.08, slide: -1000 }),
  boom: () => { noise(0.25, { vol: 0.2, freq: 500 }); tone(90, 0.25, { type: 'sine', vol: 0.25, slide: -50 }); },
  // 瑞吉的吼叫「嗷、嗷、嗷」：有取樣就播取樣，沒有就合成三聲帶共振峰的海獅吼
  roar: () => {
    if (sample('reggie', { vol: 1.3 })) return;
    [0, 0.2, 0.4].forEach((d, i) => bark(d, 215 - i * 12, 0.26 - i * 0.02));
    noise(0.5, { vol: 0.06, freq: 700 });
  },
  burp: () => tone(110, 0.35, { type: 'sawtooth', vol: 0.25, slide: -45, vib: 30 }),
  mode: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, { type: 'sine', vol: 0.1, delay: i * 0.05 })); sample('chibi', { vol: 1.2, rate: 1.05 }); },
  boss: () => { tone(70, 1.1, { type: 'sawtooth', vol: 0.3, slide: -20 }); tone(105, 1.1, { type: 'square', vol: 0.12, slide: -30 }); },
  win: () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.16, delay: i * 0.1 })); sample('chibi', { vol: 1.2, delay: 0.5 }); sample('chibi', { vol: 1.2, delay: 1.4, rate: 1.08 }); },
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.2, delay: i * 0.18 })),
};

export function sfx(name, minGap = 0.03) {
  if (!ac || muted) return;
  const now = performance.now() / 1000;
  if (last[name] && now - last[name] < minGap) return;
  last[name] = now;
  const f = SOUNDS[name];
  if (f) f();
}
