import test from 'node:test';
import assert from 'node:assert/strict';
import { cells } from '../dist/engine.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { boardNavigationTarget } from '../dist/board-navigation.js';

for (const geometry of ['hex', 'square']) {
  const config = { ...structuredClone(DEFAULT_CONFIG), geometry, size: geometry === 'hex' ? 4 : 8 };
  const board = cells(config);
  const go = (current, direction, wholeBoard = false) => boardNavigationTarget(board, current, direction, geometry, wholeBoard);

  test(`${geometry}: arrows traverse rows and can return without moving pieces`, () => {
    const origin = { q: 1, r: 1 }, before = JSON.stringify(board);
    assert.deepEqual(go(origin, 'ArrowRight'), { q: 2, r: 1 });
    assert.deepEqual(go(go(origin, 'ArrowRight'), 'ArrowLeft'), origin);
    assert.deepEqual(go(go(origin, 'ArrowUp'), 'ArrowDown'), origin);
    assert.equal(JSON.stringify(board), before);
  });

  test(`${geometry}: every arrow target is a board cell and edges never wrap`, () => {
    for (const current of board) {
      for (const direction of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        const next = go(current, direction);
        assert.ok(board.some(cell => cell.q === next.q && cell.r === next.r));
      }
    }
    const first = board.slice().sort((a, b) => a.r - b.r || a.q - b.q)[0];
    assert.deepEqual(go(first, 'ArrowUp'), first);
    assert.deepEqual(go(first, 'ArrowLeft'), first);
  });

  test(`${geometry}: Home and End address the row, Ctrl addresses the board`, () => {
    const middle = { q: 0, r: 0 };
    const row = board.filter(cell => cell.r === 0).sort((a, b) => a.q - b.q);
    assert.deepEqual(go(middle, 'Home'), row[0]);
    assert.deepEqual(go(middle, 'End'), row.at(-1));
    assert.equal(go(middle, 'Home', true).r, Math.min(...board.map(cell => cell.r)));
    assert.equal(go(middle, 'End', true).r, Math.max(...board.map(cell => cell.r)));
    assert.deepEqual(go(middle, 'Unrelated'), middle);
  });

  test(`${geometry}: rotated view keeps arrows and Home/End aligned with the screen`, () => {
    const project = cell => geometry === 'hex' ? { x: -(cell.q + cell.r / 2), y: -cell.r * Math.sqrt(3) / 2 } : { x: -cell.q, y: -cell.r };
    const rotatedGo = (cell, direction, wholeBoard = false) => boardNavigationTarget(board, cell, direction, geometry, wholeBoard, project);
    const origin = { q: 1, r: 1 };
    for (const [direction, axis, sign] of [['ArrowUp', 'y', -1], ['ArrowDown', 'y', 1], ['ArrowLeft', 'x', -1], ['ArrowRight', 'x', 1]]) {
      assert.ok(sign * (project(rotatedGo(origin, direction))[axis] - project(origin)[axis]) > 0);
    }
    assert.deepEqual(rotatedGo(rotatedGo(origin, 'ArrowUp'), 'ArrowDown'), origin);
    const row = board.filter(cell => cell.r === origin.r).sort((a, b) => project(a).x - project(b).x);
    assert.deepEqual(rotatedGo(origin, 'Home'), row[0]);
    assert.deepEqual(rotatedGo(origin, 'End'), row.at(-1));
    assert.equal(rotatedGo(origin, 'Home', true).r, Math.max(...board.map(cell => cell.r)));
    assert.equal(rotatedGo(origin, 'End', true).r, Math.min(...board.map(cell => cell.r)));
  });
}
