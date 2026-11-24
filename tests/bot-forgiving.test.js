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
    piece('a', 'archer', 1, 2, 0), piece('e', 'shield', 1, -3, 3), piece('ef', 'defenseLamp', 1, 0, 5),
    piece('reserve0', 'shield', 0, 4, -5), piece('reserve1', 'shield', 1, -4, 5)], turn: 0, ply: 8, winner: null };
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

test('after two losses training refuses an excessive concession in the full-army tactical regression', () => {
  const { state, seed } = JSON.parse(fs.readFileSync(new URL('./fixtures/bot-forgiving-defense.json', import.meta.url)));
  const normal = chooseBotAction(state, DEFAULT_CONFIG, { depth: 2, seed });
  const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed,
    initialOwnCount: state.pieces.filter(p => p.team === state.turn).length + 2 });
  assert.equal(result.stats.forgiveness.considered, true);
  assert.equal(result.stats.forgiveness.applied, false);
  assert.deepEqual(result.action, normal.action);
  assert.equal(result.stats.score, normal.stats.score);
});

test('training can leave a previously prepared attack in place instead of killing the attacker', () => {
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
  assert.equal(result.stats.forgiveness.applied, true);
  assert.deepEqual(result.stats.forgiveness.earnedCaptures, ['a']);
  assert.deepEqual(apply(state, config, result.action).deaths, []);
});

test('training takes immediate wins and stops when the turn is blocked', () => {
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
  assert.equal(chooseBotAction(blocked, config, BOT_DIFFICULTIES.training).action, null);
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

test('training stays balanced at equal headcount even with a higher tactical material score', () => {
  const state = opportunity(0); let spared = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed });
    if (!apply(state, DEFAULT_CONFIG, result.action).deaths.length) spared++;
  }
  assert.equal(spared, 40);
  const ahead = chooseBotAction(opportunity(0, 'ahead'), DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 11 });
  assert.equal(ahead.stats.forgiveness.mode, 'balanced');
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
    assert.equal(result.stats.forgiveness.figureDeficit, 1);
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
  const losses = [], saving = [];
  for (const enemy of next.state.pieces.filter(p => p.team !== state.turn)) for (const to of reachable(enemy, next.state, DEFAULT_CONFIG)) {
    const reply = move(next.state, DEFAULT_CONFIG, enemy.id, to);
    const loss = reply.deaths.filter(p => p.team !== state.turn).length;
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
    assert.equal(analysis.immediateLoss, 1);
    assert.equal(analysis.unavoidableLoss, 2);
    assert.equal(analysis.unavoidableValue, 900);
    assert.equal(analysis.savingReplies, 0);
    assert.equal(analysis.replies, legal(outcome.state).length);
  });
}

