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
  return scores[team] - scores[1 - team] + coordinationPressure(state, report, team) - coordinationPressure(state, report, 1 - team);
}

function coordinationPressure(state, report, attackingTeam) {
  const targets = state.pieces.filter(p => p.team !== attackingTeam).map(p => {
    const info = report.get(p.id), attackers = info.attackers;
    if (!attackers.length || info.incoming <= 0) return 0;
    const fraction = Math.min(.98, info.incoming / Math.max(1, info.fortitude));
    return 90 * fraction * fraction + 12 * Math.max(0, attackers.length - 1);
  }).sort((a, b) => b - a);
  return (targets[0] || 0) + .3 * (targets[1] || 0);
}


function coordinationRoutes(state, config) {
  if(state.pieces.length>18)return[];
  const plans=[];
  for(const team of[0,1]){
    const runners=[];
    for(const runner of state.pieces.filter(p=>p.team===team&&p.type==='shield'&&!shieldCanRetreat(p,config))){
      const cell=p=>p.q+','+p.r,start=cell(runner),queue=[{q:runner.q,r:runner.r}],nodes=new Map([[start,{position:runner,neighbors:[],parent:null,depth:0}]]);
      let goal=null;const goals=[];
      for(let i=0;i<queue.length;i++){
        const here=queue[i],entry=nodes.get(cell(here));
        const virtual={...state,pieces:state.pieces.map(p=>p.id===runner.id?{...p,...here}:p)},piece=virtual.pieces.find(p=>p.id===runner.id);
        if(shieldCanRetreat(piece,config)){const report=analyze(virtual,config),benefit=virtual.pieces.filter(p=>p.team!==team&&report.get(p.id).dead).reduce((sum,p)=>sum+PIECE_VALUES[p.type],0);goals.push({cell:cell(here),depth:entry.depth,benefit});continue;}
        for(const to of reachable(piece,virtual,config)){
          const candidate={...virtual,pieces:virtual.pieces.map(p=>p.id===runner.id?{...p,q:to.q,r:to.r,...(to.reachedFarEdge?{reachedFarEdge:true}:{})}:p)},report=analyze(candidate,config);
          if(candidate.pieces.some(p=>p.team===team&&report.get(p.id).dead))continue;
          const next=cell(to);entry.neighbors.push(next);
          if(!nodes.has(next)){nodes.set(next,{position:{q:to.q,r:to.r},neighbors:[],parent:cell(here),depth:entry.depth+1});queue.push({q:to.q,r:to.r});}
        }
      }
      if(!goals.length)continue;const shortest=Math.min(...goals.map(g=>g.depth));goals.sort((a,b)=>b.benefit-a.benefit||a.depth-b.depth||a.cell.localeCompare(b.cell));goal=goals.find(g=>g.depth<=shortest+1).cell;
      const path=[];for(let at=goal;at!==null;at=nodes.get(at).parent)path.push(nodes.get(at).position);path.reverse();
      // Remaining graph distances are computed only on this discovered safe
      // route corridor. Unknown cells earn no progress reward.
      const remaining=new Map(path.map((p,i)=>[cell(p),path.length-1-i]));
      runners.push({team,id:runner.id,distance:path.length-1,next:path[1],path,remaining});
    }
    runners.sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));if(runners[0])plans.push(runners[0]);
  }
  return plans;
}


