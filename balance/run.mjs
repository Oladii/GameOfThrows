import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const argv = Object.fromEntries(process.argv.slice(2).filter(x => x.startsWith('--')).map(x => {
  const i = x.indexOf('='); return i < 0 ? [x.slice(2), 'true'] : [x.slice(2, i), x.slice(i + 1)];
}));
if (!argv.root || !['pilot', 'screen', 'heldout'].includes(argv.stage)) {
  throw new Error('Usage: node prototype/balance/run.mjs --root=outputs/enemy-blocking-2026-11-13 --stage=pilot|screen|heldout --shard=0 --shards=2 [--job=<id>]');
}
const shard = Number(argv.shard ?? 0), shards = Number(argv.shards ?? 2);
if (!Number.isInteger(shards) || shards < 1 || shards > 2 || !Number.isInteger(shard) || shard < 0 || shard >= shards) throw new Error('Use one or two shards, with a valid shard index.');
const root = path.resolve(process.cwd(), argv.root);
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hash = value => sha(Buffer.from(JSON.stringify(value)));
const writeAtomic = (file, value) => {
  const destination = path.join(root, file), temp = `${destination}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temp, destination);
};
const manifest = read('manifest.json'), plan = read('plan.json'), config = read('config.json'), initialTemplate = read('initial.json');
assert.equal(manifest.configHash, hash(config), 'frozen config hash mismatch');
assert.equal(manifest.initialHash, hash(initialTemplate), 'frozen initial hash mismatch');
for (const [variant, files] of Object.entries(manifest.moduleHashes)) for (const [name, expected] of Object.entries(files)) {
  const actual = sha(fs.readFileSync(path.join(root, 'source', variant, name)));
  assert.equal(actual, expected, `frozen source mismatch: ${variant}/${name}`);
}
const manifestHash = hash(manifest), configHash = hash(config), initialHash = hash(initialTemplate);
if (argv.job) {
  const requested = plan.jobs.find(job => job.id === argv.job);
  if (!requested) throw new Error(`Unknown job id: ${argv.job}`);
  if (requested.stage !== argv.stage) throw new Error(`Job ${argv.job} belongs to stage ${requested.stage}, not ${argv.stage}.`);
}
const counters = state => ({
  pieces: [0, 1].map(team => state.pieces.filter(piece => piece.team === team).length),
  combat: [0, 1].map(team => state.pieces.filter(piece => piece.team === team && (piece.type === 'shield' || piece.type === 'archer')).length),
});
const pairedId = id => {
  const match = /^p(\d+)$/.exec(id);
  if (!match) throw new Error(`Relative view cannot rotate unexpected piece id: ${id}`);
  const n = Number(match[1]); return `p${n % 2 ? n + 1 : n - 1}`;
};
const rotatePos = position => ({ q: -position.q || 0, r: -position.r || 0 });
const rotateState = state => ({ ...structuredClone(state), turn: 1 - state.turn,
  winner: state.winner === 0 ? 1 : state.winner === 1 ? 0 : state.winner,
  pieces: state.pieces.map(piece => ({ ...piece, ...rotatePos(piece), id: pairedId(piece.id), team: 1 - piece.team }))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))) });
const rotateAction = action => action.pass ? { pass: true } : { id: pairedId(action.id), to: rotatePos(action.to) };
const apply = (engine, state, configValue, action) => action.pass
  ? engine.pass(state, configValue)
  : engine.move(state, configValue, action.id, action.to);
const combatRecord = report => [...report].map(([id, stats]) => ({ id, ...stats }));
const positionKey = (uiModule, state, configValue) => uiModule.botPositionKey(state, configValue);

function replay(trace, engine, uiModule, inputInitial, inputConfig) {
  let state = engine.clone(inputInitial);
  const repeats = new Map([[positionKey(uiModule, state, inputConfig), 1]]);
  let repeatEvents = 0;
  for (const record of trace.actions) {
    const outcome = apply(engine, state, inputConfig, record.action);
    assert.deepEqual(outcome.deaths, record.deaths, `deaths mismatch at action ${record.index}`);
    assert.deepEqual(combatRecord(outcome.report), record.combat, `combat report mismatch at action ${record.index}`);
    state = outcome.state;
    assert.equal(hash(state), record.stateHash, `state hash mismatch at action ${record.index}`);
    const key = positionKey(uiModule, state, inputConfig), count = (repeats.get(key) ?? 0) + 1;
    repeats.set(key, count);
    if (count >= 3) repeatEvents++;
  }
  assert.deepEqual(state, trace.final, 'replayed final state mismatch');
  assert.equal(state.winner, trace.winner, 'replayed native winner mismatch');
  assert.equal(repeatEvents, trace.repeatEvents, 'repeat-event count mismatch');
  return { state, repeats, repeatEvents };
}

function sameIdentity(saved, job) {
  assert.deepEqual(saved.job, job, `existing result job mismatch: ${job.id}`);
  assert.equal(saved.configHash, configHash, `existing result config mismatch: ${job.id}`);
  assert.equal(saved.initialHash, hash({ ...initialTemplate, turn: job.first }), `existing result initial mismatch: ${job.id}`);
  assert.equal(saved.sourceManifestHash, manifestHash, `existing result source mismatch: ${job.id}`);
}
function status(phase, job, details = {}) {
  writeAtomic(`workers/worker-${shard}.json`, { updatedAt: new Date().toISOString(), pid: process.pid, shard, shards, stage: argv.stage, phase, jobId: job?.id ?? null, ...details });
}
function saveMilestone(file, result, job) {
  if (fs.existsSync(path.join(root, file))) {
    const saved = read(file); sameIdentity(saved, job);
    assert.equal(saved.actionCount, result.actionCount, `milestone count mismatch: ${file}`);
    assert.equal(hash(saved.final), hash(result.final), `milestone state mismatch: ${file}`);
    assert.equal(hash(saved.actions), hash(result.actions), `milestone actions mismatch: ${file}`);
    return;
  }
  writeAtomic(file, { ...result, milestoneActionCount: result.actionCount });
}

for (const variant of ['control', 'enemy-blocking']) {
  const dir = path.join(root, 'source', variant);
  const engine = await import(pathToFileURL(path.join(dir, 'engine.js')).href);
  const rules = await import(pathToFileURL(path.join(dir, 'rules.js')).href);
  const policyModule = await import(pathToFileURL(path.join(dir, 'formation-strategy.mjs')).href);
  const uiModule = await import(pathToFileURL(path.join(dir, 'bot.js')).href);
  assert.equal(hash(engine.validateConfig(engine.clone(rules.DEFAULT_CONFIG))), configHash, `variant config changed: ${variant}`);
  assert.equal(hash(engine.createGame(engine.clone(config))), initialHash, `variant initial changed: ${variant}`);
  const policies = Object.fromEntries(['formation', 'ranged', 'veteran'].map(name => [name, policyModule.createStrategyPolicy(name)]));
  const jobs = plan.jobs.map((job, index) => ({ job, index })).filter(x => x.job.stage === argv.stage && (argv.job || x.index % shards === shard) && x.job.variant === variant && (!argv.job || x.job.id === argv.job));
  for (const { job } of jobs) {
    const gameFile = `games/${job.id}.json`, checkpointFile = `checkpoints/${job.id}.json`;
    const jobInitial = engine.clone(initialTemplate); jobInitial.turn = job.first;
    const jobInitialHash = hash(jobInitial);
    if (fs.existsSync(path.join(root, gameFile))) {
      const saved = read(gameFile); sameIdentity(saved, job);
      replay(saved, engine, uiModule, jobInitial, config);
      console.log(JSON.stringify({ id: job.id, existing: true, actions: saved.actionCount, stop: saved.stop, replayVerified: true }));
      continue;
    }

    let state = engine.clone(jobInitial), history = [engine.clone(jobInitial)], actions = [];
    const repeats = new Map([[positionKey(uiModule, state, config), 1]]);
    let repeatEvents = 0, savedElapsedMs = 0;
    if (fs.existsSync(path.join(root, checkpointFile))) {
      const saved = read(checkpointFile); sameIdentity(saved, job);
      assert.ok(saved.actions.length <= job.limit, `checkpoint exceeds action limit: ${job.id}`);
      assert.equal(saved.actionCount, saved.actions.length, `checkpoint action count mismatch: ${job.id}`);
      const replayed = replay(saved, engine, uiModule, jobInitial, config);
      state = replayed.state; repeats.clear(); for (const [key, count] of replayed.repeats) repeats.set(key, count);
      repeatEvents = replayed.repeatEvents; actions = saved.actions; savedElapsedMs = saved.elapsedMs ?? 0;
      for (const record of actions) {
        const outcome = apply(engine, history.at(-1), config, record.action);
        history.push(engine.clone(outcome.state));
      }
      console.log(JSON.stringify({ id: job.id, resumeFrom: actions.length, replayVerified: true }));
    }

    const started = performance.now();
    let stop = state.winner !== null ? 'engine-terminal' : null;
    while (!stop && actions.length < job.limit) {
      const before = state, beforeCounts = counters(before), last = new Map();
      for (const previous of actions.slice(-40)) if (previous.action.id) last.set(previous.action.id, { from: previous.from, to: previous.action.to });
      const past = history.slice(-41), flipped = job.orientation === 'relative' && state.turn !== 0;
      const view = flipped ? rotateState(state) : state;
      const previousStates = flipped ? past.map(rotateState) : past;
      const lastActions = flipped ? [...last].map(([id, move]) => [pairedId(id), { from: rotatePos(move.from), to: rotatePos(move.to) }]) : [...last];
      const player = job.players[state.turn];
      const policy = player === 'ui' ? uiModule : policies[player];
      if (!policy) throw new Error(`Unknown policy ${player} in ${job.id}`);
      status('choosing', job, { actionCount: actions.length, turn: state.turn, seed: job.seed, depth: job.depth, decisionStartedAt: new Date().toISOString() });
      const decisionStarted = performance.now();
      console.log(JSON.stringify({ event: 'choice-start', job: job.id, actions: actions.length, turn: state.turn }));
      const selected = policy.chooseBotAction(view, config, { depth: job.depth, seed: job.seed, previousStates, lastActions });
      const decisionMs = performance.now() - decisionStarted;
      console.log(JSON.stringify({ event: 'choice-end', job: job.id, actions: actions.length, turn: state.turn, elapsedMs: decisionMs, nodes: selected.stats?.nodes ?? null }));
      if (!selected.action) { stop = 'no-legal-actions'; status('stopped', job, { actionCount: actions.length, stop }); break; }
      if (!Number.isFinite(selected.stats?.score)) throw new Error(`Invalid search score in ${job.id}, action ${actions.length + 1}`);
      const action = flipped ? rotateAction(selected.action) : selected.action;
      const moving = action.pass ? null : before.pieces.find(piece => piece.id === action.id);
      const beforeShieldPromotion = moving ? engine.shieldCanRetreat(moving, config) : false;
      const beforeArcherEdge = moving && engine.archerHasEdgeBonus ? engine.archerHasEdgeBonus(moving, config) : false;
      const outcome = apply(engine, before, config, action);
      state = outcome.state;
      const survivors = new Map([...state.pieces, ...outcome.deaths].map(piece => [piece.id, piece]));
      const afterPiece = moving ? survivors.get(moving.id) : null;
      const promotion = moving && afterPiece ? {
        id: moving.id, team: moving.team, type: moving.type,
        shieldVeteran: !beforeShieldPromotion && engine.shieldCanRetreat(afterPiece, config),
        archerEdge: !beforeArcherEdge && !!engine.archerHasEdgeBonus?.(afterPiece, config),
        survived: state.pieces.some(piece => piece.id === moving.id),
        materialBefore: beforeCounts,
      } : null;
      const record = {
        index: actions.length + 1, team: before.turn, type: moving?.type ?? null,
        from: moving ? { q: moving.q, r: moving.r } : null, action,
        deaths: outcome.deaths, combat: combatRecord(outcome.report), counts: counters(state),
        stateHash: hash(state), selection: { ...selected.stats, decisionElapsedMs: decisionMs }, promotion,
      };
      actions.push(record); history.push(engine.clone(state));
      const posKey = positionKey(uiModule, state, config), count = (repeats.get(posKey) ?? 0) + 1;
      repeats.set(posKey, count); if (count >= 3) repeatEvents++;
      if (state.winner !== null) stop = 'engine-terminal';
      else if (actions.length >= job.limit) stop = 'action-limit';
      status(stop ? 'stopped' : 'running', job, { actionCount: actions.length, turn: state.turn, repeatEvents, stop, decisionElapsedMs: decisionMs });
      if (actions.length % 10 === 0 || stop) {
        const result = {
          job, config, initial: jobInitial, actions, final: state, winner: state.winner,
          stop: stop ?? 'checkpoint', repeatEvents, actionCount: actions.length,
          elapsedMs: savedElapsedMs + performance.now() - started,
          sourceManifestHash: manifestHash, configHash, initialHash: jobInitialHash,
          replayVerified: true,
        };
        replay(result, engine, uiModule, jobInitial, config);
        writeAtomic(checkpointFile, result);
        if (plan.milestoneCheckpoints.includes(actions.length)) saveMilestone(`checkpoints/${job.id}.ply${actions.length}.json`, result, job);
      }
      if (actions.length % 10 === 0) console.log(JSON.stringify({ event: 'heartbeat', job: job.id, actions: actions.length, counts: counters(state), repeatEvents }));
    }
    stop ??= state.winner !== null ? 'engine-terminal' : 'action-limit';
    const result = {
      job, config, initial: jobInitial, actions, final: state, winner: state.winner,
      stop, repeatEvents, actionCount: actions.length,
      elapsedMs: savedElapsedMs + performance.now() - started,
      sourceManifestHash: manifestHash, configHash, initialHash: jobInitialHash,
      replayVerified: false,
    };
    replay(result, engine, uiModule, jobInitial, config);
    result.replayVerified = true;
    if (fs.existsSync(path.join(root, gameFile))) throw new Error(`Refusing to overwrite existing result: ${gameFile}`);
    writeAtomic(gameFile, result);
    console.log(JSON.stringify({ id: job.id, actions: result.actionCount, winner: result.winner, stop, repeatEvents, replayVerified: true, seconds: Math.round(result.elapsedMs / 1000) }));
  }
}
status('complete', null, { completedAt: new Date().toISOString() });
