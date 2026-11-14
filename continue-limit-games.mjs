import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { clone, move, shieldCanRetreat } from '../outputs/playtest-2026-11-05-shield-promotion-range/engine-snapshot/engine.js';
const run = promisify(execFile);
const oldRoot = '../outputs/playtest-2026-11-05-shield-promotion-range';
const root = '../outputs/diagnostics-2026-11-05-five-limit-games/continuations';
const data = JSON.parse(await fs.readFile(oldRoot + '/matches.json', 'utf8'));
const source = JSON.parse(await fs.readFile(oldRoot + '/config-ui-fields.json', 'utf8'));
const key = s => `${s.turn}|${s.pieces.map(p => `${p.team}:${p.type}:${p.q},${p.r}:${shieldCanRetreat(p, data.protocol.config) ? 1 : 0}`).sort().join('|')}`;
await fs.mkdir(root, { recursive: true });
await Promise.all(data.matches.filter(m => m.stop === 'ply_limit').map(async match => {
  const folder = root + '/match-' + String(match.match).padStart(2, '0');
  await fs.mkdir(folder, { recursive: true });
  let state = clone(match.initialState);
  const seen = new Map([[key(state), 1]]), lastActions = new Map();
  for (const record of match.moves) {
    state = move(state, data.protocol.config, record.id, record.to).state;
    seen.set(key(state), (seen.get(key(state)) ?? 0) + 1);
    lastActions.set(record.id, { ...record, type: record.type, from: record.from, to: record.to });
  }
  assert.deepEqual(state, match.finalState);
  await fs.writeFile(folder + '/resume.json', JSON.stringify({ match: match.match, state, seen: [...seen], lastActions: [...lastActions] }, null, 2));
  await fs.writeFile(folder + '/config-ui-fields.json', JSON.stringify({ ...source, source: 'Diagnostic continuation of original match ' + match.match + ' from ply 200; same rules, seed, profiles and full search history; move cap extended to 400.' }, null, 2));
  const result = await run(process.execPath, ['playtest.mjs', '--depth=4', '--symmetric', '--paired-seeds', '--seed-base=29001', '--max-plies=400', '--resume=' + folder + '/resume.json', '--output=' + folder], { maxBuffer: 1024 * 1024 });
  await fs.writeFile(folder + '/run.log', result.stdout);
  const continued = JSON.parse(await fs.readFile(folder + '/matches.json', 'utf8')).matches[0];
  assert.deepEqual(continued.initialState, match.finalState); assert.equal(continued.seed, match.seed); assert.deepEqual(continued.profileKeys, match.profileKeys);
  console.log(JSON.stringify({ match: match.match, finalPly: continued.finalPly, winner: continued.winner, stop: continued.stop, remaining: [0, 1].map(team => continued.finalState.pieces.filter(p => p.team === team).length) }));
}));
