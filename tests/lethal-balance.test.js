import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, analyze, effective, resolve, move, reachable, validateConfig } from '../dist/engine.js';
import { durabilityDisplay } from '../dist/board-presentation.js';

const historicalFortitude = { shield: 3, archer: 1, attackLamp: 2, defenseLamp: 2 };
const oldConfig = () => {
  const c = clone(REVISION_FOUR_CONFIG);
  for (const [type, value] of Object.entries(historicalFortitude)) c.stats[type].fortitude = value;
  return c;
};
const actions = (s, c) => s.pieces.filter(p => p.team === s.turn)
  .flatMap(p => reachable(p, s, c).map(to => ({ id: p.id, to })));

test('new default opening has no lethal threats and no first move can kill an enemy', () => {
  const c = clone(DEFAULT_CONFIG), start = createGame(c);
  assert.equal(start.pieces.length, 22);
  for (const team of [0, 1]) {
    const s = { ...clone(start), turn: team }, report = analyze(s, c);
    assert.equal([...report.values()].filter(i => i.dead).length, 0);
    assert.deepEqual(resolve(s, c).state.pieces, s.pieces);
    for (const info of report.values()) assert.equal(durabilityDisplay(info).dead, false);
    const legal = actions(s, c); assert.ok(legal.length >= 80);
    for (const a of legal) assert.ok(move(s, c, a.id, a.to).deaths.every(p => p.team === team));
    assert.ok(legal.filter(a => move(s, c, a.id, a.to).deaths.length === 0).length > 1);
  }
});

test('one-time migration fixes revision-three defaults, keeps custom values and never changes explicit imports', () => {
  const old = oldConfig(), before = clone(old), next = updateSavedBalance(old, 3);
  assert.equal(BALANCE_REVISION, 7);
  assert.deepEqual(next, DEFAULT_CONFIG);
  assert.deepEqual(old, before);
  assert.deepEqual(updateSavedBalance(next, BALANCE_REVISION), next);
  const custom = oldConfig();
  for (const type of Object.keys(historicalFortitude)) custom.stats[type].fortitude = 7;
  assert.deepEqual(updateSavedBalance(custom, 3), custom);
  assert.deepEqual(validateConfig(old), { ...clone(old), army: { ...old.army, scoutLamps: 0 }, stats: { ...old.stats, scoutLamp: clone(DEFAULT_CONFIG.stats.scoutLamp) } }, 'Explicit configuration imports retain their values');
  for (const revision of [undefined, 0, 1, 2, 3]) {
    const migrated = updateSavedBalance(old, revision);
    for (const [type, value] of Object.entries(historicalFortitude)) assert.equal(migrated.stats[type].fortitude, DEFAULT_CONFIG.stats[type].fortitude);
  }
});

test('historical revision-four recalculation preserves old strict-threshold outcomes for every type, aura cap and veteran status', () => {
  for (const geometry of ['hex', 'square']) for (const cap of [-1, 0, 1, 2]) for (const veteran of [false, true]) {
    const c = clone(REVISION_FOUR_CONFIG), old = oldConfig();
    for (const cfg of [c, old]) { cfg.geometry = geometry; cfg.size = 6; cfg.auraDefenseCap = cap; }
    const pieces = Object.keys(historicalFortitude).map((type, i) => ({ id: `target-${i}`, type, team: 0, q: 2, r: 2 }));
    for (const target of pieces) {
      if (target.type === 'shield') target.reachedFarEdge = veteran;
      const s = { turn: 0, ply: 0, winner: null, pieces: [target,
        { id: 'guard', type: 'shield', team: 0, q: 3, r: 2, reachedFarEdge: veteran },
        { id: 'banner', type: 'attackLamp', team: 0, q: 2, r: 3 },
        { id: 'commander', type: 'defenseLamp', team: 0, q: 2, r: 1 }] };
      const previous = effective(target, s, old), current = effective(target, s, c);
      assert.equal(current.fortitude, previous.fortitude + 1);
      for (const field of ['damage', 'range', 'move', 'aura', 'defenseBonus']) assert.equal(current[field], previous[field]);
      for (let incoming = 0; incoming <= 40; incoming++) {
        assert.equal(incoming > previous.fortitude, incoming > 0 && incoming >= current.fortitude);
      }
    }
  }
});
