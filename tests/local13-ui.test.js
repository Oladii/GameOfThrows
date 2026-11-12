import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, TYPES, LABELS, updateSavedBalance } from '../dist/rules.js';
import { effective, validateConfig, shieldCanRetreat, archerHasEdgeBonus } from '../dist/engine.js';
import { alliedBonusDetails, unitStatParts, auraKind, auraCircleMarkup } from '../dist/board-presentation.js';
import { renderTokenBody, HORN_ICON_PATH, COMMANDER_ICON_PATH } from '../dist/token-presentation.js';
import { renderUnitExamples } from '../dist/onboarding-units.js';
import { renderMoveExamples, renderCombatExamples } from '../dist/onboarding-examples.js';
import { renderShowcaseBattle } from '../dist/onboarding-showcase.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('horn has a native white glyph on the established token body without a bitmap', () => {
  const markup = renderTokenBody({ type: 'horn', veteran: false }, 0);
  assert.ok(markup.includes(HORN_ICON_PATH));
  assert.match(markup, /<g color="#fff"><svg width="24" height="24" viewBox="0 0 97 96"/);
  assert.equal((HORN_ICON_PATH.match(/<path /g) || []).length, 6);
  assert.equal((HORN_ICON_PATH.match(/stroke="currentColor" stroke-width="5.75"/g) || []).length, 6);
  assert.match(markup, /class="piece-icon" fill="none" stroke="#fff" stroke-width="1.6"/);
  assert.match(markup, /data-artwork="body"/);
  assert.doesNotMatch(markup, /undefined|data-artwork="type-horn"/);
});

test('source breakdown attributes the drum movement bonus to every recipient type', () => {
  for (const type of TYPES) {
    const target = { id: 'target', type, team: 0, q: 1, r: 0 };
    const source = { id: 'drum', type: 'attackLamp', team: 0, q: 0, r: 0 };
    const state = position([target, source]);
    const details = alliedBonusDetails(target, state, DEFAULT_CONFIG);
    assert.equal(effective(target, state, DEFAULT_CONFIG).move, DEFAULT_CONFIG.stats[type].move + 1, type);
    assert.equal(details.find(detail => detail.source.id === 'drum')?.bonuses.move, 1, type);
    assert.equal(details.find(detail => detail.source.id === 'drum')?.bonuses.damage, 0, type);
  }
});

test('horn damage and common shield defense appear in the actual source breakdown', () => {
  const target = { id: 'target', type: 'archer', team: 0, q: 0, r: 0 };
  const state = position([target, { id: 'horn', type: 'horn', team: 0, q: 1, r: 0 }, { id: 'shield', type: 'shield', team: 0, q: 0, r: 1 }]);
  const details = alliedBonusDetails(target, state, DEFAULT_CONFIG);
  assert.equal(details.find(detail => detail.source.id === 'horn')?.bonuses.damage, 1);
  assert.equal(details.find(detail => detail.source.id === 'shield')?.bonuses.fortitude, 1);
  assert.equal(effective(target, state, DEFAULT_CONFIG).damage, 3);
  assert.equal(effective(target, state, DEFAULT_CONFIG).fortitude, 4);
  assert.equal(auraKind(state.pieces[1], DEFAULT_CONFIG), 'horn');
  const drum = { id: 'drum', type: 'attackLamp', team: 0, q: 0, r: 0 };
  assert.equal(auraKind(drum, DEFAULT_CONFIG), 'move');
  assert.match(auraCircleMarkup(drum, position([drum]), DEFAULT_CONFIG, () => ({ x: 0, y: 0 }), 50), /data-aura-kind="move"/);
});

