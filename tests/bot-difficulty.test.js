import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty } from '../dist/bot-client.js';
import { DEFAULT_CONFIG, upgradeSelectedBalancePreset } from '../dist/rules.js';
import { clone, createGame, move, cells, validateConfig, validateState } from '../dist/engine.js';
import { classifyPosition, prepareStartPosition } from '../dist/start-position.js';
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
  const handlers = new Map();
  const nodes = { '#start-dialog': { close() {} } };
  for (const id of ['bot-difficulty', 'first-move', 'play-mode', 'human-side']) nodes['#' + id] = { addEventListener(type, callback) { handlers.set(id, callback); if (id === 'bot-difficulty') handler = callback; } };
  const context = vm.createContext({ DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty, clone, createGame, classifyPosition,
    config: clone(DEFAULT_CONFIG), state: clone(createGame(DEFAULT_CONFIG)), gamePhase: 'playing', editor: false,
    playMode: 'bot', humanTeam: 1, firstMove: 'south', history: [], log: [], lastTurn: null, previousGame: null, positionKind: 'default',
    STORAGE: 'test', BALANCE_REVISION: 5, PRESET_REVISION: 1, START_PREFS_REVISION: 1, CURRENT_GAME_VERSION: '0.1.20', gameVersion: '0.1.19',
    DEFAULT_CONFIG, upgradeSelectedBalancePreset, validateConfig, validateState, prepareStartPosition, startPreferences: null, refreshingNewGame: false, movement: null, combat: null,
    localStorage: { setItem(key, value) { saved = JSON.parse(value); } },
    $: selector => nodes[selector], resetBotContext() {}, openStartSettings() {},
    archiveRecorder: { resume() {}, start() {} }, toast(message) { throw Error(message); }, readSnapshot: clone, readLastTurn: value => value,
    recentBotHistory: () => [], botRunner: { run(value) { request = value; } },
    render() { context.save(); }, currentSnapshot: () => clone({ config: context.config, state: context.state, log: context.log, positionKind: context.positionKind, gameVersion: context.gameVersion }) });
  vm.runInContext(app.match(/^let botDifficulty = .*$/m)[0], context);
  for (const name of ['readStartPreferences', 'currentStartPreferences', 'applyStartPreferences', 'save', 'archiveGameMetadata', 'readPreviousGame', 'resetNewGameDefaults', 'openNewGame', 'returnToGame', 'startBot', 'startingTeam', 'startGame']) vm.runInContext(declaration(name), context);
  for (const id of ['bot-difficulty', 'first-move', 'play-mode', 'human-side']) vm.runInContext(app.split('\n').find(line => line.startsWith(`$('#${id}').addEventListener`)), context);
  return { context, run: code => vm.runInContext(code, context), saved: () => saved, request: () => request,
    change: value => handler({ target: { value } }), changePreference: (id, value) => handlers.get(id)({ target: { value } }) };
}

test('fresh and missing preferences default to training, while a saved explicit choice is restored', () => {
  const ui = setup();
  assert.equal(ui.run('botDifficulty'), 'training');
  const restore = app.match(/^    botDifficulty = readBotDifficulty\(saved.botDifficulty\);$/m)[0];
  for (const [stored, expected] of [[undefined, 'training'], [null, 'training'], ['unknown', 'training'], ['constructor', 'training'], [['hard'], 'training'], ['training', 'training'], ['easy', 'easy'], ['hard', 'hard']]) {
    ui.context.saved = { botDifficulty: stored }; ui.run(restore);
    assert.equal(ui.run('botDifficulty'), expected);
    ui.run('save()'); assert.equal(ui.saved().botDifficulty, expected);
  }
});

test('the setup selector controls Worker depth and archive metadata; changes are locked after start', () => {
  const ui = setup(); ui.context.gamePhase = 'setup';
  for (const [level, depth] of [['training', 2], ['easy', 2], ['hard', 4]]) {
    ui.change(level); ui.run('startBot()');
    assert.equal(ui.request().options.depth, depth);
    assert.equal(ui.request().options.forgiving === true, level === 'training');
    assert.equal(ui.run('archiveGameMetadata().botDepth'), depth);
    assert.equal(ui.saved().botDifficulty, level);
  }
  ui.context.gamePhase = 'playing'; ui.change('easy');
  assert.equal(ui.run('botDifficulty'), 'hard');
  ui.context.playMode = 'local'; assert.equal(ui.run('archiveGameMetadata().botDepth'), undefined);
});

test('new-game preparation retains the previous choices and returning restores the saved game, including after serialization', async () => {
  const ui = setup(); ui.run("botDifficulty = 'hard'");
  ui.context.state.ply = 12; const original = clone(ui.context.state);
  await ui.run('openNewGame()');
  assert.equal(ui.run('botDifficulty'), 'hard'); assert.equal(ui.context.gamePhase, 'setup');
  assert.equal(ui.context.firstMove, 'south'); assert.equal(ui.saved().previousGame.firstMove, 'south');
  assert.equal(ui.saved().previousGame.botDifficulty, 'hard');
  ui.context.previousGame = ui.run('readPreviousGame(JSON.parse(JSON.stringify(previousGame)))');
  ui.run('returnToGame()');
  assert.equal(ui.run('botDifficulty'), 'hard'); assert.equal(ui.context.gamePhase, 'playing');
  assert.equal(ui.context.firstMove, 'south');
  assert.deepEqual(clone(ui.context.state), original); assert.equal(ui.saved().botDifficulty, 'hard');
});

