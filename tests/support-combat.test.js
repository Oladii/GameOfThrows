import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { effective, attacks, analyze, resolve, inspectCell, move, clone, validateConfig } from '../dist/engine.js';
import { attackCellsFor, unitStatParts } from '../dist/board-presentation.js';
const piece = (id, type, team, q, r, extra = {}) => ({ id, type, team, q, r, ...extra });
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });
const veteran = (team = 0, q = 0, r = 0) => piece('veteran', 'shield', team, q, r, { reachedFarEdge: true });
const config = geometry => { const c = clone(DEFAULT_CONFIG); c.geometry = geometry; c.size = 6; return c; };

test('only an allied veteran can arm support; other drummers and ordinary shields still provide support without arming it', () => {
  for (const geometry of ['hex', 'square']) for (const type of ['attackLamp', 'defenseLamp']) {
    const c = config(geometry), support = piece('support', type, 0, 2, 2), target = piece('target', 'archer', 1, 3, 2);
    const drummer = piece('drummer', 'attackLamp', 0, 2, 3), shield = piece('shield', 'shield', 0, 1, 2);
    const s = position([support, target, drummer, shield]);
    const unarmed = effective(support, s, c);
    assert.equal(unarmed.damage, 0); assert.equal(unarmed.range, 0);
    assert.equal(attacks(support, target, s, c), false);
    assert.equal(attackCellsFor(support, s, c).length, 0);
    assert.ok(unarmed.fortitude > c.stats[type].fortitude, 'ordinary protection still applies');
    s.pieces[3] = veteran(1, 1, 2);
    assert.equal(effective(support, s, c).damage, 0, 'enemy veteran does not arm support');
    s.pieces[3] = veteran(0, 1, 2);
    const armed = effective(support, s, c);
    assert.equal(armed.damage, c.shieldPromotion.allies.damageBonus + c.stats.attackLamp.damageBonus);
    assert.equal(armed.range, 1); assert.equal(attacks(support, target, s, c), true);
    assert.ok(attackCellsFor(support, s, c).some(cell => cell.q === target.q && cell.r === target.r));
    assert.equal(unitStatParts(support, s, c).find(stat => stat.field === 'damage').total, armed.damage);
  }
});

test('the veteran must actually reach support along an unblocked aura ray', () => {
  for (const type of ['attackLamp', 'defenseLamp']) {
    const c = config('hex'), support = piece('support', type, 0, 0, 0);
    for (const [q, r] of [[2, 0], [1, 1]]) {
      assert.equal(effective(support, position([support, veteran(0, q, r)]), c).range, 0);
    }
    c.shieldPromotion.allies.aura = 2; c.experiments.aurasThroughShields = false;
    const s = position([support, veteran(0, 2, 0), piece('blocker', 'shield', 0, 1, 0)]);
    assert.equal(effective(support, s, c).range, 0);
    c.experiments.aurasThroughShields = true;
    assert.equal(effective(support, s, c).range, 1);
  }
});

test('preview and movement out of veteran support remove the attack and its markers', () => {
  for (const type of ['attackLamp', 'defenseLamp']) {
    const c = config('hex'), support = piece('support', type, 0, 1, 0);
    const s = position([veteran(), support, piece('enemy', 'archer', 1, -3, 0)]), before = clone(s);
    assert.equal(effective(support, s, c).range, 1);
    const preview = inspectCell(s, c, { q: 1, r: 1 }, support.id);
    assert.equal(preview.isPreview, true);
    assert.equal(preview.report.get(support.id).damage, 0); assert.equal(preview.report.get(support.id).range, 0);
    assert.equal(attackCellsFor(preview.piece, preview.position, c).length, 0);
    assert.deepEqual(s, before, 'preview preserves actual position');
    const result = move(s, c, support.id, { q: 1, r: 1 });
    assert.equal(result.report.get(support.id).damage, 0);
    const current = result.state.pieces.find(p => p.id === support.id);
    assert.equal(effective(current, result.state, c).range, 0);
  }
});

test('a dying veteran arms support for the simultaneous resolution, then its loss removes the attack', () => {
  for (const type of ['attackLamp', 'defenseLamp']) {
    const c = clone(REVISION_FOUR_CONFIG); c.geometry = 'hex'; c.size = 6; c.stats.archer.damage = 20; c.stats.shield.damage = 0;
    const support = piece('support', type, 0, 1, 0);
    const s = position([veteran(), support, piece('killer', 'archer', 1, 0, -1), piece('target', 'shield', 1, 2, 0)]);
    const result = resolve(s, c);
    assert.ok(result.deaths.some(p => p.id === 'veteran'));
    assert.ok(result.state.pieces.some(p => p.id === support.id));
    assert.ok(result.report.get('target').attackers.some(p => p.id === support.id), 'support attacks in the snapshot where veteran dies');
    assert.equal(analyze(result.state, c).get(support.id).damage, 0);
    assert.equal(analyze(result.state, c).get(support.id).range, 0);
  }
});

test('custom base attack cannot bypass veteran-only support combat', () => {
  const c = config('hex'); c.stats.attackLamp.damage = 9; c.stats.attackLamp.range = 4;
  assert.doesNotThrow(() => validateConfig(c));
  const support = piece('support', 'attackLamp', 0, 0, 0), enemy = piece('enemy', 'archer', 1, 1, 0);
  const s = position([support, enemy]);
  assert.equal(effective(support, s, c).damage, 0); assert.equal(attacks(support, enemy, s, c), false);
});

test('support auras keep strengthening combat units without a veteran, and old far-edge saves activate veteran support', () => {
  const c = config('hex'), support = piece('support', 'attackLamp', 0, 0, 0), ally = piece('ally', 'archer', 0, 1, 0);
  const s = position([support, ally, piece('flag', 'defenseLamp', 0, 1, -1)]);
  const stats = effective(ally, s, c);
  assert.equal(stats.damage, c.stats.archer.damage + c.stats.attackLamp.damageBonus);
  assert.equal(stats.range, c.stats.archer.range + c.stats.attackLamp.rangeBonus);
  assert.equal(stats.fortitude, c.stats.archer.fortitude + c.stats.defenseLamp.defenseBonus);
  const oldSupport = piece('support', 'defenseLamp', 0, 0, c.size - 1), oldVeteran = piece('old', 'shield', 0, 0, c.size);
  assert.equal(effective(oldSupport, position([oldSupport, oldVeteran]), c).range, 1);
});
