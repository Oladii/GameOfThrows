import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIOUS_LOCAL_CONFIG as DEFAULT_CONFIG, PREVIOUS_UNCAPPED_CONFIG, PREVIOUS_DRUM_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, effective, reachable, move, resolve, validateConfig } from '../dist/engine.js';
import { alliedBonusDetails, unitStatParts } from '../dist/board-presentation.js';
import { prepareStartPosition } from '../dist/start-position.js';
const p=(id,type,team,q,r)=>({id,type,team,q,r}),s=pieces=>({pieces,turn:0,ply:0,winner:null});

test('new standard army is5shields4archers and3supports; archers are centred behind the front shields',()=>{
 const old=createGame(PREVIOUS_UNCAPPED_CONFIG),next=createGame(DEFAULT_CONFIG);
 assert.deepEqual(next.pieces.filter(p=>p.type!=='archer'),old.pieces.filter(p=>p.type!=='archer'));
 assert.deepEqual(next.pieces.filter(p=>p.team===0&&p.type==='archer').map(p=>p.q).sort((a,b)=>a-b),[0,1,2,3]);
 assert.ok(next.pieces.filter(p=>p.team===0&&p.type==='archer').every(p=>p.r===-3));
 assert.ok(next.pieces.filter(p=>p.team===1&&p.type==='archer').every(p=>p.r===3));
 assert.equal(new Set(next.pieces.map(p=>p.q+','+p.r)).size,24);
 assert.equal(next.pieces.length,24); assert.equal(new Set(next.pieces.filter(p=>p.team===0&&p.type==='shield').map(p=>p.r)).size,1);
 for(const team of [0,1])assert.deepEqual(['shield','archer','attackLamp','defenseLamp','scoutLamp'].map(type=>next.pieces.filter(p=>p.team===team&&p.type===type).length),[5,4,1,1,1]);
 assert.equal(DEFAULT_CONFIG.stats.archer.fortitude,3);assert.equal(DEFAULT_CONFIG.auraDefenseCap,-1);
});

test('drum provides attack and visible shield movement bonuses in one radius, fixing allowance at the start',()=>{
 const shield=p('s','shield',0,0,0),drum=p('d','attackLamp',0,0,1),initial=s([shield,drum]);
 assert.equal(effective(shield,initial,DEFAULT_CONFIG).move,2);assert.equal(effective(shield,initial,DEFAULT_CONFIG).damage,6);
 assert.ok(reachable(shield,initial,DEFAULT_CONFIG).some(c=>c.q===2&&c.r===0));
 const after=s([{...shield,q:2},drum]);assert.equal(effective(after.pieces[0],after,DEFAULT_CONFIG).move,1);
 assert.equal(effective(shield,s([shield,{...drum,r:2}]),DEFAULT_CONFIG).move,1);
 assert.equal(effective(p('a','archer',0,0,0),s([p('a','archer',0,0,0),drum]),DEFAULT_CONFIG).move,2);
 assert.equal(unitStatParts(shield,initial,DEFAULT_CONFIG).find(x=>x.field==='move').allied,1);
 assert.equal(alliedBonusDetails(shield,initial,DEFAULT_CONFIG).find(x=>x.source.id==='d').bonuses.move,1);
});

test('losing the flag ends the game even with combat units alive, including exposure on your own action',()=>{
 const initial=s([p('s','shield',0,0,1),p('f','defenseLamp',0,0,0),p('a','archer',1,0,3),p('d','attackLamp',1,1,3),p('ef','defenseLamp',1,3,0)]);
 const result=move(initial,DEFAULT_CONFIG,'s',{q:1,r:1});
 assert.equal(result.state.winner,1);assert.ok(result.deaths.some(p=>p.id==='f'));assert.ok(result.state.pieces.some(p=>p.id==='s'));
 const battle=s([p('s0','shield',0,2,-1),p('f0','defenseLamp',0,0,0),p('s1','shield',1,0,1),p('f1','defenseLamp',1,2,0)]);
 const both=resolve(battle,DEFAULT_CONFIG);assert.equal(both.state.winner,'draw');assert.deepEqual(both.deaths.map(p=>p.id).sort(),['f0','f1']);
 const armyLoss=s([p('s0','shield',0,0,0),p('f0','defenseLamp',0,-4,0),p('a1','archer',1,0,1),p('f1','defenseLamp',1,4,-4)]);
 assert.equal(resolve(armyLoss,DEFAULT_CONFIG).state.winner,0);
});

test('new match requires one flag and combat units for each side; historical modes remain valid',()=>{
 const initial=createGame(DEFAULT_CONFIG);assert.equal(prepareStartPosition(initial,DEFAULT_CONFIG,1).turn,1);
 assert.throws(()=>prepareStartPosition(s(initial.pieces.filter(p=>p.type!=='defenseLamp')),DEFAULT_CONFIG,0),/знаменосец/);
 assert.throws(()=>prepareStartPosition(s([...initial.pieces,p('extra','defenseLamp',0,-4,0)]),DEFAULT_CONFIG,0),/ровно один/);
 const old=clone(PREVIOUS_UNCAPPED_CONFIG);assert.doesNotThrow(()=>prepareStartPosition(s([p('a','archer',0,0,0),p('b','archer',1,1,0)]),old,0));
});

test('revision16 standard setup migrates exactly once and explicit historical or custom rules retain their behavior',()=>{
 assert.equal(BALANCE_REVISION,22);assert.deepEqual(updateSavedBalance(PREVIOUS_DRUM_CONFIG,17),DEFAULT_CONFIG);assert.equal(createGame(PREVIOUS_DRUM_CONFIG).pieces.length,28);assert.deepEqual(updateSavedBalance(PREVIOUS_UNCAPPED_CONFIG,16),DEFAULT_CONFIG);
 assert.deepEqual(updateSavedBalance(PREVIOUS_UNCAPPED_CONFIG,19),PREVIOUS_UNCAPPED_CONFIG);
 assert.equal(effective(p('s','shield',0,0,0),s([p('s','shield',0,0,0),p('d','attackLamp',0,0,1)]),PREVIOUS_UNCAPPED_CONFIG).move,1);
 for(const change of [c=>c.stats.archer.damage++,c=>c.stats.attackLamp.aura=3,c=>c.army.rearArchers=3]){const custom=clone(PREVIOUS_UNCAPPED_CONFIG);change(custom);assert.deepEqual(updateSavedBalance(custom,16),custom);}
 for(const value of [-1,1.5,7])assert.throws(()=>validateConfig({...clone(DEFAULT_CONFIG),drumShieldMoveBonus:value}));
});
