import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { VARIANTS } from './experiment-profiles.mjs';
import { createExperiment } from './experiment-engine.mjs';
import { clone, analyze, validateState } from './dist/engine.js';

const root = path.resolve('../outputs/playtest-2026-11-05-depth4');
const baseline = JSON.parse(await fs.readFile(path.join(root, 'baseline/matches.json'), 'utf8'));
const median = values => { const a = [...values].sort((a, b) => a - b); return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2; };
const summaries = [];
let verifiedMoves = 0, verifiedPositions = 0;
for (const variant of VARIANTS) {
  const folder = path.join(root, variant.id);
  const data = JSON.parse(await fs.readFile(path.join(folder, 'matches.json'), 'utf8'));
  assert.equal(data.matches.length, 10); assert.equal(data.protocol.depth, 4); assert.equal(data.protocol.variant.id, variant.id);
  if (variant.kind === 'victory') assert.equal(data.protocol.permanentSurvivorStopApplies, false);
  for (const field of ['method', 'beam', 'replyBeam', 'maxPlies', 'repetitionStop', 'materialPrior', 'profiles', 'pairs', 'objective', 'engineHash', 'searchHash', 'adapterHash']) assert.deepEqual(data.protocol[field], baseline.protocol[field]);
  const expectedConfig = clone(baseline.protocol.config);
  for (const [field, value] of Object.entries(variant.changes)) { const parts = field.split('.'); let obj = expectedConfig; for (const p of parts.slice(0, -1)) obj = obj[p]; obj[parts.at(-1)] = value; }
  assert.deepEqual(data.protocol.config, expectedConfig);
  const engine = createExperiment(data.protocol.config, variant.rule), matches = [];
  for (const [index, m] of data.matches.entries()) {
    for (const field of ['initialState', 'seed', 'profileKeys', 'firstSide']) assert.deepEqual(m[field], baseline.matches[index][field]);
    let s = clone(m.initialState), adjudication = null;
    for (const rec of m.moves) { const result = engine.move(s, rec.id, rec.to); assert.deepEqual(result.deaths.map(p => p.id).sort(), rec.deaths.map(p => p.id).sort()); s = result.state; if (result.adjudication) adjudication = result.adjudication.rule; verifiedMoves++; }
    assert.deepEqual(s, m.finalState); assert.equal(adjudication, m.adjudication); validateState(s, data.protocol.config);
    if ([0, 1].includes(m.winner) && !m.adjudication) assert.equal(s.pieces.filter(p => p.team !== m.winner).length, 0);
    const filename = path.join(folder, 'match-' + String(m.match).padStart(2, '0') + '.json');
    const position = JSON.parse(await fs.readFile(filename, 'utf8')); assert.deepEqual(position.state, s);
    position.format = variant.rule === 'none' ? 'lamps-prototype' : 'lamps-experiment'; position.experiment = variant;
    await fs.writeFile(filename, JSON.stringify(position, null, 2)); verifiedPositions++;
    const deathMoves = m.moves.filter(r => r.deaths.length), last = deathMoves.at(-1)?.ply ?? 0;
    matches.push({ match: m.match, winner: m.winner, adjudication: m.adjudication, stop: m.stop, plies: m.plies, firstDeath: deathMoves[0]?.ply ?? null, tailNoLoss: m.plies - last, casualties: m.moves.reduce((n, r) => n + r.deaths.length, 0), firstSide: m.firstSide, initialDoomed: [...analyze(m.initialState, data.protocol.config).values()].filter(x => x.dead).length });
  }
  const wins = matches.filter(m => [0, 1].includes(m.winner)), annihilation = wins.filter(m => !m.adjudication);
  summaries.push({ id: variant.id, label: variant.label, kind: variant.kind, changes: variant.changes, rule: variant.rule, hypothesis: variant.hypothesis, games: matches.length, wins: wins.length, annihilationWins: annihilation.length, ruleWins: wins.length - annihilation.length, draws: matches.filter(m => m.winner === 'draw').length, unfinished: matches.filter(m => m.winner === null).length, stops: Object.fromEntries([...new Set(matches.map(m => m.stop))].map(stop => [stop, matches.filter(m => m.stop === stop).length])), meanWinningPlies: wins.length ? wins.reduce((n, m) => n + m.plies, 0) / wins.length : null, medianWinningPlies: wins.length ? median(wins.map(m => m.plies)) : null, firstMoverWins: wins.filter(m => m.winner === m.firstSide).length, secondMoverWins: wins.filter(m => m.winner !== m.firstSide).length, meanTailNoLoss: matches.reduce((n, m) => n + m.tailNoLoss, 0) / matches.length, gamesWithTailAtLeast100: matches.filter(m => m.tailNoLoss >= 100).length, casualties: matches.reduce((n, m) => n + m.casualties, 0), firstMoveCasualtyGames: matches.filter(m => m.firstDeath === 1).length, initialDoomedUnits: matches.reduce((n, m) => n + m.initialDoomed, 0), matches });
}
const endgames = JSON.parse(await fs.readFile(path.join(root, 'endgames/summary.json'), 'utf8'));
for (const e of endgames) {
  const data = JSON.parse(await fs.readFile(path.join(root, 'endgames', e.id, 'matches.json'), 'utf8')), m = data.matches[0];
  const engine = createExperiment(data.protocol.config, data.protocol.variant.rule); let s = clone(m.initialState);
  for (const r of m.moves) { const next = engine.move(s, r.id, r.to); assert.deepEqual(next.deaths.map(p => p.id).sort(), r.deaths.map(p => p.id).sort()); s = next.state; verifiedMoves++; }
  assert.deepEqual(s, m.finalState);
  e.captured = e.winner === 0 && !e.adjudication && s.pieces.filter(p => p.team === 1).length === 0;
  e.initialDoomedUnits = [...analyze(m.initialState, data.protocol.config).values()].filter(x => x.dead).length;
}
const depth2 = JSON.parse(await fs.readFile(path.join(root, 'depth2-control/matches.json'), 'utf8'));
for (const field of ['config', 'beam', 'replyBeam', 'materialPrior', 'profiles', 'pairs', 'objective', 'engineHash', 'searchHash', 'adapterHash']) assert.deepEqual(depth2.protocol[field], baseline.protocol[field]);
for (const [i, m] of depth2.matches.entries()) {
  for (const field of ['initialState', 'seed', 'profileKeys', 'firstSide']) assert.deepEqual(m[field], baseline.matches[i][field]);
  let s = clone(m.initialState); const engine = createExperiment(depth2.protocol.config);
  for (const r of m.moves) { const next = engine.move(s, r.id, r.to); assert.deepEqual(next.deaths.map(p => p.id).sort(), r.deaths.map(p => p.id).sort()); s = next.state; verifiedMoves++; } assert.deepEqual(s, m.finalState);
}
const report = { protocol: { depth: 4, rootBeam: baseline.protocol.beam, innerBeam: baseline.protocol.replyBeam, maxPlies: baseline.protocol.maxPlies, pairedSeedsStylesStarts: true, variantsPerPlan: 10, gamesPerVariant: 10, fullGames: 120, isolatedEndgames: endgames.length, note: 'Small deterministic bot samples; victory-rule variants are not directly interchangeable with annihilation wins.' }, verification: { allFullGamesAndEndgamesReplayed: true, verifiedMoves, verifiedPositions, configuredChangesOnly: true }, depth2Control: { wins: depth2.matches.filter(m => [0, 1].includes(m.winner)).length, unfinished: depth2.matches.filter(m => m.winner === null).length }, variants: summaries, endgames };
await fs.writeFile(path.join(root, 'analysis.json'), JSON.stringify(report, null, 2));
const completed = await Promise.all(VARIANTS.map(async v => ({ id: v.id, summary: JSON.parse(await fs.readFile(path.join(root, v.id, 'summary.json'), 'utf8')) })));
await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify(completed, null, 2));
await fs.writeFile(path.join(root, 'status.json'), JSON.stringify({ completed, running: [] }, null, 2));
for (const variant of VARIANTS.filter(v => v.kind === 'victory')) {
  const folder = path.join(root, variant.id), data = JSON.parse(await fs.readFile(path.join(folder, 'matches.json'), 'utf8'));
  try { await fs.rename(path.join(folder, 'run.log'), path.join(folder, 'run-before-cutoff-correction.log')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.writeFile(path.join(folder, 'run.log'), 'Final verified run after correcting applicability of the permanent-survivor cutoff. The following lines are derived from matches.json.\n' + data.matches.map(m => JSON.stringify({ match: m.match, winner: m.winner, adjudication: m.adjudication, stop: m.stop, plies: m.plies })).join('\n') + '\n');
}
console.log(JSON.stringify({ protocol: report.protocol, verification: report.verification, depth2: report.depth2Control, variants: summaries.map(s => ({ ...s, matches: undefined })), endgames }, null, 2));
