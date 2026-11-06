import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoveLesson, createCombatLesson, lessonPoint, renderMoveLesson } from '../dist/onboarding-examples.js';
import { createUnitLesson } from '../dist/onboarding-units.js';
import { reachable } from '../dist/engine.js';

test('all thirteen examples face the opponent upwards and offer an upward legal move', () => {
  const cases = [
    [createMoveLesson(0), { q: -2, r: 2 }],
    [createMoveLesson(1), { q: 0, r: 1 }],
    [createMoveLesson(2), { q: -2, r: 0 }],
    [createMoveLesson(3), { q: -1, r: 0 }],
    [createMoveLesson(4, { aura: 'attack' }), { q: 1, r: -1 }],
    [createMoveLesson(4, { aura: 'defense' }), { q: -1, r: 0 }],
    [createUnitLesson('shield'), { q: 0, r: 2 }],
    [createUnitLesson('archer'), { q: -1, r: 1 }],
    [createUnitLesson('attackLamp'), { q: 1, r: -1 }],
    [createUnitLesson('defenseLamp'), { q: -1, r: 0 }],
    [createCombatLesson(0), { q: 1, r: 0 }],
    [createCombatLesson(1), { q: -2, r: 0 }],
    [createCombatLesson(2), { q: 0, r: 1 }]
  ];
  for (const [lesson, goal] of cases) {
    const point = lesson.point || lessonPoint;
    const blue = lesson.before.pieces.find(piece => piece.id === 'blue');
    const mover = lesson.before.pieces.find(piece => piece.id === lesson.moverId);
    const enemy = lesson.before.pieces.find(piece => piece.id === 'enemy');
    assert.ok(point(enemy).y < point(blue).y, lesson.title + ': opponent is above the army');
    assert.ok(point(enemy).y < point(mover).y, lesson.title + ': opponent is above the controlled unit');
    assert.ok(point(goal).y < point(mover).y, lesson.title + ': the suggested move goes upwards');
    assert.ok(reachable(mover, lesson.before, lesson.config).some(cell => cell.q === goal.q && cell.r === goal.r), lesson.title + ': suggested move is legal');
  }
});

test('upward board coordinates, forecast and moving token use the same geometry', () => {
  const goal = { q: 0, r: 1 }, lesson = createCombatLesson(2, { selected: true, destination: goal });
  const p = lessonPoint(goal), origin = lessonPoint({ q: 0, r: 0 });
  const preview = renderMoveLesson(lesson, {});
  assert.ok(preview.includes(`class="lesson-preview-piece" transform="translate(${p.x},${p.y})"`));
  const moving = renderMoveLesson(lesson, {}, () => '', { phase: 'movement', frame: { ...origin, progress: 0 } });
  assert.ok(moving.includes(`data-progress="0" transform="translate(${origin.x},${origin.y})"`));
  assert.ok(p.y < origin.y);
});
