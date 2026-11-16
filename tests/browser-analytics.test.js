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

test('ipapi location is cached across reloads and only coarse fields reach analytics',async()=>{
 const lookups=[],posts=[];
 const fetch=async(url,r)=>{if(url==='https://api.ipapi.is/'){lookups.push(r);return {ok:true,json:async()=>({ip:'secret-ip',lat:52.7,lon:6.1,city:'Meppel',region:'Drenthe',country:'The Netherlands',company:'secret-company'})};}posts.push(JSON.parse(r.body));return {ok:true};};
 const f=fixture({geoEnabled:true,fetch});
 f.client.event('visit');await f.client.chain;await f.client.flush();
 assert.equal(lookups.length,1);assert.equal(lookups[0].credentials,'omit');assert.equal(lookups[0].referrerPolicy,'no-referrer');
 assert.deepEqual(posts[0].geo,{source:'ipapi.is',country:'The Netherlands',region:'Drenthe',city:'Meppel'});
 assert.doesNotMatch(JSON.stringify([...f.storage.data])+JSON.stringify(posts),/secret|"lat"|"lon"|company/);
 const next=fixture({storage:f.storage,geoEnabled:true,fetch});await next.client.location();assert.equal(lookups.length,1);
 f.advance(86400_001);await f.client.location();assert.equal(lookups.length,2);
});
test('ipapi deduplicates in-flight and cross-tab lookups; 429 backs off for a day',async()=>{
 let release,count=0;
 const f=fixture({geoEnabled:true,fetch:async()=>{count++;return new Promise(resolve=>{release=()=>resolve({ok:false,status:429});});}});
 const first=f.client.location(),same=f.client.location();
 const other=fixture({storage:f.storage,geoEnabled:true,fetch:async()=>{throw Error('must not request');}});
 assert.equal(await other.client.location(),null);release();assert.deepEqual(await Promise.all([first,same]),[null,null]);
 await f.client.location();f.advance(3600_000);await f.client.location();assert.equal(count,1);
});
test('geo body timeout cannot hold analytics and failure does not retry each event',async()=>{
 let lookups=0,posts=0;
 const f=fixture({geoEnabled:true,geoTimeoutMs:10,fetch:async(url)=>{if(url==='https://api.ipapi.is/'){lookups++;return {ok:true,json:()=>new Promise(()=>{})};}posts++;return {ok:true};}});
 f.client.event('visit');await f.client.chain;await f.client.flush();assert.equal(posts,1);
 f.client.event('tutorial_open');await f.client.chain;await f.client.flush();assert.equal(posts,2);assert.equal(lookups,1);
});
test('disabled analytics never calls ipapi, and nested/null/error responses are handled',async()=>{
 const off=fixture({enabled:false,geoEnabled:true,fetch:async()=>{throw Error('disabled');}});assert.equal(await off.client.location(),null);assert.equal(off.storage.length,0);
 for(const raw of [{location:{country_code:'RU',state:'Tatarstan',city:'Kazan',latitude:55}}, {city:null}, {error:'quota',city:'fake'}]){
  const f=fixture({geoEnabled:true,fetch:async()=>({ok:true,json:async()=>raw})});
  assert.equal((await f.client.location())?.city??null,raw.location?'Kazan':null);
 }
});
