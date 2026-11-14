import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as E from '../dist/engine.js';
import { chooseBotAction, botPositionKey } from '../dist/bot.js';
import { createStrategyPolicy } from '../../outputs/formation-bot-fix-2026-11-12/source/strategies-fixed.mjs';
import { rotateState, rotateLastActions } from '../../outputs/formation-bot-fix-2026-11-12/source/orientation.mjs';
const source = new URL('../../outputs/formation-bot-fix-2026-11-12/',import.meta.url);
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const game = id => JSON.parse(fs.readFileSync(new URL('baseline/style-'+id+'-universal.json',source)));
const apply = (s,c,a) => a.pass?E.pass(s,c):E.move(s,c,a.id,a.to);
function prep(g,next,mirror){let state=E.clone(g.initial),history=[E.clone(state)],last=new Map();for(const entry of g.actions.slice(0,next-1)){state=apply(state,g.config,entry.action).state;assert.equal(digest(state),entry.stateHash);history.push(E.clone(state));}for(const entry of g.actions.slice(0,next-1).slice(-40))if(entry.action.id)last.set(entry.action.id,{from:entry.from,to:entry.action.to});return {state:mirror?rotateState(state):state,options:{depth:4,seed:g.job.seed,previousStates:mirror?history.slice(-41).map(rotateState):history.slice(-41),lastActions:mirror?rotateLastActions([...last]):[...last]}};}
const fixed=createStrategyPolicy('formation');
const strip = code => code.replace(/^import .*?;\n/gm,'').replace(/^export /gm,'');
const workerSource=['rules.js','engine.js','defensive-selection.mjs','formation-strategy.mjs','bot.js','bot-worker.js'].map(name=>strip(fs.readFileSync(new URL('../dist/'+name,import.meta.url),'utf8'))).join('\n');
const messages=[];const bundled=vm.createContext({self:{postMessage:m=>messages.push(m)},performance});
vm.runInContext(workerSource,bundled);

test('current module and bundled Worker choose the complete checked fixedF actions in critical 25/54 states and mirrors',async()=>{
  const posted=[];globalThis.self={postMessage:value=>posted.push(value)};
  await import('../dist/bot-worker.js');const moduleWorker=globalThis.self;
  try{
    for(const [id,next]of [['formation-ranged-swap0-first0',25],['formation-ranged-swap0-first1',54]])for(const mirror of [false,true]){
      const g=game(id),{state,options}=prep(g,next,mirror),before=JSON.stringify({state,config:g.config,options});
      const expected=fixed.chooseBotAction(state,g.config,options),actual=chooseBotAction(state,g.config,options);
      assert.deepEqual(actual.action,expected.action);assert.equal(botPositionKey(state,g.config),fixed.botPositionKey(state,g.config));
      assert.equal(actual.stats.score,expected.stats.score);assert.deepEqual(actual.stats.defense,expected.stats.defense);assert.equal(actual.stats.defense.fallback,true);
      const data={id:`${next}-${mirror}`,state,config:g.config,options};moduleWorker.onmessage({data});bundled.self.onmessage({data});
      assert.equal(posted.at(-1).error,undefined);assert.equal(messages.at(-1).error,undefined);
      assert.deepEqual(posted.at(-1).result.action,actual.action);assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).result.action)),actual.action);
      const after=apply(state,g.config,actual.action).state;assert.notEqual(after.winner,1-state.turn);
      if(after.winner===null)for(const p of after.pieces.filter(p=>p.team===after.turn))for(const to of E.reachable(p,after,g.config))assert.notEqual(E.move(after,g.config,p.id,to).state.winner,1-state.turn);
      assert.equal(JSON.stringify({state,config:g.config,options}),before);
    }
  }finally{delete globalThis.self;}
});
