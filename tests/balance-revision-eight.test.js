import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIOUS_LOCAL_CONFIG as DEFAULT_CONFIG, PREVIOUS_CENTERLESS_CONFIG, PREVIOUS_AREA_CONFIG, PREVIOUS_SCOUT_CONFIG, BALANCE_REVISION, updateSavedBalance, upgradeSelectedBalancePreset } from '../dist/rules.js';
import { analyze, auraReaches, clone, createGame, effective, isCombatUnit, move, pass, resolve, validateConfig, validateState, winnerForPieces } from '../dist/engine.js';
import { prepareStartPosition } from '../dist/start-position.js';

const REVISION_EIGHT_CONFIG = PREVIOUS_CENTERLESS_CONFIG;
const piece = (id, type, team, q, r, extra = {}) => ({ id, type, team, q, r, ...extra });
const state = pieces => ({ pieces, turn: 0, ply: 0, winner: null });
const veteran = (id = 'veteran', team = 0, q = 0, r = 0) => piece(id, 'shield', team, q, r, { reachedFarEdge: true });
// Snapshot from outputs/balance-combat-loss-2026-11-09/delivery/allies3def6/manifest.json.
// Kept in the test so the published source package can run without research artifacts.
const manifest = {"config":{"version":1,"geometry":"hex","size":5,"auraDefenseCap":-1,"army":{"groups":2,"shields":2,"archers":2,"attackLamps":1,"defenseLamps":1,"scoutLamps":1},"shieldPromotion":{"aura":1,"damageBonus":9,"rangeBonus":2,"defenseBonus":9,"maxRange":3},"stats":{"shield":{"move":1,"damage":15,"range":1,"fortitude":15,"aura":1,"damageBonus":0,"rangeBonus":0,"defenseBonus":6},"archer":{"move":2,"damage":8,"range":3,"fortitude":6,"aura":1,"damageBonus":4,"rangeBonus":0,"defenseBonus":0},"attackLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":2,"damageBonus":4,"rangeBonus":0,"defenseBonus":0},"defenseLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":2,"damageBonus":0,"rangeBonus":0,"defenseBonus":4},"scoutLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":2,"damageBonus":0,"rangeBonus":1,"defenseBonus":0}},"experiments":{"squareDiagonals":true,"lampShieldBlocking":true,"allyShotsPass":true,"aurasThroughShields":true,"allowPass":false},"labVeteran":{"personal":{"damageBonus":9,"defenseBonus":9,"rangeBonus":2,"maxRange":3},"allies":{"damageBonus":3,"defenseBonus":6,"rangeBonus":1,"aura":1},"armSupport":true},"labVictoryCondition":"combat-units"},"initialState":{"pieces":[{"id":"p1","type":"attackLamp","team":0,"q":1,"r":-4,"group":null},{"id":"p2","type":"attackLamp","team":1,"q":-1,"r":4,"group":null},{"id":"p3","type":"defenseLamp","team":0,"q":2,"r":-4,"group":null},{"id":"p4","type":"defenseLamp","team":1,"q":-2,"r":4,"group":null},{"id":"p5","type":"scoutLamp","team":0,"q":2,"r":-5,"group":null},{"id":"p6","type":"scoutLamp","team":1,"q":-2,"r":5,"group":null},{"id":"p7","type":"shield","team":0,"q":-1,"r":-3,"group":1},{"id":"p8","type":"shield","team":1,"q":1,"r":3,"group":1},{"id":"p9","type":"shield","team":0,"q":0,"r":-3,"group":1},{"id":"p10","type":"shield","team":1,"q":0,"r":3,"group":1},{"id":"p11","type":"archer","team":0,"q":0,"r":-4,"group":1},{"id":"p12","type":"archer","team":1,"q":0,"r":4,"group":1},{"id":"p13","type":"archer","team":0,"q":-1,"r":-4,"group":1},{"id":"p14","type":"archer","team":1,"q":1,"r":4,"group":1},{"id":"p15","type":"shield","team":0,"q":2,"r":-3,"group":2},{"id":"p16","type":"shield","team":1,"q":-2,"r":3,"group":2},{"id":"p17","type":"shield","team":0,"q":3,"r":-3,"group":2},{"id":"p18","type":"shield","team":1,"q":-3,"r":3,"group":2},{"id":"p19","type":"archer","team":0,"q":3,"r":-4,"group":2},{"id":"p20","type":"archer","team":1,"q":-3,"r":4,"group":2},{"id":"p21","type":"archer","team":0,"q":4,"r":-4,"group":2},{"id":"p22","type":"archer","team":1,"q":-4,"r":4,"group":2}],"turn":0,"ply":0,"winner":null}};

