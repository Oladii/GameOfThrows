import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, move, inspectCell, shieldCanRetreat } from '../dist/engine.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { renderUnitBadges } from '../dist/board-presentation.js';
import { ShowcaseBattle, createUnitBattle, renderShowcaseBattle, UNIT_BATTLE_SCENES } from '../dist/onboarding-showcase.js';
import { renderUnitExamples } from '../dist/onboarding-units.js';

const edges = html => [...html.matchAll(/class="attack-ray" data-source="([^"]+)" data-target="([^"]+)"/g)].map(m=>`${m[1]}:${m[2]}`).sort();
function setup(sceneKey, reducedMotion=true) {
  let id=0,now=0;
  const timers=new Map(),frames=new Map();
  const clock={now:()=>now,setTimer:callback=>(timers.set(++id,callback),id),clearTimer:id=>timers.delete(id),requestFrame:callback=>(frames.set(++id,callback),id),cancelFrame:id=>frames.delete(id)};
  const battle=new ShowcaseBattle({sceneKey,clock,reducedMotion:()=>reducedMotion});
  const advance=()=>{now+=1000;const scheduled=[...frames.values()];frames.clear();scheduled.forEach(fn=>fn());};
  const settle=()=>{let limit=30;while(battle.presentation&&limit--){if(frames.size)advance();else{const [id,fn]=[...timers][0];timers.delete(id);fn();}}assert.equal(battle.presentation,null);};
  const play=()=>{const action=battle.expectedAction;assert.ok(action);if(battle.selectedId!==action.id)battle.selectPiece(action.id);assert.equal(battle.moveTo(action.to),true);settle();};
  return {battle,timers,frames,settle,advance,play};
}

