import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, resolve, isLethalDamage, move, effective, key } from '../dist/engine.js';
import { durabilityDisplay, attackCellsFor, unitStatParts, alliedBonusDetails, unitAppearance, VETERAN_SHIELD_ICON, renderMovingToken, renderDeathEffects, attackMarkerRotation, skullShape, attackReachPresentation } from '../dist/board-presentation.js';
import { LABELS } from '../dist/rules.js';
const piece = (id, type, team, q, r) => ({id, type, team, q, r});
const position = pieces => ({pieces, turn:0, ply:0, winner:null});

test('durability displays full defense without threats, a remainder under fire, and equality is lethal', () => {
  const c = structuredClone(REVISION_FOUR_CONFIG);
  assert.equal(c.stats.shield.fortitude, 4);
  const target = piece('target','shield',0,0,0), enemy = piece('enemy','archer',1,1,0);
  const s = position([target,enemy]);
  for (const [incoming, remaining, dead] of [[0,4,false],[2,2,false],[3,1,false],[4,0,true],[5,-1,true]]) {
    c.stats.archer.damage = incoming;
    const info = analyze(s,c).get('target'), view = durabilityDisplay(info);
    assert.equal(view.value,remaining); assert.equal(view.dead,dead);
    assert.equal(view.threatened,incoming>0);
    assert.equal(resolve(s,c).deaths.some(p=>p.id==='target'),dead);
  }
  assert.equal(isLethalDamage(0,0),false);
  assert.equal(isLethalDamage(1,0),true);
});
test('attack markers respect blockers and allies without concealing attackable enemies', () => {
  for (const geometry of ['hex','square']) {
    const c=structuredClone(REVISION_FOUR_CONFIG); c.geometry=geometry;c.size=6;
    const source=piece('archer','archer',0,2,2), friend=piece('friend','archer',0,3,2);
    const shield=piece('shield','shield',1,4,2), beyond=piece('beyond','archer',1,5,2);
    const s=position([source,friend,shield,beyond]);
    const marked=()=>new Set(attackCellsFor(source,s,c).map(p=>`${p.q},${p.r}`));
    assert.equal(marked().has('2,2'),false);assert.equal(marked().has('3,2'),false);
    assert.equal(marked().has('4,2'),true);assert.equal(marked().has('5,2'),false);
    c.experiments.allyShotsPass=false;
    assert.equal(marked().has('4,2'),false);
  }
});
test('movement preview updates attack markers and returns the same ally bonuses as combat', () => {
  const c=structuredClone(REVISION_FOUR_CONFIG);
  const archer=piece('archer','archer',0,0,0), banner=piece('banner','attackLamp',0,0,1);
  const s=position([archer,banner]);
  const before=unitStatParts(archer,s,c);
  assert.deepEqual(before.find(s=>s.field==='damage'),{field:'damage',base:2,personal:0,allied:2,total:4});
  const preview=inspectCell(s,c,{q:-2,r:0},archer.id);
  assert.equal(preview.isPreview,true);
  const damage=unitStatParts(preview.piece,preview.position,c).find(s=>s.field==='damage');
  assert.equal(damage.allied,0);assert.equal(damage.total,2);
  assert.equal(attackCellsFor(preview.piece,preview.position,c).some(cell=>cell.q===-3 && cell.r===0),true);
});
test('unit details distinguish personal veteran improvements and allied bonuses', () => {
  const c=structuredClone(REVISION_FOUR_CONFIG);
  const veteran={...piece('veteran','shield',0,0,0),reachedFarEdge:true};
  const banner=piece('banner','attackLamp',0,0,1), s=position([veteran,banner]);
  const parts=unitStatParts(veteran,s,c);
  assert.deepEqual(parts.find(s=>s.field==='damage'),{field:'damage',base:4,personal:1,allied:2,total:7});
  assert.deepEqual(parts.find(s=>s.field==='range'),{field:'range',base:1,personal:1,allied:0,total:2});
});

