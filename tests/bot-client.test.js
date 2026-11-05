import test from 'node:test';
import assert from 'node:assert/strict';
import { BotRunner } from '../dist/bot-client.js';

function fakeWorker() { return { terminate() { this.stopped = true; }, postMessage(value) { this.request = value; } }; }

test('cancelled search and a stale result cannot play a move', () => {
  const workers = [], results = [], errors = [];
  const runner = new BotRunner(() => { const w = fakeWorker(); workers.push(w); return w; });
  runner.run({ state: 'old' }, x => results.push(x), x => errors.push(x));
  runner.run({ state: 'new' }, x => results.push(x), x => errors.push(x));
  assert.equal(workers[0].stopped, true);
  workers[0].onmessage({ data: { id: workers[0].request.id, result: 'stale' } });
  workers[1].onmessage({ data: { id: workers[0].request.id, result: 'wrong id' } });
  assert.deepEqual(results, []);
  workers[1].onmessage({ data: { id: workers[1].request.id, result: 'current' } });
  assert.deepEqual(results, ['current']); assert.deepEqual(errors, []); assert.equal(runner.active, false);
  workers[1].onmessage({ data: { id: workers[1].request.id, result: 'duplicate' } });
  assert.deepEqual(results, ['current']);
});

test('worker errors and creation failures release the search', () => {
  const worker = fakeWorker(), errors = [];
  const runner = new BotRunner(() => worker);
  runner.run({}, () => assert.fail('unexpected move'), e => errors.push(e));
  worker.onmessage({ data: { id: worker.request.id, error: 'bad position' } });
  assert.equal(errors[0].message, 'bad position'); assert.equal(runner.active, false); assert.equal(worker.stopped, true);
  new BotRunner(() => { throw new Error('no worker'); }).run({}, () => assert.fail('unexpected move'), e => errors.push(e));
  assert.equal(errors[1].message, 'no worker');
});

test('a hung worker times out without applying a move', async () => {
  const worker = fakeWorker(), runner = new BotRunner(() => worker, 5);
  await new Promise(resolve => runner.run({}, () => assert.fail('unexpected move'), error => { assert.match(error.message, /не успел/); resolve(); }));
  assert.equal(runner.active, false); assert.equal(worker.stopped, true);
});
