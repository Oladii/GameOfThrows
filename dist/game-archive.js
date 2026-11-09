// This queue is intentionally separate from the game's own saved position.
// Credentials remain in IndexedDB and never enter a game export or a status.
const ArchiveSessionKey = 'game-of-throws-archive-tab-v1';
const ArchivePlayerIdKey = 'player-id';
const ArchiveIsUUID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const ArchiveEventTypes = new Set(['move', 'pass', 'config', 'undo', 'restore', 'finish', 'abandon']);
const ArchivePayloadFields = ['config', 'state', 'action', 'deaths', 'actor', 'reason', 'outcome'];
const ArchiveSnapshot = value => JSON.parse(JSON.stringify(value));
const ArchiveBytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
// Reconsider only refusals saved by clients that could not distinguish schema
// updates and temporary write conflicts. This changes queue metadata, never wire data.
const ArchiveRecoveryRevision = 1;
const ArchiveErrorCodes = new Set(['invalid_request', 'unauthorized', 'origin_forbidden', 'preflight_forbidden', 'unsupported_media_type', 'payload_too_large', 'game_size_limit', 'archive_capacity_limit', 'rate_limited', 'write_conflict', 'player_id_conflict', 'sequence_conflict', 'sequence_gap', 'storage_unavailable']);
const ArchivePending = game => !game.created || game.events.length > 0;
// Version 1 wire fields mirror rules.js / engine.js and the intake validator.
// Keep this projection separate from game validation: imported annotations are
// permitted by the game, but must never enter archive requests.
const ArchivePieceTypes = ['shield', 'archer', 'attackLamp', 'defenseLamp', 'scoutLamp'];
const ArchiveStatFields = ['move', 'damage', 'range', 'fortitude', 'aura', 'damageBonus', 'rangeBonus', 'defenseBonus'];
const ArchivePick = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
};
const ArchiveConfig = value => {
  const config = ArchivePick(value, ['version', 'geometry', 'size', 'army', 'stats', 'experiments', 'shieldPromotion', 'auraDefenseCap', 'victoryCondition', 'deploymentOffset']);
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  if (Object.hasOwn(config, 'army')) config.army = ArchivePick(config.army, ['groups', 'shields', 'archers', 'attackLamps', 'defenseLamps', 'scoutLamps']);
  if (Object.hasOwn(config, 'stats')) {
    config.stats = ArchivePick(config.stats, ArchivePieceTypes);
    if (config.stats && typeof config.stats === 'object') for (const type of ArchivePieceTypes) {
      if (Object.hasOwn(config.stats, type)) config.stats[type] = ArchivePick(config.stats[type], ArchiveStatFields);
    }
  }
  if (Object.hasOwn(config, 'experiments')) config.experiments = ArchivePick(config.experiments, ['squareDiagonals', 'lampShieldBlocking', 'allyShotsPass', 'aurasThroughShields', 'allowPass']);
  if (Object.hasOwn(config, 'shieldPromotion')) {
    config.shieldPromotion = ArchivePick(config.shieldPromotion, ['aura', 'damageBonus', 'rangeBonus', 'defenseBonus', 'maxRange', 'allies']);
    if (config.shieldPromotion && Object.hasOwn(config.shieldPromotion, 'allies')) {
      config.shieldPromotion.allies = ArchivePick(config.shieldPromotion.allies, ['aura', 'damageBonus', 'rangeBonus', 'defenseBonus']);
    }
  }
  return config;
};
const ArchivePiece = (value, death = false) => ArchivePick(value, ['id', 'type', 'team', 'q', 'r', 'group', 'reachedFarEdge', ...(death ? ['incoming', 'fortitude'] : [])]);
const ArchiveState = value => {
  const state = ArchivePick(value, ['pieces', 'turn', 'ply', 'winner']);
  if (state && Array.isArray(state.pieces)) state.pieces = state.pieces.map(piece => ArchivePiece(piece));
  return state;
};
const ArchiveSanitize = value => {
  const snapshot = ArchiveSnapshot(value);
  if (Object.hasOwn(snapshot, 'config')) snapshot.config = ArchiveConfig(snapshot.config);
  if (Object.hasOwn(snapshot, 'state')) snapshot.state = ArchiveState(snapshot.state);
  if (Array.isArray(snapshot.deaths)) snapshot.deaths = snapshot.deaths.map(piece => ArchivePiece(piece, true));
  return snapshot;
};

