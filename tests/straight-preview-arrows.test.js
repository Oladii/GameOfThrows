import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { layoutDamageArrows, renderDamageArrows, inspectionDamageArrows } from '../dist/board-presentation.js';

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

test('inspection and movement forecasts retain gently curved incoming arrows', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const layer = { innerHTML: '' };
  const report = new Map([[target.id, { attackers: arrows.map(a => ({ id: a.source.id, damage: a.damage })), dead: false }]]);
  const forecast = { piece: target, position: { pieces: [...sources, target] }, report };
  const context = vm.createContext({ playMode: 'local', humanTeam: 0, combat: null, movement: null, selected: target.id, report,
    inspectionContext: () => ({ ...forecast, isPreview: true }),
    document: { querySelectorAll: () => [] }, paintAttackReach() {}, renderInspector() {}, $: () => layer,
    point, config: {}, cells: () => [], key: (q, r) => `${q},${r}`, ICON_PATHS: {},
    unitAppearance: () => ({ veteran: false }), renderTokenBody: () => '', unitBadges: () => '', renderDamageArrows, inspectionDamageArrows });
  vm.runInContext(app.slice(app.indexOf('function highlightSources()'), app.indexOf('function paintAttackReach(')), context);
  context.highlightSources();
  assert.equal(paths(layer.innerHTML).length, arrows.length);
  assert.ok(paths(layer.innerHTML).every(d => d.includes('Q')));
  assert.match(layer.innerHTML, /class="preview-ghost/);
  context.movement = { forecast };
  context.highlightSources();
  assert.equal(paths(layer.innerHTML).length, arrows.length);
  assert.ok(paths(layer.innerHTML).every(d => d.includes('Q')));
  assert.doesNotMatch(layer.innerHTML, /class="preview-ghost/);
  context.combat = { phase: 'attacks', groups: [{ arrows }], groupIndex: 0, visiblePosition: forecast.position, arrowCount: arrows.length, report };
  context.highlightSources();
  assert.ok(paths(layer.innerHTML).every(d => d.includes('Q')));
});


test('selected unit keeps enemy incoming rays and shows its damage as enemy badges', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const own = { ...target }, enemy = { ...sources[0] };
  const report = new Map([
    [own.id, { attackers: [{ id: enemy.id, damage: 5 }], incoming: 5, dead: false }],
    [enemy.id, { attackers: [{ id: own.id, damage: 2 }, { id: 'ally', damage: 7 }], incoming: 9, dead: true }]
  ]);
  const badges = new Map(), layer = { innerHTML: '' };
  const elements = [own, enemy].map(piece => ({ dataset: { pieceId: piece.id }, classList: { toggle() {} },
    querySelector: () => ({ set outerHTML(value) { badges.set(piece.id, value); } }) }));
  const context = vm.createContext({ playMode: 'local', humanTeam: 0, combat: null, movement: null, selected: own.id, report,
    inspectionContext: () => ({ piece: own, position: { turn: 0, pieces: [own, enemy] }, report, isPreview: false }),
    document: { querySelectorAll: selector => selector.includes('data-piece-id') ? elements : [] },
    paintAttackReach() {}, renderInspector() {}, $: () => layer, point, config: {}, cells: () => [], key: () => '',
    unitBadges: (info, options) => ({ incoming: info.incoming, dead: info.dead, show: options.showIncoming }),
    renderDamageArrows, inspectionDamageArrows });
  vm.runInContext(app.slice(app.indexOf('function highlightSources()'), app.indexOf('function paintAttackReach(')), context);
  context.highlightSources();
  assert.equal(paths(layer.innerHTML).length, 1);
  assert.match(layer.innerHTML, /data-source="far" data-target="target"/);
  assert.equal(badges.get(enemy.id).incoming, 2, 'shows selected contribution rather than total army damage');
  assert.equal(badges.get(enemy.id).show, true);
  assert.equal(badges.get(enemy.id).dead, false, 'damage remains readable even for lethal targets');
  assert.equal(badges.get(own.id).incoming, 5);
});
