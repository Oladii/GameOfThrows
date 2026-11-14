import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, TYPES, LABELS } from '../dist/rules.js';
import { createGame, move, reachable } from '../dist/engine.js';
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
function setup() {
  const nodes = new Map(), storage = new Map(), calls = [], location = { href: 'http://localhost/?theme=light', protocol: 'http:' };
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); };
  const context = vm.createContext({ MultiplayerSession: class { create() { return Promise.resolve(); } join() { return Promise.resolve(); } stop() {} }, $, URL, location, navigator: {}, ROOM_STORAGE: 'online', STORAGE: 'local',
    document: { body: node(), querySelectorAll: () => [] }, window: { history: { replaceState(_state, _title, url) { location.href = url; } } },
    localStorage: { getItem: key => storage.get(key), setItem(key, value) { storage.set(key, value); } },
    playMode: 'online', gamePhase: 'playing', editor: false, positionKind: 'default', config: structuredClone(DEFAULT_CONFIG), state: createGame(DEFAULT_CONFIG),
    roomSession: null, roomView: null, roomLocalGame: null, roomTarget: null, roomSnapshot: null, roomConnecting: false, roomLeaving: false, roomError: '',
    currentDeaths: [], deathEffectTimer: null, movement: null, combat: null, reviewingTurn: false, selected: null, hover: null, inspection: null,
    lastTurn: null, history: [], log: [], gameVersion: 'test', CURRENT_GAME_VERSION: 'test', firstMove: 'north', humanTeam: 0,
    botDifficulty: 'training', previousGame: null, startPreferences: null, ready: true, available: [],
    clone: structuredClone, DEFAULT_CONFIG, TYPES, LABELS, icon: () => '<svg></svg>', createGame, hexGridPoint, TEAM_NAMES: ['Синие', 'Красные'], clearTimeout() {}, clearHint() {},
    plural(n, forms) { return n % 100 >= 11 && n % 100 <= 14 ? forms[2] : n % 10 === 1 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 ? forms[1] : forms[2]; }, toast() {},
    cancelMovement() { calls.push(['cancel']); context.movement = null; context.combat = null; },
    resetBotContext() { context.lastTurn = null; context.reviewingTurn = false; context.movement = null; },
    render() { calls.push(['render']); }, renderOnlineRoom() {},
    presentMove(before, action, deaths) { calls.push(['animation', plain(before), plain(action), plain(deaths)]); context.movement = { active: true }; },
    isBotTurn: () => false, visibleState: () => context.state, clearSelection() { context.selected = null; },
    move() { throw new Error('Online UI must not run a local move'); },
    checkpoint() { throw new Error('Online UI must not record local history'); }
  });
  vm.runInContext(declaration('point') + '\n' + declaration('currentSnapshot') + '\n' + declaration('humanCanMove') + '\n'
    + source('function savedRoomReference()', '\nconst statFields ='), context);
  return { context, $, storage, calls, location };
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
  assert.match(markup, /Синие — Ожидаем игрока/); assert.match(markup, /Красные — Ожидаем игрока/);
  assert.match(markup, /Играть за синих/); assert.match(markup, /Играть за красных/);
  assert.doesNotMatch(markup, /team-roster|team-count/);
  assert.equal(ui.$('#room-finish').hidden, true);
  assert.equal(ui.$('.board-wrap').hidden, true); assert.equal(ui.context.humanCanMove(), false);
  assert.equal(ui.$('#room-title').textContent, 'Игровая комната #1234');
  assert.doesNotMatch(html, /room-name|room-entry|room-role|room-last-result|room-seats|room-stand|room-ready/);
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
    assert.match(waiting, new RegExp(`${team === 0 ? 'Синие' : 'Красные'} — Вы`));
    assert.equal((waiting.match(/class="team-roster"/g) || []).length, 0);
    assert.match(waiting, /data-claim-seat="[01]" disabled/);
    assert.match(waiting, new RegExp(`data-stand-seat="${team}"`)); assert.match(waiting, /Отменить выбор/);
    assert.doesNotMatch(waiting, /ГОТОВ|НЕ ГОТОВ/);
    const event = { target: { closest: () => ({ dataset: { standSeat: String(team) }, disabled: false }) } };
    await ui.$('#scoreboard').events.click(event); assert.equal(stands, 1);
    snap.phase = 'playing'; snap.state = createGame(DEFAULT_CONFIG); snap.seats[1 - team] = { guestId: 'other', ready: true };
    ui.context.renderOnlineRoom(); assert.equal(ui.$('.board-wrap').hidden, false);
    assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /data-stand-seat|data-claim-seat/);
    await ui.$('#scoreboard').events.click(event); assert.equal(stands, 1);
    assert.equal((ui.$('#scoreboard').innerHTML.match(/class="team-roster"/g) || []).length, 2);
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
  assert.match(ui.$('#scoreboard').innerHTML, /НЕТ СВЯЗИ/);
});

