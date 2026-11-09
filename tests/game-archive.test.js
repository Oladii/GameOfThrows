import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRecorder } from '../dist/game-archive.js';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { createGame, validateConfig, validateState } from '../dist/engine.js';

const archiveCopy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
class ArchiveTestStorage {
  games = new Map();
  playerId = null;
  async getOrCreatePlayerId(createId) { return this.playerId ||= createId(); }
  async get(id) { return archiveCopy(this.games.get(id)); }
  async put(value) { this.games.set(value.id, archiveCopy(value)); }
  async list() { return archiveCopy([...this.games.values()]); }
  async update(id, change) {
    const result = change(archiveCopy(this.games.get(id)));
    if (result) this.games.set(id, archiveCopy(result));
    return archiveCopy(result);
  }
}
class ArchiveTestSession {
  values = new Map();
  getItem(id) { return this.values.get(id) ?? null; }
  setItem(id, value) { this.values.set(id, String(value)); }
}
const archiveFixture = (ply = 0, winner = null) => ({
  config: { ...archiveCopy(DEFAULT_CONFIG), size: 5 },
  state: { pieces: [{ id: 'shield-1', type: 'shield', team: 0, q: 1, r: 0 }], turn: ply % 2, ply, winner },
  mode: 'bot', humanTeam: 1, firstMove: 'south'
});
function archiveHarness(overrides = {}) {
  let serial = 0;
  const storage = overrides.storage || new ArchiveTestStorage();
  const sessionStorage = overrides.sessionStorage || new ArchiveTestSession();
  return {
    storage, sessionStorage,
    options: {
      enabled: true, endpoint: 'https://archive.example.test/', app: { version: '0.1.2', build: 'test-build', channel: 'site' },
      storage, sessionStorage, autoFlush: false, BroadcastChannel: false,
      uuid: () => `11111111-1111-4111-8111-${String(++serial).padStart(12, '0')}`,
      randomBytes: () => new Uint8Array(32).fill(23), clock: () => '2026-11-05T08:00:00.000Z', ...overrides
    }
  };
}
function archiveServer() {
  const games = new Map(), requests = [];
  const server = { games, requests, offline: false, loseCreateAck: false, loseEventAck: false, onRequest: null };
  server.fetch = async (url, request) => {
    const body = JSON.parse(request.body), authorization = request.headers.Authorization;
    requests.push({ url, body: archiveCopy(body), rawBody: request.body, authorization });
    if (server.offline) throw new Error('offline');
    await server.onRequest?.(url, body);
    const response = (status, value) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
    if (url.endsWith('/api/games')) {
      let game = games.get(body.id);
      if (game && game.authorization !== authorization) return response(401, { code: 'unauthorized' });
      if (!game) { game = { authorization, create: archiveCopy(body), events: [], lastSeq: 0 }; games.set(body.id, game); }
      if (server.loseCreateAck) { server.loseCreateAck = false; throw new Error('lost create response'); }
      return response(201, { id: body.id, lastSeq: game.lastSeq, status: 'active' });
    }
    const id = url.match(/\/api\/games\/([^/]+)\/events$/)?.[1], game = games.get(id);
    if (!game || game.authorization !== authorization) return response(401, { code: 'unauthorized' });
    assert.ok(body.events.length <= 32);
    assert.ok(Buffer.byteLength(request.body) <= 256 * 1024);
    for (const event of body.events) {
      assert.ok(Buffer.byteLength(JSON.stringify(event)) <= 64 * 1024);
      if (event.seq <= game.lastSeq) assert.deepEqual(event, game.events[event.seq - 1]);
      else {
        if (event.seq !== game.lastSeq + 1) return response(409, { code: 'sequence_gap' });
        game.events.push(archiveCopy(event)); game.lastSeq = event.seq;
      }
    }
    if (server.loseEventAck) { server.loseEventAck = false; throw new Error('lost events response'); }
    return response(200, { id, lastSeq: game.lastSeq, acceptedThrough: game.lastSeq, status: 'active' });
  };
  return server;
}
const archiveWaitFor = async predicate => {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('archive condition did not settle');
};

test('disabled recorder never touches storage, session, network, or the game save key', async () => {
  const fail = () => assert.fail('disabled recorder performed I/O');
  const recorder = new GameRecorder({ enabled: false, storage: new Proxy({}, { get: fail }), playerStorage: new Proxy({}, { get: fail }), sessionStorage: new Proxy({}, { get: fail }), fetch: fail });
  assert.equal(await recorder.start(archiveFixture()), false);
  assert.equal(await recorder.resume(archiveFixture()), false);
  assert.equal(await recorder.record('move', archiveFixture(1)), false);
  assert.equal((await recorder.flush()).state, 'disabled');
  recorder.close();
});

