import assert from 'node:assert/strict';
import { renderDamageArrows, layoutDamageArrows, attackReachPresentation, hexGridPoint, hexGridPolygon } from '../dist/board-presentation.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, key } from '../dist/engine.js';

const config = structuredClone(DEFAULT_CONFIG);
const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const own = piece('own', 'shield', 1, 0, 0);
const near = piece('near', 'shield', 0, 1, 0);
const far = piece('far', 'archer', 0, 0, -2);
const arrows = [{ source: near, target: own, damage: 5 }, { source: own, target: near, damage: 5 }, { source: far, target: own, damage: 2 }];
for (const maxBend of [18, 32]) {
  const old = layoutDamageArrows([arrows[0], arrows[2]], hexGridPoint, { maxBend });
  for (const visibleCount of [null, 0, 1, 2, 3]) {
    const html = renderDamageArrows(arrows, hexGridPoint, { config, maxBend, visibleCount });
    const rendered = [...html.matchAll(/data-source="([^"]+)" data-target="([^"]+)"[^>]*>(?:<path class="damage-arrow-half"[^>]*\/>)*<path class="damage-arrow-path" d="([^"]+)"/g)];
    assert.equal(rendered.length, visibleCount === null ? 2 : [0, 1, 1, 2][visibleCount]);
    for (const [, source, target, path] of rendered) {
      if (source === 'far') {
        const edge = old.find(e => e.source.id === source && e.target.id === target);
        assert.equal(path, `M${edge.from.x},${edge.from.y}Q${edge.control.x},${edge.control.y} ${edge.to.x},${edge.to.y}`);
      } else assert.match(path, /^M[-\d.e,]+L[-\d.e,]+$/);
    }
    assert.doesNotMatch(html, /attack-ray-label/);
  }
}
const view = (selected, position, visiblePosition = position) => attackReachPresentation(selected, position, config, {
  point: hexGridPoint, polygonPoints: hexGridPolygon({ x: 0, y: 0 }), visiblePosition
});
function assertAttackersHighlighted(selected, position, visiblePosition) {
  const { markup } = view(selected, position, visiblePosition);
  const fills = [...markup.matchAll(/<polygon[^>]*data-threat-cell="([^"]+)"/g)].map(m => m[1]);
  const attackers = analyze(position, config).get(selected.id).attackers;
  for (const attack of attackers) {
    const source = position.pieces.find(p => p.id === attack.id);
    assert.equal(fills.filter(k => k === key(source.q, source.r)).length, 1);
  }
  return { fills, attackers };
}
const position = { pieces: [own, near, far], turn: 1, ply: 0, winner: null };
const current = assertAttackersHighlighted(own, position);
assert.ok(current.attackers.some(a => a.id === 'far'));
assert.ok(current.fills.includes('0,-2'), 'incoming-only ranged attacker is highlighted');
const preview = inspectCell(position, config, { q: -1, r: 0 }, own.id);
assert.equal(preview.isPreview, true);
assertAttackersHighlighted(preview.piece, preview.position, position);
const block = piece('block', 'shield', 1, 0, -1);
const blocked = assertAttackersHighlighted(own, { ...position, pieces: [own, block, far] });
assert.ok(!blocked.attackers.some(a => a.id === 'far'));
assert.ok(!blocked.fills.includes('0,-2'), 'blocked enemy is not highlighted');
assert.equal(view(null, position).markup, '');
console.log('PASS: adjacent arrows straight, distant curves preserved, reveal counts, incoming highlights, preview and blocked shots.');
