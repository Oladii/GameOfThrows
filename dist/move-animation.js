export const DEATH_EFFECT_DURATION = 400;
export const COMBAT_DIM_DURATION = 300;
export const ARROW_REVEAL_INTERVAL = 300;
export const ATTACK_HOLD_DURATION = 1000;

export function createMovementPlan(points) {
  if (!Array.isArray(points) || points.length < 2 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Нужен маршрут перемещения.');
  const route = points.map(p => ({ x: p.x, y: p.y })), lengths = [];
  let total = 0;
  for (let index = 1; index < route.length; index++) {
    const length = Math.hypot(route[index].x - route[index - 1].x, route[index].y - route[index - 1].y);
    lengths.push(length); total += length;
  }
  if (!total) throw new Error('Маршрут должен менять положение фигуры.');
  return { points: route, lengths, total, duration: Math.min(420, 220 + (route.length - 1) * 40) };
}

export function sampleMovement(plan, elapsed) {
  const progress = Math.max(0, Math.min(1, elapsed / plan.duration));
  if (progress === 1) return { ...plan.points.at(-1), progress, done: true };
  const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  let remaining = plan.total * eased;
  for (let index = 0; index < plan.lengths.length; index++) {
    const length = plan.lengths[index];
    if (remaining <= length || index === plan.lengths.length - 1) {
      const t = length ? remaining / length : 0, from = plan.points[index], to = plan.points[index + 1];
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, progress, done: progress === 1 };
    }
    remaining -= length;
  }
}

export class MovementAnimator {
  constructor(onFrame, onFinish, clock = {}) {
    this.onFrame = onFrame; this.onFinish = onFinish;
    this.now = clock.now || (() => performance.now());
    this.requestFrame = clock.requestFrame || (callback => requestAnimationFrame(callback));
    this.cancelFrame = clock.cancelFrame || (handle => cancelAnimationFrame(handle));
    this.handle = null; this.serial = 0; this.active = false; this.frame = null;
  }
  cancel() {
    this.serial++; this.active = false;
    if (this.handle !== null) this.cancelFrame(this.handle);
    this.handle = null;
  }
  start(plan) {
    this.cancel(); this.active = true;
    const serial = this.serial, started = this.now();
    const tick = () => {
      if (!this.active || this.serial !== serial) return;
      this.frame = sampleMovement(plan, this.now() - started); this.onFrame(this.frame);
      if (!this.active || this.serial !== serial) return;
      if (this.frame.done) { this.active = false; this.handle = null; this.onFinish(); }
      else this.handle = this.requestFrame(tick);
    };
    tick();
  }
}

export class CombatAnimator {
  constructor(onPhase, onFrame, clock = {}) {
    this.onPhase = onPhase;
    this.setTimer = clock.setTimer || ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = clock.clearTimer || (handle => clearTimeout(handle));
    this.timer = null; this.serial = 0; this.phase = 'idle';
    this.movement = new MovementAnimator(onFrame, () => this.showAttacks(), clock);
  }
  cancel() {
    this.serial++; this.movement.cancel();
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null; this.phase = 'idle';
  }
  finish() { this.cancel(); this.onPhase('idle'); }
  // The board supplies groups from one frozen damage report. Only their
  // presentation is sequential; combat is never recalculated between deaths.
  startSequence(groups) {
    this.cancel();
    if (!groups.length) { this.finish(); return; }
    this.groups = groups; this.groupIndex = 0; this.arrowCount = 0;
    this.sequencePhase('dimming', COMBAT_DIM_DURATION, () => this.revealArrow());
  }
  sequencePhase(phase, delay, next) {
    const serial = this.serial;
    this.phase = phase;
    this.onPhase(phase, { groupIndex: this.groupIndex, arrowCount: this.arrowCount });
    if (this.serial !== serial) return;
    this.timer = this.setTimer(() => { if (this.serial === serial) next(); }, delay);
  }
  revealArrow() {
    const group = this.groups[this.groupIndex];
    this.arrowCount = Math.min(this.arrowCount + 1, group.arrows.length);
    const complete = this.arrowCount === group.arrows.length;
    this.sequencePhase('attacks', complete ? ATTACK_HOLD_DURATION : ARROW_REVEAL_INTERVAL,
      () => complete ? this.sequenceDeaths() : this.revealArrow());
  }
  sequenceDeaths() {
    this.sequencePhase('deaths', DEATH_EFFECT_DURATION, () => {
      this.groupIndex++; this.arrowCount = 0;
      if (this.groupIndex < this.groups.length) this.revealArrow();
      else this.finish();
    });
  }
  showAttacks() {
    if (!this.hasDeaths || !this.attackDuration) { this.showDeaths(); return; }
    const serial = this.serial;
    this.phase = 'attacks'; this.onPhase('attacks');
    if (this.serial !== serial) return;
    this.timer = this.setTimer(() => { if (this.serial === serial) this.showDeaths(); }, this.attackDuration);
  }
  showDeaths() {
    if (!this.hasDeaths) { this.finish(); return; }
    const serial = this.serial;
    this.phase = 'deaths'; this.onPhase('deaths');
    if (this.serial !== serial) return;
    this.timer = this.setTimer(() => { if (this.serial === serial) this.finish(); }, DEATH_EFFECT_DURATION);
  }
  start(plan, hasDeaths, reducedMotion = false, attackDuration = 0) {
    this.cancel(); this.hasDeaths = hasDeaths; this.attackDuration = attackDuration;
    if (reducedMotion) { this.finish(); return; }
    if (plan) {
      this.phase = 'movement'; this.onPhase('movement'); this.movement.start(plan);
    } else this.showAttacks();
  }
}
