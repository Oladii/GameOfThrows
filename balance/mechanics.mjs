import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(process.argv.find(x=>x.startsWith('--root='))?.slice(7) || 'outputs/enemy-blocking-2026-11-13');
const load = (variant, name) => import(pathToFileURL(path.join(root,'source',variant,name)).href);
const C = await load('control','engine.js'), B = await load('enemy-blocking','engine.js');
const {DEFAULT_CONFIG,TYPES} = await load('control','rules.js');
const config = C.clone(DEFAULT_CONFIG), findings = [];
let checks = 0;
const check = (condition,message) => {assert.ok(condition,message);checks++;};
const equal = (a,b,message) => {assert.deepEqual(a,b,message);checks++;};
const p = (id,type,team,q,r,extra={}) => ({id,type,team,q,r,...extra});
const state = pieces => ({pieces,turn:0,ply:0,winner:null});
const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

// Independent ray walk: skip allies; the first enemy is the only hittable
// occupant on that ray. No production lineBetween/blocked/isRay is reused.
function oracle(attacker,target,s,c,stats) {
  if (attacker.id===target.id || attacker.team===target.team || stats.damage<=0) return false;
  for (const [dq,dr] of dirs) for (let n=1;n<=stats.range;n++) {
    const occupant=s.pieces.find(q=>q.q===attacker.q+dq*n && q.r===attacker.r+dr*n);
    if (!occupant || occupant.team===attacker.team) continue;
    if (occupant.id===target.id) return true;
    break;
  }
  return false;
}

for (const type of TYPES) for (const [dq,dr] of dirs) {
  const a=p('attacker','archer',0,0,0), block=p('block',type,1,dq,dr), target=p('target','defenseLamp',1,2*dq,2*dr);
  const s=state([a,block,target]);
  check(B.attacks(a,block,s,config),'first enemy must remain hittable');
  check(!B.attacks(a,target,s,config),'every enemy type must block in all six directions');
  equal(C.attacks(a,target,s,config),type!=='shield','control must retain its actual shield-only rule');
  for(const x of s.pieces) equal(B.effective(x,s,config),C.effective(x,s,config),'auras unchanged');
  block.team=0;
  check(B.attacks(a,target,s,config),'every allied type must pass shots');
  equal(B.attacks(a,target,s,config),C.attacks(a,target,s,config),'allied passage parity');
}
findings.push('All six unit types and six ray directions: enemies stop, allies pass; effects/auras unchanged.');

// A dying blocker absorbs the entire simultaneous volley; no immediate
// second combat pass is introduced when it is removed.
{
  const c=C.clone(config);c.stats.scoutLamp.damage=10;
  const a=p('a','scoutLamp',0,0,0), block=p('b','archer',1,1,0), flag=p('f','defenseLamp',1,2,0);
  const s=state([a,block,flag]), control=C.resolve(s,c), candidate=B.resolve(s,c);
  check(control.deaths.some(x=>x.id==='f'),'control reaches rear flag');
  check(candidate.deaths.some(x=>x.id==='b'),'candidate destroys first enemy');
  check(!candidate.deaths.some(x=>x.id==='f'),'dying blocker protects flag for whole calculation');
  equal(candidate.report.get('f').incoming,0,'no spill-through volley');
  equal(B.analyze(candidate.state,c).get('f').incoming,10,'line opens only for next calculation');
}
findings.push('Destroyed blocker protects the rear during the current simultaneous calculation; the line opens afterward.');

// Two independent firing rays still combine their damage on the first target.
{
  const a=p('a','archer',0,0,-2), b=p('b','archer',0,-2,0), target=p('t','archer',1,0,0);
  const s=state([a,b,target]), report=B.analyze(s,config);
  equal(report.get('t').incoming,4,'focus fire still adds different attackers');
  check(report.get('t').dead,'focus fire must kill 3-fortitude target');
}

