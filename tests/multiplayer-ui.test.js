import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, TYPES, LABELS } from '../dist/rules.js';
import { createGame, move, reachable, inspectCell, movementPath, analyze } from '../dist/engine.js';
import { createMovementPlan } from '../dist/move-animation.js';
import { hexGridPoint } from '../dist/board-presentation.js';

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
function setup({ mobile = true } = {}) {
  const nodes = new Map(), storage = new Map(), calls = [], timers = [], location = { href: 'http://localhost/?theme=light', protocol: 'http:' };
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  const context = vm.createContext({ tableRattle: null, MultiplayerSession: class { create() { return Promise.resolve(); } join() { return Promise.resolve(); } stop() {} }, $, URL, location, navigator: {}, ROOM_STORAGE: 'online', STORAGE: 'local',
    document: { body: { ...node(), classList: { toggle() {}, contains: key => mobile && key === 'mobile-game' } }, querySelectorAll: () => [] },
    window: { history: { replaceState(_state, _title, url) { location.href = url; } } },
    START_CUE_DELAY: 240, setTimeout: (callback, delay) => timers.push({ callback, delay }),
    gameAudio: { play: name => calls.push(['sound', name]), playGameStart: isCurrent => { if (isCurrent()) calls.push(['sound', 'game-start']); } },
    localStorage: { getItem: key => storage.get(key), setItem(key, value) { storage.set(key, value); } },
    playMode: 'online', gamePhase: 'playing', editor: false, positionKind: 'default', config: structuredClone(DEFAULT_CONFIG), state: createGame(DEFAULT_CONFIG),
    roomMovePreview: null, roomWantsFirst: true, roomFirstMoveNotices: new Set(), renderFirstMoveNotice() {}, roomSession: null, roomView: null, roomLocalGame: null, roomTarget: null, roomSnapshot: null, roomConnecting: false, roomLeaving: false, roomError: '',
    currentDeaths: [], deathEffectTimer: null, movement: null, combat: null, reviewTurn: null, reviewLoading: false, reviewRequest: 0, reviewingTurn: false, selected: null, hover: null, inspection: null,
    lastTurn: null, history: [], log: [], gameVersion: 'test', CURRENT_GAME_VERSION: 'test', firstMove: 'north', humanTeam: 0,
    BOT_DIFFICULTIES: { training: { label: 'Неопытный' }, normal: { label: 'Опытный' }, hard: { label: 'Воевода' } }, botDifficulty: 'training', previousGame: null, startPreferences: null, ready: true, available: [],
    inspectCell, analyze, clone: structuredClone, DEFAULT_CONFIG, TYPES, LABELS, icon: () => '<svg></svg>', createGame, hexGridPoint, TEAM_NAMES: ['Синие', 'Красные'], clearTimeout() {}, clearHint() {},
    plural(n, forms) { return n % 100 >= 11 && n % 100 <= 14 ? forms[2] : n % 10 === 1 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 ? forms[1] : forms[2]; }, toast() {},
    cancelMovement() { calls.push(['cancel']); context.roomMovePreview = null; context.movement = null; context.combat = null; },
    resetBotContext() { context.lastTurn = null; context.reviewingTurn = false; context.movement = null; },
    render() { calls.push(['render']); }, renderOnlineRoom() {},
    presentMove(before, action, deaths) { calls.push(['animation', plain(before), plain(action), plain(deaths)]); context.movement = { active: true }; },
    isBotTurn: () => false, visibleState: () => context.state, clearSelection() { context.selected = null; },
    move() { throw new Error('Online UI must not run a local move'); },
    checkpoint() { throw new Error('Online UI must not record local history'); }
  });
  vm.runInContext(declaration('point') + '\n' + declaration('currentSnapshot') + '\n' + declaration('humanCanMove') + '\n'
    + source('function matchResult(', 'function renderUpdateNotice(') + source('function savedRoomReference()', '\nconst statFields ='), context);
  return { context, $, storage, calls, timers, location };
}
function snapshot(overrides = {}) {
  return { roomId: 'room-a', roomNumber: 1234, revision: 1, phase: 'waiting', matchId: null, config: structuredClone(DEFAULT_CONFIG), state: null,
    seats: [null, null], participants: [{ guestId: 'me', present: true, seat: null }], self: { guestId: 'me', seat: null },
    lastAction: null, lastResult: null, ...overrides };
}
function view(snap, selfSeat = null, overrides = {}) {
  return { snapshot: snap, selfSeat, status: 'connected', pending: false, error: null,
    canMove: selfSeat !== null && snap.phase === 'playing' && snap.state.turn === selfSeat && snap.state.winner === null, ...overrides };
}

test('the scoreboard offers free sides without rosters, names or player actions', () => {
  const ui = setup(), snap = snapshot(); ui.context.roomView = view(snap); ui.context.renderOnlineRoom();
  const markup = ui.$('#scoreboard').innerHTML;
  assert.match(markup, /aria-label="Синие"><div class="team-card-heading"><span class="team-title">Синие — ожидаем игрока/); assert.match(markup, /aria-label="Красные"><div class="team-card-heading"><span class="team-title">Красные — ожидаем игрока/);
  assert.match(markup, /Играть за синих/); assert.match(markup, /Играть за красных/);
  assert.doesNotMatch(markup, /team-roster|team-count/);
  assert.equal(ui.$('#room-finish').hidden, true);
  assert.equal(ui.$('.board-wrap').hidden, true); assert.equal(ui.context.humanCanMove(), false);
  assert.equal(ui.$('#room-title').textContent, 'Игровая комната #1234');
  assert.doesNotMatch(html, /room-name|room-entry|room-role|room-last-result|room-seats|room-stand|room-ready/);
});

