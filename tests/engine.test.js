import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, cells, distance, createGame, createScenario, analyze, inspectCell, attacks, auraReaches, resolve, effective, reachable, move, pass, validateState, validateConfig, shieldCanRetreat } from '../dist/engine.js';
// Fix the combat fixture so future balance tuning does not rewrite aura tests.
const config = () => { const c = clone(REVISION_FOUR_CONFIG); c.stats.shield.fortitude = 3; c.stats.archer.fortitude = 1; c.stats.attackLamp.fortitude = 2; c.stats.defenseLamp.fortitude = 2; c.stats.shield.damage = 3; c.stats.archer.damage = 1; c.stats.attackLamp.damage = 2; c.stats.attackLamp.range = 3; c.stats.attackLamp.damageBonus = 1; return c; };
const p = (id, type, team, q, r) => ({ id, type, team, q, r });
const state = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('two groups of 2 shields + 2 archers and one banner of each type per player; symmetric valid deployment', () => {
  for (const geometry of ['hex', 'square']) {
    const c = config(); c.geometry = geometry; if (geometry === 'square') c.size = 8;
    const s = createGame(c); validateState(s, c);
    assert.equal(cells(c).length, geometry === 'hex' ? 61 : 64);
    for (const team of [0, 1]) {
      assert.equal(s.pieces.filter(p => p.team === team).length, 10);
      assert.equal(s.pieces.filter(p => p.team === team && p.type === 'archer').length, 4);
      assert.equal(s.pieces.filter(p => p.team === team && p.type === 'attackLamp').length, 1);
      assert.equal(s.pieces.filter(p => p.team === team && p.type === 'defenseLamp').length, 1);
      for (const group of [1, 2]) assert.equal(s.pieces.filter(p => p.team === team && p.group === group && p.type === 'shield').length, 2);
      for (const group of [1, 2]) assert.equal(s.pieces.filter(p => p.team === team && p.group === group && p.type === 'archer').length, 2);
    }
    const rearRow = geometry === 'hex' ? -3 : 1;
    const centre = piece => geometry === 'hex' ? piece.q + piece.r / 2 : piece.q - (c.size - 1) / 2;
    const banners = s.pieces.filter(p => p.team === 0 && ['attackLamp', 'defenseLamp'].includes(p.type));
    assert.deepEqual(banners.map(p => p.r), [rearRow, rearRow]);
    assert.deepEqual(banners.map(centre), [-.5, .5]);
    for (const piece of s.pieces.filter(p => p.team === 0)) {
      const q = geometry === 'hex' ? -piece.q : c.size - 1 - piece.q;
      const r = geometry === 'hex' ? -piece.r : c.size - 1 - piece.r;
      assert.ok(s.pieces.some(p => p.team === 1 && p.type === piece.type && p.group === piece.group && p.q === q && p.r === r));
    }
  }
});
test('equality is lethal, summed incoming damage, no persistent wounds', () => {
  const c = config(); c.stats.archer.fortitude = 2;
  const s = state([p('target', 'archer', 0, 0, 0), p('a', 'archer', 1, 1, 0)]);
  assert.equal(analyze(s, c).get('target').incoming, 1);
  assert.equal(resolve(s, c).state.pieces.some(p => p.id === 'target'), true);
  assert.equal(resolve(resolve(s, c).state, c).state.pieces.some(p => p.id === 'target'), true);
  s.pieces.push(p('b', 'archer', 1, 2, 0));
  assert.equal(analyze(s, c).get('target').incoming, 2);
  assert.equal(resolve(s, c).state.pieces.some(p => p.id === 'target'), false);
});
test('a shield takes incoming damage and blocks further targets even if it dies in the snapshot', () => {
  const c = config(); c.stats.shield.fortitude = 0;
  const s = state([p('a', 'archer', 0, -2, 0), p('wall', 'shield', 1, 0, 0), p('behind', 'archer', 1, 1, 0)]);
  const r = resolve(s, c);
  assert.equal(r.report.get('wall').incoming, 1);
  assert.equal(r.report.get('behind').incoming, 0);
  assert.ok(!r.state.pieces.some(p => p.id === 'wall'));
  assert.ok(r.state.pieces.some(p => p.id === 'behind'));
});
test('aura bonuses stack, do not amplify aura radius, exclude self and enemy lamps', () => {
  const c = config();
  const s = state([p('x', 'shield', 0, 0, 0), p('a', 'attackLamp', 0, 1, 0), p('b', 'attackLamp', 0, 0, 1), p('d', 'defenseLamp', 0, -1, 0), p('e', 'attackLamp', 1, 0, -1)]);
  const x = effective(s.pieces[0], s, c), a = effective(s.pieces[1], s, c);
  assert.equal(x.damage, 5); assert.equal(x.range, 1); assert.equal(x.rangeBonus, 0); assert.equal(x.fortitude, 4);
  assert.equal(a.damage, 0); assert.equal(a.range, 0); assert.equal(a.aura, 2);
  assert.equal(effective(s.pieces[3], s, c).damage, 0);
  assert.equal(effective(s.pieces[4], s, c).damage, 0);
});
test('a dying protection lamp still grants fortitude during this single calculation', () => {
  const c = config(); c.stats.attackLamp.damage = 4; c.stats.defenseLamp.defenseBonus = 2;
  const s = state([p('lamp', 'defenseLamp', 0, 0, 0), p('protected', 'archer', 0, 1, 0), p('a', 'archer', 1, 2, 0), p('b', 'archer', 1, 3, 0), p('killer', 'attackLamp', 1, -3, 0)]);
  const r = resolve(s, c);
  assert.ok(r.deaths.some(p => p.id === 'lamp'));
  assert.equal(r.report.get('protected').fortitude, 3);
  assert.equal(r.report.get('protected').incoming, 2);
  assert.ok(r.state.pieces.some(p => p.id === 'protected'));
});
test('movement uses a route, can turn and pass allies but cannot land on them or cross enemy walls', () => {
  const c = config(); c.geometry = 'square'; c.size = 6; c.experiments.squareDiagonals = false;
  const moving = p('m', 'archer', 0, 0, 0);
  let s = state([moving, p('friend', 'shield', 0, 1, 0)]);
  let destinations = reachable(moving, s, c);
  assert.ok(destinations.some(c => c.q === 2 && c.r === 0));
  assert.ok(destinations.some(c => c.q === 1 && c.r === 1));
  assert.ok(!destinations.some(c => c.q === 1 && c.r === 0));
  s = state([moving, p('enemy', 'shield', 1, 1, 0)]);
  assert.ok(!reachable(moving, s, c).some(c => c.q === 2 && c.r === 0));
});
test('shields can move forward and sideways, but not backward before the opposite edge', () => {
  for (const geometry of ['hex', 'square']) for (const diagonals of geometry === 'hex' ? [true] : [false, true]) for (const team of [0, 1]) {
    const c = config(); c.geometry = geometry; c.experiments.squareDiagonals = diagonals;
    if (geometry === 'square') c.size = 8;
    const origin = geometry === 'hex' ? 0 : 3, forward = team === 0 ? 1 : -1;
    const shield = p('shield', 'shield', team, origin, origin), s = { ...state([shield]), turn: team };
    const options = reachable(shield, s, c);
    assert.equal(options.length, geometry === 'hex' ? 4 : diagonals ? 5 : 3);
    assert.ok(options.every(cell => (cell.r - shield.r) * forward >= 0));
    for (const dq of [-1, 1]) {
      const sideways = { q: origin + dq, r: origin };
      assert.ok(options.some(cell => cell.q === sideways.q && cell.r === sideways.r));
      assert.doesNotThrow(() => move(s, c, shield.id, sideways));
    }
    const backward = { q: origin, r: origin - forward }, before = clone(s);
    assert.throws(() => move(s, c, shield.id, { ...backward, reachedFarEdge: true }), /нельзя пойти/);
    assert.deepEqual(s, before);
    const archer = { ...shield, type: 'archer' };
    assert.ok(reachable(archer, { ...s, pieces: [archer] }, c).some(cell => cell.q === backward.q && cell.r === backward.r));
    assert.equal(attacks(shield, p('enemy', 'archer', 1 - team, backward.q, backward.r), s, c), true);
  }
});
test('sideways shield routes can pass allies but cannot cross enemies or step backward before the edge', () => {
  for (const team of [0, 1]) {
    const c = config(); c.stats.shield.move = 2;
    const forward = team === 0 ? 1 : -1, shield = p('shield', 'shield', team, 0, 0);
    const s = { ...state([shield, p('friend', 'archer', team, forward, 0)]), turn: team };
    const options = reachable(shield, s, c);
    assert.ok(options.some(cell => cell.q === forward * 2 && cell.r === 0));
    assert.ok(!options.some(cell => cell.q === forward && cell.r === 0));
    assert.ok(options.every(cell => cell.r * forward >= 0));
    const blocked = clone(s); blocked.pieces[1].team = 1 - team;
    assert.ok(!reachable(blocked.pieces[0], blocked, c).some(cell => cell.q === forward * 2 && cell.r === 0));
  }
});
test('reaching the opposite edge permanently unlocks retreat for either team and geometry, including JSON and snapshots', () => {
  for (const geometry of ['hex', 'square']) for (const team of [0, 1]) {
    const c = config(); c.geometry = geometry; if (geometry === 'square') c.size = 8;
    const forward = team === 0 ? 1 : -1, edge = geometry === 'hex' ? forward * c.size : team === 0 ? c.size - 1 : 0;
    const q = geometry === 'hex' ? 0 : 3;
    const shield = p('shield', 'shield', team, q, edge - forward);
    const enemy = p('enemy', 'defenseLamp', 1 - team, geometry === 'hex' ? -3 : 0, geometry === 'hex' ? 0 : 3);
    const original = { ...state([shield, enemy]), turn: team }, snapshot = clone(original);
    const arrival = move(original, c, shield.id, { q, r: edge }).state;
    assert.equal(arrival.pieces.find(p => p.id === shield.id).reachedFarEdge, true);
    const restored = validateState(JSON.parse(JSON.stringify(arrival)), c); restored.turn = team;
    const retreat = move(restored, c, shield.id, { q, r: edge - forward }).state; retreat.turn = team;
    const farther = move(retreat, c, shield.id, { q, r: edge - forward * 2 }).state;
    assert.equal(farther.pieces.find(p => p.id === shield.id).reachedFarEdge, true);
    assert.deepEqual(original, snapshot); // Undo restores the previous, still restricted piece.
    assert.equal(shieldCanRetreat(snapshot.pieces[0], c), false);
    const legacy = state([p('old', 'shield', team, q, edge)]);
    assert.equal(validateState(legacy, c).pieces[0].reachedFarEdge, true);
  }
});
test('only the opposite edge unlocks retreat and the saved flag must be a shield boolean', () => {
  const c = config();
  for (const team of [0, 1]) {
    const forward = team === 0 ? 1 : -1;
    for (const shield of [p('own', 'shield', team, 0, -forward * c.size), p('side', 'shield', team, forward * c.size, 0)]) {
      assert.equal(shieldCanRetreat(shield, c), false);
    }
  }
  assert.throws(() => validateState(state([{ ...p('bad', 'shield', 0, 0, 0), reachedFarEdge: 'true' }]), c));
  assert.throws(() => validateState(state([{ ...p('bad', 'archer', 0, 0, 0), reachedFarEdge: true }]), c));
});
test('a longer route can touch the far edge and turn backward within the same move; preview and move retain the permission', () => {
  for (const team of [0, 1]) {
    const c = config(); c.stats.shield.move = 3;
    const forward = team === 0 ? 1 : -1, shield = p('shield', 'shield', team, 0, forward * 3);
    const s = { ...state([shield, p('enemy', 'defenseLamp', 1 - team, -forward * 4, 0)]), turn: team };
    const destination = { q: 0, r: forward * 2 };
    const route = reachable(shield, s, c).find(cell => cell.q === destination.q && cell.r === destination.r);
    assert.equal(route.steps, 3); assert.equal(route.reachedFarEdge, true);
    const preview = inspectCell(s, c, destination, shield.id);
    assert.equal(preview.isPreview, true); assert.equal(preview.piece.reachedFarEdge, true);
    assert.equal(move(s, c, shield.id, destination).state.pieces.find(p => p.id === shield.id).reachedFarEdge, true);
    assert.equal(s.pieces[0].reachedFarEdge, undefined);
    const blocked = clone(s); blocked.pieces.push(p('wall1', 'defenseLamp', 1 - team, 0, forward * 4), p('wall2', 'defenseLamp', 1 - team, -forward, forward * 4));
    assert.ok(!reachable(blocked.pieces[0], blocked, c).some(cell => cell.q === destination.q && cell.r === destination.r));
  }
});
test('move changes turns and performs one simultaneous resolution for both teams', () => {
  const c = config(); c.stats.archer.damage = 2;
  const s = state([p('a', 'archer', 0, -2, 0), p('b', 'archer', 1, 1, 0)]);
  const r = move(s, c, 'a', { q: -1, r: 0 });
  assert.equal(r.deaths.length, 2); assert.equal(r.state.winner, 'draw'); assert.equal(r.state.turn, 1); assert.equal(r.state.ply, 1);
  assert.equal(s.pieces[0].q, -2);
});
test('victory includes lamps, and a defense lamp never gains an attack', () => {
  const c = config();
  const s = state([p('a', 'archer', 0, -2, 0), p('b', 'archer', 1, 1, 0), p('lamp', 'defenseLamp', 1, 3, -2)]);
  c.stats.archer.damage = 2;
  assert.equal(resolve(s, c).state.winner, 1);
  s.pieces = [p('a', 'archer', 0, -4, 0), p('lamp', 'defenseLamp', 1, 4, 0)];
  assert.equal(resolve(s, c).state.winner, null);
});
test('the explanatory shield-2 example differs from the working shield-4 configuration', () => {
  const c = config(); c.stats.shield.damage = 1; c.stats.shield.fortitude = 4; // historical example before the adopted balance changes
  const s = createScenario('adjacent', c);
  const guards = s.pieces.filter(p => p.type === 'shield');
  for (const g of guards) assert.equal(analyze(s, c).get(g.id).incoming, 3);
  assert.equal(resolve(s, c).deaths.length, 0);
  c.stats.shield.fortitude = 2;
  const first = resolve(s, c); assert.equal(first.deaths.length, 2);
  const second = resolve(first.state, c); assert.equal(second.deaths.length, 4); // ranged units now die at equal incoming damage
});
test('experimental flags change tested behavior; import rejects invalid positions', () => {
  const c = config();
  assert.throws(() => pass(createGame(c), c));
  c.experiments.allowPass = true; assert.equal(pass(createGame(c), c).state.ply, 1);
  assert.throws(() => validateState(state([p('a', 'archer', 0, 0, 0), p('b', 'archer', 1, 0, 0)]), c));
  c.stats.archer.range = NaN; assert.throws(() => validateConfig(c));
});
test('veteran-enabled custom drummer rays respect shields and independent allied-fire blocking settings', () => {
  const c = config(); c.shieldPromotion.damageBonus = 0; c.shieldPromotion.rangeBonus = 0;
  const s = state([p('lamp', 'attackLamp', 0, -3, 0), { ...p('vet', 'shield', 0, -3, 1), reachedFarEdge: true }, p('wall', 'shield', 1, -1, 0), p('target', 'archer', 1, 0, 0)]);
  assert.equal(analyze(s, c).get('target').incoming, 0);
  c.experiments.lampShieldBlocking = false;
  assert.equal(analyze(s, c).get('target').incoming, 2);
  s.pieces.push(p('friend', 'archer', 0, -2, 0));
  c.experiments.allyShotsPass = false;
  assert.equal(analyze(s, c).get('target').attackers.some(a => a.id === 'lamp'), false);
});
test('casualties are independent of piece enumeration order', () => {
  const c = config(), s = createGame(c);
  const a = resolve(s, c), b = resolve({ ...s, pieces: [...s.pieces].reverse() }, c);
  assert.deepEqual(a.deaths.map(p => p.id).sort(), b.deaths.map(p => p.id).sort());
});
test('JSON settings cannot give a lamp unsupported aura bonuses', () => {
  for (const [type, field] of [['attackLamp', 'defenseBonus'], ['defenseLamp', 'damageBonus'], ['defenseLamp', 'rangeBonus'], ['shield', 'damageBonus'], ['archer', 'rangeBonus'], ['archer', 'defenseBonus']]) {
    const c = config(); c.stats[type][field] = 7;
    const decoded = JSON.parse(JSON.stringify(c));
    assert.throws(() => validateConfig(decoded), /не поддерживает/, `${type}.${field}`);
  }
});
test('hex archers have six equally long face-normal rays and no vertex-direction shots', () => {
  const c = config(); c.size = 6;
  const shooter = p('shooter', 'archer', 0, 0, 0), s = state([shooter]);
  for (const [q, r] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
    const end = p('target', 'archer', 1, q * 4, r * 4);
    assert.equal(attacks(shooter, end, s, c), true);
    assert.equal(end.q ** 2 + end.q * end.r + end.r ** 2, 16);
    assert.equal(attacks(shooter, { ...end, q: q * 5, r: r * 5 }, s, c), false);
  }
  assert.equal(distance(shooter, { q: 1, r: 1 }, c), 2);
  assert.equal(attacks(shooter, p('between', 'archer', 1, 1, 1), s, c), false);
});
test('hover inspection identifies only damage sources whose attack passes blockers', () => {
  const c = config();
  const s = state([p('target', 'archer', 0, 0, 0), p('cover', 'shield', 0, 1, 0), p('blocked', 'archer', 1, 3, 0), p('visible', 'archer', 1, 0, 2)]);
  const context = inspectCell(s, c, { q: 0, r: 0 });
  assert.equal(context.piece.id, 'target');
  assert.deepEqual(context.report.get('target').attackers.map(a => a.id), ['visible']);
  assert.equal(inspectCell(s, c, { q: 3, r: 0 }, 'target').piece.id, 'blocked');
  assert.equal(inspectCell(s, c, { q: -4, r: 0 }).piece, null);
});
test('hover move preview uses the destination and keeps mutually dying attackers in the snapshot', () => {
  const c = config(); c.stats.archer.damage = 2;
  const s = state([p('selected', 'archer', 0, 0, 0), p('enemy', 'archer', 1, 0, 2)]);
  const context = inspectCell(s, c, { q: 0, r: -1 }, 'selected');
  assert.equal(context.isPreview, true);
  assert.equal(context.piece.r, -1);
  assert.equal(context.report.get('selected').dead, true);
  assert.equal(context.report.get('enemy').dead, true);
  assert.deepEqual(context.report.get('selected').attackers.map(a => a.id), ['enemy']);
  assert.equal(context.position.pieces.length, 2);
  assert.equal(s.pieces[0].r, 0);
});
test('shields cannot gain attack range from stacked banners, but retain damage and defense bonuses', () => {
  for (const geometry of ['hex', 'square']) {
    const c = config(); c.geometry = geometry; if (geometry === 'square') c.size = 8;
    const offset = geometry === 'hex' ? 0 : 3;
    const at = (id, type, team, q, r) => p(id, type, team, q + offset, r + offset);
    const shield = at('shield', 'shield', 0, 0, 0), archer = at('archer', 'archer', 0, 0, 1);
    const near = at('near', 'archer', 1, 1, 0), far = at('far', 'archer', 1, 2, 0);
    const s = state([shield, archer, at('a', 'attackLamp', 0, -1, 1), at('b', 'attackLamp', 0, 0, -1), at('d', 'defenseLamp', 0, -1, 0), near, far]);
    validateState(s, c);
    const boosted = effective(shield, s, c);
    assert.equal(boosted.range, 1); assert.equal(boosted.rangeBonus, 0);
    assert.equal(boosted.damage, 5); assert.equal(boosted.fortitude, 4);
    assert.equal(attacks(shield, near, s, c), true);
    assert.equal(attacks(shield, far, s, c), false);
    assert.equal(analyze(s, c).get('far').attackers.some(a => a.id === shield.id), false);
    assert.equal(effective(archer, s, c).range, 6);
    c.stats.shield.range = 2;
    assert.equal(effective(shield, s, c).range, 2); // the editable base is preserved, only aura range is excluded
    assert.equal(attacks(shield, far, s, c), true);
  }
});
test('support auras cover every cell within two steps, including cells between rays and excluding the source', () => {
  const c = config(), source = p('banner', 'attackLamp', 0, 0, 0), s = state([source]);
  assert.equal(cells(c).filter(cell => auraReaches(source, cell, s, c)).length, 18);
  assert.equal(auraReaches(source, source, s, c), false);
  for (const [q, r] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
    for (const step of [1, 2]) assert.equal(auraReaches(source, { q: q * step, r: r * step }, s, c), true);
    assert.equal(auraReaches(source, { q: q * 3, r: r * 3 }, s, c), false);
  }
  for (const [q, r] of [[1, 1], [-1, -1], [1, -2], [-1, 2], [2, -1], [-2, 1]]) {
    const target = p('target', 'shield', 0, q, r), position = state([source, target]);
    assert.equal(distance(source, target, c), 2);
    assert.equal(auraReaches(source, target, position, c), true);
    assert.equal(effective(target, position, c).damageBonus, c.stats.attackLamp.damageBonus);
  }
});
test('all attacks, including attack banners, follow face rays and cannot shoot vertically through vertices', () => {
  const c = config(); c.stats.shield.range = 3; c.shieldPromotion.maxRange = 3;
  for (const type of ['shield', 'archer', 'attackLamp']) {
    const attacker = p('attacker', type, 0, 0, 0), s = state([attacker, { ...p('vet', 'shield', 0, 1, 0), reachedFarEdge: true }]);
    for (const [q, r] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) assert.equal(attacks(attacker, p('target', 'archer', 1, q * 2, r * 2), s, c), true);
    for (const [q, r] of [[1, 1], [-1, -1], [1, -2], [-1, 2], [2, -1], [-2, 1]]) assert.equal(attacks(attacker, p('target', 'archer', 1, q, r), s, c), false);
  }
});

