import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty } from '../dist/bot-client.js';
import { DEFAULT_CONFIG, upgradeSelectedBalancePreset } from '../dist/rules.js';
import { clone, createGame, move } from '../dist/engine.js';
import { classifyPosition } from '../dist/start-position.js';
import { chooseBotAction } from '../dist/bot.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = app.indexOf(`function ${name}(`), lineEnd = app.indexOf('\n', start);
  assert.ok(start >= 0);
  const prefix = app.slice(start - 6, start) === 'async ' ? start - 6 : start;
  return app.slice(prefix, app.slice(start, lineEnd).endsWith('}') ? lineEnd : app.indexOf('\n}', lineEnd) + 2);
}
function setup() {
  let saved, request, handler;
  const nodes = { '#start-dialog': { close() {} }, '#bot-difficulty': { addEventListener(type, callback) { handler = callback; } } };
  const context = vm.createContext({ DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty, clone, createGame, classifyPosition,
    config: clone(DEFAULT_CONFIG), state: clone(createGame(DEFAULT_CONFIG)), gamePhase: 'playing', editor: false,
    playMode: 'bot', humanTeam: 1, firstMove: 'south', history: [], log: [], lastTurn: null, previousGame: null, positionKind: 'default',
    STORAGE: 'test', BALANCE_REVISION: 5, PRESET_REVISION: 1, START_PREFS_REVISION: 1, CURRENT_GAME_VERSION: '0.1.20', gameVersion: '0.1.19',
    DEFAULT_CONFIG, upgradeSelectedBalancePreset, validateConfig: clone, refreshingNewGame: false, movement: null, combat: null,
    localStorage: { setItem(key, value) { saved = JSON.parse(value); } },
    $: selector => nodes[selector], resetBotContext() {}, openStartSettings() {},
    archiveRecorder: { resume() {} }, readSnapshot: clone, readLastTurn: value => value,
    recentBotHistory: () => [], botRunner: { run(value) { request = value; } },
    render() { context.save(); }, currentSnapshot: () => clone({ config: context.config, state: context.state, log: context.log, positionKind: context.positionKind, gameVersion: context.gameVersion }) });
  vm.runInContext(app.match(/^let botDifficulty = .*$/m)[0], context);
  for (const name of ['save', 'archiveGameMetadata', 'readPreviousGame', 'resetNewGameDefaults', 'openNewGame', 'returnToGame', 'startBot']) vm.runInContext(declaration(name), context);
  vm.runInContext(app.split('\n').find(line => line.startsWith("$('#bot-difficulty').addEventListener")), context);
  return { context, run: code => vm.runInContext(code, context), saved: () => saved, request: () => request,
    change: value => handler({ target: { value } }) };
}

test('fresh and legacy preferences default to easy, while a saved explicit choice is restored', () => {
  const ui = setup();
  assert.equal(ui.run('botDifficulty'), 'easy');
  const restore = app.match(/^    botDifficulty = readBotDifficulty\(saved.botDifficulty\);$/m)[0];
  for (const [stored, expected] of [[undefined, 'easy'], [null, 'easy'], ['unknown', 'easy'], ['easy', 'easy'], ['hard', 'hard']]) {
    ui.context.saved = { botDifficulty: stored }; ui.run(restore);
    assert.equal(ui.run('botDifficulty'), expected);
    ui.run('save()'); assert.equal(ui.saved().botDifficulty, expected);
  }
});

test('the setup selector controls Worker depth and archive metadata; changes are locked after start', () => {
  const ui = setup(); ui.context.gamePhase = 'setup';
  for (const [level, depth] of [['easy', 2], ['hard', 4]]) {
    ui.change(level); ui.run('startBot()');
    assert.equal(ui.request().options.depth, depth);
    assert.equal(ui.run('archiveGameMetadata().botDepth'), depth);
    assert.equal(ui.saved().botDifficulty, level);
  }
  ui.context.gamePhase = 'playing'; ui.change('easy');
  assert.equal(ui.run('botDifficulty'), 'hard');
  ui.context.playMode = 'local'; assert.equal(ui.run('archiveGameMetadata().botDepth'), undefined);
});

test('new-game preparation defaults to easy and returning restores the saved game difficulty, including after serialization', async () => {
  const ui = setup(); ui.run("botDifficulty = 'hard'");
  ui.context.state.ply = 12; const original = clone(ui.context.state);
  await ui.run('openNewGame()');
  assert.equal(ui.run('botDifficulty'), 'easy'); assert.equal(ui.context.gamePhase, 'setup');
  assert.equal(ui.context.firstMove, 'random'); assert.equal(ui.saved().previousGame.firstMove, 'south');
  assert.equal(ui.saved().previousGame.botDifficulty, 'hard');
  ui.context.previousGame = ui.run('readPreviousGame(JSON.parse(JSON.stringify(previousGame)))');
  ui.run('returnToGame()');
  assert.equal(ui.run('botDifficulty'), 'hard'); assert.equal(ui.context.gamePhase, 'playing');
  assert.equal(ui.context.firstMove, 'south');
  assert.deepEqual(clone(ui.context.state), original); assert.equal(ui.saved().botDifficulty, 'hard');
});

