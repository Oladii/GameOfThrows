import test from 'node:test';
import assert from 'node:assert/strict';
// Frozen revision-14 flag expansion; current adjacent shields are tested separately.
import { PREVIOUS_FLAG_CONFIG as DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG as CURRENT_CONFIG, PREVIOUS_MELEE_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, validateConfig, cells, auraReaches, effective, resolve } from '../dist/engine.js';

const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('revision 14 extends only the flag radius and preserves the entire 28-unit deployment', () => {
  const expected = clone(PREVIOUS_MELEE_CONFIG); expected.stats.defenseLamp.aura = 3;
  assert.equal(BALANCE_REVISION, 21);
  assert.deepEqual(DEFAULT_CONFIG, expected);
  assert.deepEqual(createGame(DEFAULT_CONFIG), createGame(PREVIOUS_MELEE_CONFIG));
  assert.equal(createGame(DEFAULT_CONFIG).pieces.length, 28);
});

test('the complete revision-13 setup migrates once, keeping custom and explicitly older profiles', () => {
  const old = clone(PREVIOUS_MELEE_CONFIG), before = clone(old);
  assert.deepEqual(updateSavedBalance(old, 13), CURRENT_CONFIG);
  assert.deepEqual(old, before);
  assert.deepEqual(updateSavedBalance(old, 14), before);
  assert.deepEqual(validateConfig(old), before, 'loading an explicit old configuration retains its rules');
  for (const change of [c => c.stats.defenseLamp.aura = 4, c => c.army.archers++, c => c.geometry = 'square', c => c.experiments.allowPass = true]) {
    const custom = clone(old); change(custom);
    assert.deepEqual(updateSavedBalance(custom, 13), custom);
  }
});

test('the flag covers the full third ring while the drum and binoculars retain radius two', () => {
  for (const [type, count] of [['defenseLamp', 36], ['attackLamp', 18], ['scoutLamp', 18]]) {
    const source = piece('source', type, 0, 0, 0), state = position([source]);
    assert.equal(cells(DEFAULT_CONFIG).filter(cell => auraReaches(source, cell, state, DEFAULT_CONFIG)).length, count);
  }
  const flag = piece('f', 'defenseLamp', 0, 0, 0), ally = piece('a', 'archer', 0, 1, 2), enemy = piece('e', 'archer', 1, -1, -2), state = position([flag, ally, enemy]);
  const a = effective(ally, state, DEFAULT_CONFIG);
  assert.deepEqual([a.damage, a.range, a.fortitude], [2, 4, 5]);
  assert.equal(effective(enemy, state, DEFAULT_CONFIG).fortitude, 4);
  assert.equal(effective(flag, state, DEFAULT_CONFIG).fortitude, 3);
});

test('protection at distance three saves an archer from simultaneous arrows without increasing the defense cap', () => {
  const state = position([piece('a', 'archer', 0, 0, 0), piece('f', 'defenseLamp', 0, -3, 0), piece('e1', 'archer', 1, 0, -2), piece('e2', 'archer', 1, 2, 0)]);
  assert.equal(resolve(state, PREVIOUS_MELEE_CONFIG).report.get('a').dead, true);
  const power = resolve(state, DEFAULT_CONFIG).report.get('a');
  assert.deepEqual([power.incoming, power.fortitude, power.dead], [4, 5, false]);
  const shield = piece('s', 'shield', 0, 0, 0), defended = position([shield, piece('g1', 'shield', 0, 1, 0), piece('g2', 'shield', 0, 0, 1), piece('f', 'defenseLamp', 0, -3, 0)]);
  assert.equal(effective(shield, defended, DEFAULT_CONFIG).fortitude, 7);
});