test('promoted shields keep personal bonuses and grant both banner effects to adjacent allies, stacking without self or enemy auras', () => {
  const c = config(), veteran = { ...p('vet', 'shield', 0, 0, 0), reachedFarEdge: true };
  const normal = p('shield', 'shield', 0, 1, 0), archer = p('archer', 'archer', 0, 0, 1);
  const attack = p('attack', 'attackLamp', 0, -1, 1), defense = p('defense', 'defenseLamp', 0, -1, 0);
  const second = { ...p('second', 'shield', 0, 1, -1), reachedFarEdge: true };
  const enemy = { ...p('enemy', 'shield', 1, 0, -1), reachedFarEdge: true };
  const s = state([veteran, normal, archer, attack, defense, second, enemy]);
  const info = effective(veteran, s, c);
  assert.equal(info.damage, 6); assert.equal(info.fortitude, 7); assert.equal(info.range, 2);
  assert.equal(info.aura, 1); assert.deepEqual(info.sources.sort(), ['attack', 'defense', 'second', 'shield']);
  const a = effective(archer, s, c);
  assert.equal(a.damage, 3); assert.equal(a.range, 6); assert.equal(a.fortitude, 4);
  const shield = effective(normal, s, c);
  assert.equal(shield.range, 1); assert.equal(shield.damage, 6);
  assert.equal(effective(defense, s, c).damage, 2); assert.equal(effective(defense, s, c).range, 1);
  assert.equal(auraReaches(veteran, p('far', 'archer', 0, 2, 0), s, c), false);
  assert.equal(auraReaches(veteran, veteran, s, c), false);
  assert.equal(effective(enemy, state([enemy, archer]), c).damage, 4);
});
test('arrival grants the permanent bonuses before simultaneous damage, and a dying veteran still supports allies in that snapshot', () => {
  const c = config(), shield = p('vet', 'shield', 0, 0, 3);
  const s = state([shield, p('enemy', 'archer', 1, -2, 4)]);
  c.stats.archer.damage = 3;
  const arrival = move(s, c, shield.id, { q: 0, r: 4 });
  assert.equal(arrival.report.get(shield.id).incoming, 3);
  assert.equal(arrival.report.get(shield.id).fortitude, 4);
  assert.ok(arrival.state.pieces.some(p => p.id === shield.id));
  const dying = state([{ ...p('vet', 'shield', 0, 0, 0), reachedFarEdge: true }, p('ally', 'archer', 0, 0, 1), p('killer', 'archer', 1, -2, 0)]);
  c.stats.archer.damage = 5;
  const result = resolve(dying, c);
  assert.ok(result.deaths.some(p => p.id === 'vet'));
  assert.equal(result.report.get('ally').fortitude, 2);
  assert.equal(result.report.get('ally').damage, c.stats.archer.damage + c.shieldPromotion.damageBonus);
  assert.equal(result.report.get('ally').range, 5);
});
test('old configurations receive promotion defaults and editable promotion values are validated and applied', () => {
  const old = config(); delete old.shieldPromotion;
  const c = validateConfig(old);
  assert.deepEqual(c.shieldPromotion, DEFAULT_CONFIG.shieldPromotion);
  c.shieldPromotion = { aura: 2, damageBonus: 2, rangeBonus: 3, defenseBonus: 4, maxRange: 2 };
  validateConfig(c);
  const veteran = { ...p('vet', 'shield', 0, 0, 0), reachedFarEdge: true }, archer = p('archer', 'archer', 0, 2, 0), s = state([veteran, archer]);
  assert.equal(effective(veteran, s, c).damage, 5); assert.equal(effective(veteran, s, c).fortitude, 7);
  assert.equal(effective(veteran, s, c).range, 2); assert.equal(effective(archer, s, c).range, 7);
  for (const value of [-1, 1.5, 21, '1']) { const invalid = clone(c); invalid.shieldPromotion.aura = value; assert.throws(() => validateConfig(invalid)); }
});

