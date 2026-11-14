import { explainHint } from './hint.js';
import { boardNavigationTarget } from './board-navigation.js';
import { renderTokenBody, HORN_ICON_PATH, COMMANDER_ICON_PATH } from './token-presentation.js';
import { DEFAULT_CONFIG, PREVIOUS_LOCAL_CONFIG, TYPES, LABELS, TEAM_NAMES, BALANCE_REVISION, updateSavedBalance, upgradeSelectedBalancePreset } from './rules.js';
import { consumeNewGameRefresh, refreshNewGamePage, hasNewerGameVersion, needsNewGame, latestGameVersion } from './new-game-refresh.js';
import { clone, key, cells, validateConfig, validateState, createGame, analyze, inspectCell, effective, reachable, movementPath, shieldCanRetreat, archerHasEdgeBonus, move, pass, resolve } from './engine.js';
import { BotRunner, DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty } from './bot-client.js';
import { classifyPosition, prepareStartPosition } from './start-position.js';
import { createMovementPlan, sampleMovement, MovementAnimator, CombatAnimator, DEATH_EFFECT_DURATION } from './move-animation.js';
import { GameRecorder } from './game-archive.js';
import { hexGridPoint, hexGridPolygon, inspectionDamageArrows, renderHintArrow, renderUnitBadges, lethalAttackPresentation, renderDamageArrows, unitStatParts, alliedBonusDetails, ATTACK_TEAM_COLORS, auraCircleMarkup, renderDeathEffects, renderMovingToken, unitAppearance, attackReachPresentation } from './board-presentation.js';
import { createGuideController } from './guide-controller.js';
const $ = selector => document.querySelector(selector);
const CURRENT_GAME_VERSION = $('#version-number').textContent.replace(/^v/, '');
const CURRENT_RULES_VERSION = $('#version-number').dataset.rulesVersion;
$('#version-channel').textContent = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname) ? 'Локально' : 'Сайт';
const archiveEndpoint = $('meta[name="game-archive-endpoint"]')?.content || '';
const archiveIsSite = location.origin === 'https://oladii.github.io' && location.pathname.startsWith('/GameOfThrows/');
let archiveRetrying = false;
function renderArchiveStatus(info) {
  const text = { disabled: '', pending: 'Записи партий ожидают отправки в архив.', syncing: 'Сохраняем партию в общем архиве…', saved: 'Партия сохранена в общем архиве.', error: 'Не удалось сохранить запись в общем архиве. Игра продолжается.' };
  $('#archive-status').textContent = archiveRetrying ? 'Повторяем сохранение записей в архив…' : info.failed > 0 ? 'Часть партий ещё не сохранена в архиве. Записи остаются в этом браузере; можно повторить отправку.' : !info.gameId && !info.pending && !['disabled', 'error'].includes(info.state) ? 'Партии автоматически записываются для анализа баланса.' : text[info.state] || '';
  $('#archive-status').hidden = !archiveRetrying && !info.failed && info.state !== 'error';
  $('#archive-retry').hidden = !archiveRetrying && info.failed === 0 && info.state !== 'error';
  $('#archive-retry').disabled = archiveRetrying || info.state === 'syncing';
  $('#archive-retry').textContent = archiveRetrying ? 'Сохраняем…' : 'Повторить сохранение';
  const failures = info.failures || [];
  $('#archive-details').hidden = !info.failed || !failures.length;
  $('#archive-errors').textContent = failures.map(failure => [failure.httpStatus, failure.code, `записей: ${failure.count}`].filter(value => value !== undefined && value !== '').join(' · ')).join('\n');
}
const archiveRecorder = new GameRecorder({
  endpoint: archiveEndpoint, enabled: archiveIsSite && Boolean(archiveEndpoint),
  app: { version: $('#version-number').textContent.replace(/^v/, ''), build: $('#version-build').dataset.builtAt, channel: archiveIsSite ? 'site' : 'local' },
  onStatus: renderArchiveStatus
});
renderArchiveStatus(archiveRecorder.status);
async function retryArchive() {
  if (archiveRetrying) return;
  archiveRetrying = true; renderArchiveStatus(archiveRecorder.status);
  try { await archiveRecorder.retryFailed(); }
  catch { toast('Не удалось повторить сохранение. Записи остаются в этом браузере.'); }
  finally { archiveRetrying = false; renderArchiveStatus(archiveRecorder.status); }
}
$('#archive-retry').addEventListener('click', retryArchive);
function archiveGameMetadata() { return { config, state, mode: playMode, humanTeam, firstMove, botDepth: playMode === 'bot' ? BOT_DIFFICULTIES[botDifficulty].depth : undefined }; }
function recordGameAction(type, details = {}) {
  archiveRecorder.record(type, { config, state, ...details, ...(details.action ? { action: readAction(details.action) } : {}) });
  if (state.winner !== null) archiveRecorder.record('finish', { config, state, outcome: { winner: state.winner } });
}
addEventListener('online', () => { void archiveRecorder.flush(); });
addEventListener('pagehide', () => { void archiveRecorder.flush(); });
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, forms) => n % 100 >= 11 && n % 100 <= 14 ? forms[2] : n % 10 === 1 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 ? forms[1] : forms[2];
const ICON_PATHS = {
  horn: HORN_ICON_PATH,
  scoutLamp: COMMANDER_ICON_PATH,
  shield: '<path d="M12 2 20 5v6c0 5-4 8-8 11-4-3-8-6-8-11V5Z"/><path d="M12 6v11M8 10h8"/>',
  archer: '<path d="M8 3c10 4 10 14 0 18L12 12Z"/><path d="M3 12h18m-4-3 4 3-4 3"/>',
  attackLamp: '<ellipse cx="12" cy="10" rx="8" ry="3"/><path d="M4 10v8c0 1.7 3.6 3 8 3s8-1.3 8-3v-8M4 11l4 8 4-6 4 6 4-8M7 2l8 5M17 2l-3 3"/>',
  defenseLamp: '<path d="M4 22V3m0 2c5-4 10 4 16 0v11c-6 4-11-4-16 0"/><path d="m9 8 3-1 3 1v3c0 2-1.5 3-3 4-1.5-1-3-2-3-4Z"/>'
};
const icon = (type, piece = null) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${piece ? unitAppearance(piece, config, ICON_PATHS).icon : ICON_PATHS[type]}</svg>`;
const unitBadges = renderUnitBadges;
let config = clone(DEFAULT_CONFIG), state = createGame(config), history = [], log = [];
let gameVersion = CURRENT_GAME_VERSION, latestVersion = null, latestRulesVersion = null, versionCheckPending = false;
let firstMove = 'random';
let gamePhase = 'setup', positionKind = 'default', previousGame = null;
let botDifficulty = DEFAULT_BOT_DIFFICULTY;
let startPreferences = null;
let playMode = 'bot', humanTeam = 1, lastTurn = null, reviewingTurn = false, botTimer = null, botIssue = '', botSuspended = false;
const botRunner = new BotRunner();
const hintRunner = new BotRunner();
let hint = null, hintThinkingTimer = null;
function clearHint() { hintRunner.cancel(); clearInterval(hintThinkingTimer); hintThinkingTimer = null; hint = null; }
function hintPositionKey() { return JSON.stringify({ state, config }); }
function canRequestHint() { return gamePhase === 'playing' && !editor && !reviewingTurn && !isBotTurn() && state.winner === null; }
function requestHint() {
  if (!canRequestHint()) return;
  if (hint) { clearHint(); render(); return; }
  const positionKey = hintPositionKey(), recent = recentBotHistory(), lastActions = new Map();
  for (const entry of recent) if (entry.action?.id) lastActions.set(entry.action.id, entry.action);
  selected = null; hover = null; inspection = null;
  hint = { positionKey, pending: true };
  hintRunner.run({ state, config, options: { depth: BOT_DIFFICULTIES.hard.depth, seed: crypto.getRandomValues(new Uint32Array(1))[0], adviceDiversity: true,
    previousStates: [...recent.map(entry => entry.state), state], lastActions: [...lastActions] } }, result => {
    if (hint?.positionKey !== positionKey || hintPositionKey() !== positionKey || !canRequestHint()) return;
    try { hint = { positionKey, ...explainHint(state, config, result?.action), action: result?.action }; }
    catch { hint = { positionKey, title: 'Не удалось показать подсказку', reasons: ['Попробуйте ещё раз.'] }; }
    render();
  }, () => {
    if (hint?.positionKey !== positionKey || hintPositionKey() !== positionKey || !canRequestHint()) return;
    hint = { positionKey, title: 'Не удалось рассчитать подсказку', reasons: ['Скройте подсказку и попробуйте ещё раз.'] }; render();
  });
  render();
}
function renderHint() {
  const button = $('#show-hint'), panel = $('#move-hint');
  button.disabled = !canRequestHint() || Boolean(hint);
  button.textContent = 'Попросить совет';
  button.setAttribute('aria-expanded', String(Boolean(hint)));
  panel.hidden = !hint;
  panel.setAttribute('aria-busy', String(Boolean(hint?.pending)));
  if (!hint?.pending) { clearInterval(hintThinkingTimer); hintThinkingTimer = null; }
  panel.innerHTML = !hint ? '' : `<h2>Совет</h2>${hint.pending
    ? '<p class="hint-thinking">Думовую<span id="hint-thinking-dots">.</span></p>'
    : `${hint.title.startsWith('Не удалось') ? `<p>${escape(hint.title)}</p>` : ''}${hint.reasons.map(reason => `<p>${escape(reason)}</p>`).join('')}`}`;
  if (hint?.pending && hintThinkingTimer === null) {
    let dots = 1;
    hintThinkingTimer = setInterval(() => {
      const node = $('#hint-thinking-dots');
      if (node) node.textContent = '.'.repeat(dots = dots % 3 + 1);
    }, 400);
  }
}
function dismissHintOnClick(event) {
  if (!hint || event.target.closest?.('#show-hint')) return;
  clearHint(); renderHint();
  $('#board .hint-trace')?.remove();
  renderInspector(inspectionContext());
}
function hintTrace() {
  if (!hint?.action || hint.action.pass || hint.pending || movement || combat || currentDeaths.length) return '';
  const piece = state.pieces.find(p => p.id === hint.action.id);
  return piece ? renderHintArrow(piece, hint.action.to, point) : '';
}
let boardFocus = null, restoringBoardFocus = false;
let selected = null, editor = false, tool = 'shield', editorTeam = 0, hover = null, inspection = null, toastTimer;
let report = analyze(state, config), available = [], ready = false;
const STORAGE = archiveIsSite ? 'lamps-prototype-v1' : 'lamps-local-playtest13-v1';
const PRESET_REVISION = 1;
const START_PREFS_REVISION = 2;
let presetUpdated = false, balanceUpdated = false, commanderUpdated = false;
let refreshingNewGame = false;
const freshNewGameRequested = consumeNewGameRefresh(location, window.history);
let currentDeaths = [], deathEffectTimer;
let movement = null, combat = null;
const moveAnimator = new MovementAnimator(frame => {
  const token = $('#moving-token');
  if (token) { token.setAttribute('transform', `translate(${frame.x},${frame.y})`); token.dataset.progress = String(frame.progress); }
}, () => { const completed = movement; movement = null; if (completed) presentKills(completed.before, completed.forecast, completed.deaths); });
const combatAnimator = new CombatAnimator((phase, frame) => {
  if (!combat) return;
  const previousPhase = combat.phase;
  if (phase === 'idle') combat = null;
  else {
    combat.phase = phase;
    combat.groupIndex = frame.groupIndex; combat.arrowCount = frame.arrowCount;
    if (phase === 'deaths') {
      combat.activeDeaths = combat.groups[frame.groupIndex].deaths;
      const removed = new Set(combat.activeDeaths.map(p => p.id));
      combat.visiblePosition = { ...combat.visiblePosition, pieces: combat.visiblePosition.pieces.filter(p => !removed.has(p.id)) };
    } else combat.activeDeaths = [];
  }
  if (phase === 'attacks' && previousPhase === 'attacks') { highlightSources(); return; }
  render();
}, () => {});
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function currentSnapshot() { return clone({ config, state, log, positionKind, gameVersion }); }
function checkpoint(actor = 'other', action = null) { history.push({ ...currentSnapshot(), actor, action }); if (history.length > 40) history.shift(); }
function currentStartPreferences() { return readStartPreferences({ firstMove, playMode, humanTeam, botDifficulty, positionKind, customSetup: positionKind === 'custom' ? { config, state } : null }); }
function save() {
  try {
    if (gamePhase === 'setup') startPreferences = currentStartPreferences();
    localStorage.setItem(STORAGE, JSON.stringify({ ...currentSnapshot(), history, firstMove, playMode, humanTeam, botDifficulty, startPreferences, lastTurn, gamePhase, editor, previousGame, balanceRevision: BALANCE_REVISION, presetRevision: PRESET_REVISION, startPrefsRevision: START_PREFS_REVISION }));
    return true;
  } catch { if (ready) toast('Не удалось сохранить позицию в браузере.'); return false; }
}
function normalizeUnitNames(value) {
  const commanderForms = { '': 'командир', а: 'командира', у: 'командиру', ом: 'командиром', е: 'командире', и: 'командиры', ов: 'командиров', ам: 'командирам', ами: 'командирами', ах: 'командирах' };
  value = value.replace(/([Рр])азведчик(ами|ов|ом|ам|ах|а|у|и|е)?/g, (_, initial, ending = '') => { const name = commanderForms[ending]; return initial === 'Р' ? name[0].toUpperCase() + name.slice(1) : name; });
  const names = [['Барабанщик', LABELS.attackLamp], ['Знаменосец', LABELS.defenseLamp], ['Горнист', LABELS.horn], ['Лампа атаки', LABELS.attackLamp], ['Лампа защиты', LABELS.defenseLamp], ['Знамя атаки', LABELS.attackLamp], ['Знамя защиты', LABELS.defenseLamp], ['Щитоносец', LABELS.shield], ['Стрелок', LABELS.archer]];
  return names.reduce((text, [oldName, newName]) => text.replaceAll(oldName, newName), value);
}
function normalizeLog(value) { return Array.isArray(value) ? value.slice(-100).filter(x => x && typeof x.text === 'string' && x.text.length < 600 && typeof x.detail === 'string' && x.detail.length < 1000).map(x => ({ text: normalizeUnitNames(x.text), detail: normalizeUnitNames(x.detail) })) : []; }
function readSnapshot(value) { const c = validateConfig(value.config), s = validateState(value.state, c); return { config: c, state: s, log: normalizeLog(value.log), positionKind: ['default', 'custom'].includes(value.positionKind) ? value.positionKind : classifyPosition(s, c), gameVersion: typeof value.gameVersion === 'string' ? value.gameVersion : null, actor: ['human', 'bot'].includes(value.actor) ? value.actor : 'other', action: readAction(value.action) }; }
function readAction(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.pass === true) return { pass: true };
  if (typeof value.id !== 'string' || !/^[\w-]{1,60}$/.test(value.id) || ![value.from?.q, value.from?.r, value.to?.q, value.to?.r].every(Number.isInteger)) return null;
  return { id: value.id, from: { q: value.from.q, r: value.from.r }, to: { q: value.to.q, r: value.to.r } };
}
function readLastTurn(value, currentConfig = config, currentState = state) {
  if (!value) return null;
  try {
    const before = readSnapshot(value.before), action = readAction(value.action);
    if (!action || JSON.stringify(before.config) !== JSON.stringify(currentConfig) || before.state.ply + 1 !== currentState.ply) return null;
    return { before, action };
  } catch { return null; }
}
function readPreviousGame(value) {
  if (!value) return null;
  try {
    const snapshot = readSnapshot(value.snapshot);
    return { snapshot, history: (Array.isArray(value.history) ? value.history.slice(-40) : []).map(readSnapshot), lastTurn: readLastTurn(value.lastTurn, snapshot.config, snapshot.state), playMode: value.playMode === 'bot' ? 'bot' : 'local', humanTeam: value.humanTeam === 1 ? 1 : 0, botDifficulty: readBotDifficulty(value.botDifficulty), firstMove: ['north', 'south', 'random'].includes(value.firstMove) ? value.firstMove : 'north' };
  } catch { return null; }
}
function readStartPreferences(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const preferences = {
    playMode: input.playMode === 'local' ? 'local' : 'bot',
    humanTeam: input.humanTeam === 0 ? 0 : 1,
    firstMove: ['north', 'south', 'random'].includes(input.firstMove) ? input.firstMove : 'random',
    botDifficulty: readBotDifficulty(input.botDifficulty),
    positionKind: 'default', customSetup: null
  };
  if (input.positionKind === 'custom' && input.customSetup) {
    try {
      const customConfig = validateConfig(input.customSetup.config);
      const customState = validateState(input.customSetup.state, customConfig);
      preferences.positionKind = 'custom';
      preferences.customSetup = { config: customConfig, state: { ...customState, ply: 0, winner: null } };
    } catch { /* Invalid custom data must not discard the other preferences. */ }
  }
  return preferences;
}
function pendingSetupBalance(input, revision) {
  const updated = updateSavedBalance(input, revision);
  const same = (a, b) => a === b || !!a && !!b && typeof a === 'object' && typeof b === 'object'
    && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => same(a[key], b[key]));
  // Only an exact historical standard preset adopts the current new-game rules.
  return (revision ?? 0) < BALANCE_REVISION && same(updated, PREVIOUS_LOCAL_CONFIG) ? clone(DEFAULT_CONFIG) : updated;
}
try {
  const raw = localStorage.getItem(STORAGE);
  if (raw) {
    const saved = JSON.parse(raw), restored = readSnapshot(saved);
    if (['north', 'south', 'random'].includes(saved.firstMove)) firstMove = saved.firstMove;
    if (['local', 'bot'].includes(saved.playMode)) playMode = saved.playMode;
    if ([0, 1].includes(saved.humanTeam)) humanTeam = saved.humanTeam;
    botDifficulty = readBotDifficulty(saved.botDifficulty);
    config = restored.config; state = restored.state; log = restored.log; gameVersion = restored.gameVersion;
    positionKind = restored.positionKind;
    gamePhase = saved.gamePhase === 'playing' || (saved.gamePhase === undefined && (state.ply > 0 || state.winner !== null)) ? 'playing' : 'setup';
    if (gamePhase === 'setup' && (saved.startPrefsRevision ?? 0) < START_PREFS_REVISION) {
      if ((saved.startPrefsRevision ?? 0) < 1) { playMode = 'bot'; humanTeam = 1; }
      firstMove = 'random';
    }
    editor = gamePhase === 'setup' && saved.editor === true;
    previousGame = gamePhase === 'setup' ? readPreviousGame(saved.previousGame) : null;
    history = (Array.isArray(saved.history) ? saved.history.slice(-40) : []).map(readSnapshot);
    lastTurn = readLastTurn(saved.lastTurn || saved.lastBotTurn) || lastTurnFromHistory();
    // Arm the existing local13 commander without rebuilding the saved position.
    if (saved.balanceRevision === 20 || saved.balanceRevision === 21) {
      const commanderBalance = updateSavedBalance(config, saved.balanceRevision);
      if (JSON.stringify(commanderBalance) !== JSON.stringify(config)) {
        config = validateConfig(commanderBalance); balanceUpdated = true; commanderUpdated = true; gameVersion = CURRENT_GAME_VERSION;
      }
    }
    const updatedBalance = gamePhase === 'setup' && positionKind === 'default' && !editor && classifyPosition(state, config) === 'default' ? pendingSetupBalance(config, saved.balanceRevision) : config;
    if (JSON.stringify(updatedBalance) !== JSON.stringify(config)) {
      checkpoint(); config = validateConfig(updatedBalance); state = createGame(config); log = []; lastTurn = null; balanceUpdated = true;
      gameVersion = CURRENT_GAME_VERSION;
    }
    // Migrate existing choices, but never mistake an unfinished battle for a
    // reusable custom starting position. Running games keep their own settings.
    startPreferences = readStartPreferences(saved.startPreferences ?? {
      firstMove, playMode, humanTeam, botDifficulty,
      ...(gamePhase === 'setup' ? { positionKind, customSetup: { config, state } } : {})
    });
  }
} catch { toast('Сохранённая позиция не прошла проверку. Загружена исходная расстановка.'); }
function resetNewGameDefaults() {
  config = validateConfig(upgradeSelectedBalancePreset(DEFAULT_CONFIG)); state = createGame(config);
  gameVersion = CURRENT_GAME_VERSION;
  positionKind = 'default'; history = []; log = []; lastTurn = null; selected = null;
}
function applyStartPreferences() {
  const preferences = readStartPreferences(startPreferences ?? { firstMove, playMode, humanTeam, botDifficulty });
  ({ firstMove, playMode, humanTeam, botDifficulty } = preferences);
  resetNewGameDefaults();
  if (preferences.positionKind === 'custom') {
    config = clone(preferences.customSetup.config); state = clone(preferences.customSetup.state); positionKind = 'custom';
  }
  startPreferences = preferences;
}
// Standard setups use this release's rules; explicitly chosen custom setups
// and the player's other start selections survive the refresh.
if (freshNewGameRequested && gamePhase === 'setup' && previousGame) applyStartPreferences();
function positionText(p) { return `${p.q}, ${p.r}`; }
function startingTeam() { return firstMove === 'random' ? Math.floor(Math.random() * 2) : firstMove === 'south' ? 1 : 0; }
function visibleState() { return movement ? movement.before.state : combat ? combat.visiblePosition : reviewingTurn && lastTurn ? lastTurn.before.state : state; }
function isBotTurn() { return gamePhase === 'playing' && playMode === 'bot' && state.turn !== humanTeam && state.winner === null && !editor; }
function humanCanMove() { return gamePhase === 'playing' && !movement && !combat && !currentDeaths.length && !reviewingTurn && !isBotTurn() && state.winner === null; }
function cancelBot() { clearTimeout(botTimer); botTimer = null; botRunner.cancel(); }
function cancelMovement() { moveAnimator.cancel(); movement = null; combatAnimator.cancel(); combat = null; }
function resetBotContext(clearLastTurn = true) { clearHint(); cancelBot(); cancelMovement(); if (clearLastTurn) lastTurn = null; reviewingTurn = false; botIssue = ''; botSuspended = false; }
function presentMove(before, action, deaths) {
  cancelMovement();
  const piece = action && !action.pass ? before.state.pieces.find(p => p.id === action.id) : null;
  const route = piece ? movementPath(piece, before.state, before.config, action.to) : [];
  const forecast = piece ? inspectCell(before.state, before.config, action.to, piece.id) : { position: before.state, report: analyze(before.state, before.config) };
  if (route.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { presentKills(before, forecast, deaths); return; }
  const plan = createMovementPlan(route.map(point));
  movement = { before, piece, plan, route, deaths, forecast };
  render(); moveAnimator.start(plan);
}
function presentKills(before, forecast, deaths) {
  if (!deaths.length) { render(); return; }
  const presentation = lethalAttackPresentation(forecast.position, forecast.report, deaths);
  combat = { before, position: forecast.position, visiblePosition: forecast.position, report: forecast.report, deaths,
    ...presentation, activeDeaths: [], groupIndex: 0, arrowCount: 0, phase: 'dimming' };
  // Reduced motion keeps the explanation and timing; CSS removes the spatial
  // death effect and fades while each contribution still appears in order.
  combatAnimator.startSequence(presentation.groups);
}
function canReplayLastCombat() {
  return Boolean(lastTurn && gamePhase === 'playing' && !editor && !reviewingTurn && !movement && !combat && !currentDeaths.length
    && lastTurn.before.state.pieces.length > state.pieces.length);
}
function replayLastCombat() {
  if (!canReplayLastCombat()) return;
  const { before, action } = lastTurn;
  const forecast = action.pass ? { position: before.state, report: analyze(before.state, before.config) }
    : inspectCell(before.state, before.config, action.to, action.id);
  const deaths = forecast.position.pieces.filter(p => forecast.report.get(p.id)?.dead);
  if (!deaths.length) return;
  cancelBot(); selected = null;
  presentKills(before, forecast, deaths);
}
function lastTurnFromHistory() { const entry = history.at(-1); return entry?.action ? readLastTurn({ before: entry, action: entry.action }) : null; }
function recentBotHistory() {
  const recent = []; let ply = state.ply;
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index];
    if (entry.state.ply !== ply - 1 || JSON.stringify(entry.config) !== JSON.stringify(config)) break;
    recent.unshift(entry); ply--;
  }
  return recent;
}
function queueBot() {
  if (!ready || !isBotTurn() || movement || combat || currentDeaths.length || reviewingTurn || botIssue || botSuspended || $('#rules-dialog')?.hidden === false || $('dialog[open]') || botRunner.active || botTimer !== null) return;
  botTimer = setTimeout(() => { botTimer = null; if (isBotTurn() && !movement && !combat && !reviewingTurn && $('#rules-dialog')?.hidden !== false && !$('dialog[open]')) startBot(); }, 420);
}
function startBot() {
  const requestedState = state, requestedConfig = config, recent = recentBotHistory(), lastActions = new Map();
  for (const entry of recent) if (entry.action?.id) lastActions.set(entry.action.id, entry.action);
  botRunner.run({ state, config, options: { ...BOT_DIFFICULTIES[botDifficulty], seed: 17001, previousStates: [...recent.map(entry => entry.state), state], lastActions: [...lastActions] } }, result => {
    if (state !== requestedState || config !== requestedConfig || !isBotTurn() || editor || reviewingTurn) return;
    if (!result?.action) { botIssue = 'У бота нет допустимого хода. Можно разрешить пропуск в настройках или исследовать позицию в редакторе.'; render(); return; }
    try {
      const before = currentSnapshot(), action = result.action.pass ? { pass: true } : { ...result.action, from: clone(state.pieces.find(p => p.id === result.action.id)) };
      const outcome = action.pass ? pass(state, config) : move(state, config, action.id, action.to);
      checkpoint('bot', action); lastTurn = { before, action: readAction(action) }; state = outcome.state;
      log.push({ text: action.pass ? `${TEAM_NAMES[before.state.turn]} · бот · пропуск хода` : `${TEAM_NAMES[outcome.action.team]} · бот · ${LABELS[outcome.action.type]}: ${positionText(outcome.action.from)} → ${positionText(outcome.action.to)}`, detail: deathDetail(outcome.deaths) });
      recordGameAction(action.pass ? 'pass' : 'move', { action, deaths: outcome.deaths, actor: 'bot' });
      selected = null; botIssue = ''; presentMove(before, action, outcome.deaths);
    } catch { botIssue = 'Не удалось применить ход бота. Попробуйте ещё раз.'; render(); }
  }, error => { botIssue = error.message || 'Не удалось запустить бота. Попробуйте ещё раз.'; render(); });
}
function point(c) { return config.geometry === 'hex' ? hexGridPoint(c) : { x: c.q * 59, y: c.r * 59 }; }
function polygon(c) { const { x, y } = point(c); return config.geometry === 'hex' ? hexGridPolygon({ x, y }) : `${x-28},${y-28} ${x+28},${y-28} ${x+28},${y+28} ${x-28},${y+28}`; }
function boardMarkup() {
  const restoreFocus = $('#board').contains(document.activeElement) && document.activeElement?.hasAttribute('data-cell');
  const state = visibleState();
  const board = cells(config), points = board.map(point), minX = Math.min(...points.map(p => p.x)) - 37, maxX = Math.max(...points.map(p => p.x)) + 37, minY = Math.min(...points.map(p => p.y)) - 40, maxY = Math.max(...points.map(p => p.y)) + 40;
  $('#board').setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  const occupied = new Map(state.pieces.map(p => [key(p.q, p.r), p])), destinations = new Set(available.map(c => key(c.q, c.r)));
  const selectedPiece = state.pieces.find(p => p.id === selected);
  if (!board.some(cell => key(cell.q, cell.r) === boardFocus)) {
    const first = selectedPiece || state.pieces.find(piece => piece.team === state.turn) || board[0];
    boardFocus = first ? key(first.q, first.r) : null;
  }
  const tokens = [];
  $('#board').innerHTML = `<defs><clipPath id="aura-field-clip">${board.map(cell => `<polygon points="${polygon(cell)}"/>`).join('')}</clipPath><filter id="damage-arrow-outline" filterUnits="userSpaceOnUse" x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="1" result="edge"/><feFlood flood-color="#fffefb" result="outline-color"/><feComposite in="outline-color" in2="edge" operator="in" result="outline"/><feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge></filter>${ATTACK_TEAM_COLORS.map((color, team) => `<marker id="damage-arrow-${team ? 'south' : 'north'}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="${color}"/></marker>`).join('')}</defs>` + board.map(c => {
    const k = key(c.q, c.r), p = occupied.get(k), { x, y } = point(c);
    const classes = ['cell'];
    if (destinations.has(k) && !editor && selectedPiece?.team === state.turn) classes.push('reachable');
    if (p?.id === selected) classes.push('selected');
    const details = p ? `${TEAM_NAMES[p.team]}, ${LABELS[p.type]}${shieldCanRetreat(p, config) || archerHasEdgeBonus(p, config) ? '-ветеран' : ''}` : 'пусто';
    let token = '';
    if (p) {
      const info = report.get(p.id);
      const appearance = unitAppearance(p, config, ICON_PATHS);
      token = `<g class="piece${appearance.veteran ? ' veteran' : ''} ${p.team === 0 ? 'north' : 'south'} ${info.dead ? 'fatal' : ''} ${combat && !combat.participants.has(p.id) ? 'combat-muted' : ''} ${movement?.piece.id === p.id ? 'moving-origin' : ''}" data-piece-id="${p.id}" data-piece-type="${p.type}" data-veteran="${appearance.veteran}" transform="translate(${x},${y})">${renderTokenBody(appearance, p.team)}${unitBadges(info, { pieceType: p.type, veteran: appearance.veteran })}</g>`;
    }
    tokens.push(token);
    const info = p && report.get(p.id);
    const description = info ? `<desc id="cell-stats-${k}">Урон атаки: ${info.damage}. Броня: ${info.fortitude}. Входящий урон: ${info.incoming}.${info.dead ? ' Погибнет при расчёте.' : ''}</desc>` : '';
    return `<g class="${classes.join(' ')}" data-cell="${k}" tabindex="${k === boardFocus ? 0 : -1}" role="button" ${p ? `aria-pressed="${p.id === selected}" aria-describedby="cell-stats-${k}"` : ''} aria-label="Клетка ${k}: ${details}"><polygon class="tile" points="${polygon(c)}"/>${description}</g>`;
  }).join('') + '<g id="aura-circles" clip-path="url(#aura-field-clip)" aria-hidden="true"></g><g id="selected-attack-reach" aria-hidden="true"></g>' + `<g id="board-pieces" pointer-events="none" aria-hidden="true">${tokens.join('')}</g><g id="attack-lines" class="attack-lines" aria-hidden="true"></g>` + `<g id="death-effects" class="death-effects" aria-hidden="true">${renderDeathEffects(currentDeaths, point, polygon({ q: 0, r: 0 }), ICON_PATHS, config)}</g>` + lastMoveTrace() + hintTrace() + movingTokenMarkup();
  if (restoreFocus) {
    // Replacing cells preserves keyboard focus without starting a new forecast.
    restoringBoardFocus = true;
    try { $('#board [tabindex="0"]')?.focus({ preventScroll: true }); }
    finally { restoringBoardFocus = false; }
  }
}
function paintAuras() {
  const layer = $('#aura-circles');
  if (combat) { layer.innerHTML = ''; layer.auraMarkup = ''; return; }
  const context = inspectionContext();
  const position = context.isPreview && context.piece?.id === selected ? context.position : visibleState();
  const source = position.pieces.find(piece => piece.id === selected);
  const markup = source ? auraCircleMarkup(source, position, config, point, config.geometry === 'hex' ? Math.sqrt(3) * 33 : 59) : '';
  if (layer.auraMarkup !== markup) { layer.innerHTML = markup; layer.auraMarkup = markup; }
}
function lastMoveTrace() {
  if (gamePhase !== 'playing' || !reviewingTurn || !lastTurn || lastTurn.action.pass) return '';
  const source = lastTurn.before.state.pieces.find(p => p.id === lastTurn.action.id);
  const route = source ? movementPath(source, lastTurn.before.state, config, lastTurn.action.to) : [];
  const points = (route.length > 1 ? route : [lastTurn.action.from, lastTurn.action.to]).map(point);
  const from = points[0], to = points.at(-1), start = { ...from }, end = { ...to };
  const next = points[1], prior = points.at(-2), firstLength = Math.hypot(next.x - from.x, next.y - from.y), lastLength = Math.hypot(to.x - prior.x, to.y - prior.y);
  if (!firstLength || !lastLength) return '';
  start.x += (next.x - from.x) / firstLength * 25; start.y += (next.y - from.y) / firstLength * 25;
  end.x -= (to.x - prior.x) / lastLength * 25; end.y -= (to.y - prior.y) / lastLength * 25;
  const path = [start, ...points.slice(1, -1), end].map(p => `${p.x},${p.y}`).join(' '), color = lastTurn.before.state.turn ? '#af6a4b' : '#3e607c';
  return `<g class="last-move-trace" style="--move-color:${color}" aria-hidden="true"><title>Последнее перемещение</title><defs><marker id="last-move-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0 10 5 0 10Z" fill="${color}"/></marker></defs><circle cx="${from.x}" cy="${from.y}" r="25"/><polyline points="${path}" marker-end="url(#last-move-arrow)"/><circle class="move-arrival" cx="${to.x}" cy="${to.y}" r="26"/></g>`;
}
function movingTokenMarkup() {
  if (!movement) return '';
  const p = movement.piece, frame = moveAnimator.active ? moveAnimator.frame : sampleMovement(movement.plan, 0);
  return renderMovingToken(p, frame, ICON_PATHS, 'moving-token', config, p.team, movement.forecast.report.get(p.id));
}
function inspectionContext() {
  const position = visibleState();
  return inspection || { piece: position.pieces.find(p => p.id === selected), position, report, isPreview: false };
}
function highlightSources() {
  if (combat) { $('#attack-lines').innerHTML = combat.phase === 'attacks' ? renderDamageArrows(combat.groups[combat.groupIndex].arrows, point, { pieces: combat.visiblePosition.pieces, board: cells(config), visibleCount: combat.arrowCount, report: combat.report }) : ''; return; }
  const context = movement ? { ...movement.forecast, isPreview: false } : inspectionContext(), target = context.piece;
  const potentialDamage = new Map();
  for (const attack of (target || selected) ? inspectionDamageArrows(target, selected, context.position, context.report, playMode === 'bot' ? humanTeam : context.position.turn) : []) {
    if (attack.source.id === selected) potentialDamage.set(attack.target.id, context.report.get(attack.target.id)?.incoming || 0);
  }
  const sourceIds = new Set(target ? context.report.get(target.id).attackers.map(a => a.id) : []);
  document.querySelectorAll('#board [data-piece-id]').forEach(element => {
    const id = element.dataset.pieceId;
    const previewOrigin = context.isPreview && id === target?.id;
    element.classList.toggle('preview-origin', previewOrigin);
    const info = previewOrigin ? report.get(id) : context.report.get(id);
    element.classList.toggle('fatal', !previewOrigin && (info?.dead || false));
    element.classList.toggle('attacking-source', sourceIds.has(id));
    if (info) {
      element.querySelector('.unit-badges').outerHTML = unitBadges(info, { showIncoming: !previewOrigin && (potentialDamage.has(id) || id === selected || id === target?.id), potentialDamage: potentialDamage.has(id), pieceType: element.dataset.pieceType, veteran: element.dataset.veteran === 'true' });
    }
  });
  document.querySelectorAll('#board [data-cell]').forEach(element => element.classList.toggle('inspection-target', !!target && element.dataset.cell === key(target.q, target.r)));
  paintAttackReach(context); renderInspector(context);
  const layer = $('#attack-lines');
  if (!layer) return;
  if (!target) { layer.innerHTML = ''; return; }
  const end = point(target);
  const targetInfo = context.report.get(target.id);
  const ghostAppearance = context.isPreview ? unitAppearance(target, config, ICON_PATHS) : null;
  const ghost = context.isPreview ? `<g class="preview-ghost ${target.team ? 'south' : 'north'}${ghostAppearance.veteran ? ' veteran' : ''} ${targetInfo.dead ? 'fatal' : ''}" transform="translate(${end.x},${end.y})">${renderTokenBody(ghostAppearance, target.team)}${unitBadges(targetInfo, { showIncoming: true, pieceType: target.type, veteran: ghostAppearance.veteran })}</g>` : '';
  const arrowTarget = context.position.pieces.find(piece => piece.id === selected && piece.team === (playMode === 'bot' ? humanTeam : context.position.turn)) || target;
  const incoming = (context.report.get(arrowTarget.id)?.attackers || []).map(attack => ({ source: context.position.pieces.find(piece => piece.id === attack.id), target: arrowTarget, damage: attack.damage })).filter(attack => attack.source);
  layer.innerHTML = renderDamageArrows(incoming, point, { pieces: context.position.pieces, board: cells(config), report: context.report, previewMarkup: ghost, maxBend: 18 });
}
function paintAttackReach(context) {
  const layer = $('#selected-attack-reach');
  if (!layer) return;
  const visible = visibleState();
  const position = context.isPreview && context.piece?.id === selected ? context.position : visible;
  const piece = position.pieces.find(p => p.id === selected);
  const {cells: attackCells, markup} = attackReachPresentation(piece, position, config, {point, polygonPoints: polygon({q:0,r:0}), visiblePosition: visible, friendlyTeam: playMode === 'bot' ? humanTeam : visible.turn});
  const targetKeys = new Set(attackCells.map(cell => key(cell.q, cell.r)));
  document.querySelectorAll('#board [data-cell]').forEach(element => element.classList.toggle('selected-attack-target', targetKeys.has(element.dataset.cell)));
  if (layer.attackReachMarkup !== markup) { layer.innerHTML = markup; layer.attackReachMarkup = markup; }
}
function renderInspector(context) {
  const position = context.isPreview && context.piece?.id === selected ? context.position : visibleState();
  const piece = position.pieces.find(p => p.id === selected), panel = $('#inspector');
  const pieceId = piece?.id || '';
  $('#reference-panel').hidden = Boolean(piece) || Boolean(hint);
  $('#selection-panel').hidden = !piece || Boolean(hint);
  if (panel.dataset.pieceId !== pieceId) { panel.dataset.pieceId = pieceId; $('.left-panel').scrollTop = 0; }
  if (!piece) {
    panel.innerHTML = '';
    return;
  }
  const info = effective(piece, position, config), base = config.stats[piece.type];
  const names = { move: 'Шаг', damage: 'Сила атаки', range: 'Дальность атаки', fortitude: 'Стойкость' };
  const descriptions = {
    scoutLamp: `Увеличивает дальность союзных лукарей на ${base.rangeBonus}. Не увеличивает дальность броненосцев. ${base.damage > 0 && base.range > 0 ? `Атакует самостоятельно: урон ${base.damage}, дальность ${base.range}. Дальность не увеличивается от аур.` : 'Может атаковать только рядом с союзным ветераном.'}`,
    shield: `Ходит вперёд и вбок, сражается вблизи и прикрывает соседних ${config.shieldDefenseOnly ? 'союзных броненосцев' : 'союзников'}. Завершив ход на чужом краю, получает постоянное усиление.`,
    archer: `Атакует по прямым лучам сетки. Союзные ауры усиливают урон, дальность и стойкость. ${config.archerEdgeDamageBonus > 0 ? `Достигнув чужого края, навсегда получает +${config.archerEdgeDamageBonus} к урону и венок, даже после отхода. Ауру ветерана не получает.` : 'В правилах этой партии усиление лукаря за край не включено.'}${base.aura > 0 && base.damageBonus > 0 ? ' Его аура усиливает атаку союзников, кроме него самого.' : ''}`,
    attackLamp: `${config.drumMoveAllies ? 'Ускоряет всех союзников' : 'Ускоряет союзных броненосцев'}: +${config.drumShieldMoveBonus ?? 0} к шагу при начале действия в ауре.${base.damageBonus > 0 ? ` Также даёт +${base.damageBonus} к урону.` : ''} Сам себя не усиливает. Может атаковать только под поддержкой союзного ветерана.`,
    horn: `Усиливает урон всех союзников на ${base.damageBonus}. Сам себя не усиливает. Может атаковать только под поддержкой союзного ветерана.`,
    defenseLamp: 'Повышает стойкость союзников. Может атаковать только под поддержкой союзного ветерана.'
  };
  const stats = unitStatParts(piece, position, config).map(stat => {
    const calculation = [stat.base, stat.personal ? `+ ${stat.personal}` : '', stat.allied ? `${stat.allied > 0 ? '+' : '−'} ${Math.abs(stat.allied)}` : ''].filter(value => value !== '').join(' ');
    return `<div class="stat-box" data-unit-stat="${stat.field}"><span>${names[stat.field]}</span><strong title="Итого: ${stat.total}">${stat.total}</strong>${stat.personal || stat.allied ? `<em class="stat-calculation">(${calculation} = ${stat.total})</em>` : ''}${stat.personal ? `<small class="personal-bonus">+${stat.personal} за край</small>` : ''}</div>`;
  }).join('');
  const sources = alliedBonusDetails(piece, position, config);
  const bonusLabels = { move: 'к шагу', damage: 'к урону', range: 'к дальности', fortitude: 'к стойкости' };
  const sourceDetails = sources.map(({source, bonuses}) => `<li><strong>${LABELS[source.type]}</strong><span>${Object.entries(bonuses).filter(([,value]) => value > 0).map(([field,value]) => `+${value} ${bonusLabels[field]}`).join(', ')}</span></li>`).join('');
  const aura = shieldCanRetreat(piece, config) ? config.shieldPromotion.allies ?? config.shieldPromotion : base;
  const bonuses = [[piece.type === 'attackLamp' ? config.drumShieldMoveBonus ?? 0 : 0, config.drumMoveAllies ? 'шаг союзников' : 'шаг броненосцев'], [aura.damageBonus, 'урон'], [aura.rangeBonus, 'дальность'], [aura.defenseBonus, config.shieldDefenseOnly && piece.type === 'shield' ? 'стойкость броненосцев' : 'стойкость']].filter(([value]) => value > 0).map(([value, name]) => `${name} +${value}`).join(', ');
  panel.innerHTML = `<div class="piece-heading"><span class="unit-icon ${piece.team ? 'south' : 'north'}${shieldCanRetreat(piece, config) || archerHasEdgeBonus(piece, config) ? ' veteran' : ''}">${icon(piece.type, piece)}</span><div><h2>${LABELS[piece.type]}${shieldCanRetreat(piece, config) || archerHasEdgeBonus(piece, config) ? ' · ветеран' : ''}</h2></div></div><p class="unit-description">${descriptions[piece.type]}</p>${context.isPreview && context.piece?.id === selected ? '<p class="preview-label">Параметры после предполагаемого перемещения</p>' : ''}<div class="stat-grid">${stats}</div>${info.aura > 0 ? `<p class="unit-aura"><strong>Аура · ${info.aura} ${plural(info.aura, ['клетка', 'клетки', 'клеток'])}</strong><br>${bonuses}.</p>` : ''}<div class="sources"><strong>Усиления от союзников</strong>${sources.length ? `<ul class="allied-bonus-list">${sourceDetails}</ul>` : '<p>Сейчас нет усилений от союзников.</p>'}</div>`;
}
function shieldPromotionDescription() {
  const stats = config.stats.shield, p = config.shieldPromotion, allies = p.allies ?? p;
  return `Урон: ${stats.damage + p.damageBonus}, дальность: ${Math.min(stats.range + p.rangeBonus, p.maxRange)}, стойкость: ${stats.fortitude + p.defenseBonus}. Получает ауру в ${allies.aura} ${plural(allies.aura, ['клетку', 'клетки', 'клеток'])}, добавляя союзникам +${allies.damageBonus} к урону, +${allies.rangeBonus} к дальности и +${allies.defenseBonus} к стойкости${config.shieldDefenseOnly ? ' только броненосцев' : ''}. Дальность броненосцев и командиров с собственной атакой от союзных аур не растёт. Под этой аурой фигуры без собственной атаки могут атаковать.`;
}
function shieldDescriptionMarkup(open = false) {
  return `<p class="shield-description">Ходит вперёд и вбок. Аура ${config.stats.shield.aura} ${plural(config.stats.shield.aura, ['клетка', 'клетки', 'клеток'])}: стойкость ${config.shieldDefenseOnly ? 'союзных броненосцев' : 'союзников'} +${config.stats.shield.defenseBonus}. Ауры других фигур не увеличивают дальность атаки броненосцев.</p><details class="shield-promotion" data-shield-promotion${open ? ' open' : ''}><summary>Ветеран</summary><p>Завершив ход на противоположном краю, усиливается: ${shieldPromotionDescription()}</p></details>`;
}
function unitReferenceMarkup(promotionOpen = false) {
  const rows = TYPES.filter(type => config.stats[type]).map(type => {
    const stats = config.stats[type], fields = ['move', 'damage', 'range', 'fortitude'];
    let aura = '';
    if (type === 'archer' && stats.aura > 0 && stats.damageBonus > 0) aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: урон союзников +${stats.damageBonus}, кроме самого лукаря. Бонусы нескольких лукарей складываются.`;
    if (type === 'archer' && config.archerEdgeDamageBonus > 0) aura += ` После чужого края навсегда получает +${config.archerEdgeDamageBonus} к урону. Венок отмечает усиление; дополнительной ауры нет.`;
    if (type === 'scoutLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: дальность +${stats.rangeBonus}. Броненосцы и командиры с собственной атакой этот бонус не получают.`;
    if (type === 'attackLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: шаг ${config.drumMoveAllies ? 'всех союзников' : 'броненосцев'} +${config.drumShieldMoveBonus ?? 0} при начале действия в ауре${stats.damageBonus > 0 ? `, урон +${stats.damageBonus}` : ''}.`;
    if (type === 'horn') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: урон всех союзников +${stats.damageBonus}.`;
    if (type === 'defenseLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: стойкость +${stats.defenseBonus}.`;
    if (type === 'shield') aura = shieldDescriptionMarkup(promotionOpen);
    return `<tr data-reference-type="${type}"><th scope="row"><span class="reference-unit">${icon(type)}<span>${LABELS[type]}</span></span></th>${fields.map(field => `<td data-stat="${field}">${stats[field]}</td>`).join('')}</tr>${aura ? `<tr class="reference-aura" data-reference-aura="${type}"><td colspan="5">${aura}</td></tr>` : ''}`;
  }).join('');
  return '<table class="unit-reference-table"><thead><tr><th scope="col">Фигура</th><th scope="col" title="Максимальный шаг">Шаг</th><th scope="col">Урон</th><th scope="col" title="Дальность атаки">Дал.</th><th scope="col" title="Стойкость">Стойк.</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function renderGameResult(position) {
  const finished = position.winner !== null && gamePhase === 'playing' && !movement && !combat && !currentDeaths.length && !reviewingTurn;
  let reason = '';
  if (finished && ['flag-or-combat', 'combat-units'].includes(config.victoryCondition)) {
    const loss = [0, 1].map(team => {
      const pieces = position.pieces.filter(piece => piece.team === team);
      if (config.victoryCondition === 'flag-or-combat') {
        if (!pieces.some(piece => piece.type === 'defenseLamp')) return 'flag';
        if (pieces.length === 1) return 'only-flag';
      }
      return pieces.some(piece => piece.type === 'shield' || piece.type === 'archer') ? null : 'combat';
    });
    if (position.winner === 'draw') {
      if (loss[0] && loss[0] === loss[1]) {
        reason = { flag: 'Флаги обеих сторон уничтожены', 'only-flag': 'У обеих сторон остались только флаги', combat: 'У обеих сторон не осталось броненосцев и лукарей' }[loss[0]];
      } else if (loss[0] && loss[1]) {
        reason = loss.map((kind, team) => {
          const side = team === 0 ? 'Севера' : 'Юга';
          return kind === 'flag' ? `Флаг ${side} уничтожен` : kind === 'only-flag' ? `У ${side} остался только флаг` : `У ${side} не осталось броненосцев и лукарей`;
        }).join('. ');
      }
    } else if ([0, 1].includes(position.winner)) {
      reason = { flag: 'Флаг противника уничтожен', 'only-flag': 'У противника остался только флаг', combat: 'У противника не осталось броненосцев и лукарей' }[loss[1 - position.winner]] || '';
    }
  }
  const victory = finished ? `${position.winner === 'draw' ? 'Ничья' : `Победа ${position.winner === 0 ? 'Севера' : 'Юга'}`}${reason ? '. ' + reason : ''}` : '';
  const resolvingCombat = Boolean(combat || currentDeaths.length);
  $('#mode-caption').hidden = resolvingCombat || Boolean(movement);
  $('#move-counter').textContent = resolvingCombat ? 'Расчёт боя…' : movement ? 'Движение…' : gamePhase === 'setup' ? editor ? 'Редактор' : 'Подготовка' : `${reviewingTurn ? 'Просмотр · ' : ''}Ход ${position.ply + 1}${victory ? '. ' + victory : ''}`;
  $('.arena-top').dataset.result = !finished ? '' : position.winner === 'draw' ? 'draw' : playMode === 'bot' && position.winner !== humanTeam ? 'loss' : 'win';
}
function renderUpdateNotice() {
  $('#update-notice').hidden = !needsNewGame({ phase: gamePhase, savedVersion: gameVersion, currentRulesVersion: CURRENT_RULES_VERSION, latestRulesVersion });
}
async function checkGameVersion() {
  if (versionCheckPending || document.visibilityState === 'hidden') return;
  versionCheckPending = true;
  try {
    const found = await latestGameVersion({ location, online: navigator.onLine !== false, includeRules: true });
    if (hasNewerGameVersion(CURRENT_GAME_VERSION, found?.version)) latestVersion = found.version;
    latestRulesVersion = found?.rulesVersion ?? latestRulesVersion;
    renderUpdateNotice();
  } finally { versionCheckPending = false; }
}
function render(deaths = []) {
  if (hint && (hint.positionKey !== hintPositionKey() || !canRequestHint())) clearHint();
  if (hint) selected = null;
  renderHint();
  renderUpdateNotice();
  const state = visibleState();
  clearTimeout(deathEffectTimer);
  deaths = combat?.phase === 'deaths' ? combat.activeDeaths : deaths;
  currentDeaths = Array.isArray(deaths) && !matchMedia('(prefers-reduced-motion: reduce)').matches ? deaths : [];
  $('#first-move').value = firstMove;
  $('#play-mode').value = playMode; $('#human-side').value = String(humanTeam);
  $('#bot-difficulty').value = botDifficulty;
  $('#human-side-field').hidden = playMode !== 'bot'; $('#bot-controls').hidden = playMode !== 'bot' || gamePhase !== 'playing';
  $('#start-setup').hidden = gamePhase !== 'setup' || editor;
  $('#start-setup').disabled = refreshingNewGame;
  $('#settings-open').disabled = gamePhase !== 'setup' || positionKind !== 'custom' || editor || refreshingNewGame;
  $('#settings-open').hidden = positionKind !== 'custom';
  $('#new-game').disabled = Boolean(movement || combat);
  $('#new-game').hidden = gamePhase !== 'playing';
  $('#position-kind').value = positionKind;
  globalThis.window?.gameSelects?.sync();
  $('#configure-position').disabled = positionKind !== 'custom';
  $('#configure-position').hidden = positionKind !== 'custom';
  $('#mode-caption').textContent = playMode === 'bot' ? `Бот · ${BOT_DIFFICULTIES[botDifficulty].label}` : '2 игрока на одном экране';
  hover = null; inspection = null; report = combat ? combat.report : analyze(state, config);
  const p = state.pieces.find(p => p.id === selected); if (!p) selected = null;
  available = p && !editor && humanCanMove() && p.team === state.turn && state.winner === null ? reachable(p, state, config) : [];
  boardMarkup(); paintAuras(); highlightSources();
  $('#board').setAttribute('aria-busy', String(Boolean(movement || combat)));
  $('#board').setAttribute('data-combat-phase', combat?.phase || 'idle');
  renderGameResult(state);
  $('#scoreboard').innerHTML = [0, 1].map(team => {
    const pieces = state.pieces.filter(p => p.team === team), n = pieces.length;
    const active = gamePhase === 'playing' && state.turn === team && state.winner === null && !editor && !combat && !currentDeaths.length;
    const roster = TYPES.map(type => {
      const count = pieces.filter(p => p.type === type).length, label = `${LABELS[type]}: ${count}`;
      return `<li class="team-unit ${count ? '' : 'empty'}" data-unit-type="${type}" title="${label}" aria-label="${label}">${icon(type)}<span aria-hidden="true">${count}</span></li>`;
    }).join('');
    return `<div class="team-card ${team ? 'south' : 'north'} ${active ? 'active' : ''}"><div><span class="team-title"><span class="team-dot"></span>${TEAM_NAMES[team]}${playMode === 'bot' ? `<span class="team-role">${team === humanTeam ? 'Вы' : 'Бот'}</span>` : ''}</span><div class="turn-tag">${gamePhase === 'setup' ? 'РАССТАНОВКА' : combat ? 'РАСЧЁТ БОЯ' : currentDeaths.length ? 'РАСЧЁТ БОЯ' : active ? movement ? 'ДВИЖЕНИЕ' : reviewingTurn ? 'ПЕРЕД ХОДОМ' : playMode === 'bot' && team !== humanTeam ? 'ХОД БОТА' : 'ВАШ ХОД' : ' '}</div></div><span class="team-count">${n} ${plural(n, ['фигура', 'фигуры', 'фигур'])}</span><ul class="team-roster" role="list" aria-label="Оставшиеся фигуры команды ${TEAM_NAMES[team]}">${roster}</ul></div>`;
  }).join('');
  $('#unit-reference').innerHTML = unitReferenceMarkup(Boolean($('#unit-reference [data-shield-promotion]')?.open));
  $('#config-summary').innerHTML = `<div class="summary-row"><span>Групп на игрока</span><strong>${config.army.groups}</strong></div><div class="summary-row"><span>Состав группы</span><strong>${config.army.shields} ${plural(config.army.shields, ['броненосец', 'броненосца', 'броненосцев'])} + ${config.army.archers} ${plural(config.army.archers, ['лукарь', 'лукаря', 'лукарей'])}</strong></div><div class="summary-row"><span>Барабаны / горны / знамёна / командиры</span><strong>${config.army.attackLamps} / ${config.army.horns ?? 0} / ${config.army.defenseLamps} / ${config.army.scoutLamps}</strong></div><div class="summary-row"><span>Дополнительно в центре</span><strong>${(config.army.centralShields ?? 0) + (config.army.rearShields ?? 0)} броненосцев / ${config.army.rearArchers ?? 0} лукарей</strong></div><div class="summary-row"><span>Стрельба</span><strong>${config.geometry === 'hex' ? '6 лучей через грани' : config.experiments.squareDiagonals ? '8 направлений' : '4 направления'}</strong></div>`;
  $('#editor-controls').hidden = !editor;
  $('#pass-turn').hidden = !config.experiments.allowPass || gamePhase !== 'playing';
  $('#pass-turn').disabled = !humanCanMove();
  $('#undo').disabled = Boolean(movement || combat) || !history.length || reviewingTurn || (gamePhase === 'setup' && !editor);
  $('#undo').title = playMode === 'bot' && !editor ? 'Отменить свой ход и ответ бота' : 'Отменить последнее действие';
  $('#replay-combat').disabled = !canReplayLastCombat();
  $('#review-previous').disabled = Boolean(movement || combat) || !lastTurn || gamePhase !== 'playing' || reviewingTurn;
  $('#review-previous').setAttribute('aria-pressed', String(reviewingTurn));
  $('#review-current').disabled = !reviewingTurn;
  $('#resume-bot').hidden = !isBotTurn() || reviewingTurn || editor || (!botIssue && !botSuspended);
  $('#resume-bot').disabled = Boolean(movement || combat);
  $('#resume-bot').textContent = botIssue ? 'Повторить ход бота' : 'Ход бота';
  const lastAction = lastTurn?.action;
  const lastPiece = lastAction && !lastAction.pass ? lastTurn.before.state.pieces.find(p => p.id === lastAction.id) : null;
  const lastMoveText = lastAction ? lastAction.pass ? `Последний ход: ${TEAM_NAMES[lastTurn.before.state.turn]} · пропуск.` : `Последний ход: ${TEAM_NAMES[lastTurn.before.state.turn]} · ${LABELS[lastPiece?.type] || 'Фигура'} · ${positionText(lastAction.from)} → ${positionText(lastAction.to)}.` : 'Сделайте ход. Стрелки рядом с «Отменить» позволяют посмотреть предыдущую позицию.';
  $('#bot-status').textContent = combat ? 'Расчёт боя…' : movement ? `${TEAM_NAMES[movement.piece.team]} · ${LABELS[movement.piece.type]} перемещается…` : currentDeaths.length ? 'Расчёт боя…' : editor ? 'Бот не ходит в редакторе.' : reviewingTurn ? lastMoveText : botIssue || (isBotTurn() ? botSuspended ? 'Ход бота приостановлен. Нажмите «Ход бота», чтобы продолжить.' : $('dialog[open]') ? 'Бот ждёт закрытия окна.' : 'Бот выбирает ход…' : lastMoveText);
  let boardMessage = editor ? 'Выберите фигуру в палитре и нажмите на пустую клетку. Для удаления выберите фигуру и нажмите Backspace или используйте ластик.' : selected && p?.team === state.turn ? 'Подсвечены пустые клетки, до которых можно пройти. Наведите на клетку для прогноза.' : 'Выберите свою фигуру, затем подсвеченную клетку.';
  if (!editor && selected && p?.team === state.turn && p.type === 'shield') boardMessage = shieldCanRetreat(p, config) ? `Край достигнут: ход во все стороны, постоянные +${config.shieldPromotion.damageBonus} к урону и +${config.shieldPromotion.defenseBonus} к стойкости, дальность до ${config.shieldPromotion.maxRange}; аура атаки и защиты — ${(config.shieldPromotion.allies ?? config.shieldPromotion).aura} ${plural((config.shieldPromotion.allies ?? config.shieldPromotion).aura, ['клетка', 'клетки', 'клеток'])}.` : 'Броненосец ходит вперёд и вбок. Завершив ход на противоположном краю поля, навсегда получает ход назад.';
  if (!editor && state.winner === null && !state.pieces.filter(p => p.team === state.turn).some(p => reachable(p, state, config).length)) boardMessage = 'У команды нет доступных ходов. Исследуйте позицию в редакторе или разрешите пропуск в настройках.';
  if (!editor && isBotTurn()) boardMessage = 'Сейчас ход бота. Можно рассматривать атаки и ауры или открыть настройки.';
  else if (!editor && !selected && lastAction) boardMessage = `${lastMoveText} Выберите свою фигуру.`;
  if (!editor && p && p.team !== state.turn && !isBotTurn()) boardMessage = `Выбрана фигура команды «${TEAM_NAMES[p.team]}». Сейчас ходит «${TEAM_NAMES[state.turn]}» — выберите ${state.turn === 0 ? 'синюю' : 'оранжевую'} фигуру.`;
  if (gamePhase === 'setup') boardMessage = editor ? 'Выберите фигуру и пустую клетку для перестановки. Палитра добавляет фигуры. «Готово» завершает настройку позиции.' : '';
  if (reviewingTurn) boardMessage = `Просмотр перед последним ходом. ${lastMoveText} Нажмите →, чтобы вернуться к партии.`;
  if (currentDeaths.length) boardMessage = 'Расчёт боя: погибшие фигуры удаляются одновременно.';
  if (movement) boardMessage = `${TEAM_NAMES[movement.piece.team]} · ${LABELS[movement.piece.type]}: ${positionText(lastAction.from)} → ${positionText(lastAction.to)}. Движение…`;
  if (combat) boardMessage = combat.phase === 'dimming' ? 'Выделяем участников расчёта боя.' : combat.phase === 'attacks' ? 'Стрелки по очереди показывают вклад в смертельный урон каждой цели.' : 'Показ гибели. Ход перейдёт другой стороне после завершения расчёта.';
  $('#board-hint').textContent = boardMessage;
  $('#board-hint').hidden = true;
  $('#bot-status').hidden = !botIssue;
  $('#bot-controls').hidden = !botIssue && $('#resume-bot').hidden;
  document.querySelectorAll('[data-team]').forEach(b => b.classList.toggle('active', Number(b.dataset.team) === editorTeam));
  $('#erase-tool').classList.toggle('selected-tool', tool === 'erase');
  $('#piece-palette').innerHTML = TYPES.map(type => `<button class="palette-item ${tool === type ? 'active' : ''}" data-tool="${type}">${icon(type)}<span>${LABELS[type]}</span></button>`).join('');
  save();
  if (currentDeaths.length && !combat) deathEffectTimer = setTimeout(() => { currentDeaths = []; render(); }, DEATH_EFFECT_DURATION);
  queueBot();
}
function deathDetail(deaths) { return deaths.length ? 'Погибли: ' + [0, 1].map(team => { const n = deaths.filter(p => p.team === team).length; return n ? `${TEAM_NAMES[team]} — ${n}` : ''; }).filter(Boolean).join(', ') : 'Все фигуры держатся.'; }
function clearSelection() {
  if (!selected || movement || combat || currentDeaths.length) return;
  selected = null; render();
}
function deleteEditorSelection(event) {
  if (event.key !== 'Backspace' || !editor || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || $('dialog[open]')) return;
  const focus = document.activeElement;
  if (focus?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(focus?.tagName)) return;
  if (!state.pieces.some(piece => piece.id === selected)) return;
  event.preventDefault();
  checkpoint();
  state.pieces = state.pieces.filter(piece => piece.id !== selected);
  selected = null; inspection = null; hover = null; state.winner = null;
  render();
}
function onCell(q, r) {
  const occupant = visibleState().pieces.find(p => p.q === q && p.r === r);
  if (!editor && occupant && !movement && !combat && !currentDeaths.length) { selected = selected === occupant.id ? null : occupant.id; render(); return; }
  if (!editor && !humanCanMove()) { clearSelection(); return; }
  if (editor) {
    if (tool === 'erase') { if (occupant) { checkpoint(); state.pieces = state.pieces.filter(p => p !== occupant); selected = null; state.winner = null; render(); } return; }
    if (occupant) { selected = selected === occupant.id ? null : occupant.id; render(); return; }
    const moving = state.pieces.find(p => p.id === selected);
    if (moving) { checkpoint(); moving.q = q; moving.r = r; state.winner = null; selected = null; render(); return; }
    checkpoint(); const id = 'e' + crypto.randomUUID(); state.pieces.push({ id, type: tool, team: editorTeam, q, r, group: null }); state.winner = null; selected = id; render(); return;
  }
  if (occupant) { selected = selected === occupant.id ? null : occupant.id; render(); return; }
  if (!selected) return;
  if (!available.some(c => c.q === q && c.r === r)) { clearSelection(); return; }
  try { const result = move(state, config, selected, { q, r }), before = currentSnapshot(), action = { id: selected, from: result.action.from, to: result.action.to }; checkpoint(playMode === 'bot' ? 'human' : 'other', action); lastTurn = { before, action }; state = result.state; log.push({ text: `${TEAM_NAMES[result.action.team]} · ${LABELS[result.action.type]}: ${positionText(result.action.from)} → ${q}, ${r}`, detail: deathDetail(result.deaths) }); recordGameAction('move', { action, deaths: result.deaths, actor: 'human' }); selected = null; presentMove(before, action, result.deaths); } catch (error) { toast(error.message); }
}
function focusBoardCell(cellKey, moveFocus = false) {
  boardFocus = cellKey;
  document.querySelectorAll('#board [data-cell]').forEach(cell => cell.setAttribute('tabindex', cell.dataset.cell === cellKey ? '0' : '-1'));
  if (moveFocus) $('#board [tabindex="0"]')?.focus({ preventScroll: true });
}
$('.board-wrap').addEventListener('click', event => {
  const cell = event.target.closest('[data-cell]');
  if (cell) { focusBoardCell(cell.dataset.cell); onCell(...cell.dataset.cell.split(',').map(Number)); }
  else clearSelection();
});
$('#board').addEventListener('mousedown', event => { if (event.target === $('#board')) event.preventDefault(); });
$('#board').addEventListener('keydown', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault(); onCell(...cell.dataset.cell.split(',').map(Number));
  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const [q, r] = cell.dataset.cell.split(',').map(Number);
    const target = boardNavigationTarget(cells(config), { q, r }, event.key, config.geometry, event.ctrlKey || event.metaKey);
    focusBoardCell(key(target.q, target.r), true);
  }
});
function hoverCell(event) {
  if (restoringBoardFocus || combat || movement) return;
  const c = event.target.closest('[data-cell]'), k = c?.dataset.cell;
  if (!k || k === hover) return; hover = k;
  const [q, r] = k.split(',').map(Number);
  inspection = inspectCell(visibleState(), config, { q, r }, editor || gamePhase !== 'playing' || reviewingTurn || isBotTurn() ? null : selected, report);
  paintAuras(); highlightSources();
}
function clearHover() { hover = null; inspection = null; paintAuras(); highlightSources(); }
$('#board').addEventListener('pointermove', hoverCell);
$('#board').addEventListener('focusin', hoverCell);
$('#board').addEventListener('pointerleave', clearHover);
$('#board').addEventListener('focusout', event => { if (!$('#board').contains(event.relatedTarget)) clearHover(); });
document.addEventListener('click', dismissHintOnClick, true);
$('#show-hint').addEventListener('click', requestHint);
$('#undo').addEventListener('click', () => {
  if (movement || combat || !history.length || reviewingTurn || (gamePhase === 'setup' && !editor)) return;
  let previous = history.pop();
  if (playMode === 'bot' && !editor && previous.actor === 'bot' && history.at(-1)?.actor === 'human' && history.at(-1).state.ply === previous.state.ply - 1) previous = history.pop();
  resetBotContext(); config = previous.config; state = previous.state; log = previous.log; positionKind = previous.positionKind; gameVersion = previous.gameVersion ?? null; selected = null;
  if (gamePhase === 'playing' && !editor) archiveRecorder.record('undo', { config, state });
  lastTurn = lastTurnFromHistory(); botSuspended = isBotTurn(); render();
});
function openStartSettings() {
  if (gamePhase !== 'setup' || editor || refreshingNewGame) return;
  const dialog = $('#start-dialog');
  if (!dialog.open) dialog.showModal();
}
function dismissDialog(dialog) {
  if (dialog.id === 'start-dialog' && previousGame && gamePhase === 'setup' && !editor) return returnToGame();
  dialog.close();
}
async function openNewGame() {
  if (gamePhase !== 'playing' || refreshingNewGame || movement || combat) return;
  const backup = { snapshot: currentSnapshot(), history: clone(history), lastTurn: clone(lastTurn), playMode, humanTeam, firstMove, botDifficulty };
  resetBotContext(); previousGame = backup; gamePhase = 'setup'; editor = false;
  applyStartPreferences();
  const canRefresh = Boolean($('#bot-worker-source')) && ['http:', 'https:'].includes(location.protocol);
  refreshingNewGame = canRefresh; render();
  if (canRefresh && save()) {
    toast('Проверяем обновление игры…');
    if (await refreshNewGamePage({ location, online: navigator.onLine !== false })) return;
    toast('Обновление недоступно. Новая игра подготовлена в текущей версии.');
  }
  refreshingNewGame = false; render();
  openStartSettings();
}
function startGame() {
  if (gamePhase !== 'setup' || editor || refreshingNewGame) return;
  try {
    const next = prepareStartPosition(state, config, startingTeam());
    startPreferences = currentStartPreferences();
    resetBotContext(); state = next; gamePhase = 'playing'; positionKind = classifyPosition(state, config); gameVersion = CURRENT_GAME_VERSION;
    archiveRecorder.start(archiveGameMetadata());
    history = []; log = []; previousGame = null; selected = null; $('#start-dialog').close(); render();
  } catch (error) { toast(error.message); }
}
$('#start-setup').addEventListener('click', async () => {
  if (gamePhase !== 'setup' || refreshingNewGame || editor) return;
  if (hasNewerGameVersion(CURRENT_GAME_VERSION, latestVersion) && $('#bot-worker-source')) {
    refreshingNewGame = true; render();
    if (save() && await refreshNewGamePage({ location, online: navigator.onLine !== false })) return;
    refreshingNewGame = false; render();
    toast('Обновление недоступно. Можно продолжить в текущей версии.');
  }
  openStartSettings();
});
$('#new-game').addEventListener('click', openNewGame);
$('#start-game').addEventListener('click', startGame);
function returnToGame() {
  if (!previousGame || gamePhase !== 'setup') return;
  const backup = previousGame; resetBotContext();
  config = backup.snapshot.config; state = backup.snapshot.state; log = backup.snapshot.log; positionKind = backup.snapshot.positionKind; gameVersion = backup.snapshot.gameVersion ?? null;
  history = backup.history; lastTurn = backup.lastTurn; playMode = backup.playMode; humanTeam = backup.humanTeam; firstMove = backup.firstMove; botDifficulty = readBotDifficulty(backup.botDifficulty);
  previousGame = null; gamePhase = 'playing'; editor = false; selected = null; $('#start-dialog').close(); render();
  archiveRecorder.resume(archiveGameMetadata());
}
$('#start-dialog').addEventListener('cancel', event => { event.preventDefault(); dismissDialog(event.currentTarget); });
$('#first-move').addEventListener('change', event => { if (gamePhase !== 'setup') return; firstMove = event.target.value; save(); });
$('#play-mode').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); playMode = event.target.value; selected = null; render(); });
$('#human-side').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); humanTeam = Number(event.target.value); selected = null; render(); });
$('#bot-difficulty').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); botDifficulty = readBotDifficulty(event.target.value); render(); });
$('#position-kind').addEventListener('change', event => {
  if (gamePhase !== 'setup' || editor) return;
  try {
    const kind = event.target.value;
    if (kind === 'default') { const defaults = clone(DEFAULT_CONFIG), next = createGame(defaults); resetBotContext(); config = defaults; state = next; history = []; log = []; selected = null; }
    positionKind = kind; render();
  } catch (error) { render(); toast(error.message); }
});
$('#configure-position').addEventListener('click', () => {
  if (gamePhase !== 'setup' || positionKind !== 'custom' || editor) return;
  resetBotContext(); editor = true; history = []; selected = null; $('#start-dialog').close(); render();
});
$('#editor-done').addEventListener('click', () => {
  if (!editor) return;
  try { state = validateState(state, config); positionKind = 'custom'; editor = false; history = []; log = []; selected = null; render(); openStartSettings(); }
  catch (error) { toast(error.message); }
});
$('#replay-combat').addEventListener('click', replayLastCombat);
$('#review-previous').addEventListener('click', () => { if (!lastTurn || gamePhase !== 'playing' || reviewingTurn || movement || combat) return; cancelBot(); cancelMovement(); reviewingTurn = true; selected = null; render(); });
$('#review-current').addEventListener('click', () => { if (!reviewingTurn) return; reviewingTurn = false; selected = null; render(); });
$('#resume-bot').addEventListener('click', () => { botIssue = ''; botSuspended = false; render(); });
document.querySelector('.team-select').addEventListener('click', event => { const b = event.target.closest('[data-team]'); if (b) { editorTeam = Number(b.dataset.team); selected = null; render(); } });
$('#piece-palette').addEventListener('click', event => { const b = event.target.closest('[data-tool]'); if (b) { tool = b.dataset.tool; selected = null; render(); } });
$('#erase-tool').addEventListener('click', () => { tool = 'erase'; selected = null; render(); });
$('#clear-board').addEventListener('click', () => { if (!editor) return; resetBotContext(); checkpoint(); state = { pieces: [], turn: 0, ply: 0, winner: null }; log = []; selected = null; render(); });
$('#resolve-position').addEventListener('click', () => { if (!editor) return; resetBotContext(); checkpoint(); const result = resolve(state, config); state = result.state; state.ply = 0; state.winner = null; log.push({ text: 'Расчёт позиции без перемещения', detail: deathDetail(result.deaths) }); selected = null; render(result.deaths); toast(deathDetail(result.deaths)); });
$('#pass-turn').addEventListener('click', () => { if (!humanCanMove()) return; try { const result = pass(state, config), before = currentSnapshot(), action = { pass: true }; checkpoint(playMode === 'bot' ? 'human' : 'other', action); lastTurn = { before, action }; log.push({ text: `${TEAM_NAMES[state.turn]} · пропуск хода`, detail: deathDetail(result.deaths) }); state = result.state; recordGameAction('pass', { action, deaths: result.deaths, actor: 'human' }); selected = null; presentMove(before, action, result.deaths); } catch (e) { toast(e.message); } });

