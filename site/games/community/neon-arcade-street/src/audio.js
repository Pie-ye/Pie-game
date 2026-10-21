// 全程式合成的音效：雨聲、腳步、霓虹低鳴，以及慢速 synthwave 配樂。不需任何音檔。

export function createAudio() {
  let ctx = null, master, musicBus, sfxBus, rainGain, started = false, muted = false, musicOn = true;
  let nextBeat = 0, beat = 0, timer = 0;
  const A = (f) => 440 * Math.pow(2, (f - 69) / 12);
  const CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 66]]; // Am7 Fmaj7 Cmaj7 G

  function noiseBuf(sec) {
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function impulse(sec, decay) {
    const b = ctx.createBuffer(2, ctx.sampleRate * sec, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    }
    return b;
  }
  function start() {
    if (started) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    started = true;
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.5 : 0;
    const verb = ctx.createConvolver(); verb.buffer = impulse(2.4, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    musicBus.connect(master); musicBus.connect(verb); verb.connect(wet); wet.connect(master);
    // 雨聲
    const rn = ctx.createBufferSource(); rn.buffer = noiseBuf(3); rn.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    rainGain = ctx.createGain(); rainGain.gain.value = 0.07;
    rn.connect(bp); bp.connect(hp); hp.connect(rainGain); rainGain.connect(master); rn.start();
    // 霓虹低鳴
    const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 100;
    const hg = ctx.createGain(); hg.gain.value = 0.012; hum.connect(hg); hg.connect(master); hum.start();
    nextBeat = ctx.currentTime + 0.2;
    timer = setInterval(schedule, 120);
  }
  function tone(type, freq, t, dur, vol, dest, lp) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let n = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); f.frequency.exponentialRampToValueAtTime(Math.max(120, lp * 0.25), t + dur); o.connect(f); n = f; }
    n.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function schedule() {
    if (!ctx) return;
    const spb = 60 / 92 / 2; // 八分音符
    while (nextBeat < ctx.currentTime + 0.4) {
      const bar = Math.floor(beat / 8) % 4, step = beat % 8, chord = CHORDS[bar];
      if (step === 0) { // 鋪底和弦
        for (const n of chord) { tone('sawtooth', A(n - 12) * 1.003, nextBeat, spb * 8.2, 0.025, musicBus, 700); tone('sawtooth', A(n - 12) * 0.997, nextBeat, spb * 8.2, 0.025, musicBus, 700); }
      }
      if (step % 2 === 0) tone('sawtooth', A(chord[0] - 24), nextBeat, spb * 1.8, 0.11, musicBus, 420);
      const arp = [0, 2, 1, 3, 2, 1, 3, 2][step];
      tone('triangle', A(chord[arp] + 12), nextBeat, spb * 1.5, 0.07, musicBus, 3200);
      if (step === 0 || step === 4) { // 底鼓
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(130, nextBeat); o.frequency.exponentialRampToValueAtTime(40, nextBeat + 0.15);
        g.gain.setValueAtTime(0.28, nextBeat); g.gain.exponentialRampToValueAtTime(0.001, nextBeat + 0.2);
        o.connect(g); g.connect(musicBus); o.start(nextBeat); o.stop(nextBeat + 0.25);
      }
      if (step % 2 === 1) { // 細碎的 hi-hat
        const s = ctx.createBufferSource(); s.buffer = noiseBuf(0.05);
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = ctx.createGain(); g.gain.value = 0.05;
        s.connect(f); f.connect(g); g.connect(musicBus); s.start(nextBeat);
      }
      nextBeat += spb; beat++;
    }
  }
  function step(run, wet) {
    if (!ctx) return;
    const t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = noiseBuf(0.12);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = (wet ? 1700 : 900) * (0.85 + Math.random() * 0.3);
    const g = ctx.createGain(); g.gain.setValueAtTime(run ? 0.16 : 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t);
  }
  function landed() { step(true, true); }
  return {
    start, step, landed,
    toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.8; return muted; },
    toggleMusic() { musicOn = !musicOn; if (musicBus) musicBus.gain.value = musicOn ? 0.5 : 0; return musicOn; },
    setRain(on) { if (rainGain) rainGain.gain.value = on ? 0.07 : 0.0; },
    get muted() { return muted; }, get musicOn() { return musicOn; },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  };
}