test('a promoted shield has reach two even under stacked allied auras, while an ordinary shield keeps reach one', () => {
  const c = config(), veteran = { ...p('vet', 'shield', 0, 0, 0), reachedFarEdge: true };
  const ordinary = p('normal', 'shield', 0, 1, 0);
  const s = state([veteran, ordinary, p('a', 'attackLamp', 0, -1, 1), p('b', 'attackLamp', 0, 0, -1)]);
  assert.equal(effective(veteran, s, c).range, 2); assert.equal(effective(veteran, s, c).rangeBonus, 1);
  assert.equal(effective(ordinary, s, c).range, 1);
  assert.equal(attacks(veteran, p('near', 'archer', 1, 2, 0), s, c), true);
  assert.equal(attacks(veteran, p('far', 'archer', 1, 3, 0), s, c), false);
  c.shieldPromotion.rangeBonus = 5;
  assert.equal(effective(veteran, s, c).range, 2); assert.equal(effective(veteran, s, c).rangeBonus, 1);
  c.shieldPromotion.maxRange = 3;
  assert.equal(effective(veteran, s, c).range, 3);
});

test('ordinary shields protect adjacent allies from the start without self, enemy, damage or range bonuses', () => {
  for (const geometry of ['hex', 'square']) {
    const c = clone(REVISION_FOUR_CONFIG); c.geometry = geometry; if (geometry === 'square') c.size = 8;
    const shield = p('shield', 'shield', 0, 1, 1);
    const ally = p('ally', 'archer', 0, 2, 1), far = p('far', 'archer', 0, 3, 1);
    const enemy = p('enemy', 'archer', 1, 1, 0);
    const s = state([shield, ally, far, enemy]);
    assert.equal(shieldCanRetreat(shield, c), false);
    assert.equal(effective(shield, s, c).fortitude, 4);
    const stats = effective(ally, s, c);
    assert.equal(stats.fortitude, 3); assert.equal(stats.damage, 2); assert.equal(stats.range, 4);
    assert.deepEqual(stats.sources, ['shield']);
    assert.equal(effective(far, s, c).fortitude, 2);
    assert.equal(effective(enemy, s, c).fortitude, 2);
    assert.equal(auraReaches(shield, shield, s, c), false);
    const covered = cells(c).filter(cell => auraReaches(shield, cell, s, c));
    assert.equal(covered.length, geometry === 'hex' ? 6 : 8);
    s.pieces.push(p('second', 'shield', 0, 2, 0));
    assert.equal(effective(ally, s, c).fortitude, 4);
    c.auraDefenseCap = 1;
    assert.equal(effective(ally, s, c).fortitude, 3);
    assert.doesNotThrow(() => validateConfig(c));
  }
});
test('ordinary shield protection is present in movement previews and simultaneous combat even when the source dies', () => {
  const c = clone(REVISION_FOUR_CONFIG), guard = p('guard', 'shield', 0, 0, 0);
  const ally = p('ally', 'archer', 0, 1, 0), enemy = p('enemy', 'archer', 1, -2, 0);
  c.stats.archer.damage = 4; c.stats.archer.range = 3;
  const s = state([guard, ally, enemy]);
  const result = resolve(s, c);
  assert.ok(result.deaths.some(p => p.id === 'guard'));
  assert.equal(result.report.get('ally').fortitude, 3);
  const preview = inspectCell(s, c, { q: 1, r: 1 }, guard.id);
  // Shield move is one step; use a sideways destination next to its ally.
  const sidePreview = inspectCell(s, c, { q: -1, r: 0 }, guard.id);
  assert.equal(preview.isPreview, false);
  assert.equal(sidePreview.isPreview, true);
  assert.equal(sidePreview.report.get('ally').fortitude, 2);
  const coveredPreview = inspectCell(s, c, { q: 0, r: 1 }, guard.id);
  assert.equal(coveredPreview.isPreview, true);
  assert.equal(coveredPreview.report.get('ally').fortitude, 3);
});
test('default attack banners can move two cells but cannot cross enemies or move three', () => {
  for (const geometry of ['hex', 'square']) {
    const c = clone(REVISION_FOUR_CONFIG); c.geometry = geometry; if (geometry === 'square') c.size = 8;
    c.size = geometry === 'hex' ? 6 : 8; c.experiments.squareDiagonals = false;
    const banner = p('banner', 'attackLamp', 0, 2, 2), s = state([banner]);
    const destinations = reachable(banner, s, c);
    assert.equal(c.stats.attackLamp.move, 2);
    assert.ok(destinations.some(cell => cell.q === 4 && cell.r === 2));
    assert.ok(destinations.every(cell => distance(banner, cell, c) <= 2));
    assert.equal(move(s, c, banner.id, { q: 4, r: 2 }).state.pieces[0].q, 4);
    assert.throws(() => move(s, c, banner.id, { q: 5, r: 2 }), /нельзя пойти/);
    s.pieces.push(p('blocker', 'archer', 1, 3, 2));
    assert.equal(reachable(banner, s, c).some(cell => cell.q === 4 && cell.r === 2), false);
  }
});
test('saved balance upgrades old defaults once while preserving current user settings and custom values', () => {
  const old = clone(REVISION_FOUR_CONFIG); old.stats.shield.aura = 0; old.stats.shield.defenseBonus = 0; old.stats.attackLamp.move = 1; old.stats.archer.damage = 1;
  const updated = updateSavedBalance(old);
  assert.equal(updated.stats.shield.aura, 1); assert.equal(updated.stats.shield.defenseBonus, DEFAULT_CONFIG.stats.shield.defenseBonus);
  assert.equal(updated.stats.attackLamp.move, 2); assert.equal(updated.stats.archer.damage, DEFAULT_CONFIG.stats.archer.damage);
  assert.equal(old.stats.shield.aura, 0); assert.equal(old.stats.attackLamp.move, 1);
  assert.deepEqual(updateSavedBalance(old, BALANCE_REVISION), old);
  const custom = clone(old); custom.stats.shield.aura = 2; custom.stats.shield.defenseBonus = 3; custom.stats.attackLamp.move = 3; custom.stats.archer.damage = 3;
  assert.deepEqual(updateSavedBalance(custom), custom);
  const fromPreviousRevision = updateSavedBalance(old, 1);
  assert.equal(fromPreviousRevision.stats.archer.damage, 2);
  assert.equal(fromPreviousRevision.stats.shield.aura, 0);
  assert.equal(fromPreviousRevision.stats.attackLamp.move, 1);
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(updated))), updated);
});

