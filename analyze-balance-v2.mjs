import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const root = path.resolve('../outputs/balance-search-2026-11-05-v2');
const phase = process.argv.find(a => a.startsWith('--phase='))?.slice(8) || 'screen';
const { clone, validateConfig, createGame, analyze, effective, move, shieldCanRetreat } = await import(pathToFileURL(path.join(root, 'source/dist/engine.js')));
const { DEFAULT_CONFIG } = await import(pathToFileURL(path.join(root, 'source/dist/rules.js')));
const { BALANCE_VARIANTS } = await import(pathToFileURL(path.join(root, 'source/balance-profiles-v2.mjs')));
const baseFields = JSON.parse(await fs.readFile(path.join(root, 'config-ui-fields.json'), 'utf8')).fields;
const read = async name => JSON.parse(await fs.readFile(name, 'utf8'));
const median = list => { if (!list.length) return null; const a = [...list].sort((x,y) => x-y); return a.length%2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2; };
let verifiedMoves = 0;
const summaries = [];
const entries = await fs.readdir(path.join(root, phase), { withFileTypes: true });
const baseline = await read(path.join(root, phase === 'cross-policy' ? 'validation/legacy_control/matches.json' : phase + '/baseline/matches.json'));
for (const entry of entries.filter(e => e.isDirectory())) {
  const folder = path.join(root, phase, entry.name);
  let data;
  try { await fs.access(path.join(folder, 'summary.json')); data = await read(path.join(folder, 'matches.json')); } catch { continue; }
  const { protocol, matches } = data, variant = BALANCE_VARIANTS.find(v => v.id === protocol.variant.id);
  assert.ok(variant); assert.equal(protocol.depth, 4); assert.equal(protocol.maxPlies, 400); assert.equal(matches.length, protocol.requestedGames);
  for (const field of ['engineHash','policyHash','tablebaseHash','searchHash','adapterHash','beam','replyBeam','profiles','seedBase','pairedSeeds','symmetricProfiles']) assert.deepEqual(protocol[field], baseline.protocol[field]);
  const expected = clone(DEFAULT_CONFIG);
  for (const [name, value] of Object.entries({...baseFields,...variant.changes})) {
    const parts = name.replace(/^experiment\./,'experiments.').split('.'); let target = expected;
    for (const part of parts.slice(0,-1)) target = target[part]; target[parts.at(-1)] = value;
  }
  assert.deepEqual(protocol.config, validateConfig(expected));
  assert.equal(protocol.config.stats.shield.move, 1);
  assert.equal(protocol.config.shieldPromotion.maxRange, 2);
  const uncapped = clone(protocol.config); uncapped.auraDefenseCap = -1;
  let maxExternalDefense = 0, capAppliedSnapshots = 0;
  const games = [];
  for (const [index, game] of matches.entries()) {
    for (const field of ['seed','profileKeys','firstSide']) assert.deepEqual(game[field], baseline.matches[index][field]);
    let state = clone(game.initialState), firstDeath = null, lastDeath = 0, promoted = new Set();
    const fresh = clone(createGame(protocol.config)); fresh.turn = game.firstSide; assert.deepEqual(state, fresh);
    const initialDoomed = [...analyze(state, protocol.config).values()].filter(x => x.dead).length;
    for (const record of game.moves) {
      const outcome = move(state, protocol.config, record.id, record.to);
      assert.deepEqual(outcome.deaths.map(p => p.id).sort(), record.deaths.map(p => p.id).sort()); state = outcome.state; verifiedMoves++;
      if (outcome.deaths.length) { firstDeath ??= record.ply; lastDeath = record.ply; }
      for (const p of state.pieces) {
        const info = effective(p, state, uncapped), personal = shieldCanRetreat(p, protocol.config) ? protocol.config.shieldPromotion.defenseBonus : 0;
        maxExternalDefense = Math.max(maxExternalDefense, info.defenseBonus - personal);
        if (protocol.config.auraDefenseCap >= 0 && info.defenseBonus - personal > protocol.config.auraDefenseCap) capAppliedSnapshots++;
        if (shieldCanRetreat(p, protocol.config)) promoted.add(p.id);
      }
    }
    assert.deepEqual(state, game.finalState);
    const exported = await read(path.join(folder,'match-'+String(game.match).padStart(2,'0')+'.json')); assert.deepEqual(exported.state,state);
    if ([0,1].includes(state.winner)) assert.equal(state.pieces.some(p => p.team !== state.winner),false);
    games.push({match:game.match, winner:game.winner, firstSide:game.firstSide, stop:game.stop, plies:game.plies, firstDeath, tailWithoutDeaths:game.finalPly-lastDeath, promotedShields:promoted.size, initialDoomed, firstMoveCasualties:game.moves[0]?.deaths.length??0});
  }
  const wins = games.filter(g => [0,1].includes(g.winner));
  summaries.push({id:entry.name,variant:variant.id,label:variant.label,botPolicy:protocol.botPolicy,changes:variant.changes,games:games.length,wins:wins.length,unresolved:games.filter(g=>g.winner===null).length,draws:games.filter(g=>g.winner==='draw').length,firstMoverWins:wins.filter(g=>g.winner===g.firstSide).length,secondMoverWins:wins.filter(g=>g.winner!==g.firstSide).length,meanPlies:games.reduce((n,g)=>n+g.plies,0)/games.length,medianWinningPlies:median(wins.map(g=>g.plies)),meanQuietTail:games.reduce((n,g)=>n+g.tailWithoutDeaths,0)/games.length,longQuietTails:games.filter(g=>g.tailWithoutDeaths>=80).length,maxExternalDefense,capAppliedSnapshots,initialDoomedUnits:games.reduce((n,g)=>n+g.initialDoomed,0),firstMoveCasualties:games.reduce((n,g)=>n+g.firstMoveCasualties,0),matches:games});
}
summaries.sort((a,b)=>b.wins-a.wins||a.longQuietTails-b.longQuietTails||a.meanQuietTail-b.meanQuietTail||a.medianWinningPlies-b.medianWinningPlies);
await fs.writeFile(path.join(root, phase, 'analysis.json'),JSON.stringify({phase,verification:{verifiedMoves,allCompletedGamesReplayed:true,allExpectedConfigsChecked:true,shieldMoveAlwaysOne:true,reachCapAlwaysTwo:true},summaries},null,2));
console.log(JSON.stringify({phase,verifiedMoves,results:summaries.map(s=>({...s,matches:undefined}))},null,2));
