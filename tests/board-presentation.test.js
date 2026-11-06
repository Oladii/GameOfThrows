import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, inspectCell, resolve, isLethalDamage } from '../dist/engine.js';
import { durabilityDisplay, attackCellsFor, unitStatParts } from '../dist/board-presentation.js';
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
