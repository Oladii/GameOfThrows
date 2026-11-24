import { DEFAULT_START_CHOICES, resolveStartChoices } from '../dist/start-preferences.js';
import { hasNewerGameVersion } from '../dist/new-game-refresh.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, TYPES, LABELS, TEAM_NAMES, BALANCE_REVISION, updateSavedBalance } from '../dist/rules.js';
import { clone, cells, createGame, validateConfig, validateState, analyze, reachable, shieldCanRetreat, inspectCell } from '../dist/engine.js';
import { DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty } from '../dist/bot-client.js';
import { classifyPosition, prepareStartPosition } from '../dist/start-position.js';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;
function line(prefix) {
  const found = app.split('\n').find(value => value.startsWith(prefix));
  assert.ok(found, `Missing app declaration: ${prefix}`);
  return found;
}
function declaration(name) {
  const start = app.indexOf(`function ${name}(`), lineEnd = app.indexOf('\n', start);
  assert.ok(start >= 0, `Missing app function: ${name}`);
  return app.slice(start, app.slice(start, lineEnd).endsWith('}') ? lineEnd : app.indexOf('\n}', lineEnd) + 2);
}
const initialDeclarations = [
  'let config =', 'let gameVersion =', 'let firstMove =', 'let gamePhase =',
  'let botDifficulty =', 'let startPreferences =', 'let playMode =', 'let hint =',
  'let selected =', 'let report =', 'const STORAGE =', 'const PRESET_REVISION =',
  'const START_PREFS_REVISION =', 'let presetUpdated =', 'let refreshingNewGame =',
  'let currentDeaths =', 'let movement =', 'let reviewTurn =', 'let roomSession =',
  'let battleIntro =', 'const BATTLE_INTRO_DURATION ='
].map(line).join('\n');
const storageSource = app.slice(app.indexOf('function currentSnapshot()'), app.indexOf('\nfunction resetNewGameDefaults()'));
const bootStart = app.lastIndexOf("if (gamePhase === 'playing') archiveRecorder.resume(archiveGameMetadata());");
assert.ok(bootStart >= 0, 'Missing app boot sequence');
const bootSource = app.slice(bootStart, app.indexOf('\nglobalThis.window?.gameSelects?.mount();', bootStart));
const functions = [
  'startingTeam', 'visibleState', 'isBotTurn', 'humanCanMove', 'clearHint',
  'cancelBot', 'cancelMovement', 'cancelBattleIntro', 'startBattleIntro', 'resetBotContext', 'lastTurnFromHistory',
  'hasPreviousReview', 'canStepReview', 'localReviewTurn', 'setFooterDisabled', 'positionText', 'archiveGameMetadata', 'queueBot', 'renderStartSettings', 'render', 'startGame',
  'resetNewGameDefaults', 'cancelStartRefresh', 'returnToGame'
].map(declaration).join('\n');

