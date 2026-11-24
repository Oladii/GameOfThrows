import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PREVIOUS_FORMATION_CONFIG as DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, move, movementPath, pass, reachable } from '../dist/engine.js';
import { CombatAnimator, MovementAnimator, createMovementPlan, COMBAT_DIM_DURATION, ARROW_REVEAL_INTERVAL, ATTACK_HOLD_DURATION, DEATH_EFFECT_DURATION } from '../dist/move-animation.js';
import { lethalAttackPresentation, renderDamageArrows, renderUnitBadges } from '../dist/board-presentation.js';

const piece = (id,type,team,q,r) => ({id,type,team,q,r});
const position = pieces => ({pieces,turn:0,ply:0,winner:null});
const source = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function declaration(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  const start=match.index, lineEnd=source.indexOf('\n',start);
  return source.slice(start,source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',lineEnd)+2);
}
function clock() {
  let now=0,id=0; const timers=new Map();
  return { timers, now: () => now, setTimer(fn,delay) {timers.set(++id,{at:now+delay,fn});return id;}, clearTimer(id) {timers.delete(id);},
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
  assert.equal((html.match(/class="attack-ray"/g)||[]).length,1);
  const paths=[...html.matchAll(/class="damage-arrow-path" d="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(paths.length,1);
  assert.match(html, /marker-start="url\(#damage-arrow-(?:north|south)\)"/);
  assert.match(html, /marker-end="url\(#damage-arrow-(?:north|south)\)"/);
  assert.doesNotMatch(html,/class="attack-ray-label"/);
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
  const action={id:'mover',from:{q:0,r:0},to:{q:0,r:1}}, result=move(before.state,config,action.id,action.to);
  const forecast=inspectCell(before.state,config,action.to,action.id), time=clock(), snapshots=[];
  let botStarts=0;const sounds=[], movementSounds=[];
  const context=vm.createContext({tableRattle:null,battleIntro:null,config,state:result.state,combat:null,roomMovePreview: null, movement:null,currentDeaths:[],reviewTurn: null, reviewLoading: false, reviewRequest: 0, reviewingTurn: false,lastTurn:null,gamePhase:'playing',editor:false,playMode:mode,humanTeam:0,
    ready:true,botIssue:'',botSuspended:false,botTimer:null,botRunner:{active:false},$:()=>null,lethalAttackPresentation,analyze,inspectCell,selected:null,fieldView:null,history:[],
    movementPath,createMovementPlan,matchMedia:()=>({matches:false}),point:({q,r})=>({x:q*50,y:r*50}),
    gameAudio:{
      play(name){sounds.push(name);return ()=>{};},
      movement(route, pieces, duration, options) {
        const playback = { route: structuredClone(route), duration, instant: options.instant, status: 'playing' };
        movementSounds.push(playback);
        return { finish(){playback.status='finished';}, cancel(){playback.status='cancelled';} };
      }
    },
    toast(message){throw new Error(message);},cancelBot(){time.clearTimer(context.botTimer);context.botTimer=null;},
    setTimeout:(fn,ms)=>time.setTimer(fn,ms),clearTimeout:id=>time.clearTimer(id),highlightSources(){},startBot(){botStarts++;},
    MovementAnimator:class extends MovementAnimator {
      constructor(onFrame,onFinish){super(onFrame,onFinish,{now:time.now,requestFrame:fn=>time.setTimer(fn,10),cancelFrame:time.clearTimer});}
    },
    CombatAnimator:class extends CombatAnimator{constructor(onPhase,onFrame){super(onPhase,onFrame,time);}},
    render(){snapshots.push({phase:context.combat?.phase||'idle',state:structuredClone(context.visibleState())});context.queueBot();}});
  for(const name of ['currentSnapshot','visibleState','isBotTurn','humanCanMove','queueBot','presentKills','reviewBattle','canReviewPrevious','hasPreviousReview','canStepReview','localReviewTurn','showReview','stepReview','cancelMovement','completeMovementPresentation'])vm.runInContext(declaration(name),context);
  const start=source.indexOf('const moveAnimator = new MovementAnimator('),end=source.indexOf('function toast(',start);
  vm.runInContext(source.slice(start,end),context);
  return {context,time,before,result,forecast,snapshots,sounds,movementSounds,
    frame:()=>vm.runInContext('moveAnimator.frame',context),start(){context.presentKills(before,forecast,result.deaths);},botStarts:()=>botStarts,action};
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
  assert.deepEqual(ui.sounds,[],'no removal cue while attacks are being explained');
  ui.time.advance(1);assert.equal(ui.context.combat.phase,'deaths');
  assert.deepEqual(ui.sounds,['remove'],'simultaneous deaths share one quiet cue');
  assert.equal(ui.context.combat.activeDeaths.length,2);
  assert.equal(ui.context.visibleState().turn,0);assert.equal(ui.context.visibleState().pieces.length,2);
  ui.time.advance(DEATH_EFFECT_DURATION-1);assert.ok(ui.context.combat);
  ui.time.advance(1);assert.equal(ui.context.combat,null);assert.equal(ui.context.visibleState().turn,1);
  ui.context.render();assert.deepEqual(ui.sounds,['remove'],'rendering and completion do not repeat removal');
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

test('progressive rendering preserves reveal order and arrow geometry, including merged reciprocal attacks', () => {
  const view=graphPresentation([['z','a'],['a','z'],['m','z']],['z','a']);
  const arrows=view.groups[0].arrows,point=p=>({x:p.q*70,y:p.r*70});
  const full=renderDamageArrows(arrows,point);
  for(let count=1;count<=arrows.length;count++) {
    const html=renderDamageArrows(arrows,point,{visibleCount:count});
    assert.equal((html.match(/class="attack-ray"/g)||[]).length,new Set(arrows.slice(0,count).map(a=>JSON.stringify([a.source.id,a.target.id].sort()))).size);
    assert.equal((html.match(/data-revealing="true"/g)||[]).length,1,'only the latest shaft animates');
    const latestAttack=arrows[count-1];
    const latest=arrows.find(a=>a.source.id===latestAttack.source.id&&a.target.id===latestAttack.target.id||a.source.id===latestAttack.target.id&&a.target.id===latestAttack.source.id);
    assert.match(html,new RegExp(`data-source="${latest.source.id}" data-target="${latest.target.id}"[^>]*data-revealing="true"`));
    for(const path of html.matchAll(/d="(M[^"]+)"/g)) assert.ok(full.includes(path[0]),'existing paths never jump');
  }
});


test('battle is a stable step between the exact positions and can be revisited in both directions', async () => {
  const ui = presentationHarness();
  const ctx = ui.context;
  ctx.lastTurn = { before: ui.before, action: ui.action };
  ctx.history = [{ ...ui.before, action: ui.action }];
  const committed = JSON.stringify({ state: ctx.state, history: ctx.history, lastTurn: ctx.lastTurn });

  await ctx.stepReview(-1);
  assert.equal(ctx.combat.phase, 'dimming');
  assert.equal(ctx.visibleState().pieces.find(p => p.id === 'mover').r, 1);
  assert.equal(ctx.humanCanMove(), false);
  ui.time.advance(10000);
  assert.equal(ctx.combat.phase, 'review');
  assert.equal(ctx.visibleState(), ctx.combat.position);
  assert.equal(ctx.visibleState().pieces.length, ui.before.state.pieces.length);
  assert.equal(ctx.combat.arrows.length, 2);

  await ctx.stepReview(-1);
  assert.equal(ctx.combat, null);
  assert.equal(ctx.movement.piece.id, 'mover');
  assert.deepEqual(ui.movementSounds[0].route, [ui.action.to, ui.action.from]);
  assert.equal(ui.frame().y, 50);
  assert.equal(ctx.canStepReview(), false);
  ui.time.advance(130);
  assert.equal(ui.frame().y, 25);
  await ctx.stepReview(1);
  assert.equal(ui.movementSounds.length, 1, 'a click during movement starts no other step');
  ui.time.advance(130);
  assert.equal(ctx.visibleState(), ui.before.state);
  assert.equal(ui.movementSounds[0].status, 'finished');
  assert.equal(ctx.canReviewPrevious(), false);
  await ctx.stepReview(1);
  assert.deepEqual(ui.movementSounds[1].route, [ui.action.from, ui.action.to]);
  assert.equal(ui.frame().y, 0);
  assert.equal(ctx.combat, null);
  ui.time.advance(260);
  assert.equal(ui.movementSounds[1].status, 'finished');
  assert.equal(ctx.combat.phase, 'dimming');
  await ctx.stepReview(1);
  assert.equal(ctx.visibleState(), ui.result.state);
  assert.equal(ctx.reviewingTurn, false);
  ui.time.advance(10000);
  assert.equal(ctx.combat, null, 'leaving the animation cancels its timers');
  assert.equal(JSON.stringify({ state: ctx.state, history: ctx.history, lastTurn: ctx.lastTurn }), committed);
});

test('the bot waits while the battle step is open and resumes at the live position', async () => {
  const ui = presentationHarness('bot');
  const ctx = ui.context;
  ctx.lastTurn = { before: ui.before, action: ui.action };
  ctx.queueBot();
  assert.notEqual(ctx.botTimer, null);

  await ctx.stepReview(-1);
  ui.time.advance(10000);
  assert.equal(ctx.combat.phase, 'review');
  assert.equal(ui.botStarts(), 0);
  await ctx.stepReview(1);
  ui.time.advance(420);
  assert.equal(ui.botStarts(), 1);
});

test('a quiet reply animates in both directions while the earlier battle is reachable', async () => {
  for (const mode of ['bot', 'online']) {
    const ui = presentationHarness(mode);
    const ctx = ui.context;
    const quietBefore = { ...ui.before, state: ui.result.state };
    const actor = quietBefore.state.pieces.find(p => p.team === quietBefore.state.turn);
    const to = reachable(actor, quietBefore.state, quietBefore.config)[0];
    const quietAction = { id: actor.id, from: { q: actor.q, r: actor.r }, to };
    const outcome = move(quietBefore.state, quietBefore.config, actor.id, to);
    assert.equal(outcome.deaths.length, 0);
    ctx.lastTurn = { before: quietBefore, action: quietAction };
    ctx.state = outcome.state;
    if (mode === 'online') {
      Object.assign(ctx, { log: [], positionKind: 'custom', gameVersion: 'test', clone: structuredClone,
        roomSnapshot: { matchId: 'match', revision: 2 }, roomView: { selfSeat: null },
        roomSession: { async historyPosition(ply) {
          assert.equal(ply, 0);
          return { state: ui.before.state, action: ui.action };
        } } });
    } else ctx.history = [{ ...ui.before, action: ui.action }, { ...quietBefore, action: quietAction }];

    await ctx.stepReview(-1);
    assert.equal(ctx.movement.piece.id, actor.id);
    assert.deepEqual(ui.movementSounds[0].route.at(-1), quietAction.from);
    ui.time.advance(420);
    assert.equal(ctx.visibleState(), quietBefore.state);
    assert.equal(ctx.combat, null);
    await ctx.stepReview(-1);
    assert.equal(ctx.combat.deaths.length, ui.result.deaths.length);
    await ctx.stepReview(1);
    assert.equal(ctx.visibleState(), quietBefore.state);
    await ctx.stepReview(1);
    assert.equal(ctx.movement.piece.id, actor.id);
    assert.deepEqual(ui.movementSounds[1].route.at(-1), { q: to.q, r: to.r });
    ui.time.advance(420);
    assert.equal(ctx.visibleState(), outcome.state);
  }
});

test('reduced motion lands directly on the review position and keeps the instant move sound', async () => {
  const ui = presentationHarness(), ctx = ui.context;
  ctx.matchMedia = () => ({ matches: true });
  ctx.lastTurn = { before: ui.before, action: ui.action };
  await ctx.stepReview(-1);
  await ctx.stepReview(-1);
  assert.equal(ctx.movement, null);
  assert.equal(ctx.visibleState(), ui.before.state);
  assert.deepEqual(ui.movementSounds[0], {
    route: [ui.action.to, ui.action.from], duration: 260, instant: true, status: 'finished'
  });
});

test('a saved pass inserts a battle step only when the calculation has deaths', async () => {
  for (const lethal of [true, false]) {
    const ui = presentationHarness();
    const ctx = ui.context;
    if (lethal) ui.before.state = ui.forecast.position;
    ui.before.config.experiments.allowPass = true;
    ctx.state = pass(ui.before.state, ui.before.config).state;
    ctx.lastTurn = JSON.parse(JSON.stringify({ before: ui.before, action: { pass: true } }));

    await ctx.stepReview(-1);
    assert.equal(Boolean(ctx.combat), lethal);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.visibleState())), ui.before.state);
    if (lethal) await ctx.stepReview(-1);
    assert.equal(ctx.combat, null);
    assert.equal(ctx.canReviewPrevious(), false);
  }
});
