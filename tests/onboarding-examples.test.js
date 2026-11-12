import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, validateState, validateConfig, inspectCell, move, reachable, movementPath, effective, distance } from '../dist/engine.js';
import { MOVE_LESSONS, createMoveLesson, renderMoveLesson, renderMoveExamples } from '../dist/onboarding-examples.js';
import { tutorialCases } from './fixtures/tutorial-cases.js';

const sameCell=(a,b)=>a.q===b.q&&a.r===b.r;

test('all16 current tutorial scenes have unchanged game stats, an unmet goal, legal solution, truthful forecast and native result',()=>{
  const defaults=clone(DEFAULT_CONFIG),cases=tutorialCases();assert.equal(cases.length,16);assert.equal(MOVE_LESSONS.length,6);
  for(const {key,make}of cases){
    const initial=make({}),before=clone(initial.before),config=clone(initial.config),solution=initial.solution[0];
    assert.equal(initial.success,false,key);assert.equal(initial.previewSuccess,false,key);assert.ok(initial.objective.length>25,key);assert.ok(initial.feedback.length>30,key);
    assert.deepEqual(initial.config.stats,DEFAULT_CONFIG.stats,key);assert.deepEqual(initial.config.shieldPromotion,DEFAULT_CONFIG.shieldPromotion,key);assert.deepEqual(initial.config.army,DEFAULT_CONFIG.army,key);
    assert.deepEqual(validateConfig(initial.config),initial.config,key);assert.deepEqual(validateState(initial.before,initial.config),initial.before,key);
    const settings=clone(initial.config);settings.size=DEFAULT_CONFIG.size;settings.victoryCondition=DEFAULT_CONFIG.victoryCondition;assert.deepEqual(settings,DEFAULT_CONFIG,key);
    const mover=initial.before.pieces.find(p=>p.id===solution.id);assert.ok(reachable(mover,initial.before,initial.config).some(cell=>sameCell(cell,solution.to)),key);
    const options={selected:true,destination:clone(solution.to)},preview=make(options),nativeForecast=inspectCell(before,config,solution.to,solution.id);
    assert.deepEqual(preview.position,initial.position,key);assert.deepEqual([...preview.report],[...nativeForecast.report],key);assert.equal(preview.isPreview,true,key);
    const complete=make({selected:true,advanced:true,destination:solution.to}),native=move(before,config,solution.id,solution.to);
    assert.equal(complete.success,true,key);assert.equal(complete.completed,true,key);assert.deepEqual(complete.position,native.state,key);assert.deepEqual(complete.deaths,native.deaths,key);assert.deepEqual([...complete.report],[...native.report],key);assert.match(complete.feedback,/Цель выполнена/);
    assert.deepEqual(initial.before,before,key);assert.deepEqual(initial.config,config,key);assert.deepEqual(options,{selected:true,destination:solution.to},key);
    const reset=make({});assert.deepEqual(reset.before,before,key);assert.deepEqual(reset.position,before,key);assert.equal(reset.success,false,key);
    assert.match(initial.hint,initial.matchRules?/настоящее правило/:/Учебная цель/);
  }
  assert.deepEqual(DEFAULT_CONFIG,defaults);
});

test('movement starts unselected and only selection reveals legal controls; reset clears the forecast',()=>{
  const initial=createMoveLesson(0),html=renderMoveLesson(initial,{});assert.deepEqual(initial.available,[]);assert.deepEqual(initial.path,[]);assert.equal(initial.destination,null);
  assert.match(html,/data-lesson-unit="blue" role="button" tabindex="0" aria-pressed="false"/);assert.match(html,/data-lesson-action="reset"/);
  assert.doesNotMatch(html,/data-lesson-selected-unit|class="lesson-path-number"|class="lesson-path"| lesson-available/);
  const active=createMoveLesson(0,{selected:true});assert.ok(active.available.length);assert.match(renderMoveLesson(active,{}),/data-lesson-selected-unit="blue"/);
  assert.equal(createMoveLesson(0,{destination:{q:-2,r:3}}).destination,null);
  assert.deepEqual(createMoveLesson(0).position,initial.position);
});

