import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, PREVIOUS_CENTERLESS_CONFIG, updateSavedBalance } from '../dist/rules.js';
import { createGame, clone, distance, analyze, validateState, validateConfig } from '../dist/engine.js';

test('each side gains one front-centre shield and two archers in the former support cells', () => {
  const before = createGame(PREVIOUS_CENTERLESS_CONFIG), after = createGame(DEFAULT_CONFIG);
  validateState(after, DEFAULT_CONFIG);
  assert.equal(after.pieces.length, 28);
  assert.equal(new Set(after.pieces.map(p => `${p.q},${p.r}`)).size, 28);
  for (const team of [0, 1]) {
    const own = after.pieces.filter(p => p.team === team);
    const counts = type => own.filter(p => p.type === type).length;
    assert.deepEqual(['shield','archer','attackLamp','defenseLamp','scoutLamp'].map(counts), [5,6,1,1,1]);
    const front = own.filter(p => p.type === 'shield');
    assert.equal(new Set(front.map(p => p.r)).size, 1);
    assert.ok(front.some(p => p.q === (team === 0 ? 1 : -1) && p.r === (team === 0 ? -2 : 2)));
    for (const support of before.pieces.filter(p => p.team === team && ['attackLamp','defenseLamp'].includes(p.type))) {
      const moved = after.pieces.find(p => p.id === support.id);
      assert.equal(moved.type, support.type);
      assert.equal(distance(moved, support, DEFAULT_CONFIG), 1);
      assert.equal(moved.r - support.r, team === 0 ? -1 : 1);
      assert.ok(own.some(p => p.type === 'archer' && p.q === support.q && p.r === support.r));
    }
    for (const old of before.pieces.filter(p => p.team === team && !['attackLamp','defenseLamp'].includes(p.type))) {
      assert.deepEqual(after.pieces.find(p => p.id === old.id), old);
    }
  }
  for (const north of after.pieces.filter(p => p.team === 0)) {
    assert.ok(after.pieces.some(p => p.team === 1 && p.type === north.type && p.q === -north.q && p.r === -north.r));
  }
  assert.ok([...analyze(after, DEFAULT_CONFIG).values()].every(p => !p.dead));
});

test('only the former complete standard preset migrates, keeping current combat characteristics', () => {
  const old = clone(PREVIOUS_CENTERLESS_CONFIG), original = clone(old);
  assert.deepEqual(updateSavedBalance(old, 8), DEFAULT_CONFIG);
  assert.deepEqual(old, original);
  assert.deepEqual(DEFAULT_CONFIG.stats, old.stats);
  assert.deepEqual(DEFAULT_CONFIG.shieldPromotion, old.shieldPromotion);
  const custom = clone(old); custom.stats.shield.damage++;
  assert.deepEqual(updateSavedBalance(custom, 8), custom);
  assert.deepEqual(updateSavedBalance(old, 9), old);
  for (const field of ['centralShields', 'rearArchers']) {
    for (const invalid of [-1, 13, '1', null]) {
      const config = clone(DEFAULT_CONFIG); config.army[field] = invalid;
      assert.throws(() => validateConfig(config), /Фигуры в центре/);
    }
  }
});
