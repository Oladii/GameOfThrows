import test from 'node:test';
import assert from 'node:assert/strict';
import { freshNewGameUrl, consumeNewGameRefresh, refreshNewGamePage } from '../dist/new-game-refresh.js';

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
