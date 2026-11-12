import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, PREVIOUS_UNCAPPED_CONFIG, BALANCE_REVISION, updateSavedBalance, upgradeSelectedBalancePreset } from '../dist/rules.js';
import { clone, cells, createGame, validateConfig, validateState } from '../dist/engine.js';
import { classifyPosition, prepareStartPosition } from '../dist/start-position.js';
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
    STORAGE:'lamps-prototype-v1',CURRENT_GAME_VERSION:'0.1.39',PRESET_REVISION:1,START_PREFS_REVISION:2,
    firstMove:'random',playMode:'bot',humanTeam:1,botDifficulty:'easy',readBotDifficulty:value=>value||'easy',gameVersion:'0.1.39',gamePhase:'setup',positionKind:'default',editor:false,
    readSnapshot,readPreviousGame:value=>value?clone(value):null,readLastTurn:value=>clone(value??null),lastTurnFromHistory:()=>null,
    localStorage:{getItem:key=>key==='lamps-prototype-v1'?JSON.stringify(saved):null},checkpoint:()=>{checkpoints++;},toast:message=>{throw Error(message);},balanceUpdated:false,commanderUpdated:false});
  vm.runInContext(pendingHelper+loadBlock,context);
  return {context,saved,checkpoints:()=>checkpoints,reset:()=>vm.runInContext(resetDeclaration+'\nresetNewGameDefaults()',context)};
}

test('release39 selects existing production saves while localhost and standalone keep the local profile',()=>{
  const declaration=app.match(/^const archiveIsSite = .*;$/m)[0]+'\n'+app.match(/^const STORAGE = .*;$/m)[0]+'\nSTORAGE';
  for(const [origin,pathname,expected]of [['https://oladii.github.io','/GameOfThrows/','lamps-prototype-v1'],['http://127.0.0.1:35810','/','lamps-local-playtest13-v1'],['null','/Lamps.html','lamps-local-playtest13-v1']])assert.equal(vm.runInNewContext(declaration,{location:{origin,pathname}}),expected);
  assert.equal(JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version,'0.1.39');
});

test('a fully known production revision16 standard pending setup upgrades to current13',()=>{
  const ui=setup();assert.deepEqual(plain(ui.context.config),DEFAULT_CONFIG);assert.deepEqual(plain(ui.context.state),createGame(DEFAULT_CONFIG));
  assert.equal(ui.context.state.pieces.length,26);assert.equal(ui.checkpoints(),1);assert.equal(ui.context.gameVersion,'0.1.39');
});

test('production revision16 active games, editors, custom settings and custom positions are preserved',()=>{
  const old=clone(PREVIOUS_UNCAPPED_CONFIG),custom=clone(old);custom.stats.shield.damage=7;
  const customState=createGame(old),occupied=new Set(customState.pieces.map(p=>`${p.q},${p.r}`));Object.assign(customState.pieces[0],cells(old).find(p=>!occupied.has(`${p.q},${p.r}`)));
  for(const overrides of [{gamePhase:'playing'},{editor:true},{config:custom},{positionKind:'custom',state:customState},{positionKind:'default',state:customState}]){
    const before={config:overrides.config||old,state:overrides.state||createGame(old),history:[{config:old,state:createGame(old),log:[],positionKind:'default',gameVersion:'0.1.36'}],lastTurn:{saved:true}};
    const ui=setup({...before,...overrides});
    assert.deepEqual(plain(ui.context.config),before.config);assert.deepEqual(plain(ui.context.state),plain(before.state));assert.deepEqual(plain(ui.context.history),plain(before.history));assert.deepEqual(plain(ui.context.lastTurn),before.lastTurn);assert.equal(ui.checkpoints(),0);
    assert.equal(ui.context.gameVersion,'0.1.36');
    ui.reset();assert.deepEqual(plain(ui.context.config),DEFAULT_CONFIG);assert.deepEqual(plain(ui.context.state),createGame(DEFAULT_CONFIG));assert.equal(ui.context.state.pieces.length,26);assert.equal(ui.context.gameVersion,'0.1.39');
  }
  assert.equal(needsNewGame({phase:'playing',savedVersion:'0.1.36',currentVersion:'0.1.39',latestVersion:null}),true);
});

