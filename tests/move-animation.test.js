import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createMovementPlan, sampleMovement, MovementAnimator } from '../dist/move-animation.js';

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
