import { oneReplySafety } from './defensive-selection.mjs';
import { analyze, cells, effective, attacks, isRay, distance, isLethalDamage, move, pass, reachable, shieldCanRetreat, archerHasEdgeBonus, validateConfig, validateState } from './engine.js';
export function createStrategyPolicy(PLAN){
if(!['formation','ranged','veteran'].includes(PLAN))throw Error('Unknown plan');
const key=p=>`${p.q},${p.r}`;
const edge=(p,c)=>c.geometry==='hex'?(p.team===0?c.size:-c.size):(p.team===0?c.size-1:0);
function buildRoute(state,config,runner) {
 const occupied=new Map(state.pieces.filter(p=>p.id!==runner.id).map(p=>[key(p),p]));
 const spots=cells(config).filter(p=>!occupied.has(key(p)));
 const enemies=state.pieces.filter(p=>p.team!==runner.team).map(p=>({piece:p,stats:effective(p,state,config),positions:[p,...reachable(p,{...state,turn:p.team},config)]}));
 const hazards=new Map(),graph=new Map();
 function hazard(cell,promoted=false){const id=key(cell)+':'+promoted;if(hazards.has(id))return hazards.get(id);
  const placed={...runner,q:cell.q,r:cell.r,...(promoted?{reachedFarEdge:true}:{})};
  const s={...state,pieces:state.pieces.map(p=>p.id===runner.id?placed:p)};const stats=effective(placed,s,config);
  let incoming=0,extra=0;
  for(const e of enemies){const current=attacks(e.piece,placed,s,config,e.stats);if(current)incoming+=e.stats.damage;
   // Upper estimate for a single enemy move: ignores future blockers/aura changes.
   if(!current&&e.stats.damage>0&&e.positions.some(p=>distance(p,placed,config)<=e.stats.range&&isRay(p,placed,config)))extra=Math.max(extra,e.stats.damage);
  }
  const direct=incoming/Math.max(1,stats.fortitude),projected=(incoming+extra)/Math.max(1,stats.fortitude);
  const result={cost:1+2*direct+1.5*projected+(direct>=1?8:0),incoming,projectedIncoming:incoming+extra,fortitude:stats.fortitude};hazards.set(id,result);return result;
 }
 for(const cell of spots){const placed={...runner,q:cell.q,r:cell.r},s={...state,pieces:state.pieces.map(p=>p.id===runner.id?placed:p)};const edges=[];
  if(cell.r===edge(runner,config)){graph.set(key(cell),[{to:'goal',cost:0}]);continue;}
  for(const to of reachable(placed,s,config)){const promoted=!!to.reachedFarEdge||to.r===edge(runner,config);edges.push({to:promoted?'goal':key(to),cost:hazard(to,promoted).cost});}
  graph.set(key(cell),edges);
 }
 const costs=new Map([['goal',0]]),next=new Map(),reverse=new Map();
 for(const [from,edges] of graph)for(const e of edges){if(!reverse.has(e.to))reverse.set(e.to,[]);reverse.get(e.to).push({from,cost:e.cost});}
 const pending=new Set(['goal']);while(pending.size){const current=[...pending].reduce((a,b)=>costs.get(a)<=costs.get(b)?a:b);pending.delete(current);for(const e of reverse.get(current)||[]){const value=costs.get(current)+e.cost;if(value<(costs.get(e.from)??Infinity)){costs.set(e.from,value);next.set(e.from,current);pending.add(e.from);}}}
 return {runnerId:runner.id,team:runner.team,costs,next,startCost:costs.get(key(runner))??Infinity,hazards};
}

function strategyBonus(state,report,config,team) {
 const own=state.pieces.filter(p=>p.team===team),enemies=state.pieces.filter(p=>p.team!==team),shields=own.filter(p=>p.type==='shield'),archers=own.filter(p=>p.type==='archer');
 const sign=team===0?1:-1;let value=0;
 if(PLAN==='formation') {
  for(const p of shields){
   const guards=shields.filter(q=>q.id!==p.id&&distance(p,q,config)<=1),power=report.get(p.id);
   value+=6*guards.length+6*Math.min(2,power.defenseBonus);
   if(guards.length||power.sources.some(id=>own.find(q=>q.id===id)?.type==='defenseLamp')){ /* Covered shields retain their guard/defense reward, without a forward reward. */ }
   else if(shields.length>1)value-=22;
  }
  for(const p of archers){
   if(shields.some(q=>distance(p,q,config)<=1))value+=8*Math.min(3,Math.max(0,p.r*sign+3));
   const covered=enemies.some(e=>{const power=report.get(e.id);if(power.damage<=0||distance(e,p,config)>power.range||!isRay(e,p,config)||attacks(e,p,state,config,power))return false;
    return shields.some(q=>q.id!==p.id&&isRay(e,q,config)&&distance(e,q,config)<distance(e,p,config)&&distance(e,q,config)+distance(q,p,config)===distance(e,p,config));});
   if(covered)value+=16;
  }
 } else if(PLAN==='ranged') {
  const targets=enemies.map(p=>{const hit=report.get(p.id),shots=hit.attackers.filter(a=>a.type==='archer'),damage=shots.reduce((s,a)=>s+a.damage,0);return 80*Math.min(1,damage/Math.max(1,hit.fortitude))**2+12*Math.max(0,shots.length-1);}).sort((a,b)=>b-a);
  value+=(targets[0]||0)+.4*(targets[1]||0);
  for(const p of archers){const power=report.get(p.id);if(power.sources.some(id=>{const source=own.find(q=>q.id===id);return ['attackLamp','horn'].includes(source?.type)&&(config.stats[source.type]?.damageBonus??0)>0;}))value+=10;if(power.sources.some(id=>own.find(q=>q.id===id)?.type==='scoutLamp'))value+=5;
   if(archers.some(q=>q.id!==p.id&&distance(p,q,config)<=2))value+=8;
  }
 }
 return Math.max(-180,Math.min(300,value));
}
function veteranPriorityRoutes(state,config){
 const plans=[];
 for(const team of [0,1]){
  if(state.pieces.some(p=>p.team===team&&shieldCanRetreat(p,config)))continue;
  const candidates=[];
  for(const runner of state.pieces.filter(p=>p.team===team&&p.type==='shield')){
   const guide=buildRoute(state,config,runner);if(!Number.isFinite(guide.startCost))continue;
   const path=[{q:runner.q,r:runner.r}];let current=key(runner);
   for(let step=0;step<100;step++){
    const next=guide.next.get(current);if(!next)break;
    if(next==='goal'){
     const here=path.at(-1),placed={...runner,...here},position={...state,pieces:state.pieces.map(p=>p.id===runner.id?placed:p)};
     if(!shieldCanRetreat(placed,config)){
      const ends=reachable(placed,position,config).filter(p=>shieldCanRetreat({...placed,...p},config));
      ends.sort((a,b)=>(guide.hazards.get(key(a)+':true')?.cost??0)-(guide.hazards.get(key(b)+':true')?.cost??0));
      if(ends[0])path.push({q:ends[0].q,r:ends[0].r});
     }break;
    }
    const [q,r]=next.split(',').map(Number);path.push({q,r});current=next;
   }
   if(path.length<2||!shieldCanRetreat({...runner,...path.at(-1)},config))continue;
   candidates.push({team,id:runner.id,distance:path.length-1,path,next:path[1],cost:guide.startCost,progress:runner.r*(team===0?1:-1),remaining:new Map(path.map((p,i)=>[key(p),path.length-1-i]))});
  }
  candidates.sort((a,b)=>b.progress-a.progress||a.cost-b.cost||a.distance-b.distance||a.id.localeCompare(b.id));if(candidates[0])plans.push(candidates[0]);
 }
 return plans;
}

// This search follows the production rules. It ranks all legal moves, keeps a
// small beam, then looks four half-moves ahead by default. No game rules or
// outcomes are invented for the UI: repetition is only a search preference.
const PIECE_VALUES = PLAN === 'formation' ? {shield:6,archer:3,attackLamp:6,horn:6,defenseLamp:5,scoutLamp:4} : {shield:4,archer:4,attackLamp:7,horn:7,defenseLamp:5,scoutLamp:5};
const ROOT_BEAM = 8, REPLY_BEAM = 3, WIN_SCORE = 1e7;

function botPositionKey(state, config) {
  return `${state.turn}|${state.pieces.map(p => `${p.team}:${p.type}:${p.q},${p.r}:${shieldCanRetreat(p, config) ? 1 : 0}${archerHasEdgeBonus(p, config) ? ':a1' : ''}`).sort().join('|')}`;
}

function tieNoise(seed, ply, action) {
  const text = `${seed}:${ply}:${action.pass ? 'pass' : `${action.type}:${action.from.q},${action.from.r}:${action.to.q},${action.to.r}`}`;
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) / 4294967296) * .001;
}

