import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, LABELS } from '../dist/rules.js';
import { effective, shieldCanRetreat } from '../dist/engine.js';
import { unitStatParts, alliedBonusDetails } from '../dist/board-presentation.js';

test('the left panel alternates between the reference and selected figure, preserving scroll for previews', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const nodes = { '#inspector': { innerHTML: '', dataset: {} }, '#reference-panel': { hidden: false }, '#selection-panel': { hidden: true }, '.left-panel': { scrollTop: 180 } };
  const state = { pieces: [{ id: 'own', type: 'shield', team: 1, q: 0, r: 1 }, { id: 'ally', type: 'defenseLamp', team: 1, q: 1, r: 1 }], turn: 1, ply: 0, winner: null };
  const context = vm.createContext({ $: selector => nodes[selector], selected: null, config: structuredClone(DEFAULT_CONFIG), visibleState: () => state,
    effective, shieldCanRetreat, unitStatParts, alliedBonusDetails, LABELS, icon: () => '<svg></svg>', plural: () => 'клетка' });
  vm.runInContext(app.slice(app.indexOf('function renderInspector('), app.indexOf('function shieldPromotionDescription(')), context);
  context.renderInspector({});
  assert.equal(nodes['#reference-panel'].hidden, false); assert.equal(nodes['#selection-panel'].hidden, true);
  context.selected = 'own'; context.renderInspector({});
  assert.equal(nodes['#reference-panel'].hidden, true); assert.equal(nodes['#selection-panel'].hidden, false);
  assert.ok(nodes['#inspector'].innerHTML.includes('Броненосец'));
  assert.equal(nodes['.left-panel'].scrollTop, 0);
  nodes['.left-panel'].scrollTop = 140;
  const preview = structuredClone(state); preview.pieces[0].r = 0;
  context.renderInspector({ isPreview: true, piece: preview.pieces[0], position: preview });
  assert.equal(nodes['.left-panel'].scrollTop, 140);
  assert.ok(nodes['#inspector'].innerHTML.includes('Параметры после предполагаемого перемещения'));
  // The inspector also tracks a piece ID. Board repainting must not treat it as
  // an SVG token, or clearing selection throws before restoring the reference.
  const badge = { outerHTML: '' };
  const token = { dataset: { pieceId: 'own' }, classList: { toggle() {} }, querySelector: () => badge };
  nodes['#inspector'].classList = { toggle() {} };
  nodes['#inspector'].querySelector = () => null;
  context.document = { querySelectorAll: selector => selector.endsWith('[data-piece-id]')
    ? selector.startsWith('#board ') ? [token] : [token, nodes['#inspector']] : [] };
  context.report = new Map([['own', { damage: 15 }]]);
  context.inspectionContext = () => ({ report: context.report });
  context.unitBadges = () => '<g class="unit-badges">updated</g>';
  context.paintAttackReach = () => {};
  vm.runInContext(app.slice(app.indexOf('function highlightSources()'), app.indexOf('function paintAttackReach(')), context);
  context.selected = null; context.highlightSources();
  assert.equal(badge.outerHTML, '<g class="unit-badges">updated</g>');
  assert.equal(nodes['#reference-panel'].hidden, false); assert.equal(nodes['#selection-panel'].hidden, true);
  assert.equal(nodes['#inspector'].innerHTML, '');
});