// Keep real startup, persistence, rendering and bot scheduling together. Only
// the DOM, visual leaf functions, recorder and timer execution are replaced.
function boot({ raw = null, roll = 0.1, storageError = false, fresh = false, href = 'http://localhost/' } = {}) {
  const nodes = new Map(), writes = [], starts = [], resumes = [], timers = [], messages = [], startSounds = [];
  let rolls = 0, closed = 0, context;
  const node = selector => {
    if (selector === 'dialog[open]') return null;
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: true, dataset: {}, setAttribute() {}, classList: { toggle() {} },
      close() { if (selector === '#start-dialog') closed++; }
    });
    return nodes.get(selector);
  };
  const noop = () => {};
  context = vm.createContext({
    tableRattle: null, tableKnocks: null, boardDrag: null, roomMovePreview: null, startRefreshController: null, freshNewGameRequested: fresh, DEFAULT_START_CHOICES, resolveStartChoices, hasNewerGameVersion, CURRENT_RULES_VERSION: '0.1.20', latestRulesVersion: null,
    DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, TYPES, LABELS, TEAM_NAMES, BALANCE_REVISION, updateSavedBalance, upgradeSelectedBalancePreset: value => value,
    clone, createGame, validateConfig, validateState, analyze, reachable, shieldCanRetreat, inspectCell,
    DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty, classifyPosition, prepareStartPosition,
    URL, location: { href }, CURRENT_GAME_VERSION: version, archiveIsSite: false, $: node, window: {},
    document: { body: { classList: { contains: () => false } }, querySelectorAll: () => [] }, matchMedia: () => ({ matches: true }),
    Math: { random() { rolls++; return roll; }, floor: Math.floor },
    localStorage: {
      getItem() { if (storageError) throw new Error('Storage unavailable'); return raw; },
      setItem(key, value) { writes.push({ key, saved: JSON.parse(value), ready: vm.runInContext('ready', context) }); }
    },
    archiveRecorder: { start(value) { starts.push(clone(value)); }, resume(value) { resumes.push(clone(value)); } },
    botRunner: { active: false, cancel: noop }, hintRunner: { cancel: noop },
    moveAnimator: { cancel: noop }, combatAnimator: { cancel: noop },
    gameAudio: { stopAll: noop, playGameStart() { startSounds.push(vm.runInContext('gamePhase', context)); } },
    clearTimeout: noop, clearInterval: noop,
    setTimeout(callback, delay) { timers.push({ callback, delay, ready: vm.runInContext('ready', context) }); return timers.length; },
    toast(message) { messages.push(message); }, renderHint: noop, renderUpdateNotice: noop,
    renderOnlineRoom: noop, renderScoreboard: noop, boardMarkup: noop, paintAuras: noop, highlightSources: noop, renderGameResult: noop,
    unitReferenceMarkup: () => '', icon: () => '', plural: (value, forms) => forms[0]
  });
  vm.runInContext(initialDeclarations + '\n' + storageSource + '\n' + functions + '\n' + bootSource, context);
  return {
    read: expression => clone(vm.runInContext(expression, context)),
    render: () => vm.runInContext('render()', context),
    saved: () => writes.at(-1).saved, nodes, writes, starts, resumes, timers, messages, startSounds,
    rolls: () => rolls, closed: () => closed
  };
}
function savedSetup(overrides = {}) {
  const config = clone(DEFAULT_CONFIG), state = createGame(config);
  return {
    config, state, log: [], history: [], lastTurn: null, previousGame: null,
    positionKind: 'default', gameVersion: version, gamePhase: 'setup', editor: false,
    firstMove: 'south', playMode: 'local', humanTeam: 0, botDifficulty: 'hard',
    balanceRevision: BALANCE_REVISION, presetRevision: 1, startPrefsRevision: 2,
    ...overrides
  };
}

for (const [roll, turn] of [[0.1, 0], [0.9, 1]]) {
  test(`an absent save starts a default training game once with random side ${turn}`, () => {
    const ui = boot({ roll });
    assert.equal(ui.read('gamePhase'), 'playing');
    assert.deepEqual(ui.read('config'), DEFAULT_CONFIG);
    assert.deepEqual(ui.read('state'), prepareStartPosition(createGame(DEFAULT_CONFIG), DEFAULT_CONFIG, turn));
    assert.deepEqual(ui.read('({playMode, humanTeam, firstMove, botDifficulty, editor, positionKind})'), {
      playMode: 'bot', humanTeam: 1, firstMove: 'random', botDifficulty: 'training', editor: false, positionKind: 'default'
    });
    assert.equal(ui.rolls(), 1); assert.equal(ui.starts.length, 1); assert.equal(ui.resumes.length, 0);
    assert.deepEqual(ui.startSounds, []);
    assert.equal(ui.nodes.get('#board').dataset.intro, 'true');
    assert.equal(ui.read('state.ply'), 0);
    assert.equal(ui.read('humanCanMove()'), false);
    assert.equal(ui.closed(), 1); assert.deepEqual(ui.messages, []);
    assert.equal(ui.nodes.get('#start-setup').hidden, true);
    assert.equal(ui.nodes.get('#new-game').hidden, false);
    assert.equal(ui.starts[0].state.turn, turn);
    assert.equal(ui.starts[0].mode, 'bot'); assert.equal(ui.starts[0].botDepth, BOT_DIFFICULTIES.training.depth);
    assert.ok(ui.writes.some(write => !write.ready && write.saved.gamePhase === 'playing'));
    assert.equal(ui.saved().gamePhase, 'playing'); assert.equal(ui.saved().state.turn, turn);
    assert.deepEqual(ui.saved().startPreferences, {
      playMode: 'bot', humanTeam: 1, firstMove: 'random', botDifficulty: 'training', positionKind: 'default', customSetup: null, explicit: {firstMove:false,humanTeam:false,botDifficulty:false}, defaults: DEFAULT_START_CHOICES
    });
    assert.deepEqual(ui.timers.map(({ delay, ready }) => ({ delay, ready })), [{ delay: 1000, ready: false }]);
    ui.render();
    assert.equal(ui.rolls(), 1); assert.equal(ui.starts.length, 1);
    assert.equal(ui.timers.length, 1);
    ui.timers.shift().callback();
    assert.equal(ui.nodes.get('#board').dataset.intro, 'false');
    assert.equal(ui.read('humanCanMove()'), turn === 1);
    assert.deepEqual(ui.startSounds, ['playing']);
    assert.deepEqual(ui.timers.map(({ delay, ready }) => ({ delay, ready })), turn === 0 ? [{ delay: 420, ready: true }] : []);

    const persisted = ui.saved(), reload = boot({ raw: JSON.stringify(persisted), roll: 1 - roll });
    assert.equal(reload.rolls(), 0); assert.equal(reload.starts.length, 0); assert.equal(reload.resumes.length, 1);
    assert.deepEqual(reload.startSounds, []);
    assert.deepEqual(reload.read('state'), persisted.state);
    assert.deepEqual(reload.saved(), persisted);
    assert.equal(reload.resumes[0].state.turn, turn);
    assert.equal(reload.timers.length, turn === 0 ? 1 : 0);
  });
}

