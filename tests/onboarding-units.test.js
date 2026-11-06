import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG, TYPES } from '../dist/rules.js';
import { move, reachable, shieldCanRetreat } from '../dist/engine.js';
import { createUnitLesson, renderUnitExamples, badgeExamples } from '../dist/onboarding-units.js';
import { renderMoveLesson } from '../dist/onboarding-examples.js';

test('badge explanations use actual attack, threat and death values from the game engine', () => {
  const [safe, threatened, lethal] = badgeExamples();
  assert.equal(safe.info.damage, 15); assert.equal(safe.info.fortitude, 15); assert.equal(safe.info.incoming, 0);
  assert.equal(threatened.info.fortitude - threatened.info.incoming, 7);
  assert.equal(threatened.info.incoming, 8); assert.equal(threatened.info.dead, false);
  assert.equal(lethal.info.incoming, 16); assert.equal(lethal.info.dead, true);
  const html = renderUnitExamples({}, {});
  assert.ok(html.indexOf('Значения на бейджах') < html.indexOf('data-lesson-scene="unit-shield"'));
  assert.match(html, /Под огнём бейдж красный/);
  assert.equal((html.match(/data-lesson-scene="unit-/g) || []).length, 4);
  assert.ok(!html.includes('lesson-unit-selected'));
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /const onboardingSteps = \['Идея', 'Фигуры', 'Ход', 'Бой', 'Старт'\]/);
});

test('every figure has a safe strong move and an actual dangerous alternative without changing the rules', () => {
  const cases = [
    ['shield', { q: 0, r: 2 }, { q: 2, r: 1 }, 'friend'],
    ['archer', { q: -1, r: 0 }, { q: 0, r: 1 }, 'blue'],
    ['attackLamp', { q: 1, r: -2 }, { q: 3, r: -1 }, 'support'],
    ['defenseLamp', { q: -1, r: 0 }, { q: -3, r: 0 }, 'blue']
  ];
  for (const [type, good, bad, victim] of cases) {
    const initial = createUnitLesson(type), snapshot = JSON.stringify(initial.before);
    assert.deepEqual(initial.config.stats, DEFAULT_CONFIG.stats);
    assert.deepEqual(initial.available, []); assert.deepEqual(initial.auraCells, []);
    const selected = createUnitLesson(type, { selected: true });
    assert.deepEqual(selected.available, reachable(initial.before.pieces.find(p => p.id === initial.moverId), initial.before, initial.config));
    assert.ok(selected.auraCells.length > 0);
    const preview = createUnitLesson(type, { selected: true, destination: good });
    assert.equal(preview.report.get('enemy').dead, true);
    assert.deepEqual(preview.position, initial.position);
    assert.ok(!preview.report.get(victim).dead);
    assert.equal(JSON.stringify(initial.before), snapshot);
    const complete = createUnitLesson(type, { advanced: true, destination: good });
    assert.deepEqual(complete.position, move(initial.before, initial.config, initial.moverId, good).state);
    assert.ok(!complete.position.pieces.some(p => p.id === 'enemy'));
    assert.deepEqual(complete.available, []);
    const danger = createUnitLesson(type, { advanced: true, destination: bad });
    assert.equal(danger.report.get(victim).dead, true);
    assert.ok(!danger.position.pieces.some(p => p.id === victim));
    assert.ok(!renderMoveLesson(danger, {}).includes(`data-lesson-piece="${victim}"`));
    assert.deepEqual(createUnitLesson(type).position, initial.position);
  }
});

test('the shield can really promote, with the combined veteran aura, but still exposes its ally', () => {
  const preview = createUnitLesson('shield', { selected: true, destination: { q: -1, r: 3 } });
  assert.equal(shieldCanRetreat(preview.previewPosition.pieces.find(p => p.id === 'blue'), preview.config), true);
  assert.equal(preview.auraMask, 3);
  assert.match(renderMoveLesson(preview, {}), /id="lesson-unit-shield-aura-3"/);
  const completed = createUnitLesson('shield', { advanced: true, destination: { q: -1, r: 3 } });
  assert.equal(completed.position.pieces.find(p => p.id === 'blue').reachedFarEdge, true);
  assert.equal(completed.report.get('friend').dead, true);
});

test('support figures do not attack without a veteran and their own aura does not protect them', () => {
  for (const type of ['attackLamp', 'defenseLamp']) {
    const lesson = createUnitLesson(type);
    assert.equal(lesson.report.get('support').damage, 0);
    assert.equal(lesson.report.get('support').range, 0);
    assert.equal(lesson.report.get('support').fortitude, DEFAULT_CONFIG.stats[type].fortitude);
  }
});