test('desktop preparation keeps the board and puts the seat action in the room card', () => {
  const ui = setup({ mobile: false }), snap = snapshot();
  ui.context.gamePhase = 'setup'; ui.context.roomView = view(snap);
  ui.context.renderOnlineRoom();
  const scoreboard = ui.$('#scoreboard').innerHTML;
  assert.match(scoreboard, /Подготовка<\/span><strong>Ждём игроков/);
  assert.match(scoreboard, /class="team-roster"/);
  assert.doesNotMatch(scoreboard, /data-(claim|stand)-seat/);
  assert.equal(ui.$('#room-seat').textContent, 'Присоединиться к игре');
  assert.equal(ui.$('#room-seat').hidden, false);
  assert.equal(ui.$('.board-wrap').hidden, false);
  assert.equal(ui.$('.board-wrap').inert, true);
  assert.equal(ui.context.humanCanMove(), false);
});

test('each seat assignment and match start play their own sound once for the participating players', () => {
  const first = { guestId: 'first', joinedRevision: 2, ready: true };
  const second = { guestId: 'second', joinedRevision: 4, ready: true };
  const sounds = ui => ui.calls.filter(([type]) => type === 'sound').map(([, name]) => name);
  const playStartCue = ui => {
    assert.deepEqual(ui.timers.map(timer => timer.delay), [240]);
    ui.timers.pop().callback();
  };
  const lobby = snapshot();
  const admitted = snapshot({ revision: 2, seats: [first, null] });
  const changed = snapshot({ revision: 3, seats: [null, first] });
  const playing = snapshot({ revision: 4, phase: 'playing', matchId: 'match', state: createGame(DEFAULT_CONFIG), seats: [second, first] });
  const original = setup({ mobile: false });
  original.context.applyRoomView(view(lobby));
  original.context.applyRoomView(view(admitted, 0));
  original.context.applyRoomView(view(changed, 1));
  assert.deepEqual(sounds(original), ['room-join']);
  original.context.applyRoomView(view(playing, 1));
  original.context.applyRoomView(view(playing, 1));
  original.context.applyRoomView({ ...view(playing, 1), status: 'reconnecting' });
  original.context.applyRoomView(view({ ...playing, revision: 5 }, 1));
  assert.deepEqual(sounds(original), ['room-join', 'room-join']);
  playStartCue(original);
  assert.deepEqual(sounds(original), ['room-join', 'room-join', 'game-start']);
  const joining = setup(), spectator = setup({ mobile: false }), restored = setup({ mobile: false });
  joining.context.applyRoomView(view(changed));
  joining.context.applyRoomView(view(playing, 0));
  spectator.context.applyRoomView(view(changed));
  spectator.context.applyRoomView(view(playing));
  restored.context.applyRoomView(view(playing, 1));
  assert.deepEqual(sounds(joining), ['room-join']);
  playStartCue(joining);
  assert.deepEqual(sounds(joining), ['room-join', 'game-start']);
  assert.equal(spectator.timers.length, 0);
  assert.equal(restored.timers.length, 0);
  assert.deepEqual(sounds(spectator), []);
  assert.deepEqual(sounds(restored), []);
  const retrying = setup({ mobile: false });
  retrying.context.applyRoomView({ ...view(changed, 1), status: 'reconnecting' });
  retrying.context.applyRoomView(view(playing, 1));
  playStartCue(retrying);
  assert.deepEqual(sounds(retrying), ['game-start']);
  const leaving = setup({ mobile: false });
  leaving.context.applyRoomView(view(changed, 1));
  leaving.context.applyRoomView(view(playing, 1));
  leaving.context.roomSnapshot = null;
  playStartCue(leaving);
  assert.deepEqual(sounds(leaving), ['room-join']);
});

test('each online player sees their army below the opponent, spectators keep South below', () => {
  const ui = setup(), before = plain(ui.context.state);
  const averageY = team => {
    const army = ui.context.state.pieces.filter(piece => piece.team === team);
    return army.reduce((sum, piece) => sum + ui.context.point(piece).y, 0) / army.length;
  };
  for (const seat of [0, 1, null]) {
    ui.context.roomView = view(snapshot(), seat);
    assert.ok(averageY(seat ?? 1) > averageY(seat === 0 ? 1 : 0));
  }
  ui.context.playMode = 'local'; ui.context.roomView = view(snapshot(), 0);
  assert.ok(averageY(1) > averageY(0));
  assert.deepEqual(plain(ui.context.state), before, 'orientation must not change game coordinates');
});