const statFields = [['move', 'Шаг'], ['damage', 'Урон'], ['range', 'Дальность поражения'], ['fortitude', 'Стойкость'], ['aura', 'Радиус ауры'], ['damageBonus', 'Бонус урона'], ['rangeBonus', 'Бонус дальности'], ['defenseBonus', 'Бонус стойкости']];
const promotionFields = [['damageBonus', 'Личный бонус урона'], ['rangeBonus', 'Личный бонус дальности'], ['defenseBonus', 'Личный бонус стойкости'], ['maxRange', 'Предел дальности броненосца']];
const promotionAllyFields = [['aura', 'Радиус ауры'], ['damageBonus', 'Союзникам: бонус урона'], ['rangeBonus', 'Союзникам: бонус дальности'], ['defenseBonus', 'Союзникам: бонус стойкости']];
const armyFields = [['groups', 'Групп на игрока'], ['shields', 'Броненосцев в группе'], ['archers', 'Лукарей в группе'], ['attackLamps', 'Барабанов'], ['horns', 'Горнов'], ['defenseLamps', 'Знамён'], ['scoutLamps', 'Командиров'], ['centralShields', 'Броненосцев в центре'], ['rearArchers', 'Доп. лукарей в центре'], ['rearShields', 'Броненосцев в заднем центре']];
const experimentFields = [['squareDiagonals', 'На квадратах диагональ считается одним шагом; атака по 8 направлениям'], ['lampShieldBlocking', 'Вражеские щиты перекрывают атаки поддержки'], ['allyShotsPass', 'Союзные фигуры пропускают атаки своей команды'], ['aurasThroughShields', 'Ауры поддержки проходят сквозь щиты'], ['allowPass', 'Разрешить пропуск хода с обычным расчётом боя']];
function fillSettings(c) {
  const settingsTypes = TYPES.filter(type => c.stats[type]);
  const form = $('#settings-form'); form.elements.geometry.value = c.geometry; form.elements.size.value = c.size; form.elements.auraDefenseCap.value = c.auraDefenseCap ?? -1; form.elements.victoryCondition.value = c.victoryCondition ?? 'all-units'; form.elements.deploymentOffset.value = c.deploymentOffset ?? 0; form.elements.drumShieldMoveBonus.value = c.drumShieldMoveBonus ?? 0;
  $('#army-inputs').innerHTML = armyFields.map(([name, label]) => `<label>${label}<input type="number" name="army.${name}" value="${c.army[name] ?? 0}" min="0" max="${name === 'groups' ? 6 : 12}" required></label>`).join('');
  $('#stats-table').innerHTML = `<thead><tr><th>Параметр</th>${settingsTypes.map(t => `<th>${LABELS[t]}</th>`).join('')}</tr></thead><tbody>${statFields.map(([field, label]) => `<tr><td>${label}</td>${settingsTypes.map(type => { const na = (type === 'horn' && ['damage','range','rangeBonus','defenseBonus'].includes(field)) || (type === 'scoutLamp' && ['damageBonus','defenseBonus'].includes(field)) || (type === 'attackLamp' && field === 'rangeBonus') || (type === 'defenseLamp' && ['damage', 'range'].includes(field)) || (type === 'archer' && ['rangeBonus', 'defenseBonus'].includes(field)) || (type === 'shield' && ['damageBonus', 'rangeBonus'].includes(field)) || (type === 'attackLamp' && field === 'defenseBonus') || (type === 'defenseLamp' && ['damageBonus', 'rangeBonus'].includes(field)); return `<td>${na ? '<span class="na">—</span>' : `<input aria-label="${LABELS[type]}: ${label}" name="stats.${type}.${field}" type="number" min="${field === 'move' ? 1 : 0}" max="${field === 'move' ? 6 : 20}" value="${c.stats[type][field]}" required>`}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
  $('#promotion-inputs').innerHTML = promotionFields.map(([name, label]) => `<label>${label}<input aria-label="Броненосец после края: ${label}" type="number" name="shieldPromotion.${name}" value="${c.shieldPromotion[name]}" min="0" max="20" required></label>`).join('');
  const allies = c.shieldPromotion.allies ?? c.shieldPromotion;
  $('#promotion-allies-inputs').innerHTML = promotionAllyFields.map(([name, label]) => `<label>${label}<input aria-label="Аура ветерана: ${label}" type="number" name="shieldPromotion.allies.${name}" value="${allies[name]}" min="0" max="20" required></label>`).join('');
  $('#experiment-inputs').innerHTML = experimentFields.map(([name, label]) => `<label><input type="checkbox" name="experiment.${name}" ${c.experiments[name] ? 'checked' : ''}>${label}</label>`).join('');
  if ($('#drum-move-label')) $('#drum-move-label').textContent = `Барабан: бонус шага ${c.drumMoveAllies ? 'всех союзников' : 'броненосцев'}`;
  if ($('#drum-move-help')) $('#drum-move-help').textContent = `Дополнительный шаг получает ${c.drumMoveAllies ? 'любая союзная фигура, начинающая' : 'союзный броненосец, начинающий'} действие в ауре барабана. Дальность перемещения сохраняется до конца этого действия.`;
  $('#settings-error').textContent = ''; updateSizeLabel(); globalThis.window?.gameSelects?.sync();
}
function updateSizeLabel() { const form = $('#settings-form'), hex = form.elements.geometry.value === 'hex'; $('#size-label').textContent = hex ? 'Радиус поля' : 'Сторона поля'; form.elements.size.min = hex ? 3 : 6; form.elements.size.max = hex ? 6 : 12; }
function settingsFromForm() {
  const next = clone(config), form = $('#settings-form'); next.geometry = form.elements.geometry.value; next.size = Number(form.elements.size.value); next.auraDefenseCap = Number(form.elements.auraDefenseCap.value); next.victoryCondition = form.elements.victoryCondition.value; next.deploymentOffset = Number(form.elements.deploymentOffset.value); next.drumShieldMoveBonus = Number(form.elements.drumShieldMoveBonus.value);
  for (const [name] of armyFields) next.army[name] = Number(form.elements['army.' + name].value);
  for (const type of TYPES) for (const [field] of statFields) { const input = form.elements[`stats.${type}.${field}`]; if (input) { if (input.value.trim() === '') throw new Error('Заполните все числовые параметры.'); next.stats[type][field] = Number(input.value); } }
  for (const [name] of promotionFields) { const input = form.elements['shieldPromotion.' + name]; if (input.value.trim() === '') throw new Error('Заполните параметры усиления броненосца.'); next.shieldPromotion[name] = Number(input.value); }
  next.shieldPromotion.allies = {};
  for (const [name] of promotionAllyFields) { const input = form.elements['shieldPromotion.allies.' + name]; if (input.value.trim() === '') throw new Error('Заполните параметры ауры ветерана.'); next.shieldPromotion.allies[name] = Number(input.value); }
  for (const [name] of experimentFields) next.experiments[name] = form.elements['experiment.' + name].checked;
  return validateConfig(next);
}
$('#settings-open').addEventListener('click', () => { if (gamePhase !== 'setup' || positionKind !== 'custom' || editor || refreshingNewGame) return; cancelBot(); cancelMovement(); fillSettings(config); $('#settings-dialog').showModal(); render(); });
$('#settings-form').elements.geometry.addEventListener('change', () => { $('#settings-form').elements.size.value = $('#settings-form').elements.geometry.value === 'hex' ? 5 : 11; updateSizeLabel(); });
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const next = settingsFromForm();
    if (gamePhase === 'playing' && (next.geometry !== config.geometry || next.size !== config.size)) throw new Error('Для изменения поля откройте «Новую игру».');
    const nextState = gamePhase === 'setup' && positionKind === 'default' ? createGame(next) : validateState(state, next);
    if (gamePhase === 'playing' || editor) checkpoint();
    resetBotContext(); config = next; state = nextState; selected = null;
    if (gamePhase === 'playing' && !editor) archiveRecorder.record('config', { config, state });
    $('#settings-dialog').close(); render();
  } catch (error) { $('#settings-error').textContent = error.message; }
});
$('#reset-defaults').addEventListener('click', () => fillSettings(DEFAULT_CONFIG));
createGuideController({ icons: ICON_PATHS, renderBadges: unitBadges,
  beforeOpen: () => { cancelBot(); cancelMovement(); }, onClose: render });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => { render(); }));
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => dismissDialog(b.closest('dialog'))));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', event => { if (event.target === d) { const r = d.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dismissDialog(d); } }));
document.addEventListener('keydown', event => { if ($('#rules-dialog')?.hidden === false) return; if (event.key === 'Tab' && !event.target.closest('dialog')) { event.preventDefault(); return; } deleteEditorSelection(event); if (event.key === 'Escape' && !$('dialog[open]')) { reviewingTurn = false; selected = null; render(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('dialog[open]')) { event.preventDefault(); $('#undo').click(); } });
document.querySelectorAll('[data-icon]').forEach(element => element.innerHTML = icon(element.dataset.icon));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches && movement) { const completed = movement; moveAnimator.cancel(); movement = null; presentKills(completed.before, completed.forecast, completed.deaths); } });
let attackReachInView = true;
function updateAttackReachPlayback() {
  $('#board').classList.toggle('attack-reach-paused', document.hidden || !attackReachInView);
}
const attackReachObserver = new IntersectionObserver(entries => {
  attackReachInView = entries[0].isIntersecting; updateAttackReachPlayback();
});
attackReachObserver.observe($('#board'));
document.addEventListener('visibilitychange', updateAttackReachPlayback);
updateAttackReachPlayback();
if (gamePhase === 'playing') archiveRecorder.resume(archiveGameMetadata());
ready = true; render();
globalThis.window?.gameSelects?.mount();
void checkGameVersion();
setInterval(() => { void checkGameVersion(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkGameVersion(); });
addEventListener('online', () => { void checkGameVersion(); });
if (freshNewGameRequested && gamePhase === 'setup' && previousGame) openStartSettings();
if (presetUpdated) toast('Подготовлена расстановка с одним барабаном и одним знаменем. Нажмите «Начать», чтобы играть.');

if (balanceUpdated) toast(commanderUpdated ? 'Командир: атака 3, дальность 2. Расстановка сохранена.' : 'Обновлена расстановка: броненосец в центре, два новых лукаря; флаг и барабан отодвинуты назад.');
