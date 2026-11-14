import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { createGame, clone, move, reachable, pass } from '../dist/engine.js';
import { chooseBotAction } from '../dist/bot.js';
const apply = (state, config, action) => action.pass ? pass(state,config) : move(state,config,action.id,action.to);
const identity = action => JSON.stringify(action);
const results = [];
for (const turn of [0,1]) test(`advice varies among close safe moves for team ${turn}`, () => {
  const state = {...createGame(DEFAULT_CONFIG),turn}, before = JSON.stringify(state), distinct = new Set();
  let options;
  for (const seed of [1,2,3]) {
    const result = chooseBotAction(state,DEFAULT_CONFIG,{depth:4,seed,adviceDiversity:true});
    const info = result.stats.adviceDiversity;
    assert.ok(info.candidates > 1 && info.candidates <= 4);
    assert.ok(info.gap >= 0 && info.gap <= info.maxGap);
    assert.equal(result.stats.score,info.selectedScore);
    if (options) assert.deepEqual(info.options,options); else options=info.options;
    assert.ok(info.options.some(option=>identity(option.action)===identity(result.action)));
    distinct.add(identity(result.action)); results.push({state,result});
  }
  assert.ok(distinct.size > 1);
  // Verify every offered alternative against every legal immediate enemy reply.
  for (const option of options) {
    const next=apply(state,DEFAULT_CONFIG,option.action).state;
    for (const enemy of next.pieces.filter(p=>p.team===next.turn)) for (const to of reachable(enemy,next,DEFAULT_CONFIG))
      assert.notEqual(move(next,DEFAULT_CONFIG,enemy.id,to).state.winner,1-turn);
  }
  assert.equal(JSON.stringify(state),before);
});

test('random advice never replaces the unique immediate winning action', () => {
  const config=clone(DEFAULT_CONFIG); config.victoryCondition='all-units'; config.stats.shield.damage=10;
  const state={pieces:[{id:'s',type:'shield',team:0,q:0,r:0},{id:'e',type:'defenseLamp',team:1,q:2,r:0}],turn:0,ply:0,winner:null};
  for (const seed of [1,2,3,19]) {
    const result=chooseBotAction(state,config,{depth:4,seed,adviceDiversity:true});
    assert.deepEqual(result.action,{id:'s',to:{q:1,r:0}});
    assert.equal(apply(state,config,result.action).state.winner,0);
    assert.equal(result.stats.adviceDiversity,undefined);
  }
});

test('same seed reproduces advice and the standalone Worker uses the same shortlist', () => {
  const {state,result}=results[0];
  const strip=source=>source.replace(/^import .*?;\n/gm,'').replace(/^export /gm,'');
  const code=['rules.js','engine.js','defensive-selection.mjs','formation-strategy.mjs','bot.js','bot-worker.js']
    .map(name=>strip(fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8'))).join('\n');
  const messages=[],context=vm.createContext({performance,self:{postMessage:value=>messages.push(value)}});
  vm.runInContext(code,context);
  context.self.onmessage({data:{id:1,state,config:DEFAULT_CONFIG,options:{depth:4,seed:1,adviceDiversity:true}}});
  assert.equal(messages[0].error,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].result.action)),result.action);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0].result.stats.adviceDiversity)),result.stats.adviceDiversity);
});
