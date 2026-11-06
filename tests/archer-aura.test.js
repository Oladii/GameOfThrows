import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, validateConfig, effective, resolve } from '../dist/engine.js';
import { alliedBonusDetails } from '../dist/board-presentation.js';
const p=(id,type,team,q,r)=>({id,type,team,q,r});
const state=pieces=>({pieces,turn:0,ply:0,winner:null});
const config=()=>{const c=clone(REVISION_FOUR_CONFIG);c.stats.archer.aura=1;c.stats.archer.damageBonus=1;return c;};
test('archer attack auras stack on allies and exclude the source and enemies',()=>{
 const c=config(),a=p('a','archer',0,0,0),b=p('b','archer',0,0,1),s=p('s','shield',0,1,0),e=p('e','shield',1,-1,0),position=state([a,b,s,e]);
 assert.doesNotThrow(()=>validateConfig(JSON.parse(JSON.stringify(c))));
 assert.equal(effective(a,state([a,s,e]),c).damage,c.stats.archer.damage);
 assert.equal(effective(s,position,c).damage,c.stats.shield.damage+2);
 assert.equal(effective(s,position,c).range,c.stats.shield.range);
 assert.equal(effective(e,position,c).damage,c.stats.shield.damage);
 assert.equal(effective(a,position,c).damage,c.stats.archer.damage+1);
});
test('wider archer aura follows the same straight rays as other auras',()=>{
 const c=config();c.stats.archer.aura=2;
 const a=p('a','archer',0,0,0),along=p('along','shield',0,2,0),off=p('off','shield',0,1,1),position=state([a,along,off]);
 assert.equal(effective(along,position,c).damage,c.stats.shield.damage+1);
 assert.equal(effective(off,position,c).damage,c.stats.shield.damage);
});
test('archer aura cannot arm support without a veteran, and stacks once a veteran arms it',()=>{
 const c=config(),a=p('a','archer',0,0,0);
 for(const type of ['attackLamp','defenseLamp']){
  const support=p('s',type,0,1,0),before=effective(support,state([a,support]),c);
  assert.equal(before.damage,0);assert.equal(before.range,0);
  const veteran={...p('v','shield',0,2,0),reachedFarEdge:true},after=effective(support,state([a,support,veteran]),c);
  assert.equal(after.damage,1+c.shieldPromotion.damageBonus);assert.equal(after.range,1);
 }
});
test('a dying archer contributes its aura to the simultaneous casualty calculation',()=>{
 const c=config();c.stats.archer.damage=0;c.stats.shield.fortitude=5;
 const a=p('a','archer',0,0,1),s=p('s','shield',0,0,0),e=p('e','shield',1,1,0),out=resolve(state([a,s,e]),c);
 assert.ok(out.deaths.some(p=>p.id==='a'));assert.equal(out.report.get('s').damage,5);assert.equal(out.report.get('e').incoming,5);assert.equal(out.report.get('e').dead,true);
});
test('unit details identify the archer source and the actual attack bonus',()=>{
 const c=config(),a=p('a','archer',0,0,0),s=p('s','shield',0,1,0);
 const details=alliedBonusDetails(s,state([a,s]),c);
 assert.deepEqual(details.map(d=>[d.source.id,d.bonuses]),[['a',{damage:1,range:0,fortitude:0}]]);
});
test('archer range and defense aura bonuses remain unsupported',()=>{
 for(const field of ['rangeBonus','defenseBonus']){const c=config();c.stats.archer[field]=1;assert.throws(()=>validateConfig(c),/не поддерживает/);}
});
