import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_START_CHOICES, resolveStartChoices } from '../dist/start-preferences.js';

const nextDefaults = { firstMove: 'south', humanTeam: 0, botDifficulty: 'easy' };
test('untouched choices follow the next release defaults independently', () => {
  const saved = resolveStartChoices();
  assert.deepEqual(saved.explicit, { firstMove: false, humanTeam: false, botDifficulty: false });
  const updated = resolveStartChoices(JSON.parse(JSON.stringify(saved)), nextDefaults);
  for (const key of Object.keys(nextDefaults)) assert.equal(updated[key], nextDefaults[key]);
  assert.deepEqual(updated.defaults, nextDefaults);
});
test('explicit choices survive changed defaults, including an explicit choice of the former default', () => {
  const saved = { ...DEFAULT_START_CHOICES, explicit: { firstMove: true, humanTeam: true, botDifficulty: true }, defaults: DEFAULT_START_CHOICES };
  const updated = resolveStartChoices(saved, nextDefaults);
  for (const key of Object.keys(nextDefaults)) assert.equal(updated[key], DEFAULT_START_CHOICES[key]);
});
test('one manual choice does not pin the other defaults', () => {
  const saved = resolveStartChoices({ ...DEFAULT_START_CHOICES, botDifficulty: 'hard', explicit: { firstMove: false, humanTeam: false, botDifficulty: true } });
  const updated = resolveStartChoices(saved, nextDefaults);
  assert.equal(updated.botDifficulty, 'hard'); assert.equal(updated.firstMove, 'south'); assert.equal(updated.humanTeam, 0);
});
test('legacy saves infer manual values against the known previous defaults', () => {
  const updated = resolveStartChoices({ firstMove: 'north', humanTeam: 1, botDifficulty: 'hard' }, nextDefaults);
  assert.equal(updated.firstMove, 'north'); assert.equal(updated.humanTeam, 0); assert.equal(updated.botDifficulty, 'hard');
  assert.deepEqual(updated.explicit, { firstMove: true, humanTeam: false, botDifficulty: true });
});
test('invalid manual values fall back to new defaults', () => {
  const updated = resolveStartChoices({ firstMove: 'bad', humanTeam: 9, botDifficulty: 'constructor', explicit: { firstMove: true, humanTeam: true, botDifficulty: true } }, nextDefaults);
  for (const key of Object.keys(nextDefaults)) assert.equal(updated[key], nextDefaults[key]);
  assert.deepEqual(updated.explicit, { firstMove: false, humanTeam: false, botDifficulty: false });
});
