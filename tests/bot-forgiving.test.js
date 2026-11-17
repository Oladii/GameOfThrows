import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { createGame, clone, move, reachable, pass, analyze } from '../dist/engine.js';
import { chooseBotAction, botPositionKey } from '../dist/bot.js';
import { BOT_DIFFICULTIES } from '../dist/bot-client.js';
import { oneReplyRestraint } from '../dist/formation-strategy.mjs';

const piece = (id, type, team, q, r) => ({ id, type, team, q, r });
const opportunity = (team, balance = 'equal') => {
  const state = { pieces: [piece('s', 'shield', 0, 0, 0), piece('f', 'defenseLamp', 0, 0, -5),
    piece('a', 'archer', 1, 2, 0), piece('e', 'shield', 1, -3, 3), piece('ef', 'defenseLamp', 1, 0, 5)], turn: 0, ply: 8, winner: null };
  if (balance !== 'behind') state.pieces.push(piece('own', balance === 'ahead' ? 'shield' : 'archer', 0, 0, -4));
  return team === 0 ? state : { ...state, turn: 1, pieces: state.pieces.map(p => ({ ...p, team: 1 - p.team, q: -p.q, r: -p.r })) };
};
const apply = (state, config, action) => action.pass ? pass(state, config) : move(state, config, action.id, action.to);

for (const [team, forgiveSeed, ordinarySeed] of [[0, 2, 11], [1, 1, 3]]) {
  test(`training consistently spares a free capture on side ${team} without offering any piece in reply`, () => {
    const state = opportunity(team), before = JSON.stringify({ state, config: DEFAULT_CONFIG });
    const usual = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.easy, seed: forgiveSeed });
    assert.deepEqual(apply(state, DEFAULT_CONFIG, usual.action).deaths.map(p => p.id), ['a']);
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: forgiveSeed });
    assert.equal(result.stats.forgiveness.applied, true);
    assert.ok(result.stats.forgiveness.gap >= 0 && result.stats.forgiveness.gap <= 380);
    const outcome = apply(state, DEFAULT_CONFIG, result.action);
    assert.equal(outcome.deaths.length, 0);
    assert.ok(outcome.state.pieces.some(p => p.id === 'a'));
    // Independent exhaustive native check, including moves outside the search beam.
    let replies = 0;
    for (const enemy of outcome.state.pieces.filter(p => p.team !== team)) {
      for (const to of reachable(enemy, outcome.state, DEFAULT_CONFIG)) {
        const reply = move(outcome.state, DEFAULT_CONFIG, enemy.id, to); replies++;
        assert.equal(reply.deaths.some(p => p.team === team), false);
        assert.notEqual(reply.state.winner, 1 - team);
      }
    }
    assert.ok(replies > 0);
    const normal = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.easy, seed: ordinarySeed });
    const strict = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: ordinarySeed });
    assert.deepEqual(apply(state, DEFAULT_CONFIG, normal.action).deaths.map(p => p.id), ['a']);
    assert.equal(strict.stats.forgiveness.applied, true);
    assert.equal(apply(state, DEFAULT_CONFIG, strict.action).deaths.length, 0);
    assert.equal(JSON.stringify({ state, config: DEFAULT_CONFIG }), before);
  });
}

test('training refuses an excessive concession in the full-army tactical regression', () => {
  const { state, seed } = JSON.parse(fs.readFileSync(new URL('./fixtures/bot-forgiving-defense.json', import.meta.url)));
  const normal = chooseBotAction(state, DEFAULT_CONFIG, { depth: 2, seed });
  const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed });
  assert.equal(result.stats.forgiveness.considered, true);
  assert.equal(result.stats.forgiveness.applied, false);
  assert.deepEqual(result.action, normal.action);
  assert.equal(result.stats.score, normal.stats.score);
});

