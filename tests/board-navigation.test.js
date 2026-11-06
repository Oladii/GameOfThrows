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
}