test('revision eight retains selected combat rules and restores all 22 legacy corner positions', () => {
  const expected = clone(manifest.config);
  expected.shieldPromotion.allies = expected.labVeteran.allies;
  expected.victoryCondition = expected.labVictoryCondition;
  expected.deploymentOffset = 0;
  delete expected.labVeteran;
  delete expected.labVictoryCondition;
  assert.equal(BALANCE_REVISION, 22);
  assert.deepEqual(PREVIOUS_CENTERLESS_CONFIG, expected);
  assert.deepEqual(createGame(PREVIOUS_CENTERLESS_CONFIG), createGame(PREVIOUS_SCOUT_CONFIG));
  assert.deepEqual(clone(createGame({ ...PREVIOUS_CENTERLESS_CONFIG, deploymentOffset: 1 })), manifest.initialState);
  assert.equal(REVISION_EIGHT_CONFIG.stats.shield.move, 1);
  assert.equal(REVISION_EIGHT_CONFIG.stats.shield.defenseBonus, 6);
  assert.equal(REVISION_EIGHT_CONFIG.stats.scoutLamp.rangeBonus, 1);
  assert.ok([...analyze(createGame(PREVIOUS_CENTERLESS_CONFIG), REVISION_EIGHT_CONFIG).values()].every(value => !value.dead));
});

test('veterans retain personal 24/24/3 and give allies only +3 damage, +6 defense, +1 range', () => {
  const v = veteran(), archer = piece('archer', 'archer', 0, 1, 0);
  const alone = effective(v, state([v]), REVISION_EIGHT_CONFIG);
  assert.deepEqual([alone.damage, alone.fortitude, alone.range], [24, 24, 3]);
  const recipient = effective(archer, state([v, archer]), REVISION_EIGHT_CONFIG);
  assert.deepEqual([recipient.damage, recipient.fortitude, recipient.range], [11, 12, 4]);
  const shield = piece('shield', 'shield', 0, 1, 0), scout = piece('scout', 'scoutLamp', 0, 2, 0);
  const shieldStats = effective(shield, state([v, shield, scout]), REVISION_EIGHT_CONFIG);
  assert.deepEqual([shieldStats.damage, shieldStats.fortitude, shieldStats.range], [18, 21, 1]);
  const otherVeteran = veteran('other', 0, 1, 0);
  assert.equal(effective(v, state([v, otherVeteran, scout]), REVISION_EIGHT_CONFIG).range, 3);
  const capped = clone(REVISION_EIGHT_CONFIG); capped.auraDefenseCap = 0;
  assert.equal(effective(v, state([v, otherVeteran]), capped).fortitude, 24);
  assert.equal(effective(archer, state([v, archer]), capped).fortitude, 6);
});

test('the allied aura radius is independent of personal promotion fields', () => {
  const config = clone(REVISION_EIGHT_CONFIG), v = veteran(), ally = piece('ally', 'archer', 0, 2, 0);
  config.shieldPromotion.aura = 3;
  assert.equal(auraReaches(v, ally, state([v, ally]), config), false);
  config.shieldPromotion.allies.aura = 2;
  assert.equal(auraReaches(v, ally, state([v, ally]), config), true);
});

test('all three supports are armed by the veteran but never count as combat units', () => {
  for (const type of ['attackLamp', 'defenseLamp', 'scoutLamp']) {
    const v = veteran(), support = piece('support', type, 0, 1, 0), position = state([v, support]);
    const stats = effective(support, position, REVISION_EIGHT_CONFIG);
    assert.deepEqual([stats.damage, stats.range], [3, 1]);
    assert.equal(isCombatUnit(support), false);
    assert.equal(isCombatUnit(v), true);
    assert.equal(winnerForPieces([support, piece('enemy', 'archer', 1, -3, 0)], REVISION_EIGHT_CONFIG), 1);
  }
});

