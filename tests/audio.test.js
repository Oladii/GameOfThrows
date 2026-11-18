import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { GameAudio, GAME_MASTER_GAIN, GAME_SOUND_PROFILES, movementSoundKind } from '../dist/audio.js';
import { GAME_AUDIO_ASSETS } from '../dist/audio-assets.js';
import { movementPath, createGame, clone } from '../dist/engine.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { ShowcaseBattle, TRAINING_ACTIONS } from '../dist/onboarding-showcase.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const route = [{q:0,r:0},{q:1,r:0},{q:2,r:0}];
const pieces = [{id:'moving',q:0,r:0},{id:'ally',q:1,r:0}];
function harness({ delayed = false, enabled = true } = {}) {
  let hidden = false, time = 0, created = 0;
  const starts = [], stops = [], decoders = [], gains = [], filters = [], values = new Map(enabled ? [] : [['game-of-trows-sound-v1','off']]);
  const context = {
    state: 'running', currentTime: 0, destination: {},
    resume() { this.state = 'running'; return Promise.resolve(); },
    decodeAudioData() { return delayed ? new Promise(resolve => decoders.push(resolve)) : Promise.resolve({duration:.54}); },
    createBufferSource() { return { connect() {}, disconnect() {},
      start(time) { starts.push({time,buffer:this.buffer}); }, stop(time) { stops.push(time); } }; },
    createBiquadFilter() { const filter={connect(){},disconnect(){},frequency:{value:0},Q:{value:0}};filters.push(filter);return filter; },
    createGain() { return { connect() {}, disconnect() {}, gain: {
      setValueAtTime(value) {gains.push(value);}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {}
    } }; }
  };
  const audio = new GameAudio({ createContext: () => { created++; return context; },
    storage: () => ({ getItem: key => values.get(key), setItem: (key,value) => values.set(key,value) }),
    hidden: () => hidden, now: () => time });
  return { audio, context, starts, stops, values, gains, filters, created: () => created,
    hide(value) { hidden = value; if(value) audio.stopAll(); }, tick(ms) { time += ms; },
    decode() { for (const resolve of decoders) resolve({duration:.54}); } };
}