for (const team of [0, 1]) {
  test(`training accepts contested early exchanges but restores strict protection after two losses on side ${team}`, () => {
    const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/bot-forgiving-defense.json', import.meta.url)));
    const state = team === fixture.state.turn ? fixture.state : { ...fixture.state, turn: team,
      pieces: fixture.state.pieces.map(p => ({ ...p, team: 1 - p.team, q: -p.q, r: -p.r })) };
    const ownCount = state.pieces.filter(p => p.team === team).length;
    const legal = position => position.pieces.filter(p => p.team === position.turn)
      .flatMap(p => reachable(p, position, DEFAULT_CONFIG).map(to => ({ id: p.id, to })));
    const strict = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: fixture.seed, initialOwnCount: ownCount + 2 });
    for (const losses of [0, 1]) {
      const before = JSON.stringify(state);
      const options = { ...BOT_DIFFICULTIES.training, seed: fixture.seed, initialOwnCount: ownCount + losses,
        previousStates: [{ ...clone(state), ply: state.ply - 1 }, state] };
      const result = chooseBotAction(state, DEFAULT_CONFIG, options), info = result.stats.forgiveness;
      assert.equal(info.opening.lost, losses);
      assert.equal(info.opening.remaining, 2 - losses);
      assert.equal(info.opening.accepted, true);
      assert.notDeepEqual(result.action, strict.action);
      const next = apply(state, DEFAULT_CONFIG, result.action);
      assert.equal(next.deaths.length, 0, 'no figure is immediately handed over');
      assert.equal(info.lossAfter.immediate, 0, 'the player is spared the punishing capture');
      assert.ok(info.lossAfter.immediate < strict.stats.forgiveness.lossBefore.immediate);
      let contested = 0;
      for (const action of legal(next.state)) {
        const reply = move(next.state, DEFAULT_CONFIG, action.id, action.to);
        assert.notEqual(reply.state.winner, 1 - team); assert.notEqual(reply.state.winner, 'draw');
        const lost = reply.deaths.filter(p => p.team === team);
        if (!lost.length) continue;
        contested++;
        assert.equal(lost.length, 1); assert.notEqual(lost[0].type, 'defenseLamp');
        assert.ok(reply.deaths.some(p => p.id === action.id) || legal(reply.state).some(counter => {
          const answer = move(reply.state, DEFAULT_CONFIG, counter.id, counter.to);
          return answer.deaths.some(p => p.id === action.id) && !answer.deaths.some(p => p.team === team)
            && (answer.state.winner === null || answer.state.winner === team);
        }), 'every allowed capture retains real counterplay');
      }
      assert.ok(contested > 0);
      assert.equal(JSON.stringify(state), before);
    }
    assert.equal(strict.stats.forgiveness.opening.remaining, 0);
    assert.equal(strict.stats.forgiveness.opening.accepted, false);
    const inferred = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: fixture.seed,
      previousStates: [{ ...clone(state), ply: 0, pieces: [...state.pieces, piece('lost1', 'archer', team, 4, -4), piece('lost2', 'archer', team, -4, 4)] }] });
    assert.equal(inferred.stats.forgiveness.opening.remaining, 0);
    assert.deepEqual(inferred.action, strict.action);
  });
}

test('early leniency rejects a free capture without a recapture and never relaxes flag protection', () => {
  for (const type of ['archer', 'defenseLamp']) {
    const state = { turn: 0, ply: 8, winner: null, pieces: [piece('target', type, 0, 0, 0),
      ...(type === 'archer' ? [piece('f', 'defenseLamp', 0, 0, -5)] : [piece('a', 'archer', 0, 0, -4)]),
      piece('s', 'shield', 0, -3, 3), piece('es', 'shield', 1, 2, 0), piece('ef', 'defenseLamp', 1, 0, 5)] };
    const next = move(state, DEFAULT_CONFIG, 's', { q: -3, r: 4 });
    assert.equal(next.deaths.length, 0);
    const legal = position => position.pieces.filter(p => p.team === position.turn)
      .flatMap(p => reachable(p, position, DEFAULT_CONFIG).map(to => ({ id: p.id, to })));
    const result = oneReplyRestraint(next, 0, legal,
      (position, action) => move(position, DEFAULT_CONFIG, action.id, action.to), pieces => pieces.length * 300, { remaining: 2 });
    assert.equal(result.safe, false);
    assert.equal(result.contestedSafe, false);
  }
});

const legalReplies = (state, config) => state.pieces.filter(p => p.team === state.turn)
  .flatMap(p => reachable(p, state, config).map(to => ({ id: p.id, to: { q: to.q, r: to.r } })));
const mirrorTrainingPosition = (state, team) => team === state.turn ? state : {
  ...state, turn: team, pieces: state.pieces.map(p => ({ ...p, team: 1 - p.team, q: -p.q, r: -p.r }))
};

