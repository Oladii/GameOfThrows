import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAnalytics } from '../dist/browser-analytics.js';
class MemoryStorage {
  data=new Map(); get length(){return this.data.size;} key(i){return [...this.data.keys()][i];}
  getItem(k){return this.data.get(k)??null;} setItem(k,v){this.data.set(k,v);} removeItem(k){this.data.delete(k);}
}
function fixture(extra={}){let time=Date.parse('2026-11-16T00:00:00Z'),n=0;const sent=[],storage=new MemoryStorage();const client=new BrowserAnalytics({enabled:true,endpoint:'https://archive.test',storage,identity:{async getOrCreatePlayerId(){return 'browser';}},uuid:()=>`id-${++n}`,now:()=>time,fetch:async(url,request)=>{sent.push(JSON.parse(request.body));return {ok:true};},...extra});return {client,sent,storage,advance(ms){time+=ms;}};}
test('analytics retries persisted events and preserves the original browser identity and event id',async()=>{
 const f=fixture({fetch:async()=>{throw new Error('offline');}});
 f.client.event('visit');await f.client.chain; await f.client.flush();const pending=JSON.parse(f.storage.getItem(f.client.key));assert.equal(pending.events.length,1);
 const next=fixture({storage:f.storage});next.client.fetch=async(url,r)=>{next.sent.push(JSON.parse(r.body));return {ok:true};};
 await next.client.flush();assert.equal(next.sent[0].playerId,'browser');assert.equal(next.sent[0].events[0].id,pending.events[0].id);assert.equal(f.storage.length,0);
});
test('active time stops when hidden or outside a battle and is attached to the correct game',async()=>{
 const f=fixture();f.client.tick({gameId:'first'},true);f.advance(15_000);f.client.tick({gameId:'first'},false);f.advance(300_000);f.client.tick({gameId:'first'},true);f.advance(10_000);f.client.tick({gameId:'second'},true);await f.client.chain; await f.client.flush();
 const events=f.sent.flatMap(r=>r.events),time=events.filter(e=>e.type==='game_time');assert.equal(time.reduce((s,e)=>s+e.seconds,0),25);assert.ok(time.every(e=>e.gameId==='first'));
 f.advance(15_000);f.client.tick(null,false);await f.client.chain; await f.client.flush();assert.equal(f.sent.flatMap(r=>r.events).filter(e=>e.gameId==='second'&&e.type==='game_time')[0].seconds,15);
});
test('disabled analytics never opens identity storage or sends anything',async()=>{
 const f=fixture({enabled:false,identity:{async getOrCreatePlayerId(){throw new Error('must not run');}}});f.client.event('visit');await f.client.chain; await f.client.flush();assert.equal(f.sent.length,0);assert.equal(f.storage.length,0);
});


test('a slow network request does not block recording subsequent events',async()=>{
 let release;const f=fixture({fetch:()=>new Promise(resolve=>{release=()=>resolve({ok:true});})});
 f.client.event('visit');await f.client.chain;
 f.client.event('tutorial_open');await f.client.chain;
 assert.equal(JSON.parse(f.storage.getItem(f.client.key)).events.length,2);
 release();await f.client.flush();
 assert.equal(JSON.parse(f.storage.getItem(f.client.key)).events[0].type,'tutorial_open');
});
