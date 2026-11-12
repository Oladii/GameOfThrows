import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatLesson, lessonPoint, renderMoveLesson } from '../dist/onboarding-examples.js';
import { reachable } from '../dist/engine.js';
import { tutorialCases } from './fixtures/tutorial-cases.js';

test('all16 current exercises face the opponent upwards and have an upward legal solution',()=>{
  for(const {key,make}of tutorialCases()){
    const lesson=make({}),point=lesson.point||lessonPoint,mover=lesson.before.pieces.find(p=>p.id===lesson.moverId),enemy=lesson.before.pieces.find(p=>p.id==='enemy'),goal=lesson.solution[0].to;
    assert.ok(point(enemy).y<point(mover).y,key+': opponent above controlled unit');assert.ok(point(goal).y<point(mover).y,key+': solution goes upwards');assert.ok(reachable(mover,lesson.before,lesson.config).some(p=>p.q===goal.q&&p.r===goal.r),key+': solution is legal');
  }
});

test('forecast and moving token share the upward board geometry',()=>{
  const goal={q:0,r:1},lesson=createCombatLesson(2,{selected:true,destination:goal}),p=lessonPoint(goal),origin=lessonPoint({q:0,r:0});
  assert.ok(renderMoveLesson(lesson,{}).includes(`class="lesson-preview-piece" transform="translate(${p.x},${p.y})"`));assert.ok(renderMoveLesson(lesson,{},()=>'',{phase:'movement',frame:{...origin,progress:0}}).includes(`data-progress="0" transform="translate(${origin.x},${origin.y})"`));assert.ok(p.y<origin.y);
});
