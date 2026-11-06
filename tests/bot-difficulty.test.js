import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty } from '../dist/bot-client.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, createGame, move } from '../dist/engine.js';
import { classifyPosition } from '../dist/start-position.js';
import { chooseBotAction } from '../dist/bot.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = app.indexOf(`function ${name}(`), lineEnd = app.indexOf('\n', start);
  assert.ok(start >= 0);
  return app.slice(start, app.slice(start, lineEnd).endsWith('}') ? lineEnd : app.indexOf('\n}', lineEnd) + 2);
}
function setup() {
  let saved, request, handler;
  const nodes = { '#start-dialog': { close() {} }, '#bot-difficulty': { addEventListener(type, callback) { handler = callback; } } };
  const context = vm.createContext({ DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty, clone, createGame, classifyPosition,
    config: clone(DEFAULT_CONFIG), state: clone(createGame(DEFAULT_CONFIG)), gamePhase: 'playing', editor: false,
    playMode: 'bot', humanTeam: 1, firstMove: 'south', history: [], log: [], lastTurn: null, previousGame: null, positionKind: 'default',
    STORAGE: 'test', BALANCE_REVISION: 5, PRESET_REVISION: 1, START_PREFS_REVISION: 1,
    localStorage: { setItem(key, value) { saved = JSON.parse(value); } },
    $: selector => nodes[selector], resetBotContext() {}, openStartSettings() {},
    archiveRecorder: { resume() {} }, readSnapshot: clone, readLastTurn: value => value,
    recentBotHistory: () => [], botRunner: { run(value) { request = value; } },
    render() { context.save(); }, currentSnapshot: () => clone({ config: context.config, state: context.state, log: context.log, positionKind: context.positionKind }) });
  vm.runInContext(app.match(/^let botDifficulty = .*$/m)[0], context);
  for (const name of ['save', 'archiveGameMetadata', 'readPreviousGame', 'openNewGame', 'returnToGame', 'startBot']) vm.runInContext(declaration(name), context);
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

test('new-game preparation defaults to easy and returning restores the saved game difficulty, including after serialization', () => {
  const ui = setup(); ui.run("botDifficulty = 'hard'");
  ui.context.state.ply = 12; const original = clone(ui.context.state);
  ui.run('openNewGame()');
  assert.equal(ui.run('botDifficulty'), 'easy'); assert.equal(ui.context.gamePhase, 'setup');
  assert.equal(ui.saved().previousGame.botDifficulty, 'hard');
  ui.context.previousGame = ui.run('readPreviousGame(JSON.parse(JSON.stringify(previousGame)))');
  ui.run('returnToGame()');
  assert.equal(ui.run('botDifficulty'), 'hard'); assert.equal(ui.context.gamePhase, 'playing');
  assert.deepEqual(clone(ui.context.state), original); assert.equal(ui.saved().botDifficulty, 'hard');
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
