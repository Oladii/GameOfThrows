import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>{const i=x.indexOf('=');return i<0?[x.slice(2),'true']:[x.slice(2,i),x.slice(i+1)];}));
if(!args.root) throw new Error('Usage: node prototype/balance/analyze.mjs --root=outputs/enemy-blocking-2026-11-13');
const root=path.resolve(process.cwd(),args.root), gameDir=path.join(root,'games');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:typeof v==='string'?v:JSON.stringify(v)).digest('hex');
if(!fs.existsSync(gameDir)) throw new Error(`No games directory: ${gameDir}`);
const manifest=fs.existsSync(path.join(root,'manifest.json'))?read(path.join(root,'manifest.json')):{};
const config=read(path.join(root,'config.json'));
const plan=fs.existsSync(path.join(root,'plan.json'))?read(path.join(root,'plan.json')):{};
const files=fs.readdirSync(gameDir).filter(x=>x.endsWith('.json')).sort();
if(!files.length) throw new Error(`No game records in ${gameDir}; analysis needs saved games.`);
const initialTemplate=read(path.join(root,'initial.json'));
assert.equal(manifest.configHash,sha(config),'manifest config hash mismatch');
assert.equal(manifest.initialHash,sha(initialTemplate),'manifest initial hash mismatch');
const planJobs=Array.isArray(plan.jobs)?plan.jobs:[],planById=new Map();
for(const job of planJobs){if(planById.has(job.id))throw new Error(`Duplicate job id in plan: ${job.id}`);planById.set(job.id,job);}
for(const file of files){const id=file.slice(0,-5);if(!planById.has(id))throw new Error(`Unexpected game record outside plan: ${file}`);}
for(const [variant,sourceHashes] of Object.entries(manifest.moduleHashes||{}))for(const [name,expected] of Object.entries(sourceHashes)){
 const sourceFile=path.join(root,'source',variant,name);
 if(!fs.existsSync(sourceFile)||sha(fs.readFileSync(sourceFile))!==expected)throw new Error(`Frozen source hash mismatch: ${variant}/${name}`);
}

const modules={};
for(const variant of ['control','enemy-blocking']) {
 const p=path.join(root,'source',variant,'engine.js');
 if(fs.existsSync(p)) modules[variant]=await import(pathToFileURL(p).href);
}
const median=xs=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=a.length>>1;return a.length%2?a[m]:(a[m-1]+a[m])/2;};
const countBy=(xs,key)=>Object.fromEntries([...new Set(xs.map(key))].sort().map(k=>[k,xs.filter(x=>key(x)===k).length]));
const sorted=(xs)=>[...xs].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const pickWinner=x=>x==='draw'||x===0||x===1?x:null;
const swapWinner=x=>x===0?1:x===1?0:x;
function pieceState(s){return {pieces:sorted((s?.pieces||[]).map(p=>({id:p.id,type:p.type,team:p.team,q:p.q,r:p.r,reachedFarEdge:!!p.reachedFarEdge,archerReachedFarEdge:!!p.archerReachedFarEdge}))),turn:s?.turn,winner:s?.winner??null};}
function mirrorState(s){return {pieces:sorted((s?.pieces||[]).map(p=>{let id=p.id,m=String(id).match(/^p(\d+)$/);if(m){const n=Number(m[1]);id=`p${n%2?n+1:n-1}`;}return {id,type:p.type,team:1-p.team,q:-p.q,r:-p.r,reachedFarEdge:!!p.reachedFarEdge,archerReachedFarEdge:!!p.archerReachedFarEdge};})),turn:1-s.turn,winner:swapWinner(s?.winner??null)};}
function trajectoryKey(states){const direct=JSON.stringify(states.map(pieceState)),flipped=JSON.stringify(states.map(mirrorState));return direct<flipped?direct:flipped;}
function getAction(a){const x=a.action;if(!x)return null;if(x.type==='pass'||x.pass)return {pass:true};const to=x.to??(Number.isInteger(x.q)&&Number.isInteger(x.r)?{q:x.q,r:x.r}:null);return to?{id:x.id??x.pieceId??a.id,to}:{pass:true};}
function canonicalJob(j){const {id,variant,...rest}=j;return JSON.stringify(rest);}
function finalState(record,replayed){return record.final?.pieces?record.final:record.final?.state?.pieces?record.final.state:replayed;}

