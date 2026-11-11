import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { cells, distance, movementPath, validateConfig, validateState, inspectCell, resolve, move, analyze, reachable } from '../dist/engine.js';
import { MOVE_LESSONS, createMoveLesson, renderMoveLesson, renderMoveExamples } from '../dist/onboarding-examples.js';
const icons = Object.fromEntries(['shield', 'archer', 'attackLamp', 'defenseLamp'].map(type => [type, '<path d="M1 1h1"/>']));
const sceneHtml = html => new Map([...html.matchAll(/<section class="lesson-scene" data-lesson-scene="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map(match => [match[1], match[2]]));

test('all lessons use isolated valid positions and the same combat preview as the real engine', () => {
  const defaults = structuredClone(DEFAULT_CONFIG);
  assert.equal(MOVE_LESSONS.length, 6);
  for (let index = 0; index < 5; index++) for (const advanced of [false, true]) for (const aura of index === 4 ? ['attack', 'defense'] : ['attack']) {
    const options = { advanced, aura, selected: index === 0, destination: index === 0 ? { q: -2, r: 3 } : null };
    const original = structuredClone(options), lesson = createMoveLesson(index, options);
    assert.doesNotThrow(() => validateConfig(lesson.config));
    assert.doesNotThrow(() => validateState(lesson.before, lesson.config));
    assert.doesNotThrow(() => validateState(lesson.position, lesson.config));
    assert.deepEqual(options, original);
    for (const type of Object.keys(DEFAULT_CONFIG.stats)) {
      const stats = { ...lesson.config.stats[type] }, expected = { ...DEFAULT_CONFIG.stats[type] };
      if (index === 0 && type === 'archer') expected.move = 3; // Explicit three-step training example.
      assert.deepEqual(stats, expected);
    }
    if (advanced && lesson.destination) {
      const preview = inspectCell(lesson.before, lesson.config, lesson.destination, lesson.moverId);
      assert.equal(preview.isPreview, true); assert.deepEqual([...lesson.report], [...preview.report]);
    }
  }
  assert.deepEqual(DEFAULT_CONFIG, defaults);
});

test('movement starts without a selected unit, cell, path or highlights; selection reveals legal moves', () => {
  const initial = createMoveLesson(0), initialHtml = renderMoveLesson(initial, icons);
  assert.equal(initial.config.size, 3); assert.equal(cells(initial.config).length, 37);
  assert.equal(initial.config.stats.archer.move, 3);
  assert.equal(initial.destination, null); assert.deepEqual(initial.path, []);
  assert.deepEqual(initial.available, []); assert.deepEqual(initial.enemyBlocked, []);
  assert.ok(initialHtml.includes('data-lesson-unit="blue" role="button" tabindex="0" aria-pressed="false"'));
  for (const absent of ['data-lesson-selected-unit', 'class="lesson-path-number"', 'class="lesson-path"', ' lesson-available', ' lesson-unit-cell', ' lesson-enemy-blocked']) assert.ok(!initialHtml.includes(absent), absent);
  assert.ok(initialHtml.includes('data-lesson-action="reset"'));
  assert.equal(createMoveLesson(0, { destination: { q: -2, r: 3 } }).destination, null, 'a stale destination does not select a unit');
  assert.equal(createMoveLesson(0, { advanced: true }).advanced, false);
  const selected = createMoveLesson(0, { selected: true }), selectedHtml = renderMoveLesson(selected, icons);
  assert.equal(selected.destination, null); assert.deepEqual(selected.path, []);
  assert.ok(selected.available.length > 0);
  assert.ok(selectedHtml.includes('data-lesson-selected-unit="blue"'));
  assert.ok(selectedHtml.includes('class="lesson-selection-ring"'));
  assert.ok(selectedHtml.includes(' lesson-unit-cell'));
  assert.ok(!selectedHtml.includes('class="lesson-path-number"'));
  assert.ok(selectedHtml.includes('data-lesson-action="reset"'));
});

test('every selected destination has the shortest legal numbered path, including straight and turning routes', () => {
  const active = createMoveLesson(0, { selected: true });
  for (const [destination, directionCount] of [[{ q: -2, r: 3 }, 1], [{ q: 0, r: 1 }, 2]]) {
    const lesson = createMoveLesson(0, { selected: true, destination });
    assert.equal(lesson.path.length, 4);
    const directions = lesson.path.slice(1).map((cell, i) => `${cell.q - lesson.path[i].q},${cell.r - lesson.path[i].r}`);
    assert.equal(new Set(directions).size, directionCount);
    const html = renderMoveLesson(lesson, icons);
    for (let step = 1; step <= 3; step++) assert.ok(html.includes(`y=".35em">${step}</text>`));
  }
  for (const cell of active.available) {
    const selected = createMoveLesson(0, { selected: true, destination: cell });
    assert.equal(selected.path.length - 1, cell.steps); assert.ok(cell.steps <= 3);
    assert.ok(!selected.path.some(step => step.q === 0 && step.r === 0), 'no route crosses the enemy');
    for (let i = 1; i < selected.path.length; i++) assert.equal(distance(selected.path[i - 1], selected.path[i], selected.config), 1);
  }
  assert.throws(() => createMoveLesson(0, { selected: true, destination: { q: 99, r: 99 } }), /Недоступная/);
});

test('the moved-back enemy blocks passage, allies allow passing, and occupied cells never allow stopping', () => {
  const active = createMoveLesson(0, { selected: true }), mover = active.before.pieces.find(piece => piece.id === 'blue');
  const enemy = active.before.pieces.find(piece => piece.id === 'enemy');
  assert.deepEqual({ q: enemy.q, r: enemy.r }, { q: 0, r: 0 });
  const behind = { q: 1, r: 0 };
  assert.ok(active.enemyBlocked.some(cell => cell.q === behind.q && cell.r === behind.r));
  assert.deepEqual(movementPath(mover, active.before, active.config, behind), []);
  const withoutEnemy = { ...active.before, pieces: active.before.pieces.filter(piece => piece.id !== 'enemy') };
  assert.equal(movementPath(mover, withoutEnemy, active.config, behind).length - 1, 3);
  assert.throws(() => createMoveLesson(0, { selected: true, destination: behind }), /Недоступная/);
  for (const occupied of active.before.pieces) {
    assert.ok(!active.available.some(cell => cell.q === occupied.q && cell.r === occupied.r));
    assert.throws(() => createMoveLesson(0, { selected: true, destination: occupied }), /Недоступная/);
  }
  const destination = { q: -2, r: 3 }, selected = createMoveLesson(0, { selected: true, destination });
  const friend = active.before.pieces.find(piece => piece.id === 'friend');
  assert.ok(selected.passesAlly);
  assert.ok(selected.path.slice(1, -1).some(cell => cell.q === friend.q && cell.r === friend.r));
  const moved = createMoveLesson(0, { destination, advanced: true });
  assert.deepEqual(moved.position.pieces.find(piece => piece.id === 'friend'), friend);
  assert.equal(moved.position.pieces.find(piece => piece.id === 'blue').r, destination.r);
});

test('melee and shooting reach are explored by real cell moves instead of action buttons', () => {
  const meleeStart = createMoveLesson(1);
  assert.equal(meleeStart.report.get('enemy').incoming, 0);
  assert.ok(meleeStart.position.pieces.find(piece => piece.id === 'enemy').r > meleeStart.position.pieces.find(piece => piece.id === 'blue').r, 'the archer is below the shield');
  const melee = createMoveLesson(1, { advanced: true, destination: { q: 0, r: 1 } });
  assert.equal(melee.report.get('enemy').incoming, DEFAULT_CONFIG.stats.shield.damage);
  assert.equal(melee.report.get('enemy').dead, true);
  const blocked = createMoveLesson(2);
  assert.equal(blocked.report.get('enemy').incoming, 0);
  assert.ok(blocked.report.get('blue').sources.includes('drummer'));
  assert.equal(blocked.report.get('blue').incoming, 0);
  assert.equal(blocked.report.get('wall').incoming, blocked.report.get('blue').damage);
  assert.equal(blocked.report.get('enemy').fortitude, DEFAULT_CONFIG.stats.archer.fortitude, 'shield does not add armor to the protected archer in this blocking example');
  assert.equal(distance(blocked.position.pieces.find(piece => piece.id === 'wall'), blocked.position.pieces.find(piece => piece.id === 'enemy'), blocked.config), 2);
  const risky = createMoveLesson(2, { selected: true, destination: { q: -1, r: 0 } });
  assert.ok(risky.position.pieces.some(piece => piece.id === 'wall'), 'shield is never removed by a synthetic action');
  assert.equal(risky.report.get('blue').incoming, DEFAULT_CONFIG.stats.archer.damage + DEFAULT_CONFIG.stats.shield.damage, 'approaching the shield enters both its melee reach and the enemy archer range');
  const before = createMoveLesson(3), after = createMoveLesson(3, { advanced: true, destination: { q: -1, r: 0 } });
  assert.equal(before.canHit, false); assert.equal(after.canHit, true);
  assert.equal(after.report.get('enemy').incoming, DEFAULT_CONFIG.stats.archer.damage);
  assert.equal(after.report.get('blue').incoming, 0);
});

test('both auras improve allies while support stays unarmed without a veteran', () => {
  for (const aura of ['attack', 'defense']) {
    const before = createMoveLesson(4, { aura }), after = createMoveLesson(4, { aura, placement: aura === 'attack' ? { q: 1, r: -2 } : { q: -1, r: 0 }, selected: true });
    const initial = before.report.get('blue'), buffed = after.report.get('blue');
    assert.ok(!initial.sources.includes('support')); assert.ok(buffed.sources.includes('support'));
    assert.equal(after.report.get('support').damage, 0); assert.equal(after.report.get('support').range, 0);
    if (aura === 'attack') {
      assert.equal(buffed.damage - initial.damage, DEFAULT_CONFIG.stats.attackLamp.damageBonus); assert.equal(buffed.range - initial.range, 0);
      assert.equal(before.report.get('enemy').dead, false); assert.equal(after.report.get('enemy').dead, true);
    } else {
      assert.equal(buffed.fortitude - initial.fortitude, DEFAULT_CONFIG.stats.defenseLamp.defenseBonus); assert.equal(initial.incoming, DEFAULT_CONFIG.stats.shield.damage + DEFAULT_CONFIG.shieldPromotion.allies.damageBonus); assert.equal(buffed.incoming, initial.incoming);
      assert.equal(initial.dead, true); assert.equal(buffed.dead, false);
    }
  }
});

test('all examples appear on one page with unique SVG ids and independent states and resets', () => {
  // Mask identifiers are opaque, unique per render; they do not represent lesson state.
  const stable = html => html.replace(/token-(type|wreath|target)-\d+/g,'token-$1-ID');
  const initialHtml = renderMoveExamples({}, icons), initial = sceneHtml(initialHtml);
  assert.deepEqual([...initial.keys()], ['0', '1', '2', '3', '4-attack', '4-defense']);
  assert.deepEqual([...initialHtml.matchAll(/ПРИМЕР (\d+) ИЗ (\d+)/g)].map(match => `${match[1]}/${match[2]}`), ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
  for (const absent of ['lesson-menu', 'lesson-variants', 'data-lesson-route', 'data-lesson-aura', 'role="tab']) assert.ok(!initialHtml.includes(absent), absent);
  assert.doesNotMatch(initialHtml, /\shidden(?:\s|=|>)/, 'examples remain visible');
  const ids = [...initialHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const ref of initialHtml.matchAll(/url\(#([^\)]+)\)/g)) assert.ok(ids.includes(ref[1]), ref[1]);
  const state = { '1': { advanced: true, destination: { q: 1, r: 0 } }, '4-defense': { selected: true, placement: { q: -1, r: 0 } } }, original = structuredClone(state);
  const modified = sceneHtml(renderMoveExamples(state, icons)); assert.deepEqual(state, original);
  for (const key of ['0', '2', '3', '4-attack']) assert.equal(stable(modified.get(key)), stable(initial.get(key)));
  assert.notEqual(modified.get('1'), initial.get('1')); assert.notEqual(modified.get('4-defense'), initial.get('4-defense'));
  const reset = sceneHtml(renderMoveExamples({ ...state, '1': { advanced: false } }, icons));
  assert.equal(stable(reset.get('1')), stable(initial.get('1'))); assert.equal(stable(reset.get('4-defense')), stable(modified.get('4-defense')));
});

test('every figure receives the same effective combat report for its game-style badges', () => {
  const reports = [];
  const html = renderMoveExamples({}, icons, info => { reports.push(info); return `<g data-training-damage="${info.damage}" data-training-durability="${info.fortitude - info.incoming}"></g>`; });
  assert.equal(reports.length, 24); assert.equal((html.match(/class="lesson-unit-badges"/g) || []).length, 24);
  for (const info of reports) for (const field of ['damage', 'range', 'fortitude', 'incoming']) assert.equal(typeof info[field], 'number');
  assert.ok(html.includes('Ходим по кратчайшему пути.'));
  assert.ok(html.includes('За один ход лукарь может пройти до трёх шагов.'));
  assert.ok(html.includes('Выбери его, чтобы увидеть доступные клетки.'));
  assert.ok(html.includes('Сквозь врага пройти нельзя, сквозь союзника — можно: он пропустит.'));
  assert.ok(html.includes('Закончить ход на клетке, где уже стоит любая фишка, нельзя.'));
});


test('a hover route previews without moving; a completed click move clears the route and only offers reset', () => {
  const destination = { q: -2, r: 3 }, preview = createMoveLesson(0, { selected: true, destination });
  assert.deepEqual(preview.position, preview.before);
  assert.equal(preview.position.pieces.find(piece => piece.id === 'blue').r, 0);
  const previewHtml = renderMoveLesson(preview, icons);
  assert.equal((previewHtml.match(/class="lesson-path-number"/g) || []).length, 3);
  assert.ok(previewHtml.includes('class="lesson-path"'));
  assert.equal((previewHtml.match(/data-lesson-position=/g) || []).length, 37);
  assert.ok(previewHtml.includes('data-lesson-action="reset"'));
  assert.ok(!previewHtml.includes('Передвинуть лукаря'));
  const moved = createMoveLesson(0, { advanced: true, destination }), movedHtml = renderMoveLesson(moved, icons);
  assert.equal(moved.position.pieces.find(piece => piece.id === 'blue').r, 3);
  assert.ok(!movedHtml.includes('class="lesson-path-number"'));
  assert.ok(!movedHtml.includes('class="lesson-path"'));
  assert.ok(!movedHtml.includes('data-lesson-cell='));
  assert.ok(movedHtml.includes('data-lesson-action="reset"'));
  assert.ok(!movedHtml.includes('data-lesson-action="advance"'));
});


test('both supports use actual reachable cells and resolve a single real move before reset', () => {
  for (const aura of ['attack', 'defense']) {
    const initial = createMoveLesson(4, { aura }), selected = createMoveLesson(4, { aura, selected: true });
    const source = initial.before.pieces.find(piece => piece.id === 'support');
    assert.equal(initial.config.stats[source.type].move, DEFAULT_CONFIG.stats[source.type].move);
    assert.deepEqual(initial.available, []); assert.deepEqual(initial.auraCells, []);
    assert.deepEqual(selected.available, reachable(source, initial.before, initial.config));
    assert.ok(selected.available.length > 0 && selected.available.length < 34);
    const allowed = new Set(selected.available.map(cell => cell.q + ',' + cell.r));
    for (const cell of cells(initial.config)) {
      const options = { aura, selected: true, placement: cell };
      if (!allowed.has(cell.q + ',' + cell.r)) {
        assert.throws(() => createMoveLesson(4, options), /Недоступная/);
        assert.throws(() => createMoveLesson(4, { aura, selected: true, previewPlacement: cell }), /Недоступная/);
        continue;
      }
      assert.ok(movementPath(source, initial.before, initial.config, cell).length - 1 <= DEFAULT_CONFIG.stats[source.type].move);
      const placed = createMoveLesson(4, options), expected = move(initial.before, initial.config, 'support', cell);
      assert.deepEqual(placed.position, expected.state); assert.deepEqual(placed.deaths, expected.deaths);
      assert.deepEqual([...placed.report], [...expected.report]); assert.deepEqual(placed.available, []);
      assert.doesNotThrow(() => validateState(placed.position, placed.config));
    }
    const placement = aura === 'attack' ? { q: 1, r: -2 } : { q: -1, r: 0 };
    const active = createMoveLesson(4, { aura, selected: true, placement });
    const deselected = createMoveLesson(4, { aura, placement });
    assert.deepEqual(deselected.auraCells, []); assert.deepEqual(deselected.position, active.position);
    assert.deepEqual([...deselected.report], [...active.report]);
    assert.ok(active.report.get('blue').sources.includes('support'));
  }
});

test('all movement scenes share select, numbered hover forecast and cell-click commit with no advance buttons', () => {
  const destinations = [{ q: -2, r: 3 }, { q: 0, r: 1 }, { q: -2, r: 0 }, { q: -1, r: 0 }];
  for (let index = 0; index < 4; index++) {
    const initial = createMoveLesson(index), initialHtml = renderMoveLesson(initial, icons);
    assert.deepEqual(initial.available, []); assert.deepEqual(initial.path, []);
    assert.ok(initialHtml.includes('data-lesson-unit="blue"'));
    assert.ok(!initialHtml.includes('data-lesson-cell=')); assert.ok(!initialHtml.includes('data-lesson-action="advance"'));
    const selected = createMoveLesson(index, { selected: true }); assert.ok(selected.available.length > 0);
    const destination = destinations[index], preview = createMoveLesson(index, { selected: true, destination });
    assert.equal(preview.isPreview, true); assert.deepEqual(preview.position, preview.before);
    const real = inspectCell(preview.before, preview.config, destination, 'blue');
    assert.equal(real.isPreview, true); assert.deepEqual(preview.previewPosition, real.position);
    assert.deepEqual([...preview.report], [...real.report]);
    const html = renderMoveLesson(preview, icons);
    assert.ok(html.includes('lesson-preview-origin')); assert.ok(html.includes('class="lesson-preview-piece"'));
    assert.equal(html.includes('class="lesson-path-number"'), index === 0); assert.ok(!html.includes('data-lesson-action="advance"'));
    const committed = createMoveLesson(index, { advanced: true, destination });
    assert.deepEqual(committed.position, move(preview.before, preview.config, 'blue', destination).state); assert.equal(committed.isPreview, false);
    assert.ok(!renderMoveLesson(committed, icons).includes('class="lesson-path-number"'));
    assert.ok(renderMoveLesson(committed, icons).includes('data-lesson-action="reset"'));
  }
});

test('support hover forecasts combat without moving or removing any piece', () => {
  for (const aura of ['attack', 'defense']) {
    const placement = aura === 'attack' ? { q: 1, r: -2 } : { q: -1, r: 0 };
    const hover = createMoveLesson(4, { aura, selected: true, previewPlacement: placement });
    assert.deepEqual(hover.position, hover.before); assert.equal(hover.isPreview, true);
    assert.equal(hover.position.pieces.length, aura === 'attack' ? 7 : 6); assert.equal(hover.deaths.length, 0);
    assert.equal(hover.previewPosition.pieces.find(piece => piece.id === 'support').q, placement.q);
    assert.ok(hover.report.get('blue').sources.includes('support'));
    const real = inspectCell(hover.before, hover.config, placement, 'support');
    assert.deepEqual(hover.previewPosition, real.position); assert.deepEqual([...hover.report], [...real.report]);
    const committed = createMoveLesson(4, { aura, placement });
    assert.deepEqual([...hover.report], [...committed.report]);
    assert.ok(renderMoveLesson(hover, icons).includes('class="lesson-preview-piece"'));
    assert.ok(!renderMoveLesson(committed, icons).includes('class="lesson-preview-piece"'));
  }
});

test('only the first example shows step numbers, and no example draws combat arrows or crosses over occupied cells', () => {
  const goals = [{ q: -2, r: 3 }, { q: 0, r: 1 }, { q: -2, r: 0 }, { q: -1, r: 0 }];
  for (let index = 0; index < 4; index++) {
    const html = renderMoveLesson(createMoveLesson(index, { selected: true, destination: goals[index] }), icons);
    assert.equal(html.includes('class="lesson-path-number"'), index === 0);
    for (const extra of ['<marker', 'marker-end=', 'lesson-shot', 'lesson-enemy-shot', 'lesson-blocked-shot']) assert.ok(!html.includes(extra));
  }
  const initial = createMoveLesson(0, { selected: true }), html = renderMoveLesson(initial, icons);
  const emptyBlocked = initial.enemyBlocked.filter(cell => !initial.position.pieces.some(piece => piece.q === cell.q && piece.r === cell.r));
  assert.equal((html.match(/class="lesson-blocked-cross"/g) || []).length, emptyBlocked.length);
  assert.ok(!html.includes('translate(19,-20)" d='), 'no cross fragments protrude from occupied cells');
});

test('the fifth example lets the drummer enable a safe lethal shot against an enemy archer', () => {
  const initial = createMoveLesson(4, { aura: 'attack' });
  assert.equal(initial.position.pieces.find(piece => piece.id === 'enemy').type, 'archer');
  assert.equal(initial.canHit, true); assert.equal(initial.report.get('enemy').incoming, initial.report.get('blue').damage + initial.report.get('second').damage); assert.equal(initial.report.get('enemy').dead, false);
  const preview = createMoveLesson(4, { aura: 'attack', selected: true, previewPlacement: { q: 1, r: -2 } });
  assert.equal(preview.canHit, true); assert.equal(preview.report.get('enemy').dead, true);
  assert.equal(preview.report.get('blue').dead, false); assert.equal(preview.report.get('blue').incoming, DEFAULT_CONFIG.stats.archer.damage);
  const placed = createMoveLesson(4, { aura: 'attack', selected: true, placement: { q: 1, r: -2 } });
  assert.deepEqual([...preview.report], [...placed.report]);
  assert.ok(placed.feedback.includes('Погибли:'));
  assert.ok(!placed.position.pieces.some(piece => piece.id === 'enemy'));
  const resolved = resolve(placed.position, placed.config);
  assert.ok(resolved.state.pieces.some(piece => piece.id === 'blue'));
  assert.ok(!resolved.state.pieces.some(piece => piece.id === 'enemy'));
});

test('removing the shield in example three exposes a nonlethal shot and reset can restore the blocker', () => {
  const initial = createMoveLesson(2), removed = createMoveLesson(2, { shieldRemoved: true });
  assert.equal(initial.report.get('enemy').incoming, 0);
  assert.ok(renderMoveLesson(initial, icons).includes('data-lesson-action="remove-shield"'));
  assert.ok(!removed.position.pieces.some(piece => piece.id === 'wall'));
  assert.equal(removed.report.get('enemy').incoming, removed.report.get('blue').damage);
  assert.equal(removed.report.get('enemy').dead, false); assert.equal(removed.report.get('blue').incoming, 0);
  const result = resolve(removed.position, removed.config);
  assert.ok(result.state.pieces.some(piece => piece.id === 'enemy'));
  assert.ok(result.state.pieces.some(piece => piece.id === 'blue'));
  const removedHtml = sceneHtml(renderMoveExamples({ '2': { shieldRemoved: true } }, icons)).get('2');
  assert.ok(!removedHtml.includes('data-lesson-piece="wall"'));
  assert.ok(!removedHtml.includes('data-lesson-action="remove-shield"'));
  assert.ok(removedHtml.includes('data-lesson-action="reset"'));
  assert.ok(removedHtml.includes('Расчёт завершён'));
  assert.ok(removedHtml.includes('data-lesson-piece="enemy"'));
  assert.deepEqual(createMoveLesson(2, { shieldRemoved: false }).position, initial.position);
});

test('the sixth example lets the banner turn a lethal shield clash into survival', () => {
  const initial = createMoveLesson(4, { aura: 'defense' });
  const placement = { q: -1, r: 0 };
  const preview = createMoveLesson(4, { aura: 'defense', selected: true, previewPlacement: placement });
  const placed = createMoveLesson(4, { aura: 'defense', selected: true, placement });
  assert.equal(initial.position.pieces.find(piece => piece.id === 'blue').type, 'shield');
  assert.equal(initial.position.pieces.find(piece => piece.id === 'enemy').type, 'shield');
  assert.equal(initial.report.get('blue').incoming, initial.report.get('blue').fortitude);
  assert.equal(initial.report.get('blue').dead, true);
  assert.ok(!resolve(initial.position, initial.config).state.pieces.some(piece => piece.id === 'blue'));
  assert.equal(placed.report.get('blue').incoming, initial.report.get('blue').incoming);
  assert.equal(placed.report.get('blue').fortitude, initial.report.get('blue').fortitude + DEFAULT_CONFIG.stats.defenseLamp.defenseBonus);
  assert.equal(placed.report.get('blue').dead, false); assert.equal(placed.report.get('support').incoming, 0);
  assert.equal(placed.report.get('enemy').fortitude, initial.report.get('enemy').fortitude, 'enemy receives no banner bonus');
  assert.deepEqual([...preview.report], [...placed.report]);
  assert.equal(preview.position.pieces.find(piece => piece.id === 'support').q, -2, 'hover preserves the real banner position');
  const result = resolve(placed.position, placed.config);
  assert.ok(result.state.pieces.some(piece => piece.id === 'blue'));
  assert.ok(result.state.pieces.some(piece => piece.id === 'support'));
  assert.ok(!result.state.pieces.some(piece => piece.id === 'enemy'));
  const deselected = createMoveLesson(4, { aura: 'defense', placement });
  assert.deepEqual(deselected.auraCells, []); assert.deepEqual([...deselected.report], [...placed.report]);
  assert.ok(placed.feedback.includes('Расчёт завершён'));
  assert.ok(placed.position.pieces.some(piece => piece.id === 'blue'));
  assert.ok(!placed.position.pieces.some(piece => piece.id === 'enemy'));
  const html = renderMoveLesson(placed, icons);
  assert.ok(html.includes('Стойкость броненосца')); assert.ok(!html.includes('стойкость лукаря'));
  assert.equal(createMoveLesson(4, { aura: 'defense' }).report.get('blue').dead, true, 'reset restores the unprotected setup');
});


test('every legal lesson move removes exactly the engine deaths and renders surviving pieces with fresh combat badges', () => {
  for (let index = 0; index < 5; index++) for (const aura of index === 4 ? ['attack', 'defense'] : ['attack']) {
    const selected = createMoveLesson(index, { aura, selected: true });
    for (const cell of selected.available) {
      const committed = createMoveLesson(index, { aura, advanced: true, ...(index === 4 ? { placement: cell } : { destination: cell }) });
      const real = move(selected.before, selected.config, selected.moverId, cell);
      assert.deepEqual(committed.position, real.state); assert.deepEqual(committed.deaths, real.deaths);
      assert.deepEqual([...committed.report], [...real.report]);
      assert.deepEqual([...committed.displayReport], [...analyze(real.state, selected.config)]);
      const html = renderMoveLesson(committed, icons);
      for (const piece of selected.before.pieces) assert.equal(html.includes('data-lesson-piece="' + piece.id + '"'), real.state.pieces.some(p => p.id === piece.id));
      assert.ok(!html.includes('lesson-preview-piece')); assert.ok(!html.includes('lesson-path-number'));
      const reselected = createMoveLesson(index, { aura, advanced: true, selected: true, ...(index === 4 ? { placement: cell } : { destination: cell }) });
      assert.deepEqual(reselected.position, real.state); assert.deepEqual(reselected.available, []);
    }
  }
});

test('every example always has its own reset button in the right details panel', () => {
  const html = renderMoveExamples({}, icons);
  assert.equal((html.match(/data-lesson-action="reset"/g) || []).length, 6);
  for (const scene of sceneHtml(html).values()) assert.ok(scene.slice(scene.indexOf('<div class="lesson-details">')).includes('data-lesson-action="reset"'));
  assert.ok(!html.includes('переставляется свободно'));
  assert.ok(html.includes('class="button primary" data-lesson-action="remove-shield"'));
});

test('lesson presentation shows the original board during movement, shared death effects, then only survivors', () => {
  for (const [index, options] of [[1, { advanced: true, destination: { q: 0, r: 1 } }], [2, { shieldRemoved: true }], [2, { advanced: true, destination: { q: -2, r: 0 } }],
    [4, { aura: 'attack', placement: { q: 1, r: -2 } }], [4, { aura: 'defense', placement: { q: -1, r: -2 } }]]) {
    const lesson = createMoveLesson(index, options), snapshot = structuredClone(lesson.position);
    if (lesson.path.length) {
      const moving = renderMoveLesson(lesson, icons, () => '', { phase: 'movement' });
      for (const piece of lesson.before.pieces) assert.ok(moving.includes(`data-lesson-piece="${piece.id}"`));
      assert.ok(moving.includes('moving-origin')); assert.ok(moving.includes('class="moving-token'));
      assert.ok(moving.includes('aria-busy="true"')); assert.ok(!moving.includes('data-lesson-unit='));
      assert.ok(!moving.includes('death-ghost'));
    }
    const dying = renderMoveLesson(lesson, icons, () => '', { phase: 'deaths' });
    assert.equal((dying.match(/class="death-ghost /g) || []).length, lesson.deaths.length);
    assert.equal((dying.match(/class="death-pulse"/g) || []).length, lesson.deaths.length);
    for (const dead of lesson.deaths) assert.ok(!dying.includes(`data-lesson-piece="${dead.id}"`));
    const settled = renderMoveLesson(lesson, icons);
    assert.ok(!settled.includes('death-ghost')); assert.ok(!settled.includes('moving-token'));
    assert.ok(settled.includes('aria-busy="false"')); assert.deepEqual(lesson.position, snapshot);
  }
});
