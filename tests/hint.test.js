import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, createGame, move } from '../dist/engine.js';
import { chooseBotAction } from '../dist/bot.js';
import { explainHint } from '../dist/hint.js';

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
  assert.match(hint.reasons.join(' '), /условие победы/);
  assert.match(hint.reasons.join(' '), /условие победы/);
});

test('explanation discloses allied casualties instead of claiming safety', () => {
  const config = clone(DEFAULT_CONFIG);
  config.victoryCondition = 'all-units';
  config.stats.shield.damage = 10;
  config.stats.archer.damage = 10;
  const state = position([piece('s', 'shield', 0, 0, 0), piece('e', 'archer', 1, 2, 0)]);
  const hint = explainHint(state, config, { id: 's', to: { q: 1, r: 0 } });
  assert.match(hint.reasons.join(' '), /потеря союзных фигур/);
  assert.match(hint.reasons.join(' '), /Победителя не будет/);
});

test('quiet support move explains actual allied stat increases', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units';
  const state = position([piece('d', 'attackLamp', 0, 0, 0), piece('a', 'archer', 0, 3, 0), piece('e', 'archer', 1, 0, 5)]);
  const hint = explainHint(state, config, { id: 'd', to: { q: 1, r: 0 } });
  assert.match(hint.reasons.join(' '), /союзники смогут быстрее занять нужные клетки/);
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
  let request, result, error, cancelled = 0;
  const context = vm.createContext({ state: { pieces: [], turn: 0, ply: 0, winner: null }, config: {}, hint: null, hintThinkingTimer: null, clearInterval() {},
    hintRunner: { cancel() { cancelled++; }, run(input, onResult, onError) { request = input; result = onResult; error = onError; } },
    BOT_DIFFICULTIES: { hard: { depth: 4 } }, editor: false, humanCanMove: () => true,
    recentBotHistory: () => [], render() {}, explainHint: () => ({ title: 'Ход', reasons: ['Причина'] }) });
  for (const name of ['clearHint', 'hintPositionKey', 'canRequestHint', 'requestHint']) vm.runInContext(declaration(name), context);
  return { context, get request() { return request; }, get cancelled() { return cancelled; }, finish(value) { result(value); }, fail() { error(new Error('timeout')); } };
}

test('hint always uses hard search and does not execute its result', () => {
  const fixture = setup(), original = JSON.stringify(fixture.context.state);
  fixture.context.requestHint();
  assert.equal(fixture.request.options.depth, 4);
  assert.equal(fixture.context.hint.pending, true);
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

test('failed calculation can be dismissed and retried', () => {
  const fixture = setup(); fixture.context.requestHint(); fixture.fail();
  assert.match(fixture.context.hint.title, /Не удалось/);
  fixture.context.requestHint(); assert.equal(fixture.context.hint, null);
  fixture.context.requestHint(); assert.equal(fixture.context.hint.pending, true);
});

test('first render reads recommendation state without shadowing the board message', () => {
  const stopped = new Error('Reached normal rendering');
  const context = vm.createContext({ hint: null, renderHint() {}, renderUpdateNotice() { throw stopped; } });
  vm.runInContext(declaration('render'), context);
  assert.throws(() => context.render(), error => error === stopped);
});

test('pending advice replaces left reference, animates dots and keeps the button disabled', () => {
  const nodes = new Map(); let tick, cleared = false;
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, { setAttribute() {}, innerHTML: '', hidden: false }); return nodes.get(selector); };
  const context = vm.createContext({ hint: { pending: true }, hintThinkingTimer: null, canRequestHint: () => true,
    $: node, escape: x => x, setInterval(callback) { tick = callback; return 5; }, clearInterval() { cleared = true; } });
  vm.runInContext(declaration('renderHint'), context); context.renderHint();
  assert.equal(node('#show-hint').disabled, true);
  assert.equal(node('#show-hint').textContent, 'Попросить совет');
  assert.match(node('#move-hint').innerHTML, /Думовую/);
  tick(); assert.equal(node('#hint-thinking-dots').textContent, '..');
  tick(); assert.equal(node('#hint-thinking-dots').textContent, '...');
  tick(); assert.equal(node('#hint-thinking-dots').textContent, '.');
  context.hint = { title: 'Спасаем фигуру', reasons: ['Уходим из-под атаки.'] }; context.renderHint();
  assert.equal(node('#show-hint').disabled, true); assert.equal(cleared, true);
  context.hint = null; context.renderHint();
  assert.equal(node('#show-hint').disabled, false); assert.equal(node('#move-hint').hidden, true);
});

test('any click dismisses advice without replacing the board or consuming the click', () => {
  let removed = false, restored = false;
  const context = vm.createContext({ hint: { title: 'Совет' },
    clearHint() { context.hint = null; }, renderHint() {},
    $: () => ({ remove() { removed = true; } }),
    renderInspector() { restored = true; }, inspectionContext: () => ({}) });
  vm.runInContext(declaration('dismissHintOnClick'), context);
  context.dismissHintOnClick({ target: { closest: () => null } });
  assert.equal(context.hint, null); assert.equal(removed, true); assert.equal(restored, true);
});
