import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, createGame, move } from '../dist/engine.js';
import { chooseBotAction } from '../dist/bot.js';
import { explainHint, createHintVoice } from '../dist/hint.js';

const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const position = pieces => ({ pieces, turn: 0, ply: 0, winner: null });

test('strong recommendation is legal, explained, and does not modify the game', () => {
  const config = clone(DEFAULT_CONFIG), state = createGame(config), original = JSON.stringify({ state, config });
  const result = chooseBotAction(state, config, { depth: 4, seed: 17001 });
  const hint = explainHint(state, config, result.action);
  assert.doesNotMatch(JSON.stringify(hint), /→|\(-?\d+, -?\d+\)|стойкость \d/);
  assert.ok(hint.reasons.length);
  assert.equal(move(state, config, result.action.id, result.action.to).state.ply, 1);
  assert.equal(JSON.stringify({ state, config }), original);
});

test('explanation reports a verified immediate win and enemy loss', () => {
  const config = clone(DEFAULT_CONFIG);
  config.victoryCondition = 'all-units';
  config.stats.shield.damage = 10;
  const state = position([piece('s', 'shield', 0, 0, 0), piece('e', 'defenseLamp', 1, 2, 0)]);
  const hint = explainHint(state, config, { id: 's', to: { q: 1, r: 0 } });
  assert.equal(hint.reasons[0], 'Убираем знамя противника и выигрываем бой.');
});

test('explanation discloses allied casualties instead of claiming safety', () => {
  const config = clone(DEFAULT_CONFIG);
  config.victoryCondition = 'all-units';
  config.stats.shield.damage = 10;
  config.stats.archer.damage = 10;
  const state = position([piece('s', 'shield', 0, 0, 0), piece('e', 'archer', 1, 2, 0)]);
  const hint = explainHint(state, config, { id: 's', to: { q: 1, r: 0 } });
  assert.deepEqual(hint.reasons, ['После этого хода проиграют обе стороны.']);
  assert.equal(hint.suppressArrow, true);
});

test('quiet support move explains actual allied stat increases', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units';
  const state = position([piece('d', 'attackLamp', 0, 0, 0), piece('a', 'archer', 0, 3, 0), piece('e', 'archer', 1, 0, 5)]);
  const hint = explainHint(state, config, { id: 'd', to: { q: 1, r: 0 } });
  assert.match(hint.reasons.join(' '), /Подведём барабан к лукарю, чтобы увеличить дальность хода/);
});

test('pass and absence of legal actions have distinct explanations', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units'; config.experiments.allowPass = true;
  const state = position([piece('a', 'archer', 0, 0, 0), piece('e', 'archer', 1, 0, 5)]);
  assert.match(explainHint(state, config, { pass: true }).title, /Передаём инициативу/);
  assert.match(explainHint(state, config, null).title, /нет допустимого хода/);
});

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = app.indexOf(`function ${name}(`), lineEnd = app.indexOf('\n', start);
  return app.slice(start, app.slice(start, lineEnd).endsWith('}') ? lineEnd : app.indexOf('\n}', lineEnd) + 2);
}
function setup() {
  let request, result, error, cancelled = 0, requests = 0;
  const context = vm.createContext({ playMode: 'local', battleIntro: null, state: { pieces: [], turn: 0, ply: 0, winner: null }, config: {}, crypto: { getRandomValues(value) { value[0] = 12345; return value; } }, selected: 'chosen', hover: {}, inspection: {}, trackHint() {}, hint: null, hintVoice: createHintVoice(), hintThinkingTimer: null, clearInterval() {},
    hintRunner: { cancel() { cancelled++; }, run(input, onResult, onError) { requests++; request = input; result = onResult; error = onError; } },
    BOT_DIFFICULTIES: { hard: { depth: 4 } }, editor: false, gamePhase: 'playing', reviewingTurn: false, isBotTurn: () => false, humanCanMove: () => true,
    recentBotHistory: () => [], render() {}, explainHint: () => ({ title: 'Ход', reasons: ['Причина'] }) });
  for (const name of ['clearHint', 'hintPositionKey', 'canRequestHint', 'requestHint']) vm.runInContext(declaration(name), context);
  return { context, get request() { return request; }, get requests() { return requests; }, get cancelled() { return cancelled; }, finish(value) { result(value); }, fail() { error(new Error('timeout')); } };
}

