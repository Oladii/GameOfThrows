import { analyze, distance, isLethalDamage, move, pass, reachable, shieldCanRetreat, validateConfig, validateState } from './engine.js';

// This search follows the production rules. It ranks all legal moves, keeps a
// small beam, then looks four half-moves ahead by default. No game rules or
// outcomes are invented for the UI: repetition is only a search preference.
const PIECE_VALUES = { shield: 4, archer: 4, attackLamp: 7, defenseLamp: 5, scoutLamp: 5 };
const ROOT_BEAM = 8, REPLY_BEAM = 3, WIN_SCORE = 1e7;

export function botPositionKey(state, config) {
  return `${state.turn}|${state.pieces.map(p => `${p.team}:${p.type}:${p.q},${p.r}:${shieldCanRetreat(p, config) ? 1 : 0}`).sort().join('|')}`;
}

function tieNoise(seed, ply, action) {
  const text = `${seed}:${ply}:${action.pass ? 'pass' : `${action.type}:${action.from.q},${action.from.r}:${action.to.q},${action.to.r}`}`;
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) / 4294967296) * .001;
}

function alphaBeta(node, remaining, alpha, beta, context) {
  context.visit(remaining);
  if (remaining === 0 || node.terminal) return node.immediate;
  const children = context.children(node);
  if (!children.length) return node.immediate;
  const maximizing = node.outcome.state.turn === context.team;
  let value = maximizing ? -Infinity : Infinity;
  for (const child of children) {
    const score = alphaBeta(child, remaining - 1, alpha, beta, context);
    value = maximizing ? Math.max(value, score) : Math.min(value, score);
    if (maximizing) alpha = Math.max(alpha, value); else beta = Math.min(beta, value);
    if (beta <= alpha) break;
  }
  return value;
}

// Optimistic attacking bound, intentionally ignoring range, blockers, and
// formation. It prevents scoring defensive auras that cannot protect anything.
function damageBound(state, config, team) {
  const own = state.pieces.filter(p => p.team === team);
  const flags = own.filter(p => p.type === 'attackLamp').length;
  const shields = own.filter(p => p.type === 'shield').length;
  const archers = own.filter(p => p.type === 'archer').length;
  return own.reduce((sum, p) => sum + config.stats[p.type].damage
    + flags * config.stats.attackLamp.damageBonus
    - (p.type === 'attackLamp' ? config.stats.attackLamp.damageBonus : 0)
    + shields * config.shieldPromotion.damageBonus
    + (archers - (p.type === 'archer' ? 1 : 0)) * config.stats.archer.damageBonus, 0);
}

function evaluate(state, report, config, team, repeated) {
  if (state.winner === team) return WIN_SCORE - state.ply;
  // The bot seeks a real win: a draw is undesirable for either side. This
  // evaluation never changes the engine's winner or stops the actual game.
  if (state.winner !== null || repeated) return -WIN_SCORE + state.ply;
  const teams = [0, 1].map(t => state.pieces.filter(p => p.team === t));
  const bounds = [0, 1].map(t => damageBound(state, config, t));
  const scores = [0, 0];
  for (const piece of state.pieces) {
    const info = report.get(piece.id), own = teams[piece.team], enemies = teams[1 - piece.team];
    const enemyBound = bounds[1 - piece.team];
    scores[piece.team] += 100 * PIECE_VALUES[piece.type];
    if (info.dead) scores[piece.team] -= 30 * PIECE_VALUES[piece.type];
    const usefulDefense = Math.min(info.defenseBonus, Math.max(0, enemyBound - config.stats[piece.type].fortitude + (enemyBound > 0 ? 1 : 0)));
    scores[piece.team] += (info.damage > 0 && info.range > 0 ? info.damageBonus : 0) * 3 + usefulDefense * 3
      + (piece.type === 'archer' ? info.rangeBonus * 2 : 0);
    if (shieldCanRetreat(piece, config)) scores[piece.team] += 15;
    scores[1 - piece.team] += Math.min(info.incoming / Math.max(1, info.fortitude), 1) * 4;
    if (info.damage > 0 && info.range > 0 && enemies.length) {
      const chase = Math.min(...enemies.map(target => distance(piece, target, config)
        / (target.type === 'shield' || target.type === 'attackLamp' || target.type === 'defenseLamp' || target.type === 'scoutLamp' ? 1 : 1.4)));
      const comfort = piece.type === 'archer' ? 2 : 1, finishing = enemies.length <= 2 ? 3 : 1;
      scores[piece.team] -= finishing * Math.max(0, chase - comfort) * (piece.type === 'shield' ? 2 : 1.4);
      if (piece.type === 'archer' && chase < 2) scores[piece.team] -= 2;
    }
    if (piece.type === 'archer' && piece.group != null && isLethalDamage(enemyBound, config.stats.archer.fortitude)) {
      for (const guard of own.filter(p => p.type === 'shield' && p.group === piece.group)) {
        scores[piece.team] += Math.max(0, 4 - distance(piece, guard, config)) * 2;
      }
    }
    if (piece.type === 'defenseLamp' && own.some(p => isLethalDamage(enemyBound, config.stats[p.type].fortitude))) {
      const guards = own.filter(p => p.type === 'shield');
      if (guards.length) scores[piece.team] -= Math.min(...guards.map(p => distance(p, piece, config))) * .4;
    }
  }
  return scores[team] - scores[1 - team];
}

