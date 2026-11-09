import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function setup(status) {
  const nodes = Object.fromEntries(['archive-status', 'archive-retry', 'archive-details', 'archive-errors'].map(id => ['#' + id, {}]));
  const recorder = { status, retryFailed: async () => status };
  const context = vm.createContext({ $: selector => nodes[selector], archiveRecorder: recorder, toast() {} });
  vm.runInContext(app.slice(app.indexOf('let archiveRetrying ='), app.indexOf('const archiveRecorder =')), context);
  vm.runInContext(app.slice(app.indexOf('async function retryArchive()'), app.indexOf("$('#archive-retry').addEventListener")), context);
  context.renderArchiveStatus(status);
  return { nodes, recorder, context };
}
const rejected = { state: 'error', pending: 3, failed: 1, gameId: 'game', failures: [{ httpStatus: 409, code: 'sequence_conflict', count: 1 }] };

test('archive errors remain visible and retryable while disabled and acknowledged queues have no warning controls', () => {
  const { context, nodes } = setup(rejected);
  assert.match(nodes['#archive-status'].textContent, /ещё не сохранена/);
  assert.equal(nodes['#archive-retry'].hidden, false);
  assert.equal(nodes['#archive-details'].hidden, false);
  assert.equal(nodes['#archive-errors'].textContent, '409 · sequence_conflict · записей: 1');
  context.renderArchiveStatus({ state: 'saved', pending: 0, failed: 0, gameId: 'game' });
  assert.match(nodes['#archive-status'].textContent, /Партия сохранена/);
  assert.equal(nodes['#archive-retry'].hidden, true);
  assert.equal(nodes['#archive-details'].hidden, true);
  assert.equal(nodes['#archive-errors'].textContent, '');
  context.renderArchiveStatus({ state: 'disabled', pending: 0, failed: 0, gameId: null });
  assert.equal(nodes['#archive-status'].hidden, true);
  assert.equal(nodes['#archive-retry'].hidden, true);
});

test('manual retry locks duplicate clicks and never shows saved before the recorder confirms its ACK', async () => {
  const { context, nodes, recorder } = setup(rejected);
  let finish, requests = 0;
  recorder.retryFailed = () => { requests++; return new Promise(resolve => { finish = resolve; }); };
  const pending = context.retryArchive();
  await context.retryArchive();
  assert.equal(requests, 1);
  assert.equal(nodes['#archive-retry'].disabled, true);
  assert.match(nodes['#archive-status'].textContent, /Повторяем сохранение/);
  assert.doesNotMatch(nodes['#archive-status'].textContent, /Партия сохранена/);
  recorder.status = { state: 'saved', pending: 0, failed: 0, gameId: 'game' };
  finish(); await pending;
  assert.equal(nodes['#archive-retry'].hidden, true);
  assert.equal(nodes['#archive-details'].hidden, true);
  assert.match(nodes['#archive-status'].textContent, /Партия сохранена/);
});

test('an unsuccessful retry preserves the warning and allows a later retry', async () => {
  const { context, nodes } = setup(rejected);
  await context.retryArchive();
  assert.match(nodes['#archive-status'].textContent, /ещё не сохранена/);
  assert.equal(nodes['#archive-retry'].hidden, false);
  assert.equal(nodes['#archive-retry'].disabled, false);
  assert.equal(nodes['#archive-details'].hidden, false);
});
