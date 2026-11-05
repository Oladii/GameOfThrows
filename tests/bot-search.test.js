import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaBeta } from '../bot-search.mjs';

test('four-ply search sees a consequence beyond the two-ply horizon', () => {
  const branch = values => values.reduceRight((child, immediate, index) => ({ immediate, max: index % 2 === 1, children: child ? [child] : [] }), null);
  const a = branch([5, 5, 5, -100]), b = branch([0, 0, 0, 10]);
  let maxVisited = 0;
  const ctx = { terminal: () => false, maximizing: n => n.max, children: n => n.children, visit: (_, remaining) => { maxVisited = Math.max(maxVisited, 4 - remaining); } };
  assert.ok(alphaBeta(a, 1, -Infinity, Infinity, ctx) > alphaBeta(b, 1, -Infinity, Infinity, ctx));
  maxVisited = 0;
  assert.ok(alphaBeta(a, 3, -Infinity, Infinity, ctx) < alphaBeta(b, 3, -Infinity, Infinity, ctx));
  assert.equal(maxVisited, 4);
});

test('alpha-beta alternates max/min and stops at terminal nodes', () => {
  const root = { immediate: 0, max: true, children: [
    { immediate: 0, max: false, children: [{ immediate: 4 }, { immediate: -3 }] },
    { immediate: 0, max: false, children: [{ immediate: 2 }, { immediate: 5 }] }
  ] };
  const ctx = { terminal: n => !n.children, maximizing: n => n.max, children: n => n.children };
  assert.equal(alphaBeta(root, 4, -Infinity, Infinity, ctx), 2);
});