test('the last veteran can arm surviving support in the simultaneous snapshot and still lose', () => {
  const v = veteran(), support = piece('support', 'scoutLamp', 0, 1, 0);
  const position = state([v, support, piece('near', 'archer', 1, 0, -2), piece('mid', 'archer', 1, 0, -3), piece('reserve', 'archer', 1, -4, 0)]);
  const result = resolve(position, REVISION_EIGHT_CONFIG);
  assert.equal(result.report.get(v.id).incoming, 24);
  assert.equal(result.report.get(support.id).damage, 3);
  assert.equal(result.report.get(support.id).range, 1);
  assert.ok(result.deaths.some(p => p.id === v.id));
  assert.ok(result.state.pieces.some(p => p.id === support.id));
  assert.equal(result.state.winner, 1);
});

test('simultaneous loss of both final combat units is a draw even with support left on each side', () => {
  const position = state([
    piece('north', 'archer', 0, 0, 0), piece('south', 'archer', 1, 1, 0),
    piece('northSupport', 'attackLamp', 0, -2, -3), piece('southSupport', 'defenseLamp', 1, 2, 3)
  ]);
  const result = resolve(position, REVISION_EIGHT_CONFIG);
  assert.deepEqual(result.deaths.map(p => p.id), ['north', 'south']);
  assert.deepEqual(result.state.pieces.map(p => p.id), ['northSupport', 'southSupport']);
  assert.equal(result.state.winner, 'draw');
  const legacy = clone(REVISION_EIGHT_CONFIG); delete legacy.victoryCondition;
  assert.equal(resolve(position, legacy).state.winner, null);
  legacy.victoryCondition = 'all-units';
  assert.equal(resolve(position, legacy).state.winner, null);
});

test('validation and action guards recognize completed combat games with stale winner null', () => {
  const config = clone(REVISION_EIGHT_CONFIG); config.experiments.allowPass = true;
  const stale = state([piece('support', 'scoutLamp', 0, 0, 0), piece('enemy', 'archer', 1, 4, 0)]);
  assert.equal(validateState(stale, config).winner, 1);
  assert.equal(stale.winner, null, 'validation does not mutate a save');
  assert.throws(() => move(stale, config, 'support', { q: -1, r: 0 }), /Партия завершена/);
  assert.throws(() => pass(stale, config), /Партия завершена/);
  const legacy = clone(config); delete legacy.victoryCondition;
  assert.equal(validateState(stale, legacy).winner, null);
  assert.equal(move(stale, legacy, 'support', { q: -1, r: 0 }).state.winner, null);
  assert.equal(pass(stale, legacy).state.winner, null);
});

test('start preparation requires combat units in the new mode and preserves legacy support-only starts', () => {
  const supportOnly = state([piece('north', 'scoutLamp', 0, 0, -2), piece('south', 'defenseLamp', 1, 0, 2)]);
  assert.equal(validateState(supportOnly, REVISION_EIGHT_CONFIG).winner, 'draw');
  assert.throws(() => prepareStartPosition(supportOnly, REVISION_EIGHT_CONFIG, 0), /броненосец или лукарь/);
  const config = clone(REVISION_EIGHT_CONFIG); delete config.victoryCondition;
  assert.equal(prepareStartPosition(supportOnly, config, 0).winner, null);
  config.victoryCondition = 'all-units';
  assert.equal(prepareStartPosition(supportOnly, config, 1).winner, null);
  const combatConfig = clone(REVISION_EIGHT_CONFIG);
  Object.assign(combatConfig.army, { groups: 0, shields: 0, archers: 0, centralShields: 0, rearArchers: 0 });
  assert.equal(createGame(combatConfig).winner, 'draw');
});

test('old flat promotions and entirely absent promotions retain their previous allied effects', () => {
  const v = veteran(), archer = piece('ally', 'archer', 0, 1, 0), position = state([v, archer]);
  for (const absent of [false, true]) {
    const config = clone(PREVIOUS_SCOUT_CONFIG);
    if (absent) delete config.shieldPromotion;
    const normalized = validateConfig(config);
    assert.deepEqual(normalized.shieldPromotion, PREVIOUS_SCOUT_CONFIG.shieldPromotion);
    assert.equal('allies' in normalized.shieldPromotion, false);
    assert.deepEqual([effective(archer, position, config).damage, effective(archer, position, config).fortitude, effective(archer, position, config).range], [17, 15, 5]);
    assert.deepEqual(effective(archer, position, normalized), effective(archer, position, config));
    assert.equal('victoryCondition' in normalized, false);
    assert.equal('deploymentOffset' in normalized, false);
  }
  const custom = clone(PREVIOUS_SCOUT_CONFIG); custom.shieldPromotion.damageBonus = 2;
  assert.equal(effective(archer, position, custom).damage, 10);
});

