import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, resolve, isLethalDamage, move, effective, key } from '../dist/engine.js';
import { durabilityDisplay, attackCellsFor, unitStatParts, unitAppearance, VETERAN_SHIELD_ICON, renderMovingToken, renderDeathEffects, attackMarkerRotation, skullShape } from '../dist/board-presentation.js';
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
  const source = piece('blue', 'shield', 0, 0, 1), enemy = piece('enemy', 'shield', 1, -3, 0);
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
  const layer = { innerHTML: '' };
  const context = vm.createContext({ config, selected, attackCellsFor, effective, isLethalDamage, attackMarkerRotation, key, LABELS, skullShape,
    visibleState: () => state, $: () => layer, document: { querySelectorAll: () => [] } });
  vm.runInContext(appSource.split('\n').find(line => line.startsWith('function point(')), context);
  vm.runInContext(appSource.split('\n').find(line => line.startsWith('function polygon(')), context);
  vm.runInContext(appSource.slice(appSource.indexOf('const REACH_ICONS ='), appSource.indexOf('const auraPatterns =')), context);
  vm.runInContext(appSource.slice(appSource.indexOf('function paintAttackReach('), appSource.indexOf('function renderInspector(')), context);
  return { context, render(input) { context.paintAttackReach(input); return layer.innerHTML; } };
}

test('the actual reach painter turns arrows and swords outward along every hex and square attack ray, including previews', () => {
  for (const geometry of ['hex', 'square']) for (const type of ['archer', 'shield']) for (const team of [0, 1]) {
    const config = structuredClone(DEFAULT_CONFIG); config.geometry = geometry; config.size = 7; config.experiments.squareDiagonals = true;
    const source = piece('selected', type, team, geometry === 'hex' ? 0 : 3, geometry === 'hex' ? 0 : 3), state = position([source]); state.turn = team;
    const painter = reachPainter(config, state, source.id);
    const preview = inspectCell(state, config, { q: source.q + 1, r: source.r }, source.id);
    assert.equal(preview.isPreview, true);
    for (const input of [{ position: state, piece: source, isPreview: false }, preview]) {
      const from = painter.context.point(input.piece), html = painter.render(input);
      const markers = html.split(/(?=<g class="attack-reach )/).filter(part => part.startsWith('<g class="attack-reach '));
      assert.ok(markers.length >= (geometry === 'hex' ? 6 : 8));
      for (const marker of markers) {
        const coords = marker.match(/data-reach-cell="(-?\d+),(-?\d+)"/), to = painter.context.point({ q: Number(coords[1]), r: Number(coords[2]) });
        const rotation = Number(marker.match(/class="reach-icon" transform="rotate\(([^)]+)\)"/)[1]) * Math.PI / 180;
        // Rotate the weapon's original (1,-1) shaft vector and compare it with the real source-to-cell ray.
        const x = (Math.cos(rotation) + Math.sin(rotation)) / Math.SQRT2, y = (Math.sin(rotation) - Math.cos(rotation)) / Math.SQRT2;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        assert.ok(Math.abs(x - (to.x - from.x) / length) < 1e-9);
        assert.ok(Math.abs(y - (to.y - from.y) / length) < 1e-9);
        assert.ok(marker.includes(`data-attack-kind="${type === 'archer' ? 'arrow' : 'sword'}"`));
      }
    }
  }
});

test('lethal attack skulls stay upright when weapon direction changes', () => {
  const config = structuredClone(DEFAULT_CONFIG), source = piece('selected', 'shield', 0, 0, 0), state = position([source, piece('target', 'archer', 1, -1, 0)]);
  const painter = reachPainter(config, state, source.id), html = painter.render({ position: state, piece: source, isPreview: false });
  const lethal = html.split(/(?=<g class="attack-reach )/).find(marker => marker.includes('data-reach-cell="-1,0"'));
  assert.ok(lethal.includes('data-attack-kind="skull"')); assert.ok(lethal.includes('class="reach-skull"'));
  assert.ok(!lethal.includes('rotate('));
});