test('approved WAVs are embedded unchanged and load without external requests', () => {
  assert.ok(GAME_AUDIO_ASSETS.remove);
  for (const [name, hash] of [
    ['click','9bc09be1a3046828a97ac0f07df0deb10a99426e92de0582f88385757a6d7bab'],
    ['hover','90deeca3bf5afe75271de86856624d0674ad05d1fdccbd54613ba1c404a1c47c']
  ]) assert.equal(createHash('sha256').update(fs.readFileSync(new URL(`../dist/audio/${name}.wav`,import.meta.url))).digest('hex'),hash);
  assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../dist/audio/remove.wav',import.meta.url))).digest('hex'),
    '4f328a5b8f8df7d5a4de5a2ef71edbb4f96827c0efff7da8424a85039330daa0');
  for (const [name,data] of Object.entries(GAME_AUDIO_ASSETS)) {
    const embedded=Buffer.from(data.split(',')[1],'base64');
    assert.deepEqual(embedded,fs.readFileSync(new URL(`../dist/audio/${name}.wav`,import.meta.url)));
    assert.equal(embedded.toString('ascii',0,4),'RIFF');
  }
});
test('all sounds use their own attenuation and damping profiles', async () => {
  const h=harness();await h.audio.unlock();
  for(const name of ['slide','place','remove','click','hover']) {
    h.audio.play(name);const profile=GAME_SOUND_PROFILES[name];
    assert.equal(h.gains.at(-1),profile.gain*GAME_MASTER_GAIN);assert.ok(profile.gain<=.35);
    assert.equal(h.filters.at(-1).type,'lowpass');assert.equal(h.filters.at(-1).frequency.value,profile.lowpass);
    assert.equal(h.filters.at(-1).Q.value,.5);
  }
  assert.equal(h.starts.at(-2).buffer,h.audio.buffers.click);
  assert.equal(h.starts.at(-1).buffer,h.audio.buffers.hover);
  assert.notEqual(h.audio.buffers.click,h.audio.buffers.hover);
});
test('hover ticks only on cell changes, with no autoplay, repeat or catch-up', async () => {
  const h=harness();h.audio.hover('a');assert.equal(h.created(),0);
  await h.audio.unlock();h.audio.hover('b');assert.equal(h.starts.length,1);
  h.tick(100);h.audio.hover('b');assert.equal(h.starts.length,1);
  h.audio.hover('c');assert.equal(h.starts.length,2);
  h.tick(10);h.audio.hover('d');assert.equal(h.starts.length,2);
  h.tick(100);h.audio.hover('d');assert.equal(h.starts.length,2,'dropped tick is never queued');
  h.audio.click();const afterClick=h.starts.length;h.audio.hover('e');assert.equal(h.starts.length,afterClick);
  h.tick(100);h.audio.setEnabled(false);h.audio.hover('f');assert.equal(h.starts.length,afterClick);
  h.audio.setEnabled(true);h.hide(true);h.audio.hover('g');assert.equal(h.starts.length,afterClick);
});
test('volume uses the existing mix at 50%, scales every cue and persists mute', async () => {
  const h=harness();await h.audio.unlock();
  assert.equal(h.audio.volume,.5);
  h.audio.setVolume(1);h.audio.play('click');
  assert.equal(h.gains.at(-1),GAME_SOUND_PROFILES.click.gain*GAME_MASTER_GAIN*2);
  h.audio.setVolume(.25);h.audio.play('slide');
  assert.equal(h.gains.at(-1),GAME_SOUND_PROFILES.slide.gain*GAME_MASTER_GAIN*.5);
  assert.equal(h.filters.at(-2).type,'highpass');
  const restored=new GameAudio({storage:()=>({getItem:key=>h.values.get(key)})});
  assert.equal(restored.volume,.25);assert.equal(restored.enabled,true);
  h.audio.setVolume(0);const count=h.starts.length;h.audio.play('click');
  assert.equal(h.starts.length,count);assert.equal(h.audio.enabled,false);
  const muted=new GameAudio({storage:()=>({getItem:key=>h.values.get(key)})});
  assert.equal(muted.volume,0);assert.equal(muted.enabled,false);
  h.audio.setVolume(.5);assert.equal(h.audio.enabled,true);
  h.audio.setVolume(NaN);assert.equal(h.audio.volume,.5);
});
test('removal cue respects mute and hidden-tab guards', async () => {
  const h=harness();await h.audio.unlock();
  h.audio.play('remove');assert.equal(h.starts.length,1);
  h.audio.setEnabled(false);h.audio.play('remove');assert.equal(h.starts.length,1);
  h.audio.setEnabled(true);h.hide(true);h.audio.play('remove');assert.equal(h.starts.length,1);
});
test('selection remembers its pointer cell beyond the hover cooldown', async () => {
  const h=harness();await h.audio.unlock();
  h.audio.click('board:0,1');assert.equal(h.starts.length,1);
  h.tick(500);h.audio.hover('board:0,1');assert.equal(h.starts.length,1);
  h.audio.click('board:0,1');assert.equal(h.starts.length,2);
  h.tick(500);h.audio.hover('board:0,1');assert.equal(h.starts.length,2,'deselection also stays silent');
  h.audio.hover('board:1,1');assert.equal(h.starts.length,3,'moving to another cell ticks');
  h.tick(100);h.audio.hover(null);h.audio.hover('board:1,1');assert.equal(h.starts.length,4,'actual leave and return ticks');
});
test('the soft click uses the selection sample at a lower level', async () => {
  const h = harness();
  await h.audio.unlock();
  h.audio.click();
  const selectionLevel = h.gains.at(-1);
  h.tick(100);
  h.audio.click(undefined, { soft: true });
  assert.equal(h.starts.length, 2);
  assert.equal(h.starts[1].buffer, h.starts[0].buffer);
  assert.equal(h.gains.at(-1), selectionLevel * .7);
});
test('tutorial removal sounds on the death phase, including reduced motion', () => {
  const timers=new Map(),sounds=[];let id=0;
  const battle=new ShowcaseBattle({reducedMotion:()=>true,
    audio:{movement:()=>({finish(){},cancel(){}}),play(name){sounds.push(name);return ()=>{};}},
    clock:{setTimer(fn){timers.set(++id,fn);return id;},clearTimer(id){timers.delete(id);}}});
  battle.playAction(TRAINING_ACTIONS[0]);assert.deepEqual(sounds,[]);
  let steps=0;
  while(battle.presentation?.phase!=='deaths'&&timers.size&&steps++<20){
    const [key,fn]=timers.entries().next().value;timers.delete(key);fn();
  }
  assert.equal(battle.presentation.phase,'deaths');assert.deepEqual(sounds,['remove']);
  battle.onChange();assert.deepEqual(sounds,['remove']);battle.restart();
});
test('actual route chooses sliding or placement, ignoring off-route pieces', () => {
  assert.equal(movementSoundKind(route, pieces),'place');
  assert.equal(movementSoundKind(route,[pieces[0],{q:0,r:1}]),'slide');
  assert.equal(movementSoundKind(route.slice(0,1),pieces),null);
  assert.equal(movementSoundKind([{q:0,r:0},{q:1,r:0},{q:1,r:1}],[]),'place');
  assert.equal(movementSoundKind([{q:0,r:0},{q:1,r:-1},{q:2,r:-2}],[]),'slide');
  assert.equal(movementSoundKind([{q:0,r:0},{q:0,r:-1},{q:0,r:-2}],[]),'slide');
  assert.equal(movementSoundKind([{q:0,r:0},{q:1,r:1},{q:2,r:2}],[]),'slide');
  assert.equal(movementSoundKind([{q:0,r:0},{q:1,r:0},{q:0,r:0}],[]),'place');
  const config=clone(DEFAULT_CONFIG);config.stats.archer.move=2;
  const moving={id:'a',type:'archer',team:0,q:0,r:0};
  const state={pieces:[moving,{id:'b',type:'shield',team:0,q:1,r:0}],turn:0,ply:0,winner:null};
  assert.equal(movementSoundKind(movementPath(moving,state,config,{q:2,r:0}),state.pieces),'place');
});
test('audio is lazy, mute persists, and failures of storage/context are harmless', async () => {
  const h=harness();assert.equal(h.created(),0);await h.audio.unlock();assert.equal(h.created(),1);
  h.audio.play('click');assert.equal(h.starts.length,1);
  h.audio.setEnabled(false);h.audio.play('click');assert.equal(h.starts.length,1);
  assert.equal(h.values.get('game-of-trows-sound-v1'),'off');assert.equal(h.audio.voices.size,0);
  const muted=harness({enabled:false});await muted.audio.unlock();assert.equal(muted.created(),0);
  const broken=new GameAudio({storage:()=>{throw Error('blocked');},createContext:()=>{throw Error('unavailable');}});
  assert.doesNotThrow(()=>{broken.play('click');broken.setEnabled(false);broken.setEnabled(true);});await settle();
});
test('delayed decoding cannot replay sounds after cancel, mute, hide, or a stale gesture', async () => {
  for(const reason of ['cancel','mute','hide','stale']) {
    const h=harness({delayed:true});const cancel=h.audio.play('slide');
    if(reason==='cancel')cancel();if(reason==='mute')h.audio.setEnabled(false);
    if(reason==='hide'){h.hide(true);h.hide(false);}if(reason==='stale')h.tick(151);
    h.decode();await settle();assert.equal(h.starts.length,0,reason);
  }
});
test('placement waits for arrival and finishes once; cancel and hide suppress it', async () => {
  const h=harness();await h.audio.unlock();
  const move=h.audio.movement(route,pieces,300);assert.equal(h.starts.length,0);
  move.finish();move.finish();assert.equal(h.starts.length,1);
  const cancelled=h.audio.movement(route,pieces,300);cancelled.cancel();cancelled.finish();assert.equal(h.starts.length,1);
  const hidden=h.audio.movement(route,pieces,300);h.hide(true);h.hide(false);hidden.finish();assert.equal(h.starts.length,1);
  h.audio.setEnabled(false);const muted=h.audio.movement(route,pieces,300);h.audio.setEnabled(true);muted.finish();assert.equal(h.starts.length,1);
});
test('sliding preserves playback pitch and reduced motion still produces one cue', async () => {
  const h=harness();await h.audio.unlock();
  const moving=h.audio.movement(route,[],260);assert.equal(h.starts.length,1);assert.equal(h.stops[0],.10);moving.finish();
  const instant=h.audio.movement(route,[],260,{instant:true});instant.finish();assert.equal(h.starts.length,2);
  assert.equal(h.stops.at(-1),.10,'reduced motion keeps the same short slide');
  const placement=h.audio.movement(route,pieces,260,{instant:true});placement.finish();assert.equal(h.starts.length,3);
});
test('main presentation emits one movement cue for human/bot path and reduced motion', () => {
  const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const config=clone(DEFAULT_CONFIG),state=createGame(config),before={config,state};
  const piece=state.pieces.find(p=>p.type==='archer');
  // A legal movement path supplied by the engine; source is shared by human and bot.
  let destination;
  for(let q=-config.size;q<=config.size&&!destination;q++)for(let r=-config.size;r<=config.size;r++) {
    if(movementPath(piece,state,config,{q,r}).length>1){destination={q,r};break;}
  }
  for(const instant of [false,true]) {
    let cues=0,finishes=0,visuals=0;
    const ctx=vm.createContext({movement:null,cancelMovement(){},movementPath,
      inspectCell:()=>({report:new Map()}),analyze(){},point:p=>p,createMovementPlan:()=>({duration:260}),
      matchMedia:()=>({matches:instant}),gameAudio:{movement(){cues++;return {finish(){finishes++;}};}},
      render(){},presentKills(){},moveAnimator:{start(){visuals++;}}});
    vm.runInContext(app.slice(app.indexOf('function completeMovementPresentation('),app.indexOf('function presentKills(')),ctx);
    ctx.presentMove(before,{id:piece.id,to:destination},[]);
    assert.equal(cues,1);assert.equal(finishes,instant?1:0);assert.equal(visuals,instant?0:1);
  }
});
test('tutorial uses the same movement cues and cancels a pending arrival on restart', () => {
  let starts=0,finishes=0,cancels=0;
  const audio={movement(){starts++;return {finish(){finishes++;},cancel(){cancels++;}};}};
  const instant=new ShowcaseBattle({audio,reducedMotion:()=>true,clock:{setTimer:()=>1,clearTimer(){}}});
  instant.playAction(TRAINING_ACTIONS[0]);assert.equal(starts,1);assert.equal(finishes,1);
  const battle=new ShowcaseBattle({audio,clock:{now:()=>0,requestFrame:()=>1,cancelFrame(){}}});
  battle.playAction(TRAINING_ACTIONS[0]);battle.restart();assert.equal(starts,2);assert.equal(cancels,1);assert.equal(finishes,1);
});