test('all start selections survive cancel, serialization and the next new game without changing the active game', async () => {
  const ui = setup(); ui.run("botDifficulty = 'hard'");
  const original = clone(ui.context.state);
  await ui.run('openNewGame()');
  ui.changePreference('first-move', 'north'); ui.changePreference('human-side', '0');
  ui.changePreference('play-mode', 'local'); ui.change('training');
  assert.deepEqual(ui.saved().startPreferences, { firstMove: 'north', playMode: 'local', humanTeam: 0, botDifficulty: 'training', positionKind: 'default', customSetup: null });
  ui.run('returnToGame()');
  assert.equal(ui.run('botDifficulty'), 'hard'); assert.equal(ui.context.playMode, 'bot');
  assert.equal(ui.context.humanTeam, 1); assert.equal(ui.context.firstMove, 'south');
  assert.deepEqual(clone(ui.context.state), original);
  ui.context.startPreferences = ui.saved().startPreferences;
  await ui.run('openNewGame()');
  assert.equal(ui.run('botDifficulty'), 'training'); assert.equal(ui.context.playMode, 'local');
  assert.equal(ui.context.humanTeam, 0); assert.equal(ui.context.firstMove, 'north');
});

test('custom setup remembers the original formation and rules, never the later battle position', async () => {
  const ui = setup(); ui.context.gamePhase = 'setup'; ui.context.positionKind = 'custom';
  ui.context.config.stats.shield.damage = 4;
  const occupied = new Set(ui.context.state.pieces.map(p => `${p.q},${p.r}`));
  Object.assign(ui.context.state.pieces[0], cells(ui.context.config).find(p => !occupied.has(`${p.q},${p.r}`)));
  const custom = clone({ config: ui.context.config, state: ui.context.state });
  ui.run('startGame()');
  ui.context.state.ply = 12; ui.context.state.pieces.pop(); ui.run('save()');
  assert.deepEqual(ui.saved().startPreferences.customSetup, custom);
  const battle = clone(ui.context.state);
  await ui.run('openNewGame()');
  assert.equal(ui.context.positionKind, 'custom');
  assert.deepEqual(clone(ui.context.config), custom.config); assert.deepEqual(clone(ui.context.state), custom.state);
  ui.run('applyStartPreferences()'); // The same path runs after a new-release refresh.
  assert.deepEqual(clone(ui.context.state), custom.state);
  ui.run('returnToGame()'); assert.deepEqual(clone(ui.context.state), battle);
});

test('invalid remembered values fall back safely without discarding other valid selections', () => {
  const ui = setup();
  const defaults = ui.run("readStartPreferences({ playMode: 'invalid', humanTeam: 4, firstMove: 'none', botDifficulty: 'constructor' })");
  assert.deepEqual(clone(defaults), { playMode: 'bot', humanTeam: 1, firstMove: 'random', botDifficulty: 'training', positionKind: 'default', customSetup: null });
  const custom = ui.run("readStartPreferences({ playMode: 'local', humanTeam: 0, firstMove: 'south', botDifficulty: 'hard', positionKind: 'custom', customSetup: {config: {}, state: {pieces: [{id: 'bad'}]}} })");
  assert.deepEqual(clone(custom), { playMode: 'local', humanTeam: 0, firstMove: 'south', botDifficulty: 'hard', positionKind: 'default', customSetup: null });
});

test('all three names appear in setup and the active game caption', () => {
  const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.match(html, /<option value="training" selected>Неопытный<\/option>/);
  const caption = app.split('\n').find(line => line.includes("$('#mode-caption').textContent ="));
  for (const [value, label] of [['training', 'Неопытный'], ['easy', 'Дерётся'], ['hard', 'Больно дерётся']]) {
    assert.equal(BOT_DIFFICULTIES[value].label, label);
    assert.match(html, new RegExp(`<option value="${value}"[^>]*>${label}</option>`));
    const node = {};
    vm.runInNewContext(caption, { $: () => node, playMode: 'bot', botDifficulty: value, BOT_DIFFICULTIES });
    assert.equal(node.textContent, `Бот · ${label}`);
  }
});

test('returning to a training game retains its policy after serialization', async () => {
  const ui = setup(); ui.run("botDifficulty = 'training'");
  const original = clone(ui.context.state);
  await ui.run('openNewGame()');
  assert.equal(ui.saved().previousGame.botDifficulty, 'training');
  ui.context.previousGame = ui.run('readPreviousGame(JSON.parse(JSON.stringify(previousGame)))');
  ui.run('returnToGame(); startBot()');
  assert.equal(ui.run('botDifficulty'), 'training');
  assert.equal(ui.request().options.forgiving, true);
  assert.deepEqual(clone(ui.context.state), original);
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
