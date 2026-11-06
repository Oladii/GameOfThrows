import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG, TYPES } from '../dist/rules.js';
import { move, reachable, shieldCanRetreat, analyze } from '../dist/engine.js';
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
  assert.equal((html.match(/data-lesson-scene="unit-/g) || []).length, 5);
  assert.ok(!html.includes('lesson-unit-selected'));
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /const onboardingSteps = \['Идея', 'Фигуры', 'Ход', 'Бой', 'Старт'\]/);
});

test('every figure has a safe strong move and an actual dangerous alternative without changing the rules', () => {
  const cases = [
    ['shield', { q: 0, r: 2 }, { q: 1, r: 1 }, 'blue'],
    ['archer', { q: -1, r: 1 }, { q: 0, r: -1 }, 'blue'],
    ['attackLamp', { q: 1, r: -2 }, { q: 3, r: -1 }, 'support'],
    ['scoutLamp', { q: 1, r: -2 }, { q: 3, r: -1 }, 'support'],
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

test('the shield can reach a free edge cell and promote next to the existing veteran', () => {
  const preview = createUnitLesson('shield', { selected: true, destination: { q: -2, r: 3 } });
  assert.equal(shieldCanRetreat(preview.previewPosition.pieces.find(p => p.id === 'blue'), preview.config), true);
  assert.equal(preview.auraMask, 3);
  const html = renderMoveLesson(preview, {});
  assert.equal((html.match(/class="aura-ring"/g) || []).length, 1);
  assert.match(html, /stroke="#9770be"/);
  const completed = createUnitLesson('shield', { advanced: true, destination: { q: -2, r: 3 } });
  assert.equal(completed.position.pieces.find(p => p.id === 'blue').reachedFarEdge, true);
  assert.equal(completed.report.get('blue').damage, 33);
  assert.equal(completed.report.get('veteran').damage, 33);
});

test('support figures do not attack without a veteran and their own aura does not protect them', () => {
  for (const type of ['attackLamp', 'defenseLamp', 'scoutLamp']) {
    const lesson = createUnitLesson(type);
    assert.equal(lesson.report.get('support').damage, 0);
    assert.equal(lesson.report.get('support').range, 0);
    assert.equal(lesson.report.get('support').fortitude, DEFAULT_CONFIG.stats[type].fortitude);
  }
});


test('the veteran starts on the far edge and both shields gain protection only while adjacent', () => {
  const initial = createUnitLesson('shield'), veteran = initial.before.pieces.find(piece => piece.id === 'veteran');
  assert.equal(veteran.r, initial.config.size);
  assert.equal(shieldCanRetreat(veteran, initial.config), true);
  assert.equal(initial.report.get('blue').fortitude, 15);
  assert.equal(initial.report.get('veteran').fortitude, 24);
  const close = createUnitLesson('shield', { selected: true, destination: { q: 0, r: 2 } });
  assert.equal(close.report.get('blue').fortitude, 24);
  assert.equal(close.report.get('blue').damage, 24);
  assert.equal(close.report.get('veteran').fortitude, 33);
  assert.ok(close.report.get('blue').sources.includes('veteran'));
  assert.ok(close.report.get('veteran').sources.includes('blue'));
  const withoutVeteran = analyze({ ...close.combatPosition, pieces: close.combatPosition.pieces.filter(piece => piece.id !== 'veteran') }, close.config);
  assert.equal(withoutVeteran.get('blue').fortitude, 15);
  assert.equal(withoutVeteran.get('blue').dead, true);
  assert.equal(close.report.get('blue').dead, false);
  const apart = createUnitLesson('shield', { selected: true, destination: { q: 1, r: 1 } });
  assert.equal(apart.report.get('blue').fortitude, 15);
  assert.equal(apart.report.get('veteran').fortitude, 24);
});

test('selecting the veteran uses his actual aura and forecasts his support while he moves', () => {
  const initial = createUnitLesson('shield', { selected: true, selectedId: 'veteran' });
  assert.equal(initial.selectedId, 'veteran'); assert.equal(initial.moverId, 'veteran');
  assert.equal(initial.auraMask, 3);
  assert.deepEqual(initial.available, reachable(initial.before.pieces.find(p => p.id === 'veteran'), initial.before, initial.config));
  const html = renderMoveLesson(initial, {});
  assert.ok(html.includes('data-lesson-selected-unit="veteran"'));
  assert.ok(html.includes('aria-label="Выбран: Броненосец-ветеран. Нажми, чтобы снять выбор"'));
  assert.ok(html.includes('data-aura-origin="-1,3"'));
  const preview = createUnitLesson('shield', { selected: true, selectedId: 'veteran', destination: { q: -1, r: 2 } });
  assert.deepEqual(preview.position, initial.position);
  assert.equal(preview.report.get('blue').damage, 24); assert.equal(preview.report.get('blue').fortitude, 24);
  assert.equal(preview.report.get('veteran').fortitude, 33);
  assert.ok(preview.facts.some(([label, value]) => label === 'Атака броненосца' && value === '15 → 24'));
  assert.ok(preview.facts.some(([label, value]) => label === 'Стойкость ветерана' && value === '24 → 33'));
  assert.ok(renderMoveLesson(preview, {}).includes('data-aura-origin="-1,2"'));
});

test('switching the inspected figure after a veteran move never repeats or changes that move', () => {
  const destination = { q: -1, r: 2 }, initial = createUnitLesson('shield');
  const options = { advanced: true, movedId: 'veteran', destination };
  const committed = createUnitLesson('shield', options);
  const expected = move(initial.before, initial.config, 'veteran', destination).state;
  assert.deepEqual(committed.position, expected);
  assert.ok(!committed.position.pieces.some(p => p.id === 'enemy'));
  for (const selectedId of ['blue', 'veteran']) {
    const inspected = createUnitLesson('shield', { ...options, selected: true, selectedId });
    assert.deepEqual(inspected.position, expected);
    assert.equal(inspected.moverId, 'veteran'); assert.equal(inspected.selectedId, selectedId);
    assert.deepEqual(inspected.available, []);
    const origin = selectedId === 'blue' ? '-1,1' : '-1,2';
    assert.ok(renderMoveLesson(inspected, {}).includes(`data-aura-origin="${origin}"`));
  }
});