test('finish clears displayed seats and readiness, and early finish never claims a winner', () => {
  const ui = setup(), ended = snapshot({ revision: 4, lastResult: { matchId: 'old', status: 'aborted', winner: null } });
  ui.context.applyRoomView(view(ended)); ui.context.renderOnlineRoom();
  assert.equal(ui.context.gamePhase, 'setup'); assert.equal(ui.context.state.winner, null);
  assert.equal(ui.$('.board-wrap').hidden, true);
  assert.equal((ui.$('#scoreboard').innerHTML.match(/Ожидаем игрока/g) || []).length, 2);
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
  assert.match(html, /Копировать ссылку на комнату/);
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

test('client setup failure leaves an explicit retry and recovery copy', async () => {
  const ui = setup();
  ui.context.MultiplayerSession = class { constructor() { throw Object.assign(new Error('unavailable'), { code: 'storage_unavailable' }); } };
  await ui.context.connectOnlineRoom();
  assert.equal(ui.context.roomConnecting, false);
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

test('the room counts players and spectators with Russian plurals and no duplicate seat panel', () => {
  const ui = setup(), snap = snapshot({ seats: [{ guestId: 'me', ready: true }, { guestId: 'other', ready: true }],
    participants: [{ guestId: 'me', present: true, seat: 0 }, { guestId: 'other', present: true, seat: 1 }, { guestId: 'viewer', present: true, seat: null }] });
  ui.context.roomView = view(snap, 0); ui.context.renderOnlineRoom();
  assert.equal(ui.$('#room-participants').textContent, '2 игрока и 1 зритель');
  assert.match(ui.$('#scoreboard').innerHTML, /Синие — Вы/); assert.match(ui.$('#scoreboard').innerHTML, /Красные — Живой человек/);
  assert.doesNotMatch(ui.$('#scoreboard').innerHTML, /data-claim-seat/);
});

test('closed state hides the field and game actions, and explicit re-entry uses join', async () => {
  const ui = setup(), snap = snapshot({ phase: 'playing', matchId: 'old', state: createGame(DEFAULT_CONFIG), seats: [{ guestId: 'me', ready: true }, null] });
  ui.context.roomTarget = snap.roomId; ui.context.roomView = view(snap, 0, { status: 'closed', canMove: false, error: { code: 'room_not_found' } });
  ui.context.renderOnlineRoom();
  assert.equal(ui.$('.board-wrap').hidden, true); assert.equal(ui.$('#room-finish').hidden, true);
  assert.equal(ui.$('#room-retry').textContent, 'Войти снова');
  const calls = []; ui.context.MultiplayerSession = class { join(id) { calls.push(id); return Promise.resolve(); } };
  await ui.$('#room-retry').events.click(); assert.deepEqual(calls, ['room-a']);
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

test('turn labels follow the viewer perspective for either color and spectators', () => {
  const tags = ui => [...ui.$('#scoreboard').innerHTML.matchAll(/<div class="turn-tag">([^<]*)<\/div>/g)].map(match => match[1]);
  for (const selfSeat of [0, 1, null]) for (const turn of [0, 1]) {
    const ui = setup(), position = createGame(DEFAULT_CONFIG); position.turn = turn;
    const snap = snapshot({ phase: 'playing', state: position, seats: [{ guestId: 'blue', ready: true }, { guestId: 'red', ready: true }],
      participants: [{ guestId: 'blue', present: true, seat: 0 }, { guestId: 'red', present: true, seat: 1 }] });
    ui.context.state = position; ui.context.roomView = view(snap, selfSeat); ui.context.renderOnlineRoom();
    const labels = tags(ui);
    if (selfSeat === null) { assert.equal(labels[turn], 'Ходят'); assert.equal(labels[1 - turn], 'Ждут хода противника'); }
    else if (turn === selfSeat) { assert.equal(labels[selfSeat], 'Ваш ход'); assert.equal(labels[1 - selfSeat], 'Ждут пока вы походите'); }
    else { assert.equal(labels[turn], 'Ход соперника'); assert.equal(labels[selfSeat], 'Ожидаем ход соперника'); }
  }
});

test('the turn line omits a seated player color while retaining the spectator role', () => {
  const ui = setup();
  const caption = app.split('\n').find(line => line.includes("$('#mode-caption').textContent = playMode"));
  for (const selfSeat of [0, 1, null]) {
    ui.context.roomView = view(snapshot(), selfSeat); vm.runInContext(caption, ui.context);
    assert.equal(ui.$('#mode-caption').textContent, selfSeat === null ? 'По ссылке · зритель' : 'По ссылке');
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
    vm.runInContext(declaration('visibleState') + '\n' + app.split("\n").filter(line => line.startsWith("$('#review-")).join("\n"), ui.context);
    const confirmed = plain(ui.context.state);
    ui.$('#review-previous').events.click();
    assert.equal(ui.context.reviewingTurn, true); assert.equal(ui.context.humanCanMove(), false);
    assert.deepEqual(plain(ui.context.visibleState()), before);
    assert.deepEqual(plain(ui.context.state), confirmed, 'review never replaces the authoritative state');
    ui.$('#review-current').events.click();
    assert.deepEqual(plain(ui.context.visibleState()), confirmed);
    ui.$('#review-previous').events.click();
    ui.context.applyRoomView(view({ ...snap, revision: 10 }, seat));
    assert.equal(ui.context.reviewingTurn, false);
    assert.deepEqual(plain(ui.context.state), confirmed);
    for (const id of ['replay-combat', 'review-previous', 'review-current']) assert.equal(ui.$('#' + id).hidden, false);
    ui.context.applyRoomView(view(snapshot({ revision: 11 }), seat)); ui.context.renderOnlineRoom();
    assert.equal(ui.context.lastTurn, null);
    for (const id of ['replay-combat', 'review-previous', 'review-current']) assert.equal(ui.$('#' + id).hidden, true);
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
  assert.match(message, /Не удалось скопировать ссылку/);
});