test('snapshots are captured before asynchronous work and status never exposes the write key', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options), initial = archiveFixture();
  const start = recorder.start(initial);
  initial.config.size = 999; initial.state.pieces[0].q = 999;
  await start;
  const next = archiveFixture(1);
  next.action = { id: 'shield-1', from: { q: 1, r: 0 }, to: { q: 2, r: 0 } };
  next.username = 'must not appear';
  const record = recorder.record('move', next);
  next.action.to.q = 999; next.state.ply = 999;
  await record;
  await recorder.flush();
  const game = [...server.games.values()][0];
  assert.equal(game.create.initial.config.size, 5);
  assert.equal(game.create.initial.state.pieces[0].q, 1);
  assert.equal(game.events[0].payload.state.ply, 1);
  assert.equal(game.events[0].payload.action.to.q, 2);
  assert.equal(game.events[0].payload.username, undefined);
  assert.match(game.authorization, /^Bearer [0-9a-f]{64}$/);
  assert.equal(JSON.stringify(recorder.status).includes(game.authorization.slice(7)), false);
  assert.equal(JSON.stringify(server.requests.map(request => request.body)).includes('writeKey'), false);
  assert.equal([...harness.sessionStorage.values.keys()].includes('lamps-prototype-v1'), false);
  assert.deepEqual([...harness.sessionStorage.values.keys()], ['game-of-throws-archive-tab-v1']);
  assert.equal(recorder.status.state, 'saved');
  recorder.close();
});

test('offline queue survives reload, keeps its game identity, and sends the complete sequence', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  server.offline = true;
  const first = new GameRecorder(harness.options);
  await first.start(archiveFixture());
  await first.record('move', archiveFixture(1));
  await first.record('pass', archiveFixture(2));
  const id = first.status.gameId;
  await first.flush();
  assert.equal(first.status.state, 'error');
  assert.equal(first.status.pending, 3);
  first.close();
  const reloaded = new GameRecorder(harness.options);
  await reloaded.resume(archiveFixture(2));
  assert.equal(reloaded.status.gameId, id);
  assert.equal((await harness.storage.list()).length, 1);
  server.offline = false;
  await reloaded.flush();
  assert.deepEqual(server.games.get(id).events.map(event => [event.seq, event.type]), [[1, 'move'], [2, 'pass']]);
  assert.equal(reloaded.status.pending, 0);
  assert.equal(reloaded.status.gameStatus, 'active');
  reloaded.close();
});

test('lost create acknowledgement retries idempotently with the original credentials', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture());
  await recorder.record('move', archiveFixture(1));
  server.loseCreateAck = true;
  await recorder.flush();
  assert.equal(recorder.status.pending, 2);
  await recorder.flush();
  assert.equal(server.games.size, 1);
  const creates = server.requests.filter(request => request.url.endsWith('/api/games'));
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0], creates[1]);
  assert.equal([...server.games.values()][0].events.length, 1);
  assert.equal(recorder.status.pending, 0);
  recorder.close();
});

test('lost event acknowledgement retains and safely resends an identical event', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture());
  await recorder.record('move', archiveFixture(1));
  server.loseEventAck = true;
  await recorder.flush();
  assert.equal(recorder.status.pending, 1);
  await recorder.flush();
  const requests = server.requests.filter(request => request.url.endsWith('/events'));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].body, requests[1].body);
  assert.equal([...server.games.values()][0].events.length, 1);
  assert.equal(recorder.status.state, 'saved');
  recorder.close();
});

test('a move persisted during an in-flight request is not removed by its older ACK', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture()); await recorder.flush();
  await recorder.record('move', archiveFixture(1));
  let release, entered = false;
  server.onRequest = async url => {
    if (url.endsWith('/events') && !entered) { entered = true; await new Promise(resolve => { release = resolve; }); }
  };
  const sending = recorder.flush();
  await archiveWaitFor(() => entered);
  await recorder.record('pass', archiveFixture(2));
  release(); await sending;
  assert.deepEqual([...server.games.values()][0].events.map(event => event.seq), [1, 2]);
  assert.equal(recorder.status.pending, 0);
  recorder.close();
});

test('draining another tab queue uses atomic updates and preserves concurrently added events', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const owner = new GameRecorder(harness.options);
  await owner.start(archiveFixture()); await owner.flush();
  await owner.record('move', archiveFixture(1));
  const drainer = new GameRecorder({ ...harness.options, sessionStorage: new ArchiveTestSession() });
  let release, entered = false;
  server.onRequest = async url => {
    if (url.endsWith('/events') && !entered) { entered = true; await new Promise(resolve => { release = resolve; }); }
  };
  const draining = drainer.flush();
  await archiveWaitFor(() => entered);
  await owner.record('pass', archiveFixture(2));
  release(); await draining;
  assert.deepEqual([...server.games.values()][0].events.map(event => event.seq), [1, 2]);
  assert.equal((await harness.storage.list())[0].nextSeq, 3);
  owner.close(); drainer.close();
});

test('event batches obey count and encoded byte limits without sequence gaps', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture());
  for (let ply = 1; ply <= 70; ply++) await recorder.record('move', archiveFixture(ply));
  await recorder.flush();
  assert.deepEqual(server.requests.filter(request => request.url.endsWith('/events')).map(request => request.body.events.length), [32, 32, 6]);
  const large = archiveFixture(71);
  large.state.pieces = Array.from({ length: 350 }, (_, index) => ({ id: `shield-${String(index).padStart(4, '0')}-${'a'.repeat(35)}`, type: 'shield', team: index % 2, q: index, r: 0 }));
  for (let ply = 71; ply <= 81; ply++) { large.state.ply = ply; await recorder.record('config', large); }
  await recorder.flush();
  assert.equal([...server.games.values()][0].events.length, 81);
  assert.equal(recorder.status.pending, 0);
  recorder.close();
});