const games=[];
for(const file of files){
 const record=read(path.join(gameDir,file)),job=record.job||{};
 assert.equal(job.id,file.slice(0,-5),`${file}: filename must match its unique job id`);
 const expectedJob=planById.get(job.id);
 if(!expectedJob)throw new Error(`${file}: unknown job id ${job.id}`);
 assert.deepEqual(job,expectedJob,`${file}: job metadata differs from frozen plan`);
 const expectedInitial=JSON.parse(JSON.stringify(initialTemplate));expectedInitial.turn=job.first;
 if(!record.config||!record.initial)throw new Error(`${file}: saved config and initial state are required for verification`);
 assert.equal(sha(record.config),manifest.configHash,`${file}: config differs from frozen config`);
 assert.equal(sha(record.initial),sha(expectedInitial),`${file}: initial state/first player differs from frozen plan`);
 assert.equal(record.configHash,manifest.configHash,`${file}: recorded config hash mismatch`);
 assert.equal(record.initialHash,sha(expectedInitial),`${file}: recorded initial hash mismatch`);
 assert.equal(record.sourceManifestHash,sha(manifest),`${file}: recorded source manifest hash mismatch`);
 const variant=job.variant||record.variant;
 const E=modules[variant];
 if(!E)throw new Error(`${file}: no frozen engine for variant ${variant}`);
 const cfg=record.config||config,initial=record.initial||read(path.join(root,'initial.json'));
 let state=E.validateState(initial,cfg), firstPositive=null,firstLoss=null,quiet=0,maxQuiet=0,hashChecks=0,combatChecks=0;
 const losses={},contrib={archer:{kills:0,necessary:0},shield:{kills:0,necessary:0},scoutLamp:{kills:0,necessary:0}};
 const promotion={shield:0,archer:0}, flags=[], counter={addedProtection:0,addedProtectionByType:{},preventedFlagLethal:0};
 const histories=[pieceState(state)], eventOutcomes=[];
 for(let i=0;i<(record.actions||[]).length;i++){
  const step=record.actions[i],act=getAction(step),team=state.turn;
  if(!act)throw new Error(`${file}: action ${i} has no replayable action`);
  const before=state,old=new Map(before.pieces.map(p=>[p.id,{shield:E.shieldCanRetreat(p,cfg),archer:E.archerHasEdgeBonus(p,cfg)}]));
  if(step.team!=null&&step.team!==team)throw new Error(`${file}: recorded team mismatch at action ${i+1}`);
  const recordedActor=!act.pass?before.pieces.find(p=>p.id===act.id):null;
  if(step.type!=null&&recordedActor&&step.type!==recordedActor.type)throw new Error(`${file}: recorded piece type mismatch at action ${i+1}`);
  if(step.from&&recordedActor&&(step.from.q!==recordedActor.q||step.from.r!==recordedActor.r))throw new Error(`${file}: recorded origin mismatch at action ${i+1}`);
  let moved;
  if(act.pass)moved=E.pass(before,cfg);
  else moved=E.move(before,cfg,act.id,act.to);
  const controlE=modules.control, candidateE=modules['enemy-blocking'];
  if(controlE&&candidateE&&!act.pass){
   const preCombat=E.clone(before),actor=preCombat.pieces.find(p=>p.id===act.id);
   if(actor){const route=E.reachable(actor,before,cfg).find(p=>p.q===act.to.q&&p.r===act.to.r);actor.q=act.to.q;actor.r=act.to.r;if(route?.reachedFarEdge)actor.reachedFarEdge=true;if(route?.archerReachedFarEdge)actor.archerReachedFarEdge=true;
    const cr=controlE.analyze(preCombat,cfg),br=candidateE.analyze(preCombat,cfg);
    for(const p of preCombat.pieces){const c=cr.get(p.id),b=br.get(p.id);if(c?.dead&&!b?.dead){counter.addedProtection++;counter.addedProtectionByType[p.type]=(counter.addedProtectionByType[p.type]||0)+1;if(p.type==='defenseLamp')counter.preventedFlagLethal++;}}
   }
  }
  const outcome=moved.deaths||[];
  const report=moved.report instanceof Map?moved.report:new Map((step.combat||[]).map(x=>[x.id,x]));
  if(firstPositive===null&&(step.combat||[]).some(x=>(x.incoming||0)>0))firstPositive=i+1;
  if(outcome.length){if(firstLoss===null)firstLoss=i+1;quiet=0;}else{quiet++;maxQuiet=Math.max(maxQuiet,quiet);}
  for(const d of outcome){losses[d.type]=(losses[d.type]||0)+1;
   const data=report.get(d.id),incoming=data?.incoming??d.incoming??0,fortitude=data?.fortitude??d.fortitude??0,attackers=data?.attackers||[];
   for(const type of ['archer','shield','scoutLamp']){const dealt=attackers.filter(a=>a.type===type).reduce((s,a)=>s+(a.damage||0),0);if(dealt>0)contrib[type].kills++;if(dealt>0&&incoming-dealt<fortitude)contrib[type].necessary++;}
  }
  const after=moved.state,actorBefore=recordedActor,actorAfter=actorBefore?[...after.pieces,...outcome].find(p=>p.id===actorBefore.id):null;
  const was=actorBefore?old.get(actorBefore.id)||{}:{};
  const promotedShield=!!actorAfter&&actorBefore.type==='shield'&&!was.shield&&E.shieldCanRetreat(actorAfter,cfg);
  const promotedArcher=!!actorAfter&&actorBefore.type==='archer'&&!was.archer&&E.archerHasEdgeBonus(actorAfter,cfg);
  const survived=!!actorBefore&&after.pieces.some(p=>p.id===actorBefore.id);
  if(actorBefore&&!step.promotion)throw new Error(`${file}: missing promotion record at action ${i+1}`);
  if(step.promotion){assert.equal(step.promotion.shieldVeteran,promotedShield,`${file}: shield promotion mismatch at action ${i+1}`);assert.equal(step.promotion.archerEdge,promotedArcher,`${file}: archer edge mismatch at action ${i+1}`);assert.equal(step.promotion.survived,survived,`${file}: promotion survival mismatch at action ${i+1}`);}
  if(promotedShield)promotion.shield++;if(promotedArcher)promotion.archer++;
  const flagDead=outcome.filter(x=>x.type==='defenseLamp').length,combatDead=outcome.filter(x=>x.type==='shield'||x.type==='archer').length;
  if(flagDead)for(const d of outcome.filter(x=>x.type==='defenseLamp'))flags.push({action:i+1,flagTeam:d.team,totalCombatDeathsBothSides:combatDead,remainingCombat:after.pieces.filter(p=>p.team===d.team&&(p.type==='shield'||p.type==='archer')).length});
  if(step.stateHash){if(sha(after)!==step.stateHash)throw new Error(`${file}: replay state hash mismatch after action ${i+1}`);hashChecks++;}
  if(step.deaths&&JSON.stringify(step.deaths)!==JSON.stringify(outcome))throw new Error(`${file}: replay deaths mismatch after action ${i+1}`);
  if(step.combat){const expected=[...moved.report].map(([id,x])=>({id,...x}));if(JSON.stringify(expected)!==JSON.stringify(step.combat))throw new Error(`${file}: replay combat report mismatch after action ${i+1}`);combatChecks++;}
  if(step.counts){const actual={pieces:[0,1].map(t=>after.pieces.filter(p=>p.team===t).length),combat:[0,1].map(t=>after.pieces.filter(p=>p.team===t&&(p.type==='shield'||p.type==='archer')).length)};if(JSON.stringify(actual)!==JSON.stringify(step.counts))throw new Error(`${file}: replay count mismatch after action ${i+1}`);}
  state=after;histories.push(pieceState(state));eventOutcomes.push({team,dead:outcome.map(x=>x.type)});
 }
 if(record.actionCount!=null&&record.actionCount!==record.actions.length)throw new Error(`${file}: actionCount differs from action records`);
 const final=finalState(record,state),winner=pickWinner(final.winner??record.winner??state.winner);
 if(sha(final)!==sha(state))throw new Error(`${file}: replayed final state differs from saved final state`);
 if(record.winner!==undefined&&record.winner!==state.winner)throw new Error(`${file}: replayed native winner differs from saved winner`);
 const stop=record.stop??'unknown',nativeDraw=winner==='draw',censored=winner===null;
 let ending='unresolved',material={0:0,1:0};
 for(const team of [0,1])material[team]=final.pieces.filter(p=>p.team===team&&(p.type==='shield'||p.type==='archer')).length;
 if(winner==='draw')ending='draw';
 else if(winner!==null){const loser=1-winner,hasFlag=final.pieces.some(p=>p.team===loser&&p.type==='defenseLamp'),hasCombat=material[loser]>0;ending=!hasFlag&&!hasCombat?'flag+combat':!hasFlag?'flag':!hasCombat?'combat':'draw';}
 const first=Number(job.first??initial.turn??0),pairId=job.pairId||job.id?.replace(/-(control|enemy-blocking)$/,'')||job.id;
 const stage=job.stage||'unknown',kind=job.kind||'unknown',depth=job.depth??'na';
 const trajectory=trajectoryKey(histories);
 games.push({file,job,variant,stage,kind,depth,first,pairId,pairKey:canonicalJob(job),winner,nativeDraw,censored,terminal:stop==='engine-terminal',stop,actionCount:record.actionCount??record.actions.length,elapsedMs:record.elapsedMs??null,firstPositive,firstLoss,maxQuiet,flags,promotions:promotion,losses,contrib,counter,ending,material,trajectory,trajectoryHash:sha(trajectory),replayVerified:!!record.replayVerified||record.actions.every(a=>!!a.stateHash),hashChecks,combatChecks,actions:record.actions});
}

