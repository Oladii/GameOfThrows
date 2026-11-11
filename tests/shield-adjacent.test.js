import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIOUS_ADJACENT_CONFIG as DEFAULT_CONFIG, DEFAULT_CONFIG as CURRENT_CONFIG, PREVIOUS_FLAG_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, analyze, effective, resolve, validateConfig } from '../dist/engine.js';
const p = (id,type,team,q,r,veteran=false) => ({ id,type,team,q,r,...(veteran ? {reachedFarEdge:true} : {}) });
const state = pieces => ({ pieces,turn:0,ply:0,winner:null });

test('current shields attack adjacent cells only while all other settings and the deployment stay intact', () => {
  const expected=clone(PREVIOUS_FLAG_CONFIG); expected.stats.shield.range=1;
  assert.equal(BALANCE_REVISION,16); assert.deepEqual(DEFAULT_CONFIG,expected);
  assert.deepEqual(createGame(DEFAULT_CONFIG),createGame(PREVIOUS_FLAG_CONFIG));
  const shield=p('s','shield',0,0,0), adjacent=p('near','archer',1,0,1), distant=p('far','archer',1,0,2);
  assert.equal(analyze(state([shield,adjacent]),DEFAULT_CONFIG).get('near').incoming,5);
  assert.equal(analyze(state([shield,distant]),DEFAULT_CONFIG).get('far').incoming,0);
  assert.equal(analyze(state([shield,distant]),PREVIOUS_FLAG_CONFIG).get('far').incoming,5);
});

test('veteran keeps strength 6, fortitude 6 and range 3 after the ordinary shield range is reduced', () => {
  const veteran=p('v','shield',0,0,0,true), power=effective(veteran,state([veteran]),DEFAULT_CONFIG);
  assert.deepEqual([power.damage,power.fortitude,power.range],[6,6,3]);
  const archer=p('a','archer',0,1,0), bonus=effective(archer,state([veteran,archer]),DEFAULT_CONFIG);
  assert.deepEqual([bonus.damage,bonus.fortitude,bonus.range],[3,4,5]);
});

test('ordinary shields retain the agreed contact trades with archers and a fully protected veteran', () => {
  const duel=resolve(state([p('s','shield',0,0,0),p('a','archer',1,0,1)]),DEFAULT_CONFIG);
  assert.deepEqual(duel.deaths.map(p=>p.id),['a']);
  const trade=resolve(state([p('s1','shield',0,-1,0),p('s2','shield',0,0,-1),p('v','shield',1,0,0,true),p('g1','shield',1,1,0),p('g2','shield',1,0,1)]),DEFAULT_CONFIG);
  assert.deepEqual([trade.report.get('v').incoming,trade.report.get('v').fortitude],[10,8]);
  for(const id of ['s1','s2','v']) assert.ok(trade.deaths.some(p=>p.id===id));
});

test('only an exact standard revision-14 setup migrates; custom and explicitly older rules remain readable', () => {
  const old=clone(PREVIOUS_FLAG_CONFIG), before=clone(old);
  assert.deepEqual(updateSavedBalance(old,14),CURRENT_CONFIG); assert.deepEqual(old,before);
  assert.deepEqual(updateSavedBalance(old,15),old); assert.deepEqual(validateConfig(old),old);
  for(const change of [c=>c.stats.shield.range=3,c=>c.stats.defenseLamp.aura=4,c=>c.army.archers++,c=>c.experiments.allowPass=true]) {
    const custom=clone(old);change(custom);assert.deepEqual(updateSavedBalance(custom,14),custom);
  }
});
