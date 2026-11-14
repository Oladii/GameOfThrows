import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, createGame, createSearchMovement, move, reachable } from '../dist/engine.js';

const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('search movement preserves every legal outcome, promotions and input across positions', () => {
  const opening = createGame(DEFAULT_CONFIG);
  const tactical = JSON.parse(fs.readFileSync(new URL('./fixtures/bot-forgiving-defense.json', import.meta.url))).state;
  const promotion = position([piece('a', 'archer', 0, 0, 4), piece('s', 'shield', 0, -1, 4),
    piece('f', 'defenseLamp', 0, 0, 0), piece('e', 'shield', 1, -3, 0), piece('ef', 'defenseLamp', 1, 0, -4)]);
  const search = createSearchMovement(DEFAULT_CONFIG);
  let count = 0, promoted = false, combat = false;
  for (const state of [opening, { ...opening, turn: 1 }, tactical, promotion]) {
    const before = JSON.stringify(state);
    for (const p of state.pieces.filter(p => p.team === state.turn)) {
      const routes = reachable(p, state, DEFAULT_CONFIG);
      assert.deepEqual(search.reachable(p, state), routes);
      for (const to of routes) {
        const expected = move(state, DEFAULT_CONFIG, p.id, to);
        assert.deepEqual(search.move(state, p.id, to), expected);
        assert.deepEqual(search.move(state, p.id, to), expected);
        promoted ||= !!to.reachedFarEdge || !!to.archerReachedFarEdge;
        combat ||= expected.deaths.length > 0;
        count++;
      }
    }
    assert.equal(JSON.stringify(state), before);
  }
  assert.ok(count > 100);
  assert.ok(promoted);
  assert.ok(combat);
});

test('independent search requests respect square movement rules and reject illegal moves', () => {
  const state = position([piece('a', 'archer', 0, 2, 2), piece('e', 'shield', 1, 4, 4)]);
  for (const diagonals of [false, true]) {
    const config = clone(DEFAULT_CONFIG);
    config.geometry = 'square'; config.size = 6; config.victoryCondition = 'all-units';
    config.experiments.squareDiagonals = diagonals;
    const search = createSearchMovement(config), p = state.pieces[0];
    assert.deepEqual(search.reachable(p, state), reachable(p, state, config));
    for (const to of search.reachable(p, state)) {
      const actual = search.move(state, p.id, to);
      assert.deepEqual(actual, move(state, config, p.id, to));
      if (actual.state.winner === null) {
        const enemy = actual.state.pieces.find(p => p.team === actual.state.turn);
        assert.deepEqual(search.reachable(enemy, actual.state), reachable(enemy, actual.state, config));
      }
    }
    assert.throws(() => search.move(state, 'a', { q: -1, r: 0 }), /нельзя/);
    assert.throws(() => search.move(state, 'e', { q: 4, r: 3 }), /другой команды/);
    assert.throws(() => search.move({ ...state, winner: 0 }, 'a', { q: 2, r: 3 }), /завершена/);
  }
});
