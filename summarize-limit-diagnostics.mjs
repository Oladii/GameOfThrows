import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { clone, move, effective, shieldCanRetreat } from '../outputs/playtest-2026-11-05-shield-promotion-range/engine-snapshot/engine.js';
const root = '../outputs/diagnostics-2026-11-05-five-limit-games';
const read = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const positions = await read(root + '/positions-and-opportunities.json');
const exact = await read(root + '/exact-ending-8.json');
const raw = await read('../outputs/playtest-2026-11-05-shield-promotion-range/matches.json');
let replayedContinuationMoves = 0;
const cases = [];
for (const position of positions.reports) {
  const folder = root + '/continuations/match-' + String(position.match).padStart(2, '0');
  const data = await read(folder + '/matches.json'), continued = data.matches[0];
  assert.equal(data.protocol.maxPlies, 400); assert.equal(data.protocol.depth, 4);
  assert.equal(data.protocol.engineHash, raw.protocol.engineHash);
  assert.equal(data.protocol.searchHash, raw.protocol.searchHash);
  assert.equal(data.protocol.beam, raw.protocol.beam); assert.equal(data.protocol.replyBeam, raw.protocol.replyBeam);
  assert.deepEqual(data.protocol.config, positions.protocol.config);
  assert.deepEqual(continued.initialState, raw.matches.find(m => m.match === position.match).finalState);
  let state = clone(continued.initialState);
  for (const record of continued.moves) {
    const outcome = move(state, data.protocol.config, record.id, record.to);
    assert.deepEqual(outcome.deaths.map(p => p.id).sort(), record.deaths.map(p => p.id).sort());
    state = outcome.state; replayedContinuationMoves++;
  }
  assert.deepEqual(state, continued.finalState);
  const lastNewDeath = continued.moves.filter(m => m.deaths.length).at(-1)?.ply;
  const defenseCapChanges = state.pieces.flatMap(piece => {
    const stats = effective(piece, state, data.protocol.config), intrinsic = shieldCanRetreat(piece, data.protocol.config) ? data.protocol.config.shieldPromotion.defenseBonus : 0;
    const capped = data.protocol.config.stats[piece.type].fortitude + intrinsic + Math.min(1, stats.defenseBonus - intrinsic);
    return stats.fortitude === capped ? [] : [{ id: piece.id, team: piece.team, type: piece.type, actualFortitude: stats.fortitude, ifExternalDefenseCappedAtOne: capped }];
  });
  cases.push({ match: position.match, remainingAt200: position.remaining, quietPliesAt200: position.quietPlies, lastDeathAtOrBefore200: position.lastDeathPly,
    continuation: { finalPly: continued.finalPly, winner: continued.winner, stop: continued.stop, remaining: [0, 1].map(team => state.pieces.filter(p => p.team === team).length), lastDeathPly: lastNewDeath ?? position.lastDeathPly, quietPliesAtEnd: state.ply - (lastNewDeath ?? position.lastDeathPly), firstMove: continued.moves[0], deaths: continued.moves.filter(m => m.deaths.length) },
    sideCanNeverKillAnyEnemyAt200: position.sideCanNeverKillAnyEnemy, immediateWinMissedBefore200: position.winningOpportunitiesLast50.length,
    externalDefenseCapCounterfactualAtContinuationEnd: defenseCapChanges
  });
}
// Explain one exact winning pursuit step in match 8 using the bot's actual aura reward.
const game8 = raw.matches.find(m => m.match === 8), worstFirst = exact.results[0].principalLine[0], winningReply = exact.results[0].principalLine[1];
const afterEscape = move(game8.finalState, raw.protocol.config, worstFirst.id, worstFirst.to).state;
const afterApproach = move(afterEscape, raw.protocol.config, winningReply.id, winningReply.to).state;
const auraReward = s => s.pieces.filter(p => p.team === 0).reduce((sum, p) => { const i = effective(p, s, raw.protocol.config); return sum + i.damageBonus * 3 + i.defenseBonus * 3 + (p.type === 'archer' ? i.rangeBonus * 2 : 0); }, 0);
const report = {
  cases,
  verification: { allFiveContinuationsReplayed: true, replayedContinuationMoves, originalConfigUnchanged: true, seedsProfilesAndFullSearchHistoryRestored: true, originalCap: 200, extendedCap: 400, searchDepthPlies: 4 },
  exactEndgame8: exact.results.map(r => ({ ...r, principalLine: undefined })),
  botHeuristicEvidence: { match: 8, archerEscape: worstFirst, winningShieldApproach: winningReply, northAuraRewardBefore: auraReward(afterEscape), northAuraRewardAfter: auraReward(afterApproach), note: 'The current evaluator rewards temporary protection and even a damageBonus on a defense flag which cannot attack. In this ending neither North piece can be killed by the lone archer, so this reward can obstruct pursuit. This is a diagnosed incentive, not proof that it alone determines every move.' },
  recommendations: [
    { id: 'external_defense_cap_1', status: 'hypothesis_not_full_game_tested', change: 'Cap the sum of external fortitude aura bonuses at +1; retain the veteran personal +1.', target: [6], rationale: 'Reduces overlapping defensive aura amplification without changing the strict damage threshold.' },
    { id: 'veteran_move_2', status: 'exact_test_of_one_ending_only', change: 'Promoted shields move up to 2; retain attack reach cap 2.', target: [3, 8], rationale: 'In the exact match-8 ending the worst-case capture bound falls from 12 to 6 plies. This is not a full-game balance result.' },
    { id: 'defense_flag_move_1', status: 'hypothesis_not_full_game_tested', change: 'Defense flag move 2 -> 1.', target: [3], rationale: 'Slows the last non-attacking survivor; this is a secondary priority because the actual match-3 continuation already ends on ply 201.' },
    { id: 'center_control', status: 'hypothesis_not_full_game_tested', change: 'Additional victory condition: +1 point at the start of a player turn when occupying the center; 5 points win.', target: [3, 8, 9], rationale: 'Makes indefinite evasion concede a concrete objective. Changes the victory structure and needs separate full-game tests.' }
  ],
  limitation: 'Four actual bot continuations ending before 400 prove those saved positions can finish; they do not establish forced wins for all five positions. The exact guarantee applies to match 8 only. Continuations restore history but extend the bot horizon cap to 400; they are not complete reruns with a 400-ply cap from the opening. Counterfactual movement variants concern only the isolated three-piece ending.'
};
await fs.writeFile(root + '/analysis.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, cases: cases.map(c => ({ ...c, continuation: { ...c.continuation, deaths: c.continuation.deaths.map(m => ({ ply: m.ply, deaths: m.deaths })), firstMove: { id: c.continuation.firstMove.id, from: c.continuation.firstMove.from, to: c.continuation.firstMove.to } } })), botHeuristicEvidence: { ...report.botHeuristicEvidence, archerEscape: undefined, winningShieldApproach: undefined } }, null, 2));
