import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, move, pass, reachable, validateState } from '../dist/engine.js';
import { BOT_DIFFICULTIES } from '../dist/bot-client.js';
import { DEFAULT_CONFIG, LABELS, TEAM_NAMES } from '../dist/rules.js';

const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');

function exerciseBot(replies, { blocked = false } = {}) {
  const config = structuredClone(DEFAULT_CONFIG);
  let state;
  if (blocked) {
    config.geometry = 'square'; config.size = 6; config.victoryCondition = 'all-units';
    config.experiments.squareDiagonals = false;
    state = validateState({ turn: 0, ply: 0, winner: null, pieces: [
      { id: 'flag', type: 'defenseLamp', team: 0, q: 0, r: 0 },
      { id: 'east', type: 'attackLamp', team: 1, q: 1, r: 0 },
      { id: 'south', type: 'attackLamp', team: 1, q: 0, r: 1 },
    ] }, config);
  } else state = createGame(config);
  const timers = [], requests = [], actions = [];
  const context = vm.createContext({
    state, config, selected: null, botFailures: 0, botTimer: null, botDifficulty: 'hard',
    ready: true, battleIntro: null, movement: null, combat: null, currentDeaths: [], reviewingTurn: false,
    history: [], log: [], BOT_DIFFICULTIES, LABELS, TEAM_NAMES,
    reachable, move, pass, $: () => null, isBotTurn: () => context.state.turn === state.turn && context.state.winner === null,
    currentSnapshot: () => ({ state: context.state, config }),
    recentBotHistory: () => [],
    readAction: value => value.pass === true ? { pass: true } : typeof value.id === 'string' && value.from && value.to ? value : null,
    checkpoint: () => {},
    positionText: () => '', deathDetail: () => '',
    recordGameAction: (type, details) => actions.push({ type, ...details }),
    presentMove: () => {},
    setTimeout: task => { timers.push(task); return timers.length; },
    botRunner: {
      active: false,
      run(request, onResult, onError, timeout) {
        requests.push({ depth: request.options.depth, timeout });
        const reply = replies.shift();
        if (reply instanceof Error) onError(reply);
        else onResult(reply);
      }
    }
  });
  vm.runInContext(app.slice(app.indexOf('function queueBot()'), app.indexOf('function point(')), context);
  assert.equal(timers.length, 0);
  context.queueBot();
  context.queueBot();
  while (timers.length) timers.shift()();
  return { state, config, context, requests, actions };
}

test('bot retries a failed calculation at lower depth and applies exactly one normal move', () => {
  const config = structuredClone(DEFAULT_CONFIG), state = createGame(config);
  const piece = state.pieces.find(piece => piece.team === state.turn && reachable(piece, state, config).length);
  const [to] = reachable(piece, state, config);
  const result = exerciseBot([new Error('Worker unavailable'), { action: { id: piece.id, to } }]);
  assert.deepEqual(result.requests, [{ depth: 4, timeout: undefined }, { depth: 1, timeout: 5000 }]);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].action.id, piece.id);
  assert.deepEqual(result.context.state, move(state, config, piece.id, to).state);
  assert.equal(result.context.botFailures, 0);
});

test('bot makes a legal fallback move after repeated worker failure or malformed output', () => {
  const result = exerciseBot([{ action: { id: 'missing', to: { q: 0, r: 0 } } }, new Error('Worker unavailable')]);
  assert.equal(result.requests.length, 2);
  assert.equal(result.actions.length, 1);
  const { type, action } = result.actions[0];
  assert.equal(type, 'move');
  assert.deepEqual(result.context.state, move(result.state, result.config, action.id, action.to).state);
});

test('a blocked bot loses without requesting a turn or automatically passing', () => {
  const result = exerciseBot([null, null], { blocked: true });
  assert.deepEqual(result.requests, []);
  assert.deepEqual(result.actions, []);
  assert.equal(result.context.state.winner, 1 - result.state.turn);
  assert.equal(result.context.state.ply, result.state.ply);
  assert.throws(() => pass(result.state, result.config), /выключен/);
});