test('oversized events stay visible as an error without consuming a sequence number', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture());
  const large = archiveFixture(1);
  large.state.pieces = Array.from({ length: 900 }, (_, index) => ({ id: `shield-${String(index).padStart(4, '0')}-${'a'.repeat(35)}`, type: 'shield', team: index % 2, q: index, r: 0 }));
  assert.equal(await recorder.record('move', large), false);
  assert.equal(recorder.status.message, 'event_too_large');
  assert.equal((await harness.storage.list())[0].nextSeq, 1);
  await recorder.record('move', archiveFixture(1)); await recorder.flush();
  assert.equal([...server.games.values()][0].events[0].seq, 1);
  recorder.close();
});

test('independent sessions sharing durable storage keep separate game IDs and sequences', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const first = new GameRecorder(harness.options);
  const second = new GameRecorder({ ...harness.options, sessionStorage: new ArchiveTestSession() });
  await Promise.all([first.start(archiveFixture()), second.start(archiveFixture())]);
  assert.notEqual(first.status.gameId, second.status.gameId);
  await Promise.all([first.record('move', archiveFixture(1)), second.record('pass', archiveFixture(1))]);
  await Promise.all([first.flush(), second.flush()]);
  assert.equal(server.games.size, 2);
  for (const game of server.games.values()) assert.deepEqual(game.events.map(event => event.seq), [1]);
  first.close(); second.close();
});

test('a duplicated live tab forks a copied session identity while a reload resumes it', async () => {
  class TestChannel {
    static channels = new Set();
    constructor() { TestChannel.channels.add(this); }
    postMessage(data) { for (const channel of TestChannel.channels) if (channel !== this) queueMicrotask(() => channel.onmessage?.({ data })); }
    close() { TestChannel.channels.delete(this); }
  }
  const harness = archiveHarness({ BroadcastChannel: TestChannel, tabProbeMs: 5 });
  const original = new GameRecorder(harness.options);
  await original.start(archiveFixture());
  const originalId = original.status.gameId;
  const copiedSession = new ArchiveTestSession(); copiedSession.values = new Map(harness.sessionStorage.values);
  const duplicate = new GameRecorder({ ...harness.options, sessionStorage: copiedSession });
  await duplicate.resume(archiveFixture());
  assert.notEqual(duplicate.status.gameId, originalId);
  assert.equal((await harness.storage.get(originalId)).gameStatus, 'active');
  original.close();
  const reloaded = new GameRecorder(harness.options);
  await reloaded.resume(archiveFixture());
  assert.equal(reloaded.status.gameId, originalId);
  assert.equal((await harness.storage.list()).length, 2);
  duplicate.close(); reloaded.close();
});

test('finish survives reload, undo reopens the same game, and a new game abandons it', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  let recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture());
  await recorder.record('finish', { ...archiveFixture(1, 1), outcome: 1 });
  const id = recorder.status.gameId;
  assert.equal(recorder.status.gameStatus, 'finished');
  await recorder.flush(); recorder.close();
  recorder = new GameRecorder(harness.options);
  await recorder.resume(archiveFixture(1, 1));
  assert.equal(recorder.status.gameStatus, 'finished');
  assert.equal(recorder.status.pending, 0);
  await recorder.record('undo', archiveFixture());
  assert.equal(recorder.status.gameId, id);
  assert.equal(recorder.status.gameStatus, 'active');
  await recorder.start(archiveFixture());
  assert.notEqual(recorder.status.gameId, id);
  await recorder.flush();
  assert.deepEqual(server.games.get(id).events.map(event => event.type), ['finish', 'undo', 'abandon']);
  assert.deepEqual(server.games.get(id).events[0].payload.outcome, { winner: 1 });
  assert.equal((await harness.storage.get(id)).gameStatus, 'abandoned');
  recorder.close();
});

test('resuming an already won game starts finished, retains bot settings, and is not abandoned later', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options);
  await recorder.resume({ ...archiveFixture(12, 0), botDepth: 4 });
  const id = recorder.status.gameId;
  assert.equal(recorder.status.gameStatus, 'finished');
  await recorder.start(archiveFixture());
  await recorder.flush();
  assert.equal(server.games.get(id).create.startReason, 'resume');
  assert.equal(server.games.get(id).create.game.botDepth, 4);
  assert.equal(server.games.get(id).events.length, 0);
  assert.equal((await harness.storage.get(id)).gameStatus, 'finished');
  recorder.close();
});

test('resume reconciles a position saved before its archive write with a full restore snapshot', async () => {
  const harness = archiveHarness();
  const first = new GameRecorder(harness.options);
  await first.start(archiveFixture()); first.close();
  const second = new GameRecorder(harness.options);
  await second.resume(archiveFixture(1));
  const [game] = await harness.storage.list();
  assert.deepEqual(game.events.map(event => [event.seq, event.type, event.payload.state.ply]), [[1, 'restore', 1]]);
  assert.deepEqual(game.events[0].payload.config, archiveFixture().config);
  second.close();
});

test('automatic retry drains offline work without blocking gameplay or requiring another move', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch, autoFlush: true, retryBaseMs: 5 });
  server.offline = true;
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture());
  await recorder.record('move', archiveFixture(1));
  await archiveWaitFor(() => recorder.status.state === 'error');
  server.offline = false;
  await archiveWaitFor(() => recorder.status.state === 'saved' && recorder.status.pending === 0);
  assert.deepEqual([...server.games.values()][0].events.map(event => event.seq), [1]);
  recorder.close();
});

