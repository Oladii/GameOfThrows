import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG } from '../dist/rules.js';
import { createGame, move, reachable } from '../dist/engine.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const source = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const declaration = name => app.split('\n').find(line => line.startsWith(`function ${name}(`));
const plain = value => JSON.parse(JSON.stringify(value));
function node() {
  const children = new Map(), events = {};
  return { hidden: false, disabled: false, value: '', textContent: '', dataset: {}, events,
    classList: { toggle() {} }, setAttribute() {}, focus() {}, select() {}, reportValidity() {},
    querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector); },
    addEventListener(type, fn) { events[type] = fn; } };
}
function setup() {
  const nodes = new Map(), storage = new Map(), calls = [], location = { href: 'http://localhost/?theme=light', protocol: 'http:' };
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  const context = vm.createContext({ $, URL, location, navigator: {}, ROOM_STORAGE: 'online', STORAGE: 'local',
    document: { body: node(), querySelectorAll: () => [] }, window: { history: { replaceState(_state, _title, url) { location.href = url; } } },
    localStorage: { getItem: key => storage.get(key), setItem(key, value) { storage.set(key, value); } },
    playMode: 'online', gamePhase: 'playing', editor: false, positionKind: 'default', config: structuredClone(DEFAULT_CONFIG), state: createGame(DEFAULT_CONFIG),
    roomSession: null, roomView: null, roomLocalGame: null, roomTarget: null, roomSnapshot: null, roomConnecting: false, roomLeaving: false, roomError: '',
    currentDeaths: [], deathEffectTimer: null, movement: null, combat: null, reviewingTurn: false, selected: null, hover: null, inspection: null,
    lastTurn: null, history: [], log: [], gameVersion: 'test', CURRENT_GAME_VERSION: 'test', firstMove: 'north', humanTeam: 0,
    botDifficulty: 'training', previousGame: null, startPreferences: null, ready: true, available: [],
    clone: structuredClone, DEFAULT_CONFIG, createGame, TEAM_NAMES: ['Север', 'Юг'], clearTimeout() {}, clearHint() {},
    plural(n, forms) { return n === 1 ? forms[0] : forms[2]; }, toast() {},
    cancelMovement() { calls.push(['cancel']); context.movement = null; context.combat = null; },
    resetBotContext() { context.lastTurn = null; context.reviewingTurn = false; context.movement = null; },
    render() { calls.push(['render']); }, renderOnlineRoom() {},
    presentMove(before, action, deaths) { calls.push(['animation', plain(before), plain(action), plain(deaths)]); context.movement = { active: true }; },
    isBotTurn: () => false, visibleState: () => context.state, clearSelection() { context.selected = null; },
    move() { throw new Error('Online UI must not run a local move'); },
    checkpoint() { throw new Error('Online UI must not record local history'); }
  });
  vm.runInContext(declaration('currentSnapshot') + '\n' + declaration('humanCanMove') + '\n'
    + source('function savedRoomReference()', '\nconst statFields ='), context);
  return { context, $, storage, calls, location };
}
function snapshot(overrides = {}) {
  return { roomId: 'room-a', revision: 1, phase: 'waiting', matchId: null, config: structuredClone(DEFAULT_CONFIG), state: null,
    seats: [null, null], participants: [{ guestId: 'me', name: 'Ира', present: true, seat: null }], self: { guestId: 'me', seat: null },
    lastAction: null, lastResult: null, ...overrides };
}
function view(snap, selfSeat = null, overrides = {}) {
  return { snapshot: snap, selfSeat, status: 'connected', pending: false, error: null,
    canMove: selfSeat !== null && snap.phase === 'playing' && snap.state.turn === selfSeat && snap.state.winner === null, ...overrides };
}

