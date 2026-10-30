// 音效：背景音樂（Ninja Adventure 的 Village）、風聲環境音、隨機鳥叫、程式合成的腳步聲與聊天提示音。
// 瀏覽器要求使用者操作後才能出聲，所以全部在 unlock() 之後才啟動。
import { HEAR_DIST } from './logic.js';

const url = (n) => new URL(`../assets/audio/${n}`, import.meta.url).href;
const KEY = 'pie-plaza-audio';

export function createAudio() {
  let ctx = null, master = null, started = false, muted = false;
  const buffers = {};
  let music = null, birdTimer = null, lastStep = 0, stepFlip = false;
  try { muted = localStorage.getItem(KEY) === 'off'; } catch (_e) { /* 無痕模式 */ }

  async function load(name) {
    try {
      const res = await fetch(url(name));
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (err) { console.warn('音效載入失敗', name, err); }
  }
  function play(name, { gain = 0.5, rate = 1, pan = 0, loop = false } = {}) {
    const b = buffers[name];
    if (!ctx || !b) return null;
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = loop; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    let node = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
    src.connect(g); node.connect(master); src.start();
    return src;
  }
  function birds() {
    if (!ctx) return;
    if (!muted && ctx.state === 'running') play('bird.wav', { gain: 0.16 + Math.random() * 0.12, rate: 0.85 + Math.random() * 0.5, pan: Math.random() * 2 - 1 });
    birdTimer = setTimeout(birds, 5000 + Math.random() * 11000);
  }

  /** 在使用者的點擊／按鍵事件裡呼叫。第一次會建立並載入全部音訊。 */
  function unlock() {
    if (!started) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      started = true;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
      music = new Audio(url('village.ogg')); music.loop = true; music.volume = 0.32;
      const src = ctx.createMediaElementSource(music); src.connect(master);
      Promise.all(['wind.wav', 'bird.wav', 'send.wav', 'recv.wav', 'join.wav'].map(load)).then(() => {
        play('wind.wav', { gain: 0.35, loop: true });
        birdTimer = setTimeout(birds, 2500);
      });
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (music && music.paused) music.play().catch(() => {});
  }

  /** 腳步聲：短促的帶通雜訊，左右腳音高略不同；dist 是與聆聽者的距離（像素）。 */
  function step(now, dist = 0, pan = 0) {
    if (muted || !ctx || ctx.state !== 'running' || dist > HEAR_DIST) return;
    const t = ctx.currentTime, len = 0.07;
    const n = Math.floor(ctx.sampleRate * len), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; stepFlip = !stepFlip; f.frequency.value = (stepFlip ? 820 : 640) * (0.92 + Math.random() * 0.16); f.Q.value = 0.9;
    const g = ctx.createGain(); g.gain.value = 0.55 * (1 - dist / HEAR_DIST) ** 1.5;
    src.connect(f); f.connect(g);
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); } else g.connect(master);
    src.start(t);
  }
  /** 工具聲：kind 為 chop（斧頭）、pick（十字鎬）、swish（鐮刀）、dig（鋤頭）、water、plant、break（敲碎）。 */
  function tool(kind) {
    if (muted || !ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const noise = (len, f0, f1, q, gain, type = 'bandpass') => {
      const n = Math.floor(ctx.sampleRate * len), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.6);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(master); src.start(t);
    };
    const tone = (f0, f1, len, gain, type = 'triangle') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + len);
    };
    if (kind === 'chop') { noise(0.12, 500, 200, 1.2, 0.9); tone(180, 90, 0.1, 0.35); }
    else if (kind === 'pick') { noise(0.08, 2600, 1800, 3, 0.6); tone(1400, 900, 0.12, 0.18, 'square'); }
    else if (kind === 'swish') noise(0.16, 900, 3500, 0.8, 0.5);
    else if (kind === 'dig') noise(0.14, 400, 160, 0.9, 0.9, 'lowpass');
    else if (kind === 'water') { noise(0.35, 1200, 600, 0.6, 0.45); tone(600, 900, 0.2, 0.05, 'sine'); }
    else if (kind === 'plant') { tone(520, 780, 0.12, 0.12, 'sine'); }
    else if (kind === 'break') { noise(0.22, 1200, 300, 0.7, 0.8); tone(260, 120, 0.2, 0.2); }
    else if (kind === 'harvest') { tone(660, 990, 0.1, 0.12, 'square'); setTimeout(() => tone(990, 1320, 0.12, 0.1, 'square'), 90); }
    else if (kind === 'nope') tone(220, 180, 0.12, 0.12, 'square');
    else if (kind === 'door') { noise(0.18, 300, 150, 1, 0.5, 'lowpass'); }
    else if (kind === 'talk') tone(880, 880, 0.04, 0.06, 'square');
  }

  /** 自己走路時依時間節流：回傳是否該響。 */
  function stepDue(now, gapMs = 280) { if (now - lastStep < gapMs) return false; lastStep = now; return true; }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem(KEY, m ? 'off' : 'on'); } catch (_e) { /* 略過 */ }
    if (master) master.gain.value = m ? 0 : 1;
  }
  return {
    unlock, step, stepDue, setMuted, tool,
    get muted() { return muted; },
    sent() { play('send.wav', { gain: 0.35 }); },
    received() { play('recv.wav', { gain: 0.3 }); },
    joined() { play('join.wav', { gain: 0.3 }); },
    stop() { clearTimeout(birdTimer); if (music) music.pause(); if (ctx) ctx.close().catch(() => {}); },
  };
}
