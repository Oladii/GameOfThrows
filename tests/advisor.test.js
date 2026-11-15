import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {chooseAdvisorAction,chooseBotAction} from '../dist/bot.js';
import {DEFAULT_CONFIG} from '../dist/rules.js';
import {createGame,clone,move} from '../dist/engine.js';
import {oneReplySafety} from '../dist/defensive-selection.mjs';
import {advisorReplySafety} from '../dist/formation-strategy.mjs';

test('advisor keeps immediate wins, does not mutate inputs, and preserves ordinary depth limits',()=>{
  const config=clone(DEFAULT_CONFIG);config.victoryCondition='all-units';config.stats.shield.damage=10;
  const state={pieces:[{id:'s',type:'shield',team:0,q:0,r:0},{id:'e',type:'defenseLamp',team:1,q:2,r:0}],turn:0,ply:0,winner:null};
  const before=JSON.stringify({state,config});
  const r=chooseAdvisorAction(state,config,{seed:8});
  assert.equal(move(state,config,r.action.id,r.action.to).state.winner,0);
  assert.equal(JSON.stringify({state,config}),before);
  assert.throws(()=>chooseBotAction(state,config,{depth:6}));
});
test('advisor rejects mutual defeat in safety checks without changing opponent policy',()=>{
  const position={winner:'draw'};
  assert.equal(oneReplySafety(position,0,()=>[],()=>{}).safe,true);
  assert.equal(advisorReplySafety(position,0,()=>[],()=>{}).safe,false);
  const live={winner:null};
  assert.equal(advisorReplySafety(live,0,()=>[{}],()=>({state:position})).safe,false);
});
test('advisor returns a complete result when its deeper search runs out of time',()=>{
  const r=chooseAdvisorAction(createGame(DEFAULT_CONFIG),DEFAULT_CONFIG,{seed:123,budgetMs:0});
  assert.ok(r.action);assert.equal(r.stats.depth,4);assert.equal(r.stats.budgetExhausted,true);
  assert.ok(r.stats.adviceDiversity.candidates>=1);
  assert.ok(r.stats.adviceDiversity.gap<=r.stats.adviceDiversity.maxGap);
});
test('bundled worker routes advice separately from unchanged opponents',()=>{
  const worker=fs.readFileSync(new URL('../dist/bot-worker.js',import.meta.url),'utf8').replace(/^import.*\n/,'');
  const calls=[],messages=[];
  const context=vm.createContext({chooseAdvisorAction:()=>{calls.push('advisor');return {action:'advice'}},chooseBotAction:()=>{calls.push('bot');return {action:'bot'}},self:{postMessage:m=>messages.push(m)}});
  vm.runInContext(worker,context);
  context.self.onmessage({data:{id:1,options:{advisor:true}}});
  context.self.onmessage({data:{id:2,options:{depth:4}}});
  assert.deepEqual(calls,['advisor','bot']);assert.equal(messages[0].result.action,'advice');
});

test('deep advice stays random among safe alternatives and reproduces a given seed',()=>{
  const {state,config,options}=JSON.parse(fs.readFileSync(new URL('./fixtures/advisor-alternatives.json',import.meta.url)));
  const choices=[];
  for(const seed of [1,2,3,1]) {
    const result=chooseAdvisorAction(state,config,{...options,seed});
    assert.equal(result.stats.depth,6);
    assert.ok(result.stats.adviceDiversity.candidates>1);
    assert.ok(result.stats.adviceDiversity.gap<=8);
    choices.push(JSON.stringify(result.action));
  }
  assert.equal(choices[0],choices[3]);
  assert.ok(new Set(choices).size>1);
});
