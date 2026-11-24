const TABLE_RATTLE_FLIGHT = 300;
const TABLE_RATTLE_REBOUND_THRESHOLD = 21;
const TABLE_RATTLE_REBOUND_GRAVITY = .011; // SVG units per ms²
const TABLE_RATTLE_SLIDE = 195;
// Board displacement per millisecond for a unit throw. Friction acts after touchdown.
const TABLE_RATTLE_LAUNCH_SPEED = .8 / 415;
const TABLE_RATTLE_MAX_DELAY = 65;
export const TABLE_RATTLE_SETTLED_AT = TABLE_RATTLE_MAX_DELAY + TABLE_RATTLE_FLIGHT + TABLE_RATTLE_SLIDE;
export const TABLE_RATTLE_DISAPPEAR_AT = 1600;
export const TABLE_RATTLE_FADE_DURATION = 180;
export const TABLE_RATTLE_RETURN_AT = TABLE_RATTLE_DISAPPEAR_AT + 500;
export const TABLE_RATTLE_DURATION = TABLE_RATTLE_RETURN_AT + 600;
export const TABLE_RATTLE_REDUCED_DURATION = TABLE_RATTLE_RETURN_AT + 300;
const tableRattleClamp = value => Math.max(0, Math.min(1, value));
const tableRattleEase = value => 1 - (1 - tableRattleClamp(value)) ** 3;

export function sampleTableRattle(elapsed, piece, reduced = false) {
  const t = Math.max(0, elapsed);
  if (reduced) {
    const opacity = t < TABLE_RATTLE_DISAPPEAR_AT ? 1
      : t < TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION ? 1 - tableRattleEase((t - TABLE_RATTLE_DISAPPEAR_AT) / TABLE_RATTLE_FADE_DURATION)
      : t < TABLE_RATTLE_RETURN_AT ? 0 : tableRattleEase((t - TABLE_RATTLE_RETURN_AT) / 300);
    return { x: 0, y: 0, groundY: 0, rotation: 0, scale: 1, opacity, shadowScale: 1 };
  }
  if (t < TABLE_RATTLE_RETURN_AT) {
    const age = Math.max(0, t - piece.delay);
    const flight = tableRattleClamp(age / TABLE_RATTLE_FLIGHT);
    const hop = 4 * flight * (1 - flight);
    let height = piece.lift * hop;
    let travel = flight * TABLE_RATTLE_FLIGHT;
    if (age > TABLE_RATTLE_FLIGHT) {
      const sinceContact = Math.min(age - TABLE_RATTLE_FLIGHT, TABLE_RATTLE_SLIDE);
      const peak = .09 * Math.max(0, piece.lift - TABLE_RATTLE_REBOUND_THRESHOLD) ** 2;
      const reboundTime = Math.sqrt(8 * peak / TABLE_RATTLE_REBOUND_GRAVITY);
      const airborne = Math.min(sinceContact, reboundTime);
      height = .5 * TABLE_RATTLE_REBOUND_GRAVITY * airborne * (reboundTime - airborne);

      // Contact takes some horizontal speed. Carry the rest through the hop,
      // then brake on the table, covering the same short runout as before.
      const glide = sinceContact - airborne;
      const surfaceTime = TABLE_RATTLE_SLIDE - reboundTime;
      const retainedSpeed = TABLE_RATTLE_SLIDE / (TABLE_RATTLE_SLIDE + reboundTime);
      travel += retainedSpeed * (airborne + glide * (1 - glide / (2 * surfaceTime)));
    }
    const distance = age >= TABLE_RATTLE_FLIGHT + TABLE_RATTLE_SLIDE ? 1
      : travel / (TABLE_RATTLE_FLIGHT + TABLE_RATTLE_SLIDE / 2);
    const fade = tableRattleEase((t - TABLE_RATTLE_DISAPPEAR_AT) / TABLE_RATTLE_FADE_DURATION);
    return { x: piece.dx * distance, y: piece.dy * distance - height,
      groundY: piece.dy * distance, rotation: piece.rotation * distance,
      scale: (1 + .055 * hop) * (1 - .15 * fade), opacity: 1 - fade,
      shadowScale: 1 - .22 * (piece.lift > 0 ? height / piece.lift : 0) };
  }
  const progress = tableRattleClamp((t - TABLE_RATTLE_RETURN_AT - piece.delay) / 430);
  const ease = tableRattleEase(progress);
  return { x: 0, y: 10 * (1 - ease), groundY: 0,
    rotation: piece.rotation * .035 * (1 - ease),
    scale: .95 + .05 * ease + .012 * Math.sin(Math.PI * progress),
    opacity: ease, shadowScale: 1 };
}

export function tableRattlePhase(elapsed) {
  return elapsed < TABLE_RATTLE_SETTLED_AT ? 'scatter'
    : elapsed < TABLE_RATTLE_DISAPPEAR_AT ? 'rest'
    : elapsed < TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION ? 'disappear'
    : elapsed < TABLE_RATTLE_RETURN_AT ? 'hidden' : 'return';
}