test('settings round trip all six types and preserve archived configurations without horn', () => {
  for (const input of [DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG]) {
    const config = structuredClone(input);
    const form = { elements: Object.fromEntries(['geometry', 'size', 'auraDefenseCap', 'victoryCondition', 'deploymentOffset', 'drumShieldMoveBonus'].map(name => [name, { value: '' }])) };
    const nodes = { '#settings-form': form, '#size-label': {}, '#settings-error': {}, '#drum-move-label': {}, '#drum-move-help': {} };
    for (const id of ['army-inputs', 'stats-table', 'promotion-inputs', 'promotion-allies-inputs', 'experiment-inputs']) nodes['#' + id] = {
      set innerHTML(value) {
        for (const match of value.matchAll(/<input([^>]+)>/g)) {
          const name = match[1].match(/name="([^"]+)"/)?.[1];
          if (name) form.elements[name] = { value: match[1].match(/value="([^"]*)"/)?.[1] ?? '', checked: match[1].includes('checked') };
        }
      }
    };
    const context = vm.createContext({ hint: null, config, TYPES, LABELS, clone: structuredClone, validateConfig, $: selector => nodes[selector] });
    vm.runInContext(app.slice(app.indexOf('const statFields ='), app.indexOf("$('#settings-open').addEventListener")), context);
    context.fillSettings(config);
    const next = context.settingsFromForm();
    assert.deepEqual(next.stats, config.stats);
    assert.equal(next.army.horns, config.army.horns ?? 0);
    if (input === DEFAULT_CONFIG) {
      assert.equal(form.elements['army.horns'].value, '1');
      assert.equal(form.elements['stats.horn.damageBonus'].value, '1');
      assert.equal(form.elements['stats.scoutLamp.damage'].value, '3');
      assert.equal(form.elements['stats.scoutLamp.range'].value, '2');
      assert.match(nodes['#drum-move-label'].textContent, /всех союзников/);
    }
  }
});