test('selecting a side is sufficient; its card offers cancellation only before the second selection', async () => {
  for (const team of [0, 1]) {
    const ui = setup(), snap = snapshot(); snap.seats[team] = { guestId: 'me', ready: true };
    let stands = 0; ui.context.roomView = view(snap, team); ui.context.roomSession = { stand: () => { stands++; } };
    ui.context.renderOnlineRoom();
    const waiting = ui.$('#scoreboard').innerHTML;
    assert.match(waiting, new RegExp(`aria-label="${team === 0 ? 'Синие' : 'Красные'}"><div class="team-card-heading"><span class="team-title">Вы играете за ${team === 0 ? 'Синих' : 'Красных'}`));
    assert.equal((waiting.match(/class="team-roster"/g) || []).length, 0);
    assert.match(waiting, /data-claim-seat="[01]" disabled/);
    assert.match(waiting, new RegExp(`data-stand-seat="${team}"`)); assert.match(waiting, /Отменить выбор/);
    assert.doesNotMatch(waiting, /ГОТОВ|НЕ ГОТОВ/);
    const event = { target: { closest: () => ({ dataset: { standSeat: String(team) }, disabled: false }) } };
    await ui.$('#scoreboard').events.click(event); assert.equal(stands, 1);
    snap.phase = 'playing'; snap.state = createGame(DEFAULT_CONFIG); snap.seats[1 - team] = { guestId: 'other', ready: true };
    ui.context.renderOnlineRoom(); assert.equal(ui.$('.board-wrap').hidden, false);
    assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /data-stand-seat|data-claim-seat/);
    await ui.$('#scoreboard').events.click(event); assert.equal(stands, 1);
    assert.equal((ui.$('#scoreboard').innerHTML.match(/class="team-roster"/g) || []).length, 2);
  }
});

test('only seated players can resign while playing or clear a completed result', async () => {
  for (const phase of ['playing', 'won']) for (const team of [null, 0, 1]) {
    const ui = setup(), snap = snapshot({ phase, matchId: 'match', state: createGame(DEFAULT_CONFIG) });
    const actions = []; ui.context.roomSession = { endMatch() { actions.push('finish'); }, resign() { actions.push('resign'); } }; ui.context.roomView = view(snap, team);
    ui.context.renderOnlineRoom(); assert.equal(ui.$('#room-finish').hidden, team === null);
    await ui.$('#room-finish').events.click();
    assert.deepEqual(actions, team === null ? [] : [phase === 'playing' ? 'resign' : 'finish']);
  }
});

test('offline and pending sessions cannot send commands; occupied disconnected seats remain occupied', async () => {
  const ui = setup(), snap = snapshot({ seats: [{ guestId: 'me', ready: true }, null] });
  for (const changes of [{ status: 'offline' }, { pending: true }]) {
    ui.context.roomView = view(snap, 0, changes); ui.context.renderOnlineRoom();
    assert.match(ui.$('#scoreboard').innerHTML, /data-stand-seat="0" disabled/);
    assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /data-claim-seat="0"/);
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
  const ui = setup(), snap = snapshot({ phase: 'playing', matchId: 'match', state: createGame(DEFAULT_CONFIG), seats: [{ guestId: 'me', ready: true }, null] });
  ui.context.applyRoomView(view(snap, 0)); ui.context.movement = { active: true };
  ui.context.applyRoomView(view({ ...snap, participants: [{ guestId: 'me', present: false, seat: 0 }] }, 0));
  assert.equal(ui.context.movement.active, true);
  assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /Нет связи/);
  ui.context.movement = null; ui.context.renderOnlineRoom();
  assert.match(ui.$('#move-counter').textContent, /Нет связи с вами/);
});

test('finish clears displayed seats and readiness, and early finish never claims a winner', () => {
  const ui = setup(), ended = snapshot({ revision: 4, lastResult: { matchId: 'old', status: 'aborted', winner: null } });
  ui.context.applyRoomView(view(ended)); ui.context.renderOnlineRoom();
  assert.equal(ui.context.gamePhase, 'setup'); assert.equal(ui.context.state.winner, null);
  assert.equal(ui.$('.board-wrap').hidden, true);
  assert.equal((ui.$('#scoreboard').innerHTML.match(/ожидаем игрока/g) || []).length, 2);
  assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /Победа|победа/);
  assert.equal(ui.$('#room-finish').hidden, true);
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
  assert.doesNotMatch(html, /id="room-link"/);
  assert.match(html, /Копировать ссылку на комнату/);
  assert.doesNotMatch(app, /event\.key === 'Tab'.*event\.preventDefault/);
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

test('initial room failures explain how to reconnect without a retry button', async () => {
  const ui = setup();
  ui.context.MultiplayerSession = class { constructor() { throw Object.assign(new Error('unavailable'), { code: 'storage_unavailable' }); } };
  await ui.context.connectOnlineRoom();
  assert.equal(ui.context.roomConnecting, false);
  assert.match(ui.$('#room-error').textContent, /Разрешите хранение данных/);
  assert.doesNotMatch(html, /id="room-retry"/);
  assert.match(ui.context.roomErrorText({ code: 'network_error' }), /создать комнату. Обновите страницу/);
  assert.match(ui.context.roomErrorText({ code: 'invalid_response' }), /создать комнату. Обновите страницу/);
  ui.context.roomTarget = 'room-a';
  assert.match(ui.context.roomErrorText({ code: 'network_error' }), /войти в комнату. Обновите страницу/);
});

test('a standalone file directs players to the web build before contacting the room API', async () => {
  const ui = setup({ mobile: false });
  ui.location.protocol = 'file:';
  ui.context.MultiplayerSession = class { constructor() { assert.fail('file origins cannot use the room API'); } };
  await ui.context.connectOnlineRoom();
  assert.equal(ui.$('#room-banner').textContent, 'Для игры по ссылке откройте веб‑версию игры.');
});

test('recovery clears a stale connection error, but a failed connected command keeps its message', () => {
  const ui = setup(), snap = snapshot(); ui.context.applyRoomView(view(snap));
  ui.context.roomError = 'Previous failure';
  ui.context.applyRoomView(view(snap, null, { error: { code: 'revision_conflict' } }));
  assert.equal(ui.context.roomError, 'Previous failure'); assert.equal(ui.$('#room-error').hidden, false);
  ui.context.applyRoomView(view(snap));
  assert.equal(ui.context.roomError, ''); assert.equal(ui.$('#room-error').hidden, true);
  assert.equal(ui.context.roomErrorText({ code: 'storage_unavailable', status: 503 }), 'Нет связи с комнатой. Восстанавливаем подключение…');
  assert.match(ui.context.roomErrorText({ code: 'storage_unavailable', status: 0 }), /Разрешите хранение данных/);
});

test('the room counts players and spectators with Russian plurals and no duplicate seat panel', () => {
  const ui = setup(), snap = snapshot({ seats: [{ guestId: 'me', ready: true }, { guestId: 'other', ready: true }],
    participants: [{ guestId: 'me', present: true, seat: 0 }, { guestId: 'other', present: true, seat: 1 }, { guestId: 'viewer', present: true, seat: null }] });
  ui.context.roomView = view(snap, 0); ui.context.renderOnlineRoom();
  assert.equal(ui.$('#room-participants').textContent, '2 игрока и 1 зритель');
  assert.match(ui.$('#scoreboard').innerHTML, /aria-label="Синие"><div class="team-card-heading"><span class="team-title">Вы играете за Синих/); assert.match(ui.$('#scoreboard').innerHTML, /aria-label="Красные"><div class="team-card-heading"><span class="team-title">Соперник играет за Красных/);
  assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /data-claim-seat/);
});