test('spectator lobby has two seats, safe names and no player actions', () => {
  const ui = setup(), snap = snapshot({ seats: [{ guestId: 'a', name: '<img onerror=alert(1)>', ready: true }, null] });
  ui.context.roomView = view(snap); ui.context.renderOnlineRoom();
  assert.equal(ui.$('#room-role').textContent, 'Зритель');
  assert.equal(ui.$('[data-room-seat="0"]').querySelector('[data-seat-name]').textContent, '<img onerror=alert(1)>');
  assert.equal(ui.$('[data-room-seat="0"]').querySelector('[data-claim-seat]').hidden, true);
  assert.equal(ui.$('[data-room-seat="1"]').querySelector('[data-claim-seat]').hidden, false);
  for (const id of ['room-ready', 'room-stand', 'room-finish']) assert.equal(ui.$('#' + id).hidden, true);
  assert.equal(ui.context.humanCanMove(), false);
});

test('seated players can toggle readiness and stand only while waiting', async () => {
  for (const team of [0, 1]) {
    const ui = setup(), snap = snapshot(); snap.seats[team] = { guestId: 'me', name: 'Ира', ready: false };
    ui.context.roomView = view(snap, team); ui.context.roomSession = { setReady: ready => ui.calls.push(['ready', ready]), stand: () => ui.calls.push(['stand']) };
    ui.context.renderOnlineRoom();
    assert.equal(ui.$('#room-ready').hidden, false); assert.equal(ui.$('#room-ready').textContent, 'Готов');
    assert.equal(ui.$('#room-stand').hidden, false);
    await ui.$('#room-ready').events.click(); assert.deepEqual(ui.calls.at(-1), ['ready', true]);
    snap.seats[team].ready = true; ui.context.renderOnlineRoom(); assert.equal(ui.$('#room-ready').textContent, 'Снять готовность');
    await ui.$('#room-ready').events.click(); assert.deepEqual(ui.calls.at(-1), ['ready', false]);
    snap.phase = 'playing'; snap.state = createGame(DEFAULT_CONFIG); ui.context.renderOnlineRoom();
    assert.equal(ui.$('#room-stand').hidden, true); assert.equal(ui.$('#room-ready').hidden, true);
    const count = ui.calls.length; await ui.$('#room-stand').events.click(); assert.equal(ui.calls.length, count);
  }
});

test('either seated player can finish immediately, spectators cannot, including after victory', async () => {
  for (const phase of ['playing', 'won']) for (const team of [null, 0, 1]) {
    const ui = setup(), snap = snapshot({ phase, matchId: 'match', state: createGame(DEFAULT_CONFIG) });
    let finishes = 0; ui.context.roomSession = { endMatch() { finishes++; } }; ui.context.roomView = view(snap, team);
    ui.context.renderOnlineRoom(); assert.equal(ui.$('#room-finish').hidden, team === null);
    await ui.$('#room-finish').events.click(); assert.equal(finishes, team === null ? 0 : 1);
  }
});

test('offline and pending sessions cannot send commands; occupied disconnected seats remain occupied', async () => {
  const ui = setup(), snap = snapshot({ seats: [{ guestId: 'me', name: 'Ира', ready: true }, null] });
  for (const changes of [{ status: 'offline' }, { pending: true }]) {
    ui.context.roomView = view(snap, 0, changes); ui.context.renderOnlineRoom();
    assert.equal(ui.$('#room-ready').disabled, true);
    assert.equal(ui.$('[data-room-seat="0"]').querySelector('[data-claim-seat]').hidden, true);
    let sent = false; await ui.context.runRoomAction(() => { sent = true; }); assert.equal(sent, false);
  }
});

