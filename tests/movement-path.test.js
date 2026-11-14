import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, cells, directions, movementPath, reachable } from '../dist/engine.js';

const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const state = pieces => ({ pieces, turn: 0, ply: 0, winner: null });
const squareConfig = () => {
  const config = clone(DEFAULT_CONFIG);
  config.geometry = 'square'; config.size = 6; config.experiments.squareDiagonals = false;
  return config;
};
const position = ({ q, r }) => ({ q, r });

function assertLegalPath(path, moving, current, config, destination) {
  const route = reachable(moving, current, config).find(cell => cell.q === destination.q && cell.r === destination.r);
  assert.ok(route);
  assert.deepEqual(path[0], position(moving));
  assert.deepEqual(path.at(-1), destination);
  assert.equal(path.length - 1, route.steps);
  const board = new Set(cells(config).map(cell => `${cell.q},${cell.r}`));
  const farRow = config.geometry === 'hex' ? (moving.team === 0 ? config.size : -config.size) : (moving.team === 0 ? config.size - 1 : 0);
  let unlocked = moving.reachedFarEdge === true || moving.r === farRow;
  for (let index = 1; index < path.length; index++) {
    const previous = path[index - 1], cell = path[index];
    assert.ok(board.has(`${cell.q},${cell.r}`));
    assert.ok(directions(config).some(([q, r]) => previous.q + q === cell.q && previous.r + r === cell.r));
    assert.ok(!current.pieces.some(other => other.team !== moving.team && other.q === cell.q && other.r === cell.r));
    if (moving.type === 'shield' && !unlocked) assert.ok((cell.r - previous.r) * (moving.team === 0 ? 1 : -1) >= 0);
    if (moving.type === 'shield' && cell.r === farRow) unlocked = true;
    assert.deepEqual(Object.keys(cell).sort(), ['q', 'r']);
  }
  assert.ok(!current.pieces.some(other => other.q === destination.q && other.r === destination.r));
  if (route.reachedFarEdge) assert.equal(unlocked, true);
}

test('movement path turns around enemy blockers and passes an ally without stopping on it', () => {
  const config = squareConfig(); config.stats.archer.move = 5;
  const moving = piece('moving', 'archer', 0, 0, 0), destination = { q: 3, r: 0 };
  const current = state([moving, piece('wall1', 'shield', 1, 1, 0), piece('wall2', 'archer', 1, 2, 0), piece('ally', 'shield', 0, 1, 1)]);
  const path = movementPath(moving, current, config, destination);
  assert.deepEqual(path, [{ q: 0, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 }, destination]);
  assertLegalPath(path, moving, current, config, destination);
  assert.deepEqual(movementPath(moving, current, config, { q: 1, r: 1 }), []);
  config.stats.archer.move = 4;
  assert.deepEqual(movementPath(moving, current, config, destination), []);
});

test('movement path never crosses an enemy wall and rejects occupied or invalid destinations', () => {
  const config = squareConfig(); config.stats.archer.move = 6;
  const moving = piece('moving', 'archer', 0, 0, 0);
  const current = state([moving, ...Array.from({ length: config.size }, (_, r) => piece(`enemy${r}`, 'shield', 1, 1, r))]);
  for (const destination of [{ q: 2, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 0 }, { q: -1, r: 0 }, { q: 6, r: 0 }, { q: '0', r: 1 }, null]) {
    assert.deepEqual(movementPath(moving, current, config, destination), []);
  }
});

test('square movement path respects cardinal and diagonal settings', () => {
  const config = squareConfig(); config.stats.archer.move = 1;
  const moving = piece('moving', 'archer', 0, 1, 1), current = state([moving]), destination = { q: 2, r: 2 };
  assert.deepEqual(movementPath(moving, current, config, destination), []);
  config.stats.archer.move = 2;
  assert.deepEqual(movementPath(moving, current, config, destination), [{ q: 1, r: 1 }, { q: 2, r: 1 }, destination]);
  config.stats.archer.move = 1; config.experiments.squareDiagonals = true;
  const path = movementPath(moving, current, config, destination);
  assert.deepEqual(path, [{ q: 1, r: 1 }, destination]);
  assertLegalPath(path, moving, current, config, destination);
});

test('shield takes the direct route without detouring to the edge or unlocking retreat', () => {
  for (const geometry of ['hex', 'square']) for (const team of [0, 1]) {
    const config = clone(DEFAULT_CONFIG); config.geometry = geometry; config.stats.shield.move = 3;
    if (geometry === 'square') { config.size = 6; config.experiments.squareDiagonals = false; }
    const forward = team === 0 ? 1 : -1;
    const edge = geometry === 'hex' ? forward * config.size : team === 0 ? config.size - 1 : 0;
    const q = geometry === 'hex' ? 0 : 2;
    const moving = piece('moving', 'shield', team, q, edge - forward), current = state([moving]);
    const destination = { q: q - forward, r: edge - forward };
    const route = reachable(moving, current, config).find(cell => cell.q === destination.q && cell.r === destination.r);
    assert.deepEqual(route, { ...destination, steps: 1 });
    const path = movementPath(moving, current, config, destination);
    assert.ok(path.every(cell => cell.r !== edge));
    assertLegalPath(path, moving, current, config, destination);
    assert.deepEqual(movementPath(moving, current, config, { q, r: edge - forward * 2 }), []);
    assert.equal(moving.reachedFarEdge, undefined);
  }
});

test('shield path restricts retreat until reaching the far edge and retains permanent promotion', () => {
  for (const geometry of ['hex', 'square']) for (const team of [0, 1]) {
    const config = clone(DEFAULT_CONFIG); config.geometry = geometry; config.stats.shield.move = 2;
    if (geometry === 'square') config.size = 6;
    const origin = geometry === 'hex' ? 0 : 2, forward = team === 0 ? 1 : -1;
    const moving = piece('moving', 'shield', team, origin, origin), current = state([moving]);
    const destination = { q: origin, r: origin - forward };
    assert.deepEqual(movementPath(moving, current, config, destination), []);
    moving.reachedFarEdge = true;
    const path = movementPath(moving, current, config, destination);
    assert.deepEqual(path, [{ q: origin, r: origin }, destination]);
    assertLegalPath(path, moving, current, config, destination);
  }
});

test('path lookup preserves inputs and reachable records and returns detached coordinate objects', () => {
  const config = clone(DEFAULT_CONFIG); config.stats.archer.move = 4;
  const moving = piece('moving', 'archer', 0, 0, 0), current = state([moving, piece('enemy', 'shield', 1, 1, 0)]);
  const before = clone({ current, config }), expected = reachable(moving, current, config);
  for (const destination of expected) {
    const path = movementPath(moving, current, config, destination);
    assertLegalPath(path, moving, current, config, position(destination));
    path[0].q = 999; path.at(-1).r = 999;
  }
  assert.deepEqual({ current, config }, before);
  assert.deepEqual(reachable(moving, current, config), expected);
  for (const destination of expected) assert.deepEqual(Object.keys(destination).sort(), ['q', 'r', 'steps']);
});
