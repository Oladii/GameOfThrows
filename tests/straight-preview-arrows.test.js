import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { layoutDamageArrows, renderDamageArrows } from '../dist/board-presentation.js';

const point = p => ({ x: p.q, y: p.r });
const target = { id: 'target', q: 0, r: 0, team: 0 };
const sources = [{ id: 'far', q: -171, r: 0, team: 1 }, { id: 'near', q: -57, r: 0, team: 1 }, { id: 'diagonal', q: -57, r: 99, team: 1 }];
const arrows = sources.map((source, i) => ({ source, target, damage: 10 + i }));
const paths = html => [...html.matchAll(/class="damage-arrow-path" d="([^"]+)"/g)].map(m => m[1]);

function checkStraight(html) {
  assert.equal(paths(html).length, arrows.length);
  for (const d of paths(html)) assert.match(d, /^M[-\d.e,]+L[-\d.e,]+$/);
  assert.equal((html.match(/class="attack-ray-label"/g) || []).length, arrows.length);
}

test('multiple incoming preview arrows stay straight and keep centered damage labels above the ghost', () => {
  const edges = layoutDamageArrows(arrows, point, { straight: true });
  assert.equal(edges.length, arrows.length);
  for (const edge of edges) {
    assert.equal(edge.label.x, (edge.from.x + edge.to.x) / 2);
    assert.equal(edge.label.y, (edge.from.y + edge.to.y) / 2);
    assert.ok(Math.abs((edge.to.x - edge.from.x) * (edge.start.y - edge.from.y)
      - (edge.to.y - edge.from.y) * (edge.start.x - edge.from.x)) < 1e-8);
  }
  const html = renderDamageArrows(arrows, point, { straight: true, previewMarkup: '<g class="preview-ghost"></g>' });
  checkStraight(html);
  assert.ok(html.lastIndexOf('class="attack-ray"') < html.indexOf('class="preview-ghost"'));
  assert.ok(html.indexOf('class="preview-ghost"') < html.indexOf('class="attack-ray-label"'));
  assert.equal(layoutDamageArrows([{ source: target, target, damage: 1 }], point, { straight: true }).length, 0);
  assert.ok(paths(renderDamageArrows(arrows, point)).every(d => d.includes('Q')), 'combat keeps its default curved routing');
});

test('inspection and movement forecasts activate straight arrows while combat keeps its routing', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const layer = { innerHTML: '' };
  const report = new Map([[target.id, { attackers: arrows.map(a => ({ id: a.source.id, damage: a.damage })), dead: false }]]);
  const forecast = { piece: target, position: { pieces: [...sources, target] }, report };
  const context = vm.createContext({ combat: null, movement: null, selected: target.id, report,
    inspectionContext: () => ({ ...forecast, isPreview: true }),
    document: { querySelectorAll: () => [] }, paintAttackReach() {}, renderInspector() {}, $: () => layer,
    point, config: {}, cells: () => [], key: (q, r) => `${q},${r}`, ICON_PATHS: {},
    unitAppearance: () => ({ veteran: false }), renderTokenBody: () => '', unitBadges: () => '', renderDamageArrows });
  vm.runInContext(app.slice(app.indexOf('function highlightSources()'), app.indexOf('function paintAttackReach(')), context);
  context.highlightSources();
  checkStraight(layer.innerHTML);
  assert.match(layer.innerHTML, /class="preview-ghost/);
  context.movement = { forecast };
  context.highlightSources();
  checkStraight(layer.innerHTML);
  assert.doesNotMatch(layer.innerHTML, /class="preview-ghost/);
  context.combat = { phase: 'attacks', groups: [{ arrows }], groupIndex: 0, visiblePosition: forecast.position, arrowCount: arrows.length, report };
  context.highlightSources();
  assert.ok(paths(layer.innerHTML).every(d => d.includes('Q')));
});
