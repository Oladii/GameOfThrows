import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG, PREVIOUS_AREA_CONFIG, PREVIOUS_SCOUT_CONFIG, upgradeScoutFieldPreset, updateSavedBalance} from '../dist/rules.js';
import {clone,cells,createGame,validateConfig,analyze,effective,move} from '../dist/engine.js';
import {alliedBonusDetails} from '../dist/board-presentation.js';
import {createUnitLesson} from '../dist/onboarding-units.js';
const p=(id,type,team,q,r)=>({id,type,team,q,r}),s=pieces=>({pieces,turn:0,ply:0,winner:null});
test('the standard start preserves the old fighting wings and central rear scouts without retreat',()=>{
 const game=createGame(DEFAULT_CONFIG),old=createGame(PREVIOUS_AREA_CONFIG);
 assert.equal(cells(DEFAULT_CONFIG).length,91);assert.equal(game.pieces.length,22);
 const sig=x=>[x.type,x.team,x.q,x.r,x.group].join(':');
 assert.deepEqual(game.pieces.filter(p=>p.type!=='scoutLamp').map(sig).sort(),old.pieces.map(sig).sort());
 assert.deepEqual(game.pieces.filter(p=>p.type==='scoutLamp').map(p=>[p.team,p.q,p.r]),[[0,2,-4],[1,-2,4]]);
 assert.ok([...analyze(game,DEFAULT_CONFIG).values()].every(x=>!x.dead));
});
test('range belongs to the scout, is an area aura, and never extends a shield',()=>{
 const a=p('a','archer',0,1,1),b=p('b','shield',0,-1,-1),scout=p('scout','scoutLamp',0,0,0),state=s([a,b,scout]);
 assert.equal(DEFAULT_CONFIG.stats.attackLamp.rangeBonus,0);
 assert.equal(effective(a,state,DEFAULT_CONFIG).range,4);assert.equal(effective(b,state,DEFAULT_CONFIG).range,1);
 assert.equal(effective(scout,state,DEFAULT_CONFIG).damage,0);assert.equal(effective(scout,state,DEFAULT_CONFIG).range,0);
 assert.equal(alliedBonusDetails(a,state,DEFAULT_CONFIG)[0].bonuses.range,1);
});
test('the enlarged flag protects a support from a single base arrow between aura rays',()=>{
 const target=p('target','scoutLamp',0,1,1),flag=p('flag','defenseLamp',0,0,0),enemy=p('enemy','archer',1,1,3),state=s([target,flag,enemy]);
 const info=analyze(state,DEFAULT_CONFIG).get('target');assert.equal(info.incoming,8);assert.equal(info.fortitude,9);assert.equal(info.dead,false);
 assert.equal(analyze(s([target,enemy]),DEFAULT_CONFIG).get('target').dead,true);
});
test('old games gain only an empty scout schema; full default presets upgrade and custom presets survive',()=>{
 const old=clone(PREVIOUS_AREA_CONFIG),before=clone(old),normalized=validateConfig(old);
 assert.deepEqual(old,before);assert.equal(normalized.size,4);assert.equal(normalized.army.scoutLamps,0);assert.equal(normalized.stats.attackLamp.rangeBonus,1);assert.equal(createGame(normalized).pieces.length,20);
 assert.deepEqual(upgradeScoutFieldPreset(normalized),PREVIOUS_SCOUT_CONFIG);assert.deepEqual(updateSavedBalance(old,6),DEFAULT_CONFIG);
 for(const mutate of [c=>c.stats.archer.damage++,c=>c.size=6,c=>c.army.archers=3,c=>c.experiments.allowPass=true]){
  const custom=clone(normalized);mutate(custom);assert.deepEqual(upgradeScoutFieldPreset(custom),custom);
 }
});
test('new scout and revised drummer lessons require the stated support effect to win',()=>{
 for(const type of ['scoutLamp','attackLamp']){
  const initial=createUnitLesson(type),result=createUnitLesson(type,{selected:true,advanced:true,destination:{q:1,r:-2}});
  assert.equal(initial.report.get('enemy').dead,false);assert.equal(result.report.get('enemy').dead,true);
  assert.equal(result.report.get('blue').dead,false);
  const expected=move(initial.before,initial.config,'support',{q:1,r:-2});assert.deepEqual(result.position,expected.state);
  assert.equal(result.report.get('blue').range-initial.report.get('blue').range,type==='scoutLamp'?1:0);
  assert.equal(result.report.get('blue').damage-initial.report.get('blue').damage,type==='attackLamp'?4:0);
 }
});