test('hint uses the dedicated advisor with random choice and does not execute its result', () => {
  const fixture = setup(), original = JSON.stringify(fixture.context.state);
  fixture.context.requestHint();
  assert.equal(fixture.request.options.depth, undefined);
  assert.equal(fixture.request.options.adviceDiversity, true);
  assert.equal(fixture.request.options.advisor, true);
  assert.equal(fixture.context.hint.pending, true);
  assert.equal(fixture.context.selected, null);
  assert.equal(fixture.context.hover, null);
  assert.equal(fixture.context.inspection, null);
  fixture.finish({ action: { pass: true } });
  assert.equal(fixture.context.hint.title, 'Ход');
  assert.equal(JSON.stringify(fixture.context.state), original);
});

test('cancelled or outdated calculation cannot restore a hint', () => {
  const fixture = setup(); fixture.context.requestHint(); fixture.context.requestHint();
  assert.equal(fixture.cancelled, 1);
  fixture.finish({ action: { pass: true } });
  assert.equal(fixture.context.hint, null);
  fixture.context.requestHint(); fixture.context.state.ply++;
  fixture.finish({ action: { pass: true } });
  assert.equal(fixture.context.hint.pending, true); // render invalidates this old pending position
  assert.equal(fixture.context.hint.title, undefined);
});

for (const failure of ['calculation', 'explanation']) test(`${failure} failure can be retried with one click without changing the game`, () => {
  const fixture = setup(), original = JSON.stringify(fixture.context.state);
  fixture.context.requestHint();
  if (failure === 'calculation') fixture.fail();
  else {
    fixture.context.explainHint = () => { throw new Error('Invalid explanation'); };
    fixture.finish({ action: { pass: true } });
  }
  assert.equal(fixture.context.hint.failed, true);
  assert.equal(fixture.context.hint.title, 'Советник уснул. Попробуй ещё раз');
  fixture.context.requestHint();
  assert.equal(fixture.requests, 2);
  assert.equal(fixture.context.hint.pending, true);
  fixture.context.explainHint = () => ({ title: 'Ход', reasons: ['Причина'] });
  fixture.finish({ action: { pass: true } });
  assert.equal(fixture.context.hint.title, 'Ход');
  assert.equal(fixture.context.hint.failed, undefined);
  assert.equal(JSON.stringify(fixture.context.state), original);
});

test('first render reads recommendation state without shadowing the board message', () => {
  const stopped = new Error('Reached normal rendering');
  const context = vm.createContext({ tableRattle: null, tableKnocks: null, boardDrag: null, previousGame: null, hint: null, renderHint() {}, renderUpdateNotice() { throw stopped; } });
  vm.runInContext(declaration('render'), context);
  assert.throws(() => context.render(), error => error === stopped);
});

