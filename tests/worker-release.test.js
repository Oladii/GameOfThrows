import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { createGame, move } from '../dist/engine.js';

const client = fs.readFileSync(new URL('../dist/bot-client.js', import.meta.url), 'utf8')
  .replaceAll('export ', '').replaceAll('import.meta.url', '"https://example.test/bot-client.js"');
function setup({ embedded = true, fail = false } = {}) {
  const revoked = [], workers = [];
  class BrowserWorker {
    constructor(url, options) {
      if (fail) throw new Error('creation failed');
      this.url = url; this.options = options; this.terminated = 0; workers.push(this);
    }
    terminate() { this.terminated++; }
    postMessage(request) { this.request = request; }
  }
  class TestURL extends URL {}
  TestURL.createObjectURL = () => 'blob:test';
  TestURL.revokeObjectURL = url => revoked.push(url);
  const context = vm.createContext({ Worker: BrowserWorker, URL: TestURL, Blob,
    document: { querySelector: () => embedded ? { textContent: '"self.onmessage = () => {};"' } : null },
    setTimeout, clearTimeout });
  vm.runInContext(client, context);
  return { context, workers, revoked };
}
const direct = setup();
const worker = direct.context.createBotWorker();
assert.equal(worker.options, undefined);
assert.deepEqual(direct.revoked, []);
worker.terminate(); worker.terminate();
assert.deepEqual(direct.revoked, ['blob:test']);
const failed = setup({ fail: true });
assert.throws(() => failed.context.createBotWorker(), /creation failed/);
assert.deepEqual(failed.revoked, ['blob:test']);
const module = setup({ embedded: false });
assert.equal(module.context.createBotWorker().options.type, 'module');
for (const failure of [false, true]) {
  const ui = setup(), runner = vm.runInContext('new BotRunner()', ui.context);
  let result, error;
  runner.run({ state: {} }, value => result = value, value => error = value);
  const active = ui.workers[0];
  if (failure) active.onerror({ preventDefault() {} });
  else active.onmessage({ data: { id: active.request.id, result: { action: 'ok' } } });
  assert.equal(runner.active, false);
  assert.equal(active.terminated, 1);
  assert.deepEqual(ui.revoked, ['blob:test']);
  assert.equal(failure ? Boolean(error) : result.action === 'ok', true);
}
const html = fs.readFileSync(new URL('../Lamps.html', import.meta.url), 'utf8');
const source = JSON.parse(html.match(/<script id="bot-worker-source" type="application\/json">([\s\S]*?)<\/script>/)[1]);
assert.doesNotMatch(source, /^\s*(import|export)\s/m);
assert.doesNotMatch(html, /class="attack-ray-label"/);
for (const turn of [0, 1]) {
  const thread = new Worker(`const {parentPort}=require('node:worker_threads');const self={postMessage:m=>parentPort.postMessage(m)};${source}\nparentPort.on('message',data=>self.onmessage({data}));`, { eval: true });
  try {
    const state = createGame(DEFAULT_CONFIG); state.turn = turn;
    const result = await new Promise((resolve, reject) => {
      thread.once('message', resolve); thread.once('error', reject);
      thread.postMessage({ id: turn, state, config: DEFAULT_CONFIG, options: { depth: 2, forgiving: true, seed: 17001 } });
    });
    assert.equal(result.error, undefined);
    const next = move(state, DEFAULT_CONFIG, result.result.action.id, result.result.action.to);
    assert.equal(next.state.turn, 1 - turn);
  } finally { await thread.terminate(); }
}
console.log('PASS: Worker lifecycle, failure cleanup, module fallback, two bundled bot turns, no arrow labels.');