test('training refuses to spare an attacker when every quiet move exposes an ally', () => {
  const config = clone(DEFAULT_CONFIG); config.stats.shield.fortitude = 6;
  const state = { pieces: [piece('s', 'shield', 0, 0, 0), piece('f', 'defenseLamp', 0, 0, -1),
    piece('a', 'archer', 0, 0, 1), { ...piece('ea', 'archer', 1, 2, 0), archerReachedFarEdge: true },
    piece('es', 'shield', 1, -3, 3), piece('ef', 'defenseLamp', 1, 0, 5)], turn: 0, ply: 8, winner: null };
  let quiet = 0;
  for (const own of state.pieces.filter(p => p.team === 0)) for (const to of reachable(own, state, config)) {
    const next = move(state, config, own.id, to);
    if (next.deaths.length || next.state.winner !== null) continue;
    quiet++;
    // Every non-capture has a real losing reply, even outside the bot's beam.
    assert.ok(next.state.pieces.filter(p => p.team === 1).some(enemy => reachable(enemy, next.state, config)
      .some(target => move(next.state, config, enemy.id, target).deaths.some(p => p.team === 0))));
  }
  assert.ok(quiet > 0);
  const result = chooseBotAction(state, config, { ...BOT_DIFFICULTIES.training, seed: 1 });
  assert.equal(result.stats.forgiveness.considered, true);
  assert.equal(result.stats.forgiveness.applied, false);
  assert.deepEqual(apply(state, config, result.action).deaths.map(p => p.id), ['ea']);
});

test('training takes immediate wins and handles blocked, pass and finished positions normally', () => {
  const config = clone(DEFAULT_CONFIG); config.victoryCondition = 'all-units'; config.stats.shield.damage = 10;
  const win = { pieces: [piece('s', 'shield', 0, 0, 0), piece('e', 'defenseLamp', 1, 2, 0)], turn: 0, ply: 0, winner: null };
  for (const seed of [1, 2, 3, 4, 5]) {
    const result = chooseBotAction(win, config, { ...BOT_DIFFICULTIES.training, seed });
    assert.equal(apply(win, config, result.action).state.winner, 0);
    assert.equal(result.stats.forgiveness.applied, false);
  }
  config.geometry = 'square'; config.size = 6; config.experiments.squareDiagonals = false;
  config.stats.defenseLamp.move = 1;
  const blocked = { pieces: [piece('b', 'defenseLamp', 0, 0, 0), piece('e1', 'shield', 1, 1, 0), piece('e2', 'shield', 1, 0, 1)], turn: 0, ply: 0, winner: null };
  assert.equal(chooseBotAction(blocked, config, BOT_DIFFICULTIES.training).action, null);
  config.experiments.allowPass = true;
  assert.deepEqual(chooseBotAction(blocked, config, BOT_DIFFICULTIES.training).action, { pass: true });
  assert.equal(chooseBotAction({ ...blocked, winner: 1 }, config, BOT_DIFFICULTIES.training).action, null);
});

test('training eases pressure even without a capture, while keeping every piece safe for the next reply', () => {
  const state = createGame(DEFAULT_CONFIG);
  const ordinary = chooseBotAction(state, DEFAULT_CONFIG, { depth: 2, seed: 2 });
  const training = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 2 });
  assert.equal(training.stats.forgiveness.applied, true);
  assert.deepEqual(training.stats.forgiveness.skippedCaptures, []);
  assert.ok(training.stats.forgiveness.gap <= 80);
  const attackDamage = outcome => {
    const report = analyze(outcome.state, DEFAULT_CONFIG);
    return outcome.state.pieces.filter(p => p.team !== state.turn).reduce((sum, p) => sum + report.get(p.id).incoming, 0);
  };
  const next = apply(state, DEFAULT_CONFIG, training.action), strict = apply(state, DEFAULT_CONFIG, ordinary.action);
  assert.ok(attackDamage(next) < attackDamage(strict));
  assert.equal(next.deaths.length, 0);
  for (const enemy of next.state.pieces.filter(p => p.team !== state.turn)) for (const to of reachable(enemy, next.state, DEFAULT_CONFIG)) {
    const reply = move(next.state, DEFAULT_CONFIG, enemy.id, to);
    assert.equal(reply.deaths.some(p => p.team === state.turn), false);
    assert.notEqual(reply.state.winner, 1 - state.turn);
  }
});