test('invalid acknowledgements and rejected writes preserve the durable queue', async () => {
  const harness = archiveHarness({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ lastSeq: 999 }) }) });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture()); await recorder.record('pass', archiveFixture(1));
  await recorder.flush();
  assert.equal(recorder.status.message, 'sequence_conflict');
  assert.equal(recorder.status.pending, 2);
  assert.equal(recorder.status.failed, 1);
  assert.equal((await harness.storage.list())[0].events.length, 1);
  recorder.close();
  const deniedHarness = archiveHarness({ fetch: async () => ({ ok: false, status: 401 }) });
  const denied = new GameRecorder(deniedHarness.options);
  await denied.start(archiveFixture()); await denied.record('pass', archiveFixture(1)); await denied.flush();
  assert.equal(denied.status.message, 'request_rejected');
  assert.equal(denied.status.pending, 2);
  assert.equal(denied.status.failed, 1);
  denied.close();
});

test('archive projects imported version 1 fields at every schema level without changing the game or export', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const originalConfig = archiveCopy(DEFAULT_CONFIG);
  originalConfig.annotation = 'private import annotation';
  originalConfig.army.annotation = 'army annotation';
  originalConfig.stats.annotation = { custom: 12 };
  originalConfig.stats.shield.annotation = 'piece stat annotation';
  originalConfig.experiments.annotation = 'switch annotation';
  originalConfig.shieldPromotion.annotation = 'promotion annotation';
  const config = validateConfig(originalConfig);
  const originalState = createGame(config);
  originalState.annotation = 'state annotation';
  originalState.pieces[0].annotation = 'piece annotation';
  const state = validateState(originalState, config);
  assert.equal(config.annotation, 'private import annotation');
  assert.equal(state.pieces[0].annotation, 'piece annotation');
  const before = JSON.stringify({ config, state });
  const recorder = new GameRecorder(harness.options);
  await recorder.start({ ...archiveFixture(), config, state });
  const death = { ...state.pieces[0], incoming: 8, fortitude: 3, annotation: 'death annotation' };
  const payload = { config, state, deaths: [death] }, eventBefore = JSON.stringify(payload);
  for (const type of ['move', 'pass', 'config', 'undo', 'restore']) await recorder.record(type, payload);
  await recorder.flush();
  const [game] = server.games.values();
  assert.deepEqual(game.create.initial.config, DEFAULT_CONFIG);
  const expectedState = archiveCopy(state); delete expectedState.annotation; delete expectedState.pieces[0].annotation;
  assert.deepEqual(game.create.initial.state, expectedState);
  const expectedDeath = { ...expectedState.pieces[0], incoming: 8, fortitude: 3 };
  for (const event of game.events) {
    assert.deepEqual(event.payload.config, DEFAULT_CONFIG);
    assert.deepEqual(event.payload.state, expectedState);
    assert.deepEqual(event.payload.deaths, [expectedDeath]);
  }
  assert.equal(JSON.stringify({ config, state }), before);
  assert.equal(JSON.stringify(payload), eventBefore);
  assert.equal(JSON.stringify(server.requests.map(request => request.body)).includes('annotation'), false);
  recorder.close();
});

test('archive keeps optional fields absent and preserves every present game value', async () => {
  const harness = archiveHarness(), recorder = new GameRecorder(harness.options);
  const initial = archiveFixture();
  delete initial.config.auraDefenseCap; delete initial.config.shieldPromotion;
  delete initial.config.victoryCondition; delete initial.config.deploymentOffset;
  delete initial.state.pieces[0].group; delete initial.state.pieces[0].reachedFarEdge;
  const before = JSON.stringify(initial);
  await recorder.start(initial);
  const [game] = await harness.storage.list();
  assert.deepEqual(game.create.initial.config, initial.config);
  assert.deepEqual(game.create.initial.state, initial.state);
  assert.equal(Object.hasOwn(game.create.initial.config, 'shieldPromotion'), false);
  assert.equal(Object.hasOwn(game.create.initial.config, 'victoryCondition'), false);
  assert.equal(Object.hasOwn(game.create.initial.config, 'deploymentOffset'), false);
  assert.equal(Object.hasOwn(game.create.initial.state.pieces[0], 'reachedFarEdge'), false);
  assert.equal(JSON.stringify(initial), before);
  recorder.close();
});

test('archive retains selected balance fields in initial and event snapshots and projects ally annotations', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const recorder = new GameRecorder(harness.options), initial = archiveFixture();
  initial.config.victoryCondition = 'combat-units';
  initial.config.deploymentOffset = 1;
  initial.config.shieldPromotion.allies = { aura: 1, damageBonus: 3, defenseBonus: 6, rangeBonus: 1 };
  const expectedConfig = archiveCopy(initial.config);
  initial.config.shieldPromotion.allies.annotation = 'private ally annotation';
  const before = JSON.stringify(initial);
  await recorder.start(initial);
  await recorder.record('config', { config: initial.config, state: archiveFixture(1).state });
  // An explicit legacy mode/offset is also a value, not a signal to omit it.
  const changedConfig = { ...archiveCopy(expectedConfig), victoryCondition: 'all-units', deploymentOffset: 0 };
  await recorder.record('config', { config: changedConfig, state: archiveFixture(2).state });
  await recorder.flush();
  const [game] = server.games.values();
  assert.deepEqual(game.create.initial.config, expectedConfig);
  assert.deepEqual(game.events[0].payload.config, expectedConfig);
  assert.deepEqual(game.events[1].payload.config, changedConfig);
  assert.equal(JSON.stringify(initial), before);
  assert.equal(JSON.stringify(server.requests.map(request => request.body)).includes('annotation'), false);
  recorder.close();
});