test('all four unit demos use the training battle renderer and only a reset control',()=>{
  const html=renderUnitExamples({}, {}, renderUnitBadges);
  for(const sceneKey of UNIT_BATTLE_SCENES){
    const markup=renderShowcaseBattle(createUnitBattle(sceneKey),{},renderUnitBadges);
    assert.match(html,new RegExp(`data-showcase-battle="${sceneKey}"`));
    assert.doesNotMatch(html,new RegExp(`data-lesson-scene="${sceneKey}"`));
    assert.deepEqual([...markup.matchAll(/data-showcase-action="([^"]+)"/g)].map(m=>m[1]),['restart']);
    assert.match(markup,/Вернуть исходную позицию/);
    assert.match(markup,/unit-demo-controls/);
    assert.match(markup,new RegExp(`id="${sceneKey}-effects"`));
    assert.match(markup,new RegExp(`id="${sceneKey}-damage-arrow-north"`));
    assert.doesNotMatch(markup,/id="training-|url\(#training-/);
    assert.deepEqual(createUnitBattle(sceneKey).config.stats,DEFAULT_CONFIG.stats);
  }
});

test('veteran starts ordinary, promotes by reaching the edge, retreats one cell and kills through the actual engine',()=>{
  const {battle,play,timers}=setup('unit-shield');
  const initial=structuredClone(battle.position);
  assert.equal(shieldCanRetreat(initial.pieces[0],battle.config),false);
  assert.equal(initial.pieces[0].r,-2);
  let native=move(battle.position,battle.config,'blue',{q:0,r:-3}).state;
  native.turn=1;play();assert.deepEqual(battle.position,native);
  assert.equal(shieldCanRetreat(battle.position.pieces[0],battle.config),true);
  assert.ok(battle.position.pieces.some(p=>p.id==='enemy'));
  assert.equal(battle.phase,'ready');assert.equal(timers.size,0,'no scripted enemy reply in a unit exercise');
  native=move(battle.position,battle.config,'blue',{q:0,r:-2}).state;
  play();assert.deepEqual(battle.position,native);assert.equal(battle.phase,'finished');
  assert.equal(battle.position.pieces[0].r,-2);assert.equal(battle.position.pieces[0].reachedFarEdge,true);
  assert.ok(!battle.position.pieces.some(p=>p.id==='enemy'));
  assert.equal(battle.expectedAction,null);
  battle.restart();assert.deepEqual(battle.position,initial);assert.equal(timers.size,0);
});

test('unit previews follow the same incoming-arrow and outgoing-damage rules as the training battle',()=>{
  const {battle}=setup('unit-shield-defense');
  const initial=structuredClone(battle.position);
  assert.deepEqual(edges(renderShowcaseBattle(battle)),[],'no permanent attack lines');
  battle.preview(battle.position.pieces.find(p=>p.id==='ally'));
  assert.deepEqual(edges(renderShowcaseBattle(battle)),['enemy:ally']);
  battle.selectPiece('blue');battle.preview({q:0,r:0});
  const expected=inspectCell(initial,battle.config,{q:0,r:0},'blue');
  assert.equal(expected.report.get('ally').incoming,0);
  assert.equal(expected.report.get('blue').incoming,2);
  const html=renderShowcaseBattle(battle,{},renderUnitBadges);
  assert.deepEqual(edges(html),['enemy:blue']);
  assert.match(html,/unit-shield-defense-preview-token/);
  assert.match(html,/Входящий урон: 2/);
  assert.match(html,/data-weapon-cell=/);
  assert.deepEqual(battle.position,initial);
  // The ally can be inspected and previewed as in ordinary battle, but cannot make an unprescribed move.
  battle.selectPiece('ally');const other=battle.previewMoves[0];battle.preview(other);
  assert.deepEqual(battle.previewCell,{q:other.q,r:other.r});
  assert.equal(battle.moveTo(other),false);assert.deepEqual(battle.position,initial);
  battle.selectPiece('blue');assert.equal(battle.moveTo({q:1,r:-1}),false);
});

test('defender blocks damage instead of only increasing protection, and inspection remains interactive afterwards',()=>{
  const {battle,play}=setup('unit-shield-defense');
  assert.equal(analyze(battle.position,battle.config).get('ally').incoming,2);
  const native=move(battle.position,battle.config,'blue',{q:0,r:0}).state;native.turn=1;
  play();assert.deepEqual(battle.position,native);
  const report=analyze(battle.position,battle.config);
  assert.equal(report.get('ally').incoming,0);assert.equal(report.get('blue').incoming,2);assert.equal(report.get('blue').dead,false);
  battle.preview(battle.position.pieces.find(p=>p.id==='blue'));
  assert.deepEqual(edges(renderShowcaseBattle(battle)),['enemy:blue']);
  battle.selectPiece('ally');battle.preview(battle.position.pieces.find(p=>p.id==='enemy'));
  assert.equal(battle.moveTo(battle.previewMoves[0]),false);assert.equal(battle.position.ply,1);
  battle.restart();assert.equal(analyze(battle.position,battle.config).get('ally').incoming,2);
});

test('veteran lethal combat uses the training dimming, attack reveal and death sequence',()=>{
  const {battle,play,timers,settle}=setup('unit-shield');play();
  battle.selectPiece('blue');battle.moveTo({q:0,r:-2});
  assert.equal(battle.presentation.phase,'dimming');
  const phases=[];
  while(battle.presentation){const [id,fn]=[...timers][0];timers.delete(id);fn();if(battle.presentation)phases.push([battle.presentation.phase,edges(renderShowcaseBattle(battle))]);}
  assert.deepEqual(phases,[['attacks',['blue:enemy']],['deaths',[]]]);
  assert.equal(battle.position.winner,1);settle();
});

test('reset or leaving a scene cancels movement and combat without stale callbacks or shared state',()=>{
  for(const sceneKey of UNIT_BATTLE_SCENES)for(const action of ['restart','stop']){
    const {battle,frames,advance,timers}=setup(sceneKey,false),other=setup('unit-shield-defense').battle;
    const initial=structuredClone(battle.position),snapshot=structuredClone(other.position);
    battle.selectPiece(battle.expectedAction.id);battle.moveTo(battle.expectedAction.to);
    assert.equal(battle.presentation.phase,'movement');
    const stale=[...frames.values()];battle[action]();stale.forEach(fn=>fn());advance();
    assert.equal(battle.presentation,null);assert.deepEqual(battle.position,initial);
    assert.equal(timers.size,0);assert.deepEqual(other.position,snapshot);
  }
  const {battle,play,timers}=setup('unit-shield');play();battle.selectPiece('blue');battle.moveTo({q:0,r:-2});
  const stale=[...timers.values()];battle.restart();stale.forEach(fn=>fn());
  assert.equal(battle.position.ply,0);assert.equal(battle.presentation,null);assert.equal(timers.size,0);
});


test('drum permits exactly the two-step shield route that reaches and kills an archer',()=>{
  const {battle,play}=setup('unit-drum-shield');
  const initial=structuredClone(battle.position),hero=initial.pieces.find(p=>p.id==='blue');
  const report=analyze(initial,battle.config);
  assert.equal(report.get('blue').move,2);
  const withoutDrum={...initial,pieces:initial.pieces.filter(p=>p.id!=='drum')};
  assert.equal(analyze(withoutDrum,battle.config).get('blue').move,1);
  assert.equal(inspectCell(withoutDrum,battle.config,{q:0,r:0},'blue').isPreview,false);
  const expected=move(initial,battle.config,'blue',{q:0,r:0});
  assert.equal(expected.report.get('enemy').incoming,5);assert.equal(expected.report.get('enemy').dead,true);
  assert.equal(expected.report.get('blue').dead,false);assert.equal(expected.report.get('blue').move,1,'extra step survives leaving aura for this action');
  play();assert.deepEqual(battle.position,expected.state);
  assert.ok(!battle.position.pieces.some(p=>p.id==='enemy'));assert.equal(battle.position.ply,1);
  battle.restart();assert.deepEqual(battle.position,initial);
});

test('horn damage and commander range are both necessary for the archer to kill the out-of-range target',()=>{
  const {battle,play}=setup('unit-archer');
  const initial=structuredClone(battle.position),report=analyze(initial,battle.config);
  assert.equal(report.get('archer').damage,3);assert.equal(report.get('archer').range,4);
  assert.equal(report.get('enemy').incoming,0);
  const expected=move(initial,battle.config,'commander',{q:-1,r:1});
  const forecast=inspectCell(initial,battle.config,{q:-1,r:1},'commander');
  assert.equal(expected.report.get('archer').range,5);assert.equal(expected.report.get('archer').damage,3);
  assert.deepEqual(expected.report.get('enemy').attackers.map(a=>a.id),['archer']);
  assert.equal(expected.report.get('enemy').incoming,3);assert.equal(expected.report.get('enemy').dead,true);
  const withoutHorn={...forecast.position,pieces:forecast.position.pieces.filter(p=>p.id!=='horn')};
  assert.equal(analyze(withoutHorn,battle.config).get('enemy').incoming,2);
  assert.equal(analyze(withoutHorn,battle.config).get('enemy').dead,false);
  const withoutCommander={...forecast.position,pieces:forecast.position.pieces.filter(p=>p.id!=='commander')};
  assert.equal(analyze(withoutCommander,battle.config).get('archer').range,4);
  assert.equal(analyze(withoutCommander,battle.config).get('enemy').incoming,0);
  play();assert.deepEqual(battle.position,expected.state);assert.equal(battle.position.winner,1);
  battle.restart();assert.deepEqual(battle.position,initial);
});
