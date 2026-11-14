import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTask } from 'node:timers/promises';
import { MultiplayerClient, MultiplayerError, MultiplayerIdentityStore } from '../dist/multiplayer-client.js';
import { MultiplayerSession } from '../dist/multiplayer-session.js';

const token = 'ab'.repeat(32);
const flush = async () => { await nextTask(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let uuid = 0;
const cryptoImpl = { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`, getRandomValues: bytes => bytes.fill(171) };
const storage = { getOrCreateToken: async () => token };
function snapshot(revision = 1, overrides = {}) {
  return { roomId: 'room-one', revision, phase: 'playing', matchId: 'match-one', config: { fixed: true },
    state: { pieces: [], turn: 0, ply: revision - 1, winner: null },
    seats: [{ guestId: 'guest', name: 'Игрок', ready: true }, { guestId: 'other', name: 'Соперник', ready: true }],
    participants: [{ guestId: 'guest', name: 'Игрок', present: true, seat: 0 }], self: { guestId: 'guest', seat: 0 },
    lastAction: null, lastResult: null, serverTime: new Date(1000 * revision).toISOString(), pollAfterMs: 1000, ...overrides };
}
class FakeClock {
  now = 0; serial = 0; jobs = new Map();
  set = (callback, delay) => { const id = ++this.serial; this.jobs.set(id, { callback, at: this.now + delay }); return id; };
  clear = id => this.jobs.delete(id);
  async advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at; this.jobs.delete(next[0]); next[1].callback(); await flush();
    }
    this.now = end; await flush();
  }
}
function setup(overrides = {}, options = {}) {
  const clock = new FakeClock(), documentTarget = new EventTarget(), windowTarget = new EventTarget();
  documentTarget.visibilityState = 'visible';
  const calls = { read: 0, presence: [], leave: [], commands: [] };
  let current = snapshot();
  const transport = {
    createRoom: async () => current, joinRoom: async () => current,
    readRoom: async () => { calls.read++; return current; },
    presence: async (_room, body) => { calls.presence.push(body); return current; },
    leaveRoom: async (_room, body) => { calls.leave.push(body); return {}; },
    command: async (_room, body) => { calls.commands.push(body); return current; }, ...overrides
  };
  const changes = [], errors = [];
  const session = new MultiplayerSession({ transport, cryptoImpl, documentTarget, windowTarget,
    setTimeoutImpl: clock.set, clearTimeoutImpl: clock.clear,
    onChange: view => changes.push(view), onError: error => errors.push(error), ...options });
  return { session, clock, documentTarget, windowTarget, calls, changes, errors, setSnapshot: value => { current = value; } };
}

// This fixture models IndexedDB's crucial property: read/write transactions on
// the same object store execute serially even when opened by different tabs.
function identityDatabase(initial) {
  const values = new Map(initial === undefined ? [] : [['guest-token', initial]]), queue = [];
  let active = false;
  const run = () => {
    if (active || !queue.length) return;
    active = true;
    const transaction = queue.shift();
    queueMicrotask(() => {
      if (transaction.getRequest) { transaction.getRequest.result = values.get(transaction.key); transaction.getRequest.onsuccess(); }
      queueMicrotask(() => {
        if (transaction.aborted) transaction.onabort?.();
        else { for (const [key, value] of transaction.writes) values.set(key, value); transaction.oncomplete?.(); }
        active = false; run();
      });
    });
  };
  const database = { close() {}, createObjectStore() {}, transaction() {
    const transaction = { writes: [], aborted: false, abort() { this.aborted = true; }, objectStore() { return {
      get(key) { transaction.key = key; return transaction.getRequest = {}; },
      put(value, key) { transaction.writes.push([key, value]); }
    }; } };
    queue.push(transaction); run(); return transaction;
  } };
  return { open() { const request = {}; queueMicrotask(() => { request.result = database; request.onsuccess(); }); return request; } };
}

test('guest creation is atomic across tabs and the same token survives a reload', async () => {
  const indexedDB = identityDatabase(); let creations = 0;
  const create = () => { creations++; return token; };
  const guests = await Promise.all([new MultiplayerIdentityStore(indexedDB).getOrCreateToken(create), new MultiplayerIdentityStore(indexedDB).getOrCreateToken(create)]);
  assert.deepEqual(guests, [token, token]); assert.equal(creations, 1);
  assert.equal(await new MultiplayerIdentityStore(indexedDB).getOrCreateToken(create), token);
  assert.equal(creations, 1);
});

test('unavailable or corrupt storage never silently replaces the guest', async () => {
  const corrupt = new MultiplayerIdentityStore(identityDatabase('broken'));
  await assert.rejects(corrupt.getOrCreateToken(() => assert.fail('must preserve identity')), { code: 'invalid_identity' });
  let fetched = false;
  const client = new MultiplayerClient({ storage: new MultiplayerIdentityStore(null), fetchImpl: () => { fetched = true; } });
  await assert.rejects(client.createRoom({}), { code: 'storage_unavailable' }); assert.equal(fetched, false);
});

test('transport keeps credentials out of URLs, payloads, response errors and redirects', async () => {
  const requests = [];
  const client = new MultiplayerClient({ endpoint: 'https://rooms.example///', storage, fetchImpl: async (url, options) => {
    requests.push({ url, options }); return { ok: true, status: 200, json: async () => snapshot() };
  } });
  await client.joinRoom('invite-only', { name: 'Гость', connectionId: 'connection', visibility: 'visible' });
  assert.equal(requests[0].url, 'https://rooms.example/api/rooms/invite-only/join');
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(requests[0].options.redirect, 'error'); assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].url.includes(token), false); assert.equal(requests[0].options.body.includes(token), false);
  assert.equal(Object.hasOwn(JSON.parse(requests[0].options.body), 'guestId'), false);
  const failing = new MultiplayerClient({ storage, fetchImpl: async () => { throw new Error(token); } });
  await assert.rejects(failing.readRoom('invite-only'), error => error.code === 'network_error' && !JSON.stringify(error).includes(token) && !error.message.includes(token));
  const denied = new MultiplayerClient({ storage, fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ code: token, error: token }) }) });
  await assert.rejects(denied.readRoom('invite-only'), error => error.code === 'request_failed' && !JSON.stringify(error).includes(token));
});

test('a new member starts as a spectator and authoritative snapshots grant a seat', async () => {
  const room = snapshot(1, { phase: 'waiting', matchId: null, state: null, seats: [null, null], self: { guestId: 'guest', seat: null } });
  const { session, calls, setSnapshot } = setup({ createRoom: async () => room });
  await session.create({ name: 'Новый' });
  assert.equal(session.view.selfSeat, null); assert.equal(session.view.canMove, false);
  setSnapshot(snapshot(2, { phase: 'waiting', matchId: null, state: null }));
  await session.claimSeat(0);
  assert.equal(session.view.selfSeat, 0); assert.equal(session.view.canMove, false);
  assert.equal(calls.commands[0].type, 'seat'); assert.equal(calls.commands[0].matchId, null);
  assert.equal(calls.commands[0].expectedRevision, 1); session.stop();
});

test('a late poll cannot roll back an accepted command or the active room', async () => {
  const poll = deferred();
  const { session } = setup({ readRoom: () => poll.promise, command: async () => snapshot(3, { state: { pieces: [], turn: 1, ply: 2, winner: null } }) });
  await session.join('room-one'); const syncing = session.resync();
  await session.move({ id: 'piece', to: { q: 1, r: 0 } });
  poll.resolve(snapshot(2)); await syncing;
  assert.equal(session.view.snapshot.revision, 3); assert.equal(session.view.canMove, false);
  session.stop();
});

test('same-revision presence updates require a newer server timestamp', async () => {
  const { session, setSnapshot } = setup(); await session.join('room-one');
  setSnapshot(snapshot(1, { serverTime: new Date(3000).toISOString(), participants: [{ guestId: 'viewer', present: true }] }));
  await session.resync(); assert.equal(session.view.snapshot.participants[0].guestId, 'viewer');
  setSnapshot(snapshot(1, { serverTime: new Date(2000).toISOString(), participants: [] }));
  await session.resync(); assert.equal(session.view.snapshot.participants.length, 1); session.stop();
});

test('uncertain command is retried once with identical fences and never applied optimistically', async () => {
  const acknowledgement = deferred(), sent = [];
  const { session } = setup({ command: async (_room, body) => {
    sent.push(structuredClone(body));
    if (sent.length === 1) throw new MultiplayerError('network_error');
    return acknowledgement.promise;
  } });
  await session.join('room-one');
  const moving = session.move({ id: 'piece', to: { q: 1, r: 0 } }); await flush();
  assert.equal(session.view.pending, true); assert.equal(session.view.canMove, false); assert.equal(session.view.snapshot.revision, 1);
  assert.deepEqual(sent[0], sent[1]); assert.equal(sent.length, 2);
  await assert.rejects(session.claimSeat(1), { code: 'command_pending' });
  acknowledgement.resolve(snapshot(2, { state: { pieces: [], turn: 1, ply: 1, winner: null } }));
  await moving; assert.equal(session.view.snapshot.revision, 2); assert.equal(session.view.pending, false); session.stop();
});

test('conflict accepts the current snapshot without rebasing or replaying the old move', async () => {
  let attempts = 0;
  const { session } = setup({ command: async () => {
    attempts++; throw new MultiplayerError('revision_conflict', { status: 409, snapshot: snapshot(4, { matchId: 'new-match', self: { guestId: 'guest', seat: null } }) });
  } });
  await session.join('room-one');
  await assert.rejects(session.move({ id: 'piece', to: { q: 1, r: 0 } }), { code: 'revision_conflict' });
  assert.equal(attempts, 1); assert.equal(session.view.snapshot.matchId, 'new-match'); assert.equal(session.view.canMove, false);
  assert.equal(session.view.pending, false); session.stop();
});

test('after two transport failures a full resync resolves the state without a third command', async () => {
  let attempts = 0, reads = 0;
  const { session } = setup({ command: async () => { attempts++; throw new MultiplayerError('network_error'); },
    readRoom: async () => { reads++; return snapshot(2, { state: { pieces: [], turn: 1, ply: 1, winner: null } }); } });
  await session.join('room-one');
  await assert.rejects(session.move({ id: 'piece', to: { q: 1, r: 0 } }), { code: 'network_error' });
  assert.equal(attempts, 2); assert.equal(reads, 1); assert.equal(session.view.snapshot.revision, 2);
  assert.equal(session.view.status, 'connected'); assert.equal(session.view.pending, false); session.stop();
});

test('hidden tabs stop polling but heartbeat continues; focus and visibility restore immediately', async () => {
  const { session, clock, documentTarget, windowTarget, calls } = setup(); await session.join('room-one');
  await clock.advance(1000); assert.equal(calls.read, 1);
  documentTarget.visibilityState = 'hidden'; documentTarget.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(calls.presence.at(-1).visibility, 'hidden');
  await clock.advance(20000); assert.equal(calls.read, 1); assert.equal(calls.presence.length, 2);
  documentTarget.visibilityState = 'visible'; documentTarget.dispatchEvent(new Event('visibilitychange')); await flush();
  assert.equal(calls.read, 2); assert.equal(calls.presence.at(-1).visibility, 'visible');
  windowTarget.dispatchEvent(new Event('focus')); await flush(); assert.equal(calls.read, 3); session.stop();
});

test('pagehide and stop preserve seats; bfcache restore resynchronizes without leave', async () => {
  const { session, clock, windowTarget, calls } = setup(); await session.join('room-one');
  windowTarget.dispatchEvent(new Event('pagehide')); await clock.advance(60000);
  assert.equal(calls.leave.length, 0); assert.equal(calls.presence.length, 0); assert.equal(calls.read, 0);
  assert.equal(session.view.canMove, false);
  windowTarget.dispatchEvent(new Event('pageshow')); await flush();
  assert.equal(calls.read, 1); assert.equal(session.view.selfSeat, 0);
  session.stop(); await clock.advance(60000); assert.equal(calls.leave.length, 0); assert.equal(clock.jobs.size, 0);
});

test('two tabs share guest credentials but own different connections and cannot submit two moves for one revision', async () => {
  const sent = [], connections = [], authorization = []; let revision = 1;
  const sharedStorage = new MultiplayerIdentityStore(identityDatabase());
  const fetchImpl = async (url, options) => {
    authorization.push(options.headers.Authorization); const body = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith('/join')) { connections.push(body.connectionId); return { ok: true, status: 200, json: async () => snapshot(1) }; }
    sent.push(body);
    if (body.expectedRevision !== revision) return { ok: false, status: 409, json: async () => ({ code: 'revision_conflict', snapshot: snapshot(revision, { state: { pieces: [], turn: 1, ply: 1, winner: null } }) }) };
    revision++;
    return { ok: true, status: 200, json: async () => snapshot(revision, { state: { pieces: [], turn: 1, ply: 1, winner: null } }) };
  };
  const first = setup({}, { transport: new MultiplayerClient({ storage: sharedStorage, fetchImpl, cryptoImpl }) }).session;
  const second = setup({}, { transport: new MultiplayerClient({ storage: sharedStorage, fetchImpl, cryptoImpl }) }).session;
  await Promise.all([first.join('room-one'), second.join('room-one')]);
  const results = await Promise.allSettled([first.move({ id: 'piece', to: { q: 1, r: 0 } }), second.move({ id: 'piece', to: { q: 2, r: 0 } })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(revision, 2);
  assert.equal(new Set(authorization).size, 1); assert.equal(new Set(connections).size, 2);
  assert.equal(new Set(sent.map(command => command.commandId)).size, 2);
  assert.equal(first.view.canMove, false); assert.equal(second.view.canMove, false); first.stop(); second.stop();
});

test('responses from a stopped session cannot enter another room', async () => {
  const stale = deferred();
  const { session } = setup({ readRoom: () => stale.promise, joinRoom: async roomId => snapshot(1, { roomId }) });
  await session.join('room-one'); const reading = session.resync(); session.stop(); await session.join('room-two');
  stale.resolve(snapshot(100)); await reading;
  assert.equal(session.view.snapshot.roomId, 'room-two'); assert.equal(session.view.snapshot.revision, 1); session.stop();
});

test('victory disables moves without releasing seats; finish and leave are explicit commands', async () => {
  const won = snapshot(4, { phase: 'won', state: { pieces: [], turn: 0, ply: 3, winner: 0 } });
  const { session, calls, setSnapshot } = setup({ joinRoom: async () => won }); await session.join('room-one');
  assert.equal(session.view.selfSeat, 0); assert.equal(session.view.canMove, false);
  await assert.rejects(session.move({ id: 'piece', to: { q: 1, r: 0 } }), { code: 'cannot_move' });
  setSnapshot(snapshot(5, { phase: 'waiting', matchId: null, state: null, seats: [null, null], self: { guestId: 'guest', seat: null } }));
  await session.endMatch(); assert.equal(calls.commands[0].type, 'finish'); assert.equal(session.view.selfSeat, null);
  await session.leave(); assert.equal(calls.leave.length, 1); assert.equal(session.view.status, 'idle');
});

test('a deleted room response disables controls and never impersonates a fresh guest', async () => {
  const { session } = setup({ readRoom: async () => { throw new MultiplayerError('room_not_found', { status: 404 }); } });
  await session.join('room-one'); await assert.rejects(session.resync(), { code: 'room_not_found' });
  assert.equal(session.view.canMove, false); assert.equal(session.view.status, 'error'); session.stop();
});

test('a late successful poll cannot clear a newer connection failure', async () => {
  const stale = deferred();
  const { session } = setup({ readRoom: () => stale.promise,
    command: async () => { throw new MultiplayerError('room_not_found', { status: 404 }); } });
  await session.join('room-one'); const reading = session.resync();
  await assert.rejects(session.claimSeat(0), { code: 'room_not_found' });
  stale.resolve(snapshot()); await reading;
  assert.equal(session.view.status, 'error'); assert.equal(session.view.canMove, false); session.stop();
});

test('default browser timers retain the global receiver for transport and session methods', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const receivers = [];
  globalThis.setTimeout = function () { receivers.push(this); assert.equal(this, globalThis); return 1; };
  globalThis.clearTimeout = function () { receivers.push(this); assert.equal(this, globalThis); };
  let session;
  try {
    const client = new MultiplayerClient({ storage, fetchImpl: async () => ({ ok: true, status: 200, json: async () => snapshot() }) });
    await client.readRoom('room-one');
    session = new MultiplayerSession({ transport: { joinRoom: async () => snapshot() }, cryptoImpl, documentTarget: null, windowTarget: null });
    await session.join('room-one'); session.stop();
    assert.ok(receivers.length >= 6);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});
