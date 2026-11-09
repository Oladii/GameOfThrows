import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, move } from '../dist/engine.js';
import { CombatAnimator, ATTACK_EFFECT_DURATION, DEATH_EFFECT_DURATION } from '../dist/move-animation.js';
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

test('numeric badges grow horizontally and keep the target at the top until hover reveals damage', () => {
  const widths=[];
  for(const n of [8,88,888,8888]) {
    const info={damage:n,fortitude:n+1,incoming:n,dead:false};
    const idle=renderUnitBadges(info), active=renderUnitBadges(info,{showIncoming:true});
    assert.match(idle,/under-fire-target/);assert.match(idle,/translate\(0,-20\)/);
    assert.match(idle,new RegExp(`data-attack="${n}"`));
    assert.ok(!active.includes('under-fire-target'));assert.ok(active.includes(`>−${n}</text>`));
    widths.push(+active.match(/class="incoming-badge"[^>]*width="([^"]+)"/)[1]);
    assert.equal(+active.match(/class="incoming-badge"[^>]*height="([^"]+)"/)[1],17);
    const left=active.match(/class="attack-badge" x="([^"]+)"[^>]*width="([^"]+)"/);
    const right=active.match(/class="fort-badge" x="([^"]+)"/);
    assert.ok(Number(left[1])+Number(left[2]) < Number(right[1]), 'corner badges must not overlap');
  }
  assert.ok(widths.every((w,i)=>i===0||w>widths[i-1]));
});

function presentationHarness(mode='local') {
  const config=structuredClone(DEFAULT_CONFIG), before={config,log:[],state:position([piece('mover','archer',0,0,0),piece('enemy','archer',1,1,1),piece('spectator','shield',1,-4,2),piece('ally-spectator','shield',0,4,-2)])};
  const action={id:'mover',to:{q:0,r:1}}, result=move(before.state,config,action.id,action.to);
  const forecast=inspectCell(before.state,config,action.to,action.id), time=clock(), snapshots=[];
  let botStarts=0;
  const context=vm.createContext({config,state:result.state,combat:null,movement:null,currentDeaths:[],reviewingTurn:false,lastTurn:null,gamePhase:'playing',editor:false,playMode:mode,humanTeam:0,
    ready:true,botIssue:'',botSuspended:false,botTimer:null,botRunner:{active:false},$:()=>null,lethalAttackPresentation,ATTACK_EFFECT_DURATION,
    setTimeout:(fn,ms)=>time.setTimer(fn,ms),moveAnimator:{cancel(){}},startBot(){botStarts++;},
    CombatAnimator:class extends CombatAnimator{constructor(onPhase,onFrame){super(onPhase,onFrame,time);}},
    render(){snapshots.push({phase:context.combat?.phase||'idle',state:structuredClone(context.visibleState())});context.queueBot();}});
  for(const name of ['visibleState','isBotTurn','humanCanMove','queueBot','presentKills','cancelMovement'])vm.runInContext(declaration(name),context);
  const start=source.indexOf('const combatAnimator = new CombatAnimator('),end=source.indexOf('function toast(',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,time,before,result,forecast,snapshots,start(){context.presentKills(before,forecast,result.deaths);},botStarts:()=>botStarts};
}

test('arrows last exactly three seconds, then deaths play, colors and the next turn return only afterwards', () => {
  const ui=presentationHarness();ui.start();
  assert.equal(ui.context.combat.phase,'attacks');assert.equal(ui.context.visibleState().pieces.length,4);
  assert.equal(ui.context.visibleState().turn,0);assert.equal(ui.context.humanCanMove(),false);
  ui.time.advance(ATTACK_EFFECT_DURATION-1);assert.equal(ui.context.combat.phase,'attacks');
  ui.time.advance(1);assert.equal(ui.context.combat.phase,'deaths');
  assert.equal(ui.context.visibleState().turn,0);assert.equal(ui.context.visibleState().pieces.length,2);
  ui.time.advance(DEATH_EFFECT_DURATION-1);assert.ok(ui.context.combat);
  ui.time.advance(1);assert.equal(ui.context.combat,null);assert.equal(ui.context.visibleState().turn,1);
  assert.equal(ui.context.humanCanMove(),true);assert.deepEqual(ui.context.visibleState(),ui.result.state);
});

test('bot replies wait for the entire combat and stale timers cannot end a replacement presentation', () => {
  const ui=presentationHarness('bot');ui.start();
  ui.time.advance(ATTACK_EFFECT_DURATION+DEATH_EFFECT_DURATION-1);assert.equal(ui.botStarts(),0);
  ui.time.advance(1);assert.equal(ui.botStarts(),0);ui.time.advance(420);assert.equal(ui.botStarts(),1);
  const cancelled=presentationHarness();cancelled.start();const stale=[...cancelled.time.timers.values()][0].fn;
  cancelled.context.cancelMovement();const renders=cancelled.snapshots.length;
  stale();cancelled.time.advance(10000);assert.equal(cancelled.snapshots.length,renders);assert.equal(cancelled.context.combat,null);
});
