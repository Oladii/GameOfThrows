import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TableKnockSequence, TableKnocks, tableKnockFieldHull, tableKnockInsideField } from '../dist/table-knocks.js';
import { GameAudio, GAME_MASTER_GAIN, GAME_SOUND_PROFILES } from '../dist/audio.js';
import { GAME_AUDIO_ASSETS } from '../dist/audio-assets.js';

test('a pair of clicks within 400ms completes the gesture and resets for the next pair', () => {
  const sequence = new TableKnockSequence();
  assert.deepEqual([0, 400, 401].map(now => sequence.hit(now)), [1, 2, 1]);
  sequence.reset();
  assert.deepEqual([0, 401, 800].map(now => sequence.hit(now)), [1, 1, 2]);
  sequence.reset();
  assert.deepEqual([0, 900, 1800].map(now => sequence.hit(now)), [1, 1, 1], 'separate single clicks do not shake the table');
  assert.equal(sequence.hit(500), 1, 'a backwards clock starts a new sequence');
});

test('field geometry includes edges and gaps, while empty SVG corners count as table', () => {
  const hull = tableKnockFieldHull([
    { x: -10, y: 0 }, { x: -5, y: -10 }, { x: 5, y: -10 },
    { x: 10, y: 0 }, { x: 5, y: 10 }, { x: -5, y: 10 },
    { x: 0, y: 0 }, { x: -10, y: 0 }
  ]);
  for (const point of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 }]) assert.equal(tableKnockInsideField(point, hull), true);
  for (const point of [{ x: 9, y: -9 }, { x: 11, y: 0 }, { x: 0, y: -11 }]) assert.equal(tableKnockInsideField(point, hull), false);
  assert.equal(tableKnockInsideField({ x: 100, y: 100 }, []), true, 'no knocks before field markup exists');
});

function tableHarness() {
  const listeners = new Map();
  const events = {
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const doc = { ...events, defaultView: events };
  const vertices = [{ x: -10, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }];
  const board = {
    getScreenCTM: () => ({ inverse: () => ({}) }),
    createSVGPoint: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
    querySelectorAll: () => [{ points: { numberOfItems: vertices.length, getItem: i => vertices[i] } }]
  };
  let time = 0, allowed = true;
  const calls = [], shakes = [];
  const surface = { ownerDocument: doc, contains: target => !target.outside };
  const controller = new TableKnocks({ surface, board, audio: { play: name => calls.push({ name, time }) }, canKnock: () => allowed,
    onShake: () => shakes.push(time), now: () => time });
  const emit = (type, options = {}) => {
    const event = {
      type, button: 0, detail: type === 'click' ? 1 : 0, isPrimary: true, clientX: 20, clientY: 0,
      target: { closest: () => null },
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.consumed = true; }, ...options
    };
    listeners.get(type)?.(event);
    return event;
  };
  return { controller, calls, shakes, listeners, press: options => emit('pointerdown', options),
    release: options => emit('click', options), cancel: () => emit('pointercancel'),
    tick: value => { time = value; }, allow: value => { allowed = value; } };
}

test('press plays each hit immediately, and release never replays it or resets the pair', () => {
  const h = tableHarness();
  assert.equal(h.press().defaultPrevented, true);
  assert.deepEqual(h.calls, [{ name: 'knock1', time: 0 }]); assert.deepEqual(h.shakes, []);
  h.tick(150); assert.equal(h.release().consumed, true);
  assert.deepEqual(h.calls, [{ name: 'knock1', time: 0 }], 'release has no extra hit');
  h.tick(300); assert.equal(h.press().defaultPrevented, true);
  assert.deepEqual(h.calls, [{ name: 'knock1', time: 0 }, { name: 'knock3', time: 300 }, { name: 'scatter', time: 300 }]);
  assert.deepEqual(h.shakes, [300], 'visual effect starts on the second click');
  h.release(); assert.equal(h.calls.length, 3);
  h.tick(301); h.press(); h.release();
  assert.equal(h.calls.length, 4, 'third click starts a new pair with the quiet hit');
  assert.deepEqual(h.calls.at(-1), { name: 'knock1', time: 301 });
  h.controller.reset();
  h.tick(1000); h.press(); h.release(); h.tick(1401); h.press(); h.release();
  assert.deepEqual(h.calls.slice(-2), [{ name: 'knock1', time: 1000 }, { name: 'knock1', time: 1401 }]);
  assert.equal(h.shakes.length, 1, 'clicks more than 400ms apart only play quiet hits');
});