class ArchiveIndexedDBStorage {
  constructor(indexedDB) { this.indexedDB = indexedDB; this.opened = null; this.identityOpened = null; }
  open() {
    if (!this.opened) this.opened = new Promise((resolve, reject) => {
      if (!this.indexedDB) { reject(new Error('storage_unavailable')); return; }
      const request = this.indexedDB.open('game-of-throws-archive-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('games', { keyPath: 'id' }); };
      request.onerror = () => reject(new Error('storage_unavailable'));
      request.onblocked = () => reject(new Error('storage_unavailable'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.opened = null; };
        resolve(request.result);
      };
    }).catch(error => { this.opened = null; throw error; });
    return this.opened;
  }
  async transaction(mode, operation) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('games', mode);
      let result;
      const request = operation(transaction.objectStore('games'));
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(new Error('storage_unavailable'));
    });
  }
  get(id) { return this.transaction('readonly', store => store.get(id)); }
  put(value) { return this.transaction('readwrite', store => store.put(value)); }
  list() { return this.transaction('readonly', store => store.getAll()); }
  openIdentity() {
    // Keep the queue database at v1 so an older open game can still drain it.
    if (!this.identityOpened) this.identityOpened = new Promise((resolve, reject) => {
      if (!this.indexedDB) { reject(new Error('storage_unavailable')); return; }
      const request = this.indexedDB.open('game-of-throws-archive-identity-v1', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('metadata', { keyPath: 'id' }); };
      request.onerror = request.onblocked = () => reject(new Error('storage_unavailable'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.identityOpened = null; };
        resolve(request.result);
      };
    }).catch(error => { this.identityOpened = null; throw error; });
    return this.identityOpened;
  }
  async getOrCreatePlayerId(createId) {
    const database = await this.openIdentity();
    return new Promise((resolve, reject) => {
      // A read/write transaction serializes simultaneous first visits in tabs.
      const transaction = database.transaction('metadata', 'readwrite'), store = transaction.objectStore('metadata');
      let playerId;
      const request = store.get(ArchivePlayerIdKey);
      request.onsuccess = () => {
        try {
          playerId = request.result ? request.result.value : createId();
          if (!ArchiveIsUUID(playerId)) throw new Error('invalid_player_id');
          if (!request.result) store.put({ id: ArchivePlayerIdKey, value: playerId });
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(playerId);
      transaction.onabort = transaction.onerror = () => reject(new Error('storage_unavailable'));
    });
  }
  async update(id, change) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('games', 'readwrite'), store = transaction.objectStore('games');
      let result;
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          result = change(request.result);
          if (result) store.put(result);
        } catch { transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(new Error('storage_unavailable'));
    });
  }
}

export class GameRecorder {
  #enabled;
  #endpoint;
  #app;
  #storage;
  #playerStorage;
  #playerId = null;
  #identityError = false;
  #session;
  #fetch;
  #clock;
  #uuid;
  #randomBytes;
  #autoFlush;
  #operations = Promise.resolve();
  #flushPromise = null;
  #retryPromise = null;
  #activeId = null;
  #tabId = null;
  #status;
  #onStatus;
  #lastError = null;
  #retryTimer = null;
  #retryCount = 0;
  #retryBaseMs;
  #onlineTarget;
  #onlineListener;
  #channel = null;
  #closed = false;

