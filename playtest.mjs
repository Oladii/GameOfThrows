import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { botOutcomeScore } from './bot-objective.mjs';
import { alphaBeta } from './bot-search.mjs';
import { VARIANTS, usesAnnihilationGoal } from './experiment-profiles.mjs';
import { BALANCE_VARIANTS } from './balance-profiles-v2.mjs';
import { createEndgameTablebase } from './endgame-tablebase.mjs';
import { createExperiment } from './experiment-engine.mjs';
import { DEFAULT_CONFIG, LABELS, TEAM_NAMES } from './dist/rules.js';
import { clone, validateConfig, validateState, createGame, analyze, distance, isLethalDamage, shieldCanRetreat } from './dist/engine.js';

const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../outputs/playtest-2026-11-05');
const resumePath = process.argv.find(a => a.startsWith('--resume='))?.slice(9);
const resume = resumePath ? JSON.parse(await fs.readFile(resumePath, 'utf8')) : null;
const source = JSON.parse(await fs.readFile(path.join(output, 'config-ui-fields.json'), 'utf8'));
const variantId = process.argv.find(a => a.startsWith('--variant='))?.slice(10) || 'baseline';
const suite = process.argv.find(a => a.startsWith('--suite='))?.slice(8) || 'legacy';
const variant = (suite === 'balance' ? BALANCE_VARIANTS : VARIANTS).find(v => v.id === variantId);
if (!variant) throw new Error('Unknown variant ' + variantId);
const candidate = clone(DEFAULT_CONFIG);
for (const [name, value] of Object.entries({ ...source.fields, ...variant.changes })) {
  const parts = name.replace(/^experiment\./, 'experiments.').split('.');
  let obj = candidate;
  for (const part of parts.slice(0, -1)) { if (!Object.hasOwn(obj, part)) throw new Error(`Unknown setting ${name}`); obj = obj[part]; }
  const field = parts.at(-1);
  if (!Object.hasOwn(obj, field)) throw new Error(`Unknown setting ${name}`);
  obj[field] = value;
}
const config = validateConfig(candidate);
const experiment = createExperiment(config, variant.rule);
const reachable = (piece, state) => experiment.reachable(piece, state);
const move = (state, _config, id, to) => experiment.move(state, id, to);
const freeze = obj => { for (const value of Object.values(obj)) if (value && typeof value === 'object') freeze(value); return Object.freeze(obj); };
freeze(config);
const configHash = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
const engineHash = crypto.createHash('sha256').update(await fs.readFile(new URL('./dist/engine.js', import.meta.url))).digest('hex');
const LIMIT = Number(process.argv.find(a => a.startsWith('--max-plies='))?.slice(12) || 400), BEAM = 8;
const BOT_POLICY = process.argv.find(a => a.startsWith('--bot='))?.slice(6) || 'improved';
if (!['legacy', 'improved'].includes(BOT_POLICY)) throw new Error('Unknown bot policy');
const tablebase = createEndgameTablebase(config);
const SEARCH_DEPTH = Number(process.argv.find(a => a.startsWith('--depth='))?.slice(8) || 4);
const REPLY_BEAM = 3;
const GAMES = Number(process.argv.find(a => a.startsWith('--games='))?.slice(8) || 10);
const SEED_BASE = Number(process.argv.find(a => a.startsWith('--seed-base='))?.slice(12) || 17001);
const SYMMETRIC = process.argv.includes('--symmetric');
const PAIRED_SEEDS = process.argv.includes('--paired-seeds');
if (!Number.isInteger(SEARCH_DEPTH) || SEARCH_DEPTH < 2 || SEARCH_DEPTH > 4) throw new Error('Search depth must be 2..4');
if (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > 2000) throw new Error('Move cap must be 1..2000 plies');
if (!Number.isInteger(GAMES) || GAMES < 1 || GAMES > 100 || !Number.isInteger(SEED_BASE)) throw new Error('Invalid game count or seed base');
let searchVisits = 0, maxSearchDepth = 0;
const values = { shield: 4, archer: 4, attackLamp: 7, defenseLamp: 5 };
const profiles = {
  balanced: { label: 'Универсальный', cohesion: 1, aura: 1, chase: 1, pressure: 1, bannerFocus: 1, shieldFocus: 1 },
  formation: { label: 'Строй 2+1', cohesion: 4, aura: 1.4, chase: .8, pressure: 1, bannerFocus: 1, shieldFocus: 1 },
  assault: { label: 'Натиск', cohesion: .5, aura: .8, chase: 2, pressure: 1.7, bannerFocus: 1.2, shieldFocus: 1 },
  support: { label: 'Защита знамён', cohesion: 2, aura: 3, chase: .6, pressure: 1, bannerFocus: 1, shieldFocus: 1 },
  hunter: { label: 'Охота на знамёна', cohesion: .8, aura: 1, chase: 1.3, pressure: 1.2, bannerFocus: 3.5, shieldFocus: .4 },
  flank: { label: 'Обход щитов', cohesion: .6, aura: 1, chase: 1.4, pressure: 1.1, bannerFocus: 1.6, shieldFocus: .2 }
};
const pairs = [ ['balanced', 'balanced'], ['formation', 'assault'], ['support', 'hunter'], ['flank', 'formation'], ['assault', 'balanced'] ];
const positionKey = s => `${s.turn}|${s.pieces.map(p => `${p.team}:${p.type}:${p.q},${p.r}:${shieldCanRetreat(p, config) ? 1 : 0}`).sort().join('|')}`;
const legalActions = s => s.pieces.filter(p => p.team === s.turn).flatMap(p => reachable(p, s, config).map(to => ({ id: p.id, to, type: p.type, from: { q: p.q, r: p.r } })));