test('forgiving never weakens requested advice', () => {
  const mistake = opportunity(0), options = { depth: 2, seed: 2, adviceDiversity: true };
  const hint = chooseBotAction(mistake, DEFAULT_CONFIG, options);
  const combined = chooseBotAction(mistake, DEFAULT_CONFIG, { ...options, forgiving: true });
  assert.deepEqual(combined.action, hint.action);
  assert.deepEqual(combined.stats.adviceDiversity, hint.stats.adviceDiversity);
  assert.equal(combined.stats.forgiveness, undefined);
});

test('restraint is based on the position across all seeds, with extra room when ahead', () => {
  const state = opportunity(0); let spared = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed });
    if (!apply(state, DEFAULT_CONFIG, result.action).deaths.length) spared++;
  }
  assert.equal(spared, 40);
  const ahead = chooseBotAction(opportunity(0, 'ahead'), DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 11 });
  assert.equal(ahead.stats.forgiveness.mode, 'ease');
  assert.equal(ahead.stats.forgiveness.materialLead, 300);
  assert.equal(ahead.stats.forgiveness.applied, true);
  assert.equal(apply(opportunity(0, 'ahead'), DEFAULT_CONFIG, ahead.action).deaths.length, 0);
});

test('recent learner losses widen the positional allowance without causing a giveaway', () => {
  const state = opportunity(0), options = { ...BOT_DIFFICULTIES.training, seed: 11 };
  const strict = chooseBotAction(state, DEFAULT_CONFIG, options);
  assert.equal(apply(state, DEFAULT_CONFIG, strict.action).deaths.length, 0);
  const previous = { ...clone(state), ply: state.ply - 2 };
  previous.pieces.push(piece('lost', 'archer', 1, 4, 0));
  const kind = chooseBotAction(state, DEFAULT_CONFIG, { ...options, previousStates: [previous, state] });
  assert.equal(kind.stats.forgiveness.recentOpponentLoss, true);
  assert.equal(kind.stats.forgiveness.applied, true);
  assert.equal(apply(state, DEFAULT_CONFIG, kind.action).deaths.length, 0);
  assert.ok(kind.stats.forgiveness.maxGap > strict.stats.forgiveness.maxGap);
  const expired = chooseBotAction(state, DEFAULT_CONFIG, { ...options, previousStates: [{ ...previous, ply: 0 }, state] });
  assert.equal(expired.stats.forgiveness.recentOpponentLoss, false);
  assert.deepEqual(expired.action, strict.action);
});

test('forgiving does not repeat a position or reverse the last move just to spare a capture', () => {
  const state = opportunity(0), options = { ...BOT_DIFFICULTIES.training, seed: 2 };
  const first = chooseBotAction(state, DEFAULT_CONFIG, options), next = apply(state, DEFAULT_CONFIG, first.action).state;
  assert.equal(first.stats.forgiveness.applied, true);
  for (const context of [
    { seenPositions: [[botPositionKey(next, DEFAULT_CONFIG), 1]] },
    { lastActions: [[first.action.id, { from: first.action.to, to: state.pieces.find(p => p.id === first.action.id) }]] }
  ]) {
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...options, ...context });
    assert.notDeepEqual(result.action, first.action);
  }
});

test('a standalone Worker and module reproduce the same teaching decision', () => {
  const state = opportunity(0), options = { ...BOT_DIFFICULTIES.training, seed: 2 };
  const result = chooseBotAction(state, DEFAULT_CONFIG, options);
  const html = fs.readFileSync(new URL('../Lamps.html', import.meta.url), 'utf8');
  const source = JSON.parse(html.match(/<script id="bot-worker-source" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const messages = [], context = vm.createContext({ performance, self: { postMessage: value => messages.push(value) } });
  vm.runInContext(source, context);
  context.self.onmessage({ data: { id: 1, state, config: DEFAULT_CONFIG, options } });
  assert.equal(messages[0].error, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].result.action)), result.action);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].result.stats.forgiveness)), result.stats.forgiveness);
});