// A separate position-based roll leaves ordinary search and tie-breaking intact.
// The same position, ply and seed reproduce the same teaching decision.
function forgivenessRoll(state, config, seed) {
  let hash = 2166136261;
  for (const char of `${seed}:${state.ply}:${botPositionKey(state, config)}:forgive`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ hash >>> 16, 0x21f0aaad);
  hash = Math.imul(hash ^ hash >>> 15, 0x735a2d97);
  return ((hash ^ hash >>> 15) >>> 0) / 4294967296;
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
  const horns = own.filter(p => p.type === 'horn').length;
  const shields = own.filter(p => p.type === 'shield').length;
  const archers = own.filter(p => p.type === 'archer').length;
  return own.reduce((sum, p) => sum + config.stats[p.type].damage
    + flags * config.stats.attackLamp.damageBonus
    - (p.type === 'attackLamp' ? config.stats.attackLamp.damageBonus : 0)
    + horns * (config.stats.horn?.damageBonus ?? 0)
    - (p.type === 'horn' ? (config.stats.horn?.damageBonus ?? 0) : 0)
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
    if (shieldCanRetreat(piece, config)) scores[piece.team] += PLAN === 'veteran' ? 110 : 15;
    scores[1 - piece.team] += Math.min(info.incoming / Math.max(1, info.fortitude), 1) * 4;
    if (info.damage > 0 && info.range > 0 && enemies.length) {
      const chase = Math.min(...enemies.map(target => distance(piece, target, config)
        / (target.type === 'shield' || target.type === 'attackLamp' || target.type === 'defenseLamp' || target.type === 'scoutLamp' || target.type === 'horn' ? 1 : 1.4)));
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
  return scores[team] - scores[1 - team] + coordinationPressure(state, report, team) - coordinationPressure(state, report, 1 - team) + strategyBonus(state, report, config, team) - strategyBonus(state, report, config, 1 - team);
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
  if(PLAN==='veteran')return veteranPriorityRoutes(state,config);
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
 * {depth: 2..4, seed, forgiving: boolean, previousStates: [State, ...],
 *  seenPositions: [[positionKey,count]],
 *  lastActions: [[pieceId,{from:{q,r},to:{q,r}}]]}.
 * Small endings extend the easy planning horizon to three half-moves.
 * A bounded one-enemy probe reports a forced win only with every reply covered.
 * A null action means a finished game or no legal action. Passing is offered
 * only if all movement is blocked and the configured rules permit a pass.
 */
function chooseBotAction(inputState, inputConfig, options = {}) {
  const started = performance.now(), config = validateConfig(inputConfig), state = validateState(inputState, config);
  const adviceDiversity = options.adviceDiversity === true;
  const forgiving = options.forgiving === true && !adviceDiversity;
  const choiceSeed = options.seed ?? 17001;
  // Randomness chooses from the shortlist; it never changes the search or its beam.
  const depth = options.depth ?? 4, seed = adviceDiversity ? 17001 : choiceSeed;
  if (!Number.isInteger(depth) || depth < 2 || depth > 4) throw new Error('Глубина бота должна быть от 2 до 4 полуходов.');
  if (!Number.isFinite(choiceSeed)) throw new Error('Неверное начальное значение бота.');
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
  if (forgiving) stats.forgiveness = { applied: false, considered: false, probability: .8, candidates: 0, replies: 0 };
  const showcaseCandidates = [];
  const publicAction = action => action === null ? null : action.pass ? { pass: true } : { id: action.id, to: { q: action.to.q, r: action.to.r } };
  const finish = (action, reason) => ({ action: publicAction(action), stats: { ...stats, elapsedMs: performance.now() - started, ...(reason ? { reason } : {}) },
    ...(options.showcaseCandidates ? { candidates: [...showcaseCandidates].sort((a, b) => b.score - a.score).slice(0, 8).map(entry => publicAction(entry.action)) } : {}) });
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
      const value = !p ? -240 : shieldCanRetreat(p, rules) ? Math.min(300, (PLAN === 'veteran' ? 55 : 30) * (plan.distance + 1))
        : remaining === undefined ? 0 : (PLAN === 'veteran' ? 55 : 30) * (plan.distance - remaining);
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
  const adviceScores = new Map();
  let best = null, bestScore = -Infinity;
  for (const candidate of beam) {
    const node = { ...candidate, pathKeys: [botPositionKey(candidate.outcome.state, config)] };
    const bonus = adviceDiversity ? 0 : candidate.immediate * .00001 + tieNoise(seed, state.ply, candidate.action);
    const score = alphaBeta(node, searchDepth - 1, adviceDiversity ? -Infinity : bestScore + candidate.penalty - bonus, Infinity, context) - candidate.penalty + bonus;
    if (options.showcaseCandidates) showcaseCandidates.push({ action: candidate.action, score });
    if (adviceDiversity) adviceScores.set(candidate, score);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  if (PLAN === 'formation') {
    // Beam search ranks tactics, but it cannot certify that an omitted enemy
    // reply does not win immediately. Check the chosen move natively, then
    // rescue every safe root regardless of its static rank when necessary.
    const startNodes = stats.nodes;
    const checked = new Map();
    const inspect = candidate => {
      if (!checked.has(candidate)) checked.set(candidate, oneReplySafety(candidate.outcome.state, team, legalActions, simulate));
      return checked.get(candidate);
    };
    const selected = inspect(best);
    stats.defense = { checked: 1, fallback: !selected.safe, selectedBefore: selected.status, candidates: 0, oldBeamCandidates: beam.length, addedBeyondOldBeam: [], selectedOutsideOldBeam: !beam.includes(best), status: selected.status };
    if (!selected.safe) {
      const safe = ranked.filter(candidate => inspect(candidate).safe);
      stats.defense.checked = checked.size;
      stats.defense.candidates = safe.length;
      stats.defense.addedBeyondOldBeam = safe.filter(candidate => !beam.includes(candidate)).map(candidate => ({ action: candidate.action.pass ? {pass:true} : {id:candidate.action.id,to:candidate.action.to}, rank:ranked.indexOf(candidate)+1, status:inspect(candidate).status }));
      if (safe.length) {
        // All certified alternatives enter deep search. Do not prune them by
        // root rank or a node budget, and do not retain a losing incumbent.
        stats.rootCandidates = new Set([...beam, ...safe]).size;
        best = null; bestScore = -Infinity;
        for (const candidate of safe) {
          const node = { ...candidate, pathKeys: [botPositionKey(candidate.outcome.state, config)] };
          const bonus = adviceDiversity ? 0 : candidate.immediate * .00001 + tieNoise(seed, state.ply, candidate.action);
          const score = alphaBeta(node, searchDepth - 1, adviceDiversity ? -Infinity : bestScore + candidate.penalty - bonus, Infinity, context) - candidate.penalty + bonus;
          if (options.showcaseCandidates) showcaseCandidates.push({ action: candidate.action, score });
          if (adviceDiversity) adviceScores.set(candidate, score);
          if (score > bestScore) { best = candidate; bestScore = score; }
        }
        stats.defense.status = inspect(best).status;
        stats.defense.selectedSafeRank = ranked.indexOf(best) + 1;
        stats.defense.selectedOutsideOldBeam = !beam.includes(best);
      } else {
        // Exhaustion proves only that every root allows a terminal enemy win
        // within one reply; it says nothing about deeper minimax play.
        stats.defense.status = 'no-safe-root';
      }
    }
    if (adviceDiversity) {
      // Eight points is a small positional difference: the cheapest unit costs 300.
      // Only exact full-window root scores can enter this comparison.
      const maxGap = 8, pool = [];
      if (Math.abs(bestScore) < 1e6 && stats.defense.status !== 'no-safe-root') {
        for (const [candidate, score] of [...adviceScores].sort((a, b) => b[1] - a[1])) {
          if (score > bestScore + 1e-8 || bestScore - score > maxGap) continue;
          if (!inspect(candidate).safe) continue;
          pool.push({ candidate, score });
          if (pool.length === 4) break;
        }
      }
      if (!pool.length) pool.push({ candidate: best, score: bestScore });
      let random = (choiceSeed >>> 0) + 0x9e3779b9;
      random = Math.imul(random ^ random >>> 16, 0x21f0aaad);
      random = Math.imul(random ^ random >>> 15, 0x735a2d97);
      random = (random ^ random >>> 15) >>> 0;
      const selected = pool[Math.floor(random / 4294967296 * pool.length)];
      stats.adviceDiversity = { candidates: pool.length, maxGap, bestScore,
        selectedScore: selected.score, gap: bestScore - selected.score,
        options: pool.map(item => ({ action: item.candidate.action.pass ? { pass: true } : { id: item.candidate.action.id, to: item.candidate.action.to }, score: item.score })) };
      best = selected.candidate; bestScore = selected.score;
      stats.defense.status = stats.defense.status === 'no-safe-root' ? 'no-safe-root' : inspect(best).status;
      stats.defense.selectedSafeRank = ranked.indexOf(best) + 1;
      stats.defense.selectedOutsideOldBeam = !beam.includes(best);
      stats.defense.checked = checked.size;
    }
    if (forgiving && Math.abs(bestScore) < 1e6 && stats.defense.status !== 'no-safe-root') {
      // A considerate opponent keeps its tactical knowledge and defence, but
      // often declines an attack. It becomes gentler when ahead or just after
      // the learner lost a piece. Immediate/proven wins already returned above.
      const captured = best.outcome.deaths.filter(piece => piece.team !== team);
      const info = stats.forgiveness;
      const material = side => state.pieces.filter(piece => piece.team === side)
        .reduce((sum, piece) => sum + 100 * PIECE_VALUES[piece.type], 0);
      info.materialLead = material(team) - material(1 - team);
      const recent = Array.isArray(options.previousStates) ? options.previousStates : [];
      info.recentOpponentLoss = recent.some(previous => previous.ply < state.ply
        && state.ply - previous.ply <= 4 && previous.pieces.some(piece => piece.team !== team
          && !state.pieces.some(current => current.id === piece.id)));
      info.probability = info.recentOpponentLoss ? 1 : info.materialLead >= 300 ? .95 : .8;
      const pressure = candidate => coordinationPressure(candidate.outcome.state, candidate.outcome.evaluationReport, team);
      info.pressureBefore = pressure(best);
      info.roll = forgivenessRoll(state, config, choiceSeed);
      if ((captured.length || info.pressureBefore > 8) && info.roll < info.probability) {
        info.considered = true;
        // Give up an opportunity, not our pieces: at most 600 material points
        // and 80 positional points, with every immediate enemy reply checked.
        info.maxGap = Math.min(600, captured.reduce((sum, piece) => sum + 100 * PIECE_VALUES[piece.type], 0)) + 80;
        info.bestScore = bestScore;
        const quiet = ranked.filter(candidate => candidate !== best && !candidate.terminal
          && !candidate.action.pass && candidate.penalty === 0 && candidate.outcome.deaths.length === 0
          && (captured.length || pressure(candidate) < info.pressureBefore - 4)).slice(0, ROOT_BEAM * 3);
        let alternative = null, alternativeScore = -Infinity, alternativePressure = Infinity;
        for (const candidate of quiet) {
          info.candidates++;
          const replies = legalActions(candidate.outcome.state);
          if (!replies.length) continue;
          let safe = true;
          for (const action of replies) {
            const reply = simulate(candidate.outcome.state, action); info.replies++;
            if (reply.state.winner === 1 - team || reply.state.winner === 'draw' || reply.deaths.some(piece => piece.team === team)) { safe = false; break; }
          }
          if (!safe) continue;
          checked.set(candidate, { safe: true, status: 'safe-one-reply', replies: replies.length });
          const node = { ...candidate, pathKeys: [botPositionKey(candidate.outcome.state, config)] };
          // Full-window search: a cutoff bound cannot measure how much worse
          // an alternative is than the ordinary move.
          const bonus = candidate.immediate * .00001 + tieNoise(seed, state.ply, candidate.action);
          const score = alphaBeta(node, searchDepth - 1, -Infinity, Infinity, context) - candidate.penalty + bonus;
          if (Math.abs(score) >= 1e6 || score > bestScore || bestScore - score > info.maxGap) continue;
          const candidatePressure = pressure(candidate);
          if (candidatePressure < alternativePressure || (candidatePressure === alternativePressure && score > alternativeScore)) {
            alternative = candidate; alternativeScore = score; alternativePressure = candidatePressure;
          }
        }
        if (alternative) {
          info.applied = true; info.skippedCaptures = captured.map(piece => piece.id);
          info.pressureAfter = alternativePressure;
          info.selectedScore = alternativeScore; info.gap = bestScore - alternativeScore;
          best = alternative; bestScore = alternativeScore;
          stats.defense.status = inspect(best).status;
          stats.defense.selectedSafeRank = ranked.indexOf(best) + 1;
          stats.defense.selectedOutsideOldBeam = !beam.includes(best);
        }
        stats.defense.checked = checked.size;
      }
    }
    stats.defense.nodes = stats.nodes - startNodes;
    stats.defense.replies = [...checked.values()].reduce((sum, result) => sum + result.replies, 0);
  }
  stats.score = bestScore;
  return finish(best.action.pass ? { pass: true } : { id: best.action.id, to: best.action.to });
}

return {chooseBotAction,botPositionKey};
}