test('a silent destination click cancels the hover voice without playing a selection cue', async () => {
  const h = harness(); await h.audio.unlock(); h.audio.hover('board:0,1');
  const started = h.starts.length, stopped = h.stops.length;
  h.audio.click('board:0,1', { silent: true });
  assert.equal(h.starts.length, started); assert.ok(h.stops.length > stopped);
  h.tick(200); h.audio.hover('board:0,1'); assert.equal(h.starts.length, started);
  h.audio.click('board:0,2'); assert.equal(h.starts.length, started + 1);
  assert.equal(h.starts.at(-1).buffer, h.audio.buffers.click);
});
test('board activation keeps selection audible and destination movement silent in local and online play', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  const fn = app.slice(app.indexOf('function activateBoardCell('), app.indexOf('function focusBoardCell('));
  const cues = [], actions = [], ctx = vm.createContext({ tableRattle: null, editor: false, tool: 'shield', selected: 'piece',
    visibleState: () => ({ pieces: [{ id: 'piece', q: 0, r: 0 }] }), humanCanMove: () => true,
    movement: null, combat: null, currentDeaths: [],
    available: [{ q: 0, r: 1 }], gameAudio: { click(key, options) { cues.push({ key, ...options }); } },
    onCell(q, r) { actions.push([q, r]); } });
  vm.runInContext(fn, ctx);
  for (const mode of ['bot', 'local', 'online']) {
    ctx.playMode = mode; ctx.activateBoardCell(0, 1); assert.equal(cues.at(-1).silent, true);
    ctx.activateBoardCell(0, 0); assert.equal(cues.at(-1).silent, false);
    assert.equal(cues.at(-1).soft, true);
    ctx.activateBoardCell(2, 2); assert.equal(cues.at(-1).silent, false);
    assert.equal(cues.at(-1).soft, true);
  }
  ctx.selected = null; ctx.activateBoardCell(2, 2); assert.equal(cues.at(-1).soft, false);
  ctx.editor = true; ctx.activateBoardCell(0, 1); assert.equal(cues.at(-1).silent, true);
  ctx.selected = null; ctx.activateBoardCell(0, 0); assert.equal(cues.at(-1).soft, false);
  assert.equal(actions.length, 12);
});
