import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardDrag } from '../dist/board-drag.js';

function setup() {
  const target = () => ({ listeners: new Map(),
    addEventListener(type, fn) { const list = this.listeners.get(type) || []; list.push(fn); this.listeners.set(type, list); },
    removeEventListener(type, fn) { this.listeners.set(type, this.listeners.get(type).filter(item => item !== fn)); },
    emit(type, values = {}) { const event = { type, button: 0, pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, detail: 1,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...values };
      for (const fn of this.listeners.get(type) || []) { fn(event); if (event.stopped) break; } return event; }
  });
  const node = () => { const classes = new Set(); return { ...target(), classes,
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), toggle(value, yes) { yes ? classes.add(value) : classes.delete(value); } },
    attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, getAttribute(name) { return this.attrs[name]; }, removeAttribute() {},
    remove() { this.removed = true; }, cloneNode: () => node() }; };
  const cell = value => { const result = node(); result.dataset = { cell: value }; result.closest = () => result; return result; };
  const origin = cell('0,0'), valid = cell('1,0'), invalid = cell('4,0'), outsider = cell('2,2');
  const board = node(), win = target(), doc = target(), source = node();
  const piece = { id: 'p' }, drops = [], previews = [], returns = [];
  let enabled = true, starts = 0, finishes = 0, captures = 0;
  doc.defaultView = win; doc.elementFromPoint = x => x === 20 ? valid : x === 40 ? invalid : x === 60 ? outsider : origin;
  board.ownerDocument = doc; board.contains = cell => [origin, valid, invalid].includes(cell);
  board.querySelectorAll = () => [origin, valid, invalid]; board.append = token => { board.token = token; };
  board.setPointerCapture = () => captures++; board.hasPointerCapture = () => captures > 0; board.releasePointerCapture = () => { captures--; board.emit('lostpointercapture'); };
  board.getScreenCTM = () => ({ inverse: () => ({}) });
  board.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x / 2, y: this.y / 2 }; } });
  source.setAttribute('transform', 'translate(5,10)');
  const drag = new BoardDrag({ board, canStart: key => enabled && key === '0,0' ? piece : null,
    start: () => { starts++; drag.cancel(); return enabled ? source : null; },
    canDrop: (p, key) => enabled && key === '1,0', drop: (p, key) => drops.push([p.id, key]),
    onReturn: p => returns.push(p.id),
    preview: (p, key, token) => previews.push({ id: p.id, key, token }), finish: () => finishes++ });
  const down = values => doc.emit('pointerdown', { target: origin, ...values });
  const move = values => win.emit('pointermove', { clientX: 20, ...values });
  const up = values => win.emit('pointerup', { clientX: 20, ...values });
  return { drag, board, win, doc, source, origin, valid, drops, previews, returns, down, move, up,
    disable: () => { enabled = false; }, counts: () => ({ starts, finishes, captures }) };
}

