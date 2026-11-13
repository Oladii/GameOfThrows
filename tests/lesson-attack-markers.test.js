import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { attackCellsFor,renderUnitBadges } from '../dist/board-presentation.js';
import { inspectCell } from '../dist/engine.js';
import { ShowcaseBattle, UNIT_BATTLE_SCENES, renderShowcaseBattle } from '../dist/onboarding-showcase.js';
const keys=html=>[...html.matchAll(/data-threat-cell="([^"]+)"/g)].map(match=>match[1]).sort();

test('all four demo attack markers match native attack cells for selection and forecasts',()=>{
  for(const sceneKey of UNIT_BATTLE_SCENES){
    const battle=new ShowcaseBattle({sceneKey});
    for(const piece of battle.position.pieces.filter(p=>p.team===1))for(const preview of [false,true]){
      battle.clearSelection();battle.selectPiece(piece.id);
      const destination=preview?battle.previewMoves[0]:null;
      if(destination)battle.preview(destination);
      const state=destination?inspectCell(battle.position,battle.config,destination,piece.id).position:battle.position;
      const source=state.pieces.find(p=>p.id===piece.id);
      const friendly=new Set([...state.pieces,...battle.position.pieces].filter(p=>p.team===1).map(p=>`${p.q},${p.r}`));
      const expected=attackCellsFor(source,state,battle.config).map(p=>`${p.q},${p.r}`).filter(key=>!friendly.has(key)).sort();
      const html=renderShowcaseBattle(battle,{});
      assert.deepEqual(keys(html),expected,`${sceneKey}:${piece.id}:${preview}`);
      if(expected.length)assert.match(html,/attack-target-(?:weapon|fill|outline) south/);
    }
  }
  const lethal=new ShowcaseBattle({sceneKey:'unit-drum-shield'});
  lethal.selectPiece('blue');lethal.preview({q:0,r:0});
  assert.match(renderShowcaseBattle(lethal,{},renderUnitBadges),/incoming-indicator lethal/);
});

test('each demo has a prescribed action and live forecasts update the shared battle layers',()=>{
  for(const sceneKey of UNIT_BATTLE_SCENES){const battle=new ShowcaseBattle({sceneKey});assert.ok(battle.copy[0][0].length>30);assert.ok(battle.expectedAction);}
  const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const refresh=app.slice(app.indexOf('function refreshShowcasePreview('),app.indexOf('function previewShowcaseMove('));
  assert.match(refresh,/'effects','overlays'/);
});
