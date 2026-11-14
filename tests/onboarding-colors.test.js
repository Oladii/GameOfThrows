import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnitBattle } from '../dist/onboarding-showcase.js';
import { unitAppearance, renderMovingToken, renderDeathEffects } from '../dist/board-presentation.js';

test('a display perspective does not change the real game teams, veteran status or default rendering', () => {
  const lesson = createUnitBattle('unit-archer-veteran'), archer = { ...lesson.position.pieces.find(piece => piece.id === 'blue'), team: 0 };
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