test('a promoted shield gets veteran armor and keeps it after retreat, during movement and death', () => {
  const config = structuredClone(DEFAULT_CONFIG); config.size = 3;
  const source = piece('blue', 'shield', 0, 0, 2), enemy = piece('enemy', 'shield', 1, -3, 0);
  const icons = { shield: '<path data-plain-shield="true"/>', archer: '<path data-archer="true"/>' };
  assert.equal(unitAppearance(source, config, icons).icon, icons.shield);
  const promoted = move(position([source, enemy]), config, source.id, { q: 0, r: 3 }).state;
  const veteran = promoted.pieces.find(p => p.id === source.id);
  assert.equal(unitAppearance(veteran, config, icons).veteran, true);
  assert.equal(unitAppearance(veteran, config, icons).icon, VETERAN_SHIELD_ICON);
  promoted.turn = 0;
  const retreated = move(promoted, config, source.id, { q: 0, r: 2 }).state.pieces.find(p => p.id === source.id);
  assert.equal(unitAppearance(retreated, config, icons).veteran, true);
  for (const team of [0, 1]) assert.equal(unitAppearance({ ...source, team, r: team ? -3 : 3 }, config, icons).veteran, true, 'legacy saves on the far edge look promoted too');
  assert.equal(unitAppearance({ ...source, type: 'archer', reachedFarEdge: true }, config, icons).veteran, false);
  const moving = renderMovingToken(retreated, { x: 10, y: 20, progress: .5 }, icons, 'test-token', config);
  const dying = renderDeathEffects([retreated], () => ({ x: 0, y: 0 }), '', icons, config);
  assert.ok(moving.includes('moving-token veteran')); assert.ok(moving.includes(VETERAN_SHIELD_ICON));
  assert.ok(dying.includes('death-ghost veteran')); assert.ok(dying.includes(VETERAN_SHIELD_ICON));
});

const appSource = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function reachPainter(config, state, selected) {
  let writes = 0, html = ''; const layer = { get innerHTML() { return html; }, set innerHTML(value) { writes++; html = value; } };
  const context = vm.createContext({ config, selected, attackReachPresentation, attackCellsFor, effective, isLethalDamage, attackMarkerRotation, key, LABELS, skullShape,
    visibleState: () => state, $: () => layer, document: { querySelectorAll: () => [] } });
  vm.runInContext(appSource.split('\n').find(line => line.startsWith('function point(')), context);
  vm.runInContext(appSource.split('\n').find(line => line.startsWith('function polygon(')), context);
  vm.runInContext(appSource.slice(appSource.indexOf('function paintAttackReach('), appSource.indexOf('function renderInspector(')), context);
  return { context, writes: () => writes, render(input) { context.paintAttackReach(input); return layer.innerHTML; } };
}

