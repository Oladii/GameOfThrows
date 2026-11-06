import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { cells, distance, movementPath, validateConfig, validateState, inspectCell, resolve } from '../dist/engine.js';
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
  assert.ok(!initialHtml.includes('data-lesson-action='));
  assert.equal(createMoveLesson(0, { destination: { q: -2, r: 3 } }).destination, null, 'a stale destination does not select a unit');
  assert.equal(createMoveLesson(0, { advanced: true }).advanced, false);
  const selected = createMoveLesson(0, { selected: true }), selectedHtml = renderMoveLesson(selected, icons);
  assert.equal(selected.destination, null); assert.deepEqual(selected.path, []);
  assert.ok(selected.available.length > 0);
  assert.ok(selectedHtml.includes('data-lesson-selected-unit="blue"'));
  assert.ok(selectedHtml.includes('class="lesson-selection-ring"'));
  assert.ok(selectedHtml.includes(' lesson-unit-cell'));
  assert.ok(!selectedHtml.includes('class="lesson-path-number"'));
  assert.ok(!selectedHtml.includes('data-lesson-action='));
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

test('melee requires approaching, and the enemy shield intercepts shots aimed behind it', () => {
  assert.equal(createMoveLesson(1).report.get('enemy').incoming, 0);
  const melee = createMoveLesson(1, { advanced: true });
  assert.equal(melee.report.get('enemy').incoming, 15); assert.equal(melee.report.get('enemy').dead, true);
  const blocked = createMoveLesson(2), open = createMoveLesson(2, { advanced: true });
  assert.equal(blocked.report.get('wall').incoming, 12); assert.equal(blocked.report.get('enemy').incoming, 0);
  assert.equal(blocked.canHit, false); assert.equal(open.report.get('enemy').incoming, 12); assert.equal(open.canHit, true);
  for (const lesson of [blocked, open]) {
    const blue = lesson.report.get('blue');
    assert.ok(blue.sources.includes('drummer')); assert.equal(blue.range, 4); assert.equal(blue.damage, 12);
    assert.equal(blue.incoming, 0); assert.equal(blue.dead, false);
    assert.ok(resolve(lesson.position, lesson.config).state.pieces.some(piece => piece.id === 'blue'));
    assert.equal(lesson.report.get('drummer').damage, 0);
  }
  assert.equal(blocked.report.get('wall').dead, false);
  assert.equal(blocked.report.get('enemy').dead, false);
  assert.equal(open.report.get('enemy').dead, true);
});

test('moving the archer two cells brings the enemy within its three-cell shooting range', () => {
  const before = createMoveLesson(3), after = createMoveLesson(3, { advanced: true });
  assert.equal(before.path.length - 1, 2); assert.equal(before.canHit, false); assert.equal(after.canHit, true);
  assert.equal(before.report.get('enemy').incoming, 0); assert.equal(after.report.get('enemy').incoming, 8);
  assert.equal(after.report.get('enemy').dead, false); assert.equal(after.report.get('blue').incoming, 0);
});

test('both auras improve allies while support stays unarmed without a veteran', () => {
  for (const aura of ['attack', 'defense']) {
    const before = createMoveLesson(4, { aura }), after = createMoveLesson(4, { aura, placement: { q: 0, r: 1 }, selected: true });
    const initial = before.report.get('blue'), buffed = after.report.get('blue');
    assert.ok(!initial.sources.includes('support')); assert.ok(buffed.sources.includes('support'));
    assert.equal(after.report.get('support').damage, 0); assert.equal(after.report.get('support').range, 0);
    if (aura === 'attack') {
      assert.equal(buffed.damage - initial.damage, 4); assert.equal(buffed.range - initial.range, 1);
      assert.equal(before.report.get('enemy').dead, false); assert.equal(after.report.get('enemy').dead, false);
    } else {
      assert.equal(buffed.fortitude - initial.fortitude, 2); assert.equal(initial.incoming, 8); assert.equal(buffed.incoming, 8);
      assert.equal(initial.dead, true); assert.equal(buffed.dead, true);
    }
  }
});

