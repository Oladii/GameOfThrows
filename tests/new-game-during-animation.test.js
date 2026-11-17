import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = app.indexOf(`function ${name}(`), lineEnd = app.indexOf('\n', start);
  return app.slice(start, app.slice(start, lineEnd).endsWith('}') ? lineEnd : app.indexOf('\n}', lineEnd) + 2);
}
for (const phase of ['movement', 'combat']) test(`new game interrupts ${phase} and cancel restores the committed turn`, () => {
  const result = { pieces: [{ id: 'survivor', q: 1, r: 0 }], ply: 7, turn: 1 };
  const history = [{ state: { ply: 6 }, action: { id: 'survivor', to: { q: 1, r: 0 } } }];
  const lastTurn = { before: history[0], action: history[0].action };
  let canceled = 0, soundsStopped = 0;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const c = vm.createContext({ tableRattle: null, state: structuredClone(result), config: {}, log: [], history: structuredClone(history), lastTurn: structuredClone(lastTurn),
    playMode: 'bot', humanTeam: 0, firstMove: 'north', botDifficulty: 'hard', gamePhase: 'playing', refreshingNewGame: false,
    positionKind: 'default', gameVersion: 'test', previousGame: null, editor: false, movement: null, combat: null,
    roomMovePreview: null, reviewRequest: 0, reviewLoading: false, reviewTurn: null, reviewingTurn: false,
    botIssue: '', botSuspended: false, botTimer: null, clearTimeout, clone: structuredClone,
    $: () => dialog, moveAnimator: { cancel() { canceled++; } }, combatAnimator: { cancel() { canceled++; } },
    gameAudio: { stopAll() { soundsStopped++; } }, botRunner: { cancel() {} }, clearHint() {},
    renderStartSettings() {}, save() {}, cancelStartRefresh() {}, render() {}, readBotDifficulty: x => x,
    archiveRecorder: { resume() {} }, archiveGameMetadata() {},
  });
  c.currentSnapshot = () => structuredClone({ state: c.state, config: c.config, log: c.log, positionKind: c.positionKind, gameVersion: c.gameVersion });
  c.applyStartPreferences = () => { c.state = { pieces: [], ply: 0 }; };
  c[phase] = { before: { state: { ply: 6 } } };
  for (const name of ['cancelBot', 'cancelMovement', 'resetBotContext', 'openStartSettings', 'openNewGame', 'returnToGame']) vm.runInContext(declaration(name), c);
  c.openNewGame();
  assert.equal(dialog.open, true);
  assert.equal(c.movement, null); assert.equal(c.combat, null);
  assert.equal(c.gamePhase, 'setup');
  assert.deepEqual(c.previousGame.snapshot.state, result);
  assert.equal(canceled, 2); assert.equal(soundsStopped, 1);
  c.returnToGame();
  assert.equal(dialog.open, false); assert.equal(c.gamePhase, 'playing');
  assert.deepEqual(c.state, result); assert.deepEqual(c.history, history); assert.deepEqual(c.lastTurn, lastTurn);
});
