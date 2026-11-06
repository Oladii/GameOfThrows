import test from 'node:test';
import assert from 'node:assert/strict';
import {REVISION_FOUR_CONFIG} from './fixtures/revision-four.js';
import {clone,cells,distance,lineBetween,auraReaches,effective,inspectCell,attacks} from '../dist/engine.js';
const piece=(id,type,team,q,r)=>({id,type,team,q,r});
const position=pieces=>({pieces,turn:0,ply:0,winner:null});

test('drummer and flag auras cover a complete radius on both grid geometries',()=>{
  for(const geometry of ['hex','square'])for(const diagonals of [false,true])for(const type of ['attackLamp','defenseLamp']){
    const c=clone(REVISION_FOUR_CONFIG);c.geometry=geometry;c.size=6;c.experiments.squareDiagonals=diagonals;c.stats[type].aura=2;
    const source=piece('source',type,0,geometry==='hex'?0:3,geometry==='hex'?0:3),s=position([source]);
    for(const cell of cells(c))assert.equal(auraReaches(source,cell,s,c),distance(source,cell,c)>0&&distance(source,cell,c)<=2,`${geometry}/${diagonals}/${type}/${cell.q},${cell.r}`);
    if(geometry==='hex')assert.equal(cells(c).filter(cell=>auraReaches(source,cell,s,c)).length,18);
  }
});
test('area auras grant actual bonuses between rays, exclude self and enemies, and follow previews',()=>{
  for(const type of ['attackLamp','defenseLamp']){
    const c=clone(REVISION_FOUR_CONFIG);c.stats[type].aura=2;
    const source=piece('source',type,0,0,0),ally=piece('ally','archer',0,1,1),enemy=piece('enemy','archer',1,-1,-1),s=position([source,ally,enemy]);
    const field=type==='attackLamp'?'damage':'fortitude',bonus=type==='attackLamp'?c.stats[type].damageBonus:c.stats[type].defenseBonus;
    assert.equal(effective(ally,s,c)[field],c.stats.archer[field]+bonus);
    assert.deepEqual(effective(enemy,s,c).sources,[]);assert.equal(effective(source,s,c).sources.includes('source'),false);
    const preview=inspectCell(s,c,{q:-1,r:0},source.id);
    assert.equal(preview.isPreview,true);assert.equal(preview.report.get(ally.id)[field],c.stats.archer[field]);
    assert.equal(source.q,0);
  }
});
test('area auras keep the shield-blocking experiment while attacks and other auras retain rays',()=>{
  const c=clone(REVISION_FOUR_CONFIG);c.stats.attackLamp.aura=3;c.experiments.aurasThroughShields=false;
  const source=piece('source','attackLamp',0,0,0),target=piece('target','archer',0,1,1);
  const middle=lineBetween(source,target,c)[1],shield=piece('blocker','shield',1,middle.q,middle.r),s=position([source,target,shield]);
  assert.equal(auraReaches(source,target,s,c),false);c.experiments.aurasThroughShields=true;assert.equal(auraReaches(source,target,s,c),true);
  const veteran={...piece('veteran','shield',0,0,0),reachedFarEdge:true};c.shieldPromotion.aura=2;
  assert.equal(auraReaches(veteran,target,position([veteran,target]),c),false);
  c.stats.archer.range=4;
  const attacker=piece('attacker','archer',0,0,0),victim=piece('victim','archer',1,1,1);
  assert.equal(attacks(attacker,victim,position([attacker,victim]),c),false);
});