test('permanent create failures stay durable and never block later games, including after reload', async () => {
  for (const status of [400, 401, 403, 413]) {
    const server = archiveServer(); let rejectedId, rejectedRequests = 0;
    const harness = archiveHarness({ fetch: async (url, request) => {
      const body = JSON.parse(request.body);
      if (url.endsWith('/api/games') && body.id === rejectedId) { rejectedRequests++; return { ok: false, status }; }
      return server.fetch(url, request);
    } });
    let recorder = new GameRecorder(harness.options);
    await recorder.start(archiveFixture()); rejectedId = recorder.status.gameId;
    await recorder.record('move', archiveFixture(1));
    await recorder.start(archiveFixture()); const secondId = recorder.status.gameId;
    await recorder.record('pass', archiveFixture(1)); await recorder.flush();
    assert.equal(rejectedRequests, 1);
    assert.equal(server.games.get(secondId).events[0].type, 'pass');
    assert.equal(recorder.status.failed, 1);
    assert.equal(recorder.status.state, 'error');
    assert.equal(recorder.status.message, 'request_rejected');
    const rejected = await harness.storage.get(rejectedId);
    assert.equal(rejected.blocked.httpStatus, status);
    assert.deepEqual(rejected.events.map(event => event.type), ['move', 'abandon']);
    assert.equal(recorder.status.pending, 3);
    assert.equal(rejected.create.initial.state.ply, 0);
    assert.match(rejected.writeKey, /^[a-f0-9]{64}$/);
    recorder.close();
    recorder = new GameRecorder(harness.options);
    await recorder.resume(archiveFixture(1)); await recorder.flush();
    assert.equal(rejectedRequests, 1);
    assert.equal(recorder.status.failed, 1);
    assert.equal(recorder.status.state, 'error');
    assert.equal((await harness.storage.list()).length, 2);
    recorder.close();
  }
});

test('a permanent per-game event quota failure keeps its events and allows the next game to save', async () => {
  const server = archiveServer(); let limitedId;
  const harness = archiveHarness({ fetch: async (url, request) => {
    if (url.endsWith(`/api/games/${limitedId}/events`)) return { ok: false, status: 413 };
    return server.fetch(url, request);
  } });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture()); limitedId = recorder.status.gameId;
  await recorder.record('move', archiveFixture(1)); await recorder.start(archiveFixture());
  const secondId = recorder.status.gameId;
  await recorder.record('pass', archiveFixture(1)); await recorder.flush();
  const limited = await harness.storage.get(limitedId);
  assert.equal(limited.created, true);
  assert.equal(limited.blocked.httpStatus, 413);
  assert.deepEqual(limited.events.map(event => event.seq), [1, 2]);
  assert.equal(server.games.get(secondId).events.length, 1);
  assert.equal(recorder.status.failed, 1);
  assert.equal(recorder.status.pending, 2);
  recorder.close();
});

test('temporary per-game rate limits do not block other games and remain retryable', async () => {
  for (const status of [429, 503]) {
    const server = archiveServer(); let limitedId, limited = true;
    const harness = archiveHarness({ fetch: async (url, request) => {
      if (limited && url.endsWith(`/api/games/${limitedId}/events`)) return { ok: false, status };
      return server.fetch(url, request);
    } });
    const recorder = new GameRecorder(harness.options);
    await recorder.start(archiveFixture()); limitedId = recorder.status.gameId;
    await recorder.record('move', archiveFixture(1)); await recorder.start(archiveFixture());
    const secondId = recorder.status.gameId;
    await recorder.record('pass', archiveFixture(1)); await recorder.flush();
    assert.equal(server.games.get(secondId).events.length, 1);
    assert.equal((await harness.storage.get(limitedId)).blocked, undefined);
    assert.equal((await harness.storage.get(limitedId)).lastFailure.httpStatus, status);
    assert.equal(recorder.status.failed, 0);
    assert.equal(recorder.status.state, 'error');
    limited = false; await recorder.flush();
    assert.deepEqual(server.games.get(limitedId).events.map(event => event.seq), [1, 2]);
    assert.equal(recorder.status.pending, 0);
    assert.equal(recorder.status.state, 'saved');
    assert.equal((await harness.storage.get(limitedId)).lastFailure, undefined);
    recorder.close();
  }
});