for (const team of [0, 1]) {
  test(`training accepts a prepared clean capture without a recapture after two losses on side ${team}`, () => {
    const state = mirrorTrainingPosition({ turn: 0, ply: 14, winner: null, pieces: [
      piece('u0', 'archer', 0, 0, -2), piece('u1', 'archer', 0, -4, -1),
      piece('u2', 'shield', 0, -2, 1), piece('u3', 'defenseLamp', 0, -3, 3),
      piece('u4', 'archer', 1, 2, -4), piece('u5', 'archer', 1, 3, 1),
      piece('u6', 'shield', 1, -5, 2), piece('u7', 'defenseLamp', 1, 1, -4)
    ] }, team);
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 7, initialOwnCount: 6 });
    assert.equal(result.stats.forgiveness.opening.remaining, 0);
    assert.ok(result.stats.forgiveness.earnedCaptures.includes('u0'));
    assert.notEqual(result.action.id, 'u0');
    const next = apply(state, DEFAULT_CONFIG, result.action);
    assert.equal(next.deaths.length, 0);
    const capture = { id: 'u4', to: { q: team ? -3 : 3, r: team ? 5 : -5 } };
    for (const position of [{ ...state, turn: 1 - team }, next.state]) {
      const taken = apply(position, DEFAULT_CONFIG, capture);
      assert.deepEqual(taken.deaths.map(p => p.id), ['u0']);
      assert.equal(taken.state.winner, null);
    }
    const taken = apply(next.state, DEFAULT_CONFIG, capture);
    assert.equal(legalReplies(taken.state, DEFAULT_CONFIG).some(action =>
      apply(taken.state, DEFAULT_CONFIG, action).deaths.some(p => p.id === capture.id)), false);
    for (const action of legalReplies(next.state, DEFAULT_CONFIG)) {
      const reply = apply(next.state, DEFAULT_CONFIG, action);
      assert.ok(reply.state.winner === null || reply.state.winner === team);
      const losses = reply.deaths.filter(p => p.team === team);
      assert.ok(losses.length <= 1 && !losses.some(p => p.type === 'defenseLamp'));
      if (losses.length) assert.deepEqual(apply({ ...state, turn: 1 - team }, DEFAULT_CONFIG, action).deaths.map(p => p.id), [losses[0].id]);
    }
  });
}

test('training prefers several sound replies even when the stronger move also has many legal replies', () => {
  const state = { turn: 0, ply: 14, winner: null, pieces: [
    piece('u0', 'archer', 0, -5, 3), piece('u1', 'archer', 0, -2, -1),
    piece('u2', 'shield', 0, -4, 1), piece('u3', 'defenseLamp', 0, 0, 3),
    piece('u4', 'archer', 1, -2, 4), piece('u5', 'archer', 1, 0, -4),
    piece('u6', 'shield', 1, -1, 1), piece('u7', 'defenseLamp', 1, 0, -2),
    piece('spare', 'defenseLamp', 1, -5, 1)
  ] };
  const ordinary = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.easy, seed: 7 });
  const training = chooseBotAction(state, DEFAULT_CONFIG, { ...BOT_DIFFICULTIES.training, seed: 7, initialOwnCount: 6 });
  assert.equal(training.stats.planningDepth, ordinary.stats.planningDepth);
  assert.equal(training.stats.maxDepth, ordinary.stats.maxDepth);
  assert.notDeepEqual(training.action, ordinary.action);
  assert.ok(legalReplies(apply(state, DEFAULT_CONFIG, ordinary.action).state, DEFAULT_CONFIG).length > 3);
  assert.equal(training.stats.forgiveness.goodRepliesBefore, 2);
  assert.ok(training.stats.forgiveness.goodRepliesAfter >= 3);
  const after = apply(state, DEFAULT_CONFIG, training.action).state;
  const acceptable = legalReplies(after, DEFAULT_CONFIG).filter(action => {
    const reply = apply(after, DEFAULT_CONFIG, action);
    if (reply.state.winner !== null || reply.deaths.some(p => p.team === 1)) return false;
    const report = analyze(reply.state, DEFAULT_CONFIG);
    return reply.state.pieces.every(p => p.team !== 1 || !report.get(p.id).dead);
  });
  assert.ok(acceptable.length >= training.stats.forgiveness.goodRepliesAfter);
});