test('a move stays uncommitted until a server snapshot confirms it', async () => {
  const ui = setup(), state = ui.context.state, piece = state.pieces.find(piece => piece.team === state.turn && reachable(piece, state, DEFAULT_CONFIG).length);
  const to = reachable(piece, state, DEFAULT_CONFIG)[0];
  vm.runInContext(source('function onCell(', '\nfunction focusBoardCell('), ui.context);
  ui.context.selected = piece.id; ui.context.available = [to];
  ui.context.roomView = view(snapshot({ phase: 'playing', state }), state.turn);
  let command; ui.context.roomSession = { move(action) { command = action; return new Promise(() => {}); } };
  ui.context.onCell(to.q, to.r);
  assert.deepEqual(plain(command), { id: piece.id, to: { q: to.q, r: to.r } }); assert.equal(ui.context.state, state); assert.equal(ui.context.history.length, 0);
  ui.context.roomView.canMove = false; ui.context.selected = piece.id; command = null; ui.context.onCell(to.q, to.r); assert.equal(command, null);
});

test('only adjacent confirmed moves animate; stale snapshots and old rooms cannot roll back position', () => {
  const ui = setup(), before = createGame(DEFAULT_CONFIG), piece = before.pieces.find(piece => piece.team === before.turn && reachable(piece, before, DEFAULT_CONFIG).length);
  const to = reachable(piece, before, DEFAULT_CONFIG)[0], outcome = move(before, DEFAULT_CONFIG, piece.id, to);
  const initial = snapshot({ revision: 8, phase: 'playing', matchId: 'match', state: before });
  ui.context.applyRoomView(view(initial, before.turn));
  const next = snapshot({ revision: 9, phase: 'playing', matchId: 'match', state: outcome.state,
    lastAction: { revision: 9, matchId: 'match', beforeState: before, action: { id: piece.id, from: outcome.action.from, to }, deaths: outcome.deaths } });
  ui.context.applyRoomView(view(next, before.turn));
  assert.equal(ui.calls.filter(call => call[0] === 'animation').length, 1);
  assert.deepEqual(plain(ui.context.state), outcome.state);
  ui.context.applyRoomView(view(initial, before.turn)); assert.equal(ui.context.roomSnapshot.revision, 9);
  ui.context.applyRoomView(view({ ...next, roomId: 'old-room', revision: 99 }, before.turn)); assert.equal(ui.context.roomSnapshot.roomId, 'room-a');
  ui.context.applyRoomView(view({ ...next, revision: 12 }, before.turn));
  assert.equal(ui.context.movement, null); assert.equal(ui.context.roomSnapshot.revision, 12);
  assert.equal(ui.calls.filter(call => call[0] === 'animation').length, 1);
});

test('same-revision presence refresh preserves animation while updating connection labels', () => {
  const ui = setup(), snap = snapshot({ phase: 'playing', matchId: 'match', state: createGame(DEFAULT_CONFIG), seats: [{ guestId: 'me', name: 'Ира', ready: true }, null] });
  ui.context.applyRoomView(view(snap, 0)); ui.context.movement = { active: true };
  ui.context.applyRoomView(view({ ...snap, participants: [{ guestId: 'me', name: 'Ира', present: false, seat: 0 }] }, 0));
  assert.equal(ui.context.movement.active, true);
  assert.equal(ui.$('[data-room-seat="0"]').querySelector('[data-seat-connection]').textContent, 'Нет связи · место сохранено');
});

test('finish clears displayed seats and readiness, and early finish never claims a winner', () => {
  const ui = setup(), ended = snapshot({ revision: 4, lastResult: { matchId: 'old', status: 'aborted', winner: null } });
  ui.context.applyRoomView(view(ended)); ui.context.renderOnlineRoom();
  assert.equal(ui.context.gamePhase, 'setup'); assert.equal(ui.context.state.winner, null);
  assert.equal(ui.$('#room-last-result').textContent, 'Предыдущая партия завершена без победителя.');
  for (const team of [0, 1]) assert.equal(ui.$(`[data-room-seat="${team}"]`).querySelector('[data-seat-name]').textContent, 'Место свободно');
  assert.equal(ui.$('#room-ready').hidden, true); assert.equal(ui.$('#room-finish').hidden, true);
});

