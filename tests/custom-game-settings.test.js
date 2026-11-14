import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
test('combat parameters are reachable only from custom game setup',()=>{
 const start=app.indexOf("$('#settings-open').addEventListener");
 const source=app.slice(start,app.indexOf("$('#settings-form').elements.geometry",start));
 for(const [gamePhase,positionKind,editor,allowed] of [['setup','custom',false,true],['setup','default',false,false],['playing','custom',false,false],['setup','custom',true,false]]){
  let click,opened=0,filled=0;
  const context=vm.createContext({gamePhase,positionKind,editor,refreshingNewGame:false,config:DEFAULT_CONFIG,
   $:selector=>selector==='#settings-open'?{addEventListener:(_type,fn)=>{click=fn;}}:{showModal(){opened++;}},
   cancelBot(){},cancelMovement(){},fillSettings(){filled++;},render(){}});
  vm.runInContext(source,context);click();assert.equal(opened,allowed?1:0);assert.equal(filled,opened);
 }
});
test('standard setup restores both default rules and formation while keeping the previous game',()=>{
 let change;
 const previousGame={saved:true};
 const context=vm.createContext({gamePhase:'setup',positionKind:'custom',editor:false,config:{custom:true},DEFAULT_CONFIG,previousGame,
  clone:structuredClone,createGame:c=>({standard:c===context.config}),resetBotContext(){},render(){},toast(){},
  $:()=>({addEventListener:(_type,fn)=>{change=fn;}})});
 const start=app.indexOf("$('#position-kind').addEventListener");
 vm.runInContext(app.slice(start,app.indexOf("$('#configure-position').addEventListener",start)),context);
 change({target:{value:'default'}});assert.deepEqual(context.config,DEFAULT_CONFIG);assert.equal(context.positionKind,'default');assert.equal(context.previousGame,previousGame);
});
test('settings button is outside the header and grouped with custom formation controls',()=>{
 const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 assert.ok(!html.slice(html.indexOf('<header'),html.indexOf('</header>')).includes('id="settings-open"'));
 const start=html.slice(html.indexOf('<dialog id="start-dialog"'),html.indexOf('<dialog id="settings-dialog"'));
 assert.ok(start.includes('Расстановка и правила'));assert.ok(start.includes('id="settings-open"'));assert.ok(start.includes('Параметры боя'));
 assert.ok(!html.includes('settings-gear'));
});
