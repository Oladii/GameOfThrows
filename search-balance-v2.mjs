import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BALANCE_VARIANTS } from './balance-profiles-v2.mjs';
const root = path.resolve('../outputs/balance-search-2026-11-05-v2');
const option = (name, fallback) => process.argv.find(a => a.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const phase = option('phase', 'screen'), games = Number(option('games', phase === 'validation' ? 20 : 10));
const seed = Number(option('seed-base', phase === 'validation' ? 88001 : 53001));
const symmetric = process.argv.includes('--symmetric');
await fs.mkdir(root, { recursive: true });
const frozen = path.join(root, 'source');
if (phase === 'screen') {
  await fs.mkdir(path.join(frozen, 'dist'), { recursive: true });
  for (const file of ['playtest.mjs', 'bot-objective.mjs', 'bot-search.mjs', 'experiment-engine.mjs', 'experiment-profiles.mjs', 'balance-profiles-v2.mjs', 'endgame-tablebase.mjs', 'package.json', 'dist/engine.js', 'dist/rules.js']) await fs.copyFile(file, path.join(frozen, file));
  const source = JSON.parse(await fs.readFile('../outputs/playtest-2026-11-05-shield-promotion-range/config-ui-fields.json', 'utf8'));
  source.fields.auraDefenseCap = -1;
  source.source = 'Accepted balance before search v2. Shield speed remains one, including veterans. Screening 10 paired games with mixed profiles; independent validation uses new seeds and symmetric profiles, all with a 400-ply cap.';
  await fs.writeFile(path.join(root, 'config-ui-fields.json'), JSON.stringify(source, null, 2));
  await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify({ screenGamesPerVariant: 10, screenSeed: 53001, validationGamesPerVariant: 20, validationSeed: 88001, maxPlies: 400, searchDepth: 4, shieldMoveAlwaysOne: true, primary: 'Real annihilation wins; unresolved and draws counted separately.', secondary: ['No-loss tails and winning duration', 'First/second mover results in paired symmetric holdout', 'Preserving the agreed roles and no instant opening casualties'], adoption: 'Prefer a small change only if independent validation improves finish rate or reduces long quiet tails without a material fairness regression. Otherwise retain the current balance.', limitation: 'Bot experiments do not establish human playability or balance.' }, null, 2));
}
const ids = option('variants', '').split(',').filter(Boolean);
const selected = ids.length ? ids : BALANCE_VARIANTS.filter(v => !v.id.startsWith('cap1_')).map(v => v.id);
const jobs = selected.map(id => ({ id, variant: id, bot: option('bot', 'improved') }));
if (phase === 'screen' || process.argv.includes('--include-legacy')) jobs.unshift({ id: 'legacy_control', variant: 'baseline', bot: 'legacy' });
const progress = { phase, gamesPerVariant: games, seed, symmetric, completed: [], running: [], pending: jobs.map(j => j.id) };
const phaseRoot = path.join(root, phase); await fs.mkdir(phaseRoot, { recursive: true });
const save = () => fs.writeFile(path.join(phaseRoot, 'progress.json'), JSON.stringify(progress, null, 2));
await save();
async function work(job) {
  const folder = path.join(phaseRoot, job.id); await fs.mkdir(folder, { recursive: true });
  await fs.copyFile(path.join(root, 'config-ui-fields.json'), path.join(folder, 'config-ui-fields.json'));
  progress.pending = progress.pending.filter(id => id !== job.id); progress.running.push(job.id); await save();
  const args = [path.join(frozen, 'playtest.mjs'), '--suite=balance', '--variant=' + job.variant, '--bot=' + job.bot, '--depth=4', '--max-plies=400', '--games=' + games, '--paired-seeds', '--seed-base=' + seed, '--output=' + folder];
  if (symmetric) args.push('--symmetric');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '', pending = '';
    child.stdout.on('data', chunk => {
      const text = chunk.toString(); stdout += text; pending += text;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        try { const message = JSON.parse(line); if (message.match && message.match % 5 === 0) console.log(JSON.stringify({ phase, variant: job.id, game: message.match, winner: message.winner, plies: message.plies })); } catch {}
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(job.id + ': ' + stderr)));
  });
  await fs.writeFile(path.join(folder, 'run.log'), result.stdout + result.stderr);
  const summary = JSON.parse(await fs.readFile(path.join(folder, 'summary.json'), 'utf8'));
  progress.running = progress.running.filter(id => id !== job.id); progress.completed.push({ id: job.id, summary }); await save();
  console.log(JSON.stringify({ phase, completed: job.id, wins: summary.annihilationWins, unresolved: summary.unresolved, meanPlies: summary.meanPlies }));
}
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, async () => { while (cursor < jobs.length) await work(jobs[cursor++]); }));
await save();
