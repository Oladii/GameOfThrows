import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DEFAULT_CONFIG,PREVIOUS_ARCHER_CONFIG,updateSavedBalance} from '../dist/rules.js';
import {clone,analyze,validateConfig} from '../dist/engine.js';

test('all three support types gain exactly one fortitude after the archer upgrade',()=>{
 const expected=clone(PREVIOUS_ARCHER_CONFIG);
 for(const type of ['attackLamp','defenseLamp','scoutLamp'])expected.stats[type].fortitude++;
 assert.deepEqual(DEFAULT_CONFIG,expected);
 assert.deepEqual(updateSavedBalance(PREVIOUS_ARCHER_CONFIG,11),DEFAULT_CONFIG);
 assert.deepEqual(updateSavedBalance(PREVIOUS_ARCHER_CONFIG,12),PREVIOUS_ARCHER_CONFIG);
 assert.deepEqual(validateConfig(PREVIOUS_ARCHER_CONFIG),PREVIOUS_ARCHER_CONFIG);
});
test('support survives a bare arrow and a banner protects it from a supported arrow',()=>{
 const target={id:'target',type:'scoutLamp',team:0,q:1,r:1},enemy={id:'enemy',type:'archer',team:1,q:1,r:3};
 const drum={id:'drum',type:'attackLamp',team:1,q:1,r:2},banner={id:'banner',type:'defenseLamp',team:0,q:0,r:0};
 const info=pieces=>analyze({pieces,turn:0,ply:0,winner:null},DEFAULT_CONFIG).get('target');
 assert.deepEqual([info([target,enemy]).fortitude,info([target,enemy]).incoming,info([target,enemy]).dead],[3,2,false]);
 assert.equal(info([target,enemy,drum]).dead,true);
 assert.deepEqual([info([target,enemy,drum,banner]).fortitude,info([target,enemy,drum,banner]).incoming,info([target,enemy,drum,banner]).dead],[4,3,false]);
});
test('the scout uses binoculars again on every surface sharing the icon map',()=>{
 const app=fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
 const icon=app.match(/scoutLamp: '([^']*)'/)[1];
 assert.match(icon,/<circle cx="6" cy="16" r="4"\/>/);
 assert.match(icon,/<circle cx="18" cy="16" r="4"\/>/);
 assert.doesNotMatch(icon,/rotate\(-35/);
});
