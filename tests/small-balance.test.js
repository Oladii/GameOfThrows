// Revision 10 regression fixtures; current archer upgrades are covered in archer-buff.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PREVIOUS_SMALL_CONFIG as DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG as CURRENT_CONFIG, PREVIOUS_FORMATION_CONFIG, BALANCE_REVISION, updateSavedBalance} from '../dist/rules.js';
import {clone, createGame, validateConfig, effective, auraReaches, resolve, reachable, move} from '../dist/engine.js';
import {alliedBonusDetails} from '../dist/board-presentation.js';

const p=(id,type,team,q,r,v=false)=>({id,type,team,q,r,...(v?{reachedFarEdge:true}:{})});
const state=pieces=>({pieces,turn:0,ply:0,winner:null});
test('small balance preserves the exact formation and upgrades only a former complete standard setup',()=>{
 assert.equal(BALANCE_REVISION,22);
 assert.deepEqual(createGame(DEFAULT_CONFIG).pieces,createGame(PREVIOUS_FORMATION_CONFIG).pieces);
 assert.deepEqual(['shield','archer','attackLamp','defenseLamp','scoutLamp'].map(t=>[DEFAULT_CONFIG.stats[t].damage,DEFAULT_CONFIG.stats[t].fortitude]),[[4,5],[1,4],[0,2],[0,2],[0,2]]);
 assert.deepEqual([DEFAULT_CONFIG.stats.archer.move,DEFAULT_CONFIG.stats.archer.range,DEFAULT_CONFIG.stats.archer.aura,DEFAULT_CONFIG.stats.archer.damageBonus],[2,3,0,0]);
 assert.equal(DEFAULT_CONFIG.auraDefenseCap,2);assert.equal(DEFAULT_CONFIG.shieldDefenseOnly,true);
 const old=clone(PREVIOUS_FORMATION_CONFIG),before=clone(old);
 assert.deepEqual(updateSavedBalance(old,9),CURRENT_CONFIG);assert.deepEqual(old,before);
 assert.deepEqual(updateSavedBalance(old,10),old);
 const custom=clone(old);custom.stats.shield.fortitude=7;assert.deepEqual(updateSavedBalance(custom,9),custom);
 assert.deepEqual(validateConfig(old),old,'imported historical games retain their old rules');
});
test('shield protection reaches only shields while veteran offense and banner protection remain available',()=>{
 const shield=p('s','shield',0,0,0),archer=p('a','archer',0,1,0),support=p('d','attackLamp',0,0,1),other=p('o','shield',0,-1,0);
 const s=state([shield,archer,support,other]);
 assert.equal(effective(archer,s,DEFAULT_CONFIG).fortitude,4);
 assert.equal(effective(support,s,DEFAULT_CONFIG).fortitude,2);
 assert.equal(effective(other,s,DEFAULT_CONFIG).fortitude,6);
 assert.equal(auraReaches(shield,archer,s,DEFAULT_CONFIG),false);
 assert.equal(auraReaches(shield,{q:1,r:0},s,DEFAULT_CONFIG),true,'empty-cell coverage remains available to the board');
 shield.reachedFarEdge=true;
 const v=effective(shield,state([shield]),DEFAULT_CONFIG);assert.deepEqual([v.damage,v.fortitude,v.range],[6,6,3]);
 const a=effective(archer,s,DEFAULT_CONFIG);assert.deepEqual([a.damage,a.fortitude,a.range],[3,4,4]);
 assert.equal(effective(support,s,DEFAULT_CONFIG).range,1);
 const banner=p('b','defenseLamp',0,1,1);s.pieces.push(banner);
 assert.equal(effective(archer,s,DEFAULT_CONFIG).fortitude,5);
 const details=alliedBonusDetails(archer,s,DEFAULT_CONFIG);
 assert.equal(details.find(d=>d.source.id==='s').bonuses.fortitude,0);
 assert.equal(details.find(d=>d.source.id==='b').bonuses.fortitude,1);
 assert.equal(effective(archer,s,PREVIOUS_FORMATION_CONFIG).fortitude,16,'older configurations retain broad shield protection');
 for(const invalid of [null,1,'true',{}])assert.throws(()=>validateConfig({...clone(DEFAULT_CONFIG),shieldDefenseOnly:invalid}));
});
test('the required duels resolve simultaneously, including the veteran counterattack',()=>{
 const one=resolve(state([p('s','shield',0,1,0),p('a','archer',1,0,0)]),DEFAULT_CONFIG);
 assert.deepEqual(one.deaths.map(p=>p.id),['a']);
 const trade=resolve(state([p('s1','shield',0,-1,0),p('s2','shield',0,1,0),p('v','shield',1,0,0,true)]),DEFAULT_CONFIG);
 assert.deepEqual(trade.deaths.map(p=>p.id),['s1','s2','v']);
 assert.equal(trade.report.get('v').incoming,8);assert.equal(trade.report.get('s1').incoming,6);
});
test('two defense sources allow approach while a supported shield and archer break full protection',()=>{
 const protectedShield=resolve(state([p('s','shield',0,-1,0),p('a','archer',0,0,-2),p('drum','attackLamp',0,-1,-1),p('target','shield',1,0,0),p('guard','shield',1,1,0),p('banner','defenseLamp',1,0,1)]),DEFAULT_CONFIG);
 assert.deepEqual([protectedShield.report.get('target').incoming,protectedShield.report.get('target').fortitude],[7,7]);
 assert.deepEqual(protectedShield.deaths.map(p=>p.id),['target']);
 const full=state([p('s1','shield',0,-1,0),p('s2','shield',0,0,-1),p('v','shield',1,0,0,true),p('g1','shield',1,1,0),p('g2','shield',1,0,1)]);
 const trade=resolve(full,DEFAULT_CONFIG);assert.equal(trade.report.get('v').fortitude,8);assert.ok(trade.deaths.some(p=>p.id==='v'));
 const advance=resolve(state([p('s','shield',0,0,0),p('g','shield',0,1,0),p('b','defenseLamp',0,0,-1),p('v','shield',1,0,2,true)]),DEFAULT_CONFIG);
 assert.deepEqual([advance.report.get('s').incoming,advance.report.get('s').fortitude,advance.report.get('s').dead],[6,7,false]);
});
test('every legal pair of first actions remains lossless with the actual local engine',()=>{
 const c=DEFAULT_CONFIG,legal=s=>s.pieces.filter(p=>p.team===s.turn).flatMap(p=>reachable(p,s,c).map(to=>({id:p.id,to})));
 for(const first of[0,1]){
  const s=createGame(c);s.turn=first;let pairs=0;assert.equal(legal(s).length,84);
  for(const a of legal(s)){const x=move(s,c,a.id,a.to);assert.equal(x.deaths.length,0);for(const b of legal(x.state)){pairs++;assert.equal(move(x.state,c,b.id,b.to).deaths.length,0);}}
  assert.equal(pairs,7056);
 }
});
