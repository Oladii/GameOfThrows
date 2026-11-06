export const DEATH_EFFECT_DURATION = 400;

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
    this.setTimer = clock.setTimer || setTimeout;
    this.clearTimer = clock.clearTimer || clearTimeout;
    this.timer = null; this.serial = 0; this.phase = 'idle';
    this.movement = new MovementAnimator(onFrame, () => this.showDeaths(), clock);
  }
  cancel() {
    this.serial++; this.movement.cancel();
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null; this.phase = 'idle';
  }
  finish() { this.cancel(); this.onPhase('idle'); }
  showDeaths() {
    if (!this.hasDeaths) { this.finish(); return; }
    this.phase = 'deaths'; this.onPhase('deaths');
    const serial = this.serial;
    this.timer = this.setTimer(() => { if (this.serial === serial) this.finish(); }, DEATH_EFFECT_DURATION);
  }
  start(plan, hasDeaths, reducedMotion = false) {
    this.cancel(); this.hasDeaths = hasDeaths;
    if (reducedMotion) { this.finish(); return; }
    if (plan) {
      this.phase = 'movement'; this.onPhase('movement'); this.movement.start(plan);
    } else this.showDeaths();
  }
}
