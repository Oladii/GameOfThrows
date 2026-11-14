import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, BALANCE_REVISION } from '../dist/rules.js';
import { createGame, createScenario, validateState } from '../dist/engine.js';
import { classifyPosition, prepareStartPosition } from '../dist/start-position.js';
import { oneReplySafety } from '../dist/defensive-selection.mjs';

// Independent release expectation: pair order, ids, groups and exact approved cells.
const north=[['attackLamp',3,-4,null],['defenseLamp',1,-3,null],['scoutLamp',2,-3,null],['shield',-1,-2,1],['shield',0,-2,1],['archer',4,-3,1],['archer',3,-3,1],['shield',2,-2,2],['shield',3,-2,2],['archer',0,-3,2],['archer',-1,-3,2],['shield',1,-2,null],['horn',1,-4,null]];
const expected={pieces:north.flatMap(([type,q,r,group],index)=>[
  {id:`p${index*2+1}`,type,team:0,q,r,group},
  {id:`p${index*2+2}`,type,team:1,q:q===0?0:-q,r:-r,group}
]),turn:0,ply:0,winner:null};

test('release defaults retain revision23 parameters and the exact approved 13-per-side formation',()=>{
  assert.equal(BALANCE_REVISION,23);
  assert.equal(createHash('sha256').update(JSON.stringify(DEFAULT_CONFIG)).digest('hex'),'0b3c2cb65a96a63b203bfe8e52891df7ffee3535406c8274c536b3ffaaa4038a');
  const state=createGame(DEFAULT_CONFIG);assert.deepEqual(state,expected);assert.deepEqual(createScenario('start',DEFAULT_CONFIG),expected);
  assert.equal(new Set(state.pieces.map(p=>`${p.q},${p.r}`)).size,26);
  assert.deepEqual(validateState(state,DEFAULT_CONFIG),state);
  for(const team of [0,1])assert.deepEqual(['shield','archer','attackLamp','defenseLamp','scoutLamp','horn'].map(type=>state.pieces.filter(p=>p.team===team&&p.type===type).length),[5,4,1,1,1,1]);
  assert.equal(classifyPosition(state,DEFAULT_CONFIG),'default');
  for(const turn of [0,1])assert.deepEqual(prepareStartPosition(state,DEFAULT_CONFIG,turn),{...expected,turn});
});

test('one-reply safety distinguishes terminal results and does not invent wins for blocked turns',()=>{
  for(const [winner,status,safe]of [[0,'own-win',true],[1,'opponent-win',false],['draw','draw',true]])assert.deepEqual(oneReplySafety({winner},0,()=>{throw Error('terminal must not simulate');},()=>{}),{safe,status,replies:0});
  assert.deepEqual(oneReplySafety({winner:null},0,()=>[],()=>{}),{safe:true,status:'no-legal-replies',replies:0});
  assert.deepEqual(oneReplySafety({winner:null},0,()=>[{winner:null},{winner:1}],(_,action)=>({state:action})),{safe:false,status:'opponent-reply-win',replies:2});
});
