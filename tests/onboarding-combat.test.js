import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatLesson, renderCombatExamples } from '../dist/onboarding-examples.js';
import { analyze, move, winnerForPieces } from '../dist/engine.js';

test('leaving fire removes incoming damage while full fortitude stays5 and no damage is carried over',()=>{
  const initial=createCombatLesson(0);assert.equal(initial.report.get('blue').incoming,2);assert.equal(initial.report.get('blue').fortitude,5);assert.equal(initial.success,false);
  const safe=createCombatLesson(0,{advanced:true,destination:initial.solution[0].to});assert.equal(safe.report.get('blue').incoming,0);assert.equal(safe.report.get('blue').fortitude,5);assert.equal(safe.success,true);
  const exposed=createCombatLesson(0,{advanced:true,destination:{q:0,r:1}});assert.equal(exposed.report.get('blue').incoming,2);assert.equal(analyze(exposed.position,exposed.config).get('blue').fortitude,5);assert.equal(exposed.success,false);
  assert.match(safe.feedback,/стойкость 5/);assert.match(safe.feedback,/Входящего урона нет/);
});

test('two actual shots sum to4 against fortitude3, while the same move with one archer leaves the target alive',()=>{
  const initial=createCombatLesson(1);assert.equal(initial.report.get('enemy').incoming,2);assert.equal(initial.report.get('enemy').dead,false);
  const to=initial.solution[0].to,two=createCombatLesson(1,{advanced:true,destination:to}),one=createCombatLesson(1,{advanced:true,destination:to,secondArcher:false});
  assert.equal(two.report.get('enemy').incoming,4);assert.equal(two.report.get('enemy').fortitude,3);assert.equal(two.success,true);assert.ok(!two.position.pieces.some(p=>p.id==='enemy'));
  assert.equal(one.report.get('enemy').incoming,2);assert.equal(one.success,false);assert.ok(one.position.pieces.some(p=>p.id==='enemy'));assert.equal(analyze(one.position,one.config).get('enemy').fortitude,3);
  assert.match(two.feedback,/4 урона при стойкости 3/);assert.match(one.feedback,/Одной стрелы не хватает/);
});

test('ordinary shields deal5 at range1 and die simultaneously; drum affects movement rather than attack',()=>{
  const initial=createCombatLesson(2);assert.equal(initial.report.get('blue').damage,5);assert.equal(initial.report.get('blue').range,1);assert.equal(initial.report.get('blue').incoming,0);assert.equal(initial.success,false);
  const done=createCombatLesson(2,{advanced:true,destination:initial.solution[0].to});assert.deepEqual(done.deaths.map(p=>p.id),['blue','enemy']);assert.equal(done.report.get('blue').incoming,5);assert.equal(done.report.get('enemy').incoming,5);assert.equal(done.position.pieces.length,2);assert.equal(done.success,true);assert.match(done.feedback,/одновременно/);
});

test('flag exercise uses the actual victory rule and wins with an enemy combat unit still alive',()=>{
  const initial=createCombatLesson(3);assert.equal(initial.config.victoryCondition,'flag-or-combat');assert.equal(initial.before.pieces.filter(p=>p.type==='defenseLamp').length,2);assert.equal(initial.report.get('enemy').incoming,0);assert.equal(winnerForPieces(initial.before.pieces,initial.config),null);
  const to=initial.solution[0].to,preview=createCombatLesson(3,{selected:true,destination:to}),done=createCombatLesson(3,{advanced:true,destination:to});
  assert.equal(preview.report.get('enemy').incoming,3);assert.equal(preview.previewSuccess,true);assert.deepEqual(preview.position,initial.position);
  assert.deepEqual(done.position,move(initial.before,initial.config,'blue',to).state);assert.equal(done.position.winner,0);assert.ok(done.position.pieces.some(p=>p.id==='enemy-fighter'));assert.ok(done.position.pieces.some(p=>p.id==='own-fighter'));assert.ok(!done.position.pieces.some(p=>p.id==='enemy'));assert.equal(done.success,true);assert.match(done.feedback,/остался броненосец/);assert.match(done.feedback,/победу Югу/);
});

test('combat page has four independent resettable boards and marks the real flag-rule scene',()=>{
  const html=renderCombatExamples({},{});assert.equal((html.match(/data-lesson-scene=/g)||[]).length,4);assert.equal((html.match(/data-lesson-action="reset"/g)||[]).length,4);assert.match(html,/data-lesson-scene="11"/);assert.match(html,/настоящее правило/);
});