test('empty attack cells show directional arrows for archers and swords for other units', () => {
  for (const geometry of ['hex', 'square']) for (const type of ['archer', 'shield']) for (const team of [0, 1]) {
    const config=structuredClone(DEFAULT_CONFIG);config.geometry=geometry;config.size=11;
    config.experiments.allyShotsPass=true;config.stats[type].range=3;config.shieldPromotion.maxRange=3;config.stats.archer.fortitude=1000;
    const center=geometry==='hex'?0:5,source=piece('s',type,team,center,center);
    const ally=piece('a','archer',team,center+1,center),enemy=piece('e','archer',1-team,center+2,center);
    const state=position([source,ally,enemy]),painter=reachPainter(config,state,source.id);
    const html=painter.render({position:state,piece:source,isPreview:false});
    assert.ok(html.includes('attack-target-outline'));
    assert.ok(html.includes(`class="attack-target-fill ${team?'south':'north'}" data-threat-cell="${enemy.q},${enemy.r}"`));
    assert.ok(!html.includes(`data-threat-cell="${source.q},${source.r}"`));
    assert.ok(!html.includes(`data-threat-cell="${ally.q},${ally.r}"`));
    const weapons=[...html.matchAll(/class="attack-target-weapon [^"]+" data-weapon-cell="(-?\d+),(-?\d+)" data-weapon-kind="([^"]+)" transform="translate\([^)]+\) rotate\(([^)]+)\)"/g)];
    const emptyTargets=attackCellsFor(source,state,config).filter(c=>!state.pieces.some(p=>p.q===c.q&&p.r===c.r));
    assert.equal(weapons.length,emptyTargets.length);
    for(const weapon of weapons){
      assert.equal(weapon[3],type==='archer'?'arrow':'sword');
      const to=painter.context.point({q:+weapon[1],r:+weapon[2]}),from=painter.context.point(source),angle=Number(weapon[4])*Math.PI/180;
      const length=Math.hypot(to.x-from.x,to.y-from.y);
      assert.ok(Math.abs((Math.cos(angle)+Math.sin(angle))/Math.SQRT2-(to.x-from.x)/length)<1e-9);
      assert.ok(Math.abs((Math.sin(angle)-Math.cos(angle))/Math.SQRT2-(to.y-from.y)/length)<1e-9);
    }
    assert.ok(!/reach-flight|reach-icon|attack-streams|data-attack-kind="(?:arrow|sword)"/.test(html));
  }
});
test('lethal attacks retain upright skulls above the enemy cell fill', () => {
  for(const type of ['archer','shield']) {
    const config=structuredClone(DEFAULT_CONFIG),source=piece('s',type,0,0,0),state=position([source,piece('e','archer',1,-1,0)]);
    const painter=reachPainter(config,state,source.id),html=painter.render({position:state,piece:source,isPreview:false});
    assert.ok(html.includes('data-attack-kind="skull"'));assert.ok(html.includes('class="reach-skull"'));
    assert.ok(html.indexOf('attack-target-fill')<html.indexOf('class="reach-skull"'));
    const skull=html.match(/<g class="attack-reach [\s\S]*?<\/g><\/g>/)[0];
    assert.ok(!skull.includes('rotate('));
  }
});
test('movement preview leaves the visible source and every allied figure unmarked',()=>{
  for(const geometry of ['hex','square']) for(const team of [0,1]) {
    const config=structuredClone(DEFAULT_CONFIG);config.geometry=geometry;config.size=11;
    const center=geometry==='hex'?0:5,source=piece('s','archer',team,center,center),ally=piece('a','shield',team,center-1,center);
    const state=position([source,ally]);state.turn=team;
    const painter=reachPainter(config,state,source.id),preview=inspectCell(state,config,{q:center+1,r:center},source.id);
    assert.equal(preview.isPreview,true);
    assert.ok(attackCellsFor(preview.piece,preview.position,config).some(c=>c.q===source.q&&c.r===source.r));
    const html=painter.render(preview);
    for(const cell of [source,ally,preview.piece]) assert.ok(!html.includes(`data-threat-cell="${cell.q},${cell.r}"`));
    assert.ok(html.includes('data-threat-cell='));
  }
});
test('unchanged inspection avoids rebuilding attack markers',()=>{
  const config=structuredClone(DEFAULT_CONFIG),source=piece('s','archer',0,0,0),state=position([source]),painter=reachPainter(config,state,'s');
  painter.render({position:state,piece:source,isPreview:false});const writes=painter.writes();
  painter.render({position:state,piece:null,isPreview:false});assert.equal(painter.writes(),writes);
  painter.render(inspectCell(state,config,{q:1,r:0},source.id));assert.equal(painter.writes(),writes+1);
  painter.context.selected=null;assert.equal(painter.render({position:state,isPreview:false}),'');
});
test('archer tokens face the enemy side during rest, movement and death',()=>{
  const config=structuredClone(DEFAULT_CONFIG),icons={archer:'<path data-arrow="right"/>'};
  for(const team of [0,1]){const archer=piece('a','archer',team,0,0),rotation=`rotate(${team===0?90:-90} 12 12)`;
    assert.ok(unitAppearance(archer,config,icons).icon.includes(rotation));
    assert.ok(renderMovingToken(archer,{x:0,y:0,progress:0},icons,'moving',config).includes(rotation));
    assert.ok(renderDeathEffects([archer],()=>({x:0,y:0}),'',icons,config).includes(rotation));
  }
});

test('board aura playback pauses while hidden or offscreen and resumes only when both conditions clear',()=>{
  let intersection,visibility;const classes=new Set(),board={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
  const document={hidden:false,addEventListener:(event,listener)=>{assert.equal(event,'visibilitychange');visibility=listener;}};
  const context=vm.createContext({document,$:()=>board,IntersectionObserver:class{constructor(callback){intersection=callback;}observe(element){assert.equal(element,board);}}});
  const start=appSource.indexOf('let attackReachInView ='),end=appSource.indexOf("if (gamePhase === 'playing') archiveRecorder.resume",start);
  vm.runInContext(appSource.slice(start,end),context);
  const paused=()=>classes.has('attack-reach-paused');assert.equal(paused(),false);
  intersection([{isIntersecting:false}]);assert.equal(paused(),true);
  document.hidden=true;intersection([{isIntersecting:true}]);assert.equal(paused(),true);
  document.hidden=false;visibility();assert.equal(paused(),false);
});


test('veteran ally details use the separate aura while personal stat calculations keep the permanent bonus', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const veteran = { ...piece('veteran', 'shield', 0, 0, 0), reachedFarEdge: true };
  const archer = piece('archer', 'archer', 0, 0, 1), support = piece('support', 'attackLamp', 0, 1, 0);
  const state = position([veteran, archer, support]);
  assert.deepEqual(alliedBonusDetails(archer, state, config).find(({ source }) => source.id === veteran.id).bonuses, { damage: 3, range: 1, fortitude: 6 });
  assert.equal(unitStatParts(veteran, state, config).find(({ field }) => field === 'damage').personal, 9);
  assert.equal(unitStatParts(veteran, state, config).find(({ field }) => field === 'fortitude').personal, 9);
  assert.equal(effective(support, state, config).range, 1, 'the selected aura still arms support');
  delete config.shieldPromotion.allies;
  assert.deepEqual(alliedBonusDetails(archer, state, config).find(({ source }) => source.id === veteran.id).bonuses, { damage: 9, range: 2, fortitude: 9 }, 'old saves report their actual flat aura');
});
