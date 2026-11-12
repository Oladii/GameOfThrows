import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { analyze, move, validateState } from '../dist/engine.js';
import { createShowcaseBattle, renderShowcaseBattle, SHOWCASE_MOVES, showcasePoint } from '../dist/onboarding-showcase.js';

test('the current-rule showcase is exactly three legal alternating moves ending in flag victory with enemy fighters alive',()=>{
  const initial=createShowcaseBattle();assert.deepEqual(initial.config.stats,DEFAULT_CONFIG.stats);assert.deepEqual(initial.config.shieldPromotion,DEFAULT_CONFIG.shieldPromotion);assert.equal(initial.config.victoryCondition,'flag-or-combat');assert.equal(initial.position.turn,1);assert.equal(initial.position.winner,null);assert.equal(initial.position.pieces.filter(p=>p.type==='defenseLamp').length,2);assert.deepEqual(validateState(initial.position,initial.config),initial.position);assert.equal(SHOWCASE_MOVES.length,3);
  for(let index=1;index<=SHOWCASE_MOVES.length;index++){
    const previous=createShowcaseBattle(index-1),current=createShowcaseBattle(index),entry=SHOWCASE_MOVES[index-1],native=move(previous.position,previous.config,entry.id,entry.to);
    assert.deepEqual(current.position,native.state);assert.deepEqual(current.deaths,native.deaths);assert.equal(current.action.team,index%2);assert.ok(current.path.length>1);assert.ok(current.comment.length>20);
    if(index<3)assert.equal(current.position.winner,null);
  }
  const final=createShowcaseBattle(3);assert.equal(final.position.winner,1);assert.deepEqual(final.deaths.map(p=>p.id),['n-flag']);assert.ok(final.position.pieces.some(p=>p.id==='n-shield'));assert.ok(final.position.pieces.some(p=>p.id==='n-bow'));assert.ok(final.position.pieces.some(p=>p.id==='s-bow'));assert.ok(final.position.pieces.some(p=>p.id==='s-flag'));assert.match(final.comment,/потеря флага/);
});

test('replaying and resetting return detached snapshots without cumulative damage or mutable cached configuration',()=>{
  const first=createShowcaseBattle(1),before=structuredClone(first.position);first.position.pieces.length=0;first.config.stats.scoutLamp.range=99;
  assert.deepEqual(createShowcaseBattle(1).position,before);assert.equal(createShowcaseBattle(1).config.stats.scoutLamp.range,DEFAULT_CONFIG.stats.scoutLamp.range);assert.deepEqual(createShowcaseBattle(2).before,createShowcaseBattle(1).position);assert.deepEqual(createShowcaseBattle(0).position,createShowcaseBattle(-1).position);assert.equal(createShowcaseBattle(999).index,3);
  for(let index=0;index<3;index++)assert.ok([...analyze(createShowcaseBattle(index).position,createShowcaseBattle(index).config).values()].every(info=>!info.dead));
});

test('the viewer shows only manual arrows, the actual actor and correct endpoint controls',()=>{
  const initial=renderShowcaseBattle(0,{}),middle=renderShowcaseBattle(2,{}),final=renderShowcaseBattle(3,{});
  assert.equal((initial.match(/data-showcase-action=/g)||[]).length,2);assert.match(initial,/data-showcase-action="prev"[^>]* disabled/);assert.match(final,/data-showcase-action="next"[^>]* disabled/);
  assert.doesNotMatch(initial,/data-lesson-unit=|data-lesson-cell=/);assert.equal((initial.match(/class="showcase-comment /g)||[]).length,1);assert.match(initial,/<strong>Юг<\/strong>/);assert.match(middle,/<strong>Север<\/strong>/);assert.match(final,/Юг победил/);assert.doesNotMatch(final,/data-showcase-piece="n-flag"/);assert.match(final,/data-showcase-piece="n-shield"/);
  assert.ok(showcasePoint({q:0,r:-2}).y<showcasePoint({q:0,r:2}).y);
});