function summarize(rows){
 const wins={0:rows.filter(g=>g.winner===0).length,1:rows.filter(g=>g.winner===1).length};
 return {n:rows.length,outcomes:{team0Wins:wins[0],team1Wins:wins[1],draws:rows.filter(g=>g.nativeDraw).length,censored:rows.filter(g=>g.censored).length},stops:countBy(rows,g=>g.stop),firstWins:{first:rows.filter(g=>g.winner===g.first).length,second:rows.filter(g=>g.winner!==null&&g.winner!==g.first&&g.winner!=='draw').length},teamWins:wins,
  length:{observedMedian:median(rows.map(g=>g.actionCount)),observedMax:rows.length?Math.max(...rows.map(g=>g.actionCount)):null,terminalN:rows.filter(g=>g.terminal).length,terminalMedian:median(rows.filter(g=>g.terminal).map(g=>g.actionCount)),terminalMax:rows.some(g=>g.terminal)?Math.max(...rows.filter(g=>g.terminal).map(g=>g.actionCount)):null,censoredN:rows.filter(g=>g.censored).length},firstLoss:{n:rows.filter(g=>g.firstLoss!==null).length,median:median(rows.map(g=>g.firstLoss)),max:rows.some(g=>g.firstLoss!==null)?Math.max(...rows.filter(g=>g.firstLoss!==null).map(g=>g.firstLoss)):null},maxQuietRun:{median:median(rows.map(g=>g.maxQuiet)),max:rows.length?Math.max(...rows.map(g=>g.maxQuiet)):null},
  firstPositive:{n:rows.filter(g=>g.firstPositive!==null).length,median:median(rows.map(g=>g.firstPositive)),max:rows.some(g=>g.firstPositive!==null)?Math.max(...rows.filter(g=>g.firstPositive!==null).map(g=>g.firstPositive)):null},flagEndings:rows.filter(g=>g.ending==='flag'||g.ending==='flag+combat').length,combatEndings:rows.filter(g=>g.ending==='combat'||g.ending==='flag+combat').length,remainingCombatAtOutcome:rows.filter(g=>g.winner!==null&&g.winner!=='draw').map(g=>g.material[1-g.winner]),remainingCombatBothSidesAtOutcome:rows.filter(g=>g.winner!==null).map(g=>g.material),promotions:{shield:rows.reduce((s,g)=>s+g.promotions.shield,0),archer:rows.reduce((s,g)=>s+g.promotions.archer,0)},losses:Object.fromEntries([...new Set(rows.flatMap(g=>Object.keys(g.losses)))].sort().map(t=>[t,rows.reduce((s,g)=>s+(g.losses[t]||0),0)])),lethalContributions:Object.fromEntries(['archer','shield','scoutLamp'].map(t=>[t,{deathsWithType:rows.reduce((s,g)=>s+g.contrib[t].kills,0),necessaryThresholdContributions:rows.reduce((s,g)=>s+g.contrib[t].necessary,0)}])),onePly:{addedProtectionEvents:rows.reduce((s,g)=>s+g.counter.addedProtection,0),gamesWithAddedProtection:rows.filter(g=>g.counter.addedProtection>0).length,addedProtectionByType:Object.fromEntries([...new Set(rows.flatMap(g=>Object.keys(g.counter.addedProtectionByType)))].sort().map(t=>[t,rows.reduce((s,g)=>s+(g.counter.addedProtectionByType[t]||0),0)])),preventedFlagLethals:rows.reduce((s,g)=>s+g.counter.preventedFlagLethal,0),gamesWithPreventedFlagLethal:rows.filter(g=>g.counter.preventedFlagLethal>0).length},uniqueCanonicalTrajectories:new Set(rows.map(g=>g.trajectory)).size};
}
function searchStats(rows){
 const choices=rows.flatMap(g=>g.actions.map(a=>a.selection||{})), nodes=choices.map(x=>x.nodes).filter(Number.isFinite), depth=choices.map(x=>x.maxDepth).filter(Number.isFinite), elapsed=choices.map(x=>x.decisionElapsedMs??x.elapsedMs).filter(Number.isFinite);
 const defenses=choices.map(x=>x.defense).filter(x=>x&&typeof x==='object'), statuses={};
 for(const d of defenses)statuses[d.status||'unknown']=(statuses[d.status||'unknown']||0)+1;
 return {decisions:choices.length,nodes:{sum:nodes.reduce((a,b)=>a+b,0),median:median(nodes),max:nodes.length?Math.max(...nodes):null},decisionMs:{median:median(elapsed),max:elapsed.length?Math.max(...elapsed):null},maxDepth:{median:median(depth),max:depth.length?Math.max(...depth):null},budgetStops:choices.filter(x=>x.budgetStop===true||x.reason==='budget-stop'||x.stop==='budget-stop').length,defense:{checkedChoices:defenses.reduce((s,d)=>s+(d.checked||0),0),fallbackChoices:defenses.filter(d=>d.fallback===true).length,outsideOldBeamChoices:defenses.filter(d=>d.selectedOutsideOldBeam===true).length,nodesSum:defenses.reduce((s,d)=>s+(d.nodes||0),0),repliesSum:defenses.reduce((s,d)=>s+(d.replies||0),0),statusCounts:statuses}};
}