// This is an optimistic upper bound: ignore blockers, range, and formation constraints.
// Assume every surviving shield can promote later; death cannot increase this bound.
function damageBound(s, team) {
  const own = s.pieces.filter(p => p.team === team), banners = own.filter(p => p.type === 'attackLamp').length;
  const shields = own.filter(p => p.type === 'shield').length;
  const archers = own.filter(p => p.type === 'archer').length;
  return own.reduce((sum, p) => sum + config.stats[p.type].damage + banners * config.stats.attackLamp.damageBonus - (p.type === 'attackLamp' ? config.stats.attackLamp.damageBonus : 0) + shields * config.shieldPromotion.damageBonus + (archers - (p.type === 'archer' ? 1 : 0)) * config.stats.archer.damageBonus, 0);
}
function invulnerability(s) {
  const bounds = [damageBound(s, 0), damageBound(s, 1)];
  return { bounds, units: [0, 1].map(team => s.pieces.filter(p => p.team === team && !isLethalDamage(bounds[1 - team], config.stats[p.type].fortitude)).map(p => ({ id: p.id, type: p.type, fortitude: config.stats[p.type].fortitude }))) };
}
function evaluate(s, report, team, profile, repetitionFailure = false) {
  const proof = s.winner === null && usesAnnihilationGoal(variant) ? invulnerability(s) : null;
  const failedTest = repetitionFailure || (proof && proof.units[0].length > 0 && proof.units[1].length > 0) || (s.winner === null && !s.pieces.some(p => p.team === s.turn && reachable(p, s, config).length));
  const terminalScore = botOutcomeScore(s, team, LIMIT, failedTest);
  if (terminalScore !== null) return terminalScore;
  if (BOT_POLICY === 'improved' && s.pieces.length === 3) {
    const exact = tablebase.lookup(s);
    if (exact && exact.plies <= LIMIT - s.ply) return exact.winner === team ? 5e6 - exact.plies * 1000 : -5e6 + exact.plies * 1000;
  }
  const score = [0, 0];
  for (const p of s.pieces) {
    const info = report.get(p.id), own = s.pieces.filter(x => x.team === p.team), enemies = s.pieces.filter(x => x.team !== p.team);
    score[p.team] += 100 * values[p.type];
    if (info.dead) score[p.team] -= 30 * values[p.type];
    const enemyBound = BOT_POLICY === 'improved' ? (proof?.bounds[1 - p.team] ?? damageBound(s, 1 - p.team)) : Infinity;
    const usefulDefense = Math.min(info.defenseBonus, Math.max(0, enemyBound - config.stats[p.type].fortitude + (enemyBound > 0 ? 1 : 0)));
    const usefulDamage = BOT_POLICY === 'improved' && (info.damage <= 0 || info.range <= 0) ? 0 : info.damageBonus;
    score[p.team] += profile.aura * (usefulDamage * 3 + (BOT_POLICY === 'improved' ? usefulDefense : info.defenseBonus) * 3 + (p.type === 'archer' ? info.rangeBonus * 2 : 0));
    if (BOT_POLICY === 'improved' && shieldCanRetreat(p, config)) score[p.team] += 15;
    score[1 - p.team] += profile.pressure * Math.min(info.incoming / Math.max(1, info.fortitude), 1) * 4;
    if (info.damage > 0 && info.range > 0) {
      let chase = Infinity;
      for (const target of enemies) {
        const bias = target.type === 'attackLamp' || target.type === 'defenseLamp' ? profile.bannerFocus : target.type === 'shield' ? profile.shieldFocus : 1.4;
        chase = Math.min(chase, distance(p, target, config) / Math.max(.2, bias));
      }
      const rangeComfort = p.type === 'archer' ? 2 : 1;
      const finishWeight = BOT_POLICY === 'improved' && enemies.length <= 2 ? 3 : 1;
      score[p.team] -= profile.chase * finishWeight * Math.max(0, chase - rangeComfort) * (p.type === 'shield' ? 2 : 1.4);
      if (p.type === 'archer' && chase < 2) score[p.team] -= 2;
    }
    if (p.type === 'archer' && p.group != null && (BOT_POLICY === 'legacy' || isLethalDamage(enemyBound, config.stats[p.type].fortitude))) {
      const guards = own.filter(x => x.type === 'shield' && x.group === p.group);
      for (const guard of guards) score[p.team] += profile.cohesion * Math.max(0, 4 - distance(p, guard, config)) * 2;
    }
    if (p.type === 'defenseLamp' && (BOT_POLICY === 'legacy' || own.some(x => isLethalDamage(enemyBound, config.stats[x.type].fortitude)))) {
      const guards = own.filter(x => x.type === 'shield');
      if (guards.length) score[p.team] -= profile.cohesion * Math.min(...guards.map(x => distance(x, p, config))) * .4;
    }
  }
  return score[team] - score[1 - team];
}
let nodes = 0;
function simulate(s, action) {
  nodes++;
  const outcome = move(s, config, action.id, action.to);
  return { ...outcome, evaluationReport: outcome.deaths.length ? analyze(outcome.state, config) : outcome.report };
}
function tieNoise(seed, ply, action) {
  const text = `${seed}:${ply}:${action.type}:${action.from.q},${action.from.r}:${action.to.q},${action.to.r}`;
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return ((h >>> 0) / 4294967296) * .001;
}
function choose(s, profile, seed, seen, lastActions) {
  const team = s.turn, actions = legalActions(s);
  if (!actions.length) return null;
  const ranked = actions.map(action => {
    const outcome = simulate(s, action), repetition = seen.get(positionKey(outcome.state)) || 0;
    const previous = lastActions.get(action.id);
    const reverse = previous && previous.from.q === action.to.q && previous.from.r === action.to.r;
    const penalty = repetition * 18 + (reverse ? 8 : 0);
    const immediate = evaluate(outcome.state, outcome.evaluationReport, team, profile, repetition >= 2);
    return { action, outcome, immediate, penalty, rank: immediate - penalty + tieNoise(seed, s.ply, action) };
  }).sort((a, b) => b.rank - a.rank);
  const beam = ranked.slice(0, BEAM);
  // Keep each unit's best idea, so a low-mobility shield cannot disappear from the root beam.
  for (const p of s.pieces.filter(p => p.team === team)) {
    if (!beam.some(x => x.action.id === p.id)) {
      const candidate = ranked.find(x => x.action.id === p.id);
      if (candidate) beam.push(candidate);
    }
    if (BOT_POLICY === 'improved' && p.type === 'shield' && !shieldCanRetreat(p, config)) {
      const forward = ranked.find(x => x.action.id === p.id && (x.action.to.r - p.r) * (p.team === 0 ? 1 : -1) > 0);
      if (forward && !beam.includes(forward)) beam.push(forward);
    }
  }
  const context = {
    terminal: node => Math.abs(node.immediate) >= 1e6,
    maximizing: node => node.outcome.state.turn === team,
    visit: (_node, remaining) => { searchVisits++; maxSearchDepth = Math.max(maxSearchDepth, SEARCH_DEPTH - remaining); },
    children: node => {
      const maximizing = node.outcome.state.turn === team;
      return legalActions(node.outcome.state).map(action => {
        const outcome = simulate(node.outcome.state, action), key = positionKey(outcome.state);
        const pathKeys = [...node.pathKeys, key];
        const repeated = (seen.get(key) || 0) + pathKeys.filter(k => k === key).length >= 3;
        return { action, outcome, pathKeys, immediate: evaluate(outcome.state, outcome.evaluationReport, team, profile, repeated) };
      }).sort((a, b) => maximizing ? b.immediate - a.immediate : a.immediate - b.immediate).slice(0, REPLY_BEAM);
    }
  };
  let best = null, bestScore = -Infinity;
  for (const candidate of beam.filter(Boolean)) {
    const node = { ...candidate, pathKeys: [positionKey(candidate.outcome.state)] };
    const bonus = candidate.immediate * .00001 + tieNoise(seed, s.ply, candidate.action);
    const worst = alphaBeta(node, SEARCH_DEPTH - 1, bestScore + candidate.penalty - bonus, Infinity, context);
    const value = worst - candidate.penalty + bonus;
    if (value > bestScore) { best = candidate; bestScore = value; }
  }
  return { ...best, searchScore: bestScore, alternatives: actions.length, rootCandidates: beam.filter(Boolean).length };
}
const protocol = {
  method: 'Selective alpha-beta maximin: configured depth in plies; ranked root beam plus each unit best move, ranked inner beam. Production combat with separately tested experimental adapters.',
  inputSource: source.source, configHash, engineHash, config, variant, suite, botPolicy: BOT_POLICY, depth: SEARCH_DEPTH, beam: BEAM, replyBeam: REPLY_BEAM, maxPlies: LIMIT, repetitionStop: 3,
  policyHash: crypto.createHash('sha256').update(await fs.readFile(new URL('./playtest.mjs', import.meta.url))).digest('hex'),
  tablebaseHash: crypto.createHash('sha256').update(await fs.readFile(new URL('./endgame-tablebase.mjs', import.meta.url))).digest('hex'),
  requestedGames: GAMES, seedBase: SEED_BASE, symmetricProfiles: SYMMETRIC, pairedSeeds: PAIRED_SEEDS,
  searchHash: crypto.createHash('sha256').update(await fs.readFile(new URL('./bot-search.mjs', import.meta.url))).digest('hex'),
  adapterHash: crypto.createHash('sha256').update(await fs.readFile(new URL('./experiment-engine.mjs', import.meta.url))).digest('hex'),
  permanentSurvivorStopApplies: usesAnnihilationGoal(variant),
  materialPrior: values, profiles, pairs,
  objective: 'Bots score an engine draw and recognized test stops as a loss. A real victory has priority. Search can see failures only inside its horizon.',
  resume: resume ? { source: resumePath, match: resume.match, initialPly: resume.state.ply, restoresSearchHistory: true } : null,
  stops: 'Only engine winner is a victory/draw. Repetition, no legal moves, ply cap and proven mutual inability to win are unresolved test stops, not new game rules.',
  note: 'This is a small qualitative test with shallow policies, not human playtesting or a statistical proof of balance.'
};
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'config.json'), JSON.stringify(config, null, 2));
await fs.writeFile(path.join(output, 'protocol.json'), JSON.stringify(protocol, null, 2));