test('one anonymous browser ID is reused across games, reloads and simultaneous independent tabs', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const first = new GameRecorder(harness.options);
  const second = new GameRecorder({ ...harness.options, sessionStorage: new ArchiveTestSession() });
  const input = archiveFixture(), before = JSON.stringify(input);
  // An imported field cannot replace this browser's generated identity.
  input.playerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await Promise.all([first.start(input), second.start(archiveFixture())]);
  const firstId = first.status.gameId;
  assert.notEqual(firstId, second.status.gameId);
  const playerId = (await harness.storage.get(firstId)).create.playerId;
  assert.match(playerId, /^[0-9a-f-]{36}$/);
  assert.notEqual(playerId, input.playerId);
  assert.notEqual(playerId, firstId);
  assert.equal((await harness.storage.get(second.status.gameId)).create.playerId, playerId);
  await first.start(archiveFixture());
  assert.equal((await harness.storage.get(first.status.gameId)).create.playerId, playerId);
  first.close();
  const reloaded = new GameRecorder(harness.options);
  await reloaded.resume(archiveFixture()); await reloaded.start(archiveFixture());
  assert.equal((await harness.storage.get(reloaded.status.gameId)).create.playerId, playerId);
  await Promise.all([reloaded.flush(), second.flush()]);
  for (const game of server.games.values()) assert.equal(game.create.playerId, playerId);
  delete input.playerId;
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(reloaded.status).includes(playerId), false);
  assert.equal(JSON.stringify([...harness.sessionStorage.values]).includes(playerId), false);
  second.close(); reloaded.close();
});

test('a different browser store receives a different anonymous ID', async () => {
  const firstHarness = archiveHarness();
  const secondHarness = archiveHarness({ uuid: firstHarness.options.uuid });
  const first = new GameRecorder(firstHarness.options), second = new GameRecorder(secondHarness.options);
  await Promise.all([first.start(archiveFixture()), second.start(archiveFixture())]);
  const firstPlayer = (await firstHarness.storage.get(first.status.gameId)).create.playerId;
  const secondPlayer = (await secondHarness.storage.get(second.status.gameId)).create.playerId;
  assert.notEqual(firstPlayer, secondPlayer);
  first.close(); second.close();
});

test('legacy queued create and event bodies retain exact bytes and gain no inferred balance or player fields', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  let recorder = new GameRecorder(harness.options);
  const initial = archiveFixture();
  delete initial.config.victoryCondition;
  delete initial.config.deploymentOffset;
  delete initial.config.shieldPromotion.allies;
  const moved = { ...initial, state: archiveFixture(1).state };
  await recorder.start(initial); const legacyId = recorder.status.gameId;
  await recorder.record('move', moved);
  const legacy = await harness.storage.get(legacyId);
  delete legacy.create.playerId;
  await harness.storage.put(legacy);
  const oldBody = JSON.stringify(legacy.create), oldEvents = JSON.stringify({ events: legacy.events });
  server.loseCreateAck = true;
  await recorder.flush();
  assert.equal(recorder.status.state, 'error');
  recorder.close();
  recorder = new GameRecorder(harness.options);
  await recorder.resume(moved); await recorder.flush();
  const creates = server.requests.filter(request => request.url.endsWith('/api/games'));
  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map(request => request.rawBody), [oldBody, oldBody]);
  assert.deepEqual(server.requests.filter(request => request.url.endsWith('/events')).map(request => request.rawBody), [oldEvents]);
  assert.equal(JSON.stringify((await harness.storage.get(legacyId)).create), oldBody);
  assert.deepEqual(server.games.get(legacyId).events[0].payload.config, initial.config);
  assert.equal(Object.hasOwn(server.games.get(legacyId).create, 'playerId'), false);
  assert.equal(Object.hasOwn((await harness.storage.get(legacyId)).create, 'playerId'), false);
  await recorder.start(archiveFixture()); await recorder.flush();
  assert.equal((await harness.storage.get(recorder.status.gameId)).create.playerId, harness.storage.playerId);
  assert.equal(Object.hasOwn(server.games.get(legacyId).create, 'playerId'), false);
  recorder.close();
});

test('unavailable or invalid identity storage cannot silently create temporary IDs or report a save', async () => {
  const server = archiveServer(); let available = false, createCalls = 0;
  const playerStorage = { getOrCreatePlayerId(createId) { createCalls++; if (!available) throw new Error('unavailable'); return createId(); } };
  const harness = archiveHarness({ fetch: server.fetch, playerStorage });
  const recorder = new GameRecorder(harness.options);
  assert.equal(await recorder.start(archiveFixture()), false);
  assert.equal(recorder.status.state, 'error'); assert.equal(recorder.status.message, 'storage');
  await recorder.flush();
  assert.equal(recorder.status.state, 'error');
  assert.equal((await harness.storage.list()).length, 0);
  assert.equal(server.requests.length, 0);
  assert.equal(createCalls, 1);
  available = true;
  assert.equal(await recorder.start(archiveFixture()), true);
  await recorder.start(archiveFixture()); await recorder.flush();
  assert.equal(createCalls, 2); // The successful identity stays fixed in this recorder.
  const ids = new Set([...server.games.values()].map(game => game.create.playerId));
  assert.equal(ids.size, 1); assert.equal(recorder.status.state, 'saved');
  recorder.close();

  const invalidHarness = archiveHarness({ playerStorage: { getOrCreatePlayerId: () => 'not-a-uuid' } });
  const invalid = new GameRecorder(invalidHarness.options);
  assert.equal(await invalid.start(archiveFixture()), false);
  assert.equal(invalid.status.message, 'storage');
  assert.equal((await invalidHarness.storage.list()).length, 0);
  invalid.close();
});

