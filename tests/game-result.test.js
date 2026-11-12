import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

test('the flag reason is absent for surviving opposing flags, other victory rules and draws',()=>{
  for(const winner of [0,1]) {
    const ui=setup('flag-or-combat');
    ui.render(winner,[{type:'defenseLamp',team:1-winner}]);
    assert.equal(ui.nodes['#move-counter'].textContent,`Ход 66. Победа ${winner===0?'Севера':'Юга'}`);
    for(const condition of ['combat-units','all-units',undefined]) {
      ui.context.config.victoryCondition=condition;ui.render(winner,[]);
      assert.ok(!ui.nodes['#move-counter'].textContent.includes('Флаг противника уничтожен'));
    }
  }
  const draw=setup('flag-or-combat');draw.render('draw',[]);
  assert.equal(draw.nodes['#move-counter'].textContent,'Ход 66. Ничья');
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