/**
 * Pure browser/worker entry point. Options are structured-cloneable:
 * {depth: 2..4, seed, previousStates: [State, ...],
 *  seenPositions: [[positionKey,count]],
 *  lastActions: [[pieceId,{from:{q,r},to:{q,r}}]]}.
 * A null action means a finished game or no legal action. Passing is offered
 * only if all movement is blocked and the configured rules permit a pass.
 */
export function chooseBotAction(inputState, inputConfig, options = {}) {
  const started = performance.now(), config = validateConfig(inputConfig), state = validateState(inputState, config);
  const depth = options.depth ?? 4, seed = options.seed ?? 17001;
  if (!Number.isInteger(depth) || depth < 2 || depth > 4) throw new Error('Глубина бота должна быть от 2 до 4 полуходов.');
  if (!Number.isFinite(seed)) throw new Error('Неверное начальное значение бота.');
  const seen = new Map(Array.isArray(options.seenPositions) ? options.seenPositions : []);
  const historicalCounts = new Map();
  for (const previous of Array.isArray(options.previousStates) ? options.previousStates : []) {
    const key = botPositionKey(previous, config);
    historicalCounts.set(key, (historicalCounts.get(key) || 0) + 1);
  }
  // Accept either format. Supplying both does not double-count the same history.
  for (const [key, count] of historicalCounts) seen.set(key, Math.max(seen.get(key) || 0, count));
  const lastActions = new Map(Array.isArray(options.lastActions) ? options.lastActions : []);
  const stats = { depth, maxDepth: 0, nodes: 0, visits: 0, legalMoves: 0, rootCandidates: 0, score: null, elapsedMs: 0 };
  const finish = (action, reason) => ({ action, stats: { ...stats, elapsedMs: performance.now() - started, ...(reason ? { reason } : {}) } });
  if (state.winner !== null) return finish(null, 'finished');
  const team = state.turn;
  const legalActions = position => {
    if (position.winner !== null) return [];
    const actions = position.pieces.filter(p => p.team === position.turn).flatMap(p => reachable(p, position, config)
      .map(to => ({ id: p.id, to: { q: to.q, r: to.r }, type: p.type, from: { q: p.q, r: p.r } })));
    return actions.length || !config.experiments.allowPass ? actions : [{ pass: true }];
  };
  const simulate = (position, action) => {
    stats.nodes++;
    const outcome = action.pass ? pass(position, config) : move(position, config, action.id, action.to);
    return { ...outcome, evaluationReport: outcome.deaths.length ? analyze(outcome.state, config) : outcome.report };
  };
  const actions = legalActions(state);
  stats.legalMoves = actions.length;
  if (!actions.length) return finish(null, 'no-legal-moves');
  const ranked = actions.map(action => {
    const outcome = simulate(state, action), key = botPositionKey(outcome.state, config), repetitions = seen.get(key) || 0;
    const previous = !action.pass && lastActions.get(action.id);
    const reverse = previous && previous.from.q === action.to.q && previous.from.r === action.to.r;
    const penalty = repetitions * 18 + (reverse ? 8 : 0);
    const immediate = evaluate(outcome.state, outcome.evaluationReport, config, team, repetitions >= 2);
    return { action, outcome, penalty, immediate, terminal: outcome.state.winner !== null || repetitions >= 2,
      rank: immediate - penalty + tieNoise(seed, state.ply, action) };
  }).sort((a, b) => b.rank - a.rank);
  const beam = ranked.slice(0, ROOT_BEAM);
  // Every unit retains its best candidate. Ordinary shields also retain one
  // forward move, avoiding accidental exclusion of slow promotion plans.
  for (const piece of state.pieces.filter(p => p.team === team)) {
    if (!beam.some(n => n.action.id === piece.id)) {
      const candidate = ranked.find(n => n.action.id === piece.id);
      if (candidate) beam.push(candidate);
    }
    if (piece.type === 'shield' && !shieldCanRetreat(piece, config)) {
      const forward = ranked.find(n => n.action.id === piece.id && (n.action.to.r - piece.r) * (piece.team === 0 ? 1 : -1) > 0);
      if (forward && !beam.includes(forward)) beam.push(forward);
    }
  }
  stats.rootCandidates = beam.length;
  const context = {
    team,
    visit: remaining => { stats.visits++; stats.maxDepth = Math.max(stats.maxDepth, depth - remaining); },
    children: node => {
      const position = node.outcome.state, maximizing = position.turn === team;
      return legalActions(position).map(action => {
        const outcome = simulate(position, action), key = botPositionKey(outcome.state, config);
        const pathKeys = [...node.pathKeys, key];
        const repeated = (seen.get(key) || 0) + pathKeys.filter(k => k === key).length >= 3;
        return { action, outcome, pathKeys, terminal: outcome.state.winner !== null || repeated,
          immediate: evaluate(outcome.state, outcome.evaluationReport, config, team, repeated) };
      }).sort((a, b) => maximizing ? b.immediate - a.immediate : a.immediate - b.immediate).slice(0, REPLY_BEAM);
    }
  };
  let best = null, bestScore = -Infinity;
  for (const candidate of beam) {
    const node = { ...candidate, pathKeys: [botPositionKey(candidate.outcome.state, config)] };
    const bonus = candidate.immediate * .00001 + tieNoise(seed, state.ply, candidate.action);
    const score = alphaBeta(node, depth - 1, bestScore + candidate.penalty - bonus, Infinity, context) - candidate.penalty + bonus;
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  stats.score = bestScore;
  return finish(best.action.pass ? { pass: true } : { id: best.action.id, to: best.action.to });
}
