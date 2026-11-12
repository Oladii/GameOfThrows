import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { clone, move, effective, validateState, inspectCell, reachable, movementPath, archerHasEdgeBonus, shieldCanRetreat } from '../dist/engine.js';
import { unitAppearance, unitStatParts, renderMovingToken, renderDeathEffects } from '../dist/board-presentation.js';
import { renderTokenBody } from '../dist/token-presentation.js';
import { botPositionKey } from '../dist/bot.js';
import { deploymentKey } from '../dist/start-position.js';
const config = clone(DEFAULT_CONFIG);
const fixture = () => ({pieces:[{id:'a',type:'archer',team:0,q:0,r:4},{id:'e',type:'archer',team:1,q:4,r:-4},{id:'f0',type:'defenseLamp',team:0,q:-5,r:0},{id:'f1',type:'defenseLamp',team:1,q:5,r:0}],turn:0,ply:0,winner:null});
const power = (s, id='a') => effective(s.pieces.find(p=>p.id===id),s,config);
test('edge bonus is permanent, applied immediately and cannot stack',()=>{
 const s=fixture(),before=JSON.stringify(s); let next=move(s,config,'a',{q:0,r:5}).state;
 assert.equal(power(next).damage,4); assert.equal(next.pieces[0].archerReachedFarEdge,true);
 next=move({...next,turn:0},config,'a',{q:0,r:3}).state; assert.equal(power(next).damage,4);
 next=move({...next,turn:0},config,'a',{q:0,r:5}).state; assert.equal(power(next).damage,4);
 assert.equal(JSON.stringify(s),before); assert.equal(shieldCanRetreat(next.pieces[0],config),false);
 assert.equal(power(next).aura,0); assert.equal(power(next).range,4); assert.equal(power(next).fortitude,3);
});
test('route touching edge and returning has matching preview, path and combat',()=>{
 const s=fixture(),to={q:1,r:4}; const route=reachable(s.pieces[0],s,config).find(p=>p.q===to.q&&p.r===to.r);
 assert.equal(route.archerReachedFarEdge,true); assert.ok(movementPath(s.pieces[0],s,config,to).some(p=>p.r===5));
 const preview=inspectCell(s,config,to,'a'),out=move(s,config,'a',to);
 assert.equal(preview.piece.archerReachedFarEdge,true); assert.deepEqual([...preview.report],[...out.report]);
});
test('legacy rules do not gain new powers or promotion flags',()=>{
 const legacy=clone(config); delete legacy.archerEdgeDamageBonus;
 const s=fixture(),out=move(s,legacy,'a',{q:0,r:5});
 assert.equal(effective(out.state.pieces[0],out.state,legacy).damage,2);
 assert.equal(out.state.pieces[0].archerReachedFarEdge,undefined);
 assert.equal(archerHasEdgeBonus(out.state.pieces[0],legacy),false);
});
test('promotion combines with support but does not buff allies',()=>{
 const s=move(fixture(),config,'a',{q:0,r:5}).state;
 s.pieces.push({id:'horn',type:'horn',team:0,q:-1,r:4},{id:'friend',type:'archer',team:0,q:-2,r:4});
 assert.equal(power(s).damage,5); assert.equal(power(s,'friend').damage,3);
 assert.deepEqual(power(s,'friend').sources,['horn']);
 const damage=unitStatParts(s.pieces[0],s,config).find(p=>p.field==='damage');
 assert.deepEqual(damage,{field:'damage',base:2,personal:2,allied:1,total:5});
});
test('wreath keeps the archer glyph in static, moving and death presentations',()=>{
 const s=move(fixture(),config,'a',{q:0,r:5}).state,p=s.pieces[0],icons={archer:'<path id="bow"/>'};
 const appearance=unitAppearance(p,config,icons); assert.equal(appearance.veteran,true); assert.match(appearance.icon,/bow/);
 assert.match(renderTokenBody(appearance,0),/token-veteran-wreath/);
 assert.match(renderMovingToken(p,{x:0,y:0,progress:0},icons,'move',config),/token-veteran-wreath/);
 assert.match(renderDeathEffects([p],p=>({x:p.q,y:p.r}),'',icons,config),/token-veteran-wreath/);
});
test('save validation and position identities preserve the promotion',()=>{
 const s=fixture(),promoted=clone(s); promoted.pieces[0].archerReachedFarEdge=true;
 assert.equal(validateState(promoted,config).pieces[0].archerReachedFarEdge,true);
 assert.notEqual(botPositionKey(s,config),botPositionKey(promoted,config));
 assert.notEqual(deploymentKey(s),deploymentKey(promoted));
 promoted.pieces[1].archerReachedFarEdge='yes'; assert.throws(()=>validateState(promoted,config));
});
test('opposite edges work for both teams and square boards',()=>{
 for(const geometry of ['hex','square'])for(const team of [0,1]){
  const c={...config,geometry,size:geometry==='hex'?5:6};
  const r=team===0?(geometry==='hex'?5:5):(geometry==='hex'?-5:0);
  assert.equal(archerHasEdgeBonus({type:'archer',team,q:0,r},c),true);
 }
});
