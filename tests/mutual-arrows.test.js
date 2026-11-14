import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDamageArrows, damageArrowMarkers, hexGridPoint } from '../dist/board-presentation.js';
const a = {id:'a', team:0, q:0, r:0}, b = {id:'b', team:1, q:1, r:0};
const outgoing = {source:a,target:b,damage:3}, incoming = {source:b,target:a,damage:8};
const count = html => (html.match(/class="attack-ray"/g)||[]).length;
test('mutual attacks use one evenly split path with two arrowheads at every distance', () => {
  for (const r of [0, 3]) {
    const target = {...b, r};
    const html=renderDamageArrows([{...outgoing,target},{...incoming,source:target}],hexGridPoint);
    assert.equal(count(html),1);
    assert.match(html,/style="--attack-color:[^";]+;opacity:.9"/);
    assert.match(html,/style="stroke:none;opacity:1"/);
    assert.doesNotMatch(html,/class="damage-arrow-half"[^>]*opacity=/);
    const halves=[...html.matchAll(/class="damage-arrow-half" data-side="(\d)" d="([^"]+)" fill="([^"]+)"/g)];
    assert.equal(halves.length,2);
    assert.deepEqual(halves.map(m=>m[3]),['#4c9fc9','#ab3300']);
    assert.equal(halves[0][2].split('Z').length,halves[1][2].split('Z').length);
    // The first half of each polygon follows exactly the same dash centreline.
    const vertices = d => d.split('Z').filter(Boolean).map(d=>d.slice(1).split('L'));
    const left=vertices(halves[0][2]),right=vertices(halves[1][2]);
    for(let i=0;i<left.length;i++)assert.deepEqual(left[i].slice(0,left[i].length/2),right[i].slice(0,right[i].length/2));
    if(r===0) {
      const ys=halves.map(m=>vertices(m[2]).flat().map(p=>Number(p.split(',')[1])));
      assert.equal(Math.max(...ys[0]),1.25);assert.equal(Math.min(...ys[0]),0);
      assert.equal(Math.max(...ys[1]),0);assert.equal(Math.min(...ys[1]),-1.25);
    }
    assert.match(html,/marker-start="url\(#damage-arrow-north\)"/);
    assert.match(html,/marker-end="url\(#damage-arrow-south\)"/);
    assert.equal(html.includes('Q'),r!==0);
  }
  assert.match(damageArrowMarkers(),/id="damage-arrow-north"[^>]*orient="auto-start-reverse"/);
  assert.match(damageArrowMarkers('training-damage-arrow'),/id="training-damage-arrow-south"/);
});
test('one-way attacks keep their team color and do not invent the reverse attack', () => {
  for (const arrow of [outgoing,incoming]) {
    const html=renderDamageArrows([arrow],hexGridPoint);
    assert.equal(count(html),1);
    assert.doesNotMatch(html,/marker-start|mutual|#9770be/);
  }
});
test('the second head waits for the reciprocal reveal without moving the path', () => {
  const arrows=[incoming,outgoing], before=structuredClone(arrows);
  const first=renderDamageArrows(arrows,hexGridPoint,{visibleCount:1});
  const both=renderDamageArrows(arrows,hexGridPoint,{visibleCount:2});
  assert.equal(count(renderDamageArrows(arrows,hexGridPoint,{visibleCount:0})),0);
  assert.equal(count(first),1);assert.equal(count(both),1);
  assert.doesNotMatch(first,/marker-start|mutual|linearGradient/);
  assert.match(both,/class="damage-arrow-half" data-side="0"[^>]*fill="#ab3300"/);
  assert.match(both,/marker-start/);
  assert.equal(first.match(/class="damage-arrow-path" d="([^"]+)"/)[1],both.match(/class="damage-arrow-path" d="([^"]+)"/)[1]);
  assert.deepEqual(arrows,before);
});
