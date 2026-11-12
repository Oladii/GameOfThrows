import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TYPES } from '../dist/rules.js';
import { attackCellsFor,renderUnitBadges } from '../dist/board-presentation.js';
import { createUnitLesson } from '../dist/onboarding-units.js';
import { renderMoveLesson } from '../dist/onboarding-examples.js';
const keys=html=>[...html.matchAll(/data-threat-cell="([^"]+)"/g)].map(match=>match[1]).sort();
test('all six current unit markers match native attack cells in selected and forecast positions and leave allies unmarked',()=>{
  for(const type of TYPES)for(const preview of [false,true]){
    const initial=createUnitLesson(type),lesson=createUnitLesson(type,{selected:true,...(preview?{destination:initial.solution[0].to}:{})}),state=lesson.previewPosition,piece=state.pieces.find(p=>p.id===lesson.selectedId);
    const friendly=new Set([...state.pieces,...lesson.position.pieces].filter(p=>p.team===piece.team).map(p=>`${p.q},${p.r}`)),expected=attackCellsFor(piece,state,lesson.config).map(p=>`${p.q},${p.r}`).filter(key=>!friendly.has(key)).sort();
    const html=renderMoveLesson(lesson,{});assert.deepEqual(keys(html),expected,type);if(expected.length)assert.match(html,/attack-target-(?:weapon|fill|outline) south/);
    if(['attackLamp','defenseLamp','horn'].includes(type))assert.equal(expected.length,0,'unarmed support has no weapon markers');if(type==='scoutLamp')assert.ok(expected.length>0,'commander attacks independently');
  }
  const lethal=renderMoveLesson(createUnitLesson('shield',{selected:true,destination:{q:0,r:2}}),{},renderUnitBadges);assert.match(lethal,/incoming-indicator lethal/);assert.deepEqual(keys(renderMoveLesson(createUnitLesson('shield'),{})),[]);
});
test('each current figure has a concrete interactive objective and live previews update the attack layer',()=>{
  for(const type of TYPES){const lesson=createUnitLesson(type);assert.ok(lesson.objective.length>25);assert.ok(lesson.feedback.length>30);assert.equal(lesson.success,false);}
  const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),refresh=app.slice(app.indexOf('function refreshOnboardingMovePreview('),app.indexOf('function onboardingPreviewTarget('));assert.match(refresh,/\.lesson-attack-reach/);
});
