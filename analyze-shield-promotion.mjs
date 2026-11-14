import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { clone, validateState, validateConfig, createGame, move, reachable, shieldCanRetreat } from './dist/engine.js';
import { DEFAULT_CONFIG } from './dist/rules.js';

const root = '../outputs/playtest-2026-11-05-shield-promotion-range';
const read = async name => JSON.parse(await fs.readFile(name, 'utf8'));
const current = await read(root + '/matches.json');
const previous = await read('../outputs/playtest-2026-11-05-shield-promotion/matches.json');
const original = await read('../outputs/playtest-2026-11-05-shield-3-initiative/matches.json');
const config = validateConfig(current.protocol.config);
assert.deepEqual(config, DEFAULT_CONFIG);
assert.equal(current.matches.length, 10);
assert.equal(current.protocol.depth, 4);
for (const field of ['beam', 'replyBeam', 'maxPlies', 'profiles', 'objective']) {
  assert.deepEqual(current.protocol[field], previous.protocol[field]);
  assert.deepEqual(current.protocol[field], original.protocol[field]);
}
const oldPromotionConfig = clone(config);
delete oldPromotionConfig.shieldPromotion.maxRange;
assert.deepEqual(config.stats, previous.protocol.config.stats);
assert.deepEqual(config.stats, original.protocol.config.stats);
assert.deepEqual(oldPromotionConfig, previous.protocol.config);
const { shieldPromotion: _promotion, ...baseConfig } = config;
assert.deepEqual(baseConfig, original.protocol.config);
assert.equal(crypto.createHash('sha256').update(await fs.readFile(root + '/engine-snapshot/engine.js')).digest('hex'), current.protocol.engineHash);
assert.equal(crypto.createHash('sha256').update(await fs.readFile(new URL('./dist/engine.js', import.meta.url))).digest('hex'), current.protocol.engineHash);

let verifiedMoves = 0, controlVerifiedMoves = 0;
const oldEngine = await import('../outputs/playtest-2026-11-05-shield-promotion/engine-snapshot/engine.js');
for (const match of previous.matches) {
  let state = clone(match.initialState);
  for (const record of match.moves) {
    const outcome = oldEngine.move(state, previous.protocol.config, record.id, record.to);
    assert.deepEqual(outcome.deaths.map(p => p.id).sort(), record.deaths.map(p => p.id).sort());
    state = outcome.state; controlVerifiedMoves++;
  }
  assert.deepEqual(state, match.finalState);
}

const matches = [];
for (const [index, match] of current.matches.entries()) {
  for (const field of ['seed', 'profileKeys', 'firstSide', 'initialState']) {
    assert.deepEqual(match[field], previous.matches[index][field]);
    assert.deepEqual(match[field], original.matches[index][field]);
  }
  let state = clone(match.initialState), promotions = [], backwardMoves = 0, sidewaysMoves = 0;
  const fresh = clone(createGame(config)); fresh.turn = match.firstSide;
  assert.deepEqual(state, fresh);
  for (const record of match.moves) {
    const piece = state.pieces.find(p => p.id === record.id);
    const route = reachable(piece, state, config).find(c => c.q === record.to.q && c.r === record.to.r);
    assert.ok(route);
    if (piece.type === 'shield') {
      if (!shieldCanRetreat(piece, config) && route.reachedFarEdge) promotions.push({ id: piece.id, team: piece.team, ply: record.ply });
      const advance = (record.to.r - piece.r) * (piece.team === 0 ? 1 : -1);
      if (advance < 0) { backwardMoves++; assert.equal(shieldCanRetreat(piece, config), true); }
      if (advance === 0) sidewaysMoves++;
    }
    const outcome = move(state, config, record.id, record.to);
    assert.deepEqual(outcome.deaths.map(p => p.id).sort(), record.deaths.map(p => p.id).sort());
    for (const p of [...outcome.state.pieces, ...outcome.deaths]) if (p.type === 'shield') assert.ok(outcome.report.get(p.id).range <= 2);
    state = outcome.state; validateState(state, config); verifiedMoves++;
  }
  assert.deepEqual(state, match.finalState);
  const exported = await read(root + '/match-' + String(match.match).padStart(2, '0') + '.json');
  assert.deepEqual(exported.state, state);
  const lastDeath = match.moves.filter(m => m.deaths.length).at(-1)?.ply ?? 0;
  matches.push({ match: match.match, winner: match.winner, stop: match.stop, plies: match.plies, promotions, backwardMoves, sidewaysMoves, tailWithoutDeaths: match.finalPly - lastDeath, survivors: state.pieces.map(p => ({ team: p.team, type: p.type, promoted: shieldCanRetreat(p, config) })) });
}
const summarize = games => {
  const wins = games.filter(g => [0, 1].includes(g.winner));
  return { games: games.length, wins: wins.length, draws: games.filter(g => g.winner === 'draw').length, unresolved: games.filter(g => g.winner === null).length, stops: Object.fromEntries([...new Set(games.map(g => g.stop))].map(stop => [stop, games.filter(g => g.stop === stop).length])), meanPlies: games.reduce((n, g) => n + g.plies, 0) / games.length, meanWinningPlies: wins.length ? wins.reduce((n, g) => n + g.plies, 0) / wins.length : null };
};
const report = {
  comparison: 'Same 10 starts, seeds, profiles, search depth, beam widths and move cap. Original: forward-only shields. Previous: sideways, permanent retreat, personal damage/fortitude and combined aura after the far edge. Current: additionally personal range +1 after the edge, shield range capped at 2; allied auras never extend shield reach.',
  original: summarize(original.matches.slice(0, 10)),
  beforeRangeBonus: summarize(previous.matches),
  current: summarize(current.matches),
  usage: { promotedShields: matches.reduce((n, m) => n + m.promotions.length, 0), gamesWithPromotion: matches.filter(m => m.promotions.length).length, backwardMoves: matches.reduce((n, m) => n + m.backwardMoves, 0), sidewaysMoves: matches.reduce((n, m) => n + m.sidewaysMoves, 0) },
  verification: { verifiedMoves, controlVerifiedMoves, allMovesReplayed: true, allFinalExportsMatch: true, sameStartsSeedsProfiles: true, allOtherStatsUnchanged: true, shieldRangeAlwaysAtMostTwo: true, depth: 4, maxPlies: 200 },
  matches,
  limitation: 'Small deterministic selective-search bot sample. Unresolved games are test stops, not official draws. Results do not establish human balance or prove a general effect.'
};
await fs.writeFile(root + '/comparison.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, matches: matches.map(m => ({ ...m, survivors: m.winner === null ? m.survivors : undefined })) }, null, 2));