const included=games.filter(g=>g.stage!=='pilot'),cohorts={};
const cohortKey=g=>`${g.stage}/${g.kind==='ui'?`ui-d${g.depth}`:'styles'}/${g.variant}`;
for(const g of included){const k=cohortKey(g);(cohorts[k]??=[]).push(g);}
const cohortSummary=Object.fromEntries(Object.entries(cohorts).sort().map(([k,v])=>[k,summarize(v)]));
const traj={};for(const g of included){const k=`${g.stage}/${g.kind}/${g.depth}/${g.variant}`,x=traj[k]??=new Map();x.set(g.trajectory,(x.get(g.trajectory)||0)+1);}
const trajectoryGroups=Object.fromEntries(Object.entries(traj).sort().map(([k,m])=>[k,{unique:m.size,groups:[...m.values()].sort((a,b)=>b-a)}]));
const pairs=new Map();for(const g of included){const k=`${g.stage}/${g.pairKey}`;(pairs.get(k)||pairs.set(k,[]).get(k)).push(g);}
const pairDiffs=[];for(const [jobKey,rows] of pairs){const c=rows.find(x=>x.variant==='control'),b=rows.find(x=>x.variant==='enemy-blocking');if(c&&b&&canonicalJob(c.job)===canonicalJob(b.job)){const bothTerminal=c.terminal&&b.terminal,delta=b.actionCount-c.actionCount;const deltaInterpretation=bothTerminal?'exact (both native-terminal)':b.stop==='action-limit'&&c.terminal?'candidate duration is at least the observed difference (action limit)':c.stop==='action-limit'&&b.terminal?'control duration is censored; exact difference unknown':'one or both records are nonterminal/censored; exact difference unknown';pairDiffs.push({key:c.pairId,jobKey,stage:c.stage,kind:c.kind,depth:c.depth,control:{outcome:c.winner,actions:c.actionCount,terminal:c.terminal},enemyBlocking:{outcome:b.winner,actions:b.actionCount,terminal:b.terminal},observedActionDelta:delta,durationComparable:bothTerminal,durationDelta:bothTerminal?delta:null,deltaInterpretation,resultFlip:c.winner!==b.winner});}}
const styleMatrix={};for(const g of included.filter(x=>x.kind==='style')){const ps=g.job.players||[],names=ps.map(p=>typeof p==='string'?p:(p.profile||p.name||p.kind||'?'));if(names.length!==2)continue;const [a,b]=[...names].sort(),key=`${g.stage}/${g.variant}/${a} vs ${b}`,m=styleMatrix[key]??={aWins:0,bWins:0,draws:0,censored:0,n:0};m.n++;if(g.winner===0){if(names[0]===a)m.aWins++;else m.bWins++;}else if(g.winner===1){if(names[1]===a)m.aWins++;else m.bWins++;}else if(g.winner==='draw')m.draws++;else m.censored++;}
const gameRows=included.map(g=>({id:g.job.id,stage:g.stage,kind:g.kind,depth:g.depth,variant:g.variant,players:g.job.players,first:g.first,winner:g.winner,terminal:g.terminal,stop:g.stop,observedActions:g.actionCount,firstPositive:g.firstPositive,firstLoss:g.firstLoss,maxQuiet:g.maxQuiet,ending:g.ending,remainingCombat:g.material,promotions:g.promotions,losses:g.losses,addedProtection:g.counter,trajectoryHash:g.trajectoryHash,replayChecks:{hashes:g.hashChecks,combat:g.combatChecks}}));
const plannedJobs=Array.isArray(plan.jobs)?plan.jobs:[],recordedIds=new Set(games.map(g=>g.job.id)),missingJobs=plannedJobs.filter(j=>!recordedIds.has(j.id)).map(j=>j.id);
const stageCounts={};for(const stage of [...new Set([...plannedJobs.map(j=>j.stage),...games.map(g=>g.stage)])].sort()){const expected=plannedJobs.filter(j=>j.stage===stage),got=games.filter(g=>g.stage===stage);stageCounts[stage]={expected:expected.length,recorded:got.length,expectedByVariant:countBy(expected,j=>j.variant),recordedByVariant:countBy(got,g=>g.variant)};}
const complete=plannedJobs.length>0&&missingJobs.length===0;
const summary={createdAt:new Date().toISOString(),status:complete?'complete':'partial',root,plan:{expectedJobs:plannedJobs.length,recordedJobs:games.length,missingJobs,stages:stageCounts},manifest:{version:manifest.version||null,productHashes:manifest.productHashes||null,moduleHashes:manifest.moduleHashes||null,configHash:manifest.configHash||sha(config),initialHash:manifest.initialHash||null},recordCount:games.length,excludedPilot:games.filter(g=>g.stage==='pilot').length,replayChecks:{recordsWithReplayMarker:games.filter(g=>g.replayVerified).length,hashesChecked:games.reduce((s,g)=>s+g.hashChecks,0),combatReportsChecked:games.reduce((s,g)=>s+g.combatChecks,0)},cohorts:cohortSummary,search:Object.fromEntries(Object.entries(cohorts).sort().map(([k,v])=>[k,searchStats(v)])),trajectoryGroups,pairDiffs,styleMatrix,gameRows,limitations:['Pilot is excluded from cohort summaries.','Canonical mirror groups, paired jobs, and repeated trajectories are dependent; file counts are not independent observations.','One-ply protection compares current engine reports on the same actual moved position; it is not a causal estimate of wins.','The engine rule is isolated, but the unchanged formation policy still contains shield-specific cover heuristics; observed play reflects that fixed policy.','Action limits and other runner stops are censored observations, never native draws.','No broad claim of balance is made.']};
fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(summary,null,2)+'\n');

