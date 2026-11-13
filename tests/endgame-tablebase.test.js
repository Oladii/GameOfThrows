import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createEndgameTablebase } from '../endgame-tablebase.mjs';
import { clone, move, reachable, validateConfig, effective } from '../dist/engine.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
const archived = JSON.parse(fs.readFileSync(new URL('../../outputs/playtest-2026-11-05-shield-promotion-range/matches.json', import.meta.url), 'utf8'));

test('tablebase finishes the actual stalled three-piece ending against the most delaying replies', () => {
  const config = validateConfig(archived.protocol.config); config.stats.archer.fortitude = 2;
  const tb = createEndgameTablebase(config);
  let state = clone(archived.matches.find(m => m.match === 8).finalState), steps = 0;
  assert.deepEqual(tb.lookup(state), { winner: 0, plies: 12 });
  while (state.winner === null) {
    const before = tb.lookup(state), options = [];
    for (const piece of state.pieces.filter(p => p.team === state.turn)) for (const to of reachable(piece, state, config)) {
      const next = move(state, config, piece.id, to).state;
      options.push({ next, rank: next.winner === 0 ? 0 : tb.lookup(next)?.plies ?? Infinity });
    }
    options.sort((a, b) => state.turn === 0 ? a.rank - b.rank : b.rank - a.rank);
    assert.ok(options[0].rank < before.plies);
    state = options[0].next; assert.ok(++steps <= 12);
  }
  assert.equal(state.winner, 0);
});
test('tablebase rejects a lone enemy capable of killing the supposedly invulnerable flag', () => {
  const config = validateConfig(archived.protocol.config); config.stats.archer.damage = 3;
  assert.equal(createEndgameTablebase(config).lookup(archived.matches.find(m => m.match === 8).finalState), null);
});
test('external defense cap preserves personal veteran protection, damage, range and source auras', () => {
  const config = clone(REVISION_FOUR_CONFIG);
  const pieces = [{ id: 'v', type: 'shield', team: 0, q: 0, r: 0, reachedFarEdge: true }, { id: 'v2', type: 'shield', team: 0, q: 1, r: -1, reachedFarEdge: true }, { id: 'd', type: 'defenseLamp', team: 0, q: 0, r: 1 }, { id: 'a', type: 'archer', team: 0, q: 0, r: -1 }];
  const state = { pieces, turn: 0, ply: 0, winner: null };
  const shield = effective(pieces[0], state, config), archer = effective(pieces[3], state, config);
  assert.equal(shield.fortitude, 7); assert.equal(archer.fortitude, 5);
  config.auraDefenseCap = 1;
  const cappedShield = effective(pieces[0], state, config), cappedArcher = effective(pieces[3], state, config);
  assert.equal(cappedShield.fortitude, 6); assert.equal(cappedArcher.fortitude, 3);
  assert.equal(cappedArcher.damage, archer.damage); assert.equal(cappedArcher.range, archer.range);
  assert.deepEqual(cappedShield.sources, shield.sources); assert.equal(cappedShield.range, 2);
  const old = clone(config); delete old.auraDefenseCap; assert.equal(validateConfig(old).auraDefenseCap, -1);
  for (const cap of [-2, 0.5, 21]) { config.auraDefenseCap = cap; assert.throws(() => validateConfig(config)); }
});

test('tablebase falls back when an aura-armed commander can kill at equality', () => {
  const config = validateConfig(archived.protocol.config), ending = archived.matches.find(m => m.match === 8).finalState;
  config.stats.archer.fortitude = config.shieldPromotion.damageBonus;
  assert.equal(createEndgameTablebase(config).lookup(ending), null);
});
