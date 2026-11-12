import test from 'node:test';
import assert from 'node:assert/strict';
// Frozen revision-13 combat fixture; current flag coverage is tested separately.
import { PREVIOUS_MELEE_CONFIG as DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG as CURRENT_CONFIG, PREVIOUS_SUPPORT_CONFIG, PREVIOUS_ARCHER_CONFIG, PREVIOUS_SMALL_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, effective, resolve } from '../dist/engine.js';

const p = (id, type, team, q, r, veteran = false) => ({ id, type, team, q, r, ...(veteran ? { reachedFarEdge: true } : {}) });
const state = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('variant A changes only shield attack, reach and the personal veteran attack bonus', () => {
  const expected = clone(PREVIOUS_SUPPORT_CONFIG);
  expected.stats.shield.damage = 5;
  expected.stats.shield.range = 2;
  expected.shieldPromotion.damageBonus = 1;
  assert.equal(BALANCE_REVISION, 22);
  assert.deepEqual(DEFAULT_CONFIG, expected);
  assert.deepEqual(createGame(DEFAULT_CONFIG), createGame(PREVIOUS_SUPPORT_CONFIG));
  assert.equal(createGame(DEFAULT_CONFIG).pieces.length, 28);
  const veteran = p('v', 'shield', 0, 0, 0, true);
  const stats = effective(veteran, state([veteran]), DEFAULT_CONFIG);
  assert.deepEqual([stats.damage, stats.fortitude, stats.range], [6, 6, 3]);
});

test('complete standard revisions 10–12 migrate once without mutating their inputs', () => {
  for (const [revision, config] of [[10, PREVIOUS_SMALL_CONFIG], [11, PREVIOUS_ARCHER_CONFIG], [12, PREVIOUS_SUPPORT_CONFIG]]) {
    const before = clone(config);
    assert.deepEqual(updateSavedBalance(config, revision), CURRENT_CONFIG);
    assert.deepEqual(config, before);
    assert.deepEqual(updateSavedBalance(config, 13), before);
  }
  for (const change of [c => c.stats.shield.damage++, c => c.army.archers++, c => c.geometry = 'square', c => c.experiments.allowPass = true]) {
    const custom = clone(PREVIOUS_SUPPORT_CONFIG); change(custom);
    assert.deepEqual(updateSavedBalance(custom, 12), custom);
  }
});

test('a shield kills a contacted archer while surviving its simultaneous return shot', () => {
  const result = resolve(state([p('s', 'shield', 0, 0, 0), p('a', 'archer', 1, 0, 2)]), DEFAULT_CONFIG);
  assert.deepEqual(result.deaths.map(piece => piece.id), ['a']);
  assert.deepEqual([result.report.get('s').incoming, result.report.get('a').incoming], [2, 5]);
});

test('two ordinary shields kill even a fully protected veteran despite his return attacks', () => {
  const pieces = [p('s1', 'shield', 0, -1, 0), p('s2', 'shield', 0, 0, -1), p('v', 'shield', 1, 0, 0, true), p('g1', 'shield', 1, 1, 0), p('g2', 'shield', 1, 0, 1)];
  const result = resolve(state(pieces), DEFAULT_CONFIG);
  assert.equal(result.report.get('v').fortitude, 8);
  assert.equal(result.report.get('v').incoming, 10);
  for (const id of ['s1', 's2', 'v']) assert.ok(result.deaths.some(piece => piece.id === id), id);
});

test('veteran still boosts allied attack and range but protects only shields', () => {
  const veteran = p('v', 'shield', 0, 0, 0, true), archer = p('a', 'archer', 0, 1, 0), support = p('d', 'attackLamp', 0, 0, 1), shield = p('s', 'shield', 0, -1, 0);
  const boosted = piece => effective(piece, state([veteran, piece]), DEFAULT_CONFIG);
  const a = boosted(archer), d = boosted(support), s = boosted(shield);
  assert.deepEqual([a.damage, a.range, a.fortitude], [3, 5, 4]);
  assert.deepEqual([d.damage, d.range, d.fortitude], [1, 1, 3]);
  assert.equal(s.fortitude, 6);
});
