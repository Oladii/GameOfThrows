import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIOUS_UNCAPPED_CONFIG as DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG as CURRENT_CONFIG, PREVIOUS_ADJACENT_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, effective } from '../dist/engine.js';

const piece = (id, type, q, r, extra = {}) => ({ id, type, team: 0, q, r, ...extra });
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('a third defense source increases a shield from seven to eight, including in the reported board position', () => {
  const front = piece('front', 'shield', -3, 1);
  const rear = piece('rear', 'shield', -4, 2);
  const flag = piece('flag', 'defenseLamp', -3, 3);
  const moving = piece('moving', 'shield', -2, 2);
  const before = position([front, rear, flag, moving]);
  const after = clone(before); after.pieces.find(p => p.id === 'moving').q = -3;
  assert.equal(effective(front, before, DEFAULT_CONFIG).fortitude, 7);
  assert.equal(effective(front, after, PREVIOUS_ADJACENT_CONFIG).fortitude, 7);
  assert.equal(effective(front, after, DEFAULT_CONFIG).fortitude, 8);
});

test('veteran personal fortitude and every external defense source add together; non-shields get no shield protection', () => {
  const veteran = piece('v', 'shield', 0, 0, { reachedFarEdge: true });
  const guards = [piece('g1', 'shield', 1, 0), piece('g2', 'shield', 0, 1), piece('g3', 'shield', -1, 1)];
  const flag = piece('f', 'defenseLamp', 0, -1);
  assert.equal(effective(veteran, position([veteran, ...guards, flag]), DEFAULT_CONFIG).fortitude, 10);
  const archer = piece('a', 'archer', 0, 0);
  assert.equal(effective(archer, position([archer, ...guards, flag]), DEFAULT_CONFIG).fortitude, 5);
});

test('only the exact former standard setup migrates to uncapped defense; all numbers and deployment are preserved', () => {
  const old = clone(PREVIOUS_ADJACENT_CONFIG), expected = clone(old);
  expected.auraDefenseCap = -1;
  assert.equal(BALANCE_REVISION, 21);
  assert.deepEqual(DEFAULT_CONFIG, expected);
  assert.deepEqual(createGame(DEFAULT_CONFIG), createGame(old));
  assert.deepEqual(updateSavedBalance(old, 15), CURRENT_CONFIG);
  assert.deepEqual(old, PREVIOUS_ADJACENT_CONFIG);
  assert.deepEqual(updateSavedBalance(old, 16), old);
  for (const change of [c => c.auraDefenseCap = 1, c => c.stats.archer.damage++, c => c.army.archers++]) {
    const custom = clone(old); change(custom);
    assert.deepEqual(updateSavedBalance(custom, 15), custom);
  }
});
