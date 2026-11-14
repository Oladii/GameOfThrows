import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, clone } from '../dist/engine.js';
import { inspectionDamageArrows, layoutDamageArrows } from '../dist/board-presentation.js';
const fixture = () => ({pieces:[{id:'own',type:'archer',team:0,q:0,r:0},{id:'enemy1',type:'shield',team:1,q:2,r:0},{id:'enemy2',type:'archer',team:1,q:0,r:3},{id:'ally',type:'archer',team:0,q:0,r:1}],turn:0,ply:0,winner:null});

test('selected friendly unit displays incoming and every outgoing attack without friendly fire',()=>{
 const state=fixture(),report=analyze(state,DEFAULT_CONFIG);
 const arrows=inspectionDamageArrows(state.pieces[0],'own',state,report,0);
 assert.ok(arrows.some(a=>a.source.id==='enemy2'&&a.target.id==='own'));
 assert.deepEqual(arrows.filter(a=>a.source.id==='own').map(a=>a.target.id).sort(),['enemy1','enemy2']);
 assert.ok(!arrows.some(a=>a.source.id==='own'&&a.target.id==='ally'));
 assert.equal(new Set(arrows.map(a=>`${a.source.id}:${a.target.id}`)).size,arrows.length);
});

test('hovered enemy rays do not duplicate selected unit attacks or show enemy outgoing rays',()=>{
 const state=fixture(),report=analyze(state,DEFAULT_CONFIG),target=state.pieces[2];
 const arrows=inspectionDamageArrows(target,'own',state,report,0);
 assert.equal(arrows.filter(a=>a.source.id==='own'&&a.target.id==='enemy2').length,1);
 assert.ok(arrows.some(a=>a.source.id==='own'&&a.target.id==='enemy1'));
 const enemySelected=inspectionDamageArrows(target,'enemy2',state,report,0);
 assert.ok(enemySelected.every(a=>a.target.id==='enemy2'));
});

test('forecast outgoing rays use the future position, buffs and blocking rules',()=>{
 const state=fixture(),config=clone(DEFAULT_CONFIG);
 const preview=inspectCell(state,config,{q:1,r:0},'own');
 assert.equal(preview.isPreview,true);
 const rays=inspectionDamageArrows(preview.piece,'own',preview.position,preview.report,0);
 for(const ray of rays.filter(a=>a.source.id==='own')) {
  assert.deepEqual([ray.source.q,ray.source.r],[1,0]);
  assert.equal(ray.damage,preview.report.get(ray.target.id).attackers.find(a=>a.id==='own').damage);
 }
 assert.ok(rays.some(a=>a.source.id==='own'&&a.target.id==='enemy1'));
 assert.ok(!rays.some(a=>a.source.id==='own'&&a.target.id==='enemy2'));
});

test('reciprocal straight attack arrows have separate paths and readable labels',()=>{
 const own={id:'a',q:0,r:0},enemy={id:'b',q:3,r:0},point=p=>({x:p.q*50,y:p.r*50});
 const edges=layoutDamageArrows([{source:own,target:enemy,damage:2},{source:enemy,target:own,damage:3}],point,{straight:true});
 assert.equal(edges.length,2);
 assert.notEqual(edges[0].label.y,edges[1].label.y);
 assert.ok(Math.abs(edges[0].label.y-edges[1].label.y)>=18);
});