test('existing setup, editor, custom deployment and previous-game backup survive startup', () => {
  const customConfig = clone(DEFAULT_CONFIG); customConfig.stats.shield.damage = 4;
  const customState = createGame(customConfig), occupied = new Set(customState.pieces.map(piece => `${piece.q},${piece.r}`));
  Object.assign(customState.pieces[0], cells(customConfig).find(cell => !occupied.has(`${cell.q},${cell.r}`)));
  const earlier = savedSetup({ gamePhase: 'playing' }); earlier.state.ply = 7; earlier.state.turn = 1;
  const previousGame = {
    snapshot: { config: earlier.config, state: earlier.state, log: [], positionKind: 'default', gameVersion: version, actor: 'other', action: null },
    history: [], lastTurn: null, playMode: 'bot', humanTeam: 1, botDifficulty: 'training', firstMove: 'north'
  };
  for (const overrides of [{ editor: true }, { positionKind: 'custom', config: customConfig, state: customState }, { previousGame, editor: true }]) {
    const saved = savedSetup(overrides), ui = boot({ raw: JSON.stringify(saved) });
    assert.equal(ui.read('gamePhase'), 'setup'); assert.equal(ui.read('editor'), saved.editor);
    assert.deepEqual(ui.read('config'), saved.config); assert.deepEqual(ui.read('state'), saved.state);
    assert.deepEqual(ui.read('previousGame'), saved.previousGame);
    assert.equal(ui.read('positionKind'), saved.positionKind);
    assert.deepEqual(ui.read('({firstMove, playMode, humanTeam, botDifficulty})'), {
      firstMove: saved.firstMove, playMode: saved.playMode, humanTeam: saved.humanTeam, botDifficulty: saved.botDifficulty
    });
    assert.equal(ui.rolls(), 0); assert.equal(ui.starts.length, 0); assert.equal(ui.resumes.length, 0);
    assert.equal(ui.closed(), 0); assert.equal(ui.timers.length, 0); assert.deepEqual(ui.messages, []);
    assert.equal(ui.saved().gamePhase, 'setup'); assert.deepEqual(ui.saved().state, saved.state);
    assert.deepEqual(ui.saved().previousGame, saved.previousGame);
  }
  const interrupted = boot({ raw: JSON.stringify(savedSetup({ previousGame, playMode: 'bot' })) });
  assert.equal(interrupted.read('gamePhase'), 'playing');
  assert.deepEqual(interrupted.read('state'), earlier.state);
  assert.equal(interrupted.starts.length, 0);
  assert.equal(interrupted.resumes.length, 1);
  assert.equal(interrupted.saved().previousGame, null);
});

test('a saved battle resumes its progress, history and choices without preparing a new game', () => {
  const config = clone(DEFAULT_CONFIG); config.stats.shield.damage = 4;
  const state = createGame(config); state.ply = 12; state.turn = 0;
  state.pieces.pop();
  const before = { config: clone(config), state: { ...clone(state), ply: 11, turn: 1 }, log: [], positionKind: 'custom', gameVersion: '0.1.70', actor: 'human', action: { pass: true } };
  const saved = savedSetup({
    config, state, gamePhase: 'playing', positionKind: 'custom', gameVersion: '0.1.70',
    playMode: 'bot', humanTeam: 0, firstMove: 'north', botDifficulty: 'easy',
    history: [before], lastTurn: { before, action: { pass: true } }, log: [{ text: 'Saved turn', detail: '' }],
    startPreferences: { playMode: 'local', humanTeam: 1, firstMove: 'south', botDifficulty: 'hard', positionKind: 'default', customSetup: null }
  });
  const ui = boot({ raw: JSON.stringify(saved) });
  assert.deepEqual(ui.saved(), { ...saved, startPreferences: { ...saved.startPreferences, ...resolveStartChoices(saved.startPreferences) } });
  assert.equal(ui.read('gamePhase'), 'playing'); assert.equal(ui.read('gameVersion'), '0.1.70');
  assert.deepEqual(ui.read('state'), state); assert.deepEqual(ui.read('history'), saved.history);
  assert.deepEqual(ui.read('lastTurn'), saved.lastTurn);
  assert.equal(ui.rolls(), 0); assert.equal(ui.starts.length, 0); assert.equal(ui.resumes.length, 1);
  assert.deepEqual(ui.resumes[0], { config, state, mode: 'bot', humanTeam: 0, firstMove: 'north', botDepth: BOT_DIFFICULTIES.easy.depth });
  assert.equal(ui.closed(), 0); assert.equal(ui.timers.length, 0); assert.deepEqual(ui.messages, []);
});

