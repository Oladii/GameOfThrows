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
  const { version, rulesVersion } = JSON.parse(manifest);
  for (const page of [desktop, mobile]) {
    assert.ok(page.includes(`id="version-number" data-rules-version="${rulesVersion}">${version}</span><span id="version-channel"></span>`));
    const buildStamp = page.match(/id="version-build" data-built-at="([^"]+)">(\d{2}\.\d{2}\.\d{4})<\/span>/);
    assert.ok(buildStamp, 'published entries show a date without the time');
    const [, builtAt, visibleDate] = buildStamp;
    const formatDate = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short' });
    assert.equal(visibleDate, formatDate.format(new Date(builtAt)));
    assert.equal([...page.matchAll(/@font-face\{font-family:"Inter";/g)].length, 1);
    assert.match(page, /html\{[^}]*-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale/);
    assert.match(page, /if \(initialRoomId\) openOnlineRoom\(initialRoomId\);/);
  }
  const worker = page => page.match(/<script id="bot-worker-source"[^>]*>([^]*?)<\/script>/)[1];
  assert.equal(worker(desktop), worker(mobile));
  assert.ok(mobile.includes('<body class="mobile-game">'));
  assert.ok(mobile.includes('<div class="play-mode-field" hidden>'));
  assert.ok(desktop.includes('<div class="play-mode-field">'));
  assert.ok(!mobile.includes('<option value="local">'));
  assert.ok(desktop.includes('<option value="local">'));
  assert.doesNotMatch(mobile, /humanTeam = 0; firstMove = 'north'/);
});

test('the mobile home logo shares the preloaded image at each pixel density', async () => {
  const html = await readFile(new URL('mobile.html', root), 'utf8');
  const preload = html.match(/id="startup-logo-preload"[^>]*imagesrcset="([^"]+)"/)?.[1];
  const homeLogo = html.match(/class="home-logo"[^>]*srcset="([^"]+)"/)?.[1];
  assert.ok(homeLogo);
  assert.equal(homeLogo, preload);
  assert.deepEqual(homeLogo.split(', ').map(candidate => candidate.split(' ')[1]), ['1x', '2x', '3x']);
});
