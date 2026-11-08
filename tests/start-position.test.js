import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, createGame } from '../dist/engine.js';
import { deploymentKey, classifyPosition, prepareStartPosition } from '../dist/start-position.js';

const config = () => clone(DEFAULT_CONFIG);
const state = pieces => ({ pieces, turn: 0, ply: 0, winner: null });
const piece = (id, type, team, q, r, extra = {}) => ({ id, type, team, q, r, ...extra });

test('default classification ignores IDs, order, game history and absent flag spelling', () => {
  for (const geometry of ['hex', 'square']) {
    const c = config(); c.geometry = geometry; if (geometry === 'square') c.size = 10;
    const standard = createGame(c), draft = clone(standard);
    draft.pieces.reverse().forEach((p, index) => { p.id = `edited-${index}`; if (p.type === 'shield') p.reachedFarEdge = false; if (p.group == null) delete p.group; });
    Object.assign(draft, { turn: 1, ply: 23, winner: 1 });
    assert.equal(deploymentKey(draft), deploymentKey(standard));
    assert.equal(classifyPosition(draft, c), 'default');
  }
});

test('actual changes to squares, teams, types, groups or promotion make a custom deployment', () => {
  const c = config(), standard = createGame(c), key = deploymentKey(standard);
  const edits = [
    draft => { Object.assign(draft.pieces[0], { q: 0, r: 0 }); },
    draft => { draft.pieces[0].team = 1 - draft.pieces[0].team; },
    draft => { draft.pieces[0].type = 'archer'; },
    draft => { draft.pieces[0].group = 42; },
    draft => { draft.pieces.find(p => p.type === 'shield').reachedFarEdge = true; },
    draft => { draft.pieces.pop(); }
  ];
  for (const edit of edits) {
    const draft = clone(standard); edit(draft);
    assert.notEqual(deploymentKey(draft), key);
    assert.equal(classifyPosition(draft, c), 'custom');
  }
  const changedConfig = clone(c); changedConfig.army.archers = 1;
  assert.equal(classifyPosition(standard, changedConfig), 'custom');
  assert.equal(classifyPosition(createGame(changedConfig), changedConfig), 'default');
});

test('empty drafts are custom, while invalid positions and configurations remain errors', () => {
  const c = config();
  assert.equal(classifyPosition(state([]), c), 'custom');
  const emptyConfig = clone(c);
  Object.keys(emptyConfig.army).forEach(field => { emptyConfig.army[field] = 0; });
  assert.equal(classifyPosition(state([]), emptyConfig), 'custom');
  assert.throws(() => classifyPosition({ ...state([]), turn: 2 }, c), /Неверная позиция/);
  assert.throws(() => classifyPosition(state([]), { ...c, geometry: 'triangle' }), /тип поля/);
});

test('starting either side resets history and returns a detached position without mutating inputs', () => {
  const c = config(), draft = createGame(c);
  Object.assign(draft, { turn: 1, ply: 79, winner: 'draw' });
  const original = structuredClone(draft), originalConfig = structuredClone(c);
  for (const turn of [0, 1]) {
    const start = prepareStartPosition(draft, c, turn);
    assert.equal(start.turn, turn); assert.equal(start.ply, 0); assert.equal(start.winner, null);
    assert.deepEqual(start.pieces, clone(draft.pieces));
    assert.notEqual(start, draft); assert.notEqual(start.pieces, draft.pieces); assert.notEqual(start.pieces[0], draft.pieces[0]);
    start.pieces[0].q = 99;
    assert.deepEqual(draft, original);
    assert.deepEqual(c, originalConfig);
  }
});

test('starting requires valid turns, valid pieces and at least one combat unit for both sides', () => {
  const c = config(), standard = createGame(c);
  for (const turn of [-1, 2, '0', undefined]) assert.throws(() => prepareStartPosition(standard, c, turn), /ходит первой/);
  for (const team of [0, 1]) {
    const draft = state(standard.pieces.filter(p => p.team === team));
    assert.throws(() => prepareStartPosition(draft, c, 0), /хотя бы один броненосец или лукарь у каждой стороны/);
  }
  assert.throws(() => prepareStartPosition(state([]), c, 0), /хотя бы один броненосец или лукарь у каждой стороны/);
  const overlap = clone(standard); Object.assign(overlap.pieces[1], { q: overlap.pieces[0].q, r: overlap.pieces[0].r });
  assert.throws(() => prepareStartPosition(overlap, c, 0), /пересечение/);
  const invalidFlag = clone(standard); invalidFlag.pieces.find(p => p.type === 'shield').reachedFarEdge = 'true';
  assert.throws(() => prepareStartPosition(invalidFlag, c, 0), /признак достижения/);
});

test('starting preserves promotion and groups, normalizes edge promotion, and does not resolve combat', () => {
  const c = config(); c.stats.archer.damage = 20;
  const draft = state([
    piece('veteran', 'shield', 0, -1, 0, { group: 12, reachedFarEdge: true }),
    piece('edge', 'shield', 1, 0, -c.size, { group: 7 }),
    piece('north', 'archer', 0, 0, 0),
    piece('south', 'archer', 1, 1, 0)
  ]), before = clone(draft);
  const start = prepareStartPosition(draft, c, 1);
  assert.equal(start.pieces.length, 4);
  assert.equal(start.pieces.find(p => p.id === 'veteran').reachedFarEdge, true);
  assert.equal(start.pieces.find(p => p.id === 'veteran').group, 12);
  assert.equal(start.pieces.find(p => p.id === 'edge').reachedFarEdge, true);
  assert.equal(start.pieces.find(p => p.id === 'edge').group, 7);
  assert.deepEqual(draft, before);
  const explicitFlag = clone(draft); explicitFlag.pieces.find(p => p.id === 'edge').reachedFarEdge = true;
  assert.equal(classifyPosition(draft, c), classifyPosition(explicitFlag, c));
});