test('fresh preparation defaults to random, and revision1 setup changes only the first-move preference',()=>{
  const declaration=app.match(/^let firstMove = .*;$/m)[0];assert.equal(vm.runInNewContext(declaration+'\nfirstMove'),'random');
  assert.match(app,/const START_PREFS_REVISION = 2;/);
  const config=clone(DEFAULT_CONFIG),state=createGame(config),history=[{config,state,log:[],positionKind:'custom',gameVersion:'0.1.37'}],lastTurn={saved:true};
  const ui=setup({config,state,history,lastTurn,balanceRevision:21,startPrefsRevision:1,gamePhase:'setup',editor:true,positionKind:'custom',playMode:'local',humanTeam:0,firstMove:'south',botDifficulty:'hard'});
  assert.equal(ui.context.firstMove,'random');assert.equal(ui.context.playMode,'local');assert.equal(ui.context.humanTeam,0);assert.equal(ui.context.botDifficulty,'hard');assert.equal(ui.context.editor,true);
  assert.deepEqual(plain(ui.context.config),config);assert.deepEqual(plain(ui.context.state),state);assert.deepEqual(plain(ui.context.history),plain(history));assert.deepEqual(plain(ui.context.lastTurn),lastTurn);assert.equal(ui.checkpoints(),0);
});

test('active games keep their selected first move and turn; current-revision explicit choices survive reload',()=>{
  const config=clone(DEFAULT_CONFIG),state=createGame(config);state.turn=1;
  const playing=setup({config,state,balanceRevision:21,startPrefsRevision:1,gamePhase:'playing',firstMove:'south',playMode:'local',humanTeam:0});
  assert.equal(playing.context.firstMove,'south');assert.equal(playing.context.state.turn,1);assert.deepEqual(plain(playing.context.state),state);assert.equal(playing.context.playMode,'local');assert.equal(playing.context.humanTeam,0);
  for(const firstMove of ['north','south','random'])for(const startPrefsRevision of [2,3]){
    const ui=setup({config,state,balanceRevision:21,startPrefsRevision,editor:true,firstMove});assert.equal(ui.context.firstMove,firstMove);assert.deepEqual(plain(ui.context.state),state);
  }
  const legacy=setup({config,state,balanceRevision:21,startPrefsRevision:undefined,editor:true,firstMove:'north',playMode:'local',humanTeam:0});
  assert.equal(legacy.context.firstMove,'random');assert.equal(legacy.context.playMode,'bot');assert.equal(legacy.context.humanTeam,1);
});

test('starting a random game rolls exactly once and fixes that turn for the running game',()=>{
  const startingTeam=app.split('\n').find(line=>line.startsWith('function startingTeam('));
  const startGame=app.slice(app.indexOf('function startGame()'),app.indexOf("\n$('#start-setup').addEventListener"));
  for(const [roll,expected]of [[0.1,0],[0.9,1]]){
    let rolls=0,starts=0;
    const context=vm.createContext({config:clone(DEFAULT_CONFIG),state:createGame(DEFAULT_CONFIG),firstMove:'random',gamePhase:'setup',editor:false,refreshingNewGame:false,history:[],log:[],previousGame:null,selected:null,
      Math:{random:()=>{rolls++;return roll;},floor:Math.floor},prepareStartPosition,resetBotContext(){},classifyPosition,CURRENT_GAME_VERSION:'0.1.39',gameVersion:'0.1.37',archiveGameMetadata:()=>({}),archiveRecorder:{start(){starts++;}},$:()=>({close(){}}),render(){},toast:message=>{throw Error(message);}});
    vm.runInContext(startingTeam+'\n'+startGame+'\nstartGame();startGame();',context);
    assert.equal(rolls,1);assert.equal(starts,1);assert.equal(context.state.turn,expected);assert.equal(context.gamePhase,'playing');
  }
});


test('revision21 commander range migration preserves a running turn, position, history and choices',()=>{
  const config=clone(DEFAULT_CONFIG);config.stats.scoutLamp.range=1;
  const state=createGame(config);state.ply=18;state.turn=1;
  const history=[{config:clone(config),state:clone(state),log:[],positionKind:'custom',gameVersion:'0.1.38'}],lastTurn={saved:true};
  const ui=setup({config,state,history,lastTurn,balanceRevision:21,startPrefsRevision:2,gamePhase:'playing',positionKind:'custom',firstMove:'north',playMode:'local',humanTeam:0});
  const expected=clone(config);expected.stats.scoutLamp.range=2;
  assert.deepEqual(plain(ui.context.config),expected);assert.deepEqual(plain(ui.context.state),state);assert.deepEqual(plain(ui.context.history),history);assert.deepEqual(plain(ui.context.lastTurn),lastTurn);assert.equal(ui.context.state.turn,1);assert.equal(ui.context.firstMove,'north');assert.equal(ui.context.playMode,'local');assert.equal(ui.checkpoints(),0);
  for(const [damage,range] of [[2,1],[3,4]]){const custom=clone(config);Object.assign(custom.stats.scoutLamp,{damage,range});const saved=setup({config:custom,state,balanceRevision:21,startPrefsRevision:2,gamePhase:'playing'});assert.deepEqual(plain(saved.context.config),custom);assert.deepEqual(plain(saved.context.state),state);}
});
