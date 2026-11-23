const MultiplayerTokenPattern = /^[a-f0-9]{64}$/;
const MultiplayerRoomPattern = /^[A-Za-z0-9_-]{1,120}$/;
const MultiplayerErrorMessages = Object.freeze({
  storage_unavailable: 'Не удалось открыть хранилище гостя. Разрешите хранение данных в браузере.',
  invalid_identity: 'Не удалось прочитать сохранённого гостя. Его место не будет передано другому гостю.',
  network_error: 'Нет связи с комнатой. Восстановите подключение и повторите попытку.',
  invalid_response: 'Сервер комнаты прислал некорректный ответ.',
  invalid_room: 'Ссылка на комнату некорректна.',
  room_not_found: 'Комната больше не существует.',
  revision_conflict: 'Комната изменилась. Показано её текущее состояние.',
  stale_revision: 'Комната изменилась. Показано её текущее состояние.',
  match_conflict: 'Эта партия уже завершена или началась другая партия.',
  stale_match: 'Эта партия уже завершена или началась другая партия.',
  command_pending: 'Дождитесь ответа на предыдущее действие.',
  not_joined: 'Сначала войдите в комнату.',
  cannot_move: 'Сейчас нельзя сделать ход.',
  session_closed: 'Подключение к комнате закрыто.',
  request_failed: 'Не удалось выполнить действие в комнате.'
});

export class MultiplayerError extends Error {
  constructor(code = 'request_failed', { status = 0, snapshot = null } = {}) {
    const safeCode = typeof code === 'string' && /^[a-z_]{1,60}$/.test(code) ? code : 'request_failed';
    super(MultiplayerErrorMessages[safeCode] || MultiplayerErrorMessages.request_failed);
    this.name = 'MultiplayerError'; this.code = safeCode; this.status = status; this.snapshot = snapshot;
  }
}

export function multiplayerRandomId(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID();
  if (!cryptoImpl?.getRandomValues) throw new MultiplayerError('storage_unavailable');
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A synchronous token generator inside one read/write transaction makes the
// first visit atomic across tabs. No network request can hold this transaction.
export class MultiplayerIdentityStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.opened = null; }
  async open() {
    if (!this.opened) this.opened = new Promise((resolve, reject) => {
      if (!this.indexedDB) { reject(new MultiplayerError('storage_unavailable')); return; }
      let request;
      try { request = this.indexedDB.open('game-of-throws-multiplayer-identity-v1', 1); }
      catch { reject(new MultiplayerError('storage_unavailable')); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('identity');
      request.onerror = request.onblocked = () => reject(new MultiplayerError('storage_unavailable'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.opened = null; };
        resolve(request.result);
      };
    }).catch(error => { this.opened = null; throw error; });
    return this.opened;
  }
  async getOrCreateToken(createToken) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      let token, failure, transaction;
      try {
        transaction = database.transaction('identity', 'readwrite');
        const store = transaction.objectStore('identity'), request = store.get('guest-token');
        request.onsuccess = () => {
          try {
            token = request.result === undefined ? createToken() : request.result;
            if (!MultiplayerTokenPattern.test(token)) throw new MultiplayerError('invalid_identity');
            if (request.result === undefined) store.put(token, 'guest-token');
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(token);
        transaction.onabort = transaction.onerror = () => reject(failure || new MultiplayerError('storage_unavailable'));
      } catch { reject(new MultiplayerError('storage_unavailable')); }
    });
  }
}

export class MultiplayerClient {
  #tokenPromise = null;
  #storage;
  #crypto;
  constructor({ endpoint = '', fetchImpl = globalThis.fetch?.bind(globalThis), storage,
    cryptoImpl = globalThis.crypto, timeoutMs = 10000,
    setTimeoutImpl = globalThis.setTimeout.bind(globalThis), clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis) } = {}) {
    this.endpoint = String(endpoint).trim().replace(/\/+$/, '');
    this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
    this.setTimeoutImpl = setTimeoutImpl; this.clearTimeoutImpl = clearTimeoutImpl;
    this.#crypto = cryptoImpl; this.#storage = storage || new MultiplayerIdentityStore();
  }
  async #token() {
    if (!this.#tokenPromise) this.#tokenPromise = Promise.resolve().then(() => this.#storage.getOrCreateToken(() => {
      if (!this.#crypto?.getRandomValues) throw new MultiplayerError('storage_unavailable');
      return Array.from(this.#crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
    })).then(token => {
      if (!MultiplayerTokenPattern.test(token)) throw new MultiplayerError('invalid_identity');
      return token;
    }).catch(error => {
      this.#tokenPromise = null;
      throw error instanceof MultiplayerError ? error : new MultiplayerError('storage_unavailable');
    });
    return this.#tokenPromise;
  }
  async request(path, { method = 'GET', body } = {}) {
    const token = await this.#token();
    const controller = new AbortController();
    const timer = this.setTimeoutImpl(() => controller.abort(), this.timeoutMs);
    try {
      let response;
      try {
        response = await this.fetchImpl(this.endpoint + path, {
          method, headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal
        });
      } catch { throw new MultiplayerError('network_error'); }
      let value;
      try { value = await response.json(); }
      catch { throw new MultiplayerError('invalid_response', { status: response.status }); }
      if (!response.ok) throw new MultiplayerError(value?.code, { status: response.status, snapshot: value?.snapshot || null });
      return value;
    } finally { this.clearTimeoutImpl(timer); }
  }
  roomPath(roomId) {
    if (typeof roomId !== 'string' || !MultiplayerRoomPattern.test(roomId)) throw new MultiplayerError('invalid_room');
    return `/api/rooms/${encodeURIComponent(roomId)}`;
  }
  createRoom(body) { return this.request('/api/rooms', { method: 'POST', body }); }
  joinRoom(roomId, body) { return this.request(this.roomPath(roomId) + '/join', { method: 'POST', body }); }
  readRoom(roomId) { return this.request(this.roomPath(roomId)); }
  readHistory(roomId, matchId, ply) { return this.request(this.roomPath(roomId) + '/history?' + new URLSearchParams({ matchId, ply })); }
  presence(roomId, body) { return this.request(this.roomPath(roomId) + '/presence', { method: 'POST', body }); }
  leaveRoom(roomId, body) { return this.request(this.roomPath(roomId) + '/leave', { method: 'POST', body }); }
  command(roomId, body) { return this.request(this.roomPath(roomId) + '/commands', { method: 'POST', body }); }
}