// A serial guards against stale rAF callbacks after cancellation or replacement.
export class TableRattleAnimator {
  constructor(onFrame, onFinish, clock) {
    Object.assign(this, { onFrame, onFinish, clock });
    this.active = false; this.serial = 0; this.handle = null;
  }
  cancel() {
    this.serial++; this.active = false;
    if (this.handle !== null) this.clock.cancelFrame(this.handle);
    this.handle = null;
  }
  start(reduced = false) {
    this.cancel(); this.active = true;
    const serial = this.serial;
    const duration = reduced ? TABLE_RATTLE_REDUCED_DURATION : TABLE_RATTLE_DURATION;
    let start;
    const tick = () => {
      if (!this.active || serial !== this.serial) return;
      const now = this.clock.now();
      // Loading and rendering before the first frame must not consume the opening motion.
      start ??= now;
      const elapsed = Math.min(duration, Math.max(0, now - start));
      this.onFrame(elapsed, reduced);
      if (elapsed === duration) {
        this.active = false; this.handle = null; this.onFinish();
      } else this.handle = this.clock.requestFrame(tick);
    };
    this.handle = this.clock.requestFrame(tick);
  }
}

// Plan the hit once. Neighbours may overlap at the rim, while the centres and
// their unit symbols stay visible, including when two flight paths cross.
export function planTableRattlePaths(tokens, bounds) {
  const clearance = 37;
  const sampleTimes = [];
  for (let time = 0; time < TABLE_RATTLE_SETTLED_AT; time += 20) sampleTimes.push(time);
  sampleTimes.push(TABLE_RATTLE_SETTLED_AT);
  const path = token => sampleTimes.map(time => {
    const frame = sampleTableRattle(time, token);
    return { x: token.x + frame.x, y: token.y + frame.y };
  });
  // A shared vertical hop preserves the original spacing. Reserve that safe
  // fallback for every piece before trying its individual throw.
  const fallback = { dx: 0, dy: 0, delay: 0, lift: 18 };
  const paths = tokens.map(token => path({ ...token, ...fallback }));
  const reach = TABLE_RATTLE_LAUNCH_SPEED * (TABLE_RATTLE_FLIGHT + TABLE_RATTLE_SLIDE / 2);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  for (const [i, token] of tokens.entries()) {
    // Even two maximum throws and a full hop cannot reach more distant pieces.
    const neighbours = paths.filter((_, j) => i !== j &&
      Math.hypot(token.x - tokens[j].x, token.y - tokens[j].y) <= 2 * 81 * reach + 26 + clearance);
    let accepted = false;
    for (const scale of [1, .6, .3]) {
      for (const turn of [0, 1, -1, 2, -2, 3]) {
        const angle = token.angle + turn * Math.PI / 3;
        const distance = token.distance * scale;
        const x = clamp(token.x + Math.cos(angle) * distance, bounds.x + 28, bounds.x + bounds.width - 28);
        const y = clamp(token.y + Math.sin(angle) * distance, bounds.y + 28, bounds.y + bounds.height - 28);
        const dx = (x - token.x) * reach, dy = (y - token.y) * reach;
        if (Math.hypot(dx, dy) < 6) continue;
        const candidate = path({ ...token, dx, dy });
        if (neighbours.some(other => candidate.some((p, k) =>
          (p.x - other[k].x) ** 2 + (p.y - other[k].y) ** 2 < clearance ** 2))) continue;
        Object.assign(token, { dx, dy });
        paths[i] = candidate;
        accepted = true;
        break;
      }
      if (accepted) break;
    }
    if (!accepted) Object.assign(token, fallback);
  }
}

