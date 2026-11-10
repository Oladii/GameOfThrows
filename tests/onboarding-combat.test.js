import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatLesson, renderCombatExamples } from '../dist/onboarding-examples.js';
import { analyze } from '../dist/engine.js';

test('escape is vertical, red while threatened and safe to the side with a real legal move', () => {
  const initial = createCombatLesson(0), blue = initial.before.pieces[0], enemy = initial.before.pieces[1];
  assert.equal(blue.q, enemy.q); assert.ok(enemy.r > blue.r);
  assert.ok(Math.abs(initial.point(blue).x - initial.point(enemy).x) < 1e-10);
  assert.ok(initial.point(enemy).y < initial.point(blue).y);
  assert.equal(initial.report.get('blue').incoming, 2);
  assert.match(initial.description, /сверху появляется входящий урон/);
  const safe = createCombatLesson(0, { advanced: true, destination: { q: 1, r: 0 } });
  assert.equal(safe.report.get('blue').incoming, 0);
  assert.equal(safe.report.get('blue').fortitude, 5);
  const exposed = createCombatLesson(0, { advanced: true, destination: { q: 0, r: 1 } });
  assert.equal(exposed.report.get('blue').incoming, 2);
});

test('sum example starts nonlethal and requires movement, with two shots killing where one cannot', () => {
  const initial = createCombatLesson(1);
  assert.equal(initial.report.get('enemy').incoming, 2);
  assert.equal(initial.report.get('enemy').dead, false);
  const destination = { q: -2, r: 0 };
  const two = createCombatLesson(1, { advanced: true, destination });
  assert.equal(two.report.get('enemy').incoming, 4);
  assert.ok(!two.position.pieces.some(p => p.id === 'enemy'));
  const one = createCombatLesson(1, { advanced: true, destination, secondArcher: false });
  assert.equal(one.report.get('enemy').incoming, 2);
  assert.ok(one.position.pieces.some(p => p.id === 'enemy'));
  assert.equal(analyze(one.position, one.config).get('enemy').fortitude, 4);
});

test('vertical shield example starts apart and a real approach ends with both deaths at once', () => {
  const initial = createCombatLesson(2), [blue, enemy] = initial.before.pieces;
  assert.equal(blue.q, enemy.q); assert.equal(enemy.r - blue.r, 2);
  assert.ok(Math.abs(initial.point(blue).x - initial.point(enemy).x) < 1e-10);
  assert.ok(initial.point(enemy).y < initial.point(blue).y);
  assert.equal(initial.report.get('blue').incoming, 0);
  assert.equal(initial.report.get('enemy').incoming, 0);
  assert.ok(!initial.description.includes('?'));
  const complete = createCombatLesson(2, { advanced: true, destination: { q: 0, r: 1 } });
  assert.equal(complete.deaths.length, 2); assert.equal(complete.position.pieces.length, 2);
  assert.equal(complete.report.get('blue').incoming, 5); assert.equal(complete.report.get('enemy').incoming, 5);
  const html = renderCombatExamples({}, {});
  assert.equal((html.match(/data-lesson-unit=/g) || []).length, 3);
  assert.ok(!html.includes('Выстрелить')); assert.ok(!html.includes('Показать бой'));
  for (const number of [1, 2, 3]) assert.ok(html.includes(`ПРИМЕР ${number} ИЗ 3`));
});
