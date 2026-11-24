import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('archive status and automatic bot recovery stay out of the displayed interface', () => {
  for (const path of ['dist/index.html', 'Lamps.html', 'docs/index.html', 'docs/mobile.html']) {
    const html = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /id="(?:archive-status|archive-retry|archive-details|archive-errors|bot-controls|resume-bot|bot-status)"/, path);
  }
});
