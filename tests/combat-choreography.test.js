import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PREVIOUS_FORMATION_CONFIG as DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, move, pass } from '../dist/engine.js';
import { CombatAnimator, COMBAT_DIM_DURATION, ARROW_REVEAL_INTERVAL, ATTACK_HOLD_DURATION, DEATH_EFFECT_DURATION } from '../dist/move-animation.js';
import { lethalAttackPresentation, renderDamageArrows, renderUnitBadges } from '../dist/board-presentation.js';

const piece = (id,type,team,q,r) => ({id,type,team,q,r});
const position = pieces => ({pieces,turn:0,ply:0,winner:null});
const source = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function declaration(name) {
  const start=source.indexOf(`function ${name}(`), lineEnd=source.indexOf('\n',start);
  return source.slice(start,source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',lineEnd)+2);
}
function clock() {
  let now=0,id=0; const timers=new Map();
  return { timers, setTimer(fn,delay) {timers.set(++id,{at:now+delay,fn});return id;}, clearTimer(id) {timers.delete(id);},
    advance(ms) {const until=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);now=next[1].at;next[1].fn();}now=until;} };
}

test('combined kills keep every contributor and victim colored, including mutual deaths, but omit harmless attacks', () => {
  const config=structuredClone(DEFAULT_CONFIG);
  const state=position([piece('a','archer',0,-2,0),piece('b','archer',0,0,-2),piece('victim','shield',1,0,0),piece('idle','scoutLamp',0,-3,3)]);
  const report=analyze(state,config), deaths=state.pieces.filter(p=>report.get(p.id).dead);
  const view=lethalAttackPresentation(state,report,deaths);
  assert.equal(report.get('victim').incoming,16);
  assert.ok(view.victims.has('victim'));
  assert.deepEqual(new Set(view.arrows.filter(a=>a.target.id==='victim').map(a=>a.source.id)),new Set(['a','b']));
  assert.equal(view.participants.has('idle'),false);
  const mutual=position([piece('north','shield',0,0,0),piece('south','shield',1,0,1)]);
  const mutualReport=analyze(mutual,config), both=lethalAttackPresentation(mutual,mutualReport,mutual.pieces);
  assert.equal(both.arrows.length,2);assert.equal(both.participants.size,2);
  const html=renderDamageArrows(both.arrows,c=>({x:c.q*50,y:c.r*50}));
  assert.equal((html.match(/class="attack-ray"/g)||[]).length,2);
  const labelXs=[...html.matchAll(/class="ray-text" x="([^"]+)"/g)].map(m=>+m[1]);
  assert.notEqual(labelXs[0],labelXs[1]);
});

test('overkill is removed before layout, keeping the smallest lethal set and full damage values', () => {
  const victim=piece('victim','shield',1,0,0),sources=['weak','strong-b','strong-a','tiny'].map((id,i)=>piece(id,'archer',0,i+1,-1));
  const state=position([victim,...sources]),attackers=sources.map((p,i)=>({id:p.id,damage:[2,4,4,1][i]}));
  const report=new Map([['victim',{fortitude:7,incoming:11,dead:true,attackers}]]),snapshot=structuredClone(report);
  const view=lethalAttackPresentation(state,report,[victim]);
  assert.deepEqual(view.arrows.map(a=>[a.source.id,a.damage]),[['strong-a',4],['strong-b',4]]);
  assert.deepEqual([...view.participants].sort(),['strong-a','strong-b','victim']);
  assert.deepEqual(report,snapshot,'the full combat report is unchanged');
  const reordered=lethalAttackPresentation(position([...state.pieces].reverse()),new Map([['victim',{...report.get('victim'),attackers:[...attackers].reverse()}]]),[victim]);
  assert.deepEqual(reordered.arrows,view.arrows,'equal damage has a stable tie-break');
  const point=p=>({x:p.q*57,y:p.r*49.5}),full=renderDamageArrows(view.arrows,point,{pieces:state.pieces});
  for(let count=1;count<=view.arrows.length;count++) {
    const html=renderDamageArrows(view.arrows,point,{pieces:state.pieces,visibleCount:count});
    assert.equal((html.match(/class="attack-ray"/g)||[]).length,count);
    assert.ok(!html.includes('data-source="weak"')&&!html.includes('data-source="tiny"'));
    for(const path of html.matchAll(/d="(M[^"]+)"/g))assert.ok(full.includes(path[0]),'remaining paths stay fixed while revealed');
  }
  const single=lethalAttackPresentation(state,new Map([['victim',{fortitude:3,attackers}]]),[victim]);
  assert.deepEqual(single.arrows.map(a=>a.damage),[4],'a single sufficient attack is not clipped to fortitude');
});

