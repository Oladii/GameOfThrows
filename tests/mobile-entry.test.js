import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { routePage } from '../mobile/build.mjs';

const root = new URL('../docs/', import.meta.url);
const base = 'https://oladii.github.io/GameOfThrows/';
test('shared game and room links select a device once and preserve query and hash', () => {
  for (const [navigator, phone] of [
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' }, true],
    [{ userAgent: 'Android 15; Pixel) Mobile Safari/537.36' }, true],
    [{ userAgent: 'Chromium', userAgentData: { mobile: true } }, true],
    [{ userAgent: 'Android 15; Tablet) Safari/537.36' }, false],
    [{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Touch)' }, false],
    [{ userAgent: 'Macintosh; Intel Mac OS X' }, false],
  ]) {
    for (const entry of [true, false]) {
      const file = entry ? 'mobile.html' : '';
      const suffix = '?room=abc&via=share#board';
      let redirect = null;
      const location = new URL(base + file + suffix);
      location.replace = url => { redirect = url; };
      const script = routePage('<head></head>', entry).match(/<script>([^]*?)<\/script>/)[1];
      vm.runInNewContext(script, { location, URL, navigator });
      assert.equal(redirect, entry === phone ? null : base + (phone ? 'mobile.html' : '') + suffix);
    }
  }
});

test('both published entries contain the same release, room bootstrap and bot worker', async () => {
  const [desktop, mobile, manifest] = await Promise.all(['index.html', 'mobile.html', 'version.json'].map(file => readFile(new URL(file, root), 'utf8')));
  for (const page of [desktop, mobile]) {
    assert.ok(page.includes('>v' + JSON.parse(manifest).version + '</span>'));
    assert.match(page, /if \(initialRoomId\) \{\s*openOnlineRoom\(initialRoomId\);/);
  }
  const worker = page => page.match(/<script id="bot-worker-source"[^>]*>([^]*?)<\/script>/)[1];
  assert.equal(worker(desktop), worker(mobile));
  assert.ok(mobile.includes('<body class="mobile-game">'));
  assert.ok(!mobile.includes('<option value="local">'));
  assert.ok(desktop.includes('<option value="local">'));
});