test('drummers keep granting +2 damage but cannot arm each other without a veteran', () => {
  const c = clone(REVISION_FOUR_CONFIG);
  const banner = p('banner', 'attackLamp', 0, 0, 0), second = p('second', 'attackLamp', 0, 0, 1);
  const ally = p('ally', 'archer', 0, 1, 0), enemy = p('enemy', 'shield', 1, -1, 0);
  const alone = state([banner, enemy]);
  assert.equal(effective(banner, alone, c).damage, 0);
  assert.equal(effective(banner, alone, c).range, 0);
  assert.equal(attacks(banner, enemy, alone, c), false);
  const s = state([banner, second, ally, enemy]);
  assert.equal(c.stats.attackLamp.move, 2); assert.equal(c.stats.attackLamp.aura, 2);
  assert.equal(effective(ally, s, c).damage, 6); assert.equal(effective(ally, s, c).range, 6);
  for (const source of [banner, second]) {
    const stats = effective(source, s, c);
    assert.equal(stats.damage, 0); assert.equal(stats.range, 0);
    assert.ok(stats.sources.includes(source === banner ? 'second' : 'banner'));
  }
  assert.equal(attacks(banner, enemy, s, c), false);
  const result = resolve(s, c);
  assert.ok(result.deaths.some(piece => piece.id === banner.id));
  assert.equal(result.report.get(ally.id).damage, 6);
  const preview = inspectCell(s, c, { q: 0, r: -2 }, banner.id);
  assert.equal(preview.isPreview, true); assert.equal(preview.report.get(ally.id).damage, 4);
});
test('banner balance migration updates revision two once and preserves explicit current settings', () => {
  const old = clone(REVISION_FOUR_CONFIG);
  Object.assign(old.stats.attackLamp, { damage: 2, range: 3, damageBonus: 1 });
  const next = updateSavedBalance(old, 2);
  assert.equal(next.stats.attackLamp.damage, 0);
  assert.equal(next.stats.attackLamp.range, 0);
  assert.equal(next.stats.attackLamp.damageBonus, DEFAULT_CONFIG.stats.attackLamp.damageBonus);
  assert.deepEqual(updateSavedBalance(old, BALANCE_REVISION), old);
  assert.deepEqual(validateConfig(old), old);
  const custom = clone(old); Object.assign(custom.stats.attackLamp, { damage: 4, range: 5, damageBonus: 3 });
  assert.deepEqual(updateSavedBalance(custom, 2), custom);
});

