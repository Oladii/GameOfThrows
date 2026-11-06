import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, move as baseMove } from '../dist/engine.js';
import { createExperiment } from '../experiment-engine.mjs';
import { VARIANTS, usesAnnihilationGoal } from '../experiment-profiles.mjs';
const p = (id, type, team, q, r) => ({ id, type, team, q, r });
const state = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('experimental baseline exactly preserves production transitions', () => {
  const c = clone(REVISION_FOUR_CONFIG), s = state([p('a', 'archer', 0, -3, 0), p('b', 'archer', 1, 3, 0)]);
  const expected = baseMove(s, c, 'a', { q: -2, r: 0 });
  const actual = createExperiment(c).move(s, 'a', { q: -2, r: 0 });
  assert.equal(actual.adjudication, null); delete actual.adjudication; assert.deepEqual(actual, expected);
});
test('the archived edge variant restricts edge movement to sidesteps and blocks occupied destinations', () => {
  const c = clone(REVISION_FOUR_CONFIG), engine = createExperiment(c, 'shield_edge_sideways');
  const s = state([p('a', 'shield', 0, -2, 4), p('friend', 'archer', 0, -1, 4)]);
  assert.deepEqual(engine.reachable(s.pieces[0], s), [{ q: -3, r: 4, steps: 1 }]);
  assert.equal(engine.move(s, 'a', { q: -3, r: 4 }).state.pieces.find(p => p.id === 'a').q, -3);
  const beforeEdge = state([p('a', 'shield', 0, -2, 3)]);
  assert.ok(engine.reachable(beforeEdge.pieces[0], beforeEdge).every(c => c.r >= 3));
});
test('alternative victory conditions are explicit and do not replace a production result', () => {
  const c = clone(REVISION_FOUR_CONFIG), trapped = state([p('a', 'shield', 0, -2, 4), ...[[-1, 4], [-1, 3], [-2, 3], [-3, 4]].map(([q, r], i) => p('b' + i, 'archer', 1, q, r))]);
  assert.equal(createExperiment(c).initial(trapped).winner, null);
  assert.equal(createExperiment(c, 'immobility_loss').initial(trapped).winner, 1);
  const flags = state([p('a', 'attackLamp', 0, -3, 0), p('b', 'archer', 1, 3, 0)]);
  assert.equal(createExperiment(c, 'combat_loss').initial(flags).winner, 1);
  assert.equal(createExperiment(c, 'combat_loss').initial({ ...flags, winner: 0 }).winner, 0);
  assert.equal(createExperiment(c, 'combat_loss').initial(state([p('a', 'attackLamp', 0, -3, 0), p('b', 'defenseLamp', 1, 3, 0)])).winner, 'draw');
});
test('permanent survivors do not prove a dead end when victory can occur without annihilation', () => {
  for (const variant of VARIANTS) assert.equal(usesAnnihilationGoal(variant), variant.kind !== 'victory');
  const c = clone(REVISION_FOUR_CONFIG); c.stats.shield.damage = 2; // Fixed non-annihilation fixture, independent of the current balance.
  const s = state([p('a', 'shield', 0, 0, 0), p('b', 'shield', 1, 2, -4), ...[[3, -4], [1, -4], [1, -3], [2, -3]].map(([q, r], i) => p('wall' + i, 'defenseLamp', 0, q, r))]);
  // The surrounded shield survives, yet the explicit immobility rule can end the game.
  const result = createExperiment(c, 'immobility_loss').move(s, 'a', { q: 0, r: 1 });
  assert.equal(result.deaths.length, 0); assert.equal(result.state.winner, 0);
});