test('drum grants a real third step to every type; the legal three-step route keeps its allowance after leaving the aura',()=>{
  const initial=createMoveLesson(0),mover=initial.before.pieces.find(p=>p.id==='blue'),destination=initial.solution[0].to;
  assert.equal(initial.config.stats.archer.move,2);assert.equal(initial.beforeReport.get('blue').move,3);
  const active=createMoveLesson(0,{selected:true,destination}),done=createMoveLesson(0,{advanced:true,destination});
  assert.equal(active.path.length,4);assert.equal(active.passesAlly,true);assert.equal(done.report.get('blue').move,2);assert.equal(done.success,true);
  for(let i=1;i<active.path.length;i++)assert.equal(distance(active.path[i-1],active.path[i],initial.config),1);
  assert.ok(active.path.slice(1,-1).some(cell=>initial.before.pieces.some(p=>p.id==='friend'&&sameCell(p,cell))));
  const withoutDrum={...initial.before,pieces:initial.before.pieces.filter(p=>p.id!=='drum')};assert.deepEqual(movementPath(mover,withoutDrum,initial.config,destination),[]);
  for(const type of Object.keys(DEFAULT_CONFIG.stats)){
    const target={id:'target',type,team:0,q:1,r:0},drum={id:'drum',type:'attackLamp',team:0,q:0,r:0},state={pieces:[target,drum],turn:0,ply:0,winner:null};
    assert.equal(effective(target,state,initial.config).move,DEFAULT_CONFIG.stats[type].move+1,type);
  }
  const rendered=renderMoveLesson(active,{});for(const step of [1,2,3])assert.ok(rendered.includes(`y=".35em">${step}</text>`));
});

test('occupied cells cannot be destinations; an enemy blocks passage while an ally allows passing',()=>{
  const initial=createMoveLesson(0),active=createMoveLesson(0,{selected:true}),mover=initial.before.pieces[0];
  for(const occupied of initial.before.pieces)assert.ok(!active.available.some(cell=>sameCell(cell,occupied)));
  assert.deepEqual(movementPath(mover,initial.before,initial.config,{q:1,r:0}),[]);
  assert.ok(active.enemyBlocked.some(cell=>sameCell(cell,{q:1,r:0})));
  assert.throws(()=>createMoveLesson(0,{selected:true,destination:{q:99,r:99}}),/Недоступная/);
});

test('shield blockage and range exercises require a real move and preserve a safe archer',()=>{
  for(const index of [2,3]){
    const initial=createMoveLesson(index);assert.equal(initial.report.get('enemy').incoming,0);
    const done=createMoveLesson(index,{advanced:true,destination:initial.solution[0].to});assert.ok(done.report.get('enemy').incoming>0);assert.equal(done.report.get('blue').dead,false);assert.equal(done.success,true);
  }
  const initial=createMoveLesson(2),without=createMoveLesson(2,{shieldRemoved:true});assert.ok(initial.before.pieces.some(p=>p.id==='wall'));assert.ok(!without.position.pieces.some(p=>p.id==='wall'));assert.ok(without.report.get('enemy').incoming>0);assert.deepEqual(createMoveLesson(2).before,initial.before);
});

test('horn and flag aura controls preview, commit, deselect and reset with current support roles',()=>{
  for(const aura of ['attack','defense']){
    const initial=createMoveLesson(4,{aura}),destination=initial.solution[0].to;
    const preview=createMoveLesson(4,{aura,selected:true,previewPlacement:destination});assert.equal(preview.isPreview,true);assert.deepEqual(preview.position,initial.position);
    const done=createMoveLesson(4,{aura,selected:true,placement:destination});assert.equal(done.success,true);assert.equal(done.completed,true);assert.deepEqual(done.available,[]);
    assert.match(renderMoveLesson(preview,{}),/class="aura-ring"/);assert.doesNotMatch(renderMoveLesson(createMoveLesson(4,{aura,placement:destination}),{}),/class="aura-ring"/);
    assert.deepEqual(createMoveLesson(4,{aura}).position,initial.position);
  }
  const horn=createMoveLesson(4,{aura:'attack',placement:{q:-1,r:0}});assert.equal(horn.report.get('blue').damage,3);assert.equal(horn.report.get('support').damage,0);assert.equal(horn.report.get('enemy').incoming,3);
  const flag=createMoveLesson(4,{aura:'defense',placement:{q:-1,r:1}});assert.equal(flag.report.get('blue').fortitude,4);assert.equal(flag.report.get('blue').incoming,3);assert.equal(flag.report.get('support').fortitude,3);
});

test('rendered lesson page exposes six distinct boards, goals, keyboard controls and a current-rules disclaimer',()=>{
  const html=renderMoveExamples({},{});assert.equal((html.match(/data-lesson-scene=/g)||[]).length,6);assert.equal((html.match(/data-lesson-action="reset"/g)||[]).length,6);
  for(const key of ['0','1','2','3','4-attack','4-defense'])assert.ok(html.includes(`data-lesson-scene="${key}"`));
  assert.match(html,/полная стойкость/);assert.match(html,/Ваша партия не изменится|вашу партию/);assert.doesNotMatch(html,/стойкость после ожидаемого урона|Исторические учебные/);
  for(const name of ['onboarding-examples.js','onboarding-units.js','onboarding-showcase.js'])assert.doesNotMatch(fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8'),/PREVIOUS_LOCAL_CONFIG|localStorage|archiveRecorder/);
});