test('closed state hides game actions and asks for a reload', () => {
  const ui = setup(), snap = snapshot({ phase: 'playing', matchId: 'old', state: createGame(DEFAULT_CONFIG), seats: [{ guestId: 'me', ready: true }, null] });
  ui.context.roomTarget = snap.roomId; ui.context.roomView = view(snap, 0, { status: 'closed', canMove: false, error: { code: 'room_not_found' } });
  ui.context.renderOnlineRoom();
  assert.equal(ui.$('.board-wrap').hidden, true); assert.equal(ui.$('#room-finish').hidden, true);
  assert.equal(ui.$('#room-error').textContent, 'Комната закрыта. Обновите страницу, чтобы войти снова.');
  assert.doesNotMatch(html, /id="room-retry"/);
});

test('room entry and invitation URLs connect automatically without a name', async () => {
  for (const roomId of [null, 'room-a']) {
    const ui = setup(), calls = []; ui.context.playMode = 'local'; ui.context.save = () => true;
    ui.context.MultiplayerSession = class { create(...args) { calls.push(['create', args]); return Promise.resolve(); } join(...args) { calls.push(['join', args]); return Promise.resolve(); } };
    ui.context.openOnlineRoom(roomId); await Promise.resolve();
    assert.deepEqual(calls, roomId ? [['join', ['room-a']]] : [['create', []]]);
    ui.context.rememberRoom('room-a'); assert.deepEqual(JSON.parse(ui.storage.get('online')), { roomId: 'room-a' });
  }
});

test('selecting online mode waits for Start before creating a room', () => {
  const ui = setup(); ui.context.playMode = 'local'; ui.context.gamePhase = 'setup'; ui.context.refreshingNewGame = false;
  let opened = 0; ui.context.openOnlineRoom = () => { opened++; };
  vm.runInContext(app.split('\n').find(line => line.startsWith("$('#play-mode').addEventListener")), ui.context);
  vm.runInContext(source('function startGame(', "\n$('#start-setup').addEventListener"), ui.context);
  ui.$('#play-mode').value = 'online'; ui.$('#play-mode').events.change({ target: { value: 'online' } });
  assert.equal(opened, 0); assert.equal(ui.context.playMode, 'local');
  ui.context.startGame(); assert.equal(opened, 1);
});

test('team cards contain identities rather than duplicate turn statuses', () => {
  for (const selfSeat of [0, 1, null]) for (const turn of [0, 1]) {
    const ui = setup(), position = createGame(DEFAULT_CONFIG); position.turn = turn;
    const snap = snapshot({ phase: 'playing', state: position, seats: [{ guestId: 'blue' }, { guestId: 'red' }],
      participants: [{ guestId: 'blue', present: true, seat: 0 }, { guestId: 'red', present: true, seat: 1 }] });
    ui.context.state = position; ui.context.roomView = view(snap, selfSeat); ui.context.renderOnlineRoom();
    assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /turn-tag|Ваш ход|Ход соперника|Ожидает вашего хода/);
    for (const team of [0, 1]) assert.ok(ui.$('#scoreboard').innerHTML.includes(`${team === selfSeat ? 'Вы играете за' : selfSeat === null ? 'Игрок за' : 'Соперник играет за'} ${team ? 'Красных' : 'Синих'}`));
  }
});

test('the turn line omits a seated player color while retaining the spectator role', () => {
  const ui = setup();
  const caption = app.split('\n').find(line => line.includes("$('#mode-caption').textContent = playMode"));
  for (const selfSeat of [0, 1, null]) {
    ui.context.roomView = view(snapshot(), selfSeat); vm.runInContext(caption, ui.context);
    assert.equal(ui.$('#mode-caption').textContent, selfSeat === null ? 'По ссылке · зритель' : 'По ссылке');
  }
});