export class TableRattle {
  constructor({ surface, board, random = Math.random, onFinish = () => {}, onDisappear = () => {}, clock }) {
    Object.assign(this, { surface, board, random, onFinish, onDisappear });
    this.doc = surface.ownerDocument; this.win = this.doc.defaultView;
    this.media = this.win.matchMedia('(prefers-reduced-motion: reduce)');
    this.animator = new TableRattleAnimator((t, reduced) => this.paint(t, reduced),
      () => { this.cleanup(); this.onFinish(); }, clock || {
        now: () => this.win.performance.now(),
        requestFrame: callback => this.win.requestAnimationFrame(callback),
        cancelFrame: handle => this.win.cancelAnimationFrame(handle)
      });
    this.blockInput = event => {
      if (!this.active || !this.surface.contains(event.target)) return;
      if (event.type === 'keydown' && !['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    this.cancel = () => { this.animator.cancel(); this.cleanup(); };
    this.hide = () => { if (this.doc.hidden) this.cancel(); };
    this.doc.addEventListener('click', this.blockInput, true);
    this.doc.addEventListener('keydown', this.blockInput, true);
    this.doc.addEventListener('visibilitychange', this.hide);
    this.win.addEventListener('resize', this.cancel);
    this.win.addEventListener('pagehide', this.cancel);
    this.media.addEventListener('change', this.cancel);
    this.scene = null;
  }
  get active() { return this.animator.active; }
  start() {
    if (this.active || this.doc.hidden) return false;
    const source = this.board.querySelector('#board-pieces');
    if (!source || !source.children.length) return false;
    try {
      const ns = 'http://www.w3.org/2000/svg';
      const create = tag => this.doc.createElementNS(ns, tag);
      const overlay = create('g');
      overlay.id = 'table-rattle-effect'; overlay.setAttribute('aria-hidden', 'true');
      overlay.setAttribute('pointer-events', 'none');
      const defs = create('defs'), filter = create('filter'), blur = create('feGaussianBlur');
      filter.id = 'table-rattle-shadow'; filter.setAttribute('x', '-60%'); filter.setAttribute('y', '-120%');
      filter.setAttribute('width', '220%'); filter.setAttribute('height', '340%');
      blur.setAttribute('stdDeviation', '2'); filter.appendChild(blur); defs.appendChild(filter);
      const shadows = create('g'); shadows.setAttribute('filter', `url(#${filter.id})`);
      overlay.append(defs, shadows);
      const bounds = this.board.viewBox.baseVal;
      const tokens = [];
      // Use the mounted SVG pieces so their images and masks are ready on the first strike.
      for (const token of source.children) {
        const transforms = token.transform.baseVal;
        if (!transforms.numberOfItems) continue;
        const matrix = transforms.getItem(0).matrix; // The board gives each piece a single translation.
        const x = matrix.e, y = matrix.f, angle = this.random() * Math.PI * 2;
        const distance = 38 + this.random() * 43;
        const shadow = create('ellipse'); shadow.setAttribute('fill', '#302518'); shadows.appendChild(shadow);
        const body = token.querySelector('.token-body-paint');
        tokens.push({ token, shadow, body, bodyFilter: body?.style.filter, transform: token.getAttribute('transform'), opacity: token.getAttribute('opacity'),
          x, y, angle, distance, delay: this.random() * TABLE_RATTLE_MAX_DELAY,
          rotation: (this.random() - .5) * 28, lift: 12 + this.random() * 14 });
      }
      if (!tokens.length) return false;
      // Reduced motion uses stationary pieces and does not need scatter paths.
      const reduced = this.media.matches;
      if (!reduced) planTableRattlePaths(tokens, bounds);
      this.scene = { overlay, tokens, busy: this.board.getAttribute('aria-busy') };
      this.board.insertBefore(overlay, source);
      this.surface.classList.add('table-rattle-active');
      this.board.setAttribute('aria-busy', 'true');
      this.animator.start(reduced);
      return true;
    } catch {
      this.cancel(); return false;
    }
  }
  paint(elapsed, reduced) {
    if (!this.scene) return;
    if (elapsed >= TABLE_RATTLE_DISAPPEAR_AT && !this.scene.disappearStarted) {
      this.scene.disappearStarted = true;
      this.scene.stopDisappear = this.onDisappear();
    }
    this.board.dataset.tableRattlePhase = (reduced ? 'reduced-' : '') + tableRattlePhase(elapsed);
    const shadowsVisible = elapsed < TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION;
    for (const token of this.scene.tokens) {
      const frame = sampleTableRattle(elapsed, token, reduced);
      token.token.setAttribute('transform', `translate(${token.x + frame.x},${token.y + frame.y}) rotate(${frame.rotation}) scale(${frame.scale})`);
      token.token.setAttribute('opacity', String(frame.opacity));
      const height = Math.max(0, frame.groundY - frame.y);
      if (token.body) token.body.style.filter = shadowsVisible ? `drop-shadow(1px ${2 + height * .18}px ${1.4 + height * .12}px #3025183d)` : 'none';
      token.shadow.setAttribute('cx', String(token.x + frame.x));
      token.shadow.setAttribute('cy', String(token.y + frame.groundY + 8));
      token.shadow.setAttribute('rx', String(20 * frame.shadowScale));
      token.shadow.setAttribute('ry', String(6 * frame.shadowScale));
      token.shadow.setAttribute('opacity', String(shadowsVisible ? .16 * frame.opacity * frame.shadowScale : 0));
    }
  }
  cleanup() {
    if (!this.scene) return;
    const scene = this.scene; this.scene = null;
    if (typeof scene.stopDisappear === 'function') scene.stopDisappear();
    for (const { token, body, bodyFilter, transform, opacity } of scene.tokens) {
      token.setAttribute('transform', transform);
      if (opacity === null) token.removeAttribute('opacity');
      else token.setAttribute('opacity', opacity);
      if (body) body.style.filter = bodyFilter;
    }
    scene.overlay.remove(); this.surface.classList.remove('table-rattle-active');
    if (scene.busy === null) this.board.removeAttribute('aria-busy');
    else this.board.setAttribute('aria-busy', scene.busy);
    delete this.board.dataset.tableRattlePhase;
  }
  destroy() {
    this.cancel();
    this.doc.removeEventListener('click', this.blockInput, true);
    this.doc.removeEventListener('keydown', this.blockInput, true);
    this.doc.removeEventListener('visibilitychange', this.hide);
    this.win.removeEventListener('resize', this.cancel);
    this.win.removeEventListener('pagehide', this.cancel);
    this.media.removeEventListener('change', this.cancel);
  }
}