  constructor(options = {}) {
    this.#enabled = options.enabled === true;
    this.#endpoint = String(options.endpoint || '').replace(/\/+$/, '');
    this.#app = ArchiveSnapshot(options.app || { version: '', build: '', channel: 'local' });
    this.#fetch = options.fetch || globalThis.fetch?.bind(globalThis);
    this.#clock = options.clock || (() => new Date());
    this.#uuid = options.uuid || (() => globalThis.crypto.randomUUID());
    this.#randomBytes = options.randomBytes || (() => globalThis.crypto.getRandomValues(new Uint8Array(32)));
    this.#autoFlush = options.autoFlush !== false;
    this.#retryBaseMs = options.retryBaseMs ?? 1500;
    this.#onStatus = options.onStatus;
    this.#status = { state: this.#enabled ? 'pending' : 'disabled', pending: 0, failed: 0, failures: [], gameId: null, gameStatus: null, message: '' };
    if (!this.#enabled) return;
    this.#storage = options.storage || new ArchiveIndexedDBStorage(options.indexedDB || globalThis.indexedDB);
    this.#playerStorage = options.playerStorage || this.#storage;
    try { this.#session = options.sessionStorage || globalThis.sessionStorage; } catch { this.#session = null; }
    this.#operations = this.#initialize(options).catch(() => { this.#setError('storage'); });
    this.#onlineTarget = options.onlineTarget || (typeof window !== 'undefined' ? window : null);
    this.#onlineListener = () => { void this.flush(); };
    this.#onlineTarget?.addEventListener?.('online', this.#onlineListener);
    if (this.#autoFlush) this.#kick();
  }

  get status() { return { ...this.#status, failures: this.#status.failures.map(failure => ({ ...failure })) }; }
  get onStatus() { return this.#onStatus; }
  set onStatus(listener) { this.#onStatus = listener; this.#emit(); }

  #emit() { try { this.#onStatus?.(this.status); } catch { /* UI callbacks cannot interrupt play. */ } }
  #setError(code) { this.#lastError = code; this.#status = { ...this.#status, state: 'error', message: code }; this.#emit(); }
  #now() { const value = this.#clock(); return new Date(value).toISOString(); }
  #saveSession() {
    this.#session?.setItem(ArchiveSessionKey, JSON.stringify({ tabId: this.#tabId, gameId: this.#activeId }));
  }
  async #initialize(options) {
    let saved;
    try { saved = JSON.parse(this.#session?.getItem(ArchiveSessionKey) || 'null'); } catch { saved = null; }
    this.#tabId = typeof saved?.tabId === 'string' ? saved.tabId : this.#uuid();
    this.#activeId = typeof saved?.gameId === 'string' ? saved.gameId : null;
    // Duplicating a browser tab can copy sessionStorage. A live incumbent keeps
    // its identity; the new tab forks before it writes a sequence or game ID.
    const Channel = options.BroadcastChannel === false ? null : options.BroadcastChannel || (typeof window !== 'undefined' ? globalThis.BroadcastChannel : null);
    if (Channel) {
      const token = this.#uuid();
      this.#channel = new Channel('game-of-throws-archive-tabs-v1');
      let probing = true, collision = false;
      this.#channel.onmessage = event => {
        const message = event.data;
        if (message?.tabId !== this.#tabId) return;
        if (message.kind === 'probe') {
          if (!probing || token < message.token) this.#channel.postMessage({ kind: 'present', tabId: this.#tabId, target: message.token });
          else collision = true;
        }
        if (message.kind === 'present' && message.target === token) collision = true;
      };
      this.#channel.postMessage({ kind: 'probe', tabId: this.#tabId, token });
      await new Promise(resolve => setTimeout(resolve, options.tabProbeMs ?? 80));
      probing = false;
      if (collision) { this.#tabId = this.#uuid(); this.#activeId = null; }
    }
    this.#saveSession();
    await this.#recoverFailures(false);
    await this.#refreshStatus();
  }

  #enqueue(operation) {
    if (!this.#enabled || this.#closed) return Promise.resolve(false);
    const pending = this.#operations.then(operation).catch(() => { this.#setError('storage'); return false; });
    this.#operations = pending.then(() => undefined);
    return pending;
  }
  #snapshot(input) {
    try { return ArchiveSanitize(input); } catch { this.#setError('invalid_snapshot'); return null; }
  }
  async #update(id, change) {
    // Native storage performs this in one read/write transaction, including
    // ACKs sent by other tabs draining the same durable queue.
    if (this.#storage.update) return this.#storage.update(id, change);
    const result = change(await this.#storage.get(id));
    if (result) await this.#storage.put(result);
    return result;
  }
  async #refreshStatus(syncing = false) {
    const games = await this.#storage.list();
    const active = games.find(game => game.id === this.#activeId);
    const pending = games.reduce((count, game) => count + game.events.length + (game.created ? 0 : 1), 0);
    const failed = games.filter(game => game.blocked);
    const failures = new Map();
    for (const game of games) {
      const detail = game.blocked || (ArchivePending(game) ? game.lastFailure : null);
      if (!detail) continue;
      const httpStatus = Number.isInteger(detail.httpStatus) && detail.httpStatus >= 400 && detail.httpStatus <= 599 ? detail.httpStatus : undefined;
      const code = ArchiveErrorCodes.has(detail.code) ? detail.code : undefined;
      const key = `${httpStatus ?? ''}:${code ?? ''}`;
      const summary = failures.get(key) || { ...(httpStatus ? { httpStatus } : {}), ...(code ? { code } : {}), count: 0 };
      summary.count++; failures.set(key, summary);
    }
    const failure = this.#lastError || (this.#identityError ? 'storage' : '') || failed[0]?.blocked.message || games.find(game => game.lastFailure && (!game.created || game.events.length))?.lastFailure.message || '';
    this.#status = {
      state: failure ? 'error' : syncing ? 'syncing' : pending ? 'pending' : 'saved',
      pending, failed: failed.length, failures: [...failures.values()], gameId: active?.id || null, gameStatus: active?.gameStatus || null, message: failure
    };
    this.#emit();
  }
  async #recoverFailures(manual) {
    for (const candidate of await this.#storage.list()) {
      if (!candidate.blocked) continue;
      await this.#update(candidate.id, game => {
        if (!game?.blocked) return null;
        // Another tab may already have acknowledged the entire queue before a
        // slower refusal was persisted. Its ACK remains authoritative.
        if (!ArchivePending(game)) { delete game.blocked; delete game.lastFailure; return game; }
        const legacy = (game.recoveryRevision ?? 0) < ArchiveRecoveryRevision && [400, 409].includes(game.blocked.httpStatus);
        if (!manual && !legacy) return null;
        game.recoveryRevision = ArchiveRecoveryRevision;
        delete game.blocked; delete game.lastFailure;
        return game;
      });
    }
  }
  retryFailed() {
    if (!this.#enabled || this.#closed) return Promise.resolve(this.status);
    if (this.#retryPromise) return this.#retryPromise;
    this.#retryPromise = (async () => {
      // Do not unblock a row underneath the request that is about to re-block
      // it. Repeated clicks share this operation and its resulting flush.
      if (this.#flushPromise) await this.#flushPromise;
      await this.#enqueue(async () => {
        await this.#recoverFailures(true);
        this.#lastError = null; await this.#refreshStatus(true);
      });
      // An automatic flush may have started while metadata was being updated.
      if (this.#flushPromise) await this.#flushPromise;
      return this.flush();
    })().finally(() => { this.#retryPromise = null; });
    return this.#retryPromise;
  }
  async #newRecord(input, reason) {
    if (!this.#playerId) {
      try {
        const playerId = await this.#playerStorage.getOrCreatePlayerId(this.#uuid);
        if (!ArchiveIsUUID(playerId)) throw new Error('storage_unavailable');
        this.#playerId = playerId; this.#identityError = false;
      } catch (error) { this.#identityError = true; throw error; }
    }
    const bytes = this.#randomBytes();
    const writeKey = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    if (!/^[a-f0-9]{64}$/.test(writeKey)) throw new Error('random_unavailable');
    const id = this.#uuid();
    const create = {
      schemaVersion: 1, id, playerId: this.#playerId, startedAt: this.#now(), app: this.#app,
      game: { mode: input.mode, humanTeam: input.humanTeam, firstMove: input.firstMove },
      initial: { config: input.config, state: input.state }, startReason: reason, source: input.source || 'player'
    };
    if (input.mode === 'bot' && Number.isSafeInteger(input.botDepth) && input.botDepth > 0) create.game.botDepth = input.botDepth;
    return {
      id, writeKey, tabId: this.#tabId, create, created: false, nextSeq: 1, ackedThrough: 0, events: [],
      config: input.config, state: input.state, gameStatus: input.state?.winner !== null && input.state?.winner !== undefined ? 'finished' : 'active'
    };
  }
  #append(game, type, input) {
    const payload = { config: input.config ?? game.config, state: input.state ?? game.state };
    for (const field of ArchivePayloadFields) if (input[field] !== undefined) payload[field] = input[field];
    payload.config = ArchiveConfig(payload.config); payload.state = ArchiveState(payload.state);
    if (payload.outcome === null || [0, 1, 'draw'].includes(payload.outcome)) payload.outcome = { winner: payload.outcome };
    const event = { seq: game.nextSeq, type, at: this.#now(), payload };
    if (ArchiveBytes(event) > 64 * 1024) { this.#setError('event_too_large'); return false; }
    game.events.push(event); game.nextSeq++;
    game.config = payload.config; game.state = payload.state;
    if (type === 'finish') game.gameStatus = 'finished';
    else if (type === 'abandon') game.gameStatus = 'abandoned';
    else game.gameStatus = payload.state?.winner !== null && payload.state?.winner !== undefined ? 'finished' : 'active';
    return true;
  }

  start(input) { return this.#begin(input, false); }
  resume(input) { return this.#begin(input, true); }
  #begin(input, resume) {
    if (!this.#enabled || this.#closed) return Promise.resolve(false);
    const snapshot = this.#snapshot(input);
    if (!snapshot) return Promise.resolve(false);
    const result = this.#enqueue(async () => {
      const active = this.#activeId ? await this.#storage.get(this.#activeId) : null;
      if (resume && active && active.tabId === this.#tabId) {
        // A crash can save the game position just before its archive write.
        // Reconcile that position explicitly instead of silently losing it.
        if (JSON.stringify(active.state) !== JSON.stringify(snapshot.state) || JSON.stringify(active.config) !== JSON.stringify(snapshot.config)) {
          const restored = await this.#update(active.id, game => this.#append(game, 'restore', { config: snapshot.config, state: snapshot.state, reason: 'resume' }) ? game : null);
          if (!restored) return false;
        }
        this.#lastError = null; await this.#refreshStatus(); return true;
      }
      if (active?.gameStatus === 'active') {
        const abandoned = await this.#update(active.id, game => this.#append(game, 'abandon', { reason: 'new-game' }) ? game : null);
        if (!abandoned) return false;
      }
      const game = await this.#newRecord(snapshot, resume ? 'resume' : 'new');
      await this.#storage.put(game);
      this.#activeId = game.id; this.#saveSession();
      this.#lastError = null; await this.#refreshStatus(); return true;
    });
    if (this.#autoFlush) result.then(() => this.#kick());
    return result;
  }

  record(type, input = {}) {
    if (!this.#enabled || this.#closed) return Promise.resolve(false);
    if (!ArchiveEventTypes.has(type)) { this.#setError('invalid_event'); return Promise.resolve(false); }
    const snapshot = this.#snapshot(input);
    if (!snapshot) return Promise.resolve(false);
    const result = this.#enqueue(async () => {
      const active = this.#activeId ? await this.#storage.get(this.#activeId) : null;
      if (!active || active.tabId !== this.#tabId) return false;
      const updated = await this.#update(active.id, game => this.#append(game, type, snapshot) ? game : null);
      if (!updated) return false;
      this.#lastError = null; await this.#refreshStatus(); return true;
    });
    if (this.#autoFlush) result.then(() => this.#kick());
    return result;
  }

  #kick() { if (!this.#closed) queueMicrotask(() => { void this.flush(); }); }
  #scheduleRetry() {
    if (!this.#autoFlush || this.#retryTimer || this.#closed) return;
    const delay = Math.min(60000, this.#retryBaseMs * 2 ** Math.min(this.#retryCount++, 6));
    this.#retryTimer = setTimeout(() => { this.#retryTimer = null; void this.flush(); }, delay);
    this.#retryTimer.unref?.();
  }
  async #request(path, writeKey, body) {
    if (!this.#fetch || !this.#endpoint) throw Object.assign(new Error('offline'), { retryable: true });
    let response;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
    timeout?.unref?.();
    try {
      response = await this.#fetch(this.#endpoint + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${writeKey}` },
        body: JSON.stringify(body), signal: controller?.signal, credentials: 'omit', referrerPolicy: 'no-referrer'
      });
    } catch { throw Object.assign(new Error('offline'), { retryable: true }); }
    finally { clearTimeout(timeout); }
    if (!response.ok) {
      let code;
      try { const value = await response.json(); if (ArchiveErrorCodes.has(value?.code)) code = value.code; } catch { /* A proxy may return a non-JSON error. */ }
      const retryable = response.status >= 500 || response.status === 429 || response.status === 409 && code === 'write_conflict';
      throw Object.assign(new Error(retryable ? 'service_unavailable' : 'request_rejected'), {
        retryable, httpStatus: response.status, ...(code ? { code } : {}),
        permanent: response.status >= 400 && response.status < 500 && !retryable
      });
    }
    try { return await response.json(); } catch { throw Object.assign(new Error('invalid_ack'), { retryable: true }); }
  }
  async #ack(id, response, sentThrough, created) {
    const acknowledged = response.acceptedThrough ?? response.lastSeq;
    if (!Number.isSafeInteger(acknowledged) || acknowledged < sentThrough) throw Object.assign(new Error('invalid_ack'), { retryable: true });
    const result = await this.#enqueue(async () => {
      return Boolean(await this.#update(id, game => {
        if (!game || acknowledged >= game.nextSeq) return null;
        game.created = game.created || created;
        game.ackedThrough = Math.max(game.ackedThrough, acknowledged);
        game.events = game.events.filter(event => event.seq > game.ackedThrough);
        delete game.lastFailure;
        if (!ArchivePending(game)) delete game.blocked;
        return game;
      }));
    });
    if (!result) throw Object.assign(new Error('sequence_conflict'), { retryable: false });
    await this.#refreshStatus(true);
  }
  flush() {
    if (!this.#enabled || this.#closed) return Promise.resolve(this.status);
    if (this.#flushPromise) return this.#flushPromise;
    clearTimeout(this.#retryTimer); this.#retryTimer = null;
    this.#flushPromise = this.#flush().catch(error => {
      this.#setError(['offline', 'service_unavailable', 'request_rejected', 'invalid_ack', 'sequence_conflict'].includes(error.message) ? error.message : 'storage');
      if (error.retryable) this.#scheduleRetry();
      return this.status;
    }).finally(() => { this.#flushPromise = null; });
    return this.#flushPromise;
  }
  async #flush() {
    await this.#operations;
    this.#lastError = null;
    await this.#refreshStatus(true);
    // New actions may be persisted while a request is in flight. Read again
    // after each acknowledgement; never replace the queue with an old snapshot.
    const pending = await this.#storage.list();
    let retryNeeded = false;
    for (const candidate of pending) {
      if (candidate.blocked) continue;
      try {
        let game = await this.#storage.get(candidate.id);
        if (game.blocked) continue;
        if (!game.created) {
          const response = await this.#request('/api/games', game.writeKey, game.create);
          await this.#ack(game.id, response, 0, true);
        }
        while (!this.#closed) {
          game = await this.#storage.get(candidate.id);
          if (game.blocked || !game.events.length) break;
          const events = [];
          for (const event of game.events) {
            if (events.length >= 32 || ArchiveBytes({ events: [...events, event] }) > 256 * 1024) break;
            events.push(event);
          }
          if (!events.length) throw Object.assign(new Error('request_rejected'), { permanent: true });
          const response = await this.#request(`/api/games/${encodeURIComponent(game.id)}/events`, game.writeKey, { events });
          await this.#ack(game.id, response, events.at(-1).seq, true);
        }
      } catch (error) {
        const permanent = error.permanent || error.message === 'sequence_conflict';
        if (!permanent && !error.retryable) throw error;
        const failure = { message: error.message, at: this.#now(), ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(ArchiveErrorCodes.has(error.code) ? { code: error.code } : {}) };
        const updated = await this.#enqueue(() => this.#update(candidate.id, game => {
          if (!game) return null;
          if (!ArchivePending(game)) { delete game.blocked; delete game.lastFailure; return game; }
          game.recoveryRevision = ArchiveRecoveryRevision;
          if (permanent) { game.blocked = failure; delete game.lastFailure; }
          else game.lastFailure = failure;
          return game;
        }));
        if (!updated) throw new Error('storage');
        retryNeeded ||= !permanent;
        if (error.message === 'offline') break;
      }
    }
    if (!retryNeeded) this.#retryCount = 0;
    this.#lastError = null;
    await this.#refreshStatus();
    // A new game can have been added after the first queue listing.
    const remaining = await this.#storage.list();
    if (remaining.some(game => !game.blocked && (!game.created || game.events.length)) && this.#autoFlush) this.#scheduleRetry();
    return this.status;
  }

  close() {
    this.#closed = true; clearTimeout(this.#retryTimer); this.#retryTimer = null;
    this.#channel?.close();
    this.#onlineTarget?.removeEventListener?.('online', this.#onlineListener);
  }
}
