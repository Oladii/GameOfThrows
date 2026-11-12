import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIOUS_LOCAL_CONFIG as DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, move, reachable, validateState } from '../dist/engine.js';
import { createShowcaseBattle, renderShowcaseBattle, SHOWCASE_MOVES, showcasePoint } from '../dist/onboarding-showcase.js';

test('the showcase alternates real legal moves, starts with South and ends with a South victory', () => {
  const initial = createShowcaseBattle();
  assert.deepEqual(initial.config.stats, DEFAULT_CONFIG.stats);
  assert.equal(initial.position.turn, 1);
  assert.equal(initial.position.pieces.length, 10);
  assert.deepEqual(validateState(initial.position, initial.config), initial.position);
  for (let index = 1; index <= SHOWCASE_MOVES.length; index++) {
    const previous = createShowcaseBattle(index - 1), current = createShowcaseBattle(index), entry = SHOWCASE_MOVES[index - 1];
    const result = move(previous.position, previous.config, entry.id, entry.to);
    assert.equal(current.action.team, index % 2);
    assert.deepEqual(current.position, result.state);
    assert.deepEqual(current.deaths, result.deaths);
    assert.ok(current.comment.length > 0 && current.comment.length < 110);
    assert.ok(current.position.pieces.every(piece => ['shield', 'archer'].includes(piece.type)));
    assert.ok([...current.position.pieces, ...current.deaths].every(piece => !piece.reachedFarEdge));
  }
  const final = createShowcaseBattle(SHOWCASE_MOVES.length);
  assert.equal(final.position.winner, 1);
  assert.equal(final.position.pieces.filter(piece => piece.team === 0).length, 0);
  assert.ok(final.position.pieces.filter(piece => piece.team === 1).length > 0);
  assert.ok(final.position.pieces.filter(piece => piece.team === 1).length < 5);
});

test('back and forward return unchanged snapshots, with no cumulative damage or mutable cached state', () => {
  const first = createShowcaseBattle(1), last = createShowcaseBattle(99);
  const firstCount = first.position.pieces.length;
  first.position.pieces.length = 0;
  last.config.stats.archer.damage = 999;
  assert.equal(createShowcaseBattle(1).position.pieces.length, firstCount);
  assert.deepEqual(createShowcaseBattle(3).before, createShowcaseBattle(2).position);
  assert.equal(createShowcaseBattle(0).position.pieces.length, 10);
  assert.equal(createShowcaseBattle(-1).index, 0);
  assert.equal(createShowcaseBattle(999).index, SHOWCASE_MOVES.length);
  assert.equal(createShowcaseBattle().config.stats.archer.damage, DEFAULT_CONFIG.stats.archer.damage);
});

test('both armies start safely in horizontal ranks of three shields and two archers', () => {
  const initial = createShowcaseBattle();
  assert.ok([...analyze(initial.position, initial.config).values()].every(info => !info.dead));
  for (const team of [0, 1]) {
    assert.equal(initial.position.pieces.filter(piece => piece.team === team && piece.type === 'shield').length, 3);
    assert.equal(initial.position.pieces.filter(piece => piece.team === team && piece.type === 'archer').length, 2);
    const row = initial.position.pieces.filter(piece => piece.team === team).map(showcasePoint);
    assert.equal(new Set(row.map(point => point.y)).size, 1);
    assert.ok(row.every(point => team === 0 ? point.y < 205 : point.y > 205));
  }
});

test('North counterattacks and never takes a worse immediate material exchange than its legal alternatives', () => {
  let southLosses = 0;
  for (let index = 1; index <= SHOWCASE_MOVES.length; index++) {
    const battle = createShowcaseBattle(index);
    const ownLosses = battle.deaths.filter(piece => piece.team === 0).length;
    const enemyLosses = battle.deaths.filter(piece => piece.team === 1).length;
    southLosses += enemyLosses;
    if (battle.action.team !== 0) continue;
    const alternatives = battle.before.pieces.filter(piece => piece.team === 0).flatMap(piece =>
      reachable(piece, battle.before, battle.config).map(to => {
        const { deaths } = move(battle.before, battle.config, piece.id, to);
        return deaths.filter(piece => piece.team === 1).length - deaths.filter(piece => piece.team === 0).length;
      }));
    assert.equal(enemyLosses - ownLosses, Math.max(...alternatives), `North misses a better immediate exchange on move ${index}`);
  }
  assert.ok(southLosses >= 2, 'the victory must include real North counterattacks and South losses');
});

test('the viewer offers only two arrows, only the current actor’s comment and correct endpoint controls', () => {
  const initial = renderShowcaseBattle(0, {}), final = renderShowcaseBattle(99, {});
  assert.equal((initial.match(/data-showcase-action=/g) || []).length, 2);
  assert.match(initial, /data-showcase-action="prev"[^>]* disabled/);
  assert.ok(!initial.includes('data-lesson-unit='));
  assert.ok(!initial.includes('data-lesson-cell='));
  assert.equal((initial.match(/class="showcase-comment /g) || []).length, 1);
  assert.ok(initial.includes('<strong>Юг</strong>'));
  const northMove = renderShowcaseBattle(2, {});
  assert.ok(northMove.includes('<strong>Север</strong>'));
  assert.ok(!northMove.includes('<strong>Юг</strong>'));
  assert.ok(initial.includes('piece north') && initial.includes('piece south'));
  assert.ok(final.includes('Юг победил'));
  assert.match(final, /data-showcase-action="next"[^>]* disabled/);
  assert.ok(!final.includes('data-showcase-piece="n-'));
});
