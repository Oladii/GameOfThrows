import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, TEAM_NAMES } from '../dist/rules.js';
import { clone, effective, shieldCanRetreat } from '../dist/engine.js';
import { hexGridPoint, AURA_COLORS, auraKind, auraCircleMarkup } from '../dist/board-presentation.js';
import { createMoveLesson, renderMoveLesson } from '../dist/onboarding-examples.js';
const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const painter = app.slice(app.indexOf('function paintAuras() {'), app.indexOf('\nfunction lastMoveTrace()'));
const piece = (id,type,team,q=0,r=0)=>({id,type,team,q,r});
function setup(pieces) {
  const config=clone(DEFAULT_CONFIG), state={pieces,turn:0,ply:0,winner:null};
  const layer={innerHTML:''},legend={innerHTML:'',hidden:true};
  const context=vm.createContext({ hexGridPoint, combat: null,config,TEAM_NAMES,effective,shieldCanRetreat,AURA_COLORS,auraKind,auraCircleMarkup,selected:null,fieldView:null,preview:null,
    visibleState:()=>state,$:selector=>selector==='#aura-circles'?layer:legend});
  context.inspectionContext=()=>context.preview||{position:state,isPreview:false};
  vm.runInContext(app.split('\n').find(line=>line.startsWith('function point(')),context);
  vm.runInContext(painter,context);
  return {context,config,state,layer,legend,paint:()=>vm.runInContext('paintAuras()',context)};
}
test('selected auras are circles with effect colors and a boundary just beyond the outer-cell centre',()=>{
  for(const team of [0,1])for(const type of ['shield','archer','attackLamp','defenseLamp','scoutLamp','horn'])for(const veteran of [false,true]){
    const source={...piece('a',type,team),reachedFarEdge:veteran},ui=setup([source,piece('b','attackLamp',1-team,3,0)]);
    ui.context.selected='a';ui.paint();
    const promoted=type==='shield'&&veteran, radius=effective(source,ui.state,ui.config).aura;
    const circles=[...ui.layer.innerHTML.matchAll(/<circle[^>]*r="([^"]+)"[^>]*stroke="([^"]+)"/g)];
    assert.equal(circles.length,radius>0?1:0);
    if(radius===0){assert.equal(ui.legend.hidden,true);continue;}
    for(const c of circles){const lastCentre=radius*Math.sqrt(3)*33;assert.ok(Number(c[1])>lastCentre);assert.ok(Number(c[1])<lastCentre+10);}
    assert.ok(ui.layer.innerHTML.includes(`data-aura-origin="0,0"`));
    const kind=promoted?'combined':type==='horn'?'horn':type==='attackLamp'?'move':['shield','defenseLamp'].includes(type)?'defense':'attack';
    assert.ok(circles.some(c=>c[2]===AURA_COLORS[kind]));
    if(type==='horn'){assert.equal(AURA_COLORS.horn,'#9770be');assert.match(ui.legend.innerHTML,/> Урон<\/span>/);}
    assert.ok(!ui.layer.innerHTML.includes('polygon'));
    assert.equal(ui.legend.hidden,false);
  }
});
test('circle centre follows the selected movement preview; unrelated hover and deselection do not retain it',()=>{
  const source=piece('a','attackLamp',0),other=piece('b','shield',1,-3,0),ui=setup([source,other]);ui.context.selected='a';ui.paint();
  const original=ui.layer.innerHTML,preview=clone(ui.state);preview.pieces[0].q=1;
  ui.context.preview={isPreview:true,piece:preview.pieces[0],position:preview};ui.paint();
  assert.ok(ui.layer.innerHTML.includes('data-aura-origin="1,0"'));
  ui.context.preview={isPreview:false,piece:other,position:ui.state};ui.paint();assert.equal(ui.layer.innerHTML,original);
  ui.context.selected=null;ui.paint();assert.equal(ui.layer.innerHTML,'');assert.equal(ui.legend.hidden,true);
});
test('all-aura view shows both sources; attack view and zero radii hide rings',()=>{
  const ui=setup([piece('a','archer',0),piece('b','shield',1,2,0)]);ui.context.fieldView='auras';ui.paint();
  assert.equal((ui.layer.innerHTML.match(/class="aura-circles"/g)||[]).length,1);
  ui.context.fieldView='attacks';ui.context.selected='a';ui.paint();assert.equal(ui.layer.innerHTML,'');
  ui.context.fieldView=null;ui.config.stats.archer.aura=0;ui.paint();assert.equal(ui.layer.innerHTML,'');
});
test('square circles reach the furthest covered cell centres with and without diagonals',()=>{
  const ui=setup([piece('a','attackLamp',0,3,3)]);ui.config.geometry='square';ui.config.stats.attackLamp.aura=2;ui.context.selected='a';
  for(const diagonal of [false,true]){ui.config.experiments.squareDiagonals=diagonal;ui.paint();const radius=Number(ui.layer.innerHTML.match(/<circle[^>]*r="([^"]+)"/)[1]);assert.equal(radius,2*59*(diagonal?Math.SQRT2:1)+5.9);}
});
test('tutorial aura circles use the same renderer and follow hover, committed selection, and deselection',()=>{
  for(const aura of ['attack','defense']){
    const destination=createMoveLesson(4,{aura}).solution[0].to;
    for(const options of [{selected:true,previewPlacement:destination},{selected:true,placement:destination}]){
      const lesson=createMoveLesson(4,{aura,...options}),html=renderMoveLesson(lesson,{});
      assert.ok(html.includes(`data-aura-origin="${destination.q},${destination.r}"`));
      assert.ok(html.includes('class="aura-ring"'));assert.ok(!html.includes('lesson-aura-overlay'));
    }
    const html=renderMoveLesson(createMoveLesson(4,{aura,placement:destination}),{});
    assert.ok(!html.includes('class="aura-ring"'));
  }
});