test('click and small pointer jitter preserve the ordinary click path', () => {
  const ui = setup(); ui.down(); ui.move({ clientX: 3 }); ui.up();
  assert.equal(ui.counts().starts, 0); assert.equal(ui.drag.active, false);
  assert.equal(ui.doc.emit('click').prevented, undefined); assert.deepEqual(ui.drops, []);
});
for (const pointerType of ['mouse', 'touch']) test(`${pointerType}: forecast follows legal cells and clears outside without recalculating every pixel`, () => {
  const ui = setup(); ui.down({ pointerType }); ui.move({ pointerType, clientX: 3 });
  assert.equal(ui.previews.length, 0);
  ui.move({ pointerType }); ui.move({ pointerType });
  assert.deepEqual(ui.previews.map(p => p.key), ['1,0']);
  assert.equal(ui.previews[0].token, ui.board.token);
  ui.move({ pointerType, clientX: 40 }); ui.move({ pointerType, clientX: 60 });
  assert.deepEqual(ui.previews.map(p => p.key), ['1,0', null]);
  ui.move({ pointerType });
  assert.deepEqual(ui.previews.map(p => p.key), ['1,0', null, '1,0']);
  assert.ok(ui.previews.every(p => p.id === 'p'));
  ui.drag.cancel(); ui.move({ pointerType });
  assert.equal(ui.previews.length, 3);
  assert.equal(ui.counts().finishes, 1);
});
for (const pointerType of ['mouse', 'touch', 'pen']) test(`${pointerType}: legal drop commits exactly once and consumes its synthetic click`, () => {
  const ui = setup(); ui.down({ pointerType }); ui.move({ pointerType });
  assert.equal(ui.drag.active, true); assert.ok(ui.valid.classes.has('drag-target'));
  assert.equal(ui.board.token.attrs.transform, 'translate(10,0) translate(5,10)');
  assert.ok(ui.source.classes.has('drag-origin'));
  ui.up(); ui.up();
  assert.deepEqual(ui.drops, [['p', '1,0']]); assert.equal(ui.counts().captures, 0);
  assert.equal(ui.doc.emit('click').prevented, true); assert.equal(ui.doc.emit('click').prevented, undefined);
  assert.equal(ui.board.token.removed, true); assert.equal(ui.source.classes.has('drag-origin'), false);
});
for (const x of [0, 40, 60, 100]) test(`drop on origin, invalid cell or outside the board (${x}) leaves position intact`, () => {
  const ui = setup(); ui.down(); ui.move(); ui.up({ clientX: x }); assert.deepEqual(ui.drops, []);
  assert.deepEqual(ui.returns, [0, 100].includes(x) ? ['p'] : []);
  assert.equal(ui.doc.emit('click').prevented, true);
});
for (const interruption of ['pointercancel', 'lostpointercapture', 'blur', 'pagehide', 'resize', 'visibilitychange', 'Escape', 'render']) {
  test(`${interruption} cleans the gesture and allows the next drag`, () => {
    const ui = setup(); ui.down(); ui.move();
    if (interruption === 'render') ui.drag.cancel();
    else if (interruption === 'Escape') ui.doc.emit('keydown', { key: 'Escape' });
    else if (interruption === 'visibilitychange') { ui.doc.hidden = true; ui.doc.emit(interruption); }
    else (interruption === 'lostpointercapture' ? ui.board : ui.win).emit(interruption);
    ui.up(); assert.deepEqual(ui.drops, []); assert.equal(ui.drag.active, false);
    assert.equal(ui.counts().captures, 0); assert.equal(ui.valid.classes.has('drag-target'), false);
    ui.down(); ui.move(); ui.up(); assert.deepEqual(ui.drops, [['p', '1,0']]);
  });
}
test('second pointer cannot hijack, finish or cancel the first drag', () => {
  const ui = setup(); ui.down(); ui.move();
  ui.down({ pointerId: 2 }); ui.move({ pointerId: 2, clientX: 40 }); ui.up({ pointerId: 2 });
  ui.win.emit('pointercancel', { pointerId: 2 }); assert.equal(ui.drag.active, true);
  ui.up(); assert.deepEqual(ui.drops, [['p', '1,0']]);
});
test('permission changes before starting or releasing prevent the move', () => {
  for (const active of [false, true]) { const ui = setup(); ui.down(); if (active) ui.move(); ui.disable(); ui.move(); ui.up(); assert.deepEqual(ui.drops, []); }
});
test('cancelled drag does not swallow the next intentional pointer or keyboard click', () => {
  const ui = setup(); ui.down(); ui.move(); ui.drag.cancel();
  assert.equal(ui.doc.emit('click', { detail: 0 }).prevented, undefined);
  ui.down(); ui.up(); assert.equal(ui.doc.emit('click').prevented, undefined);
});
test('destroy removes listeners and visual state', () => {
  const ui = setup(); ui.down(); ui.move(); ui.drag.destroy(); ui.down(); ui.move(); ui.up();
  assert.deepEqual(ui.drops, []); assert.equal(ui.drag.active, false);
});