// Deterministic generated positions supplement hand examples. Assertions are
// about invariants and an independent geometric oracle, not bot win rates.
let seed=917311;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const cells=C.cells(config);
for(let n=0;n<36;n++) {
  const available=[...cells], pieces=[];
  for(let i=0;i<18;i++) {
    const cell=available.splice(Math.floor(rand()*available.length),1)[0];
    const type=TYPES[i%TYPES.length], team=i%2;
    pieces.push(p('x'+i,type,team,cell.q,cell.r,type==='shield'&&i%3===0?{reachedFarEdge:true}:type==='archer'&&i%3===1?{archerReachedFarEdge:true}:{}));
  }
  const s=state(pieces), control=C.analyze(s,config), candidate=B.analyze(s,config);
  for(const a of pieces) {
    const stats=B.effective(a,s,config);
    equal(stats,C.effective(a,s,config),'all effective stats must remain unchanged');
    equal(B.reachable(a,s,config),C.reachable(a,s,config),'movement must remain unchanged');
    check(candidate.get(a.id).incoming<=control.get(a.id).incoming,'blocking can only remove incoming damage on the same board');
    for(const t of pieces) equal(B.attacks(a,t,s,config,stats),oracle(a,t,s,config,stats),'independent first-enemy oracle');
  }
}
findings.push('36 deterministic generated boards: independent first-enemy ray oracle, aura/movement parity and monotonic damage.');

const opening=[];
const legal=(E,s,c)=>s.winner!==null?[]:s.pieces.filter(p=>p.team===s.turn).flatMap(p=>E.reachable(p,s,c).map(to=>({id:p.id,to:{q:to.q,r:to.r}})));
const pairId=id=>{const n=Number(id.slice(1));assert.ok(/^p\d+$/.test(id));return'p'+(n%2?n+1:n-1);};
const point=p=>({q:-p.q||0,r:-p.r||0});
const rotate=s=>({...C.clone(s),turn:1-s.turn,winner:s.winner===0?1:s.winner===1?0:s.winner,pieces:s.pieces.map(p=>({...p,...point(p),id:pairId(p.id),team:1-p.team})).sort((a,b)=>Number(a.id.slice(1))-Number(b.id.slice(1)))});
for(const [variant,E] of [['control',C],['enemy-blocking',B]]) for(const first of [0,1]) {
  const initial=E.createGame(config);initial.turn=first;
  equal(rotate(rotate(initial)),initial,'relative-view round trip');
  const before=E.analyze(initial,config), roots=legal(E,initial,config);
  let firstWithDeaths=0, safeThroughReply=0, responses=0,responsesWithDeaths=0;
  for(const a of roots) {
    const result=E.move(initial,config,a.id,a.to);
    const mirror=E.move(rotate(initial),config,pairId(a.id),point(a.to));
    equal(rotate(result.state),mirror.state,'native move equivariance under relative viewpoint');
    if(result.deaths.length)firstWithDeaths++;
    let safe=result.deaths.length===0;
    for(const reply of legal(E,result.state,config)) {
      const r=E.move(result.state,config,reply.id,reply.to);responses++;
      if(r.deaths.length){responsesWithDeaths++;safe=false;}
    }
    if(safe)safeThroughReply++;
  }
  opening.push({variant,first,initialDead:[...before].filter(([,s])=>s.dead).map(([id])=>id),firstMoves:roots.length,firstWithDeaths,safeThroughReply,responses,responsesWithDeaths});
}
equal(opening[0].firstMoves,opening[2].firstMoves,'rule does not change first legal moves');
equal(opening[1].firstMoves,opening[3].firstMoves,'rule does not change first legal moves');
for(const offset of [0,2])equal(Object.fromEntries(Object.entries(opening[offset]).filter(([k])=>k!=='first')),Object.fromEntries(Object.entries(opening[offset+1]).filter(([k])=>k!=='first')),'opening must be symmetric for both first players');

const result={createdAt:new Date().toISOString(),passed:true,assertions:checks,findings,opening,fixtureNote:'Forced-lethal fixture uses commander damage 10 only inside that test; all match configurations retain the frozen DEFAULT_CONFIG.'};
fs.writeFileSync(path.join(root,'mechanics.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
