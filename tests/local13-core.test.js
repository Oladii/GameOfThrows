import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import * as E from '../dist/engine.js';
import * as frozenEngine from '../../outputs/formation-bot-fix-2026-11-12/source/engine.js';
import { classifyPosition, prepareStartPosition } from '../dist/start-position.js';
import { oneReplySafety } from '../dist/defensive-selection.mjs';
const root = new URL('../../', import.meta.url);
const read = name => JSON.parse(fs.readFileSync(new URL(name, root)));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const frozenConfig = read('outputs/universal-auras-balance-2026-11-12/variants.json').universal;
const commanderConfig = E.clone(frozenConfig); commanderConfig.archerEdgeDamageBonus = 3;
commanderConfig.stats.scoutLamp.damage = 3; commanderConfig.stats.scoutLamp.range = 2;
const frozenInitial = read('outputs/universal-auras-balance-2026-11-12/initials.json').universal;
const expectedInitial = E.clone(frozenInitial);
for (const [id,q,r] of [['p1',3,-4],['p3',1,-3],['p5',2,-3],['p11',4,-3],['p13',3,-3],['p19',0,-3],['p21',-1,-3],['p25',1,-4]]) {
  const index=expectedInitial.pieces.findIndex(p=>p.id===id);
  Object.assign(expectedInitial.pieces[index],{q,r});
  Object.assign(expectedInitial.pieces[index+1],{q:q===0?0:-q,r:-r});
}
const apply = (engine,state,config,action) => action.pass ? engine.pass(state,config) : engine.move(state,config,action.id,action.to);

test('local13 changes only commander attack3/range2 while retaining the screenshot-approved 26-piece deployment', () => {
  assert.deepEqual(DEFAULT_CONFIG, commanderConfig);
  assert.equal(hash(frozenConfig), '567ce00032de96cffd27372a3114042cb7cca38d29a38adcd45a9129fad986f8');
  assert.equal(BALANCE_REVISION,23);
  assert.deepEqual(E.createGame(DEFAULT_CONFIG),expectedInitial);
  assert.deepEqual(E.createScenario('start',DEFAULT_CONFIG),expectedInitial);
  assert.equal(classifyPosition(expectedInitial,DEFAULT_CONFIG),'default');
  for (const turn of [0,1]) assert.deepEqual(prepareStartPosition(expectedInitial,DEFAULT_CONFIG,turn),{...expectedInitial,turn});
  assert.equal(classifyPosition(frozenInitial,DEFAULT_CONFIG),'custom');
  const s=E.createGame(DEFAULT_CONFIG);E.validateState(s,DEFAULT_CONFIG);
  const south=s.pieces.filter(p=>p.team===1);
  assert.deepEqual(south.filter(p=>p.type==='shield').map(p=>p.q).sort((a,b)=>a-b),[-3,-2,-1,0,1]);
  assert.ok(south.filter(p=>p.type==='shield').every(p=>p.r===2));
  assert.deepEqual(south.filter(p=>p.type==='archer').map(p=>[p.q,p.r]),[[-4,3],[-3,3],[0,3],[1,3]]);
  for (const [type,q,r] of [['scoutLamp',-2,3],['defenseLamp',-1,3],['attackLamp',-3,4],['horn',-1,4]]) {const p=south.find(p=>p.type===type);assert.deepEqual([p.q,p.r],[q,r]);}
  assert.equal(new Set(s.pieces.map(p=>`${p.q},${p.r}`)).size,26);
  for(const team of [0,1])assert.deepEqual(['shield','archer','attackLamp','defenseLamp','scoutLamp','horn'].map(type=>s.pieces.filter(p=>p.team===team&&p.type===type).length),[5,4,1,1,1,1]);
  for(let i=0;i<s.pieces.length;i+=2){const a=s.pieces[i],b=s.pieces[i+1];assert.equal(a.type,b.type);assert.equal(a.q+b.q,0);assert.equal(a.r+b.r,0);}
  assert.deepEqual(E.clone(E.createGame(PREVIOUS_LOCAL_CONFIG)),E.clone(frozenEngine.createGame(PREVIOUS_LOCAL_CONFIG)));
  assert.deepEqual(updateSavedBalance(PREVIOUS_LOCAL_CONFIG,19),PREVIOUS_LOCAL_CONFIG);
});

test('all 16 archived fixed-policy full game replays preserve combat, reports, phases, movement and state hashes', () => {
  const directory = new URL('outputs/formation-bot-fix-2026-11-12/games/',root);
  const games=fs.readdirSync(directory).filter(name=>name.includes('-D-'));
  assert.equal(games.length,16);
  for(const name of games){const g=JSON.parse(fs.readFileSync(new URL(name,directory)));assert.deepEqual(g.config,frozenConfig);let s=E.clone(g.initial);
    for(const entry of g.actions){
      assert.deepEqual([...E.analyze(s,g.config)],[...frozenEngine.analyze(s,g.config)]);
      for(const piece of s.pieces){assert.deepEqual(E.effective(piece,s,g.config),frozenEngine.effective(piece,s,g.config));assert.deepEqual(E.reachable(piece,s,g.config),frozenEngine.reachable(piece,s,g.config));}
      const actual=apply(E,s,g.config,entry.action),frozen=apply(frozenEngine,s,g.config,entry.action);
      assert.deepEqual(actual,frozen,`${name} action ${entry.index}`);
      assert.equal(hash(actual.state),entry.stateHash);
      assert.deepEqual(actual.deaths,entry.deaths);
      assert.deepEqual([...actual.report].map(([id,stats])=>({id,...stats})),entry.combat);
      s=actual.state;
    }assert.deepEqual(s,g.final);
  }
});

test('teaching and advice policies preserve checked evaluation weights, alpha-beta and exact safety', () => {
  const current = fs.readFileSync(new URL('../dist/formation-strategy.mjs',import.meta.url),'utf8');
  const frozen = fs.readFileSync(new URL('outputs/formation-bot-fix-2026-11-12/source/strategies-fixed.mjs',root),'utf8');
  const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  assert.equal(section(current, 'function alphaBeta(', 'function damageBound('), section(frozen, 'function alphaBeta(', 'function damageBound('));
  // Compare executable evaluation and route code, not the evolving options JSDoc.
  assert.equal(section(current, 'function damageBound(', '/**\n * Pure browser/worker'), section(frozen, 'function damageBound(', '/**\n * Pure browser/worker'));
  assert.equal(current.match(/const ROOT_BEAM = .*;/)[0], frozen.match(/const ROOT_BEAM = .*;/)[0]);
  assert.equal(fs.readFileSync(new URL('../dist/defensive-selection.mjs',import.meta.url),'utf8'), fs.readFileSync(new URL('outputs/formation-bot-fix-2026-11-12/source/defensive-selection.mjs',root),'utf8'));
});

test('one-reply safety preserves terminal and no-legal-reply classifications', () => {
  for(const [winner,status,safe]of [[0,'own-win',true],[1,'opponent-win',false],['draw','draw',true]])assert.deepEqual(oneReplySafety({winner},0,()=>{throw Error('terminal must not simulate');},()=>{}),{safe,status,replies:0});
  assert.deepEqual(oneReplySafety({winner:null},0,()=>[],()=>{}),{safe:true,status:'no-legal-replies',replies:0});
  const replies=[{winner:0},{winner:1}];assert.deepEqual(oneReplySafety({winner:null},0,()=>replies,(_,action)=>({state:action})),{safe:false,status:'opponent-reply-win',replies:2});
});
