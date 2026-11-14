import test from 'node:test';
import assert from 'node:assert/strict';
import { freshNewGameUrl, consumeNewGameRefresh, refreshNewGamePage, hasNewerGameVersion, needsNewGame, latestGameVersion } from '../dist/new-game-refresh.js';

const gameHtml = '<span id="version-number">v0.1.8</span><script id="bot-worker-source" type="application/json"></script>';
const response = (html = gameHtml, ok = true) => ({ ok, text: async () => html });
function page(href = 'https://oladii.github.io/GameOfThrows/?theme=light#board') {
  return { href, replace(url) { this.replaced = url; } };
}

test('each new-game URL bypasses the previous cache key and preserves the game path and other URL options', () => {
  const one = new URL(freshNewGameUrl(page().href, 'one'));
  const two = new URL(freshNewGameUrl(one.href, 'two'));
  assert.equal(two.origin, one.origin); assert.equal(two.pathname, '/GameOfThrows/');
  assert.equal(two.hash, '#board'); assert.equal(two.searchParams.get('theme'), 'light');
  assert.equal(two.searchParams.get('_fresh'), 'two'); assert.equal(two.searchParams.get('_newGame'), '1');
  assert.equal(two.searchParams.getAll('_fresh').length, 1);
  assert.equal(freshNewGameUrl('file:///tmp/Lamps.html'), null);
});

test('refresh intent is consumed once while retaining the unique cache key', () => {
  const location = page(freshNewGameUrl(page().href, 'fresh'));
  const history = { replaceState(_data, _title, href) { location.href = href; } };
  assert.equal(consumeNewGameRefresh(location, history), true);
  assert.equal(consumeNewGameRefresh(location, history), false);
  assert.equal(new URL(location.href).searchParams.get('_fresh'), 'fresh');
});

test('a valid fresh standalone response is fetched without HTTP caching before navigation', async () => {
  const location = page(); let requested;
  const result = await refreshNewGamePage({ location, fetchPage: async (url, options) => {
    assert.equal(options.cache, 'no-store'); assert.equal(options.signal.aborted, false);
    assert.equal(location.replaced, undefined); requested = url; return response();
  } });
  assert.equal(result, true); assert.equal(location.replaced, requested);
});

test('offline, HTTP errors, unrelated HTML and network failures keep the current game page', async () => {
  for (const fetchPage of [async () => response('', false), async () => response('<html>Proxy error</html>'), async () => { throw new Error('offline'); }]) {
    const location = page();
    assert.equal(await refreshNewGamePage({ location, fetchPage }), false);
    assert.equal(location.replaced, undefined);
  }
  for (const location of [page(), page('file:///tmp/Lamps.html')]) {
    assert.equal(await refreshNewGamePage({ location, online: false, fetchPage() { assert.fail('must not fetch'); } }), false);
  }
});

test('a stalled update times out and does not navigate', async () => {
  const location = page();
  const result = await refreshNewGamePage({ location, timeoutMs: 10, fetchPage: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  assert.equal(result, false); assert.equal(location.replaced, undefined);
});

test('an old or legacy match warns until a new match is prepared, even after saving and reloading', () => {
  for (const savedVersion of [null, undefined, '0.1.19']) {
    const stored=JSON.parse(JSON.stringify({gameVersion:savedVersion}));
    assert.equal(needsNewGame({phase:'playing',savedVersion:stored.gameVersion,currentRulesVersion:'0.1.20'}),true);
  }
  assert.equal(needsNewGame({phase:'playing',savedVersion:'0.1.20',currentRulesVersion:'0.1.20'}),false);
  assert.equal(needsNewGame({phase:'setup',savedVersion:null,currentRulesVersion:'0.1.20'}),false);
  assert.equal(needsNewGame({phase:'playing',savedVersion:'0.1.20',currentRulesVersion:'0.1.20',latestRulesVersion:'0.1.21'}),true);
  assert.equal(needsNewGame({phase:'setup',savedVersion:'0.1.20',currentRulesVersion:'0.1.20',latestRulesVersion:'0.1.21'}),true);
  assert.equal(hasNewerGameVersion('0.1.9','0.1.20'),true);
  for(const value of ['0.1.19','0.1.20',null,'invalid'])assert.equal(hasNewerGameVersion('0.1.20',value),false);
});
test('checking the latest release bypasses caches without navigation or new-game intent', async () => {
  const location=page('https://oladii.github.io/GameOfThrows/?_newGame=1&_fresh=old#board');
  const found=await latestGameVersion({location,fetchPage:async (href,options)=>{
    const url=new URL(href);assert.equal(url.pathname,'/GameOfThrows/');
    assert.equal(url.searchParams.has('_newGame'),false);assert.equal(url.searchParams.has('_fresh'),false);
    assert.ok(url.searchParams.get('_versionCheck'));assert.equal(options.cache,'no-store');
    return response('<span id="version-number">v0.1.20</span>');
  }});
  assert.equal(found,'0.1.20');assert.equal(location.replaced,undefined);
});
test('failed update checks keep the current match and do not invent an available update', async () => {
  for(const fetchPage of [async()=>response('',false),async()=>response('<html>unrelated</html>'),async()=>{throw new Error('offline');}]) {
    assert.equal(await latestGameVersion({location:page(),fetchPage}),null);
  }
  assert.equal(await latestGameVersion({location:page('file:///tmp/Lamps.html'),fetchPage(){assert.fail('must not fetch');}}),null);
  assert.equal(await latestGameVersion({location:page(),online:false,fetchPage(){assert.fail('must not fetch');}}),null);
});


test('UI releases do not require replacing a match; real rules changes do', async () => {
  assert.equal(needsNewGame({ phase: 'playing', savedVersion: '0.1.42', currentVersion: '0.1.56', latestVersion: '0.1.57', currentRulesVersion: '0.1.42', latestRulesVersion: '0.1.42' }), false);
  assert.equal(needsNewGame({ phase: 'playing', savedVersion: '0.1.55', currentRulesVersion: '0.1.42', latestRulesVersion: '0.1.60' }), true);
  assert.equal(needsNewGame({ phase: 'playing', savedVersion: '0.1.41', currentRulesVersion: '0.1.42' }), true);
  const release = await latestGameVersion({ location: page(), includeRules: true, fetchPage: async () => response('<span id="version-number" data-rules-version="0.1.42">v0.1.56</span>') });
  assert.deepEqual(release, { version: '0.1.56', rulesVersion: '0.1.42' });
  const unmarked = await latestGameVersion({ location: page(), includeRules: true, fetchPage: async () => response('<span id="version-number">v0.1.99</span>') });
  assert.equal(unmarked.rulesVersion, null);
  assert.equal(needsNewGame({ phase: 'playing', savedVersion: '0.1.42', currentRulesVersion: '0.1.42', latestRulesVersion: unmarked.rulesVersion }), false);
});