// Front halves of the two armies are listed in order, so IDs stay stable.
function trainingPosition(types, cells) {
  return { turn: 0, ply: 14, winner: null, pieces: cells.map(([q, r], index) =>
    piece(`u${index}`, types[index % types.length], Math.floor(index / types.length), q, r)) };
}
const closingArmy = ['archer', 'shield', 'defenseLamp', 'horn'];
const openingArmy = ['archer', 'archer', 'shield', 'defenseLamp', 'horn'];
const trainingOptions = { ...BOT_DIFFICULTIES.training, seed: 7 };
const ordinaryOptions = { ...BOT_DIFFICULTIES.easy, seed: 7 };
const capturedFromPlayer = (outcome, team) => outcome.deaths.filter(p => p.team === 1 - team).length;
const playerCanWin = (state, config, team) => state.winner === 1 - team ||
  (state.winner === null && legalReplies(state, config).some(reply => apply(state, config, reply).state.winner === 1 - team));

for (const [targets, coordinates] of [
  [1, [[2, -1], [-3, 2], [-4, 4], [-5, 3], [-5, 4], [-5, 1], [1, -4], [3, 1], [5, 0], [0, -3]]],
  [3, [[2, -3], [-3, 2], [-1, 2], [5, -4], [0, -4], [-2, -3], [1, 1], [5, 0], [-4, 0], [-1, -4]]]
]) {
  test(`training leaves a prepared take from ${targets} threatened targets at equal headcount`, () => {
    const state = trainingPosition(openingArmy, coordinates);
    const result = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
    assert.equal(result.stats.trainingRules.preparedTargets, targets);
    assert.equal(result.stats.trainingRules.preserveThreat, true);
    const next = apply(state, DEFAULT_CONFIG, result.action);
    assert.equal(next.deaths.some(p => p.team === 0), false);
    const original = { ...state, turn: 1 };
    assert.ok(legalReplies(next.state, DEFAULT_CONFIG).some(action => {
      const taken = apply(next.state, DEFAULT_CONFIG, action);
      if (taken.deaths.length !== 1 || taken.deaths[0].team !== 0) return false;
      const [victim] = taken.deaths;
      if (victim.type === 'defenseLamp' || result.action.id === victim.id) return false;
      return legalReplies(original, DEFAULT_CONFIG).some(attack => attack.id === action.id
        && attack.to.q === action.to.q && attack.to.r === action.to.r
        && apply(original, DEFAULT_CONFIG, attack).deaths.map(p => p.id).join() === victim.id);
    }));
    const fewerFigures = { ...state, pieces: state.pieces.filter(p => p.id !== 'u4') };
    const behind = chooseBotAction(fewerFigures, DEFAULT_CONFIG, trainingOptions);
    assert.ok(behind.stats.trainingRules.preparedTargets > 0);
    assert.equal(behind.stats.trainingRules.figureLead, -1);
    assert.equal(behind.stats.trainingRules.preserveThreat, true);
  });
}

test('training answers a winning threat without taking a player figure when a quiet defense exists', () => {
  const original = trainingPosition(closingArmy, [[-4, 2], [-3, 1], [-1, -3], [1, 0], [1, -2], [-2, 2], [5, -3], [-2, 3]]);
  for (const team of [0, 1]) {
    const state = mirrorTrainingPosition(original, team);
    assert.ok(playerCanWin({ ...state, turn: 1 - team }, DEFAULT_CONFIG, team));
    const ordinary = chooseBotAction(state, DEFAULT_CONFIG, ordinaryOptions);
    const training = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
    assert.equal(training.stats.trainingRules.quietDefense, true);
    assert.equal(training.stats.planningDepth, ordinary.stats.planningDepth);
    assert.ok(capturedFromPlayer(apply(state, DEFAULT_CONFIG, ordinary.action), team) > 0);
    const next = apply(state, DEFAULT_CONFIG, training.action);
    assert.equal(capturedFromPlayer(next, team), 0);
    assert.equal(playerCanWin(next.state, DEFAULT_CONFIG, team), false);
  }
});

