import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/startup.js', import.meta.url), 'utf8');
const drain = () => new Promise(resolve => setImmediate(resolve));

function simulateStartup() {
  class Image {
    complete = false;
    listeners = new Map();
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    settle(type) { this.complete = true; this.listeners.get(type)?.(); }
  }
  const logo = Object.assign(new Image(), { complete: true, naturalWidth: 200 });
  const screen = { hidden: true, querySelector: () => logo };
  const root = { dataset: {} }, window = {};
  const timers = new Map(), frames = [];
  let serial = 0;
  vm.runInNewContext(source, { window, Image, document: { documentElement: root, querySelector: () => screen },
    requestAnimationFrame: frame => frames.push(frame),
    setTimeout(callback, delay) { timers.set(++serial, { callback, delay }); return serial; },
    clearTimeout(id) { timers.delete(id); } });
  const run = delay => {
    const [id, timer] = [...timers].find(([, timer]) => timer.delay === delay);
    timers.delete(id);
    timer.callback();
  };
  const frame = () => frames.shift()();
  return { window, screen, root, timers, Image, run, frame };
}

test('the ready first screen skips the splash and has no minimum wait', () => {
  const ui = simulateStartup();
  let revealed = false;
  ui.window.gameStartup.whenReady(() => { revealed = true; });
  ui.window.gameStartup.complete(null, []);
  assert.equal(revealed, true);
  assert.equal(ui.screen.hidden, true);
  assert.equal(ui.root.dataset.gameStartup, undefined);
  assert.equal(ui.timers.size, 0);
});

test('a displayed splash holds for one second even if its pending image finishes sooner', async () => {
  const ui = simulateStartup();
  const image = new ui.Image();
  ui.window.gameStartup.complete(image, []);
  ui.run(120);
  ui.frame();
  assert.equal(ui.screen.hidden, false);
  ui.frame();
  image.settle('load');
  await drain();
  assert.equal(ui.screen.hidden, false);
  ui.run(1000);
  await drain();
  assert.equal(ui.screen.hidden, true);
  assert.equal(ui.root.dataset.gameStartup, undefined);
});

test('a slow first-screen image keeps the splash open past its minimum and can fail without blocking startup', async () => {
  const ui = simulateStartup();
  const image = new ui.Image();
  ui.window.gameStartup.complete(image, []);
  ui.run(120);
  ui.frame();
  ui.frame();
  ui.run(1000);
  await drain();
  assert.equal(ui.screen.hidden, false);
  assert.equal(ui.timers.size, 0);
  image.settle('error');
  await drain();
  assert.equal(ui.screen.hidden, true);
  assert.equal(ui.root.dataset.gameStartup, undefined);
});