test('identity storage is never accessed by a drainer or a resumed legacy game', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const first = new GameRecorder(harness.options);
  await first.start(archiveFixture()); const legacyId = first.status.gameId;
  const legacy = await harness.storage.get(legacyId); delete legacy.create.playerId;
  await harness.storage.put(legacy); first.close();
  const fail = () => assert.fail('resuming a legacy game touched identity storage');
  const resumed = new GameRecorder({ ...harness.options, playerStorage: { getOrCreatePlayerId: fail } });
  await resumed.resume(archiveFixture(1));
  assert.equal(resumed.status.gameId, legacyId);
  assert.equal(Object.hasOwn((await harness.storage.get(legacyId)).create, 'playerId'), false);
  const drainer = new GameRecorder({ ...harness.options, sessionStorage: new ArchiveTestSession(), playerStorage: { getOrCreatePlayerId: fail } });
  await drainer.flush();
  assert.equal(server.games.get(legacyId).create.playerId, undefined);
  assert.equal(drainer.status.pending, 0);
  drainer.close();
  resumed.close();
});

test('a temporary write conflict retries automatically without another move and keeps its safe code', async () => {
  const server = archiveServer(); let conflict = true, attempts = 0;
  const statuses = [];
  const harness = archiveHarness({ autoFlush: true, retryBaseMs: 5, onStatus: status => statuses.push(status), fetch: async (url, request) => {
    attempts++;
    if (conflict) { conflict = false; return { ok: false, status: 409, json: async () => ({ code: 'write_conflict', error: 'private server text' }) }; }
    return server.fetch(url, request);
  } });
  const recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture()); await recorder.record('move', archiveFixture(1));
  await archiveWaitFor(() => recorder.status.state === 'saved' && recorder.status.pending === 0);
  const id = recorder.status.gameId, stored = await harness.storage.get(id);
  assert.ok(attempts >= 3);
  assert.equal(stored.blocked, undefined); assert.equal(stored.lastFailure, undefined);
  assert.equal(server.games.get(id).events.length, 1);
  assert.ok(statuses.some(status => status.state === 'error' && status.failed === 0 && status.failures.some(f => f.httpStatus === 409 && f.code === 'write_conflict')));
  assert.equal(JSON.stringify(statuses).includes('private server text'), false);
  recorder.close();
});

test('real sequence and identity conflicts stay blocked; unknown response details never reach status', async () => {
  for (const code of ['sequence_conflict', 'sequence_gap', 'player_id_conflict', 'private unknown code']) {
    let attempts = 0;
    const harness = archiveHarness({ fetch: async () => { attempts++; return { ok: false, status: 409, json: async () => ({ code, error: 'secret details', writeKey: 'never show' }) }; } });
    let recorder = new GameRecorder(harness.options);
    await recorder.start(archiveFixture()); await recorder.flush();
    const expected = { httpStatus: 409, ...(code === 'private unknown code' ? {} : { code }), count: 1 };
    assert.deepEqual(recorder.status.failures, [expected]);
    const detached = recorder.status; detached.failures[0].count = 99;
    assert.deepEqual(recorder.status.failures, [expected]);
    assert.equal(JSON.stringify(recorder.status).includes('secret details'), false);
    assert.equal(JSON.stringify(recorder.status).includes('private unknown code'), false);
    assert.equal(JSON.stringify(recorder.status).includes('never show'), false);
    recorder.close(); recorder = new GameRecorder(harness.options);
    await recorder.flush(); assert.equal(attempts, 1); assert.equal(recorder.status.failed, 1);
    recorder.close();
  }
});

test('old blocked schema and conflict requests recover once using exact original bytes and credentials', async () => {
  for (const status of [400, 409]) for (const created of [false, true]) {
    const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
    const first = new GameRecorder(harness.options), initial = archiveFixture();
    delete initial.config.victoryCondition; delete initial.config.deploymentOffset; delete initial.config.shieldPromotion.allies;
    await first.start(initial); await first.record('move', { ...initial, state: archiveFixture(1).state });
    const id = first.status.gameId, legacy = await harness.storage.get(id); first.close();
    delete legacy.create.playerId;
    const createBytes = JSON.stringify(legacy.create), eventBytes = JSON.stringify({ events: legacy.events });
    const authorization = `Bearer ${legacy.writeKey}`;
    if (created) {
      await server.fetch('https://archive.example.test/api/games', { body: createBytes, headers: { Authorization: authorization } });
      // The previous response could have been lost after the server committed.
      await server.fetch(`https://archive.example.test/api/games/${id}/events`, { body: eventBytes, headers: { Authorization: authorization } });
    }
    legacy.created = created; legacy.blocked = { message: 'request_rejected', httpStatus: status, at: '2026-11-01T00:00:00.000Z' };
    await harness.storage.put(legacy); server.requests.length = 0;
    const reloaded = new GameRecorder({ ...harness.options, autoFlush: true });
    await archiveWaitFor(() => reloaded.status.state === 'saved' && reloaded.status.pending === 0);
    const recovered = await harness.storage.get(id);
    assert.equal(recovered.created, true); assert.equal(recovered.blocked, undefined); assert.equal(recovered.ackedThrough, 1);
    assert.equal(recovered.recoveryRevision, 1);
    assert.equal(recovered.id, legacy.id); assert.equal(recovered.writeKey, legacy.writeKey); assert.equal(recovered.nextSeq, legacy.nextSeq);
    assert.equal(JSON.stringify(recovered.create), createBytes);
    assert.deepEqual(server.requests.filter(r => r.url.endsWith('/api/games')).map(r => r.rawBody), created ? [] : [createBytes]);
    assert.deepEqual(server.requests.filter(r => r.url.endsWith('/events')).map(r => r.rawBody), [eventBytes]);
    assert.ok(server.requests.every(request => request.authorization === authorization));
    assert.equal(server.games.get(id).events.length, 1);
    assert.deepEqual(reloaded.status.failures, []);
    reloaded.close();
  }
});