test('new game discards even older or custom characteristics and returning restores the entire previous game', async () => {
  const ui = setup();
  ui.context.config.size = 4; ui.context.config.deploymentOffset = 0; ui.context.config.stats.shield.damage = 4;
  ui.context.config.stats.archer.damage = 2; ui.context.config.army.scoutLamps = 0;
  ui.context.state = createGame(ui.context.config); ui.context.state.ply = 7;
  ui.context.history = [{ config: clone(ui.context.config), state: clone(ui.context.state) }];
  ui.context.log = [{ text: 'Старая партия', detail: '' }];
  const before = ui.context.currentSnapshot(), oldHistory = clone(ui.context.history);
  await ui.run('openNewGame()');
  assert.deepEqual(clone(ui.context.config), DEFAULT_CONFIG);
  assert.equal(ui.saved().gameVersion, '0.1.20');
  assert.equal(ui.context.state.ply, 0);
  assert.equal(ui.context.state.pieces.length, 26);
  assert.equal(ui.context.state.pieces.filter(p => p.type === 'scoutLamp').length, 2);
  assert.deepEqual(clone(ui.saved().previousGame.snapshot), before);
  ui.context.previousGame = ui.run('readPreviousGame(JSON.parse(JSON.stringify(previousGame)))');
  ui.run('returnToGame()');
  assert.deepEqual(ui.context.currentSnapshot(), before);
  assert.deepEqual(clone(ui.context.history), oldHistory);
});

test('new game saves before refresh, locks duplicate requests and leaves setup usable when refresh fails', async () => {
  const ui = setup(); let finishRefresh, called = 0;
  ui.context.$ = selector => selector === '#bot-worker-source' ? {} : { close() {} };
  ui.context.location = { protocol: 'https:' }; ui.context.navigator = { onLine: true };
  ui.context.toast = () => {};
  ui.context.refreshNewGamePage = () => {
    called++; assert.ok(ui.saved().previousGame); assert.equal(ui.saved().gamePhase, 'setup');
    return new Promise(resolve => { finishRefresh = resolve; });
  };
  const pending = ui.run('openNewGame()');
  assert.equal(ui.context.refreshingNewGame, true);
  await ui.run('openNewGame()'); assert.equal(called, 1);
  finishRefresh(false); await pending;
  assert.equal(ui.context.refreshingNewGame, false);
  assert.equal(ui.context.gamePhase, 'setup');
  assert.deepEqual(clone(ui.context.config), DEFAULT_CONFIG);
  ui.run('returnToGame()'); assert.equal(ui.context.gamePhase, 'playing');
});

test('blocked game storage prevents navigation without discarding the in-memory backup', async () => {
  const ui = setup(); let called = false;
  ui.context.$ = () => ({ close() {} });
  ui.context.location = { protocol: 'https:' }; ui.context.ready = true; ui.context.toast = () => {};
  ui.context.localStorage.setItem = () => { throw new Error('storage blocked'); };
  ui.context.refreshNewGamePage = () => { called = true; };
  await ui.run('openNewGame()');
  assert.equal(called, false); assert.ok(ui.context.previousGame);
  assert.equal(ui.context.refreshingNewGame, false);
  ui.run('returnToGame()'); assert.equal(ui.context.gamePhase, 'playing');
});

test('easy performs a shallower legal search; hard retains the former search settings', () => {
  const config = clone(DEFAULT_CONFIG), state = createGame(config);
  const easy = chooseBotAction(state, config, { ...BOT_DIFFICULTIES.easy, seed: 39 });
  const hard = chooseBotAction(state, config, { ...BOT_DIFFICULTIES.hard, seed: 39 });
  assert.equal(easy.stats.maxDepth, 2); assert.equal(hard.stats.maxDepth, 4);
  assert.ok(easy.stats.nodes < hard.stats.nodes);
  for (const result of [easy, hard]) assert.equal(move(state, config, result.action.id, result.action.to).state.ply, 1);
  assert.deepEqual(hard.action, chooseBotAction(state, config, { depth: 4, seed: 39 }).action);
});

test('local13 reset defaults restores all 26 standard pieces from a custom setup', () => {
  const ui=setup();ui.context.config.army.horns=0;ui.context.config.army.shields=1;
  ui.context.state=createGame(ui.context.config);
  ui.run('resetNewGameDefaults()');
  assert.deepEqual(clone(ui.context.config),DEFAULT_CONFIG);
  assert.deepEqual(clone(ui.context.state),clone(createGame(DEFAULT_CONFIG)));
  assert.equal(ui.context.state.pieces.length,26);
});
