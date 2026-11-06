import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CONFIG, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, createGame, validateConfig } from '../dist/engine.js';
import { REVISION_FOUR_CONFIG } from './fixtures/revision-four.js';

const selected = JSON.parse(fs.readFileSync(new URL('../balanced-area-auras.json', import.meta.url), 'utf8'));

test('new local defaults match the selected solid-aura preset and deployment', () => {
  assert.equal(BALANCE_REVISION, 6);
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

test('revision-five standard profiles migrate to the solid aura balance once, preserving custom profiles', () => {
  const old = {"version":1,"geometry":"hex","size":4,"auraDefenseCap":-1,"army":{"groups":2,"shields":2,"archers":2,"attackLamps":1,"defenseLamps":1},"shieldPromotion":{"aura":1,"damageBonus":9,"rangeBonus":2,"defenseBonus":9,"maxRange":3},"stats":{"shield":{"move":2,"damage":15,"range":1,"fortitude":15,"aura":1,"damageBonus":0,"rangeBonus":0,"defenseBonus":9},"archer":{"move":2,"damage":8,"range":3,"fortitude":6,"aura":1,"damageBonus":4,"rangeBonus":0,"defenseBonus":0},"attackLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":3,"damageBonus":4,"rangeBonus":1,"defenseBonus":0},"defenseLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":1,"damageBonus":0,"rangeBonus":0,"defenseBonus":2}},"experiments":{"squareDiagonals":true,"lampShieldBlocking":true,"allyShotsPass":true,"aurasThroughShields":true,"allowPass":false}};
  const before = clone(old), next = updateSavedBalance(old, 5);
  assert.deepEqual(next, DEFAULT_CONFIG); assert.deepEqual(old, before);
  assert.deepEqual(updateSavedBalance(old, BALANCE_REVISION), old);
  assert.deepEqual(validateConfig(old), old);
  const custom = clone(old); custom.stats.shield.damage += 1;
  assert.deepEqual(updateSavedBalance(custom, 5), custom);
});
