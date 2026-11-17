export const TABLE_RATTLE_SETTLED_AT = 520;
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
    const travel = tableRattleClamp((t - piece.delay) / 450);
    const ease = tableRattleEase(travel), hop = travel === 0 || travel === 1 ? 0 : Math.sin(Math.PI * travel);
    const fade = tableRattleEase((t - TABLE_RATTLE_DISAPPEAR_AT) / TABLE_RATTLE_FADE_DURATION);
    return { x: piece.dx * ease, y: piece.dy * ease - piece.lift * hop,
      groundY: piece.dy * ease, rotation: piece.rotation * ease,
      scale: (1 + .055 * hop) * (1 - .15 * fade), opacity: 1 - fade,
      shadowScale: 1 - .22 * hop };
  }
  const progress = tableRattleClamp((t - TABLE_RATTLE_RETURN_AT - piece.delay) / 430);
  const ease = tableRattleEase(progress);
  return { x: 0, y: 10 * (1 - ease), groundY: 0,
    rotation: piece.rotation * .035 * (1 - ease),
    scale: .95 + .05 * ease + .012 * Math.sin(Math.PI * progress),
    opacity: ease, shadowScale: 1 };
}

export function sampleTableShake(elapsed, reduced = false) {
  if (reduced || elapsed < 0 || elapsed >= 250) return { x: 0, y: 0, rotation: 0 };
  const p = elapsed / 250, weight = (1 - p) ** 2;
  return { x: Math.sin(p * Math.PI * 6) * 6 * weight,
    y: -Math.sin(p * Math.PI * 5) * 3 * weight,
    rotation: Math.sin(p * Math.PI * 4) * .55 * weight };
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
    const serial = this.serial, start = this.clock.now();
    const duration = reduced ? TABLE_RATTLE_REDUCED_DURATION : TABLE_RATTLE_DURATION;
    const tick = () => {
      if (!this.active || serial !== this.serial) return;
      const elapsed = Math.min(duration, Math.max(0, this.clock.now() - start));
      this.onFrame(elapsed, reduced);
      if (elapsed === duration) {
        this.active = false; this.handle = null; this.onFinish();
      } else this.handle = this.clock.requestFrame(tick);
    };
    tick();
  }
}

let tableRattleCloneSerial = 0;

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
      const clone = source.cloneNode(true), prefix = `table-rattle-${++tableRattleCloneSerial}-`;
      const ids = new Map();
      for (const node of clone.querySelectorAll('[id]')) {
        const old = node.id; ids.set(old, prefix + old); node.id = prefix + old;
      }
      clone.id = 'table-rattle-pieces';
      for (const node of clone.querySelectorAll('*')) {
        for (const attribute of [...node.attributes]) {
          const next = attribute.value.replace(/url\(#([^)]*)\)/g, (all, id) => ids.has(id) ? `url(#${ids.get(id)})` : all);
          if (next !== attribute.value) node.setAttribute(attribute.name, next);
        }
      }
      const defs = create('defs'), filter = create('filter'), blur = create('feGaussianBlur');
      filter.id = prefix + 'shadow'; filter.setAttribute('x', '-60%'); filter.setAttribute('y', '-120%');
      filter.setAttribute('width', '220%'); filter.setAttribute('height', '340%');
      blur.setAttribute('stdDeviation', '2'); filter.appendChild(blur); defs.appendChild(filter);
      const shadows = create('g'); shadows.setAttribute('filter', `url(#${filter.id})`);
      overlay.append(defs, shadows, clone);
      const bounds = this.board.viewBox.baseVal;
      const originals = [...source.children], tokens = [];
      for (const [index, token] of [...clone.children].entries()) {
        const matrix = originals[index].transform.baseVal.consolidate()?.matrix;
        if (!matrix) continue;
        const x = matrix.e, y = matrix.f, angle = this.random() * Math.PI * 2;
        const distance = 38 + this.random() * 43;
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        let dx = clamp(x + Math.cos(angle) * distance, bounds.x + 28, bounds.x + bounds.width - 28) - x;
        let dy = clamp(y + Math.sin(angle) * distance, bounds.y + 28, bounds.y + bounds.height - 28) - y;
        if (Math.hypot(dx, dy) < 18) {
          const inward = Math.atan2(bounds.y + bounds.height / 2 - y, bounds.x + bounds.width / 2 - x);
          dx = Math.cos(inward) * 35; dy = Math.sin(inward) * 35;
        }
        dx *= .8; dy *= .8;
        const wrapper = create('g'); wrapper.setAttribute('class', 'table-rattle-token');
        clone.replaceChild(wrapper, token); wrapper.appendChild(token);
        const shadow = create('ellipse'); shadow.setAttribute('fill', '#302518'); shadows.appendChild(shadow);
        tokens.push({ wrapper, shadow, body: token.querySelector('.token-body-paint'), x, y, dx, dy, delay: this.random() * 65,
          rotation: (this.random() - .5) * 28, lift: 12 + this.random() * 14 });
      }
      this.scene = { overlay, tokens, busy: this.board.getAttribute('aria-busy'),
        transform: this.surface.style.getPropertyValue('transform'),
        priority: this.surface.style.getPropertyPriority('transform') };
      this.board.appendChild(overlay);
      this.surface.classList.add('table-rattle-active');
      this.board.setAttribute('aria-busy', 'true');
      this.animator.start(this.media.matches);
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
    const shake = sampleTableShake(elapsed, reduced);
    this.surface.style.transform = `translate(${shake.x}px,${shake.y}px) rotate(${shake.rotation}deg)`;
    this.board.dataset.tableRattlePhase = (reduced ? 'reduced-' : '') + tableRattlePhase(elapsed);
    const shadowsVisible = elapsed < TABLE_RATTLE_DISAPPEAR_AT + TABLE_RATTLE_FADE_DURATION;
    for (const token of this.scene.tokens) {
      const frame = sampleTableRattle(elapsed, token, reduced);
      token.wrapper.setAttribute('transform', `translate(${frame.x},${frame.y}) translate(${token.x},${token.y}) rotate(${frame.rotation}) scale(${frame.scale}) translate(${-token.x},${-token.y})`);
      token.wrapper.setAttribute('opacity', String(frame.opacity));
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
    scene.overlay.remove(); this.surface.classList.remove('table-rattle-active');
    if (scene.transform) this.surface.style.setProperty('transform', scene.transform, scene.priority);
    else this.surface.style.removeProperty('transform');
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
