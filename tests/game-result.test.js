import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { winnerForPieces } from '../dist/engine.js';

const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function setup(victoryCondition = 'all-units') {
  const nodes={'#move-counter':{textContent:''},'#play-again':{hidden:true}};
  const context=vm.createContext({config:{victoryCondition},gamePhase:'playing',editor:false,movement:null,combat:null,currentDeaths:[],reviewingTurn:false,$:s=>nodes[s]});
  vm.runInContext(app.slice(app.indexOf('function renderGameResult('),app.indexOf('function render(deaths')),context);
  return {context,nodes,render:(winner,pieces=[])=>context.renderGameResult({ply:65,winner,pieces})};
}
test('victory is written beside the turn counter and the rematch button appears below the field',()=>{
  const ui=setup();
  for(const [winner,label] of [[0,'Ход 66. Победа Севера'],[1,'Ход 66. Победа Юга'],['draw','Ход 66. Ничья']]) {
    ui.render(winner);assert.equal(ui.nodes['#move-counter'].textContent,label);assert.equal(ui.nodes['#play-again'].hidden,false);
  }
  ui.render(null);assert.equal(ui.nodes['#move-counter'].textContent,'Ход 66');assert.equal(ui.nodes['#play-again'].hidden,true);
});
test('the result and rematch remain hidden through movement, combat, removal, setup and history review',()=>{
  for(const [field,value] of [['movement',{}],['combat',{phase:'attacks'}],['combat',{phase:'deaths'}],['currentDeaths',[{}]],['gamePhase','setup'],['reviewingTurn',true]]) {
    const ui=setup();ui.context[field]=value;ui.render(0);
    assert.ok(!ui.nodes['#move-counter'].textContent.includes('Победа'));
    assert.equal(ui.nodes['#play-again'].hidden,true);
  }
});


test('flag victories name the destroyed opposing flag for either winning team',()=>{
  for(const [winner,label] of [[0,'Севера'],[1,'Юга']]) {
    const ui=setup('flag-or-combat');
    ui.render(winner,[{type:'defenseLamp',team:winner}]);
    assert.equal(ui.nodes['#move-counter'].textContent,`Ход 66. Победа ${label}. Флаг противника уничтожен`);
    assert.equal(ui.nodes['#play-again'].hidden,false);
  }
});

test('surviving combat units and legacy rules retain concise results',()=>{
  for(const winner of [0,1]) {
    const ui=setup('flag-or-combat');
    ui.render(winner,[{type:'defenseLamp',team:1-winner},{type:'archer',team:1-winner}]);
    assert.equal(ui.nodes['#move-counter'].textContent,`Ход 66. Победа ${winner===0?'Севера':'Юга'}`);
    for(const condition of ['combat-units','all-units',undefined]) {
      ui.context.config.victoryCondition=condition;ui.render(winner,[]);
      assert.ok(!ui.nodes['#move-counter'].textContent.includes('Флаг противника уничтожен'));
    }
  }
  const draw=setup('flag-or-combat');draw.render('draw',[]);
  assert.equal(draw.nodes['#move-counter'].textContent,'Ход 66. Ничья. Флаги обеих сторон уничтожены');
});

test('a missing flag never reveals the reason before the final result is visible',()=>{
  for(const [field,value] of [['movement',{}],['combat',{phase:'attacks'}],['combat',{phase:'deaths'}],['currentDeaths',[{}]],['gamePhase','setup'],['reviewingTurn',true]]) {
    const ui=setup('flag-or-combat');ui.context[field]=value;ui.render(0,[]);
    assert.ok(!ui.nodes['#move-counter'].textContent.includes('Флаг противника уничтожен'));
    assert.equal(ui.nodes['#play-again'].hidden,true);
  }
  const active=setup('flag-or-combat');active.render(null,[]);
  assert.equal(active.nodes['#move-counter'].textContent,'Ход 66');
});


