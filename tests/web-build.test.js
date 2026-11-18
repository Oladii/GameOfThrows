import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('development and published entries select existing artwork and advertise the same rules they run', async () => {
  const { version } = JSON.parse(await read('package.json'));
  for (const directory of ['dist', 'docs']) {
    const html = await read(directory + '/index.html');
    const manifest = JSON.parse(await read(directory + '/version.json'));
    const rulesVersion = html.match(/id="version-number" data-rules-version="([^"]+)"/)[1];
    assert.deepEqual(manifest, { version, rulesVersion });
    const logo = html.match(/class="brand-logo"[^>]*srcset="([^"]+)"/)[1];
    assert.deepEqual(logo.split(', ').map(entry => entry.split(' ')[1]), ['1x', '2x', '3x']);
    const paths = new Set(html.match(/\.\/art\/[\w.-]+/g));
    for (const asset of paths) await access(new URL(directory + '/' + asset, root));
    if (directory === 'docs') {
      assert.doesNotMatch(html, /<script src="\/game-selects.js"|data:image\/png;base64,/);
    }
  }
});

test('the downloadable game embeds its own graphics and controls', async () => {
  const html = await read('Lamps.html');
  assert.match(html, /class="brand-logo" src="data:image\/png;base64,/);
  assert.doesNotMatch(html, /\.\/art\/|<script src="\/game-selects.js"|type="importmap"/);
});
