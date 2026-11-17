import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, cells, key } from '../dist/engine.js';
import { unitAppearance, renderUnitBadges, renderDamageArrows, inspectionDamageArrows, hexGridPoint } from '../dist/board-presentation.js';
import { renderTokenBody } from '../dist/token-presentation.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const declaration = name => { const start = app.indexOf(`function ${name}(`); return app.slice(start, app.indexOf('\n}', start) + 2); };
const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
function setup(pieces) {
  const config = structuredClone(DEFAULT_CONFIG);
  const state = { pieces, turn: 0, ply: 0, winner: null }, before = JSON.stringify(state);
  const report = analyze(state, config), layer = { innerHTML: '' }, panels = [], auras = [];
  const badges = new Map(pieces.map(p => [p.id, { outerHTML: '' }]));
  const originals = pieces.map(p => ({ dataset: { pieceId: p.id, pieceType: p.type, veteran: 'false' },
    classList: { toggle() {} }, querySelector: () => badges.get(p.id) }));
  const classes = new Set(), token = { innerHTML: '', dataset: {},
    classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } } };
  const context = vm.createContext({ config, state, report, selected: pieces[0].id, editor: false, playMode: 'local', humanTeam: 0,
    hover: null, inspection: null, movement: null, combat: null, ICON_PATHS: {}, key, cells, inspectCell,
    unitAppearance, renderTokenBody, unitBadges: renderUnitBadges, renderDamageArrows, inspectionDamageArrows,
    visibleState: () => state, point: hexGridPoint, $: () => layer,
    document: { querySelectorAll: selector => selector.endsWith('[data-piece-id]') ? originals : [] },
    paintAuras() { auras.push(context.inspection?.piece || pieces[0]); }, paintAttackReach() {},
    renderInspector(value) { panels.push(value); } });
  for (const name of ['inspectionContext', 'highlightSources', 'previewDraggedPiece']) vm.runInContext(declaration(name), context);
  return { context, token, classes, layer, panels, auras, state, before, badges,
    preview(cellKey) { context.previewDraggedPiece(pieces[0], cellKey, token); } };
}

test('dragging out of allied auras updates token badges, the inspector and other pieces without moving the state', () => {
  const ui = setup([piece('moving', 'archer', 0, 0, 0), piece('horn', 'horn', 0, 0, 1),
    piece('flag', 'defenseLamp', 0, 1, 1), piece('shield', 'shield', 0, 1, 0)]);
  ui.preview('-2,0');
  assert.match(ui.token.innerHTML, /data-attack="2"/);
  assert.match(ui.token.innerHTML, /data-fortitude="3"/);
  assert.equal(ui.context.inspection.isDragPreview, true);
  assert.equal(ui.panels.at(-1).isPreview, true);
  assert.equal(ui.panels.at(-1).report.get('moving').damage, 2);
  assert.deepEqual([ui.auras.at(-1).q, ui.auras.at(-1).r], [-2, 0]);
  assert.ok(ui.badges.get('shield').outerHTML.length > 0);
  assert.doesNotMatch(ui.layer.innerHTML, /preview-token/); // Only the dragged token is visible.
  ui.preview('-1,0');
  assert.match(ui.token.innerHTML, /data-attack="3"/);
  assert.match(ui.token.innerHTML, /data-fortitude="4"/);
  ui.preview(null);
  assert.match(ui.token.innerHTML, /data-attack="3"/);
  assert.match(ui.token.innerHTML, /data-fortitude="5"/);
  assert.equal(ui.context.inspection, null);
  assert.equal(ui.panels.at(-1).isPreview, false);
  assert.equal(JSON.stringify(ui.state), ui.before);
});

test('edge promotion appears during a drag and disappears when moving back to a non-promoting cell', () => {
  const ui = setup([piece('moving', 'archer', 0, 0, 4)]);
  ui.preview('0,5');
  assert.ok(ui.classes.has('veteran'));
  assert.equal(ui.token.dataset.veteran, 'true');
  assert.match(ui.token.innerHTML, /data-artwork="wreath"/);
  ui.preview('0,3');
  assert.ok(!ui.classes.has('veteran'));
  assert.equal(ui.token.dataset.veteran, 'false');
  assert.doesNotMatch(ui.token.innerHTML, /data-artwork="wreath"/);
  assert.equal(JSON.stringify(ui.state), ui.before);
});

test('lethal damage is forecast on the dragged token and cleared when the gesture leaves its destination', () => {
  const ui = setup([piece('moving', 'archer', 0, 0, 0), piece('enemy', 'shield', 1, 2, 0)]);
  ui.preview('1,0');
  assert.ok(ui.classes.has('fatal'));
  assert.equal(ui.panels.at(-1).report.get('moving').dead, true);
  ui.preview(null);
  assert.ok(!ui.classes.has('fatal'));
  assert.equal(ui.panels.at(-1).report.get('moving').dead, false);
  assert.equal(JSON.stringify(ui.state), ui.before);
});
