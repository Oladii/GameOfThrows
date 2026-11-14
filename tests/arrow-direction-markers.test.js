import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_CONFIG} from '../dist/rules.js';
import {attackReachPresentation,hexGridPoint,hexGridPolygon} from '../dist/board-presentation.js';
import {ShowcaseBattle,renderShowcaseBattle} from '../dist/onboarding-showcase.js';
const options={point:hexGridPoint,polygonPoints:hexGridPolygon({x:0,y:0})};
const markers=html=>[...html.matchAll(/data-weapon-cell="([^"]+)"/g)].map(m=>m[1]);
for(const type of ['shield','archer'])test(`${type}: range glyphs remain in all directions with or without targets`,()=>{
 const config=structuredClone(DEFAULT_CONFIG);config.stats[type].range=3;
 const piece={id:'own',type,team:1,q:0,r:0},enemy={id:'enemy',type:'shield',team:0,q:0,r:-2};
 for(const pieces of [[piece],[piece,enemy]]) {
  const position={pieces,turn:1,ply:0,winner:null};
  const view=attackReachPresentation(piece,position,config,options);
  const expected=view.cells.filter(c=>!pieces.some(p=>p.q===c.q&&p.r===c.r)).map(c=>`${c.q},${c.r}`).sort();
  assert.deepEqual(markers(view.markup).sort(),expected);
  assert.ok(markers(view.markup).includes('0,-1'));
  assert.doesNotMatch(view.markup,/attack-direction-muted/);
 }
 const css=fs.readFileSync(new URL('../dist/styles.css',import.meta.url),'utf8');
 assert.match(css,/\.attack-target-weapon\{[^}]*opacity:\.3;/);
 assert.doesNotMatch(css,/\.attack-target-weapon\.[^{]+\{[^}]*opacity:/,'no friendly or conditional brightness override');
});
test('training forecast retains range markers alongside attack and hint arrows',()=>{
 const battle=new ShowcaseBattle();battle.selectPiece('s-shield-left');battle.preview({q:0,r:0});
 const html=renderShowcaseBattle(battle);
 assert.match(html,/class="hint-trace"/);assert.match(html,/class="attack-ray"/);
 assert.match(html,/data-weapon-cell="-1,0"/);assert.match(html,/data-weapon-cell="1,0"/);
 battle.stop();
});