test('all examples appear on one page with unique SVG ids and independent states and resets', () => {
  const initialHtml = renderMoveExamples({}, icons), initial = sceneHtml(initialHtml);
  assert.deepEqual([...initial.keys()], ['0', '1', '2', '3', '4-attack', '4-defense']);
  assert.deepEqual([...initialHtml.matchAll(/ПРИМЕР (\d+) ИЗ (\d+)/g)].map(match => `${match[1]}/${match[2]}`), ['1/6', '2/6', '3/6', '4/6', '5/6', '6/6']);
  for (const absent of ['lesson-menu', 'lesson-variants', 'data-lesson-route', 'data-lesson-aura', 'role="tab', 'hidden']) assert.ok(!initialHtml.includes(absent), absent);
  const ids = [...initialHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const ref of initialHtml.matchAll(/url\(#([^\)]+)\)/g)) assert.ok(ids.includes(ref[1]), ref[1]);
  const state = { '1': { advanced: true }, '4-defense': { selected: true, placement: { q: 0, r: 1 } } }, original = structuredClone(state);
  const modified = sceneHtml(renderMoveExamples(state, icons)); assert.deepEqual(state, original);
  for (const key of ['0', '2', '3', '4-attack']) assert.equal(modified.get(key), initial.get(key));
  assert.notEqual(modified.get('1'), initial.get('1')); assert.notEqual(modified.get('4-defense'), initial.get('4-defense'));
  const reset = sceneHtml(renderMoveExamples({ ...state, '1': { advanced: false } }, icons));
  assert.equal(reset.get('1'), initial.get('1')); assert.equal(reset.get('4-defense'), modified.get('4-defense'));
});

test('every figure receives the same effective combat report for its game-style badges', () => {
  const reports = [];
  const html = renderMoveExamples({}, icons, info => { reports.push(info); return `<g data-training-damage="${info.damage}" data-training-durability="${info.fortitude - info.incoming}"></g>`; });
  assert.equal(reports.length, 17); assert.equal((html.match(/class="lesson-unit-badges"/g) || []).length, 17);
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
  assert.ok(!previewHtml.includes('data-lesson-action='));
  assert.ok(!previewHtml.includes('Передвинуть лукаря'));
  const moved = createMoveLesson(0, { advanced: true, destination }), movedHtml = renderMoveLesson(moved, icons);
  assert.equal(moved.position.pieces.find(piece => piece.id === 'blue').r, 3);
  assert.ok(!movedHtml.includes('class="lesson-path-number"'));
  assert.ok(!movedHtml.includes('class="lesson-path"'));
  assert.ok(!movedHtml.includes('data-lesson-cell='));
  assert.ok(movedHtml.includes('data-lesson-action="reset"'));
  assert.ok(!movedHtml.includes('data-lesson-action="advance"'));
});


test('both support examples allow free empty-cell placement and show the aura only while selected', () => {
  for (const aura of ['attack', 'defense']) {
    const initial = createMoveLesson(4, { aura });
    assert.deepEqual(initial.auraCells, []); assert.deepEqual(initial.available, []);
    const selected = createMoveLesson(4, { aura, selected: true });
    assert.ok(selected.auraCells.length > 0); assert.equal(selected.available.length, 34);
    const selectedHtml = renderMoveLesson(selected, icons);
    assert.ok(selectedHtml.includes('data-lesson-unit="support"'));
    assert.ok(selectedHtml.includes('data-lesson-place="0,1"'));
    assert.ok(!selectedHtml.includes('data-lesson-cell='));
    assert.ok(!selectedHtml.includes('data-lesson-action="advance"'));
    for (const cell of selected.available) {
      const placed = createMoveLesson(4, { aura, selected: true, placement: cell });
      assert.doesNotThrow(() => validateState(placed.position, placed.config));
      assert.equal(placed.position.pieces.find(piece => piece.id === 'support').q, cell.q);
      assert.equal(placed.position.pieces.find(piece => piece.id === 'support').r, cell.r);
    }
    const placement = { q: 0, r: 1 };
    const active = createMoveLesson(4, { aura, selected: true, placement });
    const deselected = createMoveLesson(4, { aura, selected: false, placement });
    assert.deepEqual(deselected.auraCells, []); assert.deepEqual(deselected.available, []);
    assert.deepEqual(deselected.report.get('blue'), active.report.get('blue'), 'hiding the aura does not remove its gameplay effect');
    assert.ok(active.report.get('blue').sources.includes('support'));
    const away = createMoveLesson(4, { aura, selected: true, placement: { q: -2, r: 1 } });
    assert.ok(!away.report.get('blue').sources.includes('support'));
    for (const invalid of [{ q: 0, r: 0 }, { q: 3, r: 0 }, { q: 99, r: 99 }]) assert.throws(() => createMoveLesson(4, { aura, placement: invalid }), /пустую клетку/);
  }
});
