import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, move, inspectCell } from '../dist/engine.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { ShowcaseBattle, renderShowcaseBattle } from '../dist/onboarding-showcase.js';
import { renderUnitBadges } from '../dist/board-presentation.js';

test('flag aura saves its defender until the guided flag move takes it out of range',()=>{
  let id=0;const timers=new Map();
  const battle=new ShowcaseBattle({sceneKey:'unit-flag-defense',reducedMotion:()=>true,
    clock:{setTimer:fn=>(timers.set(++id,fn),id),clearTimer:id=>timers.delete(id)}});
  const initial=structuredClone(battle.position),report=analyze(initial,battle.config);
  assert.deepEqual(battle.config.stats,DEFAULT_CONFIG.stats);
  assert.equal(battle.title,'Флаг — не обуза');
  assert.deepEqual([report.get('blue').fortitude,report.get('blue').incoming,report.get('blue').dead],[6,5,false]);
  assert.equal(report.get('enemy').dead,false);
  assert.equal(move(initial,battle.config,'flag',{q:1,r:1}).report.get('blue').dead,false);
  const action=battle.expectedAction;
  assert.deepEqual(action,{id:'flag',to:{q:0,r:3}});
  const forecast=inspectCell(initial,battle.config,action.to,action.id);
  assert.deepEqual([forecast.report.get('blue').fortitude,forecast.report.get('blue').incoming,forecast.report.get('blue').dead],[5,5,true]);
  battle.selectPiece('flag');battle.preview(action.to);
  assert.match(renderShowcaseBattle(battle,{},renderUnitBadges),/piece training-piece south fatal[^>]*data-showcase-piece="blue"/);
  assert.deepEqual(battle.position,initial);
  assert.equal(battle.moveTo({q:1,r:1}),false);
  assert.equal(battle.moveTo(action.to),true);
  let limit=30;
  while(battle.presentation&&limit--){const [id,fn]=[...timers][0];timers.delete(id);fn();}
  assert.ok(limit>0);
  assert.equal(battle.phase,'finished');
  assert.equal(battle.position.pieces.some(p=>p.id==='blue'),false);
  assert.ok(battle.position.pieces.some(p=>p.id==='flag'));
  assert.ok(battle.position.pieces.some(p=>p.id==='enemy'));
  assert.match(renderShowcaseBattle(battle),/защитник погиб/);
  battle.restart();assert.deepEqual(battle.position,initial);assert.equal(timers.size,0);
});
