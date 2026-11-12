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

test('commander defaults change only base attack3 and melee range1; validation permits the native attack',()=>{
 const expected=clone(legacyCommanderConfig);expected.stats.scoutLamp.damage=3;expected.stats.scoutLamp.range=1;
 assert.deepEqual(DEFAULT_CONFIG,expected);assert.deepEqual(validateConfig(DEFAULT_CONFIG),DEFAULT_CONFIG);assert.equal(BALANCE_REVISION,21);
});

test('without auras commander deals exactly3 to an adjacent enemy and cannot attack across an empty cell',()=>{
 const own=commander(),near=piece('near','archer',1,1,0),far=piece('far','archer',1,0,2);
 const state=position([own,near,far]),stats=effective(own,state,DEFAULT_CONFIG);
 assert.equal(stats.damage,3);assert.equal(stats.range,1);
 assert.equal(attacks(own,near,state,DEFAULT_CONFIG),true);assert.equal(attacks(own,far,state,DEFAULT_CONFIG),false);
 const report=analyze(state,DEFAULT_CONFIG);assert.equal(report.get('near').incoming,3);assert.equal(report.get('far').incoming,0);
 assert.ok(resolve(state,DEFAULT_CONFIG).deaths.some(p=>p.id==='near'));
});

test('horn adds one attack to commander while the existing veteran damage/range aura still applies',()=>{
 const own=commander(),horn=piece('horn','horn',0,0,-1),veteran=piece('v','shield',0,-1,0,{reachedFarEdge:true});
 const hornStats=effective(own,position([own,horn]),DEFAULT_CONFIG);assert.equal(hornStats.damage,4);assert.equal(hornStats.range,1);
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
 const before=clone(saved),expected=clone(config);expected.stats.scoutLamp.damage=3;expected.stats.scoutLamp.range=1;
 const migrated={...saved,config:updateSavedBalance(saved.config,20)};
 assert.deepEqual(migrated,{...before,config:expected});assert.deepEqual(saved,before);
 assert.deepEqual(updateSavedBalance(DEFAULT_CONFIG,21),DEFAULT_CONFIG);
 for(const [damage,range] of [[2,1],[3,0],[0,1],[4,2]]){const custom=clone(legacyCommanderConfig);Object.assign(custom.stats.scoutLamp,{damage,range});assert.deepEqual(updateSavedBalance(custom,20),custom);}
 const old=clone(legacyCommanderConfig);delete old.army.horns;delete old.stats.horn;assert.deepEqual(updateSavedBalance(old,20),old);
 assert.deepEqual(updateSavedBalance(legacyCommanderConfig,21),legacyCommanderConfig);
});

test('armed commander does not change the existing flag-or-combat victory classification',()=>{
 const own=commander(),flag=piece('flag','defenseLamp',0,-1,0),enemy=piece('enemy','shield',1,3,0),enemyFlag=piece('enemy-flag','defenseLamp',1,3,-1);
 assert.equal(isCombatUnit(own),false);assert.equal(winnerForPieces([own,flag,enemy,enemyFlag],DEFAULT_CONFIG),1);
 assert.equal(winnerForPieces([own,flag,piece('a','archer',0,-3,0),enemy,enemyFlag],DEFAULT_CONFIG),null);
});