test('an old permanent refusal gets one automatic attempt across reloads and can later recover manually', async () => {
  const server = archiveServer(); let denied = true, attempts = 0, release, entered = false;
  const harness = archiveHarness({ fetch: async (url, request) => {
    attempts++;
    if (denied) return { ok: false, status: 400, json: async () => ({ code: 'invalid_request' }) };
    if (!entered) { entered = true; await new Promise(resolve => { release = resolve; }); }
    return server.fetch(url, request);
  } });
  let recorder = new GameRecorder(harness.options);
  await recorder.start(archiveFixture()); await recorder.record('move', archiveFixture(1));
  const id = recorder.status.gameId, legacy = await harness.storage.get(id); recorder.close();
  legacy.blocked = { message: 'request_rejected', httpStatus: 400 };
  await harness.storage.put(legacy);
  recorder = new GameRecorder({ ...harness.options, autoFlush: true, retryBaseMs: 5 });
  await archiveWaitFor(() => recorder.status.failed === 1);
  assert.equal(attempts, 1); assert.equal(recorder.status.pending, 2); recorder.close();
  recorder = new GameRecorder(harness.options); await recorder.flush();
  assert.equal(attempts, 1); assert.equal(recorder.status.failed, 1);
  denied = false;
  const retry = recorder.retryFailed(), duplicate = recorder.retryFailed();
  assert.equal(retry, duplicate);
  await archiveWaitFor(() => entered);
  assert.notEqual(recorder.status.state, 'saved'); assert.equal(recorder.status.pending, 2);
  await recorder.record('pass', archiveFixture(2));
  release(); await retry;
  assert.equal(recorder.status.state, 'saved'); assert.equal(recorder.status.pending, 0); assert.equal(recorder.status.failed, 0);
  assert.deepEqual(server.games.get(id).events.map(e => [e.seq, e.type]), [[1, 'move'], [2, 'pass']]);
  assert.deepEqual(server.games.get(id).create, legacy.create);
  recorder.close();
});

test('old authorization and quota refusals are preserved without automatic retry', async () => {
  for (const httpStatus of [401, 403, 413]) {
    let attempts = 0;
    const harness = archiveHarness({ fetch: async () => { attempts++; throw new Error('should not send'); } });
    const first = new GameRecorder(harness.options); await first.start(archiveFixture()); await first.record('move', archiveFixture(1));
    const id = first.status.gameId, legacy = await harness.storage.get(id); first.close();
    legacy.blocked = { message: 'request_rejected', httpStatus }; await harness.storage.put(legacy);
    const reloaded = new GameRecorder(harness.options); await reloaded.flush();
    assert.equal(attempts, 0); assert.equal(reloaded.status.failed, 1); assert.equal(reloaded.status.pending, 2);
    assert.deepEqual(await harness.storage.get(id), legacy);
    reloaded.close();
  }
});

test('manual retry waits for the active flush, including its refusal, then sends the pending queue once', async () => {
  const server = archiveServer(); let release, entered = false, attempts = 0;
  const harness = archiveHarness({ fetch: async (url, request) => {
    attempts++;
    if (!entered) { entered = true; await new Promise(resolve => { release = resolve; }); return { ok: false, status: 409, json: async () => ({ code: 'sequence_conflict' }) }; }
    return server.fetch(url, request);
  } });
  const recorder = new GameRecorder(harness.options); await recorder.start(archiveFixture()); await recorder.record('move', archiveFixture(1));
  const sending = recorder.flush(); await archiveWaitFor(() => entered);
  const retry = recorder.retryFailed(), duplicate = recorder.retryFailed(); assert.equal(retry, duplicate);
  await recorder.record('pass', archiveFixture(2));
  release(); await Promise.all([sending, retry]);
  assert.equal(attempts, 3);
  assert.equal(recorder.status.failed, 0); assert.equal(recorder.status.pending, 0);
  assert.deepEqual([...server.games.values()][0].events.map(e => e.seq), [1, 2]);
  recorder.close();
});

test('a late refusal from one drainer cannot block a queue fully acknowledged by another', async () => {
  const server = archiveServer(), harness = archiveHarness({ fetch: server.fetch });
  const owner = new GameRecorder(harness.options); await owner.start(archiveFixture()); await owner.record('move', archiveFixture(1));
  let entered = false, release;
  const slow = new GameRecorder({ ...harness.options, sessionStorage: new ArchiveTestSession(), fetch: async () => {
    entered = true; await new Promise(resolve => { release = resolve; });
    return { ok: false, status: 400, json: async () => ({ code: 'invalid_request' }) };
  } });
  const pending = slow.flush(); await archiveWaitFor(() => entered);
  await owner.flush(); assert.equal(owner.status.pending, 0);
  release(); await pending;
  assert.equal(slow.status.failed, 0); assert.equal(slow.status.state, 'saved');
  assert.equal((await harness.storage.get(owner.status.gameId)).blocked, undefined);
  owner.close(); slow.close();
});
