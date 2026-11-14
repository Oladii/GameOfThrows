// Revision 11 regression; the later support buff is covered separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PREVIOUS_ARCHER_CONFIG as DEFAULT_CONFIG,PREVIOUS_LOCAL_CONFIG as CURRENT_CONFIG,PREVIOUS_SMALL_CONFIG,updateSavedBalance} from '../dist/rules.js';
import {clone,createGame,resolve,reachable,move,effective,validateConfig} from '../dist/engine.js';
const p=(id,type,team,q,r)=>({id,type,team,q,r});
const state=pieces=>({pieces,turn:0,ply:0,winner:null});
test('archers gain exactly one attack and range, retaining movement, durability and no aura',()=>{
 const expected=clone(PREVIOUS_SMALL_CONFIG);expected.stats.archer.damage++;expected.stats.archer.range++;
 assert.deepEqual(DEFAULT_CONFIG,expected);
 assert.deepEqual(createGame(DEFAULT_CONFIG),createGame(PREVIOUS_SMALL_CONFIG));
 const a=p('a','archer',0,0,0);assert.deepEqual([effective(a,state([a]),DEFAULT_CONFIG).damage,effective(a,state([a]),DEFAULT_CONFIG).range],[2,4]);
 const old=clone(PREVIOUS_SMALL_CONFIG),before=clone(old);
 assert.deepEqual(updateSavedBalance(old,10),CURRENT_CONFIG);assert.deepEqual(old,before);
 assert.deepEqual(updateSavedBalance(old,11),old);assert.deepEqual(validateConfig(old),old);
 const custom=clone(old);custom.stats.archer.fortitude=5;assert.deepEqual(updateSavedBalance(custom,10),custom);
});
test('two supported archers kill a shield with one defense bonus and three defeat full protection',()=>{
 const archers=[p('a','archer',0,0,-2),p('b','archer',0,-3,0),p('c','archer',0,-2,2)],drum=p('drum','attackLamp',0,-2,0);
 const target=p('target','shield',1,0,0),guard=p('guard','shield',1,1,0),banner=p('banner','defenseLamp',1,0,1);
 const two=resolve(state([...archers.slice(0,2),drum,target,guard]),DEFAULT_CONFIG);
 assert.deepEqual([two.report.get('target').incoming,two.report.get('target').fortitude],[6,6]);
 assert.deepEqual(two.deaths.map(p=>p.id),['target']);
 const defended=resolve(state([...archers.slice(0,2),drum,target,guard,banner]),DEFAULT_CONFIG);
 assert.deepEqual([defended.report.get('target').incoming,defended.report.get('target').fortitude,defended.report.get('target').dead],[6,7,false]);
 const three=resolve(state([...archers,drum,target,guard,banner]),DEFAULT_CONFIG);
 assert.deepEqual([three.report.get('target').incoming,three.report.get('target').fortitude],[9,7]);
 assert.deepEqual(three.deaths.map(p=>p.id),['target']);
});
test('the direct buff permits early losses, rather than preserving the former two-action guarantee',()=>{
 const c=DEFAULT_CONFIG,legal=s=>s.pieces.filter(p=>p.team===s.turn).flatMap(p=>reachable(p,s,c).map(to=>({id:p.id,to})));
 for(const first of[0,1]){
  const s=createGame(c);s.turn=first;let firstLossActions=0,secondLossPairs=0,pairs=0;
  for(const a of legal(s)){const x=move(s,c,a.id,a.to);firstLossActions+=+(x.deaths.length>0);for(const b of legal(x.state)){pairs++;secondLossPairs+=+(move(x.state,c,b.id,b.to).deaths.length>0);}}
  assert.deepEqual({firstLossActions,secondLossPairs,pairs},{firstLossActions:6,secondLossPairs:544,pairs:7056});
 }
});
