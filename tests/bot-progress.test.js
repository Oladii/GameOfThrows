import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBotAction } from './fixtures/legacy-bot.js';
import { clone, move, reachable } from '../dist/engine.js';

// Preserve earlier neutral-policy finish regressions; local13 formation is verified separately.
const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const legal = (state, config) => state.pieces.filter(p => p.team === state.turn)
  .flatMap(p => reachable(p, state, config).map(to => ({ id: p.id, to: { q: to.q, r: to.r } })));

test('historical neutral policy: a quiet position from the stalled production game develops real combat', () => {
  const f = fixture('bot-quiet-opening'), configBefore = JSON.stringify(f.config);
  let state = clone(f.initial), history = [clone(state)];
  const last = new Map();
  const apply = action => {
    const p = state.pieces.find(p => p.id === action.id);
    last.set(p.id, { from: { q: p.q, r: p.r }, to: action.to });
    const result = move(state, f.config, action.id, action.to);
    state = result.state; history.push(clone(state)); return result;
  };
  for (const action of f.actions) assert.equal(apply(action).deaths.length, 0);
  assert.equal(state.pieces.length, 28);
  let casualties = 0;
  for (let i = 0; i < 24 && state.winner === null && !casualties; i++) {
    const result = chooseBotAction(state, f.config, { depth: 2, seed: f.seed, previousStates: history.slice(-41), lastActions: [...last] });
    assert.ok(result.action); casualties += apply(result.action).deaths.length;
  }
  assert.ok(casualties > 0, 'the real engine must resolve combat, rather than only increase a heuristic');
  assert.equal(JSON.stringify(f.config), configBefore);
});

test('historical neutral policy: a reported three-ply finish covers every legal reply with an actual engine win', () => {
  const { config, state, seed } = fixture('bot-forced-finish'), before = JSON.stringify({ config, state });
  const result = chooseBotAction(state, config, { depth: 2, seed });
  assert.equal(result.stats.reason, 'forced-win-three-ply');
  assert.equal(result.stats.finishingComplete, true);
  const first = move(state, config, result.action.id, result.action.to).state;
  assert.equal(first.winner, null);
  const replies = legal(first, config), certificate = result.stats.forcedWinReplies;
  assert.equal(certificate.length, replies.length);
  for (const reply of replies) {
    const branch = certificate.find(c => c.reply.id === reply.id && c.reply.to.q === reply.to.q && c.reply.to.r === reply.to.r);
    assert.ok(branch, 'every opponent move must be covered');
    const response = move(first, config, reply.id, reply.to).state;
    if (response.winner === state.turn) assert.equal(branch.win, null);
    else {
      assert.ok(branch.win);
      assert.equal(move(response, config, branch.win.id, branch.win.to).state.winner, state.turn);
    }
  }
  assert.deepEqual(Object.keys(result.action).sort(), ['id', 'to']);
  assert.equal(JSON.stringify({ config, state }), before);
});

test('historical neutral policy: easy planning breaks the captured archer-only plateau in a small ending', () => {
  const f = fixture('bot-archer-ending');
  let state = clone(f.state), history = [clone(state)], casualties = 0;
  const last = new Map();
  assert.equal(state.pieces.filter(p => p.type === 'shield').length, 0);
  for (let i = 0; i < 32 && state.winner === null && !casualties; i++) {
    const result = chooseBotAction(state, f.config, { depth: 2, seed: f.seed, previousStates: history.slice(-41), lastActions: [...last] });
    assert.equal(result.stats.depth, 2);
    assert.equal(result.stats.planningDepth, 3);
    const p = state.pieces.find(p => p.id === result.action.id);
    last.set(p.id, { from: { q: p.q, r: p.r }, to: result.action.to });
    const next = move(state, f.config, result.action.id, result.action.to);
    casualties += next.deaths.length; state = next.state; history.push(clone(state));
  }
  assert.ok(casualties > 0, 'the plateau must end in engine-resolved combat');
});

test('historical neutral policy: identical lone veterans choose an actual mutual exchange when no unilateral win exists', () => {
  const { config } = fixture('bot-forced-finish');
  let state = { turn: 0, ply: 0, winner: null, pieces: [
    { id: 'v0', type: 'shield', team: 0, q: -4, r: 0, reachedFarEdge: true },
    { id: 'v1', type: 'shield', team: 1, q: 4, r: 0, reachedFarEdge: true }
  ] };
  for (let i = 0; i < 12 && state.winner === null; i++) {
    const result = chooseBotAction(state, config, { depth: 2 });
    assert.equal(result.stats.reason, 'symmetric-veteran-draw');
    state = move(state, config, result.action.id, result.action.to).state;
  }
  assert.equal(state.winner, 'draw');
  assert.equal(state.pieces.length, 0);

  const strongerDefense = clone(config); strongerDefense.stats.shield.fortitude = 6;
  const separate = { turn: 0, ply: 0, winner: null, pieces: [
    { id: 'v0', type: 'shield', team: 0, q: -1, r: 0, reachedFarEdge: true },
    { id: 'v1', type: 'shield', team: 1, q: 1, r: 0, reachedFarEdge: true }
  ] };
  const result = chooseBotAction(separate, strongerDefense, { depth: 2 });
  assert.notEqual(result.stats.reason, 'symmetric-veteran-draw');
  assert.equal(move(separate, strongerDefense, result.action.id, result.action.to).state.winner, null);
});
