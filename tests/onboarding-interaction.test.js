import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMoveLesson, renderMoveLesson } from '../dist/onboarding-examples.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const scenes = ['0', '1', '2', '3', '4-attack', '4-defense'];
function setup() {
  let handler;
  const body = { scrollTop: 180, addEventListener(type, callback) { handler = callback; }, querySelector() { return { focus() {} }; } };
  const context = vm.createContext({ onboardingExamples: {}, createMoveLesson, $: () => body, renderOnboarding() { body.scrollTop = 0; } });
  vm.runInContext(app.slice(app.indexOf('function onboardingLessonModel('), app.indexOf('function refreshOnboardingMovePreview(')), context);
  vm.runInContext(app.slice(app.indexOf("$('#onboarding-body').addEventListener('click'"), app.indexOf("$('#onboarding-body').addEventListener('keydown'")), context);
  return {
    state: context.onboardingExamples, body,
    click(sceneKey, data = {}, control = true) {
      const scene = sceneKey ? { dataset: { lessonScene: sceneKey } } : null;
      const element = { dataset: data, closest(selector) { return selector === '[data-lesson-scene]' ? scene : control ? element : null; } };
      handler({ target: element });
    }
  };
}

test('clicking outside legal moves or repeating the unit click clears selection and its forecast in every lesson', () => {
  for (const key of scenes) for (const cancel of ['unit', 'unavailable-cell', 'other-piece', 'background']) {
    const ui = setup();
    ui.state[key] = { selected: true, advanced: false, destination: { q: -2, r: 1 }, previewPlacement: { q: 0, r: 1 }, placement: null };
    if (cancel === 'unit') ui.click(key, { lessonUnit: key.startsWith('4-') ? 'support' : 'blue' });
    else ui.click(cancel === 'background' ? null : key, cancel === 'unavailable-cell' ? { lessonPosition: '3,0' } : { lessonPiece: 'enemy' }, false);
    const state = ui.state[key];
    assert.equal(state.selected, false); assert.equal(state.destination, null); assert.equal(state.previewPlacement, null);
    assert.equal(state.placement, null);
    assert.equal(state.advanced, false); assert.equal(ui.body.scrollTop, 180);
    const lesson = createMoveLesson(key.startsWith('4-') ? 4 : Number(key), { ...state, aura: key === '4-defense' ? 'defense' : 'attack' });
    assert.deepEqual(lesson.available, []); assert.deepEqual(lesson.auraCells || [], []); assert.deepEqual(lesson.path, []);
    assert.ok(!renderMoveLesson(lesson, {}).includes('lesson-preview-piece'));
  }
});

test('legal cell clicks commit one real move and combat, and cannot be repeated without reset', () => {
  const goals = { '0': '-2,3', '1': '0,1', '2': '-2,0', '3': '-1,0', '4-attack': '1,-2', '4-defense': '-1,0' };
  for (const key of scenes) {
    const ui = setup(), support = key.startsWith('4-');
    ui.state[key] = { selected: true, advanced: false, destination: null, placement: null, previewPlacement: null };
    ui.click(key, support ? { lessonPlace: goals[key] } : { lessonCell: goals[key] });
    const state = ui.state[key];
    assert.equal(state.advanced, true); assert.equal(state.selected, false);
    const options = { ...state, aura: key === '4-defense' ? 'defense' : 'attack' };
    const committed = createMoveLesson(support ? 4 : Number(key), options);
    assert.equal(committed.completed, true);
    assert.deepEqual(committed.available, []);
    for (const fallen of committed.deaths) assert.ok(!committed.position.pieces.some(piece => piece.id === fallen.id));
    ui.click(key, { lessonUnit: support ? 'support' : 'blue' });
    ui.click(key, support ? { lessonPlace: '3,0' } : { lessonCell: '3,0' });
    assert.deepEqual(createMoveLesson(support ? 4 : Number(key), { ...state, aura: options.aura }).position, committed.position);
    ui.click(null, {}, false);
    assert.equal(state.selected, false); assert.equal(state.advanced, true);
    assert.deepEqual(createMoveLesson(support ? 4 : Number(key), { ...state, aura: options.aura }).position, committed.position);
    ui.click(key, { lessonAction: 'reset' });
    const reset = createMoveLesson(support ? 4 : Number(key), { ...state, aura: options.aura });
    assert.equal(reset.completed, false); assert.deepEqual(reset.position, reset.before);
  }
});

test('switching examples clears selection while preserving a completed move and combat', () => {
  const ui = setup(), placement = { q: 1, r: -2 };
  ui.state['4-attack'] = { selected: true, advanced: true, placement, previewPlacement: null };
  ui.state['2'] = { selected: false, advanced: true, destination: { q: -2, r: 0 } };
  ui.click('1', { lessonUnit: 'blue' });
  assert.equal(ui.state['1'].selected, true); assert.equal(ui.state['4-attack'].selected, false);
  assert.equal(ui.state['4-attack'].previewPlacement, null); assert.equal(ui.state['4-attack'].placement, placement);
  assert.equal(ui.state['2'].advanced, true); assert.equal(ui.state['2'].destination.q, -2);
});

test('support cannot move to occupied cells or beyond its configured movement radius', () => {
  for (const key of ['4-attack', '4-defense']) {
    const ui = setup();
    ui.click(key, { lessonUnit: 'support' });
    for (const target of ['99,99', '3,0', '-3,3']) {
      ui.click(key, { lessonPlace: target });
      assert.equal(ui.state[key].placement, null); assert.equal(ui.state[key].advanced, false);
    }
  }
});

test('the shield removal button works without selection and reset restores the third example', () => {
  const ui = setup();
  ui.click('2', { lessonAction: 'remove-shield' });
  assert.equal(ui.state['2'].shieldRemoved, true);
  const removed = createMoveLesson(2, ui.state['2']);
  assert.equal(removed.report.get('enemy').dead, true);
  ui.click('2', { lessonUnit: 'blue' });
  ui.click('2', { lessonPiece: 'enemy' }, false);
  assert.equal(ui.state['2'].selected, false); assert.equal(ui.state['2'].shieldRemoved, true);
  ui.click('2', { lessonAction: 'reset' });
  assert.equal(ui.state['2'].shieldRemoved, false);
  assert.deepEqual(createMoveLesson(2, ui.state['2']).position, createMoveLesson(2).position);
});
