import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PREVIOUS_FORMATION_CONFIG as DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, resolve, isLethalDamage, move, effective, key, movementPath, cells } from '../dist/engine.js';
import { renderTokenBody, renderTokenNumber } from '../dist/token-presentation.js';
import { hexGridPoint, hexGridPolygon, ATTACK_TEAM_COLORS, durabilityDisplay, renderUnitBadges, attackCellsFor, unitStatParts, alliedBonusDetails, unitAppearance, renderMovingToken, renderDeathEffects, attackMarkerRotation, skullShape, attackReachPresentation } from '../dist/board-presentation.js';
import { LABELS } from '../dist/rules.js';
const piece = (id, type, team, q, r) => ({id, type, team, q, r});
const position = pieces => ({pieces, turn:0, ply:0, winner:null});

test('durability displays full defense without threats, full defense under fire, and equality is lethal', () => {
  const c = structuredClone(REVISION_FOUR_CONFIG);
  assert.equal(c.stats.shield.fortitude, 4);
  const target = piece('target','shield',0,0,0), enemy = piece('enemy','archer',1,1,0);
  const s = position([target,enemy]);
  for (const [incoming, remaining, dead] of [[0,4,false],[2,2,false],[3,1,false],[4,0,true],[5,-1,true]]) {
    c.stats.archer.damage = incoming;
    const info = analyze(s,c).get('target'), view = durabilityDisplay(info);
    assert.equal(view.value,4); assert.equal(view.dead,dead);
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

test('right badge remains full while upper threats appear only for interaction or lethal danger', () => {
  for (const incoming of [0, 8, 14, 15, 21]) {
    const info = { damage: 12, fortitude: 15, incoming, dead: incoming >= 15 };
    for (const showIncoming of [false, true]) {
      const html = renderUnitBadges(info, { showIncoming });
      assert.match(html, /data-fortitude="15"/);
      assert.ok(html.includes('class="fort-text token-number" data-value="15"'));
      assert.equal(html.includes('incoming-indicator'), info.dead || incoming > 0);
      assert.equal(html.includes('under-fire-target'), incoming > 0 && !info.dead && !showIncoming);
      assert.ok(html.includes(`data-attack="${info.damage}"`));
      assert.equal(html.includes('fatal-mark'), info.dead);
      if (!info.dead && showIncoming && incoming > 0) assert.ok(html.includes(`data-value="−${incoming}"`));
      assert.ok(!html.includes('survival-indicator under-fire')); 
    }
  }
});

test('friendly target colors follow the viewing side; enemy markers retain their native team class', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  for (const team of [0, 1]) for (const friendlyTeam of [0, 1]) {
    const source = piece('s', 'archer', team, 0, 0), state = position([source]);
    const html = attackReachPresentation(source, state, config, { point: c => ({ x: c.q, y: c.r }), polygonPoints: '', friendlyTeam }).markup;
    assert.ok(html.includes(`attack-target-weapon ${team ? 'south' : 'north'}`));
    assert.equal(html.includes('friendly-target'), team === friendlyTeam);
  }
});
test('all unit types and veterans use swords, including zero damage', () => {
  const info={damage:0,fortitude:3,incoming:0,dead:false};
  for(const [pieceType,veteran] of [['shield',false],['archer',false],['shield',true],['attackLamp',false],['defenseLamp',false],['scoutLamp',false]]) {
    const html=renderUnitBadges(info,{pieceType,veteran});
    assert.ok(html.includes('data-artwork="melee"'));
    assert.ok(!html.includes('data-artwork="ranged"')&&!html.includes('data-artwork="veteran"'));
    assert.ok(html.includes('data-attack="0"'));
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
  assert.equal(unitAppearance(veteran, config, icons).icon, icons.shield);
  promoted.turn = 0;
  const retreated = move(promoted, config, source.id, { q: 0, r: 2 }).state.pieces.find(p => p.id === source.id);
  assert.equal(unitAppearance(retreated, config, icons).veteran, true);
  for (const team of [0, 1]) assert.equal(unitAppearance({ ...source, team, r: team ? -3 : 3 }, config, icons).veteran, true, 'legacy saves on the far edge look promoted too');
  assert.equal(unitAppearance({ ...source, type: 'archer', reachedFarEdge: true }, config, icons).veteran, false);
  const moving = renderMovingToken(retreated, { x: 10, y: 20, progress: .5 }, icons, 'test-token', config);
  const dying = renderDeathEffects([retreated], () => ({ x: 0, y: 0 }), '', icons, config);
  assert.ok(moving.includes('moving-token veteran')); assert.ok(moving.includes('data-artwork="wreath"'));
  assert.ok(dying.includes('death-ghost veteran')); assert.ok(dying.includes('data-artwork="wreath"'));
  assert.ok(moving.includes('data-artwork="type-shield"'));
});

const appSource = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
test('all terrain paints before tokens, with clickable accessible cells under the foreground', () => {
  const config = structuredClone(DEFAULT_CONFIG), state = position([piece('s','shield',0,0,0),piece('a','archer',1,0,1)]);
  const svg = { contains: () => false, setAttribute() {}, innerHTML: '' }, legend = {};
  const context = vm.createContext({ config, visibleState:()=>state, cells, key, available:[], selected:null, boardFocus:null, fieldView:'', report:analyze(state,config),
    hexGridPoint, hexGridPolygon, ATTACK_TEAM_COLORS, ICON_PATHS:{}, unitAppearance, TEAM_NAMES:['Север','Юг'], LABELS, shieldCanRetreat:()=>false, archerHasEdgeBonus:()=>false, unitBadges:renderUnitBadges, renderTokenBody,
    combat:null,movement:null,currentDeaths:[],renderDeathEffects,hintTrace:()=>'',lastMoveTrace:()=>'',movingTokenMarkup:()=>'',editor:false,document:{activeElement:null},$:selector=>selector==='#board'?svg:legend });
  for (const name of ['point','polygon']) vm.runInContext(appSource.split('\n').find(line=>line.startsWith(`function ${name}(`)),context);
  vm.runInContext(appSource.slice(appSource.indexOf('function boardMarkup('),appSource.indexOf('function paintAuras(')),context);
  context.boardMarkup();
  const html=svg.innerHTML;
  assert.ok(html.lastIndexOf('class="tile"') < html.indexOf('data-piece-id='));
  assert.ok(html.indexOf('id="aura-circles"') < html.indexOf('id="board-pieces"'));
  assert.equal((html.match(/data-piece-id=/g)||[]).length,state.pieces.length);
  assert.equal((html.match(/role="button"/g)||[]).length,cells(config).length);
  assert.match(html,/id="board-pieces" pointer-events="none"/);
  assert.match(html,/aria-describedby="cell-stats-0,0"/);
  assert.match(html,/Броня: /);
});
test('Belwe numerals keep their size for one and two digits, with a smaller incoming value', () => {
  const a=renderTokenNumber(8,0,0,'attack'), b=renderTokenNumber(88,0,0,'fort');
  for(const html of [a,b]) {
    assert.match(html,/data-font-size="80"/);
    assert.match(html,/data-font="Belwe Bd BT Bold"/);
    assert.match(html,/data-letter-spacing="-15%"/);
    assert.match(html,/fill="#fff" stroke="#000"/);
    assert.match(html,/stroke-width="10"/,'the outside outline is 5px at the design scale');
  }
  const incoming=renderTokenNumber('−12',0,0,'incoming');
  assert.match(incoming,/data-font-size="68"/);
  assert.match(incoming,/stroke-width="10"/);
  assert.match(incoming,/class="token-minus"[^>]+width="18" height="4.5"/);
  assert.ok(Math.abs(Number(incoming.match(/font-size="68" letter-spacing="([^"]+)"/)[1])+10.2)<1e-10);
  assert.ok(!incoming.includes('>−12</text>'),'the minus is short artwork, not a long font glyph');
});
test('visible numeral ink and signed damage stay centred in their badge containers', () => {
  const references=JSON.parse(fs.readFileSync(new URL('./fixtures/belwe-ink-bounds.json',import.meta.url),'utf8')).samples;
  for(const [key,bounds] of Object.entries(references)){
    const [size,value]=key.split(':'),kind=size==='68'?'incoming':'attack';
    for(const signed of [false,...(kind==='incoming'?[true]:[])]){
      const html=renderTokenNumber((signed?'−':'')+value,0,0,kind);
      const attrs=html.match(/<text class="token-digit-text" x="([^"]+)" y="([^"]+)"/);
      const x=+attrs[1],y=+attrs[2];let left=x+bounds[0],right=x+bounds[2];
      assert.match(html,/text-anchor="start"/,'a negative trailing letter space must not change the anchor');
      if(signed){const barX=+html.match(/class="token-minus" x="([^"]+)"/)[1];left=Math.min(left,barX);right=Math.max(right,barX+18);}
      assert.ok(Math.abs((left+right)/2)<1e-8,key+' horizontal centre');
      assert.ok(Math.abs(y+(bounds[1]+bounds[3])/2)<1e-8,key+' vertical centre');
    }
  }
  const html=renderUnitBadges({damage:12,fortitude:10,incoming:2,dead:false},{showIncoming:true});
  const positions=[...html.matchAll(/class="(attack|fort|incoming)-text token-number"[^>]+transform="translate\(([^,]+),([^\)]+)\)/g)];
  assert.equal(positions.length,3);
  const expected={attack:[-50*64/240,(128+47.83984375-120)*64/240],fort:[50*64/240,(128+47.83984375-120)*64/240],incoming:[0,(-1+44.4638671875-120)*64/240]};
  for(const p of positions)for(const [i,coordinate] of [+p[2],+p[3]].entries())assert.ok(Math.abs(coordinate-expected[p[1]][i])<1e-8);
});
test('the moving token keeps the destination threat before simultaneous deaths are removed', () => {
  const config = structuredClone(DEFAULT_CONFIG), source = piece('s','archer',0,0,0);
  const before = { config, state: position([source,piece('e','archer',1,1,1)]) };
  const action = { id: 's', to: { q: 0, r: 1 } }, outcome = move(before.state,config,source.id,action.to);
  assert.equal(analyze(before.state,config).get('s').incoming, 0);
  assert.equal(outcome.report.get('s').dead, true);
  const context = vm.createContext({ config, movement: null, inspectCell, movementPath, renderMovingToken,
    ICON_PATHS: {}, point: c => ({ x: c.q, y: c.r }), createMovementPlan: points => ({ points }),
    cancelMovement() {}, matchMedia: () => ({ matches: false }), render() {},
    sampleMovement: () => ({ x: 0, y: 0, progress: .2 }), moveAnimator: { active: false, start() {} } });
  vm.runInContext(appSource.slice(appSource.indexOf('function presentMove('),appSource.indexOf('function lastTurnFromHistory(')),context);
  vm.runInContext(appSource.slice(appSource.indexOf('function movingTokenMarkup('),appSource.indexOf('function inspectionContext(')),context);
  context.presentMove(before, action, outcome.deaths);
  assert.equal(context.movement.forecast.report.get('s').incoming, outcome.report.get('s').incoming);
  const html = context.movingTokenMarkup();
  assert.match(html, /data-fortitude="6"/);
  assert.match(html, /incoming-indicator lethal/);
});
function reachPainter(config, state, selected) {
  let writes = 0, html = ''; const layer = { get innerHTML() { return html; }, set innerHTML(value) { writes++; html = value; } };
  const context = vm.createContext({ hexGridPoint, hexGridPolygon, config, selected, playMode: 'local', humanTeam: 1, attackReachPresentation, attackCellsFor, effective, isLethalDamage, attackMarkerRotation, key, LABELS, skullShape,
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
    const state=position([source,ally,enemy]);state.turn=team;const painter=reachPainter(config,state,source.id);
    const html=painter.render({position:state,piece:source,isPreview:false});
    assert.ok(!html.includes('attack-target-outline'));
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
test('lethal enemies use the upper token badge instead of a skull over their weapon icon', () => {
  const config=structuredClone(DEFAULT_CONFIG),source=piece('s','archer',0,0,0),state=position([source,piece('e','archer',1,-1,0)]);
  const html=reachPainter(config,state,source.id).render({position:state,piece:source,isPreview:false});
  assert.ok(html.includes('attack-target-fill'));
  assert.ok(!html.includes('reach-skull'));
  const badge=renderUnitBadges(analyze(state,config).get('e'));
  assert.ok(badge.includes('incoming-indicator lethal'));
  assert.ok(badge.includes('token-art fatal-mark'));
  assert.ok(badge.includes('data-artwork="skull"'));
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
    for(const html of [renderMovingToken(archer,{x:0,y:0,progress:0},icons,'moving',config),renderDeathEffects([archer],()=>({x:0,y:0}),'',icons,config)]){
      assert.match(html,/data-artwork="type-archer"/);
      assert.equal(html.includes('rotate(180 0 '),team===1,'the approved down-facing bitmap rotates only for the South');
    }
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