test('field, controls, secondary pointers, right presses and inactive game states never knock and reset the series', () => {
  const h = tableHarness();
  const invalid = [
    { clientX: 0 },
    { target: { closest: () => ({}) } },
    { target: { outside: true, closest: () => null } },
    { isPrimary: false }, { button: 2 }, { defaultPrevented: true }
  ];
  for (const options of invalid) {
    h.press(); const before = h.calls.length;
    assert.equal(h.press(options).consumed, undefined);
    assert.equal(h.calls.length, before);
    h.press(); assert.equal(h.calls.length, before + 1, 'first press after a reset plays the quiet hit');
    assert.equal(h.calls.at(-1).name, 'knock1');
    assert.equal(h.shakes.length, 0);
    h.controller.reset();
  }
  h.allow(false); const before = h.calls.length; h.press(); assert.equal(h.calls.length, before);
  h.allow(true); h.press(); assert.equal(h.calls.length, before + 1); assert.equal(h.calls.at(-1).name, 'knock1'); assert.equal(h.shakes.length, 0);
  h.controller.destroy(); assert.equal(h.listeners.size, 0);
});

test('keyboard clicks, cancelled presses and later unrelated clicks are not swallowed or replayed', () => {
  const h = tableHarness();
  assert.equal(h.release({ detail: 0 }).consumed, undefined); assert.equal(h.calls.length, 0);
  h.press(); h.cancel();
  assert.equal(h.release().consumed, undefined);
  h.press(); assert.equal(h.calls.at(-1).name, 'knock1', 'cancel resets the pair');
  assert.equal(h.release().consumed, true);
  assert.equal(h.release().consumed, undefined, 'only the matching release click is consumed');
  h.press();
  h.press({ target: { outside: true, closest: () => null } });
  assert.equal(h.release().consumed, undefined, 'a later pointer press clears suppression');
  h.controller.destroy();
  const before = h.calls.length; h.press(); h.release(); assert.equal(h.calls.length, before);
});

test('approved PCM cues play on a cold first gesture without waiting for other audio decoding or extra EQ', () => {
  const starts = [], gains = [];
  let contexts = 0;
  const context = {
    state: 'running', currentTime: 0, destination: {},
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { duration: length / sampleRate, sampleRate, length, numberOfChannels: channels, getChannelData: i => data[i] };
    },
    // Ordinary sounds can still be loading when the first knock is played.
    decodeAudioData: () => new Promise(() => {}),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() { starts.push(this.buffer); }, stop() {} }),
    createBiquadFilter: () => { throw new Error('approved knocks must not receive more EQ'); },
    createGain: () => ({ connect() {}, disconnect() {}, gain: {
      setValueAtTime: value => gains.push(value), cancelScheduledValues() {}, setTargetAtTime() {}
    } })
  };
  const audio = new GameAudio({ createContext: () => { contexts++; return context; }, storage: () => null, hidden: () => false, now: () => 0 });
  for (const name of ['knock1', 'knock2', 'knock3', 'scatter']) {
    audio.play(name);
    const expectedGain = { knock1: .25, knock2: .5, knock3: 1, scatter: 1 }[name];
    assert.equal(starts.at(-1), audio.buffers[name]);
    assert.equal(gains.at(-1), expectedGain, 'default volume follows the latest approved balance');
    assert.equal(GAME_SOUND_PROFILES[name].gain * GAME_MASTER_GAIN, expectedGain);
    assert.deepEqual(Buffer.from(GAME_AUDIO_ASSETS[name].split(',')[1], 'base64'), fs.readFileSync(new URL(`../dist/audio/${name}.wav`, import.meta.url)));
  }
  assert.equal(starts.length, 4); assert.equal(contexts, 1);
  audio.setVolume(.25); audio.play('knock1'); assert.equal(gains.at(-1), .125);
  audio.setVolume(0); const before = starts.length; audio.play('knock3'); audio.play('scatter'); assert.equal(starts.length, before);
});