test('rejoining restores read-only last-turn controls and new server state ends the review', () => {
  for (const seat of [0, 1, null]) {
    const ui = setup(), before = createGame(DEFAULT_CONFIG);
    const piece = before.pieces.find(p => p.team === before.turn && reachable(p, before, DEFAULT_CONFIG).length);
    const to = reachable(piece, before, DEFAULT_CONFIG)[0], outcome = move(before, DEFAULT_CONFIG, piece.id, to);
    const snap = snapshot({ revision: 9, phase: 'playing', matchId: 'match', state: outcome.state,
      lastAction: { revision: 9, matchId: 'match', beforeState: before, action: { id: piece.id, from: outcome.action.from, to }, deaths: outcome.deaths } });
    ui.context.applyRoomView(view(snap, seat));
    assert.deepEqual(plain(ui.context.lastTurn.before.state), before);
    assert.equal(ui.calls.some(call => call[0] === 'animation'), false, 'rejoin must not auto-animate history');
    ui.context.cancelBot = () => {};
    Object.assign(ui.context, { movementPath, analyze, createMovementPlan, matchMedia: () => ({ matches: true }),
      gameAudio: { movement: () => ({ finish() {} }) } });
    vm.runInContext(source('function completeMovementPresentation(', 'function presentMove('), ui.context);
    vm.runInContext(declaration('visibleState') + '\n' + source('function reviewBattle(', 'function lastTurnFromHistory(') + source('function canReviewPrevious()', "$('#review-previous').addEventListener") + '\n' + app.split("\n").filter(line => line.startsWith("$('#review-")).join("\n"), ui.context);
    const confirmed = plain(ui.context.state);
    ui.$('#review-previous').events.click();
    assert.equal(ui.context.reviewingTurn, true); assert.equal(ui.context.humanCanMove(), false);
    const shown = plain(ui.context.visibleState());
    assert.deepEqual(shown, before);
    assert.deepEqual(shown.pieces.find(p => p.id === piece.id), piece);
    assert.deepEqual(plain(ui.context.lastTurn.before.state), before, 'replay keeps the original move input');
    assert.deepEqual(plain(ui.context.state), confirmed, 'review never replaces the authoritative state');
    ui.$('#review-current').events.click();
    assert.deepEqual(plain(ui.context.visibleState()), confirmed);
    ui.$('#review-previous').events.click();
    ui.context.applyRoomView(view({ ...snap, revision: 10 }, seat));
    assert.equal(ui.context.reviewingTurn, false);
    assert.deepEqual(plain(ui.context.state), confirmed);
    for (const id of ['review-previous', 'review-current']) assert.equal(ui.$('#' + id).hidden, false);
    ui.context.applyRoomView(view(snapshot({ revision: 11 }), seat)); ui.context.renderOnlineRoom();
    assert.equal(ui.context.lastTurn, null);
    for (const id of ['review-previous', 'review-current']) assert.equal(ui.$('#' + id).hidden, true);
  }
});

test('copy button copies only the invitation and reports clipboard failure', async () => {
  const ui = setup(); ui.context.roomView = view(snapshot());
  let copied = '', message = '';
  ui.context.navigator.clipboard = { async writeText(text) { copied = text; } };
  ui.context.toast = text => { message = text; };
  await ui.$('#room-copy').events.click();
  assert.equal(new URL(copied).searchParams.get('room'), 'room-a');
  assert.equal(message, 'Ссылка скопирована.');
  ui.context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await ui.$('#room-copy').events.click();
  assert.match(message, /Не удалось скопировать ссылку/);
});

function setupReview() {
  const ui = setup(); ui.context.cancelBot = () => {};
  vm.runInContext(declaration('visibleState') + '\n' + source('function reviewBattle(', 'function lastTurnFromHistory(') + source('function canReviewPrevious()', "$('#review-previous').addEventListener"), ui.context);
  return ui;
}
test('arrows traverse every online position both ways without changing the live match', async () => {
  for (const seat of [0, 1, null]) {
    const ui = setupReview(), positions = Array.from({ length: 45 }, (_, ply) => ({ ...createGame(DEFAULT_CONFIG), ply, turn: ply % 2 }));
    const action = { id: 'piece', from: { q: 0, r: 0 }, to: { q: 0, r: 1 } };
    const snap = snapshot({ phase: 'playing', revision: 50, matchId: 'match', state: positions[44], lastAction: { matchId: 'match', beforeState: positions[43], action } });
    ui.context.applyRoomView(view(snap, seat));
    const requested = [];
    ui.context.roomSession = { async historyPosition(ply) { requested.push(ply); return { state: positions[ply], action }; } };
    for (let ply = 43; ply >= 0; ply--) {
      await ui.context.stepReview(-1);
      assert.equal(ui.context.visibleState().ply, ply); assert.equal(ui.context.humanCanMove(), false);
      assert.deepEqual(plain(ui.context.state), positions[44]);
    }
    assert.equal(ui.context.canReviewPrevious(), false);
    await ui.context.stepReview(-1); assert.equal(ui.context.visibleState().ply, 0);
    for (let ply = 1; ply <= 44; ply++) { await ui.context.stepReview(1); assert.equal(ui.context.visibleState().ply, ply); }
    assert.equal(ui.context.reviewingTurn, false); assert.ok(requested.includes(0));
  }
});
test('a delayed history reply cannot overwrite a newer server position; failed loads can retry', async () => {
  const ui = setupReview(), state = { ...createGame(DEFAULT_CONFIG), ply: 4 };
  const snap = snapshot({ phase: 'playing', revision: 6, matchId: 'match', state });
  ui.context.applyRoomView(view(snap, 0));
  let resolve;
  ui.context.roomSession = { historyPosition: () => new Promise(done => { resolve = done; }) };
  const pending = ui.context.stepReview(-1);
  assert.equal(ui.context.reviewLoading, true); assert.equal(ui.context.humanCanMove(), false);
  ui.context.applyRoomView(view({ ...snap, revision: 7, state: { ...state, ply: 5 } }, 0));
  resolve({ state: { ...state, ply: 3 } }); await pending;
  assert.equal(ui.context.visibleState().ply, 5); assert.equal(ui.context.reviewingTurn, false);
  assert.equal(ui.context.reviewLoading, false);
  ui.context.roomSession = { historyPosition: async () => { throw new Error('offline'); } };
  await ui.context.stepReview(-1); assert.equal(ui.context.visibleState().ply, 5);
  assert.equal(ui.context.reviewLoading, false); assert.equal(ui.context.canReviewPrevious(), true);
});
test('local history retains and traverses more than forty moves', async () => {
  const ui = setupReview(); ui.context.playMode = 'local';
  vm.runInContext(declaration('checkpoint'), ui.context);
  const action = { pass: true };
  for (let ply = 0; ply < 45; ply++) { ui.context.state.ply = ply; ui.context.checkpoint('human', action); }
  ui.context.state.ply = 45;
  assert.equal(ui.context.history.length, 45);
  for (let ply = 44; ply >= 0; ply--) { await ui.context.stepReview(-1); assert.equal(ui.context.visibleState().ply, ply); }
  for (let ply = 1; ply <= 45; ply++) { await ui.context.stepReview(1); assert.equal(ui.context.visibleState().ply, ply); }
  assert.equal(ui.context.reviewingTurn, false);
});

