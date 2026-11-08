import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, LABELS, TYPES } from '../dist/rules.js';
import { effective, shieldCanRetreat, validateConfig } from '../dist/engine.js';
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


test('the veteran reference separates permanent power and ally aura, including legacy saved settings', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({ config: structuredClone(DEFAULT_CONFIG), plural: () => 'клетку' });
  vm.runInContext(app.slice(app.indexOf('function shieldPromotionDescription('), app.indexOf('function shieldDescriptionMarkup(')), context);
  const description = context.shieldPromotionDescription();
  assert.match(description, /Урон: 24, дальность: 3, стойкость: 24/);
  assert.match(description, /союзникам \+3 к урону, \+1 к дальности, \+6 к стойкости/);
  delete context.config.shieldPromotion.allies;
  assert.match(context.shieldPromotionDescription(), /союзникам \+9 к урону, \+2 к дальности, \+9 к стойкости/);
  vm.runInContext(app.slice(app.indexOf('function victoryDescription('), app.indexOf('function renderAbout(')), context);
  assert.match(context.victoryDescription(), /ни броненосцев, ни лукарей/);
  delete context.config.victoryCondition;
  assert.match(context.victoryDescription(), /все фигуры противника, включая поддержку/);
  assert.ok(!app.includes('Ничья — тоже поражение'));
});

test('settings expose independent veteran bonuses and preserve legacy values when opened and saved', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  for (const legacy of [false, true]) {
    const config = structuredClone(DEFAULT_CONFIG);
    if (legacy) { delete config.shieldPromotion.allies; delete config.victoryCondition; delete config.deploymentOffset; }
    const form = { elements: Object.fromEntries(['geometry', 'size', 'auraDefenseCap', 'victoryCondition', 'deploymentOffset'].map(name => [name, { value: '' }])) };
    const nodes = { '#settings-form': form, '#size-label': {}, '#settings-error': {} };
    for (const id of ['army-inputs', 'stats-table', 'promotion-inputs', 'promotion-allies-inputs', 'experiment-inputs']) nodes['#' + id] = {
      set innerHTML(html) {
        for (const match of html.matchAll(/<input([^>]+)>/g)) {
          const name = match[1].match(/name="([^"]+)"/)?.[1];
          if (name) form.elements[name] = { value: match[1].match(/value="([^"]*)"/)?.[1] ?? '', checked: match[1].includes('checked') };
        }
      }
    };
    const context = vm.createContext({ config, TYPES, LABELS, clone: structuredClone, validateConfig, $: selector => nodes[selector] });
    vm.runInContext(app.slice(app.indexOf('const statFields ='), app.indexOf("$('#settings-open').addEventListener")), context);
    context.fillSettings(config);
    assert.equal(String(form.elements.deploymentOffset.value), '0');
    assert.equal(form.elements.victoryCondition.value, legacy ? 'all-units' : 'combat-units');
    assert.equal(form.elements['shieldPromotion.damageBonus'].value, '9');
    assert.equal(form.elements['shieldPromotion.allies.damageBonus'].value, legacy ? '9' : '3');
    const next = context.settingsFromForm();
    assert.equal(next.shieldPromotion.damageBonus, 9);
    assert.equal(next.shieldPromotion.allies.damageBonus, legacy ? 9 : 3);
    assert.equal(next.shieldPromotion.allies.defenseBonus, legacy ? 9 : 6);
    assert.equal(next.victoryCondition, legacy ? 'all-units' : 'combat-units');
  }
});
