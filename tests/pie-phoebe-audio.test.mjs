import test from 'node:test';
import assert from 'node:assert/strict';

test('chibi samples share a 12-second cooldown across normal, mode and win events', async () => {
  let context; let plays = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class AudioContext {
    constructor() { context = this; this.currentTime = 0; this.state = 'running'; }
    createGain() { return { gain: param(), connect() {} }; }
    createOscillator() { return { frequency: param(), connect() {}, start() {}, stop() {} }; }
    createBufferSource() { return { playbackRate: param(), connect() {}, start() { plays++; } }; }
    async decodeAudioData() { return { duration: 2 }; }
  }
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.window = { AudioContext };
  globalThis.fetch = async (url) => url.endsWith('.json')
    ? { json: async () => ({ chibi: ['sample'] }) }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  const audio = await import('../site/games/community/pie-phoebe/src/audio.js');
  await audio.prefetchSamples(); audio.unlock(); await Promise.resolve();
  audio.sfx('chibi', 0); assert.equal(plays, 1);
  context.currentTime = 4; audio.sfx('mode', 0); assert.equal(plays, 1);
  context.currentTime = 11.99; audio.sfx('chibi', 0); assert.equal(plays, 1);
  context.currentTime = 12; audio.sfx('win', 0); assert.equal(plays, 2, 'win also plays only one voice');
  context.currentTime = 13; audio.sfx('mode', 0); assert.equal(plays, 2);
  context.currentTime = 24; audio.sfx('mode', 0); assert.equal(plays, 3);
  audio.setMuted(true); context.currentTime = 40; audio.sfx('chibi', 0); assert.equal(plays, 3);
});
