import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnitLesson } from '../dist/onboarding-units.js';
import { createMoveLesson, renderMoveLesson } from '../dist/onboarding-examples.js';
import { unitAppearance, renderMovingToken, renderDeathEffects } from '../dist/board-presentation.js';

test('training moves and death effects display the controlled army as the orange South', () => {
  const moving = renderMoveLesson(createMoveLesson(0), {}, () => '', { phase: 'movement' });
  assert.ok(/class="moving-token south(?: fatal)?"/.test(moving));
  assert.ok(moving.includes('rotate(180 0 '));
  assert.ok(moving.includes('Ваши — Юг'));
  const defeat = createUnitLesson('archer', { advanced: true, destination: { q: 0, r: -1 } });
  const death = renderMoveLesson(defeat, {}, () => '', { phase: 'deaths' });
  assert.ok(death.includes('class="death-ghost south"'));
  assert.ok(!death.includes('class="death-ghost north"'));
  assert.ok(death.includes('rotate(180 0 '));
});

test('a display perspective does not change the real game teams, veteran status or default rendering', () => {
  const lesson = createMoveLesson(0), archer = lesson.before.pieces.find(piece => piece.id === 'blue');
  const original = structuredClone(archer);
  assert.ok(unitAppearance(archer, lesson.config, { archer: 'bow' }, 1).icon.includes('rotate(-90 12 12)'));
  assert.ok(unitAppearance(archer, lesson.config, { archer: 'bow' }).icon.includes('rotate(90 12 12)'));
  assert.deepEqual(archer, original);
  const frame = { x: 0, y: 0, progress: 0 };
  assert.ok(renderMovingToken(archer, frame, {}).includes('moving-token north'));
  assert.ok(renderDeathEffects([archer], () => frame, '', {}).includes('death-ghost north'));
  const edge = { id: 'edge', type: 'shield', team: 0, q: -1, r: lesson.config.size };
  assert.equal(unitAppearance(edge, lesson.config, {}, 1).veteran, true);
});