if (process.argv.includes('--benchmark')) {
  const start = experiment.initial(createGame(config)), began = performance.now();
  const selected = choose(start, profiles.balanced, 17001, new Map([[positionKey(start), 1]]), new Map());
  console.log(JSON.stringify({ benchmarkOnly: true, seconds: (performance.now() - began) / 1000, nodes, searchVisits, maxSearchDepth, legalMoves: selected.alternatives, choice: selected.action }));
  process.exit(0);
}

const matches = [];
for (let game = resume ? resume.match - 1 : 0; game < (resume ? resume.match : GAMES); game++) {
  const pair = SYMMETRIC ? ['balanced', 'balanced'] : pairs[Math.floor(game / 2) % pairs.length], first = game % 2;
  let s = resume ? validateState(resume.state, config) : createGame(config); if (!resume) s.turn = first;
  s = experiment.initial(s);
  const initialState = clone(s), seen = new Map(resume ? resume.seen : [[positionKey(s), 1]]), lastActions = new Map(resume ? resume.lastActions : []), moves = [];
  const seed = SEED_BASE + (PAIRED_SEEDS ? Math.floor(game / 2) : game) * 31, started = performance.now(), startNodes = nodes;
  const metrics = { firstDeath: null, firstShieldDeath: null, bannerDeaths: [], deathsByType: { shield: 0, archer: 0, attackLamp: 0, defenseLamp: 0 }, firstInvulnerable: [null, null], trades: 0 };
  let stop = s.winner !== null ? 'engine_terminal' : null, proof = null, adjudication = s.winner !== null ? variant.rule : null;
  for (let ply = s.ply; ply < LIMIT && s.winner === null; ply++) {
    const selected = choose(s, profiles[pair[s.turn]], seed, seen, lastActions);
    if (!selected) { stop = 'no_legal_moves'; break; }
    const before = s, committed = selected.outcome;
    // All root simulations use move(); commit that exact production-engine result.
    s = committed.state; validateState(s, config); if (committed.adjudication) adjudication = committed.adjudication.rule;
    const deaths = committed.deaths.map(p => ({ id: p.id, type: p.type, team: p.team, q: p.q, r: p.r, incoming: p.incoming, fortitude: p.fortitude }));
    if (deaths.length && metrics.firstDeath === null) metrics.firstDeath = s.ply;
    if (deaths.some(p => p.type === 'shield') && metrics.firstShieldDeath === null) metrics.firstShieldDeath = s.ply;
    for (const p of deaths) {
      metrics.deathsByType[p.type]++;
      if (p.type === 'attackLamp' || p.type === 'defenseLamp') metrics.bannerDeaths.push({ ply: s.ply, team: p.team, type: p.type });
    }
    if (deaths.some(p => p.team === 0) && deaths.some(p => p.team === 1)) metrics.trades++;
    moves.push({ ply: s.ply, team: before.turn, id: selected.action.id, type: selected.action.type, from: selected.action.from, to: { q: selected.action.to.q, r: selected.action.to.r }, deaths, alternatives: selected.alternatives, rootCandidates: selected.rootCandidates, remaining: [0, 1].map(t => s.pieces.filter(p => p.team === t).length) });
    lastActions.set(selected.action.id, selected.action);
    if (s.winner !== null) { stop = 'engine_terminal'; break; }
    proof = invulnerability(s);
    for (const team of [0, 1]) if (proof.units[team].length && metrics.firstInvulnerable[team] === null) metrics.firstInvulnerable[team] = s.ply;
    if (usesAnnihilationGoal(variant) && proof.units[0].length && proof.units[1].length) { stop = 'mutual_permanent_survivors'; break; }
    const position = positionKey(s), count = (seen.get(position) || 0) + 1; seen.set(position, count);
    if (count >= 3) { stop = 'threefold_test_stop'; break; }
  }
  stop ||= 'ply_limit';
  proof = invulnerability(s);
  const result = { match: game + 1, styles: pair.map(k => profiles[k].label), profileKeys: pair, firstSide: first, seed, plies: moves.length, initialPly: initialState.ply, finalPly: s.ply, winner: s.winner, stop, adjudication, seconds: +( (performance.now() - started) / 1000).toFixed(3), nodes: nodes - startNodes, maxSearchDepth, metrics, finalProof: proof, initialState, moves, finalState: s };
  // Independently replay every committed move to catch simulator/log divergence.
  let replay = clone(initialState);
  for (const record of moves) {
    const r = move(replay, config, record.id, record.to);
    assert.deepEqual(r.deaths.map(p => p.id).sort(), record.deaths.map(p => p.id).sort()); replay = r.state;
  }
  assert.deepEqual(replay, s);
  matches.push(result);
  const log = moves.map(m => ({ text: `${TEAM_NAMES[m.team]} · ${LABELS[m.type]}: ${m.from.q},${m.from.r} → ${m.to.q},${m.to.r}`, detail: m.deaths.length ? 'Погибли: ' + m.deaths.map(p => `${TEAM_NAMES[p.team]} ${LABELS[p.type]}`).join(', ') : 'Все фигуры держатся.' }));
  await fs.writeFile(path.join(output, `match-${String(game + 1).padStart(2, '0')}.json`), JSON.stringify({ format: variant.rule === 'none' ? 'lamps-prototype' : 'lamps-experiment', version: 1, experiment: variant, config, state: s, log }, null, 2));
  await fs.writeFile(path.join(output, 'matches.json'), JSON.stringify({ protocol, matches }, null, 2));
  console.log(JSON.stringify({ match: result.match, styles: result.styles, first: TEAM_NAMES[first], plies: result.plies, winner: result.winner, stop, remaining: [0, 1].map(t => s.pieces.filter(p => p.team === t).length), seconds: result.seconds, firstDeath: metrics.firstDeath, deaths: metrics.deathsByType }));
}
const summary = {
  matches: matches.length, wins: [0, 1].map(t => matches.filter(m => m.winner === t).length), engineDraws: matches.filter(m => m.winner === 'draw').length,
  unresolved: matches.filter(m => m.winner === null).length, stops: Object.fromEntries([...new Set(matches.map(m => m.stop))].map(s => [s, matches.filter(m => m.stop === s).length])),
  minPlies: Math.min(...matches.map(m => m.plies)), maxPlies: Math.max(...matches.map(m => m.plies)), meanPlies: matches.reduce((a, m) => a + m.plies, 0) / matches.length,
  totalNodes: nodes, totalSeconds: matches.reduce((a, m) => a + m.seconds, 0), replayVerified: true, configHash, engineHash, depth: SEARCH_DEPTH, maxSearchDepth, searchVisits,
  botPolicy: BOT_POLICY, tablebase: tablebase.metrics,
  annihilationWins: matches.filter(m => [0, 1].includes(m.winner) && !m.adjudication).length,
  ruleWins: matches.filter(m => [0, 1].includes(m.winner) && m.adjudication).length
};
await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ summary }));