const army = (team, types) => types.map((type, i) => ({ id: `${team}-${i}`, team, type }));
function checkEnding(condition, north, south, winner, reason) {
  const pieces = [...army(0, north), ...army(1, south)];
  const result = winnerForPieces(pieces, { victoryCondition: condition });
  assert.equal(result, winner, 'fixture outcome comes from the current engine');
  const ui = setup(condition);
  ui.render(result, pieces);
  const label = winner === 'draw' ? 'Ничья' : `Победа ${winner === 0 ? 'Севера' : 'Юга'}`;
  assert.equal(ui.nodes['#move-counter'].textContent, `Ход 66. ${label}. ${reason}`);
  assert.equal(ui.nodes['#play-again'].hidden, false);
}
const aliveArmy = ['defenseLamp', 'shield'];
test('either winner explains an opposing lone flag, without treating it as destroyed', () => {
  checkEnding('flag-or-combat', aliveArmy, ['defenseLamp'], 0, 'У противника остался только флаг');
  checkEnding('flag-or-combat', ['defenseLamp'], aliveArmy, 1, 'У противника остался только флаг');
  checkEnding('flag-or-combat', ['defenseLamp'], ['defenseLamp'], 'draw', 'У обеих сторон остались только флаги');
});
test('support and an armed commander do not count as surviving shield or archer units', () => {
  const support = ['defenseLamp', 'scoutLamp', 'horn'];
  checkEnding('flag-or-combat', aliveArmy, support, 0, 'У противника не осталось броненосцев и лукарей');
  checkEnding('flag-or-combat', support, aliveArmy, 1, 'У противника не осталось броненосцев и лукарей');
  checkEnding('flag-or-combat', support, support, 'draw', 'У обеих сторон не осталось броненосцев и лукарей');
});
test('destroyed flags take priority, and mixed draws identify both sides correctly', () => {
  checkEnding('flag-or-combat', aliveArmy, ['horn'], 0, 'Флаг противника уничтожен');
  checkEnding('flag-or-combat', ['archer'], ['shield'], 'draw', 'Флаги обеих сторон уничтожены');
  checkEnding('flag-or-combat', ['archer'], ['defenseLamp'], 'draw', 'Флаг Севера уничтожен. У Юга остался только флаг');
  checkEnding('flag-or-combat', ['defenseLamp', 'horn'], ['shield'], 'draw', 'У Севера не осталось броненосцев и лукарей. Флаг Юга уничтожен');
  checkEnding('flag-or-combat', ['defenseLamp'], ['defenseLamp', 'horn'], 'draw', 'У Севера остался только флаг. У Юга не осталось броненосцев и лукарей');
});
test('combat-only rules explain lost combat units regardless of flags', () => {
  checkEnding('combat-units', ['shield'], ['defenseLamp'], 0, 'У противника не осталось броненосцев и лукарей');
  checkEnding('combat-units', ['scoutLamp'], ['archer'], 1, 'У противника не осталось броненосцев и лукарей');
  checkEnding('combat-units', ['horn'], ['scoutLamp'], 'draw', 'У обеих сторон не осталось броненосцев и лукарей');
});
test('only-flag reasons stay hidden in every transient state and during active games', () => {
  for (const [field, value] of [['movement', {}], ['combat', { phase: 'attacks' }], ['currentDeaths', [{}]], ['gamePhase', 'setup'], ['reviewingTurn', true]]) {
    const ui = setup('flag-or-combat'); ui.context[field] = value;
    ui.render('draw', [...army(0, ['defenseLamp']), ...army(1, ['defenseLamp'])]);
    assert.doesNotMatch(ui.nodes['#move-counter'].textContent, /Ничья|флаг|броненосцев/);
    assert.equal(ui.nodes['#play-again'].hidden, true);
  }
  const ui = setup('flag-or-combat'); ui.render(null, [...army(0, ['defenseLamp']), ...army(1, ['defenseLamp'])]);
  assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 66');
});
