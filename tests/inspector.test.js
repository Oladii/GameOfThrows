import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, PREVIOUS_FORMATION_CONFIG, LABELS, TYPES } from '../dist/rules.js';
import { effective, shieldCanRetreat, archerHasEdgeBonus, validateConfig, analyze, inspectCell, cells } from '../dist/engine.js';
import { unitStatParts, alliedBonusDetails, renderUnitBadges, renderDamageArrows, unitAppearance } from '../dist/board-presentation.js';
import { renderTokenBody } from '../dist/token-presentation.js';

test('the left panel alternates between the reference and selected figure, preserving scroll for previews', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const nodes = { '#inspector': { innerHTML: '', dataset: {} }, '#reference-panel': { hidden: false }, '#selection-panel': { hidden: true }, '.left-panel': { scrollTop: 180 } };
  const state = { pieces: [{ id: 'own', type: 'shield', team: 1, q: 0, r: 1 }, { id: 'ally', type: 'defenseLamp', team: 1, q: 1, r: 1 }], turn: 1, ply: 0, winner: null };
  const context = vm.createContext({ hint: null, $: selector => nodes[selector], selected: null, movement: null, combat: null, config: structuredClone(DEFAULT_CONFIG), visibleState: () => state,
    effective, shieldCanRetreat, archerHasEdgeBonus, unitStatParts, alliedBonusDetails, LABELS, icon: () => '<svg></svg>', plural: () => 'клетка' });
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

test('a movement aura forecast changes real bonuses without hovering every other piece', () => {
  const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'), config=structuredClone(PREVIOUS_FORMATION_CONFIG);
  const state={pieces:[{id:'moving',type:'archer',team:0,q:0,r:0},{id:'ally',type:'shield',team:0,q:1,r:0},{id:'enemy',type:'archer',team:1,q:3,r:0}],turn:0,ply:0,winner:null};
  const report=analyze(state,config), preview=inspectCell(state,config,{q:-1,r:1},'moving',report);
  assert.equal(preview.isPreview,true);
  assert.equal(report.get('ally').damage,19);
  assert.equal(preview.report.get('ally').damage,15);
  assert.equal(preview.report.get('ally').incoming,8);
  const badges=new Map(state.pieces.map(p=>[p.id,{outerHTML:''}])),layer={innerHTML:''};
  const tokens=state.pieces.map(p=>({dataset:{pieceId:p.id},classList:{toggle(){}},querySelector:()=>badges.get(p.id)}));
  const context=vm.createContext({ hint: null,config,cells,combat:null,movement:null,selected:'moving',report,ICON_PATHS:{},unitAppearance,renderTokenBody,
    unitBadges:renderUnitBadges,renderDamageArrows,key:(q,r)=>`${q},${r}`,point:p=>({x:p.q*50,y:p.r*50}),
    inspectionContext:()=>preview,paintAttackReach(){},renderInspector(){},$:()=>layer,
    document:{querySelectorAll:selector=>selector.endsWith('[data-piece-id]')?tokens:[]}});
  vm.runInContext(app.slice(app.indexOf('function highlightSources()'),app.indexOf('function paintAttackReach(')),context);
  context.highlightSources();
  assert.match(badges.get('ally').outerHTML,/data-attack="15"/);
  assert.match(badges.get('ally').outerHTML,/under-fire-target/);
  assert.ok(!badges.get('ally').outerHTML.includes('data-value="−8"'));
  context.inspectionContext=()=>inspectCell(state,config,{q:1,r:0},'moving',report);
  context.highlightSources();
  assert.ok(badges.get('ally').outerHTML.includes('data-value="−8"'));
});


test('the veteran reference separates permanent power and ally aura, including legacy saved settings', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const context = vm.createContext({ hint: null, config: structuredClone(DEFAULT_CONFIG), plural: () => 'клетку' });
  vm.runInContext(app.slice(app.indexOf('function shieldPromotionDescription('), app.indexOf('function shieldDescriptionMarkup(')), context);
  const description = context.shieldPromotionDescription();
  assert.match(description, /Урон: 6, дальность: 3, стойкость: 6/);
  assert.match(description, /союзникам \+1 к урону, \+1 к дальности и \+1 к стойкости/);
  context.config = structuredClone(PREVIOUS_FORMATION_CONFIG);
  delete context.config.shieldPromotion.allies;
  assert.match(context.shieldPromotionDescription(), /союзникам \+9 к урону, \+2 к дальности и \+9 к стойкости/);
  vm.runInContext(app.slice(app.indexOf('function victoryDescription('), app.indexOf('function renderAbout(')), context);
  assert.match(context.victoryDescription(), /ни броненосцев, ни лукарей/);
  delete context.config.victoryCondition;
  assert.match(context.victoryDescription(), /все фигуры противника, включая поддержку/);
  assert.ok(!app.includes('Ничья — тоже поражение'));
});

test('settings expose independent veteran bonuses and preserve legacy values when opened and saved', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  for (const legacy of [false, true]) {
    const config = structuredClone(legacy ? PREVIOUS_FORMATION_CONFIG : DEFAULT_CONFIG);
    if (legacy) { delete config.shieldPromotion.allies; delete config.victoryCondition; delete config.deploymentOffset; }
    const form = { elements: Object.fromEntries(['geometry', 'size', 'auraDefenseCap', 'victoryCondition', 'deploymentOffset', 'drumShieldMoveBonus'].map(name => [name, { value: '' }])) };
    const nodes = { '#settings-form': form, '#size-label': {}, '#settings-error': {} };
    for (const id of ['army-inputs', 'stats-table', 'promotion-inputs', 'promotion-allies-inputs', 'experiment-inputs']) nodes['#' + id] = {
      set innerHTML(html) {
        for (const match of html.matchAll(/<input([^>]+)>/g)) {
          const name = match[1].match(/name="([^"]+)"/)?.[1];
          if (name) form.elements[name] = { value: match[1].match(/value="([^"]*)"/)?.[1] ?? '', checked: match[1].includes('checked') };
        }
      }
    };
    const context = vm.createContext({ hint: null, config, TYPES, LABELS, clone: structuredClone, validateConfig, $: selector => nodes[selector] });
    vm.runInContext(app.slice(app.indexOf('const statFields ='), app.indexOf("$('#settings-open').addEventListener")), context);
    context.fillSettings(config);
    assert.equal(String(form.elements.deploymentOffset.value), '0');
    assert.equal(form.elements.victoryCondition.value, legacy ? 'all-units' : 'flag-or-combat');
    assert.equal(form.elements['shieldPromotion.damageBonus'].value, legacy ? '9' : '1');
    assert.equal(form.elements['shieldPromotion.allies.damageBonus'].value, legacy ? '9' : '1');
    const next = context.settingsFromForm();
    assert.equal(next.shieldPromotion.damageBonus, legacy ? 9 : 1);
    assert.equal(next.shieldPromotion.allies.damageBonus, legacy ? 9 : 1);
    assert.equal(next.shieldPromotion.allies.defenseBonus, legacy ? 9 : 1);
    assert.equal(next.victoryCondition, legacy ? 'all-units' : 'flag-or-combat');
  }
});
