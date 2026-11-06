import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, TEAM_NAMES } from '../dist/rules.js';
import { clone, cells, effective, auraReaches, shieldCanRetreat } from '../dist/engine.js';

// Exercise the actual DOM painter, rather than a second implementation of its rules.
const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const painter = app.slice(app.indexOf('function paintAuras() {'), app.indexOf('\nfunction lastMoveTrace()'));
function element(cell) {
  const classes = new Set(), styles = new Map();
  return { dataset: { cell }, classes, styles, hidden: true, innerHTML: '',
    classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    style: { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) } };
}
function setup(pieces) {
  const config = clone(DEFAULT_CONFIG), board = cells(config).map(c => element(`${c.q},${c.r}`)), legend = element('');
  const state = { pieces, turn: 0, ply: 0, winner: null };
  const context = vm.createContext({ config, TEAM_NAMES, effective, auraReaches, shieldCanRetreat, selected: null, fieldView: null, preview: null,
    visibleState: () => state, $: () => legend,
    document: { querySelectorAll: () => board } });
  context.inspectionContext = () => context.preview || { position: state, isPreview: false };
  vm.runInContext(painter, context);
  return { context, config, board, legend, state, paint: () => vm.runInContext('paintAuras()', context),
    fill: key => board.find(c => c.dataset.cell === key).styles.get('--aura-fill') };
}
const piece = (id, type, team, q = 0, r = 0) => ({ id, type, team, q, r });

test('selecting any aura unit shows only its hatched aura, including archers and veterans on either team', () => {
  for (const team of [0, 1]) for (const [type, veteran, baseMask, count] of [
    ['shield', false, 2, 6], ['archer', false, 1, 6], ['attackLamp', false, 1, 18],
    ['defenseLamp', false, 2, 6], ['shield', true, 3, 6]
  ]) {
    const selected = { ...piece('selected', type, team), ...(veteran ? { reachedFarEdge: true } : {}) };
    const ui = setup([selected, piece('other', 'attackLamp', 1 - team, 3, 0)]);
    ui.context.selected = selected.id; ui.paint();
    assert.equal(ui.board.filter(c => c.classes.has('has-aura')).length, count);
    assert.equal(ui.fill('1,0'), `url(#aura-${baseMask << (team * 2)})`);
    assert.equal(ui.fill('0,0'), undefined, 'the source cell is excluded');
    assert.equal(ui.legend.hidden, false);
    assert.equal(ui.legend.classes.has('solid-auras'), false);
    assert.ok(ui.legend.innerHTML.includes(TEAM_NAMES[team]));
    assert.ok(!ui.legend.innerHTML.includes(TEAM_NAMES[1 - team]));
  }
});

test('selected aura follows a movement preview and returns after leaving it; hovering another piece keeps the selected source', () => {
  const selected = piece('selected', 'archer', 0), other = piece('other', 'shield', 1, -3, 0);
  const ui = setup([selected, other]); ui.context.selected = selected.id;
  ui.paint(); assert.equal(ui.fill('2,0'), undefined);
  const preview = clone(ui.state); preview.pieces[0].q = 1;
  ui.context.preview = { isPreview: true, piece: preview.pieces[0], position: preview };
  ui.paint(); assert.equal(ui.fill('2,0'), 'url(#aura-1)'); assert.equal(ui.fill('-1,0'), undefined);
  ui.context.preview = { isPreview: false, piece: other, position: ui.state };
  ui.paint(); assert.equal(ui.fill('-1,0'), 'url(#aura-1)'); assert.equal(ui.fill('2,0'), undefined);
  assert.equal(selected.q, 0);
});

test('all-aura mode keeps solid overlaps, while deselection, attack mode and zero-radius units clear selection auras', () => {
  const ui = setup([piece('a', 'archer', 0), piece('b', 'shield', 1, 2, 0)]);
  ui.context.fieldView = 'auras'; ui.paint();
  assert.equal(ui.fill('1,0'), 'url(#aura-fill-9)'); assert.equal(ui.legend.classes.has('solid-auras'), true);
  for (const view of [null, 'attacks']) {
    ui.context.fieldView = view; ui.context.selected = null; ui.paint();
    assert.equal(ui.board.some(c => c.classes.has('has-aura') || c.styles.size), false);
    assert.equal(ui.legend.hidden, true);
  }
  ui.context.fieldView = null; ui.context.selected = 'a'; ui.config.stats.archer.aura = 0; ui.paint();
  assert.equal(ui.board.some(c => c.classes.has('has-aura')), false);
  assert.equal(ui.legend.hidden, true);
});
