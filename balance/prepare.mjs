import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = path.resolve(here, '..');
const args = Object.fromEntries(process.argv.slice(2).filter(x => x.startsWith('--')).map(x => {
  const i = x.indexOf('='); return i < 0 ? [x.slice(2), 'true'] : [x.slice(2, i), x.slice(i + 1)];
}));
if (!args.root) throw new Error('Usage: node prototype/balance/prepare.mjs --root=outputs/enemy-blocking-2026-11-13');
const root = path.resolve(process.cwd(), args.root);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(Buffer.from(JSON.stringify(value)));
const sourceNames = ['engine.js', 'rules.js', 'bot.js', 'formation-strategy.mjs', 'defensive-selection.mjs'];
const replaceOnce = (text, before, after) => {
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) throw new Error('Expected exactly one enemy-blocking condition in current engine.');
  return text.slice(0, first) + after + text.slice(first + before.length);
};
if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error(`Refusing to overwrite non-empty output root: ${root}`);
fs.mkdirSync(root, { recursive: true });

const product = path.join(prototype, 'dist');
const productPackage = JSON.parse(fs.readFileSync(path.join(prototype, 'package.json'), 'utf8'));
const ruleModule = await import(pathToFileURL(path.join(product, 'rules.js')).href);
const controlModule = await import(pathToFileURL(path.join(product, 'engine.js')).href);
const config = controlModule.validateConfig(controlModule.clone(ruleModule.DEFAULT_CONFIG));
const initial = controlModule.createGame(controlModule.clone(config));
controlModule.validateState(initial, config);
const sourceBytes = Object.fromEntries(sourceNames.map(name => [name, fs.readFileSync(path.join(product, name))]));
const blockingLine = "if (aura ? p.type === 'shield' : p.team !== a.team && p.type === 'shield' && (a.type !== 'attackLamp' || config.experiments.lampShieldBlocking)) return true;";
const candidateLine = "if (aura ? p.type === 'shield' : p.team !== a.team) return true;";
const productHashes = Object.fromEntries(sourceNames.map(name => [name, sha(sourceBytes[name])]));
const moduleHashes = {};
for (const variant of ['control', 'enemy-blocking']) {
  const dir = path.join(root, 'source', variant);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of sourceNames) {
    let bytes = sourceBytes[name];
    if (variant === 'enemy-blocking' && name === 'engine.js') {
      const patched = replaceOnce(bytes.toString('utf8'), blockingLine, candidateLine);
      bytes = Buffer.from(patched);
    }
    fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
    moduleHashes[variant] ??= {};
    moduleHashes[variant][name] = sha(bytes);
  }
  const packageBytes = Buffer.from(JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'package.json'), packageBytes, { flag: 'wx' });
  moduleHashes[variant]['package.json'] = sha(packageBytes);
}

const configHash = hash(config), initialHash = hash(initial);
const jobs = [];
function addPair(stage, kind, id, shared) {
  for (const variant of ['control', 'enemy-blocking']) jobs.push({
    id: `${id}-${variant}`, pairId: id, stage, variant, kind, ...shared,
    limit: stage === 'pilot' ? 12 : 300,
  });
}
// Two paired, short depth-four pilot games. They estimate runtime and validate
// trace/replay plumbing; the pilot is excluded from all screening summaries.
addPair('pilot', 'ui', 'pilot-ui-seed813000-first0', {
  depth: 4, first: 0, seed: 813000, players: ['ui', 'ui'], orientation: 'fixed',
});
// UI jobs: 2 seeds x 2 first players x depths 2 and 4.
for (const depth of [2, 4]) for (const seed of [813001, 813002]) for (const first of [0, 1]) {
  addPair('screen', 'ui', `ui-d${depth}-seed${seed}-first${first}`, {
    depth, first, seed, players: ['ui', 'ui'], orientation: 'fixed',
  });
}
// Research styles: three pairings x two side assignments x two first players.
for (const [a, b, seed] of [['formation', 'ranged', 813101], ['formation', 'veteran', 813102], ['ranged', 'veteran', 813103]]) {
  for (const swap of [0, 1]) for (const first of [0, 1]) {
    const players = swap ? [b, a] : [a, b];
    addPair('screen', 'style', `style-${a}-${b}-swap${swap}-first${first}`, {
      depth: 4, first, seed, players, orientation: 'relative',
    });
  }
}
// Held-out UI is frozen independently from screening, at depth four only.
for (const seed of [913001, 913002]) for (const first of [0, 1]) {
  addPair('heldout', 'ui', `ui-d4-seed${seed}-first${first}`, {
    depth: 4, first, seed, players: ['ui', 'ui'], orientation: 'fixed',
  });
}

fs.writeFileSync(path.join(root, 'initial.json'), JSON.stringify(initial, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify({
  createdAt: new Date().toISOString(), status: 'predeclared-before-games',
  question: 'Does any enemy piece block a shot while allied pieces let it pass, with the current aura rules unchanged?',
  variants: ['control', 'enemy-blocking'],
  source: 'prototype/dist frozen into variant-specific module trees; only the candidate blocked() enemy-piece predicate differs',
  jobs, maxWorkers: 2, checkpointEveryActions: 10,
  milestoneCheckpoints: [120, 300],
  conditionalExtension: { maxGames: 1, actionLimit: 600, defaultEnabled: false, requireExplicitQuestion: true, keepSameSeedAndPolicy: true },
  actionLimit: 300, repetition: 'logged only; never a forced draw',
  nativeOutcomes: 'only the winner supplied by the engine is a win/loss; no-legal-actions and action-limit are stops',
  pilot: '2 paired depth-4 games, 12 actions each; excluded from screening and held-out summaries',
  screening: '40 total jobs: 16 UI and 24 style; exact control/candidate pairs share seed, side, first player, depth, orientation and limit',
  heldout: '8 total UI depth-4 jobs; two new seeds x both first players x both variants; do not tune on this stage',
  sourceSnapshotFiles: sourceNames.concat('package.json'),
}, null, 2) + '\n', { flag: 'wx' });
const manifest = {
  createdAt: new Date().toISOString(), version: productPackage.version,
  productDist: product, productHashes, moduleHashes,
  configHash, initialHash, configAndInitialIdenticalAcrossVariants: true,
  candidateDiff: { file: 'engine.js', before: blockingLine, after: candidateLine, scope: 'non-aura shot blockers only; aura clause and ally clause unchanged' },
  sourceFiles: sourceNames.concat('package.json'),
  preparationCommand: `node ${path.relative(process.cwd(), path.join(here, 'prepare.mjs'))} --root=${path.relative(process.cwd(), root)}`,
  node: process.version,
};
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ root, version: manifest.version, jobs: { pilot: 2, screen: 40, heldout: 8 }, configHash, initialHash, moduleHashes }, null, 2));