test('history arrows cannot interrupt the current live combat', async () => {
  const ui=setupReview();
  ui.context.state.ply=5;
  ui.context.combat={visiblePosition:ui.context.state};
  await ui.context.stepReview(-1); await ui.context.stepReview(1);
  assert.equal(ui.context.reviewTurn,null);
  assert.equal(ui.context.canReviewPrevious(),false);
  vm.runInContext(source('function setFooterDisabled(', '\nfunction requestHint(') + '\n'
    + source('  const reviewBlocked =', "  $('#resume-bot').hidden"), ui.context);
  assert.equal(ui.$('#review-current').disabled,true);
});

test('the room card is absent outside online mode; room creation stays in start settings', () => {
  const ui=setup(); ui.context.playMode='local'; ui.context.renderOnlineRoom();
  assert.equal(ui.$('.multiplayer-panel').hidden,true);
  assert.doesNotMatch(html,/id="room-open"/);
  assert.doesNotMatch(html,/id="replay-combat"/);
  assert.match(html,/<option value="online">Вдвоём по ссылке<\/option>/);
  ui.context.playMode='online'; ui.context.renderOnlineRoom();
  assert.equal(ui.$('.multiplayer-panel').hidden,false);
  ui.context.playMode='bot'; ui.context.renderOnlineRoom();
  assert.equal(ui.$('.multiplayer-panel').hidden,true);
});

test('online start names room creation and start buttons have no arrow decoration', () => {
  const ui=setup();
  const label=app.split('\n').find(line=>line.includes("$('#start-game').textContent ="));
  vm.runInContext('let choosingOnline=true;'+label,ui.context);
  assert.equal(ui.$('#start-game').textContent,'Создать комнату');
  vm.runInContext('choosingOnline=false;'+label,ui.context);
  assert.equal(ui.$('#start-game').textContent,'Начать');
  assert.doesNotMatch(html,/↗/);
});

test('only the player who lost a contested first move sees the dialog, once per match', () => {
  const ui = setup(); let shown = 0;
  const dialog = ui.$('#first-move-dialog');
  dialog.open = false; dialog.showModal = () => { dialog.open = true; shown++; }; dialog.close = () => { dialog.open = false; };
  vm.runInContext(source('function renderFirstMoveNotice()', 'function renderOnlineRoom()'), ui.context);
  const snap = snapshot({ phase: 'playing', matchId: 'match-one', state: createGame(DEFAULT_CONFIG), firstMove: { team: 0, contested: true } });
  ui.context.roomView = view(snap, null); ui.context.renderFirstMoveNotice(); assert.equal(shown, 0);
  ui.context.roomView = view(snap, 0); ui.context.renderFirstMoveNotice(); assert.equal(shown, 0);
  ui.context.roomView = view(snap, 1); ui.context.renderFirstMoveNotice(); assert.equal(shown, 1);
  assert.equal(ui.$('#first-move-message').textContent, 'Синий тоже хотел ходить первым, и удача оказалась на его стороне.');
  dialog.close(); ui.context.renderFirstMoveNotice(); assert.equal(shown, 1);
  snap.matchId = 'match-two'; snap.firstMove.team = 1; ui.context.roomView = view(snap, 0);
  ui.context.renderFirstMoveNotice(); assert.equal(shown, 2);
  assert.match(ui.$('#first-move-message').textContent, /^Красный тоже/);
  snap.firstMove.contested = false; ui.context.renderFirstMoveNotice(); assert.equal(dialog.open, false);
});

