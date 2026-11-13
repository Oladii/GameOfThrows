import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMoveLesson, renderMoveLesson, renderMoveExamples, createCombatLesson, renderCombatExamples, lessonPoint } from '../dist/onboarding-examples.js';
import { renderUnitExamples } from '../dist/onboarding-units.js';
import { createShowcaseBattle, renderShowcaseBattle, ShowcaseBattle } from '../dist/onboarding-showcase.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { createMovementPlan, CombatAnimator, DEATH_EFFECT_DURATION } from '../dist/move-animation.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const scenes = ['0', '1', '2', '3', '4-attack', '4-defense'];
function setup({ reducedMotion = true } = {}) {
  let handler, keyboardHandler, cancelHandler, time = 0, id = 0, mediaHandler, closeHandler;
  const frames = new Map(), timers = new Map();
  let archiveActions = 0;
  const forbidArchive = () => { archiveActions++; throw new Error('Tutorial must not record a real action'); };
  const media = { matches: reducedMotion, addEventListener(type, callback) { mediaHandler = callback; } };
  const clock = { now: () => time, requestFrame: callback => { frames.set(++id, callback); return id; }, cancelFrame: handle => frames.delete(handle),
    setTimer: (callback, delay) => { timers.set(++id, { callback, at: time + delay }); return id; }, clearTimer: handle => timers.delete(handle) };
  const body = { scrollTop: 180, html: '', attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, showModal() { this.open = true; }, close() { this.open = false; closeHandler?.(); }, scrollIntoView() {}, token: { dataset: {}, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } }, focus() {},
    addEventListener(type, callback) { if (type === 'cancel') cancelHandler = callback; else if (type === 'keydown') keyboardHandler = callback; else handler = callback; }, querySelector(selector) { if (selector.startsWith('#lesson-moving-token-')) return this.token; const element = { dataset: { showcaseAction: selector.includes('next') ? 'next' : 'prev' }, focus() {}, scrollIntoView() {}, closest() { return element; }, click() { handler({ target: element }); } }; return element; } };
  const context = vm.createContext({ gamePhase: 'playing', editor: false, config: structuredClone(DEFAULT_CONFIG), state: { pieces: [{ id: 'main-piece', type: 'shield', team: 1, q: 0, r: 2 }], turn: 1, ply: 9, winner: null }, history: [{ original: true }], log: [{ text: 'Сохранённый ход' }], recordGameAction: forbidArchive, archiveRecorder: { record: forbidArchive }, cancelBot() {}, cancelMovement() {}, renderAbout() {}, requestAnimationFrame: callback => callback(), openStartSettings() { throw new Error('Playing tutorial must return to the current game'); }, onboardingExamples: {}, onboardingShowcase: null, onboardingUnitBattles: {}, ICON_PATHS:{}, unitBadges:()=>'', suppressGuideTabStops() {}, onboardingAnimation: null, onboardingPreviewByKeyboard: false, createMoveLesson, createCombatLesson, createShowcaseBattle, createMovementPlan, lessonPoint,
    ShowcaseBattle: class extends ShowcaseBattle { constructor(options){ super({...options,clock}); } },
    CombatAnimator: class extends CombatAnimator { constructor(onPhase, onFrame) { super(onPhase, onFrame, clock); } },
    matchMedia: () => media, movement: null, render() {}, onboardingStep: 2, onboardingSteps: ['Цель игры', 'Фигуры'],
    document: { querySelectorAll: () => [{ id: 'rules-dialog', addEventListener(type, callback) { closeHandler = callback; } }] },
    $: () => body, renderOnboarding() { body.scrollTop = 0; body.html = renderMoveExamples(context.onboardingExamples, {}, () => '', context.onboardingAnimation) + renderUnitExamples(context.onboardingUnitBattles, {}, () => '') + renderCombatExamples(context.onboardingExamples, {}, () => '', context.onboardingAnimation) + renderShowcaseBattle(context.onboardingShowcase || createShowcaseBattle(), {}, () => ''); } });
  vm.runInContext(app.slice(app.indexOf('function openAbout('), app.indexOf('function goToOnboardingStep(')), context);
  vm.runInContext(app.slice(app.indexOf('function onboardingLessonModel('), app.indexOf('function refreshOnboardingMovePreview(')), context);
  vm.runInContext(app.slice(app.indexOf("$('#onboarding-body').addEventListener('click'"), app.indexOf("$('#onboarding-body').addEventListener('keydown'")), context);
  vm.runInContext(app.slice(app.indexOf('function goToOnboardingStep('), app.indexOf("$('#onboarding-progress').addEventListener")), context);
  vm.runInContext(app.slice(app.indexOf("$('#onboarding-body').addEventListener('keydown'"), app.indexOf("$('#rules-open').addEventListener")), context);
  vm.runInContext(app.split('\n').find(line => line.startsWith("matchMedia('(prefers-reduced-motion: reduce)').addEventListener")), context);
  vm.runInContext(app.split('\n').find(line => line.startsWith("document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close'")), context);
  return {
    battle(sceneKey) { return context.onboardingUnitBattles[sceneKey]; },
    battleControl(sceneKey,data) {
      const scene={dataset:{showcaseBattle:sceneKey}};
      context.updateShowcaseBattle({dataset:data,closest:()=>scene});
    },
    get state() { return context.onboardingExamples; }, body, phase: () => context.onboardingAnimation?.phase || 'idle',
    showcase: () => context.onboardingShowcase || createShowcaseBattle(),
    open() { context.openAbout(); },
    mainSnapshot: () => JSON.stringify({ config: context.config, state: context.state, history: context.history, log: context.log, gamePhase: context.gamePhase }),
    archiveActions: () => archiveActions,
    activate(sceneKey, data, key = 'Enter') {
      const scene = { dataset: { lessonScene: sceneKey } };
      const element = { dataset: data, closest(selector) { return selector === '[data-lesson-scene]' ? scene : element; } };
      keyboardHandler({ key, target: element, preventDefault() {} });
    },
    key(key, inBattle = false) { let prevented = false; keyboardHandler({ key, target: { closest() { return inBattle ? {} : null; } }, preventDefault() { prevented = true; } }); return prevented; },
    advance(ms) { time += ms; const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach(callback => callback());
      for (const [handle, timer] of [...timers]) if (timer.at <= time) { timers.delete(handle); timer.callback(); } },
    reduce() { media.matches = true; mediaHandler({ matches: true }); },
    close() { closeHandler(); },
    cancelDialog() { let prevented = false; cancelHandler({ preventDefault() { prevented = true; } }); return prevented; },
    goToStep(step) { context.goToOnboardingStep(step); },
    staleFrames: () => [...frames.values()], staleTimers: () => [...timers.values()].map(timer => timer.callback),
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
  const goals = { '0': '-2,3', '1': '0,1', '2': '-2,1', '3': '-1,0', '4-attack': '-1,0', '4-defense': '-1,1' };
  for (const key of scenes) {
    const ui = setup(), support = key.startsWith('4-');
    ui.state[key] = { selected: true, advanced: false, destination: null, placement: null, previewPlacement: null };
    ui.click(key, support ? { lessonPlace: goals[key] } : { lessonCell: goals[key] });
    const state = ui.state[key];
    assert.equal(state.advanced, true); assert.equal(state.selected, false);
    const options = { ...state, aura: key === '4-defense' ? 'defense' : 'attack' };
    const committed = createMoveLesson(support ? 4 : Number(key), options);
    assert.equal(committed.completed, true);
    assert.equal(committed.success, true, key);
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
  const ui = setup(), placement = { q: -1, r: 0 };
  ui.state['4-attack'] = { selected: true, advanced: true, placement, previewPlacement: null };
  ui.state['2'] = { selected: false, advanced: true, destination: { q: -2, r: 1 } };
  ui.click('1', { lessonUnit: 'blue' });
  assert.equal(ui.state['1'].selected, true); assert.equal(ui.state['4-attack'].selected, false);
  assert.equal(ui.state['4-attack'].previewPlacement, null); assert.equal(ui.state['4-attack'].placement, placement);
  assert.equal(ui.state['2'].advanced, true); assert.equal(ui.state['2'].destination.q, -2);
});

