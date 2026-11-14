import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
const root=path.resolve(arg('root')||'outputs/enemy-blocking-2026-11-13'),stage=arg('stage');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const bytesHash=x=>crypto.createHash('sha256').update(x).digest('hex');
const hash=x=>bytesHash(JSON.stringify(x));
const manifest=read('manifest.json'),plan=read('plan.json'),config=read('config.json'),initial=read('initial.json');
assert.equal(hash(config),manifest.configHash,'frozen configuration');
assert.equal(hash(initial),manifest.initialHash,'frozen start');
assert.equal(new Set(plan.jobs.map(j=>j.id)).size,plan.jobs.length,'unique job ids');
for(const [variant,files] of Object.entries(manifest.moduleHashes))for(const [name,expected] of Object.entries(files)) {
  assert.equal(bytesHash(fs.readFileSync(path.join(root,'source',variant,name))),expected,'snapshot '+variant+'/'+name);
}
const oldEngine=fs.readFileSync(path.join(root,'source/control/engine.js'),'utf8');
const newEngine=fs.readFileSync(path.join(root,'source/enemy-blocking/engine.js'),'utf8');
const diff=manifest.candidateDiff;
assert.equal(oldEngine.split(diff.before).length,2,'one exact patched branch');
assert.equal(oldEngine.replace(diff.before,diff.after),newEngine,'single experimental code change');
for(const name of manifest.sourceFiles.filter(x=>x!=='engine.js'))
  assert.equal(manifest.moduleHashes.control[name],manifest.moduleHashes['enemy-blocking'][name],'identical non-engine sources '+name);
const modules=Object.fromEntries(await Promise.all(['control','enemy-blocking'].map(async v=>[v,await import(pathToFileURL(path.join(root,'source',v,'engine.js')).href)])));
const completed=[],missing=[],expected=plan.jobs.filter(j=>!stage||j.stage===stage);
for(const job of expected) {
  const filename=path.join(root,'games',job.id+'.json');
  if(!fs.existsSync(filename)){missing.push(job.id);continue;}
  const g=JSON.parse(fs.readFileSync(filename,'utf8')),E=modules[job.variant];
  assert.deepEqual(g.job,job,'frozen job '+job.id);
  assert.equal(g.sourceManifestHash,hash(manifest),'source provenance '+job.id);
  assert.equal(g.configHash,hash(config),'configuration provenance '+job.id);
  assert.deepEqual(g.config,config,'config '+job.id);
  const wanted=E.clone(initial);wanted.turn=job.first;
  assert.deepEqual(g.initial,wanted,'initial position '+job.id);
  assert.equal(g.initialHash,hash(wanted),'initial provenance '+job.id);
  assert.ok(g.actions.length<=job.limit,'research action budget '+job.id);
  let s=E.clone(g.initial);
  for(const [i,a] of g.actions.entries()) {
    assert.equal(a.index,i+1,'action sequence');assert.equal(a.team,s.turn,'turn');
    assert.equal(s.winner,null,'no actions after game over');
    const result=a.action.pass?E.pass(s,config):E.move(s,config,a.action.id,a.action.to);
    assert.deepEqual(result.deaths,a.deaths,'losses '+job.id+' '+a.index);
    assert.equal(hash(result.state),a.stateHash,'state '+job.id+' '+a.index);
    if(a.combat)assert.deepEqual([...result.report].map(([id,stats])=>({id,...stats})),a.combat,'combat report');
    if(a.selection)for(const field of ['score','nodes','elapsedMs'])assert.ok(Number.isFinite(a.selection[field]),'finite selection '+field);
    s=result.state;
  }
  assert.deepEqual(s,g.final,'final '+job.id);assert.equal(g.winner,s.winner,'native outcome');
  assert.equal(g.actionCount,g.actions.length,'action count');
  if(s.winner!==null)assert.equal(g.stop,'engine-terminal','terminal stop');
  else {
    assert.ok(['action-limit','no-legal-actions'].includes(g.stop),'explicit unresolved stop');
    if(g.stop==='action-limit')assert.equal(g.actions.length,job.limit,'actual action limit reached');
    if(g.stop==='no-legal-actions') {
      const moves=s.pieces.filter(p=>p.team===s.turn).flatMap(p=>E.reachable(p,s,config));
      assert.equal(moves.length,0,'no legal action stop must be genuine');
      assert.ok(!config.experiments.allowPass,'pass must also be unavailable');
    }
  }
  completed.push({id:job.id,actions:g.actions.length,winner:s.winner,stop:g.stop,sha256:bytesHash(fs.readFileSync(filename))});
}
const productDrift=[];
for(const [file,expectedHash] of Object.entries(manifest.productHashes)) {
  const filename=path.isAbsolute(file)?file:path.join(manifest.productDist,file);
  const actual=fs.existsSync(filename)?bytesHash(fs.readFileSync(filename)):null;
  if(actual!==expectedHash)productDrift.push({file,expected:expectedHash,actual});
}
const result={createdAt:new Date().toISOString(),stage:stage||'all',snapshotPassed:true,replayPassed:true,complete:missing.length===0,expectedGames:expected.length,verifiedGames:completed.length,missing,productUnchanged:productDrift.length===0,productDrift,completed};
fs.writeFileSync(path.join(root,stage?'verification-'+stage+'.json':'final-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,completed:completed.length,missing:missing.length}));
if(missing.length)process.exitCode=2;
