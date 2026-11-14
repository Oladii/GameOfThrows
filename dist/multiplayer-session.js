import { MultiplayerClient, MultiplayerError, multiplayerRandomId } from './multiplayer-client.js';

export class MultiplayerSession {
  #client;
  #snapshot = null;
  #status = 'idle';
  #pending = false;
  #error = null;
  #generation = 0;
  #pollTimer = null;
  #heartbeatTimer = null;
  #sync = null;
  #listeners = [];
  #suspended = false;
  #requestSequence = 0;
  #lastSettled = 0;
  constructor({ endpoint = '', onChange = () => {}, onError = () => {}, transport,
    documentTarget = globalThis.document, windowTarget = globalThis.window,
    cryptoImpl = globalThis.crypto, setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
    clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis), pollMs = 1000, heartbeatMs = 20000, ...clientOptions } = {}) {
    this.#client = transport || new MultiplayerClient({ endpoint, cryptoImpl, ...clientOptions });
    this.onChange = onChange; this.onError = onError; this.documentTarget = documentTarget; this.windowTarget = windowTarget;
    this.cryptoImpl = cryptoImpl; this.setTimeoutImpl = setTimeoutImpl; this.clearTimeoutImpl = clearTimeoutImpl;
    this.pollMs = pollMs; this.heartbeatMs = heartbeatMs;
    // Always new for this document: duplicated tabs can inherit sessionStorage.
    this.connectionId = multiplayerRandomId(cryptoImpl);
  }
  get view() {
    const seat = this.#snapshot?.self?.seat;
    const selfSeat = seat === 0 || seat === 1 ? seat : null;
    return { snapshot: this.#snapshot, status: this.#status, pending: this.#pending, selfSeat,
      canMove: this.#status === 'connected' && !this.#pending && !this.#suspended && selfSeat !== null &&
        this.#snapshot?.phase === 'playing' && this.#snapshot.state?.winner === null && this.#snapshot.state.turn === selfSeat,
      error: this.#error };
  }
  #emit() { this.onChange(this.view); }
  #visible() { return this.documentTarget?.visibilityState !== 'hidden' && this.documentTarget?.hidden !== true; }
  #visibility() { return this.#visible() ? 'visible' : 'hidden'; }
  #safeError(error) { return error instanceof MultiplayerError ? error : new MultiplayerError('request_failed'); }
  #current(generation) { return generation === this.#generation && !this.#suspended; }
  #accept(snapshot, generation) {
    if (!this.#current(generation)) return false;
    if (!snapshot || typeof snapshot.roomId !== 'string' || !Number.isSafeInteger(snapshot.roomNumber) || snapshot.roomNumber < 1 || !Number.isInteger(snapshot.revision) || snapshot.revision < 0 ||
      !['waiting', 'playing', 'won'].includes(snapshot.phase) || !Array.isArray(snapshot.seats) || snapshot.seats.length !== 2 ||
      !snapshot.self || !Number.isFinite(Date.parse(snapshot.serverTime))) throw new MultiplayerError('invalid_response');
    if (this.#snapshot) {
      if (snapshot.roomId !== this.#snapshot.roomId || snapshot.revision < this.#snapshot.revision) return false;
      if (snapshot.revision === this.#snapshot.revision && Date.parse(snapshot.serverTime) <= Date.parse(this.#snapshot.serverTime)) return false;
    }
    this.#snapshot = snapshot;
    return true;
  }
  #success(sequence) {
    if (sequence < this.#lastSettled) return;
    this.#lastSettled = sequence; this.#status = 'connected'; this.#error = null;
  }
  #failure(error, generation, sequence, notify = true) {
    const failure = this.#safeError(error);
    if (!this.#current(generation) || sequence < this.#lastSettled) return failure;
    this.#lastSettled = sequence;
    const changed = this.#error?.code !== failure.code;
    this.#error = failure;
    if (failure.code === 'room_not_found') {
      this.#status = 'closed'; this.#generation++; this.#pending = false; this.#sync = null; this.#cancelTimers();
    } else this.#status = failure.code === 'network_error' ? 'offline' : [400, 409].includes(failure.status) ? 'connected' : 'error';
    this.#emit();
    if (notify && changed) this.onError(failure);
    return failure;
  }
  #cancelTimers() {
    this.clearTimeoutImpl(this.#pollTimer); this.clearTimeoutImpl(this.#heartbeatTimer);
    this.#pollTimer = null; this.#heartbeatTimer = null;
  }
  #schedulePoll() {
    this.clearTimeoutImpl(this.#pollTimer); this.#pollTimer = null;
    if (!this.#snapshot || !this.#visible() || this.#suspended || this.#status === 'closed') return;
    this.#pollTimer = this.setTimeoutImpl(() => { this.#pollTimer = null; void this.resync().catch(() => {}); }, this.pollMs);
  }
  #scheduleHeartbeat() {
    this.clearTimeoutImpl(this.#heartbeatTimer); this.#heartbeatTimer = null;
    if (!this.#snapshot || this.#suspended || this.#status === 'closed') return;
    this.#heartbeatTimer = this.setTimeoutImpl(() => {
      this.#heartbeatTimer = null;
      void this.#presence().finally(() => this.#scheduleHeartbeat());
    }, this.heartbeatMs);
  }
  #listen(target, type, handler) {
    target?.addEventListener?.(type, handler);
    this.#listeners.push(() => target?.removeEventListener?.(type, handler));
  }
  #attach() {
    if (this.#listeners.length) return;
    this.#listen(this.documentTarget, 'visibilitychange', () => {
      if (!this.#snapshot || this.#suspended) return;
      this.#schedulePoll(); void this.#presence();
      if (this.#visible()) void this.resync().catch(() => {});
    });
    const refresh = () => {
      if (!this.#snapshot || this.#suspended) return;
      void this.#presence(); void this.resync().catch(() => {});
    };
    this.#listen(this.windowTarget, 'focus', refresh);
    this.#listen(this.windowTarget, 'online', refresh);
    this.#listen(this.windowTarget, 'pagehide', () => {
      this.#suspended = true; this.#generation++; this.#sync = null; this.#pending = false;
      this.#cancelTimers(); if (this.#status !== 'closed') this.#status = this.#snapshot ? 'offline' : 'idle'; this.#emit();
    });
    this.#listen(this.windowTarget, 'pageshow', () => {
      if (!this.#suspended) return;
      this.#suspended = false;
      if (this.#snapshot) { refresh(); this.#scheduleHeartbeat(); }
    });
  }
  async #connect(roomId) {
    if (this.#pending || this.#snapshot) throw new MultiplayerError('command_pending');
    const generation = ++this.#generation, sequence = ++this.#requestSequence;
    this.#suspended = false; this.#status = 'connecting'; this.#pending = true; this.#error = null; this.#emit();
    const body = { connectionId: this.connectionId, visibility: this.#visibility() };
    try {
      const snapshot = await (roomId === null ? this.#client.createRoom(body) : this.#client.joinRoom(roomId, body));
      if (!this.#current(generation)) throw new MultiplayerError('session_closed');
      this.#accept(snapshot, generation); this.#success(sequence); this.#attach();
      this.#schedulePoll(); this.#scheduleHeartbeat();
      return this.#snapshot;
    } catch (error) { throw this.#failure(error, generation, sequence); }
    finally { if (this.#current(generation)) { this.#pending = false; this.#emit(); } }
  }
  create() { return this.#connect(null); }
  join(roomId) { return this.#connect(roomId); }
  async resync() {
    if (!this.#snapshot || this.#suspended || this.#status === 'closed') return this.#snapshot;
    if (this.#sync?.generation === this.#generation) return this.#sync.promise;
    const generation = this.#generation, sequence = ++this.#requestSequence;
    if (['offline', 'error'].includes(this.#status)) { this.#status = 'reconnecting'; this.#emit(); }
    const sync = { generation, promise: null };
    this.#sync = sync;
    sync.promise = (async () => {
      try {
        const snapshot = await this.#client.readRoom(this.#snapshot.roomId);
        if (!this.#current(generation)) return null;
        this.#accept(snapshot, generation); this.#success(sequence); this.#emit();
        return this.#snapshot;
      } catch (error) { throw this.#failure(error, generation, sequence); }
      finally {
        if (this.#sync === sync) this.#sync = null;
        if (this.#current(generation)) this.#schedulePoll();
      }
    })();
    return sync.promise;
  }
  async #presence() {
    if (!this.#snapshot || this.#suspended || this.#status === 'closed') return;
    const generation = this.#generation, sequence = ++this.#requestSequence;
    try {
      const snapshot = await this.#client.presence(this.#snapshot.roomId, { connectionId: this.connectionId, visibility: this.#visibility() });
      if (!this.#current(generation)) return;
      this.#accept(snapshot, generation); this.#success(sequence); this.#emit();
    } catch (error) { this.#failure(error, generation, sequence); }
  }
  async #command(type, payload) {
    if (this.#status === 'closed') throw new MultiplayerError('room_not_found');
    if (!this.#snapshot || this.#suspended) throw new MultiplayerError('not_joined');
    if (this.#pending) throw new MultiplayerError('command_pending');
    const generation = this.#generation, sequence = ++this.#requestSequence;
    const roomId = this.#snapshot.roomId;
    const command = { commandId: multiplayerRandomId(this.cryptoImpl), expectedRevision: this.#snapshot.revision,
      matchId: this.#snapshot.matchId, type, payload: structuredClone(payload) };
    this.#pending = true; this.#error = null; this.#emit();
    try {
      let snapshot;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { snapshot = await this.#client.command(roomId, command); break; }
        catch (error) {
          if (!this.#current(generation)) throw new MultiplayerError('session_closed');
          if (attempt || error?.code !== 'network_error') throw error;
          this.#status = 'reconnecting'; this.#emit();
        }
      }
      if (!this.#current(generation)) throw new MultiplayerError('session_closed');
      this.#accept(snapshot, generation); this.#success(sequence);
      return this.#snapshot;
    } catch (error) {
      if (this.#current(generation) && error?.snapshot) this.#accept(error.snapshot, generation);
      const failure = this.#failure(error, generation, sequence);
      if (this.#current(generation) && failure.code === 'network_error') await this.resync().catch(() => {});
      throw failure;
    } finally { if (this.#current(generation)) { this.#pending = false; this.#emit(); } }
  }
  claimSeat(team) { return this.#command('seat', { team }); }
  stand() { return this.#command('stand', {}); }
  move(action) {
    if (!this.view.canMove) return Promise.reject(new MultiplayerError('cannot_move'));
    return this.#command('move', { id: action.id, to: action.to });
  }
  endMatch() { return this.#command('finish', {}); }
  async historyPosition(ply) {
    const snapshot = this.#snapshot, generation = this.#generation;
    if (!snapshot?.matchId || !this.#current(generation) || this.#status === 'closed') throw new MultiplayerError('not_joined');
    const position = await this.#client.readHistory(snapshot.roomId, snapshot.matchId, ply);
    if (!this.#current(generation) || this.#snapshot?.matchId !== snapshot.matchId) throw new MultiplayerError('session_closed');
    if (position?.roomId !== snapshot.roomId || position.matchId !== snapshot.matchId || position.ply !== ply ||
      position.state?.ply !== ply || !Array.isArray(position.state?.pieces)) throw new MultiplayerError('invalid_response');
    return position;
  }
  async leave() {
    if (!this.#snapshot) { this.stop(); return; }
    if (this.#pending) throw new MultiplayerError('command_pending');
    const generation = this.#generation, sequence = ++this.#requestSequence;
    this.#pending = true; this.#emit();
    try {
      await this.#client.leaveRoom(this.#snapshot.roomId, { connectionId: this.connectionId });
      if (this.#current(generation)) this.stop();
    } catch (error) { throw this.#failure(error, generation, sequence); }
    finally { if (this.#current(generation)) { this.#pending = false; this.#emit(); } }
  }
  stop() {
    this.#generation++; this.#cancelTimers(); this.#sync = null;
    this.#listeners.splice(0).forEach(remove => remove());
    this.#snapshot = null; this.#status = 'idle'; this.#pending = false; this.#error = null; this.#suspended = false;
    this.#emit();
  }
}