test('pending advice replaces left reference, animates dots and keeps the button disabled', () => {
  const nodes = new Map(); let tick, cleared = false;
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { setAttribute() {}, dataset: {}, innerHTML: '', hidden: false }); return nodes.get(selector); };
  const context = vm.createContext({ hint: { pending: true }, hintThinkingTimer: null, canRequestHint: () => true, visibleState: () => ({ turn: 0 }),
    $: node, escape: x => x, setInterval(callback) { tick = callback; return 5; }, clearInterval() { cleared = true; } });
  for (const name of ['setFooterDisabled', 'renderHint']) vm.runInContext(declaration(name), context);
  context.renderHint();
  assert.equal(node('#show-hint').disabled, true);
  assert.equal(node('#show-hint').textContent, 'Подсказать ход');
  assert.match(node('#move-hint').innerHTML, /Думовую/);
  assert.doesNotMatch(node('#move-hint').innerHTML, /<h2>/);
  tick(); assert.equal(node('#hint-thinking-dots').textContent, '..');
  tick(); assert.equal(node('#hint-thinking-dots').textContent, '...');
  tick(); assert.equal(node('#hint-thinking-dots').textContent, '.');
  context.hint = { title: 'Спасаем фигуру', reasons: ['Уходим из‑под атаки.'] }; context.renderHint();
  assert.match(node('#move-hint').innerHTML, /^<div class="hint-bubble"><p>Уходим из‑под атаки/);
  assert.doesNotMatch(node('#move-hint').innerHTML, /Думовую|<h2>Спасаем/);
  assert.equal(node('#show-hint').disabled, true); assert.equal(cleared, true);
  context.hint = { failed: true, title: 'Советник уснул. Попробуй ещё раз', reasons: [] }; context.renderHint();
  assert.equal(node('#show-hint').disabled, false);
  assert.equal(node('#show-hint').textContent, 'Подсказать ход');
  assert.match(node('#move-hint').innerHTML, /Советник уснул\. Попробуй ещё раз/);
  context.canRequestHint = () => false; context.renderHint();
  assert.equal(node('#show-hint').disabled, true);
  context.canRequestHint = () => true;
  context.hint = null; context.renderHint();
  assert.equal(node('#show-hint').disabled, false); assert.equal(node('#move-hint').hidden, true);
  assert.equal(node('#show-hint').textContent, 'Подсказать ход');
  context.canRequestHint = shownPosition => !shownPosition;
  context.renderHint();
  assert.equal(node('#show-hint').disabled, false, 'hint can start before the animation ends');
  assert.equal(node('#show-hint').dataset.visiblyDisabled, 'true', 'button keeps the look of the turn shown on the board');
});

test('sidebar clicks preserve advice; outside clicks dismiss it without consuming the click', () => {
  let removed = false, restored = false;
  const context = vm.createContext({ hint: { title: 'Совет' },
    clearHint() { context.hint = null; }, renderHint() {},
    $: () => ({ remove() { removed = true; } }),
    renderInspector() { restored = true; }, inspectionContext: () => ({}) });
  vm.runInContext(declaration('dismissHintOnClick'), context);
  context.dismissHintOnClick({ target: { closest: selector => selector.includes('.left-panel') ? {} : null } });
  assert.notEqual(context.hint, null); assert.equal(removed, false); assert.equal(restored, false);
  context.dismissHintOnClick({ target: { closest: () => null } });
  assert.equal(context.hint, null); assert.equal(removed, true); assert.equal(restored, true);
});


test('advice can start at turn transition while animations still block movement', () => {
  const fixture = setup();
  fixture.context.humanCanMove = () => false;
  fixture.context.movement = { active: true };
  fixture.context.combat = { active: true };
  fixture.context.requestHint();
  assert.equal(fixture.request.options.depth, undefined);
  fixture.context.clearHint(); fixture.context.isBotTurn = () => true;
  assert.equal(fixture.context.canRequestHint(), false);
  fixture.context.isBotTurn = () => false; fixture.context.reviewingTurn = true;
  assert.equal(fixture.context.canRequestHint(), false);
});


test('own terminal defeat is an admission, not a recommended arrow or a positive plan', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units'; config.stats.archer.damage = 10; config.stats.shield.damage = 1;
  const state = position([piece('s', 'shield', 0, 0, 0), piece('e', 'archer', 1, 2, 0)]);
  const original = JSON.stringify(state);
  const hint = explainHint(state, config, { id: 's', to: { q: 1, r: 0 } });
  assert.deepEqual(hint.reasons, ['Ход ведёт к поражению. Дальше сражаться смысла нет. Прости, я очень старался, но подвёл тебя.']);
  assert.equal(hint.suppressArrow, true);
  const context = vm.createContext({ hint: { ...hint, action: { id: 's', to: { q: 1, r: 0 } } } });
  vm.runInContext(declaration('hintTrace'), context);
  assert.equal(context.hintTrace(), '');
  assert.equal(JSON.stringify(state), original);
});