for (const team of [0, 1]) {
  test(`training can recover a material deficit on side ${team} without offering a piece`, () => {
    const state = opportunity(team, 'behind');
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 2 });
    assert.equal(result.stats.forgiveness.mode, 'recover');
    assert.equal(result.stats.forgiveness.recoveryAllowance, 300);
    assert.equal(result.stats.forgiveness.applied, false);
    const next = apply(state, DEFAULT_CONFIG, result.action);
    assert.deepEqual(next.deaths.map(p => p.id), ['a']);
    for (const enemy of next.state.pieces.filter(p => p.team !== team)) for (const to of reachable(enemy, next.state, DEFAULT_CONFIG)) {
      assert.equal(move(next.state, DEFAULT_CONFIG, enemy.id, to).deaths.some(p => p.team === team), false);
    }
  });
}

test('reported learner loss analysis matches every native reply and includes the whole army', () => {
  const state = createGame(DEFAULT_CONFIG);
  const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 2 });
  const next = apply(state, DEFAULT_CONFIG, result.action), info = result.stats.forgiveness;
  const values = { shield: 600, archer: 300, attackLamp: 600, horn: 600, defenseLamp: 500, scoutLamp: 400 };
  const losses = [], saving = [];
  for (const enemy of next.state.pieces.filter(p => p.team !== state.turn)) for (const to of reachable(enemy, next.state, DEFAULT_CONFIG)) {
    const reply = move(next.state, DEFAULT_CONFIG, enemy.id, to);
    const loss = reply.deaths.filter(p => p.team !== state.turn).reduce((sum, p) => sum + values[p.type], 0);
    losses.push(loss);
    if (!loss && reply.state.winner === null) saving.push(to);
  }
  assert.equal(info.lossAfter.immediate, 0);
  assert.equal(info.lossAfter.unavoidable, Math.min(...losses));
  assert.equal(info.lossAfter.savingReplies, saving.length);
  const report = analyze(next.state, DEFAULT_CONFIG);
  const pressure = next.state.pieces.filter(p => p.team !== state.turn).reduce((sum, p) => {
    const hit = report.get(p.id);
    return sum + (hit.incoming > 0 ? 90 * Math.min(1, hit.incoming / Math.max(1, hit.fortitude)) ** 2 + 12 * Math.max(0, hit.attackers.length - 1) : 0);
  }, 0);
  assert.equal(info.pressureAfter, pressure);
});

for (const team of [0, 1]) {
  test(`loss analysis sees casualties after a protective aura disappears on side ${team}`, () => {
    // The captured shield protects two archers. They survive the simultaneous
    // root combat but lose the aura afterwards; the player can save only one.
    const config = clone(DEFAULT_CONFIG);
    config.victoryCondition = 'all-units'; config.shieldDefenseOnly = false;
    config.stats.archer.damage = 3;
    config.stats.defenseLamp.defenseBonus = 10; config.stats.defenseLamp.fortitude = 20;
    config.stats.defenseLamp.move = 1;
    const original = { turn: 0, ply: 8, winner: null, pieces: [
      piece('s', 'shield', 0, 0, 0), piece('f', 'defenseLamp', 0, 0, -2),
      piece('a1', 'archer', 0, -1, 0), piece('a2', 'archer', 0, 0, 1),
      piece('es', 'shield', 1, 2, 0), piece('ef', 'defenseLamp', 1, -5, 2),
      piece('ea1', 'archer', 1, 3, 0), piece('ea2', 'archer', 1, 2, 1)
    ] };
    const state = team === 0 ? original : { ...original, turn: 1,
      pieces: original.pieces.map(p => ({ ...p, team: 1 - p.team, q: -p.q, r: -p.r })) };
    const outcome = move(state, config, 's', { q: team ? -1 : 1, r: 0 });
    assert.deepEqual(outcome.deaths.map(p => p.id), ['es']);
    const legal = position => position.pieces.filter(p => p.team === position.turn)
      .flatMap(p => reachable(p, position, config).map(to => ({ id: p.id, to })));
    const analysis = oneReplyRestraint(outcome, team, legal, (position, action) => move(position, config, action.id, action.to),
      pieces => pieces.reduce((sum, p) => sum + (p.type === 'shield' ? 600 : 300), 0));
    assert.equal(analysis.safe, true);
    assert.equal(analysis.immediateLoss, 600);
    assert.equal(analysis.unavoidableLoss, 900);
    assert.equal(analysis.savingReplies, 0);
    assert.equal(analysis.replies, legal(outcome.state).length);
  });
}