test('hidden overkill keeps mutual deaths together and a dying attacker still contributes', () => {
  const a=piece('a','shield',0,0,0),b=piece('b','shield',1,0,1),survivor=piece('survivor','archer',0,1,0);
  const state=position([a,b,survivor]);
  const report=new Map([['a',{fortitude:4,attackers:[{id:'b',damage:4}]}],
    ['b',{fortitude:4,attackers:[{id:'a',damage:1},{id:'survivor',damage:4}]}]]);
  const view=lethalAttackPresentation(state,report,[a,b]);
  assert.deepEqual(view.arrows.map(e=>[e.source.id,e.target.id,e.damage]),[['b','a',4],['survivor','b',4]]);
  assert.deepEqual(view.groups.map(g=>g.deaths.map(p=>p.id)),[['a','b']]);
});

test('one- and two-digit token values keep their size and retain the target behind incoming damage', () => {
  const statSizes=[],damageSizes=[];
  for(const n of [8,88]) {
    const info={damage:n,fortitude:n+1,incoming:n,dead:false};
    const idle=renderUnitBadges(info), active=renderUnitBadges(info,{showIncoming:true});
    assert.ok(idle.includes('under-fire-target'));
    assert.ok(idle.includes(`data-attack="${n}"`));
    assert.ok(!active.includes('under-fire-target'));
    assert.ok(active.includes(`data-value="−${n}"`));
    assert.ok(active.includes('token-art incoming-badge'));
    assert.match(idle,/data-artwork="bullseye"/);
    assert.match(active,/data-artwork="target-ring"/);
    statSizes.push(...[...active.matchAll(/class="(?:attack|fort)-text token-number"[^>]+data-font-size="([^"]+)"/g)].map(m=>Number(m[1])));
    damageSizes.push(...[...active.matchAll(/class="incoming-text token-number"[^>]+data-font-size="([^"]+)"/g)].map(m=>Number(m[1])));
  }
  assert.equal(statSizes.length,4);assert.ok(statSizes.every(n=>n===80));
  assert.equal(damageSizes.length,2);assert.ok(damageSizes.every(n=>n===68));
});

function presentationHarness(mode='local') {
  const config=structuredClone(DEFAULT_CONFIG), before={config,log:[],state:position([piece('mover','archer',0,0,0),piece('enemy','archer',1,1,1),piece('spectator','shield',1,-4,2),piece('ally-spectator','shield',0,4,-2)])};
  const action={id:'mover',to:{q:0,r:1}}, result=move(before.state,config,action.id,action.to);
  const forecast=inspectCell(before.state,config,action.to,action.id), time=clock(), snapshots=[];
  let botStarts=0,botCancels=0;const notices=[];
  const context=vm.createContext({config,state:result.state,combat:null,movement:null,currentDeaths:[],reviewingTurn:false,lastTurn:null,gamePhase:'playing',editor:false,playMode:mode,humanTeam:0,
    ready:true,botIssue:'',botSuspended:false,botTimer:null,botRunner:{active:false},$:()=>null,lethalAttackPresentation,analyze,inspectCell,selected:null,fieldView:null,
    toast(message){notices.push(message);},cancelBot(){botCancels++;time.clearTimer(context.botTimer);context.botTimer=null;},
    setTimeout:(fn,ms)=>time.setTimer(fn,ms),highlightSources(){},moveAnimator:{cancel(){}},startBot(){botStarts++;},
    CombatAnimator:class extends CombatAnimator{constructor(onPhase,onFrame){super(onPhase,onFrame,time);}},
    render(){snapshots.push({phase:context.combat?.phase||'idle',state:structuredClone(context.visibleState())});context.queueBot();}});
  for(const name of ['visibleState','isBotTurn','humanCanMove','queueBot','presentKills','canReplayLastCombat','replayLastCombat','cancelMovement'])vm.runInContext(declaration(name),context);
  const start=source.indexOf('const combatAnimator = new CombatAnimator('),end=source.indexOf('function toast(',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,time,before,result,forecast,snapshots,start(){context.presentKills(before,forecast,result.deaths);},botStarts:()=>botStarts,botCancels:()=>botCancels,notices,action};
}

test('combat dims for 300ms, reveals mutual arrows 300ms apart, holds the last for 1s and then kills together', () => {
  const ui=presentationHarness();ui.start();
  assert.equal(ui.context.combat.phase,'dimming');assert.equal(ui.context.combat.arrowCount,0);
  assert.equal(ui.context.visibleState().pieces.length,4);
  assert.equal(ui.context.visibleState().turn,0);assert.equal(ui.context.humanCanMove(),false);
  ui.time.advance(COMBAT_DIM_DURATION-1);assert.equal(ui.context.combat.phase,'dimming');
  ui.time.advance(1);assert.equal(ui.context.combat.phase,'attacks');assert.equal(ui.context.combat.arrowCount,1);
  ui.time.advance(ARROW_REVEAL_INTERVAL-1);assert.equal(ui.context.combat.arrowCount,1);
  ui.time.advance(1);assert.equal(ui.context.combat.arrowCount,2);
  ui.time.advance(ATTACK_HOLD_DURATION-1);assert.equal(ui.context.combat.phase,'attacks');
  ui.time.advance(1);assert.equal(ui.context.combat.phase,'deaths');
  assert.equal(ui.context.combat.activeDeaths.length,2);
  assert.equal(ui.context.visibleState().turn,0);assert.equal(ui.context.visibleState().pieces.length,2);
  ui.time.advance(DEATH_EFFECT_DURATION-1);assert.ok(ui.context.combat);
  ui.time.advance(1);assert.equal(ui.context.combat,null);assert.equal(ui.context.visibleState().turn,1);
  assert.equal(ui.context.humanCanMove(),true);assert.deepEqual(ui.context.visibleState(),ui.result.state);
});

test('bot replies wait for every group and stale timers cannot end a replacement presentation', () => {
  const ui=presentationHarness('bot');ui.start();
  const duration=COMBAT_DIM_DURATION+ARROW_REVEAL_INTERVAL+ATTACK_HOLD_DURATION+DEATH_EFFECT_DURATION;
  ui.time.advance(duration-1);assert.equal(ui.botStarts(),0);
  ui.time.advance(1);assert.equal(ui.botStarts(),0);ui.time.advance(420);assert.equal(ui.botStarts(),1);
  for (const elapsed of [0,COMBAT_DIM_DURATION,COMBAT_DIM_DURATION+ARROW_REVEAL_INTERVAL+ATTACK_HOLD_DURATION]) {
    const cancelled=presentationHarness();cancelled.start();cancelled.time.advance(elapsed);
    const stale=[...cancelled.time.timers.values()][0].fn;
    cancelled.context.cancelMovement();const renders=cancelled.snapshots.length;
    stale();cancelled.time.advance(10000);assert.equal(cancelled.snapshots.length,renders);assert.equal(cancelled.context.combat,null);
  }
  const replaced=presentationHarness();replaced.start();const stale=[...replaced.time.timers.values()][0].fn;
  replaced.start();stale();assert.equal(replaced.context.combat.phase,'dimming');
  replaced.time.advance(COMBAT_DIM_DURATION);assert.equal(replaced.context.combat.arrowCount,1);
});

// A directed damage graph makes ordering independent of board geometry and
// covers dependencies that ordinary reciprocal pairs cannot exercise.
function graphPresentation(edges, victimIds) {
  const ids=[...new Set(edges.flat().concat(victimIds))],pieces=ids.map((id,i)=>piece(id,'archer',i%2,i,0));
  const report=new Map(ids.map(id=>[id,{attackers:edges.filter(e=>e[1]===id).map(([id])=>({id,damage:8}))}]));
  return lethalAttackPresentation(position(pieces),report,victimIds.map(id=>pieces.find(p=>p.id===id)));
}

test('non-contributing victims resolve individually before mutually damaging victims, with arrows grouped by target', () => {
  const view=graphPresentation([['a','b'],['c','b'],['a','lamp1'],['b','lamp2'],['b','a'],['c','a']],['a','lamp1','b','lamp2']);
  assert.deepEqual(view.groups.map(g=>g.deaths.map(p=>p.id)),[['lamp1'],['lamp2'],['a','b']]);
  assert.deepEqual(view.groups.at(-1).arrows.map(a=>a.target.id),['a','a','b','b']);
  const chain=graphPresentation([['survivor','a'],['a','b'],['b','c']],['a','b','c']);
  assert.deepEqual(chain.groups.map(g=>g.deaths.map(p=>p.id)),[['c'],['b'],['a']]);
});

test('each single victim loses only its own arrows and token before the remaining group starts', () => {
  const ui=presentationHarness(), view=graphPresentation([['a','b'],['b','a'],['a','lamp1'],['b','lamp2']],['a','lamp1','b','lamp2']);
  ui.forecast.position=position([...new Map(view.arrows.flatMap(a=>[a.source,a.target]).map(p=>[p.id,p])).values()]);
  ui.forecast.report=new Map(ui.forecast.position.pieces.map(p=>[p.id,{attackers:view.arrows.filter(a=>a.target.id===p.id).map(a=>({id:a.source.id,damage:a.damage}))}]));
  const deaths=view.groups.flatMap(g=>g.deaths);
  ui.context.presentKills(ui.before,ui.forecast,deaths);
  ui.time.advance(COMBAT_DIM_DURATION);assert.equal(ui.context.combat.arrowCount,1);
  ui.time.advance(ATTACK_HOLD_DURATION);assert.deepEqual(Array.from(ui.context.combat.activeDeaths,p=>p.id),['lamp1']);
  assert.deepEqual(Array.from(ui.context.visibleState().pieces,p=>p.id).sort(),['a','b','lamp2']);
  ui.time.advance(DEATH_EFFECT_DURATION);assert.equal(ui.context.combat.phase,'attacks');assert.equal(ui.context.combat.groupIndex,1);
  ui.time.advance(ATTACK_HOLD_DURATION);assert.deepEqual(Array.from(ui.context.combat.activeDeaths,p=>p.id),['lamp2']);
  ui.time.advance(DEATH_EFFECT_DURATION);assert.equal(ui.context.combat.groupIndex,2);assert.equal(ui.context.combat.arrowCount,1);
  assert.deepEqual(Array.from(ui.context.visibleState().pieces,p=>p.id).sort(),['a','b']);
  ui.time.advance(ARROW_REVEAL_INTERVAL+ATTACK_HOLD_DURATION);assert.equal(ui.context.combat.activeDeaths.length,2);
  assert.equal(ui.context.visibleState().pieces.length,0);assert.equal(ui.context.humanCanMove(),false);
  ui.time.advance(DEATH_EFFECT_DURATION);assert.equal(ui.context.combat,null);
});

test('progressive rendering preserves reveal order and arrow geometry, including reciprocal lanes', () => {
  const view=graphPresentation([['z','a'],['a','z'],['m','z']],['z','a']);
  const arrows=view.groups[0].arrows,point=p=>({x:p.q*70,y:p.r*70});
  const full=renderDamageArrows(arrows,point);
  for(let count=1;count<=arrows.length;count++) {
    const html=renderDamageArrows(arrows,point,{visibleCount:count});
    assert.equal((html.match(/class="attack-ray"/g)||[]).length,count);
    assert.equal((html.match(/data-revealing="true"/g)||[]).length,2,'only the latest shaft and its badge animate');
    const latest=arrows[count-1];
    assert.ok(html.includes(`data-source="${latest.source.id}" data-target="${latest.target.id}" data-revealing="true"`));
    for(const path of html.matchAll(/d="(M[^"]+)"/g)) assert.ok(full.includes(path[0]),'existing paths never jump');
  }
});


test('replaying the last calculation restores its victims temporarily and leaves the committed game and history intact', () => {
  const ui=presentationHarness();
  ui.context.lastTurn={before:ui.before,action:ui.action};
  ui.context.history=[structuredClone(ui.before)];ui.context.log=[{text:'Committed move',detail:'Two deaths'}];
  const actualState=ui.context.state, persisted=JSON.stringify({state:actualState,before:ui.before,log:ui.context.log,history:ui.context.history,lastTurn:ui.context.lastTurn});
  for(let repeat=0;repeat<2;repeat++) {
    ui.context.replayLastCombat();assert.equal(ui.context.combat.phase,'dimming');
    assert.equal(ui.context.visibleState().pieces.length,4);assert.equal(ui.context.humanCanMove(),false);
    assert.equal(ui.context.combat.position.pieces.find(p=>p.id==='mover').r,1,'replay starts after movement');
    ui.time.advance(COMBAT_DIM_DURATION+ARROW_REVEAL_INTERVAL+ATTACK_HOLD_DURATION+DEATH_EFFECT_DURATION);
    assert.equal(ui.context.combat,null);assert.equal(ui.context.visibleState(),actualState);
    assert.equal(JSON.stringify({state:ui.context.state,before:ui.before,log:ui.context.log,history:ui.context.history,lastTurn:ui.context.lastTurn}),persisted);
  }
  assert.equal(ui.botCancels(),2);
});

test('replay blocks duplicate clicks and postpones the pending bot until the presentation is finished', () => {
  const ui=presentationHarness('bot');ui.context.lastTurn={before:ui.before,action:ui.action};
  ui.context.queueBot();assert.notEqual(ui.context.botTimer,null);
  ui.context.replayLastCombat();const presentation=ui.context.combat;
  ui.context.replayLastCombat();assert.equal(ui.context.combat,presentation);assert.equal(ui.botCancels(),1);
  ui.time.advance(420);assert.equal(ui.botStarts(),0);
  ui.time.advance(10000);assert.equal(ui.botStarts(),1);
});

test('replay supports a saved pass calculation and disables its button when nobody died', () => {
  const ui=presentationHarness();ui.before.state=ui.forecast.position;ui.before.config.experiments.allowPass=true;
  ui.context.state=pass(ui.before.state,ui.before.config).state;
  ui.context.lastTurn=JSON.parse(JSON.stringify({before:ui.before,action:{pass:true}}));
  ui.context.replayLastCombat();assert.equal(ui.context.combat.deaths.length,2);
  ui.time.advance(10000);assert.equal(ui.context.combat,null);
  const peaceful=presentationHarness();peaceful.before.config.experiments.allowPass=true;
  peaceful.context.state=pass(peaceful.before.state,peaceful.before.config).state;
  peaceful.context.lastTurn={before:peaceful.before,action:{pass:true}};
  // The unchanged pre-move geometry has no lethal attack.
  peaceful.context.replayLastCombat();assert.equal(peaceful.context.combat,null);
  assert.deepEqual(peaceful.notices,[]);assert.equal(peaceful.botCancels(),0);
  const button={disabled:false};peaceful.context.$=()=>button;
  vm.runInContext(source.match(/  \$\('#replay-combat'\)\.disabled = [^\n]+/)[0],peaceful.context);
  assert.equal(button.disabled,true);
  const readyButton={disabled:true};ui.context.$=()=>readyButton;
  vm.runInContext(source.match(/  \$\('#replay-combat'\)\.disabled = [^\n]+/)[0],ui.context);
  assert.equal(readyButton.disabled,false);
});

test('replay is unavailable before a move, during setup, editing, history review, movement and death effects', () => {
  const fresh=presentationHarness();fresh.context.replayLastCombat();assert.equal(fresh.context.combat,null);
  for(const [field,value] of [['gamePhase','setup'],['editor',true],['reviewingTurn',true],['movement',{}],['currentDeaths',[{}]]]) {
    const ui=presentationHarness();ui.context.lastTurn={before:ui.before,action:ui.action};ui.context[field]=value;
    ui.context.replayLastCombat();assert.equal(ui.context.combat,null);assert.equal(ui.botCancels(),0);
  }
});