test('first move checkbox is available while waiting and carries the choice with the seat', () => {
  const ui = setup(), snap = snapshot(); ui.context.roomView = view(snap);
  ui.context.renderOnlineRoom();
  assert.equal(ui.$('#room-first-choice').hidden, false); assert.equal(ui.$('#room-wants-first').checked, true);
  const claims = []; ui.context.roomSession = { claimSeat: (...args) => claims.push(args) };
  ui.context.runRoomAction = task => task(); ui.context.roomWantsFirst = false;
  vm.runInContext(source("$('#scoreboard').addEventListener", "$('#room-wants-first').addEventListener"), ui.context);
  ui.$('#scoreboard').events.click({ target: { closest: () => ({ dataset: { claimSeat: '1' }, disabled: false }) } });
  assert.deepEqual(claims, [[1, false]]);
  ui.context.roomView = view(snapshot({ phase: 'playing', state: createGame(DEFAULT_CONFIG) }), 0);
  ui.context.renderOnlineRoom(); assert.equal(ui.$('#room-first-choice').hidden, true);
});

 test('bot difficulty belongs to its team title, including Voivode without a suffix', () => {
  const ui = setup(); ui.context.playMode = 'bot'; ui.context.humanTeam = 1;
  for (const [difficulty, label] of [['training','Неопытный бот'],['normal','Опытный бот'],['hard','Воевода']]) {
    ui.context.botDifficulty = difficulty; ui.context.renderScoreboard(ui.context.state);
    assert.match(ui.$('#scoreboard').innerHTML, new RegExp(`aria-label="Синие"><div class="team-card-heading"><span class="team-title">${label} играет за Синих`));
    assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /воевода бот/);
  }
});
test('when neither wants the first move only the selected starter sees the notice', () => {
  const ui = setup(), dialog = ui.$('#first-move-dialog');
  dialog.open = false; dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  vm.runInContext(source('function renderFirstMoveNotice()', 'function renderOnlineRoom()'), ui.context);
  for (const team of [0,1]) {
    const snap = snapshot({ phase: 'playing', state: createGame(DEFAULT_CONFIG), matchId: 'neither-' + team, seats: [{ wantsFirst: false }, { wantsFirst: false }], firstMove: { team, contested: false } });
    ui.context.roomView = view(snap, 1-team); ui.context.renderFirstMoveNotice(); assert.equal(dialog.open, false);
    ui.context.roomView = view(snap, team); ui.context.renderFirstMoveNotice(); assert.equal(dialog.open, true);
    assert.equal(ui.$('#first-move-message').textContent, `Никто не хотел ходить первым, но удача оказалась на стороне ${team === 0 ? 'Синего' : 'Красного'}.`);
    dialog.close(); ui.context.renderFirstMoveNotice(); assert.equal(dialog.open, false);
  }
});

function instantRoomSetup(instant = false) {
  const ui = setup(), ctx = ui.context;
  let finishRequest, failRequest;
  const request = new Promise((resolve, reject) => { finishRequest = resolve; failRequest = reject; });
  Object.assign(ctx, { movementPath, analyze, createMovementPlan, matchMedia: () => ({ matches: instant }),
    gameAudio: { movement() { return { finish() {}, cancel() {} }; } },
    moveAnimator: { start() { ui.calls.push(['start-animation']); } },
    presentKills(before, forecast, deaths) { ui.calls.push(['confirmed-combat', plain(deaths)]); ctx.render(); } });
  vm.runInContext(source('function completeMovementPresentation(', 'function presentKills('), ctx);
  vm.runInContext(declaration('visibleState'), ctx);
  vm.runInContext(source('function canReviewPrevious()', 'async function stepReview('), ctx);
  const before = createGame(DEFAULT_CONFIG);
  const piece = before.pieces.find(p => p.team === before.turn && reachable(p, before, DEFAULT_CONFIG).length);
  const to = reachable(piece, before, DEFAULT_CONFIG)[0], action = { id: piece.id, to: { q: to.q, r: to.r } };
  const initial = snapshot({ revision: 10, phase: 'playing', matchId: 'instant-match', state: before });
  ctx.applyRoomView(view(initial, before.turn));
  ctx.roomSession = { move() { ui.calls.push(['request']); return request; } };
  const outcome = move(before, DEFAULT_CONFIG, piece.id, to);
  const next = snapshot({ revision: 11, phase: 'playing', matchId: initial.matchId, state: outcome.state,
    lastAction: { revision: 11, matchId: initial.matchId, beforeState: before,
      action: { ...action, from: outcome.action.from }, deaths: outcome.deaths } });
  return { ...ui, ctx, before, piece, to, action, next, initial, finishRequest, failRequest,
    complete() { const completed = ctx.movement; ctx.movement = null; ctx.completeMovementPresentation(completed); } };
}

test('own move starts before the server replies, holds at destination, and never resolves combat locally', async () => {
  const ui = instantRoomSetup(), request = ui.ctx.sendRoomMove(ui.action);
  assert.deepEqual(ui.calls.slice(-2).map(call => call[0]), ['start-animation', 'request']);
  assert.equal(ui.ctx.humanCanMove(), false);
  assert.deepEqual(plain(ui.ctx.state), ui.before);
  ui.complete();
  const shown = ui.ctx.visibleState().pieces.find(p => p.id === ui.piece.id);
  assert.deepEqual([shown.q, shown.r], [ui.to.q, ui.to.r]);
  assert.equal(ui.calls.some(call => call[0] === 'confirmed-combat'), false);
  assert.equal(ui.ctx.canReviewPrevious(), false);
  assert.equal(ui.ctx.canStepReview(), false);
  assert.deepEqual(plain(ui.ctx.state), ui.before);
  ui.ctx.applyRoomView(view(ui.next, ui.before.turn));
  assert.equal(ui.calls.filter(call => call[0] === 'start-animation').length, 1);
  assert.equal(ui.calls.filter(call => call[0] === 'confirmed-combat').length, 1);
  assert.deepEqual(plain(ui.ctx.state), ui.next.state);
  assert.equal(ui.ctx.roomMovePreview, null);
  ui.finishRequest(); await request;
});