test('malformed, empty and unavailable storage start a game with defaults', () => {
  for (const options of [{ raw: '{invalid' }, { raw: '' }, { storageError: true }]) {
    const ui = boot(options);
    assert.equal(ui.read('gamePhase'), 'playing');
    assert.deepEqual(ui.read('config'), DEFAULT_CONFIG);
    assert.deepEqual(ui.read('state'), prepareStartPosition(createGame(DEFAULT_CONFIG), DEFAULT_CONFIG, 0));
    assert.equal(ui.rolls(), 1); assert.equal(ui.starts.length, 1); assert.equal(ui.resumes.length, 0);
    assert.equal(ui.saved().gamePhase, 'playing');
    assert.equal(ui.nodes.get('#start-setup').hidden, true);
  }
});

test('a first visit through an invitation does not start an unrelated solo match', () => {
  const ui = boot({ href: 'http://localhost/?room=existing-room' });
  assert.equal(ui.read('initialRoomId'), 'existing-room');
  assert.equal(ui.read('gamePhase'), 'setup');
  assert.equal(ui.starts.length, 0);
  assert.equal(ui.timers.length, 0);
});

test('a saved standard bot setup starts on arrival with the chosen side, difficulty and first move', () => {
  for (const turn of [0, 1]) {
    const saved = savedSetup({ playMode: 'bot', humanTeam: 1, botDifficulty: 'easy', firstMove: turn === 0 ? 'north' : 'south' });
    const ui = boot({ raw: JSON.stringify(saved) });
    assert.equal(ui.read('gamePhase'), 'playing');
    assert.equal(ui.starts.length, 1); assert.equal(ui.resumes.length, 0); assert.equal(ui.rolls(), 0);
    assert.equal(ui.read('state.turn'), turn);
    assert.deepEqual(ui.read('({playMode,humanTeam,botDifficulty,firstMove})'), {
      playMode: saved.playMode, humanTeam: saved.humanTeam, botDifficulty: saved.botDifficulty, firstMove: saved.firstMove
    });
    assert.equal(ui.nodes.get('#start-setup').hidden, true);
    const reload = boot({ raw: JSON.stringify(ui.saved()) });
    assert.equal(reload.starts.length, 0); assert.equal(reload.resumes.length, 1);
    assert.deepEqual(reload.read('state'), ui.read('state'));
  }
});

test('a saved standard two-player setup starts with its explicitly chosen first move', () => {
  const ui = boot({ raw: JSON.stringify(savedSetup()) });
  assert.equal(ui.read('gamePhase'), 'playing');
  assert.equal(ui.read('playMode'), 'local');
  assert.equal(ui.read('state.turn'), 1);
  assert.equal(ui.starts.length, 1);
});

test('a saved bot setup never starts a solo game when the URL invites the player into a room', () => {
  const saved = savedSetup({ playMode: 'bot', botDifficulty: 'easy' });
  const ui = boot({ raw: JSON.stringify(saved), href: 'http://localhost/?room=existing-room' });
  assert.equal(ui.read('gamePhase'), 'setup'); assert.equal(ui.starts.length, 0); assert.equal(ui.timers.length, 0);
});

test('bot editor and custom deployment remain drafts on arrival', () => {
  for (const overrides of [{ editor: true }, { positionKind: 'custom' }]) {
    const saved = savedSetup({ playMode: 'bot', ...overrides });
    if (overrides.positionKind === 'custom') {
      const occupied = new Set(saved.state.pieces.map(p => `${p.q},${p.r}`));
      Object.assign(saved.state.pieces[0], cells(saved.config).find(p => !occupied.has(`${p.q},${p.r}`)));
    }
    const ui = boot({ raw: JSON.stringify(saved) });
    assert.equal(ui.read('gamePhase'), 'setup'); assert.equal(ui.starts.length, 0);
    assert.deepEqual(ui.read('state'), saved.state);
  }
});

test('an explicit new-game refresh keeps the start flow in control of a saved bot draft', () => {
  const saved = savedSetup({ playMode: 'bot', botDifficulty: 'easy' });
  const ui = boot({ raw: JSON.stringify(saved), fresh: true });
  assert.equal(ui.read('gamePhase'), 'setup'); assert.equal(ui.starts.length, 0);
});
