import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, effective, attacks, analyze, resolve, createGame, validateConfig, winnerForPieces, isCombatUnit } from '../dist/engine.js';
// Model the previous commander profile without relying on workspace research files.
const legacyCommanderConfig=clone(DEFAULT_CONFIG);
legacyCommanderConfig.stats.scoutLamp.damage=0;legacyCommanderConfig.stats.scoutLamp.range=0;
const piece=(id,type,team,q,r,extra={})=>({id,type,team,q,r,...extra});
const position=pieces=>({pieces,turn:0,ply:0,winner:null});
const commander=()=>piece('commander','scoutLamp',0,0,0);

test('commander defaults change only base attack3 and range2; validation permits the native attack',()=>{
 const expected=clone(legacyCommanderConfig);expected.stats.scoutLamp.damage=3;expected.stats.scoutLamp.range=2;
 assert.deepEqual(DEFAULT_CONFIG,expected);assert.deepEqual(validateConfig(DEFAULT_CONFIG),DEFAULT_CONFIG);assert.equal(BALANCE_REVISION,22);
});

test('without auras commander deals3 on a ray at distance1 or2, never at distance3 or through its own aura',()=>{
 const own=commander(),near=piece('near','archer',1,1,0),middle=piece('middle','archer',1,0,2),far=piece('far','archer',1,-3,0),offRay=piece('off-ray','archer',1,1,1);
 const state=position([own,near,middle,far,offRay]),stats=effective(own,state,DEFAULT_CONFIG);
 assert.equal(stats.damage,3);assert.equal(stats.range,2);assert.equal(stats.rangeBonus,0);
 assert.equal(attacks(own,near,state,DEFAULT_CONFIG),true);assert.equal(attacks(own,middle,state,DEFAULT_CONFIG),true);assert.equal(attacks(own,far,state,DEFAULT_CONFIG),false);assert.equal(attacks(own,offRay,state,DEFAULT_CONFIG),false);
 const report=analyze(state,DEFAULT_CONFIG);assert.equal(report.get('near').incoming,3);assert.equal(report.get('middle').incoming,3);assert.equal(report.get('far').incoming,0);assert.equal(report.get('off-ray').incoming,0);
 assert.ok(resolve(state,DEFAULT_CONFIG).deaths.some(p=>p.id==='middle'));
});

test('horn and veteran still add attack while commander keeps a fixed reach',()=>{
 const own=commander(),horn=piece('horn','horn',0,0,-1),veteran=piece('v','shield',0,-1,0,{reachedFarEdge:true});
 const hornStats=effective(own,position([own,horn]),DEFAULT_CONFIG);assert.equal(hornStats.damage,4);assert.equal(hornStats.range,2);
 const veteranStats=effective(own,position([own,veteran]),DEFAULT_CONFIG);assert.equal(veteranStats.damage,4);assert.equal(veteranStats.range,2);
 const both=effective(own,position([own,horn,veteran]),DEFAULT_CONFIG);assert.equal(both.damage,5);assert.equal(both.range,2);
});

test('legacy commander0/0 and other support remain unarmed without a veteran, preserving archived rules',()=>{
 const horn=piece('horn','horn',0,0,-1);
 for(const type of ['scoutLamp','attackLamp','defenseLamp','horn']){
  const config=type==='scoutLamp'?legacyCommanderConfig:DEFAULT_CONFIG,own=piece('support',type,0,0,0),state=position([own,horn]);
  const stats=effective(own,state,config);assert.equal(stats.damage,0,type);assert.equal(stats.range,0,type);
 }
 const own=commander(),veteran=piece('v','shield',0,-1,0,{reachedFarEdge:true});
 const stats=effective(own,position([own,veteran]),legacyCommanderConfig);assert.equal(stats.damage,1);assert.equal(stats.range,1);
});

test('revision20 migration changes only commander0/0 in the current13 army and preserves saved placement/history',()=>{
 const config=clone(legacyCommanderConfig);config.stats.shield.damage=7;
 const state=createGame(config),saved={config,state,history:[clone(state)],lastTurn:{id:'p1'},editor:true};
 const before=clone(saved),expected=clone(config);expected.stats.scoutLamp.damage=3;expected.stats.scoutLamp.range=2;
 const migrated={...saved,config:updateSavedBalance(saved.config,20)};
 assert.deepEqual(migrated,{...before,config:expected});assert.deepEqual(saved,before);
 assert.deepEqual(updateSavedBalance(DEFAULT_CONFIG,21),DEFAULT_CONFIG);
 for(const [damage,range] of [[2,1],[3,0],[0,1],[4,2],[3,1]]){const custom=clone(legacyCommanderConfig);Object.assign(custom.stats.scoutLamp,{damage,range});assert.deepEqual(updateSavedBalance(custom,20),custom);}
 const old=clone(legacyCommanderConfig);delete old.army.horns;delete old.stats.horn;assert.deepEqual(updateSavedBalance(old,20),old);
 assert.deepEqual(updateSavedBalance(legacyCommanderConfig,21),legacyCommanderConfig);
});

test('armed commander does not change the existing flag-or-combat victory classification',()=>{
 const own=commander(),flag=piece('flag','defenseLamp',0,-1,0),enemy=piece('enemy','shield',1,3,0),enemyFlag=piece('enemy-flag','defenseLamp',1,3,-1);
 assert.equal(isCombatUnit(own),false);assert.equal(winnerForPieces([own,flag,enemy,enemyFlag],DEFAULT_CONFIG),1);
 assert.equal(winnerForPieces([own,flag,piece('a','archer',0,-3,0),enemy,enemyFlag],DEFAULT_CONFIG),null);
});


test('revision21 extends only the known current13 commander3/1, retaining custom attack and range pairs',()=>{
 const previous=clone(DEFAULT_CONFIG);previous.stats.scoutLamp.range=1;previous.stats.shield.damage=7;
 const before=clone(previous),expected=clone(previous);expected.stats.scoutLamp.range=2;
 assert.deepEqual(updateSavedBalance(previous,21),expected);assert.deepEqual(previous,before);
 for(const [damage,range] of [[2,1],[4,1],[3,0],[3,3],[3,4]]){const custom=clone(previous);Object.assign(custom.stats.scoutLamp,{damage,range});assert.deepEqual(updateSavedBalance(custom,21),custom);}
 const old=clone(previous);delete old.army.horns;delete old.stats.horn;assert.deepEqual(updateSavedBalance(old,21),old);
 assert.deepEqual(updateSavedBalance(previous,22),previous);
 const own=commander(),other=piece('other-commander','scoutLamp',0,-1,0);assert.equal(effective(own,position([own,other]),DEFAULT_CONFIG).range,2);
});


test('commander keeps range2 under stacked foreign auras while drum still grants the additional movement step',()=>{
 const own=commander(),veteran=piece('v','shield',0,-1,0,{reachedFarEdge:true}),other=piece('other','scoutLamp',0,0,1),drum=piece('drum','attackLamp',0,1,-1),far=piece('far','archer',1,0,3);
 const state=position([own,veteran,other,drum,far]),stats=effective(own,state,DEFAULT_CONFIG);
 assert.equal(stats.range,2);assert.equal(stats.rangeBonus,0);assert.equal(stats.damage,4);assert.equal(stats.fortitude,4);assert.equal(stats.move,3);assert.equal(attacks(own,far,state,DEFAULT_CONFIG),false);
 const legacy=effective(own,position([own,veteran]),legacyCommanderConfig);assert.equal(legacy.range,1);assert.equal(legacy.damage,1);
});