test('support cannot move to occupied cells or beyond its configured movement radius', () => {
  for (const key of ['4-attack', '4-defense']) {
    const ui = setup();
    ui.click(key, { lessonUnit: 'support' });
    const lesson = createMoveLesson(4, { aura: key === '4-defense' ? 'defense' : 'attack', selected: true });
    for (const target of ['99,99', ...lesson.before.pieces.map(piece => `${piece.q},${piece.r}`)]) {
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
  assert.equal(removed.report.get('enemy').dead, false);
  ui.click('2', { lessonUnit: 'blue' });
  ui.click('2', { lessonPiece: 'enemy' }, false);
  assert.equal(ui.state['2'].selected, false); assert.equal(ui.state['2'].shieldRemoved, true);
  ui.click('2', { lessonAction: 'reset' });
  assert.equal(ui.state['2'].shieldRemoved, false);
  assert.deepEqual(createMoveLesson(2, ui.state['2']).position, createMoveLesson(2).position);
});

test('animated actions move before showing the shared death effect and then remove it', () => {
  for (const [key, goal] of [['1', '0,1'], ['4-attack', '-1,0'], ['4-defense', '-1,1']]) {
    const ui = setup({ reducedMotion: false }), support = key.startsWith('4-');
    ui.click(key, { lessonUnit: support ? 'support' : 'blue' });
    ui.click(key, support ? { lessonPlace: goal } : { lessonCell: goal });
    assert.equal(ui.phase(), 'movement'); assert.ok(ui.body.html.includes(`id="lesson-moving-token-${key}"`));
    assert.ok(!ui.body.html.includes('class="death-effects"')); assert.equal(ui.body.scrollTop, 180);
    const committed = JSON.stringify(ui.state[key]);
    ui.click('0', { lessonUnit: 'blue' }); assert.equal(ui.state['0'], undefined, 'new actions wait for presentation to finish');
    const duringMove = ui.body.html; ui.click(null, {}, false); assert.equal(ui.body.html, duringMove);
    ui.advance(120); assert.equal(ui.phase(), 'movement');
    assert.ok(Number(ui.body.token.dataset.progress) > 0 && Number(ui.body.token.dataset.progress) < 1);
    assert.ok(ui.body.token.attrs.transform.startsWith('translate('));
    ui.advance(500);
    const lesson = createMoveLesson(support ? 4 : Number(key), { ...ui.state[key], aura: key === '4-defense' ? 'defense' : 'attack' });
    assert.equal(lesson.success, true);
    if (lesson.deaths.length) {
      assert.equal(ui.phase(), 'deaths'); assert.ok(ui.body.html.includes('class="death-effects"'));
      assert.ok(ui.body.html.includes('death-ghost')); assert.ok(ui.body.html.includes('death-skull'));
      ui.advance(DEATH_EFFECT_DURATION - 1); assert.equal(ui.phase(), 'deaths');
      ui.advance(1);
    }
    assert.equal(ui.phase(), 'idle'); assert.ok(!ui.body.html.includes('class="death-effects"'));
    assert.ok(!ui.body.html.includes(`id="lesson-moving-token-${key}"`));
    assert.equal(JSON.stringify(ui.state[key]), committed, 'animation never repeats the move or combat');
    assert.equal(ui.body.scrollTop, 180);
  }
});

test('removing the blocker exposes a nonlethal shot and reset cancels movement timers', () => {
  const ui = setup({ reducedMotion: false });
  ui.click('2', { lessonAction: 'remove-shield' });
  assert.equal(ui.phase(), 'idle'); const timers = ui.staleTimers();
  ui.click('2', { lessonAction: 'reset' });
  assert.equal(ui.phase(), 'idle'); assert.equal(ui.state['2'].shieldRemoved, false);
  const afterReset = ui.body.html; timers.forEach(callback => callback());
  assert.equal(ui.body.html, afterReset);
  ui.click('1', { lessonUnit: 'blue' }); ui.click('1', { lessonCell: '0,1' });
  const frames = ui.staleFrames();
  ui.click('1', { lessonAction: 'reset' }); frames.forEach(callback => callback());
  assert.equal(ui.phase(), 'idle'); assert.equal(ui.state['1'].advanced, false);
  assert.ok(!ui.body.html.includes('death-ghost'));
});

test('step changes and reduced motion settle animations without replaying combat', () => {
  const ui = setup({ reducedMotion: false });
  ui.click('1', { lessonUnit: 'blue' }); ui.click('1', { lessonCell: '0,1' });
  const frames = ui.staleFrames(), committed = JSON.stringify(ui.state['1']);
  ui.goToStep(1); frames.forEach(callback => callback());
  assert.equal(ui.phase(), 'idle'); assert.equal(JSON.stringify(ui.state['1']), committed);
  ui.click('1', { lessonAction: 'reset' }); ui.goToStep(2);
  ui.click('1', { lessonUnit: 'blue' }); ui.click('1', { lessonCell: '0,1' });
  const beforeReduce = JSON.stringify(ui.state['1']);
  ui.reduce(); ui.advance(5000);
  assert.equal(ui.phase(), 'idle'); assert.ok(!ui.body.html.includes('death-ghost'));
  assert.equal(JSON.stringify(ui.state['1']), beforeReduce);
  const reduced = setup(); reduced.click('2', { lessonAction: 'remove-shield' });
  assert.equal(reduced.phase(), 'idle'); assert.ok(!reduced.body.html.includes('death-ghost'));
});

test('nonlethal moves finish without death effects and closing the dialog cancels the pending presentation', () => {
  const ui = setup({ reducedMotion: false });
  ui.click('0', { lessonUnit: 'blue' }); ui.click('0', { lessonCell: '-2,3' });
  assert.equal(ui.phase(), 'movement'); ui.advance(500);
  assert.equal(ui.phase(), 'idle'); assert.ok(!ui.body.html.includes('death-ghost'));
  ui.click('1', { lessonUnit: 'blue' }); ui.click('1', { lessonCell: '0,1' });
  const frames = ui.staleFrames(), committed = JSON.stringify(ui.state['1']), html = ui.body.html;
  ui.close(); frames.forEach(callback => callback()); ui.advance(5000);
  assert.equal(ui.phase(), 'idle'); assert.equal(JSON.stringify(ui.state['1']), committed);
  assert.equal(ui.body.html, html, 'a closed dialog is not repainted by stale callbacks');
});

test('unit examples and combat commit a real move, animate deaths and reset through the existing handlers', () => {
  const goals = { '8': '1,0', '9': '-2,0', '10': '0,1', '11': '0,1' };
  for (const [key, goal] of Object.entries(goals)) {
    const ui = setup({ reducedMotion: false }), support = key.startsWith('unit-') && !['unit-shield', 'unit-archer'].includes(key);
    ui.click(key, { lessonUnit: support ? 'support' : 'blue' });
    assert.equal(ui.state[key].selected, true);
    ui.click(key, { lessonCell: goal });
    assert.equal(ui.phase(), 'movement');
    assert.equal(ui.state[key].advanced, true);
    const state = JSON.stringify(ui.state[key]);
    ui.advance(500);
    const completed = createCombatLesson(Number(key) - 8, ui.state[key]);
    assert.equal(completed.success, true, key);
    assert.equal(ui.phase(), completed.deaths.length ? 'deaths' : 'idle');
    ui.advance(DEATH_EFFECT_DURATION);
    assert.equal(ui.phase(), 'idle');
    assert.equal(JSON.stringify(ui.state[key]), state);
    assert.ok(!ui.body.html.includes('death-ghost'));
    ui.click(key, { lessonAction: 'reset' });
    assert.equal(ui.state[key].advanced, false);
    assert.equal(ui.state[key].selected, false);
    assert.equal(ui.state[key].destination, null);
    assert.equal(ui.body.scrollTop, 180);
  }
});

test('new unit and combat examples cancel selection on repeat and outside clicks, and reject an illegal move', () => {
  for (const key of ['8', '9', '10', '11']) {
    const ui = setup(), unit = key.startsWith('unit-') && !['unit-shield', 'unit-archer'].includes(key) ? 'support' : 'blue';
    ui.click(key, { lessonUnit: unit }); ui.click(key, { lessonUnit: unit });
    assert.equal(ui.state[key].selected, false);
    ui.click(key, { lessonUnit: unit }); ui.click(null, {}, false);
    assert.equal(ui.state[key].selected, false);
    ui.click(key, { lessonUnit: unit }); ui.click(key, { lessonCell: '99,99' });
    assert.equal(ui.state[key].advanced, false);
  }
});

test('removing a contributing archer resets the sum example without inventing a shoot action', () => {
  const ui = setup();
  ui.click('9', { lessonUnit: 'blue' }); ui.click('9', { lessonCell: '-2,0' });
  assert.equal(createCombatLesson(1, ui.state['9']).report.get('enemy').incoming, 4);
  ui.click('9', { lessonAction: 'toggle-archer' });
  assert.equal(ui.state['9'].advanced, false);
  assert.equal(ui.state['9'].secondArcher, false);
  ui.click('9', { lessonUnit: 'blue' }); ui.click('9', { lessonCell: '-2,0' });
  assert.equal(createCombatLesson(1, ui.state['9']).report.get('enemy').incoming, 2);
  ui.click('9', { lessonAction: 'reset' });
  assert.equal(ui.state['9'].secondArcher, true);
  assert.ok(!ui.body.html.includes('Выстрелить'));
});

test('keyboard forecast survives scrolling under a stationary pointer until the mouse actually moves', () => {
  const scene = { dataset: { lessonScene: '8' } }, state = { selected: true, advanced: false, destination: null };
  const cell = position => ({ dataset: { lessonCell: position }, closest(selector) { return selector === '[data-lesson-scene]' ? scene : this; } });
  let refreshed = 0;
  const context = vm.createContext({ onboardingAnimation: null, onboardingPreviewByKeyboard: false, onboardingExamples: { '8': state }, refreshOnboardingMovePreview() { refreshed++; } });
  vm.runInContext(app.slice(app.indexOf('function onboardingPreviewTarget('), app.indexOf("$('#onboarding-body').addEventListener('pointerover'")), context);
  context.previewOnboardingMove({ type: 'focusin', target: cell('1,0') });
  assert.equal(state.destination.q, 1); assert.equal(state.destination.r, 0);
  context.previewOnboardingMove({ type: 'pointerover', target: cell('0,1') });
  context.previewOnboardingMove({ type: 'pointermove', target: cell('0,1'), movementX: 0, movementY: 0 });
  context.clearOnboardingMovePreview({ type: 'pointerout', target: cell('0,1'), relatedTarget: null });
  assert.equal(state.destination.q, 1); assert.equal(state.destination.r, 0); assert.equal(refreshed, 1);
  context.previewOnboardingMove({ type: 'pointermove', target: cell('0,1'), movementX: 1, movementY: 0 });
  assert.equal(state.destination.q, 0); assert.equal(state.destination.r, 1);
  context.clearOnboardingMovePreview({ type: 'pointerout', target: cell('0,1'), relatedTarget: null });
  assert.equal(state.destination, null);
});

test('training keyboard forecasts also survive stationary pointer events after a redraw', () => {
  let destination;
  const battle = { busy:false, viewedPosition:{pieces:[]}, preview(cell) { destination = cell; } };
  const context = vm.createContext({ ensureShowcaseBattle:()=>battle, onboardingPreviewByKeyboard:false });
  vm.runInContext(app.slice(app.indexOf('function previewShowcaseMove('), app.indexOf("$('#onboarding-body').addEventListener('pointerover'")),context);
  const cell = coordinates => ({ dataset:{showcaseCell:coordinates}, closest(selector) { return selector === '[data-showcase-cell]' ? this : selector === '[data-showcase-battle]' ? {dataset:{showcaseBattle:'main'}} : null; } });
  context.previewShowcaseMove({type:'focusin',target:cell('0,-1')});
  context.previewShowcaseMove({type:'pointerover',target:cell('-1,0')});
  context.previewShowcaseMove({type:'pointermove',target:cell('-1,0'),movementX:0,movementY:0});
  assert.equal(destination.q,0); assert.equal(destination.r,-1);
  context.previewShowcaseMove({type:'pointermove',target:cell('-1,0'),movementX:1,movementY:0});
  assert.equal(destination.q,-1); assert.equal(destination.r,0);
});

test('Escape cancel keeps the onboarding open without cancelling its current presentation', () => {
  const ui = setup({ reducedMotion: false });
  ui.click('1', { lessonUnit: 'blue' }); ui.click('1', { lessonCell: '0,1' });
  const phase = ui.phase(), state = JSON.stringify(ui.state), html = ui.body.html;
  assert.equal(ui.cancelDialog(), true);
  assert.equal(ui.phase(), phase); assert.equal(JSON.stringify(ui.state), state); assert.equal(ui.body.html, html);
  ui.close(); assert.equal(ui.phase(), 'idle');
});

test('opening, pointer and keyboard tutorial moves, reset and close leave the main game and archive untouched', () => {
  const ui = setup(), before = ui.mainSnapshot();
  ui.open();
  assert.equal(ui.mainSnapshot(), before);
  assert.equal(ui.body.open, true);
  for (const scene of ['1', '0']) {
    ui.goToStep(2);
    ui.activate(scene, {lessonUnit:'blue'});
    assert.equal(ui.state[scene].selected,true);
    const cell=createMoveLesson(Number(scene),ui.state[scene]).available[0];
    if(scene==='1')ui.activate(scene,{lessonCell:`${cell.q},${cell.r}`},' ');
    else ui.click(scene,{lessonCell:`${cell.q},${cell.r}`});
    assert.equal(ui.state[scene].advanced,true);
    assert.equal(ui.mainSnapshot(),before);
    ui.click(scene,{lessonAction:'reset'});
    assert.equal(ui.state[scene].advanced,false);
  }
  ui.goToStep(4);
  ui.body.close();
  assert.equal(ui.body.open, false);
  assert.equal(ui.mainSnapshot(), before);
  assert.equal(ui.archiveActions(), 0);
});




test('all four battle controllers route independently and close cancels them without touching the saved game',()=>{
  const ui=setup(),before=ui.mainSnapshot();
  for(const scene of ['unit-shield','unit-shield-defense','unit-drum-shield','unit-archer']){
    const id=scene==='unit-archer'?'commander':'blue';
    ui.battleControl(scene,{showcasePiece:id});
    const battle=ui.battle(scene);
    assert.equal(battle.selectedId,id);
    ui.battleControl(scene,{showcaseCell:`${battle.expectedAction.to.q},${battle.expectedAction.to.r}`});
    assert.equal(ui.mainSnapshot(),before);
  }
  assert.notEqual(ui.battle('unit-shield'),ui.battle('unit-shield-defense'));
  ui.close();ui.advance(5000);
  for(const scene of ['unit-shield','unit-shield-defense','unit-drum-shield','unit-archer']){
    assert.equal(ui.battle(scene).presentation,null);
    ui.battleControl(scene,{showcaseAction:'restart'});
    assert.equal(ui.battle(scene).position.ply,0);
  }
  assert.equal(ui.mainSnapshot(),before);assert.equal(ui.archiveActions(),0);
});