test('training closing limits a nonwinning move to one capture when a safe limited move exists', () => {
  const state = trainingPosition(closingArmy, [[3, 1], [0, -4], [1, -4], [-1, 1], [0, -2], [3, -2], [-3, 4], [-1, -2]]);
  const ordinary = chooseBotAction(state, DEFAULT_CONFIG, ordinaryOptions);
  const training = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
  assert.equal(training.stats.trainingRules.closing, true);
  assert.ok(capturedFromPlayer(apply(state, DEFAULT_CONFIG, ordinary.action), 0) > 1);
  const next = apply(state, DEFAULT_CONFIG, training.action);
  assert.ok(capturedFromPlayer(next, 0) <= 1);
  assert.equal(playerCanWin(next.state, DEFAULT_CONFIG, 0), false);
});

test('training closing allows a nonwinning multiple capture only when no limited move prevents defeat', () => {
  const state = trainingPosition(closingArmy, [[-2, -3], [-1, 0], [0, -1], [-4, -1], [3, 1], [0, 0], [4, -1], [-2, -2]]);
  const result = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
  const limited = legalReplies(state, DEFAULT_CONFIG).map(action => apply(state, DEFAULT_CONFIG, action))
    .filter(outcome => capturedFromPlayer(outcome, 0) <= 1);
  assert.ok(limited.length > 0 && limited.every(outcome => playerCanWin(outcome.state, DEFAULT_CONFIG, 0)));
  const rescue = apply(state, DEFAULT_CONFIG, result.action);
  assert.ok(capturedFromPlayer(rescue, 0) >= 2);
  assert.equal(rescue.state.winner, null);
  assert.equal(playerCanWin(rescue.state, DEFAULT_CONFIG, 0), false);
});

test('training closing takes an immediate winning multiple capture even with a safe quiet move', () => {
  const state = trainingPosition(closingArmy, [[3, 0], [-2, -2], [5, -1], [0, -1], [1, 3], [-3, 2], [2, 1], [-2, -3]]);
  assert.ok(legalReplies(state, DEFAULT_CONFIG).map(action => apply(state, DEFAULT_CONFIG, action))
    .some(outcome => outcome.state.winner === null && capturedFromPlayer(outcome, 0) === 0
      && !playerCanWin(outcome.state, DEFAULT_CONFIG, 0)));
  const result = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
  const next = apply(state, DEFAULT_CONFIG, result.action);
  assert.equal(next.state.winner, 0);
  assert.ok(capturedFromPlayer(next, 0) >= 2);
});

test('training closing plays an available tactical single capture instead of sparing it to reduce pressure', () => {
  const state = opportunity(0);
  state.pieces = state.pieces.filter(p => !p.id.startsWith('reserve'));
  const result = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
  assert.equal(result.stats.trainingRules.closing, true);
  assert.deepEqual(apply(state, DEFAULT_CONFIG, result.action).deaths.map(p => p.id), ['a']);
});

test('training leaves a prepared capture at a deficit of one but protects its pieces from two onward', () => {
  const base = { turn: 0, ply: 16, winner: null, pieces: [
    piece('u0', 'archer', 0, -2, 3), piece('u1', 'archer', 0, -3, -2),
    piece('u2', 'shield', 0, -5, 0), piece('u3', 'defenseLamp', 0, 1, 2),
    piece('u4', 'archer', 1, -1, -4), piece('u5', 'archer', 1, -1, -3),
    piece('u6', 'shield', 1, 0, -1), piece('u7', 'defenseLamp', 1, 3, -3),
    piece('u8', 'horn', 1, 4, -2)
  ] };
  const extra = [piece('u9', 'attackLamp', 1, 5, -2), piece('reserve', 'defenseLamp', 1, 0, 5)];
  const capture = { id: 'u4', to: { q: 0, r: -5 } };
  for (const deficit of [1, 2, 3]) {
    const state = { ...base, pieces: [...base.pieces, ...extra.slice(0, deficit - 1)] };
    assert.deepEqual(apply({ ...state, turn: 1 }, DEFAULT_CONFIG, capture).deaths.map(p => p.id), ['u1']);
    const result = chooseBotAction(state, DEFAULT_CONFIG, { ...trainingOptions, initialOwnCount: 6 });
    assert.equal(result.stats.forgiveness.opening.remaining, 0);
    const next = apply(state, DEFAULT_CONFIG, result.action);
    assert.equal(next.deaths.some(p => p.team === 0), false);
    assert.equal(playerCanWin(next.state, DEFAULT_CONFIG, 0), false);
    assert.equal(apply(next.state, DEFAULT_CONFIG, capture).deaths.some(p => p.id === 'u1'), deficit === 1);
    if (deficit >= 2) {
      for (const reply of legalReplies(next.state, DEFAULT_CONFIG)) {
        assert.equal(apply(next.state, DEFAULT_CONFIG, reply).deaths.some(p => p.team === 0), false);
      }
    }
  }
});

