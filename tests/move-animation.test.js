import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectCell, move, movementPath, validateConfig } from '../dist/engine.js';
import { createMovementPlan, sampleMovement, MovementAnimator } from '../dist/move-animation.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';

test('motion follows each route segment, eases at endpoints and clamps to its destination', () => {
  const points = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }], before = structuredClone(points);
  const plan = createMovementPlan(points);
  assert.deepEqual(sampleMovement(plan, -10), { x: 0, y: 0, progress: 0, done: false });
  assert.equal(sampleMovement(plan, plan.duration / 4).y, 0);
  assert.ok(sampleMovement(plan, plan.duration / 4).x < 30);
  assert.deepEqual(sampleMovement(plan, plan.duration / 2), { x: 60, y: 0, progress: .5, done: false });
  assert.equal(sampleMovement(plan, plan.duration * .75).x, 60);
  assert.deepEqual(sampleMovement(plan, plan.duration + 100), { x: 60, y: 60, progress: 1, done: true });
  assert.deepEqual(points, before);
  assert.ok(createMovementPlan([{ x: 0, y: 0 }, { x: 60, y: 0 }]).duration < plan.duration);
  assert.ok(createMovementPlan(Array.from({ length: 7 }, (_, x) => ({ x, y: 0 }))).duration <= 420);
});

test('invalid or stationary routes do not create an animation', () => {
  for (const route of [[], [{x:0,y:0}], [{x:0,y:0},{x:NaN,y:0}], [{x:1,y:1},{x:1,y:1}]]) assert.throws(() => createMovementPlan(route));
});

test('cancelled frames cannot finish or overwrite a replacement move', () => {
  let time = 0, id = 0, finishes = 0; const pending = new Map(), frames = [];
  const clock = { now: () => time, requestFrame: callback => { pending.set(++id, callback); return id; }, cancelFrame: handle => pending.delete(handle) };
  const animator = new MovementAnimator(frame => frames.push(frame), () => finishes++, clock);
  const first = createMovementPlan([{x:0,y:0},{x:60,y:0}]);
  animator.start(first); const stale = [...pending.values()][0];
  animator.cancel(); time = 1000; stale();
  assert.equal(finishes, 0); assert.equal(frames.length, 1);
  animator.start(createMovementPlan([{x:10,y:20},{x:30,y:40}])); const current = [...pending.values()][0];
  stale(); assert.equal(frames.length, 2);
  time = 2000; current(); current();
  assert.equal(finishes, 1); assert.equal(animator.active, false);
  assert.equal(frames.at(-1).x, 30); assert.equal(frames.at(-1).y, 40);
});

for (const scenario of ['restored mover', 'surviving mover', 'no casualties', 'reduced motion', 'interrupted']) test(`undo presentation: ${scenario}`, () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.geometry = 'square'; config.size = 6; config.victoryCondition = 'all-units';
  config.experiments.squareDiagonals = false;
  config.stats.archer.move = 5; config.stats.archer.damage = 12;
  if (scenario === 'surviving mover' || scenario === 'no casualties') {
    config.stats.archer.fortitude = 20;
    config.stats.archer.damage = 8;
  }
  if (scenario === 'no casualties') config.stats.shield.fortitude = 20;
  validateConfig(config);
  const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
  const pieces = [piece('mover', 'archer', 0, 0, 0), piece('wall', 'shield', 1, 1, 0),
    piece('enemy', 'archer', 1, 2, 0), piece('ally', 'shield', 0, 1, 1)];
  const state = { pieces, turn: 0, ply: 0, winner: null };
  const action = { id: 'mover', from: { q: 0, r: 0 }, to: { q: 3, r: 0 } };
  const result = move(state, config, action.id, action.to);
  const moverWasRemoved = ['restored mover', 'reduced motion', 'interrupted'].includes(scenario);
  assert.equal(result.deaths.some(dead => dead.id === action.id), moverWasRemoved);
  assert.equal(Boolean(result.deaths.length), scenario !== 'no casualties');

  const frames = [], source = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  let startTimer;
  const events = [];
  const context = vm.createContext({ config, movement: null, inspectCell, movementPath, createMovementPlan,
    matchMedia: () => ({ matches: scenario === 'reduced motion' }), point: ({ q, r }) => ({ x: q, y: r }),
    setTimeout(fn, delay) { assert.equal(delay, 200); startTimer = fn; return 1; },
    clearTimeout(id) { assert.equal(id, 1); startTimer = null; },
    gameAudio: { play(name) { events.push(name); return () => events.push('stop'); }, movement: () => ({ finish() {} }) },
    render() { frames.push(context.movement); events.push('render'); },
    tableRattle: null, roomMovePreview: null, combat: null, combatAnimator: { cancel() {} },
    moveAnimator: { start() { events.push('move'); }, cancel() {} },
    presentKills: () => assert.fail('undo started a combat sequence') });
  for (const name of ['cancelMovement', 'completeMovementPresentation', 'presentUndo']) {
    const start = source.indexOf(`function ${name}(`);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  context.presentUndo([{ before: { config, state, action }, after: result.state }]);
  if (scenario === 'reduced motion') {
    assert.deepEqual(events, ['render', 'remove']);
    assert.equal(frames[0], null);
    assert.equal(startTimer, undefined);
    return;
  }
  const [frame] = frames;
  assert.equal(frame.piece.id, action.id);
  assert.deepEqual(frame.before.state.pieces.map(p => p.id), pieces.map(p => p.id));
  assert.ok([...frame.forecast.report.values()].every(info => !info.dead));
  for (const dead of result.deaths) assert.equal(frame.forecast.report.get(dead.id).incoming, 0);
  const points = [{ x: 3, y: 0 }, { x: 3, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }];
  assert.deepEqual(frame.plan.points, points);
  if (moverWasRemoved) {
    assert.deepEqual(events, ['render', 'remove']);
    if (scenario === 'interrupted') {
      const stale = startTimer;
      context.cancelMovement();
      assert.equal(startTimer, null);
      stale();
      assert.deepEqual(events, ['render', 'remove', 'stop']);
      return;
    }
    startTimer();
  } else assert.equal(startTimer, undefined);
  assert.deepEqual(events, scenario === 'no casualties' ? ['render', 'move'] : ['render', 'remove', 'move']);
  context.movement = null;
  context.completeMovementPresentation(frame);
  assert.equal(frames.at(-1), null);
});

test('combat presentation calls browser timer APIs without binding them to the animator', () => {
  let scheduled, cleared = false; const phases = [];
  const checkReceiver = receiver => assert.ok(!receiver || typeof receiver.onPhase !== 'function', 'browser timers reject a CombatAnimator receiver');
  const context = vm.createContext({
    setTimeout: function(callback, delay) { checkReceiver(this); assert.equal(delay, 400); scheduled = callback; return 7; },
    clearTimeout: function(handle) { checkReceiver(this); assert.equal(handle, 7); cleared = true; },
    onPhase: phase => phases.push(phase)
  });
  const source = fs.readFileSync(new URL('../dist/move-animation.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  vm.runInContext(source + ';const animation = new CombatAnimator(onPhase, () => {}); animation.start(null, true);', context);
  assert.deepEqual(phases, ['deaths']); scheduled();
  assert.deepEqual(phases, ['deaths', 'idle']); assert.equal(cleared, true);
});