test('only the full revision seven preset upgrades and the migration never mutates its input', () => {
  const before = clone(PREVIOUS_SCOUT_CONFIG);
  assert.deepEqual(upgradeSelectedBalancePreset(before), DEFAULT_CONFIG);
  assert.deepEqual(updateSavedBalance(before, 7), DEFAULT_CONFIG);
  assert.deepEqual(before, PREVIOUS_SCOUT_CONFIG);
  assert.deepEqual(updateSavedBalance(PREVIOUS_AREA_CONFIG, 6), DEFAULT_CONFIG);
  for (const change of [
    c => { c.stats.shield.move = 1; }, c => { c.stats.shield.defenseBonus = 5; },
    c => { c.geometry = 'square'; c.size = 10; }, c => { c.army.archers = 1; },
    c => { c.experiments.allowPass = true; }, c => { c.auraDefenseCap = 3; },
    c => { c.victoryCondition = 'all-units'; }, c => { c.victoryCondition = 'combat-units'; },
    c => { c.deploymentOffset = 0; }, c => { c.deploymentOffset = 1; },
    c => { c.shieldPromotion.allies = clone(REVISION_EIGHT_CONFIG.shieldPromotion.allies); }
  ]) {
    const custom = clone(before); change(custom);
    assert.deepEqual(upgradeSelectedBalancePreset(custom), custom);
    assert.deepEqual(updateSavedBalance(custom, 7), custom);
  }
  assert.deepEqual(updateSavedBalance(before, 8), before);
  assert.deepEqual(updateSavedBalance(REVISION_EIGHT_CONFIG, 8), DEFAULT_CONFIG);
});

test('deployment offset preserves exact IDs and groups and fails clearly when the old formation cannot retreat', () => {
  const legacy = createGame(PREVIOUS_SCOUT_CONFIG), current = createGame({ ...PREVIOUS_CENTERLESS_CONFIG, deploymentOffset: 1 });
  assert.deepEqual(createGame(PREVIOUS_CENTERLESS_CONFIG).pieces, legacy.pieces);
  assert.deepEqual(current.pieces, legacy.pieces.map(p => ({ ...p, r: p.r + (p.team === 0 ? -1 : 1) })));
  const zero = clone(PREVIOUS_CENTERLESS_CONFIG); zero.deploymentOffset = 0;
  assert.deepEqual(createGame(zero).pieces, legacy.pieces);
  delete zero.deploymentOffset;
  assert.deepEqual(createGame(zero).pieces, legacy.pieces);
  const tooSmall = clone(PREVIOUS_CENTERLESS_CONFIG); tooSmall.deploymentOffset = 1; tooSmall.size = 4;
  assert.throws(() => createGame(tooSmall), /отступом не помещается/);
  tooSmall.geometry = 'square'; tooSmall.size = 8;
  assert.throws(() => createGame(tooSmall), /отступом не помещается/);
  tooSmall.size = 10;
  assert.doesNotThrow(() => validateState(createGame(tooSmall), tooSmall));
});

test('new optional rules reject malformed values while remaining optional for older configs', () => {
  for (const value of [null, 'support', 0]) {
    const config = clone(REVISION_EIGHT_CONFIG); config.victoryCondition = value;
    assert.throws(() => validateConfig(config), /условие окончания/);
  }
  for (const value of [null, -1, 2, 0.5, '1']) {
    const config = clone(REVISION_EIGHT_CONFIG); config.deploymentOffset = value;
    assert.throws(() => validateConfig(config), /Отступ начальной/);
  }
  for (const value of [null, [], {}, { aura: 1, damageBonus: -1, defenseBonus: 6, rangeBonus: 1 }]) {
    const config = clone(REVISION_EIGHT_CONFIG); config.shieldPromotion.allies = value;
    assert.throws(() => validateConfig(config));
  }
  assert.doesNotThrow(() => validateConfig(PREVIOUS_SCOUT_CONFIG));
});