test('a fast server acknowledgement preserves the running movement and starts combat only once it finishes', async () => {
  const ui = instantRoomSetup(), request = ui.ctx.sendRoomMove(ui.action), moving = ui.ctx.movement;
  ui.ctx.applyRoomView(view(ui.next, ui.before.turn));
  assert.equal(ui.ctx.movement, moving);
  assert.equal(ui.ctx.roomMovePreview.confirmed, true);
  assert.equal(ui.calls.some(call => call[0] === 'confirmed-combat'), false);
  ui.complete(); ui.finishRequest(); await request;
  assert.equal(ui.calls.filter(call => call[0] === 'start-animation').length, 1);
  assert.equal(ui.calls.filter(call => call[0] === 'confirmed-combat').length, 1);
  assert.equal(ui.ctx.roomMovePreview, null);
});

test('a rejected move rolls the display back to confirmed state without a local combat or history entry', async () => {
  const ui = instantRoomSetup(), request = ui.ctx.sendRoomMove(ui.action);
  ui.complete(); ui.failRequest(Object.assign(new Error('offline'), { code: 'network_error' })); await request;
  assert.equal(ui.ctx.roomMovePreview, null);
  assert.deepEqual(plain(ui.ctx.visibleState()), ui.before);
  assert.equal(ui.ctx.history.length, 0);
  assert.equal(ui.calls.some(call => call[0] === 'confirmed-combat'), false);
});

test('reduced motion previews instantly but still waits for authoritative combat', async () => {
  const ui = instantRoomSetup(true), request = ui.ctx.sendRoomMove(ui.action);
  assert.equal(ui.ctx.movement, null);
  assert.equal(ui.ctx.roomMovePreview.completed, true);
  assert.equal(ui.calls.some(call => call[0] === 'confirmed-combat'), false);
  ui.ctx.applyRoomView(view(ui.next, ui.before.turn)); ui.finishRequest(); await request;
  assert.equal(ui.ctx.roomMovePreview, null);
  assert.equal(ui.calls.filter(call => call[0] === 'confirmed-combat').length, 1);
});

test('a different authoritative move cancels the preview, and a late request error cannot roll it back', async () => {
  const ui = instantRoomSetup(), request = ui.ctx.sendRoomMove(ui.action);
  const others = ui.before.pieces.filter(p => p.team === ui.before.turn && p.id !== ui.piece.id && reachable(p, ui.before, DEFAULT_CONFIG).length);
  const p = others[0], to = reachable(p, ui.before, DEFAULT_CONFIG)[0], outcome = move(ui.before, DEFAULT_CONFIG, p.id, to);
  const different = { ...ui.next, state: outcome.state,
    lastAction: { ...ui.next.lastAction, action: { id: p.id, from: outcome.action.from, to }, deaths: outcome.deaths } };
  ui.ctx.applyRoomView(view(different, ui.before.turn));
  assert.equal(ui.ctx.roomMovePreview, null);
  const authoritativeMovement = ui.ctx.movement;
  ui.failRequest(Object.assign(new Error('conflict'), { code: 'revision_conflict' })); await request;
  assert.deepEqual(plain(ui.ctx.state), outcome.state);
  assert.equal(ui.ctx.movement, authoritativeMovement);
});

test('finished matches keep the team rows in layout under one shared result', () => {
  for (const mode of ['bot', 'local', 'online']) for (const winner of [0, 1, 'draw']) {
    const ui = setup(), position = createGame(DEFAULT_CONFIG); position.winner = winner;
    ui.context.playMode = mode;
    ui.context.roomView = view(snapshot({ phase: 'won', state: position, seats: [{ guestId: 'blue' }, { guestId: 'red' }] }), 0);
    ui.context.renderScoreboard(position);
    const labels = [...ui.$('#scoreboard').innerHTML.matchAll(/<div class="turn-tag">([^<]*)<\/div>/g)].map(match => match[1]);
    assert.deepEqual(labels, []);
    const markup = ui.$('#scoreboard').innerHTML;
    assert.equal((markup.match(/class="team-card (north|south) /g) || []).length, 2);
    assert.equal((markup.match(/class="team-card match-result /g) || []).length, 1);
    assert.match(markup, /match-result/);
    assert.doesNotMatch(markup, /data-claim-seat|data-stand-seat/);
    assert.ok(markup.includes(winner === 'draw' ? 'Поражение обеих сторон' : `Победили ${winner === 0 ? 'Синие' : 'Красные'}`));
  }
});
test('team results stay hidden during combat, movement, history, setup and unconfirmed moves', () => {
  for (const fields of [{ movement: {} }, { combat: {} }, { currentDeaths: [{}] }, { reviewingTurn: true }, { editor: true }, { gamePhase: 'setup' }, { roomMovePreview: {} }]) {
    const ui = setup(), position = createGame(DEFAULT_CONFIG); position.winner = 0;
    ui.context.playMode = 'bot'; Object.assign(ui.context, fields); ui.context.renderScoreboard(position);
    assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /Победили|Поражение|match-result/);
  }
});