test('online rendering cannot replace local saves and leaving restores the exact local game', async () => {
  const ui = setup();
  vm.runInContext(source('function save()', '\nfunction normalizeUnitNames('), ui.context);
  ui.storage.set('local', 'original'); assert.equal(ui.context.save(), true); assert.equal(ui.storage.get('local'), 'original');
  ui.context.playMode = 'local'; const previous = plain(ui.context.state);
  ui.context.save = () => true; ui.context.openOnlineRoom();
  ui.context.state.ply = 20; ui.context.state.pieces = [];
  ui.context.roomSession = { leave: async () => {}, stop() {} };
  await ui.context.leaveOnlineRoom();
  assert.equal(ui.context.playMode, 'local'); assert.deepEqual(plain(ui.context.state), previous);
  assert.equal(new URL(ui.location.href).searchParams.has('room'), false);
});

test('local and bot permissions remain available, room links contain no session credential', () => {
  const ui = setup();
  for (const mode of ['local', 'bot']) { ui.context.playMode = mode; assert.equal(ui.context.humanCanMove(), true); }
  ui.location.href = 'http://localhost/?theme=light&_fresh=a&_newGame=1#board';
  const url = new URL(ui.context.roomInvitation('room-a'));
  assert.equal(url.searchParams.get('room'), 'room-a'); assert.equal(url.searchParams.get('theme'), 'light');
  assert.equal(url.searchParams.has('_fresh'), false); assert.equal(url.hash, '');
  assert.match(html, /id="room-name"[^>]+maxlength="40"/);
  assert.match(app, /event\.key === 'Tab' && playMode !== 'online'/);
});

test('local undo, start and settings handlers cannot mutate an online match', async () => {
  const ui = setup(), original = plain(ui.context.state);
  ui.context.history = [{ state: { corrupt: true } }];
  vm.runInContext(source("$('#undo').addEventListener", '\nfunction openStartSettings('), ui.context);
  vm.runInContext(source('async function openNewGame(', '\nfunction startGame('), ui.context);
  vm.runInContext(source('function startGame(', "\n$('#start-setup').addEventListener"), ui.context);
  vm.runInContext(source("$('#settings-form').addEventListener('submit'", "\n$('#reset-defaults').addEventListener"), ui.context);
  ui.$('#undo').events.click(); await ui.context.openNewGame(); ui.context.startGame();
  let prevented = false; ui.$('#settings-form').events.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(plain(ui.context.state), original);
  assert.equal(ui.context.history.length, 1); assert.equal(ui.context.playMode, 'online');
});

test('client setup failure releases the entry form with recovery copy', async () => {
  const ui = setup(); ui.$('#room-name').value = 'Ира';
  ui.context.MultiplayerSession = class { constructor() { throw Object.assign(new Error('unavailable'), { code: 'storage_unavailable' }); } };
  await ui.context.connectOnlineRoom();
  assert.equal(ui.context.roomConnecting, false); assert.equal(ui.$('#room-connect').disabled, false);
  assert.match(ui.$('#room-error').textContent, /Разрешите хранение данных/);
  assert.equal(ui.$('#room-retry').hidden, false);
});

test('recovery clears a stale connection error, but a failed connected command keeps its message', () => {
  const ui = setup(), snap = snapshot(); ui.context.applyRoomView(view(snap));
  ui.context.roomError = 'Previous failure';
  ui.context.applyRoomView(view(snap, null, { error: { code: 'revision_conflict' } }));
  assert.equal(ui.context.roomError, 'Previous failure'); assert.equal(ui.$('#room-error').hidden, false);
  ui.context.applyRoomView(view(snap));
  assert.equal(ui.context.roomError, ''); assert.equal(ui.$('#room-error').hidden, true);
  assert.equal(ui.context.roomErrorText({ code: 'storage_unavailable', status: 503 }), 'Сервер комнаты временно недоступен. Подключение восстановится автоматически.');
  assert.match(ui.context.roomErrorText({ code: 'storage_unavailable', status: 0 }), /Разрешите хранение данных/);
});
