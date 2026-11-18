// Presentation only: no game state, history or engine coordinates are changed.
export class TableKnockSequence {
  constructor() { this.reset(); }
  reset() { this.count = 0; this.last = -Infinity; }
  hit(now) {
    if (now - this.last > 400 || now < this.last) this.reset();
    this.last = now;
    const strength = ++this.count;
    if (strength === 2) this.reset();
    return strength;
  }
}

// Include the small gaps between tiles in the field, rather than treating them
// as table. This also works for the custom square board.
export function tableKnockFieldHull(points) {
  const sorted = [...new Map(points.map(p => [`${p.x},${p.y}`, p])).values()]
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = list => {
    const hull = [];
    for (const p of list) {
      while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function tableKnockInsideField(point, hull) {
  if (hull.length < 3) return true; // An unrendered board is never a table target.
  return hull.every((a, i) => {
    const b = hull[(i + 1) % hull.length];
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= -0.001;
  });
}

export class TableKnocks {
  constructor({ surface, board, audio, canKnock, canShake = () => true, onShake = () => {}, now = () => performance.now() }) {
    Object.assign(this, { surface, board, audio, canKnock, canShake, onShake, now });
    this.sequence = new TableKnockSequence();
    this.doc = surface.ownerDocument;
    this.pointerDown = event => this.handlePointerDown(event);
    this.click = event => {
      if (this.suppressClick && event.button === 0 && event.detail > 0) {
        this.suppressClick = false;
        event.preventDefault(); event.stopImmediatePropagation();
      } else this.reset();
    };
    this.reset = () => { this.sequence.reset(); this.suppressClick = false; };
    this.doc.addEventListener('pointerdown', this.pointerDown, true);
    this.doc.addEventListener('pointercancel', this.reset, true);
    this.doc.addEventListener('click', this.click, true);
    this.doc.addEventListener('keydown', this.reset, true);
    this.doc.addEventListener('visibilitychange', this.reset);
    this.doc.defaultView.addEventListener('resize', this.reset);
    this.doc.defaultView.addEventListener('pagehide', this.reset);
  }
  isTable(event) {
    if (!this.surface.contains(event.target) || event.target.closest(
      '[data-cell], button, a, input, select, textarea, summary, [contenteditable], [role="button"]'
    )) return false;
    const matrix = this.board.getScreenCTM();
    if (!matrix) return false;
    const location = this.board.createSVGPoint();
    location.x = event.clientX; location.y = event.clientY;
    const point = location.matrixTransform(matrix.inverse());
    const vertices = [...this.board.querySelectorAll('.tile')].flatMap(tile =>
      Array.from({ length: tile.points.numberOfItems }, (_, i) => tile.points.getItem(i)));
    return !tableKnockInsideField(point, tableKnockFieldHull(vertices));
  }
  handlePointerDown(event) {
    this.suppressClick = false;
    if (event.button !== 0 || event.isPrimary === false || event.defaultPrevented
      || !this.canKnock() || !this.isTable(event)) { this.reset(); return; }
    // Play on press, then consume the release click without another sound or selection.
    event.preventDefault();
    this.suppressClick = true;
    // The original quiet hit gives feedback before the second hit and scatter.
    if (!this.canShake() || this.sequence.hit(this.now()) === 1) this.audio.play('knock1');
    else {
      this.audio.play('knock3'); this.audio.play('scatter'); this.onShake();
    }
  }
  destroy() {
    this.reset();
    this.doc.removeEventListener('pointerdown', this.pointerDown, true);
    this.doc.removeEventListener('pointercancel', this.reset, true);
    this.doc.removeEventListener('click', this.click, true);
    this.doc.removeEventListener('keydown', this.reset, true);
    this.doc.removeEventListener('visibilitychange', this.reset);
    this.doc.defaultView.removeEventListener('resize', this.reset);
    this.doc.defaultView.removeEventListener('pagehide', this.reset);
  }
}
