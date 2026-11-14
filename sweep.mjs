import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { VARIANTS } from './experiment-profiles.mjs';

const root = path.resolve('../outputs/playtest-2026-11-05-depth4');
const source = JSON.parse(await fs.readFile('../outputs/playtest-2026-11-05-banner-move-1/config-ui-fields.json', 'utf8'));
await fs.mkdir(root, { recursive: true });
await fs.writeFile(path.join(root, 'plan.json'), JSON.stringify({ gamesPerVariant: 10, depth: 4, maxPlies: 200, variants: VARIANTS, source }, null, 2));
const completed = [], running = new Set();
let statusWrite = Promise.resolve();
const status = () => {
  const snapshot = JSON.stringify({ completed, running: [...running] }, null, 2);
  statusWrite = statusWrite.then(() => fs.writeFile(path.join(root, 'status.json'), snapshot));
  return statusWrite;
};
let next = 0;
async function worker() {
  while (next < VARIANTS.length) {
    const variant = VARIANTS[next++], output = path.join(root, variant.id);
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'config-ui-fields.json'), JSON.stringify(source, null, 2));
    running.add(variant.id); await status();
    console.log(JSON.stringify({ started: variant.id }));
    const child = spawn(process.execPath, ['playtest.mjs', '--variant=' + variant.id, '--depth=4', '--output=' + output], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '', buffer = '', error = '';
    child.stdout.on('data', data => {
      const chunk = data.toString(); log += chunk; buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { const result = JSON.parse(line); if (result.match) console.log(JSON.stringify({ variant: variant.id, ...result })); } catch {}
      }
    });
    child.stderr.on('data', data => { error += data.toString(); });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    await fs.writeFile(path.join(output, 'run.log'), log + error);
    if (code !== 0) throw new Error(variant.id + ' failed: ' + error);
    const summary = JSON.parse(await fs.readFile(path.join(output, 'summary.json'), 'utf8'));
    completed.push({ id: variant.id, summary }); running.delete(variant.id); await status();
    console.log(JSON.stringify({ completed: variant.id, summary }));
  }
}
await Promise.all([worker(), worker(), worker()]);
await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify(completed, null, 2));
console.log(JSON.stringify({ done: true, variants: completed.length, matches: completed.reduce((n, v) => n + v.summary.matches, 0) }));