test('entering an aura names the actual provider and the actual increase', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units';
  const state = position([piece('h', 'horn', 0, 0, 0), piece('a', 'archer', 0, 3, 0), piece('e', 'archer', 1, 0, 5)]);
  const hint = explainHint(state, config, { id: 'a', to: { q: 2, r: 0 } });
  assert.match(hint.reasons.join(' '), /Переведём лукаря в ауру горна, чтобы увеличить урон/);
  assert.doesNotMatch(hint.reasons.join(' '), /дальность атаки|стойкость|дальность хода/);
});

test('a commander does not promise extra range to an armed commander', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units';
  const state = position([piece('c', 'scoutLamp', 0, 0, 0), piece('a', 'archer', 0, 3, 0), piece('c2', 'scoutLamp', 0, 3, 1), piece('e', 'archer', 1, 0, 5)]);
  const hint = explainHint(state, config, { id: 'c', to: { q: 1, r: 0 } });
  assert.match(hint.reasons.join(' '), /Подведём командира к лукарю, чтобы увеличить дальность атаки/);
  assert.doesNotMatch(hint.reasons.join(' '), /к командиру/);
});


test('wording excludes the last template even when the pieces change', () => {
  const voice = createHintVoice(() => 0), config = clone(DEFAULT_CONFIG);
  config.victoryCondition = 'all-units';
  const seen = [];
  for (let i = 0; i < 9; i++) {
    const state = position([piece('d', 'attackLamp', 0, 0, 0), piece('a', i % 2 ? 'shield' : 'archer', 0, 3, 0), piece('e', 'archer', 1, 0, 5)]);
    const hint = explainHint(state, config, { id: 'd', to: { q: 1, r: 0 } }, voice);
    const text = hint.reasons[0].replace(/лукар[яю]|щитоносц[ау]/g, 'UNIT');
    assert.ok(!seen.slice(-1).includes(text));
    seen.push(text);
    assert.match(hint.reasons[0], /барабан/);
  }
});

test('random extremes still avoid adjacent wording repeats and keep histories separate', () => {
  for (const random of [() => 0, () => 0.999999]) {
    const voice = createHintVoice(random), variants = ['a', 'b', 'c']; let last;
    for (let i = 0; i < 30; i++) {
      const next = voice('attack', variants);
      assert.ok(variants.includes(next)); assert.notEqual(next, last); last = next;
      voice('rescue', variants);
    }
  }
});

test('one aura move groups all recipients instead of spending a reason on each', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units';
  const state = position([piece('h', 'horn', 0, 0, 0), piece('a', 'archer', 0, 3, 0), piece('b', 'archer', 0, 3, -1), piece('s', 'shield', 0, 2, 1), piece('e', 'archer', 1, 0, 5)]);
  const original = JSON.stringify(state);
  const voice = createHintVoice(() => 0), variants = new Set();
  for (let i = 0; i < 3; i++) {
    const hint = explainHint(state, config, { id: 'h', to: { q: 1, r: 0 } }, voice);
    assert.equal(hint.reasons.length, 1);
    assert.match(hint.reasons[0], /урон у двух лукарей и щитоносца/);
    variants.add(hint.reasons[0]);
  }
  assert.equal(variants.size, 2); // Remember only the last template.
  assert.equal(JSON.stringify(state), original);
});

test('grouped aura gains keep different bonuses attached to their actual recipients', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units'; config.stats.horn.rangeBonus = 1;
  const state = position([piece('h', 'horn', 0, 0, 0), piece('a', 'archer', 0, 3, 0), piece('s', 'shield', 0, 2, 1), piece('e', 'archer', 1, 0, 5)]);
  const hint = explainHint(state, config, { id: 'h', to: { q: 1, r: 0 } });
  assert.equal(hint.reasons.length, 1);
  assert.match(hint.reasons[0], /урон у лукаря и щитоносца; дальность атаки у лукаря/);
  assert.doesNotMatch(hint.reasons[0], /дальность атаки у .*щитоносца/);
});
