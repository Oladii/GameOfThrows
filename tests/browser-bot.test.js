import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, createGame, move, pass, reachable } from '../dist/engine.js';
import { botPositionKey, chooseBotAction } from '../dist/bot.js';

const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('browser bot searches four half-moves on the current full army without mutating input', () => {
  const config = clone(DEFAULT_CONFIG), state = createGame(config), before = JSON.stringify({ state, config });
  const result = chooseBotAction(state, config, { seed: 39 });
  assert.equal(result.stats.depth, 4);
  assert.equal(result.stats.maxDepth, 4);
  assert.ok(result.stats.legalMoves > result.stats.rootCandidates);
  assert.ok(reachable(state.pieces.find(p => p.id === result.action.id), state, config)
    .some(to => to.q === result.action.to.q && to.r === result.action.to.r));
  assert.equal(move(state, config, result.action.id, result.action.to).state.ply, 1);
  assert.equal(JSON.stringify({ state, config }), before);
});

test('browser bot takes an immediate forced win instead of wandering', () => {
  const config = clone(DEFAULT_CONFIG);
  const state = position([piece('shield', 'shield', 0, 0, 0), piece('target', 'archer', 1, 2, 0)]);
  const first = chooseBotAction(state, config), second = chooseBotAction(state, config);
  assert.deepEqual(first.action, second.action);
  assert.equal(move(state, config, first.action.id, first.action.to).state.winner, 0);
});

test('browser bot obeys supplied balance and movement settings', () => {
  const config = clone(DEFAULT_CONFIG);
  config.stats.shield.move = 2; config.stats.shield.damage = 10;
  const state = position([piece('shield', 'shield', 0, 0, 0), piece('target', 'defenseLamp', 1, 3, 0)]);
  const result = chooseBotAction(state, config, { depth: 2 });
  assert.deepEqual(result.action, { id: 'shield', to: { q: 2, r: 0 } });
  assert.equal(move(state, config, result.action.id, result.action.to).state.winner, 0);
});

test('browser bot distinguishes a blocked turn, an allowed pass, and a finished game', () => {
  const config = clone(DEFAULT_CONFIG);
  config.geometry = 'square'; config.size = 6; config.experiments.squareDiagonals = false;
  config.stats.defenseLamp.move = 1;
  const state = position([piece('blocked', 'defenseLamp', 0, 0, 0), piece('wall-1', 'shield', 1, 1, 0), piece('wall-2', 'shield', 1, 0, 1)]);
  const blocked = chooseBotAction(state, config);
  assert.equal(blocked.action, null);
  assert.equal(blocked.stats.reason, 'no-legal-moves');
  config.experiments.allowPass = true;
  const passed = chooseBotAction(state, config);
  assert.deepEqual(passed.action, { pass: true });
  assert.doesNotThrow(() => pass(state, config));
  const finished = chooseBotAction({ ...state, winner: 1 }, config);
  assert.equal(finished.action, null);
  assert.equal(finished.stats.reason, 'finished');
});

test('position identity preserves promotion and turn while ignoring unit IDs', () => {
  const config = clone(DEFAULT_CONFIG), state = position([piece('s', 'shield', 0, 0, 0)]);
  const renamed = clone(state); renamed.pieces[0].id = 'new-id';
  assert.equal(botPositionKey(state, config), botPositionKey(renamed, config));
  const promoted = clone(state); promoted.pieces[0].reachedFarEdge = true;
  assert.notEqual(botPositionKey(state, config), botPositionKey(promoted, config));
  assert.notEqual(botPositionKey(state, config), botPositionKey({ ...state, turn: 1 }, config));
});

test('snapshot history and precomputed position counts produce the same search', () => {
  const config = clone(DEFAULT_CONFIG);
  const state = position([piece('shield', 'shield', 0, 0, 0), piece('target', 'archer', 1, 3, 0)]);
  const next = move(state, config, 'shield', { q: 1, r: 0 }).state;
  const snapshots = chooseBotAction(state, config, { depth: 2, previousStates: [state, next, next] });
  const counts = chooseBotAction(state, config, { depth: 2, seenPositions: [[botPositionKey(state, config), 1], [botPositionKey(next, config), 2]] });
  assert.deepEqual(snapshots.action, counts.action);
  assert.equal(snapshots.stats.score, counts.stats.score);
});
