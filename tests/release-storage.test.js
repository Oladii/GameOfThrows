import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, PREVIOUS_UNCAPPED_CONFIG, BALANCE_REVISION, updateSavedBalance, upgradeSelectedBalancePreset } from '../dist/rules.js';
import { clone, cells, createGame, validateConfig, validateState } from '../dist/engine.js';
import { classifyPosition } from '../dist/start-position.js';
import { needsNewGame } from '../dist/new-game-refresh.js';
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const pendingHelper=app.slice(app.indexOf('function pendingSetupBalance('),app.indexOf("try {\n  const raw = localStorage.getItem(STORAGE);"));
const loadBlock=app.slice(app.indexOf("try {\n  const raw = localStorage.getItem(STORAGE);"),app.indexOf('\nfunction resetNewGameDefaults()'));
const resetDeclaration=app.slice(app.indexOf('function resetNewGameDefaults()'),app.indexOf('\n// Use the defaults of the newly loaded release'));
function setup(overrides={}){
  const config=clone(PREVIOUS_UNCAPPED_CONFIG),state=createGame(config);
  const snapshot={config,state,log:[],positionKind:'default',gameVersion:'0.1.36'};
  const saved={...snapshot,balanceRevision:16,presetRevision:1,startPrefsRevision:1,gamePhase:'setup',editor:false,history:[],lastTurn:null,...overrides};
  let checkpoints=0;
  const readSnapshot=value=>({...clone(value),config:validateConfig(value.config),state:validateState(value.state,value.config)});
  const context=vm.createContext({DEFAULT_CONFIG,PREVIOUS_LOCAL_CONFIG,BALANCE_REVISION,updateSavedBalance,upgradeSelectedBalancePreset,clone,validateConfig,createGame,classifyPosition,
    config:clone(DEFAULT_CONFIG),state:createGame(DEFAULT_CONFIG),history:[],log:[],lastTurn:null,previousGame:null,selected:null,
    STORAGE:'lamps-prototype-v1',CURRENT_GAME_VERSION:'0.1.37',PRESET_REVISION:1,START_PREFS_REVISION:1,
    firstMove:'south',playMode:'bot',humanTeam:1,botDifficulty:'easy',readBotDifficulty:value=>value||'easy',gameVersion:'0.1.37',gamePhase:'setup',positionKind:'default',editor:false,
    readSnapshot,readPreviousGame:value=>value?clone(value):null,readLastTurn:value=>clone(value??null),lastTurnFromHistory:()=>null,
    localStorage:{getItem:key=>key==='lamps-prototype-v1'?JSON.stringify(saved):null},checkpoint:()=>{checkpoints++;},toast:message=>{throw Error(message);},balanceUpdated:false,commanderUpdated:false});
  vm.runInContext(pendingHelper+loadBlock,context);
  return {context,saved,checkpoints:()=>checkpoints,reset:()=>vm.runInContext(resetDeclaration+'\nresetNewGameDefaults()',context)};
}

test('release37 selects existing production saves while localhost and standalone keep the local profile',()=>{
  const declaration=app.match(/^const archiveIsSite = .*;$/m)[0]+'\n'+app.match(/^const STORAGE = .*;$/m)[0]+'\nSTORAGE';
  for(const [origin,pathname,expected]of [['https://oladii.github.io','/GameOfThrows/','lamps-prototype-v1'],['http://127.0.0.1:35810','/','lamps-local-playtest13-v1'],['null','/Lamps.html','lamps-local-playtest13-v1']])assert.equal(vm.runInNewContext(declaration,{location:{origin,pathname}}),expected);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version,'0.1.37');
});

test('a fully known production revision16 standard pending setup upgrades to current13',()=>{
  const ui=setup();assert.deepEqual(plain(ui.context.config),DEFAULT_CONFIG);assert.deepEqual(plain(ui.context.state),createGame(DEFAULT_CONFIG));
  assert.equal(ui.context.state.pieces.length,26);assert.equal(ui.checkpoints(),1);assert.equal(ui.context.gameVersion,'0.1.37');
});

test('production revision16 active games, editors, custom settings and custom positions are preserved',()=>{
  const old=clone(PREVIOUS_UNCAPPED_CONFIG),custom=clone(old);custom.stats.shield.damage=7;
  const customState=createGame(old),occupied=new Set(customState.pieces.map(p=>`${p.q},${p.r}`));Object.assign(customState.pieces[0],cells(old).find(p=>!occupied.has(`${p.q},${p.r}`)));
  for(const overrides of [{gamePhase:'playing'},{editor:true},{config:custom},{positionKind:'custom',state:customState},{positionKind:'default',state:customState}]){
    const before={config:overrides.config||old,state:overrides.state||createGame(old),history:[{config:old,state:createGame(old),log:[],positionKind:'default',gameVersion:'0.1.36'}],lastTurn:{saved:true}};
    const ui=setup({...before,...overrides});
    assert.deepEqual(plain(ui.context.config),before.config);assert.deepEqual(plain(ui.context.state),plain(before.state));assert.deepEqual(plain(ui.context.history),plain(before.history));assert.deepEqual(plain(ui.context.lastTurn),before.lastTurn);assert.equal(ui.checkpoints(),0);
    assert.equal(ui.context.gameVersion,'0.1.36');
    ui.reset();assert.deepEqual(plain(ui.context.config),DEFAULT_CONFIG);assert.deepEqual(plain(ui.context.state),createGame(DEFAULT_CONFIG));assert.equal(ui.context.state.pieces.length,26);assert.equal(ui.context.gameVersion,'0.1.37');
  }
  assert.equal(needsNewGame({phase:'playing',savedVersion:'0.1.36',currentVersion:'0.1.37',latestVersion:null}),true);
});
