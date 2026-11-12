import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// These five archived lessons retain the previous local schema.
const TYPES = ['shield','archer','attackLamp','defenseLamp','scoutLamp'];
import {attackCellsFor, renderUnitBadges} from '../dist/board-presentation.js';
import {createUnitLesson} from '../dist/onboarding-units.js';
import {renderMoveLesson} from '../dist/onboarding-examples.js';
const keys=html=>[...html.matchAll(/data-threat-cell="([^"]+)"/g)].map(x=>x[1]).sort();
test('unit markers match real attacks for selection and projected movement, leaving allies unmarked',()=>{
 for(const type of TYPES)for(const preview of [false,true]){
  const destination=type==='shield'?{q:0,r:2}:type==='archer'?{q:-1,r:1}:{q:1,r:-2};
  // The flag uses its own reachable destination.
  const lesson=createUnitLesson(type,{selected:true,...(preview?{destination:type==='defenseLamp'?{q:-1,r:0}:destination}:{})});
  const state=lesson.previewPosition,piece=state.pieces.find(p=>p.id===lesson.selectedId);
  const friendly=new Set([...state.pieces,...lesson.position.pieces].filter(p=>p.team===piece.team).map(p=>`${p.q},${p.r}`));
  const expected=attackCellsFor(piece,state,lesson.config).map(p=>`${p.q},${p.r}`).filter(k=>!friendly.has(k)).sort();
  const html=renderMoveLesson(lesson,{});assert.deepEqual(keys(html),expected);
  if(expected.length)assert.match(html,/attack-target-(?:weapon|fill|outline) south/);
  if(['scoutLamp','attackLamp','defenseLamp'].includes(type))assert.equal(expected.length,0,'unarmed support has no weapon markers');
 }
 const lethal=renderMoveLesson(createUnitLesson('shield',{selected:true,destination:{q:0,r:2}}),{},renderUnitBadges);
 assert.match(lethal,/incoming-indicator lethal/);
 assert.deepEqual(keys(renderMoveLesson(createUnitLesson('shield'),{})),[]);
});
test('unit objectives specify the chosen figure and a concrete outcome; shield example has no flag',()=>{
 assert.equal(createUnitLesson('shield').before.pieces.some(p=>p.type==='defenseLamp'),false);
 assert.match(createUnitLesson('shield').feedback,/со щитом.*уничтожить врага и выжить/);
 for(const type of TYPES)assert.ok(createUnitLesson(type).feedback.length>70);
 const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
 const refresh=app.slice(app.indexOf('function refreshOnboardingMovePreview('),app.indexOf('function onboardingPreviewTarget('));
 assert.match(refresh,/\.lesson-attack-reach/,'pointer/focus previews refresh the attack layer');
});
