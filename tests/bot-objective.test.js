import test from 'node:test';
import assert from 'node:assert/strict';
import { botOutcomeScore } from '../bot-objective.mjs';

test('bots value a draw and the test move cap as losses; a victory at the cap still wins', () => {
  for (const team of [0, 1]) {
    const loss = botOutcomeScore({ winner: 1 - team, ply: 100 }, team, 200);
    assert.equal(botOutcomeScore({ winner: 'draw', ply: 100 }, team, 200), loss);
    assert.ok(loss < 0);
    assert.equal(botOutcomeScore({ winner: null, ply: 100 }, team, 200, true), loss);
    assert.equal(botOutcomeScore({ winner: null, ply: 200 }, team, 200), botOutcomeScore({ winner: 1 - team, ply: 200 }, team, 200));
    assert.ok(botOutcomeScore({ winner: team, ply: 200 }, team, 200) > 0);
    assert.equal(botOutcomeScore({ winner: null, ply: 199 }, team, 200), null);
  }
});