/**
 * Pure browser/worker entry point. Options are structured-cloneable:
 * {depth: 2..4, seed, previousStates: [State, ...],
 *  seenPositions: [[positionKey,count]],
 *  lastActions: [[pieceId,{from:{q,r},to:{q,r}}]]}.
 * Small endings extend the easy planning horizon to three half-moves.
 * A bounded one-enemy probe reports a forced win only with every reply covered.
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
  const finish = (action, reason) => ({ action: action === null ? null : action.pass ? { pass: true } : { id: action.id, to: { q: action.to.q, r: action.to.r } }, stats: { ...stats, elapsedMs: performance.now() - started, ...(reason ? { reason } : {}) } });
  if (state.winner !== null) return finish(null, 'finished');
  const team = state.turn;
  // A preparation in a small ending needs its own follow-up after the
  // opponent reply. The easy level keeps depth 2 on a full board.
  const searchDepth = depth === 2 && state.pieces.length <= 12 ? 3 : depth;
  stats.planningDepth = searchDepth;
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
  const plans = coordinationRoutes(state, config);
  stats.strategicPlans = plans.map(({team,id,distance,next,path}) => ({team,id,distance,next,path}));
  const evaluateFor = (position, report, rules, perspective, repeated) => {
    const score = evaluate(position, report, rules, perspective, repeated);
    if (Math.abs(score) >= 1e6) return score;
    let progress = 0;
    for (const plan of plans) {
      const p = position.pieces.find(p => p.id === plan.id);
      const remaining = p && plan.remaining.get(p.q + ',' + p.r);
      const value = !p ? -240 : shieldCanRetreat(p, rules) ? Math.min(240, 30 * (plan.distance + 1))
        : remaining === undefined ? 0 : 30 * (plan.distance - remaining);
      progress += (plan.team === perspective ? 1 : -1) * value;
    }
    return score + progress;
  };
  const actions = legalActions(state);
  stats.legalMoves = actions.length;
  if (!actions.length) return finish(null, 'no-legal-moves');
  const ranked = actions.map(action => {
    const outcome = simulate(state, action), key = botPositionKey(outcome.state, config), repetitions = seen.get(key) || 0;
    const previous = !action.pass && lastActions.get(action.id);
    const reverse = previous && previous.from.q === action.to.q && previous.from.r === action.to.r;
    const penalty = repetitions * 18 + (reverse ? 8 : 0);
    const immediate = evaluateFor(outcome.state, outcome.evaluationReport, config, team, repetitions >= 2);
    return { action, outcome, penalty, immediate, terminal: outcome.state.winner !== null || repetitions >= 2,
      rank: immediate - penalty + tieNoise(seed, state.ply, action) };
  }).sort((a, b) => b.rank - a.rank);
  // A certificate checks every legal enemy reply and an actual winning
  // continuation. An incomplete bounded probe never claims a forced win.
  // Two identical unblocked veterans attack each other symmetrically. If
  // their equal damage reaches their equal fortitude, every possible capture
  // is mutual: neither side can ever win alone. Approach an actual exchange
  // rather than reject the best attainable result as though a win existed.
  const veteranPair = state.pieces.length === 2 && state.pieces[0].team !== state.pieces[1].team && state.pieces.every(p => shieldCanRetreat(p, config));
  if (veteranPair) {
    const powers = [...analyze(state, config).values()];
    const equal = ['damage', 'range', 'fortitude'].every(k => powers[0][k] === powers[1][k]);
    if (equal && powers[0].damage > 0 && powers[0].range > 0 && powers[0].damage >= powers[0].fortitude) {
      const gap = node => node.outcome.state.pieces.length === 2 ? distance(...node.outcome.state.pieces, config) : 0;
      const exchange = ranked.find(n => n.outcome.state.winner === 'draw') || [...ranked].sort((a, b) => gap(a) - gap(b) || b.rank - a.rank)[0];
      stats.score = 0; stats.maxDepth = 1; stats.drawOnlyPosition = true;
      return finish(exchange.action, 'symmetric-veteran-draw');
    }
  }
  const direct = ranked.find(n => n.outcome.state.winner === team);
  if (direct) { stats.score = direct.immediate; return finish(direct.action); }
  stats.finishingNodes = 0; stats.finishingComplete = false;
  if (state.pieces.filter(p => p.team !== team).length === 1) {
    const startNodes = stats.nodes, probeLimit = depth === 2 ? 7000 : 14000;
    const cache = new Map(), STOP = {};
    const children = position => {
      const key = JSON.stringify(position);
      if (cache.has(key)) return cache.get(key);
      const nodes = [];
      for (const action of legalActions(position)) {
        if (stats.nodes - startNodes >= probeLimit) throw STOP;
        nodes.push({action, outcome:simulate(position, action)});
      }
      cache.set(key, nodes); return nodes;
    };
    try {
      for (const first of ranked) {
        const replies = children(first.outcome.state), certificate = [];
        let forced = replies.length > 0;
        for (const reply of replies) {
          if (reply.outcome.state.winner === team) { certificate.push({reply:reply.action, win:null}); continue; }
          if (reply.outcome.state.winner !== null) { forced = false; break; }
          const win = children(reply.outcome.state).find(n => n.outcome.state.winner === team);
          if (!win) { forced = false; break; }
          certificate.push({reply:reply.action, win:win.action});
        }
        if (forced) {
          stats.finishingNodes = stats.nodes - startNodes; stats.finishingComplete = true;
          stats.forcedWinReplies = certificate; stats.finishingDepth = 3;
          stats.maxDepth = Math.max(stats.maxDepth, 3); stats.score = WIN_SCORE - state.ply - 3;
          return finish(first.action, 'forced-win-three-ply');
        }
      }
      stats.finishingComplete = true;
    } catch (error) { if (error !== STOP) throw error; }
    stats.finishingNodes = stats.nodes - startNodes;
  }
  const beam = ranked.slice(0, ROOT_BEAM);
  // Every unit retains its best candidate. Ordinary shields also retain one
  // forward move, avoiding accidental exclusion of slow promotion plans.
  for (const piece of state.pieces.filter(p => p.team === team)) {
    if (!beam.some(n => n.action.id === piece.id)) {
      const candidate = ranked.find(n => n.action.id === piece.id);
      if (candidate) beam.push(candidate);
    }
    if ((piece.type === 'shield' && !shieldCanRetreat(piece, config)) || piece.type === 'archer') {
      const forward = ranked.find(n => n.action.id === piece.id && (n.action.to.r - piece.r) * (piece.team === 0 ? 1 : -1) > 0);
      if (forward && !beam.includes(forward)) beam.push(forward);
    }
  }
  for (const plan of plans.filter(p => p.team === team)) {
    const candidate = ranked.find(n => n.action.id === plan.id && n.action.to.q === plan.next?.q && n.action.to.r === plan.next?.r);
    if (candidate && !beam.includes(candidate)) beam.push(candidate);
  }
  stats.rootCandidates = beam.length;
  const context = {
    team,
    visit: remaining => { stats.visits++; stats.maxDepth = Math.max(stats.maxDepth, searchDepth - remaining); },
    children: node => {
      const position = node.outcome.state, maximizing = position.turn === team;
      return legalActions(position).map(action => {
        const outcome = simulate(position, action), key = botPositionKey(outcome.state, config);
        const pathKeys = [...node.pathKeys, key];
        const repeated = (seen.get(key) || 0) + pathKeys.filter(k => k === key).length >= 3;
        return { action, outcome, pathKeys, terminal: outcome.state.winner !== null || repeated,
          immediate: evaluateFor(outcome.state, outcome.evaluationReport, config, team, repeated) };
      }).sort((a, b) => maximizing ? b.immediate - a.immediate : a.immediate - b.immediate).slice(0, REPLY_BEAM);
    }
  };
  let best = null, bestScore = -Infinity;
  for (const candidate of beam) {
    const node = { ...candidate, pathKeys: [botPositionKey(candidate.outcome.state, config)] };
    const bonus = candidate.immediate * .00001 + tieNoise(seed, state.ply, candidate.action);
    const score = alphaBeta(node, searchDepth - 1, bestScore + candidate.penalty - bonus, Infinity, context) - candidate.penalty + bonus;
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  stats.score = bestScore;
  return finish(best.action.pass ? { pass: true } : { id: best.action.id, to: best.action.to });
}