const fmt=x=>x==null?'—':String(x), lines=['# Анализ блокирования выстрелов','',`**Статус:** ${complete?'полный по текущему плану':'частичный; не считать итоговым'}. Записей ${games.length}/${plannedJobs.length||'план не найден'}; отсутствуют ${missingJobs.length}. Pilot исключён из сравнений: ${summary.excludedPilot}.`, '',`Снимок исходников: manifest версии ${fmt(summary.manifest.version)}; config SHA-256 ${summary.manifest.configHash}. Хеши источников см. в \`manifest.json\`.`,'','## Полнота плана','','| Этап | Записей / ожидалось | По variant |','|---|---:|---|'];
for(const [stage,x] of Object.entries(stageCounts))lines.push(`| ${stage} | ${x.recorded}/${x.expected} | ${Object.entries(x.recordedByVariant).map(([v,n])=>`${v} ${n}`).join(', ')||'нет'} |`);
lines.push('','## Основные срезы','','| Срез | N | Победы команды 0/1 | Ничьи движка | Без исхода | Стопы | Набл. действия медиана/макс | Terminal N/медиана | Первая потеря медиана | Тихий отрезок макс. | Уникальные траектории |','|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|');
for(const [k,s] of Object.entries(cohortSummary))lines.push(`| ${k} | ${s.n} | ${s.teamWins[0]}/${s.teamWins[1]} | ${s.outcomes.draws} | ${s.outcomes.censored} | ${Object.entries(s.stops).map(([a,b])=>`${a}:${b}`).join(', ')||'—'} | ${fmt(s.length.observedMedian)}/${fmt(s.length.observedMax)} | ${s.length.terminalN}/${fmt(s.length.terminalMedian)} | ${fmt(s.firstLoss.median)} | ${fmt(s.maxQuietRun.max)} | ${s.uniqueCanonicalTrajectories} |`);
lines.push('','Наблюдаемая длина включает цензурированные прогоны и не является оценкой истинной длительности. Terminal N/медиана считает только `engine-terminal`; action-limit и иные остановки остаются цензурированными.','','## Метрики по срезам','','Для каждого среза ниже указаны победы первого/второго, тип окончания, продвижения, потери и вычислительная стоимость.','');
for(const [k,s] of Object.entries(cohortSummary)){const q=summary.search[k];lines.push(`- **${k}** — первые/вторые: ${s.firstWins.first}/${s.firstWins.second}; флаг/бой: ${s.flagEndings}/${s.combatEndings}; повышения щита/края лукаря: ${s.promotions.shield}/${s.promotions.archer}; потери: ${JSON.stringify(s.losses)}; поиск: ${q.decisions} выборов, nodes ${q.nodes.sum}, медиана времени ${fmt(q.decisionMs.median)} мс, maxDepth ${fmt(q.maxDepth.max)}; защитная проверка: ${q.defense.checkedChoices} проверок, fallback ${q.defense.fallbackChoices}, вне старого beam ${q.defense.outsideOldBeamChoices}, nodes/replies ${q.defense.nodesSum}/${q.defense.repliesSum}.`);}
lines.push('','Летальные вклады типов выводятся из `attackers` фактического боевого отчёта: «необходимый» означает, что без суммарного урона этого типа цель не достигла бы стойкости. Это не сумма сырого урона. One-ply защита повторяется по действиям; поэтому рядом с числом событий в `summary.json` дано число партий хотя бы с одним событием. Это локальные добавленные защиты и предотвращённые летальные попадания, не причинный эффект на победы. Статусы defensive selection — метаданные проверки одного ответа, не гарантия победы или глубокой безопасности.','','## Парные результаты','','Парность проверяется по одинаковым параметрам job после удаления `id` и `variant`. Разницу длительности считаем точной только если обе партии завершились по движку.','', '| Серия | Пара | Наблюдалось действий control→candidate | Δ длительности | Исход сменился |','|---|---|---:|---:|---|');
for(const p of pairDiffs)lines.push(`| ${p.stage}/${p.kind}/d${p.depth} | ${p.key} | ${p.control.actions}→${p.enemyBlocking.actions} | ${p.durationComparable?`${p.durationDelta>0?'+':''}${p.durationDelta} (точно)`:p.deltaInterpretation} | ${p.resultFlip?'да':'нет'} |`);
lines.push('','## Стилевые пары','','Победы приведены для самих стилей, независимо от стороны; control и enemy-blocking разделены. Эти результаты не являются независимыми оценками силы стиля.','', '| Серия / вариант / пара | N | Победы A | Победы B | Ничьи | Без исхода |','|---|---:|---:|---:|---:|---:|');
for(const [k,m] of Object.entries(styleMatrix))lines.push(`| ${k} | ${m.n} | ${m.aWins} | ${m.bWins} | ${m.draws} | ${m.censored} |`);
lines.push('','## Зеркала и ограничения','','Точные траектории канонизированы по sequence состояний, игнорируя `ply` и прочие метаданные; зеркало меняет знак координат, команды, чей ход, победителя и парные ID `pN` на соседний нечётный/чётный ID. Числа зеркальных групп и их повторов приведены в `summary.json`.','',`Replay-проверка этого анализа сверила ${summary.replayChecks.hashesChecked} state hashes и ${summary.replayChecks.combatReportsChecked} полных боевых отчётов.`,'',...summary.limitations.map(x=>`- ${x}`),'','Анализ описывает эту выборку и не выдаёт общий вердикт о балансе.','');
fs.writeFileSync(path.join(root,'report.md'),lines.join('\n'));
console.log(JSON.stringify({root,recordCount:games.length,cohorts:Object.keys(cohortSummary).length,summary:path.join(root,'summary.json'),report:path.join(root,'report.md')}));
