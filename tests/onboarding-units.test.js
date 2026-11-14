import test from 'node:test';
import assert from 'node:assert/strict';
import { renderUnitExamples, badgeExamples } from '../dist/onboarding-units.js';

test('badge examples retain full fortitude and separate incoming damage',()=>{
  const [safe,hit,detailed,lethal]=badgeExamples();
  assert.deepEqual([safe.info.damage,safe.info.fortitude,safe.info.incoming],[5,5,0]);
  assert.deepEqual([hit.info.fortitude,hit.info.incoming,hit.info.dead],[5,2,false]);
  assert.deepEqual(detailed.info,hit.info);assert.equal(hit.showIncoming,false);assert.equal(detailed.showIncoming,true);
  assert.deepEqual([lethal.info.incoming,lethal.info.dead],[7,true]);
});

test('Figures renders the seven requested demos in order without the old unit examples',()=>{
  const html=renderUnitExamples();
  assert.deepEqual([...html.matchAll(/data-showcase-battle="([^"]+)"/g)].map(m=>m[1]),['unit-shield','unit-shield-defense','unit-shield-formation','unit-drum-shield','unit-archer','unit-archer-veteran','unit-flag-defense']);
  const titles=['Щитоносец — ветеран','Щитоносец — защитник','Строй — сила','Барабан и щитоносец','Лукарь, горн и командир','Лукарь — ветеран','Знамя — не обуза'];
  let previous=-1;for(const title of titles){const index=html.indexOf(`>${title}</h3>`);assert.ok(index>previous);previous=index;}
  assert.doesNotMatch(html,/data-lesson-scene=|unit-horn|unit-scoutLamp|unit-defenseLamp|unit-attackLamp/);
  assert.match(html,/Справа — полная стойкость/);
});
