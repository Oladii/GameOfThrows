import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, cells, key } from '../dist/engine.js';
import { inspectionDamageArrows, renderDamageArrows, hexGridPoint } from '../dist/board-presentation.js';
import { createShowcaseBattle, renderShowcaseBattle } from '../dist/onboarding-showcase.js';
const p=(id,team,q,r)=>({id,type:'archer',team,q,r});
const own=p('own',1,0,0), enemy=p('enemy',0,0,2);
const position={turn:1,ply:0,winner:null,pieces:[own,enemy,p('ally',1,-2,2),p('other',0,2,0)]};
const report=analyze(position,DEFAULT_CONFIG);
const edges=arrows=>arrows.map(a=>`${a.source.id}:${a.target.id}`).sort();
const paths = html => [...html.matchAll(/class="attack-ray" data-source="([^"]+)" data-target="([^"]+)"([^>]*)>/g)].flatMap(([, source, target, attrs]) => attrs.includes('data-bidirectional="true"') ? [`${source}:${target}`, `${target}:${source}`] : [`${source}:${target}`]).sort();
test('selection gives outgoing, hover gives incoming, both combine without duplicates',()=>{
 assert.deepEqual(inspectionDamageArrows(null,null,position,report),[]);
 assert.deepEqual(edges(inspectionDamageArrows(null,'own',position,report)),['own:enemy','own:other']);
 assert.deepEqual(edges(inspectionDamageArrows(enemy,null,position,report)),['ally:enemy','own:enemy']);
 assert.deepEqual(edges(inspectionDamageArrows(enemy,'own',position,report)),['ally:enemy','own:enemy','own:other']);
 assert.deepEqual(edges(inspectionDamageArrows(own,'own',position,report)),['enemy:own','other:own','own:enemy','own:other']);
 const enemySelection=inspectionDamageArrows(null,'enemy',position,report);
 assert.ok(enemySelection.length>0);assert.ok(enemySelection.every(a=>a.source.id==='enemy'));
});
test('forecast uses the future position and damage report for both directions',()=>{
 const preview=inspectCell(position,DEFAULT_CONFIG,{q:1,r:0},own.id);
 assert.equal(preview.isPreview,true);
 const arrows=inspectionDamageArrows(preview.piece,own.id,preview.position,preview.report);
 for(const arrow of arrows){
  const actual=preview.report.get(arrow.target.id).attackers.find(a=>a.id===arrow.source.id);
  assert.ok(actual);assert.equal(arrow.damage,actual.damage);
  const moved=arrow.source.id===own.id?arrow.source:arrow.target;
  assert.deepEqual([moved.q,moved.r],[1,0]);
 }
});
test('live board keeps selection arrows after hover leaves and shows combat independently',()=>{
 const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),layer={innerHTML:''};
 const context=vm.createContext({config:DEFAULT_CONFIG,selected:'own',hover:null,playMode:'local',humanTeam:1,movement:null,combat:null,report,
 inspectionContext:()=>({piece:enemy,position,report,isPreview:false}),inspectionDamageArrows,renderDamageArrows,cells,key,
 document:{querySelectorAll:()=>[]},$:()=>layer,point:hexGridPoint,paintAttackReach(){},renderInspector(){}});
 vm.runInContext(source.slice(source.indexOf('function highlightSources()'),source.indexOf('function paintAttackReach(')),context);
 context.highlightSources();assert.deepEqual(paths(layer.innerHTML),['own:enemy','own:other']);
 context.hover='0,2';context.highlightSources();assert.deepEqual(paths(layer.innerHTML),['ally:enemy','own:enemy','own:other']);
 context.hover=null;context.inspectionContext=()=>({piece:null,position,report,isPreview:false});context.highlightSources();assert.deepEqual(paths(layer.innerHTML),['own:enemy','own:other']);
 context.selected=null;context.highlightSources();assert.deepEqual(paths(layer.innerHTML),[]);
 context.movement={};context.highlightSources();assert.equal(layer.innerHTML,'');context.movement=null;
 const arrows=inspectionDamageArrows(enemy,null,position,report);
 context.combat={phase:'attacks',groups:[{arrows}],groupIndex:0,visiblePosition:position,arrowCount:2,report};context.highlightSources();assert.equal(paths(layer.innerHTML).length,2);
});
test('mobile selection shows incoming arrows without a hover and previews the tapped destination', () => {
 const html = fs.readFileSync(new URL('../docs/mobile.html', import.meta.url), 'utf8');
 const selectedPosition = { ...position, pieces: [{ ...own, type: 'shield' }, ...position.pieces.slice(1)] };
 const selectedReport = analyze(selectedPosition, DEFAULT_CONFIG);
 const layer = { innerHTML: '' };
 const context = vm.createContext({
  selected: null, hover: null, inspection: null, mobileTarget: null, mobileInspected: null, movement: null, combat: null, currentDeaths: [],
  playMode: 'bot', humanTeam: 1, config: DEFAULT_CONFIG, report: selectedReport, position: selectedPosition,
  available: [{q: 1, r: 0}], humanCanMove: () => true, visibleState: () => selectedPosition,
  document: { querySelectorAll: () => [] }, $: selector => selector === '#attack-lines' ? layer : null,
  paintAttackReach() {}, renderInspector() {}, inspectionDamageArrows, inspectCell, renderDamageArrows, point: hexGridPoint, cells, key,
  unitAppearance: () => ({veteran: false}), renderTokenBody: () => '', unitBadges: () => '', ICON_PATHS: {},
 });
 assert.match(html, /boardMarkup\(restoredIds\); setMobileInspection\(state\); paintAuras\(\); highlightSources\(\);/);
 vm.runInContext(html.slice(html.indexOf('function inspectionContext()'), html.indexOf('function paintAttackReach(')), context);
 vm.runInContext(html.slice(html.indexOf('function setMobileInspection('), html.indexOf('function refreshMobileInspection(')), context);
 const render = () => vm.runInContext('setMobileInspection(position); highlightSources();', context);
 render();
 assert.deepEqual(paths(layer.innerHTML), []);
 context.selected = own.id;
 render();
 assert.deepEqual(paths(layer.innerHTML), ['enemy:own', 'other:own']);
 context.mobileTarget = {q: 1, r: 0};
 render();
 assert.match(layer.innerHTML, /class="piece preview-token/);
 assert.deepEqual(paths(layer.innerHTML), ['other:own', 'own:other']);
 context.selected = null;
 render();
 assert.deepEqual(paths(layer.innerHTML), []);
 assert.doesNotMatch(layer.innerHTML, /preview-token/);
});
test('training follows the same selection and hover union',()=>{
 const battle={...createShowcaseBattle(),config:DEFAULT_CONFIG,position,selectedId:own.id};
 assert.deepEqual(paths(renderShowcaseBattle(battle)),['own:enemy','own:other']);
 battle.hoverCell={q:enemy.q,r:enemy.r};assert.deepEqual(paths(renderShowcaseBattle(battle)),['ally:enemy','own:enemy','own:other']);
 battle.hoverCell=null;assert.deepEqual(paths(renderShowcaseBattle(battle)),['own:enemy','own:other']);
 battle.selectedId=null;assert.deepEqual(paths(renderShowcaseBattle(battle)),[]);
});
test('click selection restores inspection after render resets hover',()=>{
 const source=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');let click,hover='0,0',selected=false;
 const cell={dataset:{cell:'0,0'}};
 const context=vm.createContext({$:()=>({addEventListener:(_,handler)=>click=handler}),gameAudio:{click(){}},focusBoardCell(){},activateBoardCell(){selected=true;hover=null;},hoverCell(event){assert.equal(selected,true);hover=event.target.closest().dataset.cell;},clearSelection(){}});
 vm.runInContext(source.slice(source.indexOf("$('.board-wrap').addEventListener('click'"),source.indexOf("$('#board').addEventListener('mousedown'")),context);
 click({target:{closest:()=>cell}});assert.equal(hover,'0,0');
});
