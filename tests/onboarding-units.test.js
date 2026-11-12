import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, TYPES } from '../dist/rules.js';
import { analyze, clone, effective, shieldCanRetreat, move } from '../dist/engine.js';
import { createUnitLesson, renderUnitExamples, badgeExamples } from '../dist/onboarding-units.js';
import { createPositionLesson, renderMoveLesson } from '../dist/onboarding-examples.js';

test('badges show actual full fortitude and independent incoming damage; all six current roles are interactive',()=>{
  const [safe,hit,lethal]=badgeExamples();assert.deepEqual([safe.info.damage,safe.info.fortitude,safe.info.incoming],[5,5,0]);assert.deepEqual([hit.info.fortitude,hit.info.incoming,hit.info.dead],[5,2,false]);assert.deepEqual([lethal.info.incoming,lethal.info.dead],[7,true]);
  const html=renderUnitExamples({},{});assert.equal((html.match(/data-lesson-scene="unit-/g)||[]).length,6);assert.match(html,/Справа — полная стойкость/);assert.match(html,/прошлый урон не накапливается/);
  for(const type of TYPES)assert.ok(html.includes(`data-lesson-scene="unit-${type}"`));assert.doesNotMatch(html,/Исторические учебные/);
});

test('each unit uses current stats and provides a legal engine-verified solution with reset and feedback',()=>{
  for(const type of TYPES){const initial=createUnitLesson(type),to=initial.solution[0].to;assert.deepEqual(initial.config.stats,DEFAULT_CONFIG.stats);assert.equal(initial.success,false);assert.deepEqual(initial.available,[]);assert.deepEqual(initial.auraCells,[]);
    const preview=createUnitLesson(type,{selected:true,destination:to});assert.deepEqual(preview.position,initial.position);assert.equal(preview.isPreview,true);
    const done=createUnitLesson(type,{advanced:true,destination:to});assert.equal(done.success,true,type);assert.deepEqual(done.position,move(initial.before,initial.config,initial.moverId,to).state);assert.match(done.feedback,/Цель выполнена/);assert.deepEqual(done.available,[]);
    done.config.stats[type].move=99;assert.deepEqual(createUnitLesson(type).before,initial.before);assert.deepEqual(createUnitLesson(type).config.stats,DEFAULT_CONFIG.stats);
  }
});

test('ordinary shield defense reaches an archer and stacks with veteran defense while ordinary range stays1',()=>{
  const initial=createUnitLesson('shield'),ally=initial.before.pieces.find(p=>p.id==='ally');assert.equal(initial.report.get('ally').fortitude,5);assert.deepEqual(initial.report.get('ally').sources,['blue','veteran']);
  const without=analyze({...initial.before,pieces:initial.before.pieces.filter(p=>p.id!=='blue')},initial.config);assert.equal(without.get('ally').fortitude,4);
  const done=createUnitLesson('shield',{advanced:true,destination:{q:0,r:2}});assert.equal(done.report.get('blue').range,1);assert.equal(done.report.get('blue').damage,6);assert.equal(done.report.get('blue').fortitude,6);assert.equal(done.report.get('blue').dead,false);
  assert.equal(shieldCanRetreat(initial.before.pieces.find(p=>p.id==='veteran'),initial.config),true);assert.equal(effective(ally,initial.before,initial.config).fortitude,5);
});

test('the veteran remains selectable and a real move still supports the ordinary shield',()=>{
  const initial=createUnitLesson('shield'),preview=createUnitLesson('shield',{selected:true,selectedId:'veteran',destination:{q:0,r:2}});
  assert.equal(preview.moverId,'veteran');assert.equal(preview.report.get('blue').damage,6);assert.equal(preview.report.get('blue').fortitude,6);assert.equal(preview.report.get('blue').range,1);
  const html=renderMoveLesson(preview,{});assert.ok(html.includes('data-lesson-unit="veteran"'));assert.ok(html.includes('data-lesson-selected-unit="veteran"'));assert.deepEqual(preview.position,initial.position);
});

test('drum grants movement rather than damage; horn grants damage including to archers without attacking itself',()=>{
  const drum=createUnitLesson('attackLamp',{advanced:true,destination:{q:0,r:-1}});assert.equal(drum.report.get('blue').move,3);assert.equal(drum.report.get('blue').damage,2);assert.equal(drum.report.get('support').move,2);assert.equal(drum.report.get('support').damage,0);
  const horn=createUnitLesson('horn',{advanced:true,destination:{q:-1,r:0}});assert.equal(horn.report.get('blue').damage,3);assert.equal(horn.report.get('enemy').incoming,3);assert.equal(horn.report.get('support').damage,0);assert.equal(horn.report.get('support').range,0);
  for(const type of TYPES){const source={id:'horn',type:'horn',team:0,q:0,r:0},target={id:'target',type,team:0,q:1,r:0},config=clone(DEFAULT_CONFIG);const report=analyze({pieces:[source,target],turn:0,ply:0,winner:null},config).get('target');if(['shield','archer','scoutLamp'].includes(type))assert.equal(report.damage,config.stats[type].damage+1,type);else assert.equal(report.damage,0,type);}
});

test('commander attacks independently for3 at range2 and grants archer range4→5 without self range',()=>{
  const initial=createUnitLesson('scoutLamp'),done=createUnitLesson('scoutLamp',{advanced:true,destination:{q:1,r:-1}});
  assert.equal(initial.report.get('support').damage,3);assert.equal(initial.report.get('support').range,2);assert.equal(initial.report.get('blue').range,5);
  const without=analyze({...initial.before,pieces:initial.before.pieces.filter(p=>p.id!=='support')},initial.config);assert.equal(without.get('blue').range,4);
  assert.equal(done.report.get('support').range,2);assert.ok(done.report.get('enemy').attackers.some(p=>p.id==='support'&&p.damage===3));assert.match(done.description,/Аура|аура/);
});

test('flag has radius3 and fortitude3, protects the archer with+1 and does not protect itself',()=>{
  const initial=createUnitLesson('defenseLamp'),done=createUnitLesson('defenseLamp',{advanced:true,destination:{q:-1,r:1}});assert.equal(initial.config.stats.defenseLamp.aura,3);assert.equal(initial.report.get('blue').dead,true);assert.equal(done.report.get('blue').fortitude,4);assert.equal(done.report.get('blue').incoming,3);assert.equal(done.report.get('blue').dead,false);assert.equal(done.report.get('support').fortitude,3);
});

test('edge promotion uses current personal and allied bonuses without mutating the supplied position',()=>{
  const pieces=[{id:'blue',type:'shield',team:0,q:-2,r:2},{id:'veteran',type:'shield',team:0,q:-1,r:3,reachedFarEdge:true},{id:'enemy',type:'shield',team:1,q:2,r:-2}],before=clone(pieces);
  const done=createPositionLesson(pieces,'blue',{advanced:true,destination:{q:-2,r:3}});assert.equal(done.position.pieces.find(p=>p.id==='blue').reachedFarEdge,true);assert.equal(done.report.get('blue').damage,7);assert.equal(done.report.get('veteran').damage,7);assert.deepEqual(pieces,before);
});
