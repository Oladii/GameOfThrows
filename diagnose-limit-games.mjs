import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { clone, analyze, effective, reachable, move, shieldCanRetreat } from '../outputs/playtest-2026-11-05-shield-promotion-range/engine-snapshot/engine.js';

const root = '../outputs/diagnostics-2026-11-05-five-limit-games';
const data = JSON.parse(await fs.readFile('../outputs/playtest-2026-11-05-shield-promotion-range/matches.json', 'utf8'));
const config = data.protocol.config;
const positionKey = s => JSON.stringify([s.turn, s.pieces.map(p => [p.id, p.q, p.r, shieldCanRetreat(p, config)]).sort()]);
const actions = s => s.pieces.filter(p => p.team === s.turn).flatMap(p => reachable(p, s, config).map(to => ({ id: p.id, to })));
function futureDamageBound(s, team) {
  const own = s.pieces.filter(p => p.team === team), flags = own.filter(p => p.type === 'attackLamp').length, shields = own.filter(p => p.type === 'shield').length;
  return own.reduce((n, p) => n + (p.type === 'defenseLamp' ? 0 : config.stats[p.type].damage + (flags - (p.type === 'attackLamp' ? 1 : 0)) * config.stats.attackLamp.damageBonus + shields * config.shieldPromotion.damageBonus), 0);
}
const minimumFortitude = p => config.stats[p.type].fortitude + (shieldCanRetreat(p, config) ? config.shieldPromotion.defenseBonus : 0);
const reports = [];
for (const match of data.matches.filter(m => m.stop === 'ply_limit')) {
  let state = clone(match.initialState), lastDeath = 0, quietStart = null;
  const positionCounts = new Map(), winningOpportunities = [], captureOpportunities = [], deaths = [], snapshots = [];
  for (const record of match.moves) {
    if (state.ply >= 150) {
      const options = actions(state), winning = [], capturing = [];
      for (const action of options) {
        const next = move(state, config, action.id, action.to);
        if (next.state.winner === state.turn) winning.push(action);
        const enemyDeaths = next.deaths.filter(p => p.team !== state.turn).length;
        if (enemyDeaths) capturing.push({ ...action, enemyDeaths, ownDeaths: next.deaths.filter(p => p.team === state.turn).length });
      }
      if (winning.length) winningOpportunities.push({ beforePly: state.ply, team: state.turn, winning });
      if (capturing.length) captureOpportunities.push({ beforePly: state.ply, team: state.turn, capturing, chosen: { id: record.id, to: record.to }, chosenEnemyDeaths: record.deaths.filter(p => p.team !== state.turn).length });
    }
    const result = move(state, config, record.id, record.to);
    assert.deepEqual(result.deaths.map(p => p.id).sort(), record.deaths.map(p => p.id).sort());
    state = result.state;
    const k = positionKey(state); positionCounts.set(k, (positionCounts.get(k) ?? 0) + 1);
    if (record.deaths.length) { lastDeath = record.ply; quietStart = clone(state); deaths.push({ ply: record.ply, deaths: record.deaths }); }
    if ([100, 150, 175, 184, 190, 200].includes(state.ply)) snapshots.push({ ply: state.ply, pieces: clone(state.pieces) });
  }
  assert.deepEqual(state, match.finalState);
  const report = analyze(state, config), bounds = [0, 1].map(team => futureDamageBound(state, team));
  const immortal = state.pieces.filter(p => minimumFortitude(p) >= bounds[1 - p.team]);
  const canNeverKill = [0, 1].map(team => state.pieces.filter(p => p.team !== team).every(p => minimumFortitude(p) >= bounds[team]));
  const lastForty = match.moves.slice(-40);
  reports.push({
    match: match.match, firstSide: match.firstSide, nextSide: state.turn, finalPly: state.ply, lastDeathPly: lastDeath, quietPlies: state.ply - lastDeath,
    remaining: [0, 1].map(team => state.pieces.filter(p => p.team === team).length),
    finalPieces: state.pieces.map(p => ({ ...p, ...effective(p, state, config), incoming: report.get(p.id).incoming, legalMoves: reachable(p, state, config).length })),
    futureDamageBounds: bounds, permanentlyUnkillable: immortal.map(p => ({ id: p.id, team: p.team, type: p.type, minimumFortitude: minimumFortitude(p) })),
    sideCanNeverKillAnyEnemy: canNeverKill,
    deathTimeline: deaths, last50Deaths: deaths.filter(d => d.ply > 150), winningOpportunitiesLast50: winningOpportunities, captureOpportunitiesLast50: captureOpportunities,
    last40Activity: Object.fromEntries([...new Set(lastForty.map(m => m.id))].map(id => [id, { moves: lastForty.filter(m => m.id === id).length, destinations: [...new Set(lastForty.filter(m => m.id === id).map(m => `${m.to.q},${m.to.r}`))] }])),
    maxExactPositionVisits: Math.max(...positionCounts.values()), snapshots, lastQuietStart: quietStart
  });
}
await fs.writeFile(root + '/positions-and-opportunities.json', JSON.stringify({ protocol: data.protocol, reports }, null, 2));
for (const report of reports) console.log(JSON.stringify({ ...report, deathTimeline: undefined, snapshots: undefined, lastQuietStart: undefined, captureOpportunitiesLast50: report.captureOpportunitiesLast50.map(o => ({ beforePly: o.beforePly, team: o.team, capturing: o.capturing.length, chosenEnemyDeaths: o.chosenEnemyDeaths })) }, null, 2));
