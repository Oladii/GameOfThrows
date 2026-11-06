import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, validateConfig } from '../dist/engine.js';
import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';

const selected = JSON.parse(fs.readFileSync(new URL('../balanced-auto3_076.json', import.meta.url), 'utf8'));

test('new local defaults exactly match the validated preset, including its deployment', () => {
  assert.equal(BALANCE_REVISION, 5);
  assert.deepEqual(DEFAULT_CONFIG, selected.config);
  assert.deepEqual(clone(createGame(DEFAULT_CONFIG)), selected.state);
});

test('old standard saves upgrade once without changing layout, experiments or input', () => {
  const saved = clone(REVISION_FOUR_CONFIG);
  saved.geometry = 'square'; saved.size = 6; saved.army.archers = 3;
  saved.auraDefenseCap = 2; saved.experiments.allowPass = true;
  const before = clone(saved), updated = updateSavedBalance(saved, 4);
  assert.deepEqual(saved, before);
  assert.deepEqual(updated, { ...before, stats: clone(DEFAULT_CONFIG.stats), shieldPromotion: clone(DEFAULT_CONFIG.shieldPromotion) });
  assert.deepEqual(updateSavedBalance(updated, BALANCE_REVISION), updated);
});

test('custom combat profiles and explicitly imported older settings keep their values', () => {
  for (const change of [
    c => { c.stats.shield.fortitude = 7; },
    c => { c.stats.archer.damageBonus = 1; },
    c => { c.shieldPromotion.maxRange = 4; }
  ]) {
    const custom = clone(REVISION_FOUR_CONFIG); change(custom);
    assert.deepEqual(updateSavedBalance(custom, 4), custom);
  }
  assert.deepEqual(updateSavedBalance(REVISION_FOUR_CONFIG, BALANCE_REVISION), REVISION_FOUR_CONFIG);
  assert.deepEqual(validateConfig(clone(REVISION_FOUR_CONFIG)), REVISION_FOUR_CONFIG);
});