test('veteran auras grant both support types damage, one-cell attacks and defense', () => {
  const c = clone(REVISION_FOUR_CONFIG);
  const veteran = { ...p('veteran', 'shield', 0, 0, 0), reachedFarEdge: true };
  for (const type of ['attackLamp', 'defenseLamp']) {
    const support = p('support', type, 0, 1, 0);
    const near = p('near', 'archer', 1, 2, 0), far = p('far', 'archer', 1, 3, 0);
    const alone = state([support, near, far]);
    assert.equal(effective(support, alone, c).damage, 0);
    assert.equal(effective(support, alone, c).range, 0);
    assert.equal(attacks(support, near, alone, c), false);
    const buffed = state([veteran, support, near, far]);
    const stats = effective(support, buffed, c);
    assert.deepEqual(stats.sources, ['veteran']);
    assert.equal(stats.fortitude, 4); assert.equal(stats.damage, 1); assert.equal(stats.range, 1);
    assert.equal(attacks(support, near, buffed, c), true);
    assert.equal(attacks(support, far, buffed, c), false);
    assert.ok(analyze(buffed, c).get('near').attackers.some(a => a.id === support.id));
    const second = { ...p('second', 'shield', 0, 1, -1), reachedFarEdge: true };
    buffed.pieces.push(second);
    const stacked = effective(support, buffed, c);
    assert.equal(stacked.damage, 2); assert.equal(stacked.range, 1); assert.equal(stacked.fortitude, 5);
    assert.equal(attacks(support, far, buffed, c), false);
  }
});
