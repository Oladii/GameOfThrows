import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { winnerForPieces } from '../dist/engine.js';
const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function setup(victoryCondition = 'flag-or-combat') {
  const nodes = { '#mode-caption': {}, '#move-counter': {}, '.arena-top': { dataset: {} } };
  const context = vm.createContext({ config: { victoryCondition }, gamePhase: 'playing', editor: false, playMode: 'bot', humanTeam: 1,
    movement: null, combat: null, currentDeaths: [], reviewingTurn: false, roomMovePreview: null, roomView: null,
    BOT_DIFFICULTIES: { normal: { label: 'Опытный' } }, botDifficulty: 'normal', $: s => nodes[s] });
  vm.runInContext(app.slice(app.indexOf('function matchResult('), app.indexOf('function renderUpdateNotice(')), context);
  return { context, nodes };
}
const army = (team, types) => types.map((type, i) => ({ id: `${team}-${i}`, team, type }));
const alive = ['defenseLamp', 'shield'];
const support = ['defenseLamp', 'scoutLamp', 'horn'];
const endings = [
  ['flag-or-combat', alive, ['archer'], 0, 'Уничтожено знамя противника'],
  ['flag-or-combat', ['archer'], alive, 1, 'Уничтожено знамя противника'],
  ['flag-or-combat', alive, ['defenseLamp'], 0, 'Уничтожены все лучники и щитоносцы'],
  ['flag-or-combat', ['defenseLamp'], alive, 1, 'Уничтожены все лучники и щитоносцы'],
  ['flag-or-combat', alive, support, 0, 'Уничтожены все лучники и щитоносцы'],
  ['flag-or-combat', support, alive, 1, 'Уничтожены все лучники и щитоносцы'],
  ['flag-or-combat', ['archer'], ['shield'], 'draw', 'Знамёна обеих сторон уничтожены'],
  ['flag-or-combat', support, support, 'draw', 'У обеих сторон уничтожены все лучники и щитоносцы'],
  ['flag-or-combat', ['defenseLamp'], ['defenseLamp'], 'draw', 'У обеих сторон уничтожены все лучники и щитоносцы'],
  ['flag-or-combat', ['archer'], ['defenseLamp'], 'draw', 'Знамя Синих уничтожено. У Красных уничтожены все лучники и щитоносцы'],
  ['combat-units', ['shield'], ['defenseLamp'], 0, 'Уничтожены все лучники и щитоносцы'],
  ['combat-units', ['scoutLamp'], ['archer'], 1, 'Уничтожены все лучники и щитоносцы'],
  ['combat-units', ['horn'], ['scoutLamp'], 'draw', 'У обеих сторон уничтожены все лучники и щитоносцы'],
  ['all-units', ['shield'], [], 0, 'Уничтожены все фигуры противника'],
  ['all-units', [], [], 'draw', 'Все войска разбиты']
];
for (const [condition, north, south, winner, reason] of endings) test(`result explains ${condition}: ${north} / ${south}`, () => {
  const ui = setup(condition), pieces = [...army(0, north), ...army(1, south)];
  assert.equal(winnerForPieces(pieces, { victoryCondition: condition }), winner);
  const position = { ply: 65, turn: 1, winner, pieces };
  const result = ui.context.matchResult(position);
  assert.equal(result.reason, reason); assert.equal(result.winner, winner);
  assert.equal(result.title, winner === 'draw' ? 'Поражение обеих сторон' : `Победили ${winner === 0 ? 'Синие (Опытный бот)' : 'Красные (Вы)'}`);
  ui.context.renderGameResult(position);
  assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 66');
  assert.equal(ui.nodes['.arena-top'].dataset.result, '');
});
test('winner ownership follows both bot and online sides, local players and spectators', () => {
  for (const playMode of ['bot', 'online', 'local']) for (const selfSeat of [0, 1, null]) for (const winner of [0, 1]) {
    const ui = setup(); Object.assign(ui.context, { playMode, humanTeam: selfSeat ?? 1, roomView: { selfSeat } });
    const result = ui.context.matchResult({ winner, pieces: [], ply: 4, turn: 0 });
    const viewer = playMode === 'bot' ? selfSeat ?? 1 : playMode === 'online' ? selfSeat : null;
    const owner = winner === viewer ? 'Вы' : playMode === 'bot' ? 'Опытный бот' : playMode === 'online' && viewer !== null ? 'Соперник' : '';
    assert.equal(result.title, `Победили ${winner === 0 ? 'Синие' : 'Красные'}${owner ? ` (${owner})` : ''}`);
  }
});
test('no result appears before animations finish or in setup, editor, review and unconfirmed move', () => {
  for (const patch of [{ movement: {} }, { combat: {} }, { currentDeaths: [{}] }, { gamePhase: 'setup' }, { editor: true }, { reviewingTurn: true }, { roomMovePreview: {} }]) {
    const ui = setup(); Object.assign(ui.context, patch);
    assert.equal(ui.context.matchResult({ winner: 0, pieces: [] }), null);
  }
  assert.equal(setup().context.matchResult({ winner: null, pieces: [] }), null);
});
test('turn status follows the viewer, preserves transient states and history', () => {
  for (const playMode of ['bot', 'online']) for (const viewer of [0, 1]) for (const turn of [0, 1]) {
    const ui = setup(); Object.assign(ui.context, { playMode, humanTeam: viewer, roomView: { selfSeat: viewer, status: 'connected' } });
    ui.context.renderGameResult({ ply: 3, turn, winner: null, pieces: [] });
    assert.equal(ui.nodes['#move-counter'].textContent, `Ход 4 • ${viewer === turn ? 'Ваш ход' : 'Ждем хода противника'}`);
  }
  for (const playMode of ['online', 'local']) for (const turn of [0, 1]) {
    const ui = setup(); Object.assign(ui.context, { playMode, roomView: { selfSeat: null, status: 'connected' } });
    const position = { ply: 4, turn, winner: null, pieces: [] };
    ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, `Ход 5 • Ход ${turn === 0 ? 'синих' : 'красных'}`);
    ui.context.reviewingTurn = true; ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, 'Просмотр · Ход 5');
  }
  for (const [patch, label] of [[{ movement: {} }, 'Движение…'], [{ combat: {} }, 'Расчёт боя…'], [{ currentDeaths: [{}] }, 'Расчёт боя…'], [{ gamePhase: 'setup' }, 'Подготовка'], [{ gamePhase: 'setup', playMode: 'online' }, 'Ожидание игроков']]) {
    const ui = setup(); Object.assign(ui.context, patch); ui.context.renderGameResult({ ply: 3, turn: 0, winner: 1, pieces: [] });
    assert.equal(ui.nodes['#move-counter'].textContent, label);
  }
});