test('training keeps a safe triple capture when one or two figures behind', () => {
  const pieces = [
    piece('attacker', 'shield', 0, 0, 0), piece('guard', 'shield', 0, -4, 1),
    piece('flag', 'defenseLamp', 0, 0, -5), piece('reserve', 'shield', 0, 3, -5),
    piece('bow1', 'archer', 1, 2, 0), piece('bow2', 'archer', 1, 2, -1),
    piece('support', 'attackLamp', 1, 1, 1), piece('enemyGuard', 'shield', 1, -3, 4),
    piece('enemyFlag', 'defenseLamp', 1, 0, 5)
  ];
  for (const deficit of [1, 2]) {
    const army = deficit === 1 ? pieces : [...pieces, piece('enemyReserve', 'archer', 1, -5, 4)];
    for (const team of [0, 1]) {
      const state = mirrorTrainingPosition({ turn: 0, ply: 8, winner: null, pieces: army }, team);
      const result = chooseBotAction(state, DEFAULT_CONFIG, trainingOptions);
      const info = result.stats.forgiveness;
      assert.equal(info.figureDeficit, deficit);
      if (deficit === 1) assert.equal(info.materialLead, 0);
      assert.equal(info.candidates, 0, 'a recovery capture is kept before considering concessions');
      const next = apply(state, DEFAULT_CONFIG, result.action);
      assert.equal(next.state.winner, null);
      assert.deepEqual(next.deaths.map(p => p.id).sort(), ['bow1', 'bow2', 'support']);
      for (const reply of legalReplies(next.state, DEFAULT_CONFIG)) {
        const answer = apply(next.state, DEFAULT_CONFIG, reply);
        assert.ok(answer.state.winner === null || answer.state.winner === team);
        assert.ok(answer.deaths.every(p => p.team !== team));
      }
    }
  }
});

test('training advances after forty quiet plies and resets after either side takes a piece', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/bot-stalled-position.json', import.meta.url)));
  let state = fixture.state;
  const history = [];
  const choose = () => {
    const recent = history.slice(-40);
    const lastActions = new Map(recent.map(entry => [entry.action.id, entry.action]));
    return chooseBotAction(state, DEFAULT_CONFIG, { ...trainingOptions, seed: fixture.seed,
      initialOwnCount: fixture.initialOwnCount, previousStates: [...recent.map(entry => entry.state), state],
      lastActions: [...lastActions] });
  };
  for (const [id, q, r] of fixture.moves) {
    if (state.ply === 84) assert.equal(choose().stats.trainingRules.stalled, false);
    if (state.ply === 86) {
      const result = choose();
      assert.equal(result.stats.trainingRules.stalled, true);
      assert.deepEqual(result.action, { id: 'p13', to: { q: 2, r: -3 } });
      assert.equal(playerCanWin(apply(state, DEFAULT_CONFIG, result.action).state, DEFAULT_CONFIG, state.turn), false);
    }
    history.push({ state, action: { id, from: state.pieces.find(p => p.id === id), to: { q, r } } });
    state = move(state, DEFAULT_CONFIG, id, { q, r }).state;
  }
  assert.ok(state.pieces.length < history.at(-1).state.pieces.length);
  assert.equal(choose().stats.trainingRules.stalled, false);
});
