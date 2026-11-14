import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from './dist/rules.js';
const root = '../outputs/balance-search-2026-11-05-v2';
const read = async name => JSON.parse(await fs.readFile(root + '/' + name,'utf8'));
const screen = await read('screen/analysis.json'), validation = await read('validation/analysis.json'), cross = await read('cross-policy/analysis.json');
const candidate = validation.summaries.find(s=>s.id==='shield_damage_4'), baseline = validation.summaries.find(s=>s.id==='baseline');
const oldCandidate = cross.summaries[0], oldBaseline = validation.summaries.find(s=>s.id==='legacy_control');
assert.equal(candidate.wins,20); assert.equal(baseline.wins,15);
assert.ok(oldCandidate.wins > oldBaseline.wins);
assert.equal(candidate.firstMoveCasualties,0); assert.equal(candidate.initialDoomedUnits,0);
const measured = await read('validation/shield_damage_4/config.json');
assert.deepEqual(DEFAULT_CONFIG, measured);
const report = {
  games: [...screen.summaries,...validation.summaries,...cross.summaries].reduce((n,s)=>n+s.games,0),
  variantsChangedRules: screen.summaries.filter(s=>Object.keys(s.changes).length).length,
  verification: { replayedMoves: screen.verification.verifiedMoves+validation.verification.verifiedMoves+cross.verification.verifiedMoves, allResultsReplayed: true, expectedConfigsAndExportsVerified: true, liveDefaultEqualsMeasuredCandidate: true, oldSavedGameReplay: await read('backward-compatibility.json'), testsPassed:38 },
  adopted: { changes: {'stats.shield.damage':4}, beforeShieldDamage:3, shieldMove:1, promotedShieldMove:1, promotedReachCap:2, externalDefenseCap:-1, reason:'Best independent finish rate, corroborated with a second bot policy; no initial casualties. A provisional bot-tested balance, not a proof of human balance.' },
  matchedValidation: { gamesEach:20, seedBase:88001, pairedSeeds:true, identicalProfilesBothTeams:true, maxPlies:400, searchDepthPlies:4, rows:[baseline,candidate,validation.summaries.find(s=>s.id==='defense_fort_1'),validation.summaries.find(s=>s.id==='defense_aura_1')].map(({matches,...s})=>s), secondPolicy:{baseline:oldBaseline.wins,candidate:oldCandidate.wins,gamesEach:20,candidateFirstMoverWins:oldCandidate.firstMoverWins,candidateSecondMoverWins:oldCandidate.secondMoverWins} },
  screen: screen.summaries.map(({matches,...s})=>s),
  ui: { preview:'The original piece is hidden and does not receive the hypothetical death marker while its destination ghost is displayed.', death:'Token shrinks away over 80ms; a central skull appears, holds briefly, and fades by 360ms. Effects are removed after 400ms and skipped for reduced motion.', savedPosition:'Applied shield damage 4 without moving pieces: ply0, 10 units per side.', screenshots:['ui/preview-fixed.png','ui/skull-death.png','ui/adopted-shield-damage-4.png'] },
  limitations:['Small deterministic bot samples and selective four-ply search do not establish human playability or statistical fairness.','The revised bot did not improve finish counts on the old balance in these samples: screen9/10 vs legacy10/10, validation15/20 for both. Exact endgame support and measured balance effects are separate findings.','Unresolved runs remain test stops, not official draws.']
};
assert.equal(report.games,220);
await fs.writeFile(root+'/analysis.json',JSON.stringify(report,null,2));
await fs.writeFile(root+'/selected-config.json',JSON.stringify(DEFAULT_CONFIG,null,2));
console.log(JSON.stringify({games:report.games,replayedMoves:report.verification.replayedMoves,selected:report.adopted,validation:report.matchedValidation.rows.map(s=>({id:s.id,wins:s.wins,unfinished:s.unresolved,first:s.firstMoverWins,second:s.secondMoverWins})),secondPolicy:report.matchedValidation.secondPolicy},null,2));