test('connection status replaces turn status for both seats and clears on reconnect', () => {
  for (const selfSeat of [0, 1]) {
    const ui = setup(), position = { ply: 3, turn: selfSeat, winner: null, pieces: [] };
    const snapshot = { seats: [{ guestId: 'blue' }, { guestId: 'red' }], participants: [{ guestId: 'blue', present: true }, { guestId: 'red', present: true }] };
    Object.assign(ui.context, { playMode: 'online', roomView: { selfSeat, status: 'reconnecting', snapshot } });
    ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 4 • Нет связи с вами');
    ui.context.roomView.status = 'connected'; snapshot.participants[1-selfSeat].present = false;
    ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 4 • Нет связи с соперником');
    snapshot.participants[selfSeat].present = false;
    ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 4 • Нет связи с вами');
    snapshot.participants.forEach(person => { person.present = true; });
    ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 4 • Ваш ход');
    ui.context.roomView.selfSeat = null; snapshot.participants[0].present = false;
    ui.context.renderGameResult(position);
    assert.equal(ui.nodes['#move-counter'].textContent, 'Ход 4 • Нет связи с Синими');
  }
});

test('the final board plays the live result once from the player’s perspective', () => {
  for (const [playMode, seat, winner, expected] of [
    ['bot', 0, 0, 'victory'], ['bot', 1, 0, 'defeat'], ['bot', 0, 'draw', 'defeat'],
    ['local', null, 1, 'victory'], ['local', null, 'draw', 'defeat'],
    ['online', 0, 0, 'victory'], ['online', 0, 1, 'defeat'], ['online', 1, 'draw', 'defeat'],
    ['online', null, 0, null]
  ]) {
    const { context } = setup(), sounds = [];
    const position = { winner, pieces: [], ply: 3, turn: 0 };
    Object.assign(context, { playMode, humanTeam: seat, roomView: { selfSeat: seat }, state: position,
      gameAudio: { play: name => sounds.push(name) }, document: { hidden: false },
      archiveRecorder: { record() {} }, matchMedia: () => ({ matches: true }) });
    vm.runInContext(app.slice(app.indexOf('function recordGameAction('), app.indexOf("addEventListener('online'", app.indexOf('function recordGameAction('))), context);
    context.renderGameResult(position);
    assert.deepEqual(sounds, [], 'restored result');
    context.recordGameAction('move');
    context.combat = {};
    context.renderGameResult(position);
    assert.deepEqual(sounds, [], 'combat is still visible');
    context.combat = null;
    context.renderGameResult(position);
    context.renderGameResult(position);
    assert.deepEqual(sounds, expected ? [expected] : []);
  }
});