test('interactive training opens directly and production retains its original saved game namespace', () => {
  assert.match(app, /const STORAGE = archiveIsSite \? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1'/);
  const storageDeclaration=app.match(/^const STORAGE = .*;$/m)[0];
  for(const [site,expected]of [[true,'lamps-prototype-v1'],[false,'lamps-local-playtest13-v1']]){const context=vm.createContext({ hint: null,archiveIsSite:site});assert.equal(vm.runInContext(storageDeclaration+'\nSTORAGE',context),expected);}
  assert.doesNotMatch(app, /localStorage\.(?:removeItem|clear)\(/);
  assert.doesNotMatch(app, /next\.stats\.attackLamp\.damage = 2/);
  const openAbout = app.slice(app.indexOf('function openAbout()'), app.indexOf('function goToOnboardingStep('));
  assert.match(openAbout, /showAboutView\(true\)/);
  assert.match(openAbout, /renderOnboarding\(\)/);
  assert.match(html, /<div class="about-switch"/);
  assert.match(html, /id="onboarding-open"[^>]*>Обучение с примерами/);
  assert.match(html, /<strong>Горнист<\/strong> усиливает урон союзников всех типов/);
  assert.match(html, /<strong>Барабанщик<\/strong> добавляет союзникам всех типов шаг/);
});


test('commander reuses the established helmet and keeps the scout mechanics identifier', () => {
  assert.equal(LABELS.scoutLamp, 'Командир');
  assert.ok(TYPES.includes('scoutLamp'));
  const markup = renderTokenBody({ type: 'scoutLamp', veteran: false }, 1);
  assert.ok(markup.includes(COMMANDER_ICON_PATH));
  assert.match(COMMANDER_ICON_PATH, /M3 9c0-4\.3 4-7 9-7/);
  assert.doesNotMatch(markup, /data-artwork="type-scoutLamp"/);
  assert.match(app, /scoutLamp: COMMANDER_ICON_PATH/);
  assert.match(html, /<strong>Командир<\/strong> увеличивает дальность союзных лукарей/);
  assert.doesNotMatch(html, /[Рр]азведчик|бинокл/);
});

test('saved logs rename scout cases while preserving new commander messages on reload', () => {
  const context = vm.createContext({ hint: null, LABELS });
  vm.runInContext(app.slice(app.indexOf('function normalizeUnitNames('), app.indexOf('function normalizeLog(')), context);
  assert.equal(context.normalizeUnitNames('Разведчик · разведчика · разведчику · разведчиком · разведчике'), 'Командир · командира · командиру · командиром · командире');
  assert.equal(context.normalizeUnitNames('Разведчики · разведчиков · разведчикам · разведчиками · разведчиках'), 'Командиры · командиров · командирам · командирами · командирах');
  assert.equal(context.normalizeUnitNames('Командир · командира · командиру · командиром'), 'Командир · командира · командиру · командиром');
});


test('commander inspector distinguishes an independent attack from historical support', () => {
  for (const input of [DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG]) {
    const config = structuredClone(input);
    const state = position([{ id: 'commander', type: 'scoutLamp', team: 0, q: 0, r: 0 }]);
    const nodes = { '#inspector': { innerHTML: '', dataset: {} }, '#reference-panel': {}, '#selection-panel': {}, '.left-panel': { scrollTop: 0 } };
    const context = vm.createContext({ hint: null, config, selected: 'commander', movement: null, combat: null, visibleState: () => state, effective, shieldCanRetreat, archerHasEdgeBonus, unitStatParts, alliedBonusDetails, LABELS, icon: () => '<svg/>', plural: () => 'клетки', $: selector => nodes[selector] });
    vm.runInContext(app.slice(app.indexOf('function renderInspector('), app.indexOf('function shieldPromotionDescription(')), context);
    context.renderInspector({});
    if (input === DEFAULT_CONFIG) {
      assert.match(nodes['#inspector'].innerHTML, /Атакует самостоятельно: урон 3, дальность 2/);
      assert.match(nodes['#inspector'].innerHTML, /Дальность не увеличивается от аур/);
    }
    else {
      assert.match(nodes['#inspector'].innerHTML, /Может атаковать только рядом с союзным ветераном/);
      assert.doesNotMatch(nodes['#inspector'].innerHTML, /Атакует самостоятельно/);
    }
  }
});


test('loading revision20 arms the current commander without rebuilding the position or history', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.stats.scoutLamp.damage = 0; config.stats.scoutLamp.range = 0;
  const state = position([{ id: 'saved', type: 'shield', team: 0, q: 2, r: 1 }]);
  const history = [{ saved: true }], lastTurn = { saved: true };
  const context = vm.createContext({ hint: null, config, state, history, lastTurn, gamePhase: 'setup', positionKind: 'custom', editor: true, saved: { balanceRevision: 20 }, updateSavedBalance, validateConfig, balanceUpdated: false, commanderUpdated: false, gameVersion: '0.1.36', CURRENT_GAME_VERSION: '0.1.36' });
  const start = app.indexOf('    // Arm the existing local13 commander');
  vm.runInContext(app.slice(start, app.indexOf('    const updatedBalance =', start)), context);
  assert.equal(context.config.stats.scoutLamp.damage, 3);
  assert.equal(context.config.stats.scoutLamp.range, 2);
  assert.deepEqual(context.config.army, config.army);
  assert.strictEqual(context.state, state);
  assert.strictEqual(context.history, history);
  assert.strictEqual(context.lastTurn, lastTurn);
  assert.equal(context.commanderUpdated, true);
  let notification = '';
  context.toast = message => { notification = message; };
  vm.runInContext(app.slice(app.lastIndexOf('if (balanceUpdated) toast(')), context);
  assert.equal(notification, 'Командир: атака 3, дальность 2. Расстановка сохранена.');
});


test('the visible tutorial renders six unit scenes and a flag victory exercise while keeping text rules separately available', () => {
  const nodes = Object.fromEntries(['onboarding-progress', 'onboarding-body', 'onboarding-back', 'onboarding-count', 'onboarding-next', 'onboarding', 'rules-reference', 'about-guide-tab', 'about-reference-tab'].map(id => ['#' + id, { innerHTML: '', attrs: {}, setAttribute(name, value) { this.attrs[name] = value; } }]));
  const context = vm.createContext({ hint: null, DEFAULT_CONFIG, LABELS, ICON_PATHS: {}, unitBadges: () => '', icon: type => `<svg data-icon="${type}"/>`, renderUnitExamples, renderMoveExamples, renderCombatExamples, renderShowcaseBattle, gamePhase: 'playing', editor: false, $: selector => nodes[selector] });
  vm.runInContext(app.slice(app.indexOf('const onboardingSteps ='), app.indexOf('function showAboutView(')), context);
  vm.runInContext('renderOnboarding()', context);
  assert.match(nodes['#onboarding-body'].innerHTML, /data-showcase-action="next"/);
  assert.match(nodes['#onboarding-body'].innerHTML, /Уничтожьте вражеский флаг или всех броненосцев и лукарей\. После каждого хода обе армии атакуют автоматически\. Одновременное поражение — ничья\./);
  assert.match(nodes['#onboarding-body'].innerHTML, /Листайте бой стрелками, затем попробуйте учебные ходы\. Примеры используют стандартные параметры этой версии и не меняют вашу партию\./);
  for (const type of TYPES) assert.ok(nodes['#onboarding-body'].innerHTML.includes(`data-icon="${type}"`));
  assert.doesNotMatch(nodes['#onboarding-body'].innerHTML, /Исторические примеры|прежние правила/);
  vm.runInContext('onboardingStep = 1; renderOnboarding()', context);
  for (const type of TYPES) assert.ok(nodes['#onboarding-body'].innerHTML.includes(`data-lesson-scene="unit-${type}"`));
  vm.runInContext('onboardingStep = 3; renderOnboarding()', context);
  assert.match(nodes['#onboarding-body'].innerHTML, /data-lesson-scene="11"/);
  context.cancelOnboardingAnimation = () => false;
  vm.runInContext(app.slice(app.indexOf('function showAboutView('), app.indexOf('function openAbout(')), context);
  context.showAboutView(false);
  assert.equal(nodes['#onboarding'].hidden, true);
  assert.equal(nodes['#rules-reference'].hidden, false);
  assert.equal(nodes['#about-reference-tab'].attrs['aria-pressed'], 'true');
  context.showAboutView(true);
  assert.equal(nodes['#onboarding'].hidden, false);
  assert.equal(nodes['#rules-reference'].hidden, true);
  assert.equal(nodes['#about-guide-tab'].attrs['aria-pressed'], 'true');
});

test('the commander source panel keeps move, damage and defense bonuses while excluding range growth', () => {
  const target = { id: 'commander', type: 'scoutLamp', team: 0, q: 0, r: 0 };
  const state = position([target, { id: 'veteran', type: 'shield', team: 0, q: 1, r: 0, reachedFarEdge: true }, { id: 'drummer', type: 'attackLamp', team: 0, q: 0, r: 1 }]);
  const details = alliedBonusDetails(target, state, DEFAULT_CONFIG);
  const veteran = details.find(detail => detail.source.id === 'veteran');
  assert.equal(effective(target, state, DEFAULT_CONFIG).range, 2);
  assert.equal(veteran.bonuses.range, 0);
  assert.equal(veteran.bonuses.damage, 1);
  assert.equal(veteran.bonuses.fortitude, 1);
  assert.equal(details.find(detail => detail.source.id === 'drummer').bonuses.move, 1);
  assert.match(html, /Дальность не увеличивается от аур/);
  assert.match(html, /Броненосцы и командиры с собственной атакой не получают дополнительную дальность/);
  const legacy = structuredClone(PREVIOUS_LOCAL_CONFIG);
  const legacyDetails = alliedBonusDetails(target, state, legacy);
  assert.equal(legacyDetails.find(detail => detail.source.id === 'veteran').bonuses.range, 1);
});
