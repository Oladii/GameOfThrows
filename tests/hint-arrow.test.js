import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHintArrow, layoutDamageArrows } from '../dist/board-presentation.js';

test('advice has one green damage-style arrow from the same departure point to cell centre', () => {
  const source = { id: 's', q: 0, r: 0 }, destination = { id: 't', q: 2, r: 1 };
  const point = p => ({ x: p.q * 50, y: p.r * 50 });
  const edge = layoutDamageArrows([{ source, target: destination, damage: 0 }], point, { straight: true })[0];
  const markup = renderHintArrow(source, destination, point);
  assert.ok(markup.includes(`M${edge.from.x},${edge.from.y}L100,50`));
  assert.match(markup, /class="damage-arrow-path"/);
  assert.match(markup, /fill="#44834a"/);
  assert.doesNotMatch(markup, /<circle|<text|polyline|attack-ray-label/);
});
