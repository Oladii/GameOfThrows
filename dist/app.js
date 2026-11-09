import { boardNavigationTarget } from './board-navigation.js';
import { DEFAULT_CONFIG, TYPES, LABELS, TEAM_NAMES, BALANCE_REVISION, updateSavedBalance, upgradeSelectedBalancePreset } from './rules.js';
import { consumeNewGameRefresh, refreshNewGamePage } from './new-game-refresh.js';
import { clone, key, cells, distance, validateConfig, validateState, createGame, analyze, inspectCell, effective, attacks, isLethalDamage, auraReaches, reachable, movementPath, shieldCanRetreat, move, pass, resolve } from './engine.js';
import { BotRunner, DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES, readBotDifficulty } from './bot-client.js';
import { classifyPosition, prepareStartPosition } from './start-position.js';
import { createMovementPlan, sampleMovement, MovementAnimator, CombatAnimator, DEATH_EFFECT_DURATION } from './move-animation.js';
import { GameRecorder } from './game-archive.js';
import { durabilityDisplay, attackCellsFor, unitStatParts, alliedBonusDetails, AURA_COLORS, auraKind, auraCircleMarkup, skullShape, renderDeathEffects, renderMovingToken, unitAppearance, attackMarkerRotation, attackReachPresentation } from './board-presentation.js';
import { createMoveLesson, renderMoveLesson, renderMoveExamples, createCombatLesson, renderCombatExamples, lessonPoint } from './onboarding-examples.js';
import { createUnitLesson, renderUnitExamples } from './onboarding-units.js';
import { createShowcaseBattle, renderShowcaseBattle } from './onboarding-showcase.js';
const $ = selector => document.querySelector(selector);
$('#version-channel').textContent = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname) ? 'Локально' : 'Сайт';
const archiveEndpoint = $('meta[name="game-archive-endpoint"]')?.content || '';
const archiveIsSite = location.origin === 'https://oladii.github.io' && location.pathname.startsWith('/GameOfThrows/');
let archiveRetrying = false;
function renderArchiveStatus(info) {
  const text = { disabled: '', pending: 'Записи партий ожидают отправки в архив.', syncing: 'Сохраняем партию в общем архиве…', saved: 'Партия сохранена в общем архиве.', error: 'Не удалось сохранить запись в общем архиве. Игра продолжается.' };
  $('#archive-status').textContent = archiveRetrying ? 'Повторяем сохранение записей в архив…' : info.failed > 0 ? 'Часть партий ещё не сохранена в архиве. Записи остаются в этом браузере; можно повторить отправку.' : !info.gameId && !info.pending && !['disabled', 'error'].includes(info.state) ? 'Партии автоматически записываются для анализа баланса.' : text[info.state] || '';
  $('#archive-status').hidden = !$('#archive-status').textContent;
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
  scoutLamp: '<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M2 16 4 6h4l2 10m4 0 2-10h4l2 10M10 12h4M5 6V3h2v3m10 0V3h2v3"/>',
  shield: '<path d="M12 2 20 5v6c0 5-4 8-8 11-4-3-8-6-8-11V5Z"/><path d="M12 6v11M8 10h8"/>',
  archer: '<path d="M8 3c10 4 10 14 0 18L12 12Z"/><path d="M3 12h18m-4-3 4 3-4 3"/>',
  attackLamp: '<ellipse cx="12" cy="10" rx="8" ry="3"/><path d="M4 10v8c0 1.7 3.6 3 8 3s8-1.3 8-3v-8M4 11l4 8 4-6 4 6 4-8M7 2l8 5M17 2l-3 3"/>',
  defenseLamp: '<path d="M4 22V3m0 2c5-4 10 4 16 0v11c-6 4-11-4-16 0"/><path d="m9 8 3-1 3 1v3c0 2-1.5 3-3 4-1.5-1-3-2-3-4Z"/>'
};
const icon = (type, piece = null) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${piece ? unitAppearance(piece, config, ICON_PATHS).icon : ICON_PATHS[type]}</svg>`;
const attackBadge = info => `<g class="attack-indicator" data-attack="${info.damage}"><title>Урон атаки: ${info.damage}</title><circle class="attack-badge" cx="-13" cy="13" r="8.5"/><text class="attack-text" x="-13" y="13.4" style="font-size:${String(info.damage).length > 2 ? 7 : 10}px">${info.damage}</text></g>`;
const survivalBadge = info => {
  const status = durabilityDisplay(info);
  return `<g class="survival-indicator ${status.threatened ? 'under-fire' : ''}" data-remaining="${status.value}"><title>${status.description}${status.dead ? ' · погибнет' : ''}</title>${status.dead ? fatalMark() : `<circle class="fort-badge" cx="13" cy="13" r="8.5"/><text class="fort-text" x="13" y="13.4">${status.value}</text>`}</g>`;
};
const unitBadges = info => `<g class="unit-badges">${attackBadge(info)}${survivalBadge(info)}</g>`;
const fatalMark = () => `<g class="fatal-mark" transform="translate(5,5)" aria-hidden="true"><circle class="skull-badge" cx="8" cy="8" r="8.5"/>${skullShape()}</g>`;
let config = clone(DEFAULT_CONFIG), state = createGame(config), history = [], log = [];
let firstMove = 'south';
let gamePhase = 'setup', positionKind = 'default', previousGame = null;
let botDifficulty = DEFAULT_BOT_DIFFICULTY;
let playMode = 'bot', humanTeam = 1, lastTurn = null, reviewingTurn = false, botTimer = null, botIssue = '', botSuspended = false;
const botRunner = new BotRunner();
let boardFocus = null;
let selected = null, editor = false, tool = 'shield', editorTeam = 0, hover = null, inspection = null, toastTimer, fieldView = null;
let report = analyze(state, config), available = [], ready = false;
const STORAGE = 'lamps-prototype-v1';
const PRESET_REVISION = 1;
const START_PREFS_REVISION = 1;
let presetUpdated = false, balanceUpdated = false;
let refreshingNewGame = false;
const freshNewGameRequested = consumeNewGameRefresh(location, window.history);
let currentDeaths = [], deathEffectTimer;
let movement = null;
const moveAnimator = new MovementAnimator(frame => {
  const token = $('#moving-token');
  if (token) { token.setAttribute('transform', `translate(${frame.x},${frame.y})`); token.dataset.progress = String(frame.progress); }
}, () => { const completed = movement; movement = null; if (completed) render(completed.deaths); });
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function currentSnapshot() { return clone({ config, state, log, positionKind }); }
function checkpoint(actor = 'other', action = null) { history.push({ ...currentSnapshot(), actor, action }); if (history.length > 40) history.shift(); }
function save() { try { localStorage.setItem(STORAGE, JSON.stringify({ ...currentSnapshot(), history, firstMove, playMode, humanTeam, botDifficulty, lastTurn, gamePhase, editor, previousGame, balanceRevision: BALANCE_REVISION, presetRevision: PRESET_REVISION, startPrefsRevision: START_PREFS_REVISION })); return true; } catch { if (ready) toast('Не удалось сохранить позицию в браузере.'); return false; } }
function normalizeUnitNames(value) {
  const legacyDefenseForms = { '': 'знаменосец', а: 'знаменосца', у: 'знаменосцу', ом: 'знаменосцем', е: 'знаменосце', ы: 'знаменосцы', ов: 'знаменосцев', ам: 'знаменосцам', ами: 'знаменосцами', ах: 'знаменосцах' };
  value = value.replace(/([Кк])омандир(ами|ов|ом|ам|ах|а|у|ы|е)?/g, (_, initial, ending = '') => { const name = legacyDefenseForms[ending]; return initial === 'К' ? name[0].toUpperCase() + name.slice(1) : name; });
  const names = [['Лампа атаки', LABELS.attackLamp], ['Лампа защиты', LABELS.defenseLamp], ['Знамя атаки', LABELS.attackLamp], ['Знамя защиты', LABELS.defenseLamp], ['Щитоносец', LABELS.shield], ['Стрелок', LABELS.archer]];
  return names.reduce((text, [oldName, newName]) => text.replaceAll(oldName, newName), value);
}
function normalizeLog(value) { return Array.isArray(value) ? value.slice(-100).filter(x => x && typeof x.text === 'string' && x.text.length < 600 && typeof x.detail === 'string' && x.detail.length < 1000).map(x => ({ text: normalizeUnitNames(x.text), detail: normalizeUnitNames(x.detail) })) : []; }
function readSnapshot(value) { const c = validateConfig(value.config), s = validateState(value.state, c); return { config: c, state: s, log: normalizeLog(value.log), positionKind: ['default', 'custom'].includes(value.positionKind) ? value.positionKind : classifyPosition(s, c), actor: ['human', 'bot'].includes(value.actor) ? value.actor : 'other', action: readAction(value.action) }; }
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
try {
  const raw = localStorage.getItem(STORAGE);
  if (raw) {
    const saved = JSON.parse(raw), restored = readSnapshot(saved);
    if (['north', 'south', 'random'].includes(saved.firstMove)) firstMove = saved.firstMove;
    if (['local', 'bot'].includes(saved.playMode)) playMode = saved.playMode;
    if ([0, 1].includes(saved.humanTeam)) humanTeam = saved.humanTeam;
    botDifficulty = readBotDifficulty(saved.botDifficulty);
    config = restored.config; state = restored.state; log = restored.log;
    positionKind = restored.positionKind;
    gamePhase = saved.gamePhase === 'playing' || (saved.gamePhase === undefined && (state.ply > 0 || state.winner !== null)) ? 'playing' : 'setup';
    if (gamePhase === 'setup' && saved.startPrefsRevision !== START_PREFS_REVISION) { playMode = 'bot'; humanTeam = 1; firstMove = 'south'; }
    editor = gamePhase === 'setup' && saved.editor === true;
    previousGame = gamePhase === 'setup' ? readPreviousGame(saved.previousGame) : null;
    history = (Array.isArray(saved.history) ? saved.history.slice(-40) : []).map(readSnapshot);
    lastTurn = readLastTurn(saved.lastTurn || saved.lastBotTurn) || lastTurnFromHistory();
    if (gamePhase === 'setup' && positionKind === 'default' && saved.presetRevision !== PRESET_REVISION && (config.army.attackLamps !== 1 || config.army.defenseLamps !== 1 || config.stats.attackLamp.damage !== 2)) {
      const next = clone(config); next.army.attackLamps = 1; next.army.defenseLamps = 1; next.stats.attackLamp.damage = 2;
      const fresh = createGame(next);
      checkpoint(); config = next; state = fresh; log = []; lastTurn = null; gamePhase = 'setup'; positionKind = 'default'; editor = false; presetUpdated = true;
    }
    const updatedBalance = gamePhase === 'setup' && positionKind === 'default' && !editor ? updateSavedBalance(config, saved.balanceRevision) : config;
    if (JSON.stringify(updatedBalance) !== JSON.stringify(config)) {
      checkpoint(); config = validateConfig(updatedBalance); state = createGame(config); log = []; lastTurn = null; balanceUpdated = true;
    }
  }
} catch { toast('Сохранённая позиция не прошла проверку. Загружена исходная расстановка.'); }
function resetNewGameDefaults() {
  config = validateConfig(upgradeSelectedBalancePreset(DEFAULT_CONFIG)); state = createGame(config);
  positionKind = 'default'; history = []; log = []; lastTurn = null; selected = null;
}
// Use the defaults of the newly loaded release, rather than the release
// that saved the setup immediately before navigation.
if (freshNewGameRequested && gamePhase === 'setup' && previousGame) resetNewGameDefaults();
function positionText(p) { return `${p.q}, ${p.r}`; }
function startingTeam() { return firstMove === 'random' ? Math.floor(Math.random() * 2) : firstMove === 'south' ? 1 : 0; }
function visibleState() { return movement ? movement.before.state : reviewingTurn && lastTurn ? lastTurn.before.state : state; }
function isBotTurn() { return gamePhase === 'playing' && playMode === 'bot' && state.turn !== humanTeam && state.winner === null && !editor; }
function humanCanMove() { return gamePhase === 'playing' && !movement && !currentDeaths.length && !reviewingTurn && !isBotTurn() && state.winner === null; }
function cancelBot() { clearTimeout(botTimer); botTimer = null; botRunner.cancel(); }
function cancelMovement() { moveAnimator.cancel(); movement = null; }
function resetBotContext(clearLastTurn = true) { cancelBot(); cancelMovement(); if (clearLastTurn) lastTurn = null; reviewingTurn = false; botIssue = ''; botSuspended = false; }
function presentMove(before, action, deaths) {
  cancelMovement();
  const piece = action && !action.pass ? before.state.pieces.find(p => p.id === action.id) : null;
  const route = piece ? movementPath(piece, before.state, before.config, action.to) : [];
  if (route.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { render(deaths); return; }
  const plan = createMovementPlan(route.map(point));
  movement = { before, piece, plan, route, deaths };
  render(); moveAnimator.start(plan);
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
  if (!ready || !isBotTurn() || movement || currentDeaths.length || reviewingTurn || botIssue || botSuspended || $('dialog[open]') || botRunner.active || botTimer !== null) return;
  botTimer = setTimeout(() => { botTimer = null; if (isBotTurn() && !reviewingTurn && !$('dialog[open]')) startBot(); }, 420);
}
function startBot() {
  const requestedState = state, requestedConfig = config, recent = recentBotHistory(), lastActions = new Map();
  for (const entry of recent) if (entry.action?.id) lastActions.set(entry.action.id, entry.action);
  botRunner.run({ state, config, options: { depth: BOT_DIFFICULTIES[botDifficulty].depth, seed: 17001, previousStates: [...recent.map(entry => entry.state), state], lastActions: [...lastActions] } }, result => {
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
function point(c) { return config.geometry === 'hex' ? { x: Math.sqrt(3) * 33 * (c.q + c.r / 2), y: 49.5 * c.r } : { x: c.q * 59, y: c.r * 59 }; }
function polygon(c) { const { x, y } = point(c); return config.geometry === 'hex' ? Array.from({ length: 6 }, (_, i) => `${x + 32 * Math.cos((60 * i - 30) * Math.PI / 180)},${y + 32 * Math.sin((60 * i - 30) * Math.PI / 180)}`).join(' ') : `${x-28},${y-28} ${x+28},${y-28} ${x+28},${y+28} ${x-28},${y+28}`; }
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
  const showAttacks = fieldView === 'attacks', showTeamDamage = showAttacks;
  const attackSources = showAttacks ? state.pieces.map(piece => ({ piece, stats: report.get(piece.id) })).filter(source => source.stats.damage > 0) : [];
  $('#attack-legend').hidden = !showAttacks;
  $('#attack-legend').innerHTML = `<span class="attack-team north">${TEAM_NAMES[0]}</span><span class="attack-team south">${TEAM_NAMES[1]}</span><span>${!attackSources.length ? 'Нет атакующих фигур' : showTeamDamage ? 'Суммарный урон каждой команды' : 'Зоны обеих команд · снимите выбор для чисел урона'}</span>`;
  $('#board').innerHTML = `<defs><clipPath id="aura-field-clip"><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}"/></clipPath><linearGradient id="attack-overlap" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="50%" stop-color="#d6e6ef"/><stop offset="50%" stop-color="#f3d6c2"/></linearGradient><marker id="damage-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#b98227"/></marker></defs>` + board.map(c => {
    const k = key(c.q, c.r), p = occupied.get(k), { x, y } = point(c);
    const classes = ['cell'];
    if (destinations.has(k) && !editor && selectedPiece?.team === state.turn) classes.push('reachable');
    if (p?.id === selected) classes.push('selected');
    const cellDamage = [0, 0];
    for (const source of attackSources) if (p?.team !== source.piece.team && attacks(source.piece, { ...c, id: '__probe', type: 'archer', team: 1 - source.piece.team }, state, config, source.stats)) cellDamage[source.piece.team] += source.stats.damage;
    if (cellDamage.some(Boolean)) classes.push('attack-zone');
    if (cellDamage[0]) classes.push('attack-north');
    if (cellDamage[1]) classes.push('attack-south');
    if (cellDamage.every(Boolean)) classes.push('attack-both');
    const details = p ? `${TEAM_NAMES[p.team]}, ${LABELS[p.type]}${shieldCanRetreat(p, config) ? '-ветеран' : ''}` : 'пусто';
    let token = '';
    const damageY = p ? 28 : 0;
    const damageLabel = showTeamDamage ? cellDamage.map((damage, team) => {
      if (!damage) return '';
      const labelX = x + (cellDamage.every(Boolean) ? team === 0 ? -9 : 9 : 0);
      return `<g class="attack-map-label ${team === 0 ? 'north' : 'south'}" data-attack-team="${team}"><title>Урон команды «${TEAM_NAMES[team]}»: ${damage}</title><circle cx="${labelX}" cy="${y + damageY}" r="${p ? 7.5 : cellDamage.every(Boolean) ? 9 : 10}"/><text x="${labelX}" y="${y + damageY + .4}" style="font-size:${p ? String(damage).length > 2 ? 6 : 9 : String(damage).length > 2 ? 8 : String(damage).length > 1 ? 11 : 13}px">${damage}</text></g>`;
    }).join('') : '';
    if (p) {
      const info = report.get(p.id);
      const appearance = unitAppearance(p, config, ICON_PATHS);
      token = `<g class="piece${appearance.veteran ? ' veteran' : ''} ${p.team === 0 ? 'north' : 'south'} ${info.dead ? 'fatal' : ''} ${movement?.piece.id === p.id ? 'moving-origin' : ''}" data-piece-id="${p.id}" transform="translate(${x},${y})"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${appearance.icon}</g>${p.group ? `<text class="group-text" x="0" y="16">${p.group === 1 ? 'I' : p.group === 2 ? 'II' : p.group}</text>` : ''}${unitBadges(info)}</g>`;
    }
    return `<g class="${classes.join(' ')}" data-cell="${k}" tabindex="${k === boardFocus ? 0 : -1}" role="button" ${p ? `aria-pressed="${p.id === selected}"` : ''} aria-label="Клетка ${k}: ${details}"><polygon class="tile" points="${polygon(c)}"/>${damageLabel}${token}</g>`;
  }).join('') + '<g id="aura-circles" clip-path="url(#aura-field-clip)" aria-hidden="true"></g><g id="selected-attack-reach" aria-hidden="true"></g><g id="attack-lines" class="attack-lines" aria-hidden="true"></g>' + `<g id="death-effects" class="death-effects" aria-hidden="true">${renderDeathEffects(currentDeaths, point, polygon({ q: 0, r: 0 }), ICON_PATHS, config)}</g>` + lastMoveTrace() + movingTokenMarkup();
  if (restoreFocus) $('#board [tabindex="0"]')?.focus({ preventScroll: true });
}
function paintAuras() {
  const context = inspectionContext(), showAll = fieldView === 'auras';
  const position = !showAll && context.isPreview && context.piece?.id === selected ? context.position : visibleState();
  const sources = position.pieces.filter(p => (showAll || !fieldView && p.id === selected) && effective(p, position, config).aura > 0);
  const layer = $('#aura-circles'), markup = sources.map(source => auraCircleMarkup(source, position, config, point, config.geometry === 'hex' ? Math.sqrt(3) * 33 : 59)).join('');
  if (layer.auraMarkup !== markup) { layer.innerHTML = markup; layer.auraMarkup = markup; }
  const legend = $('#aura-legend'), kinds = new Set(sources.map(source => auraKind(source, config)));
  legend.hidden = !kinds.size;
  const labels = { attack: 'Атака', defense: 'Защита', combined: 'Атака и защита' };
  legend.innerHTML = ['attack', 'defense', 'combined'].filter(kind => kinds.has(kind)).map(kind => `<span><i class="aura-swatch" style="--aura-solid:${AURA_COLORS[kind]}"></i> ${labels[kind]}</span>`).join('');
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
  return renderMovingToken(p, frame, ICON_PATHS, 'moving-token', config);
}
function inspectionContext() {
  const position = visibleState();
  return inspection || { piece: position.pieces.find(p => p.id === selected), position, report, isPreview: false };
}
function highlightSources() {
  const context = inspectionContext(), target = context.piece;
  const sourceIds = new Set(target ? context.report.get(target.id).attackers.map(a => a.id) : []);
  document.querySelectorAll('#board [data-piece-id]').forEach(element => {
    const id = element.dataset.pieceId;
    const previewOrigin = context.isPreview && id === target?.id;
    element.classList.toggle('preview-origin', previewOrigin);
    const info = previewOrigin ? report.get(id) : context.report.get(id);
    element.classList.toggle('fatal', !previewOrigin && (info?.dead || false));
    element.classList.toggle('attacking-source', sourceIds.has(id));
    if (info) {
      element.querySelector('.unit-badges').outerHTML = unitBadges(info);
    }
  });
  document.querySelectorAll('#board [data-cell]').forEach(element => element.classList.toggle('inspection-target', !!target && element.dataset.cell === key(target.q, target.r)));
  paintAttackReach(context); renderInspector(context);
  const layer = $('#attack-lines');
  if (!layer) return;
  if (!target) { layer.innerHTML = ''; return; }
  const end = point(target);
  const lines = context.report.get(target.id).attackers.map(attack => {
    // The source can itself die: take its coordinates before simultaneous removal.
    const source = context.position.pieces.find(p => p.id === attack.id);
    if (!source) return '';
    const start = point(source), length = Math.hypot(end.x - start.x, end.y - start.y), shorten = Math.min(24, length / 3);
    const dx = (end.x - start.x) / length, dy = (end.y - start.y) / length;
    const label = { x: start.x + (end.x - start.x) * .55, y: start.y + (end.y - start.y) * .55 };
    return `<g class="attack-ray" data-source="${source.id}"><line x1="${start.x + dx * shorten}" y1="${start.y + dy * shorten}" x2="${end.x - dx * shorten}" y2="${end.y - dy * shorten}" marker-end="url(#damage-arrow)"><title>${escape(LABELS[source.type])}: ${attack.damage} урона</title></line><g class="attack-ray-label"><circle cx="${label.x}" cy="${label.y}" r="9"/><text x="${label.x}" y="${label.y + .4}">${attack.damage}</text></g></g>`;
  }).join('');
  const targetInfo = context.report.get(target.id);
  const ghost = context.isPreview ? `<g class="preview-ghost${unitAppearance(target, config, ICON_PATHS).veteran ? ' veteran' : ''} ${targetInfo.dead ? 'fatal' : ''}" transform="translate(${end.x},${end.y})"><circle r="19"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${unitAppearance(target, config, ICON_PATHS).icon}</g>${unitBadges(targetInfo)}</g>` : '';
  layer.innerHTML = lines + ghost;
}
function paintAttackReach(context) {
  const layer = $('#selected-attack-reach');
  if (!layer) return;
  const visible = visibleState();
  const position = context.isPreview && context.piece?.id === selected ? context.position : visible;
  const piece = position.pieces.find(p => p.id === selected);
  const {cells: attackCells, markup} = attackReachPresentation(piece, position, config, {point, polygonPoints: polygon({q:0,r:0}), visiblePosition: visible});
  const targetKeys = new Set(attackCells.map(cell => key(cell.q, cell.r)));
  document.querySelectorAll('#board [data-cell]').forEach(element => element.classList.toggle('selected-attack-target', targetKeys.has(element.dataset.cell)));
  if (layer.attackReachMarkup !== markup) { layer.innerHTML = markup; layer.attackReachMarkup = markup; }
}
function renderInspector(context) {
  const position = context.isPreview && context.piece?.id === selected ? context.position : visibleState();
  const piece = position.pieces.find(p => p.id === selected), panel = $('#inspector');
  const pieceId = piece?.id || '';
  $('#reference-panel').hidden = Boolean(piece);
  $('#selection-panel').hidden = !piece;
  if (panel.dataset.pieceId !== pieceId) { panel.dataset.pieceId = pieceId; $('.left-panel').scrollTop = 0; }
  if (!piece) {
    panel.innerHTML = '';
    return;
  }
  const info = effective(piece, position, config), base = config.stats[piece.type];
  const names = { move: 'Шаг', damage: 'Сила атаки', range: 'Дальность атаки', fortitude: 'Стойкость' };
  const descriptions = {
    scoutLamp: `Увеличивает дальность союзных лукарей на ${base.rangeBonus}. Не увеличивает дальность броненосцев. Может атаковать только рядом с союзным ветераном.`,
    shield: 'Ходит вперёд и вбок, сражается вблизи и прикрывает соседних союзников. После дальнего края получает постоянное усиление и ход назад.',
    archer: `Атакует по прямым лучам сетки. Союзные ауры усиливают урон, дальность и стойкость.${base.aura > 0 && base.damageBonus > 0 ? ' Его аура усиливает атаку союзников, кроме него самого.' : ''}`,
    attackLamp: `Усиливает урон${base.rangeBonus > 0 ? ' и дальность' : ''} союзников. Может атаковать только под поддержкой союзного ветерана.`,
    defenseLamp: 'Повышает стойкость союзников. Может атаковать только под поддержкой союзного ветерана.'
  };
  const stats = unitStatParts(piece, position, config).map(stat => {
    const calculation = [stat.base, stat.personal ? `+ ${stat.personal}` : '', stat.allied ? `${stat.allied > 0 ? '+' : '−'} ${Math.abs(stat.allied)}` : ''].filter(value => value !== '').join(' ');
    return `<div class="stat-box" data-unit-stat="${stat.field}"><span>${names[stat.field]}</span><strong title="Итого: ${stat.total}">${stat.total}</strong>${stat.personal || stat.allied ? `<em class="stat-calculation">(${calculation} = ${stat.total})</em>` : ''}${stat.personal ? `<small class="personal-bonus">+${stat.personal} за край</small>` : ''}</div>`;
  }).join('');
  const sources = alliedBonusDetails(piece, position, config);
  const bonusLabels = { damage: 'к урону', range: 'к дальности', fortitude: 'к стойкости' };
  const sourceDetails = sources.map(({source, bonuses}) => `<li><strong>${LABELS[source.type]}</strong><span>${Object.entries(bonuses).filter(([,value]) => value > 0).map(([field,value]) => `+${value} ${bonusLabels[field]}`).join(', ')}</span></li>`).join('');
  const aura = shieldCanRetreat(piece, config) ? config.shieldPromotion.allies ?? config.shieldPromotion : base;
  const bonuses = [[aura.damageBonus, 'урон'], [aura.rangeBonus, 'дальность'], [aura.defenseBonus, 'стойкость']].filter(([value]) => value > 0).map(([value, name]) => `${name} +${value}`).join(', ');
  panel.innerHTML = `${context.isPreview && context.piece?.id === selected ? '<p class="preview-label">Параметры после предполагаемого перемещения</p>' : ''}<div class="piece-heading"><span class="unit-icon ${piece.team ? 'south' : 'north'}${shieldCanRetreat(piece, config) ? ' veteran' : ''}">${icon(piece.type, piece)}</span><div><h2>${LABELS[piece.type]}${shieldCanRetreat(piece, config) ? ' · ветеран' : ''}</h2></div></div><p class="unit-description">${descriptions[piece.type]}</p><div class="stat-grid">${stats}</div><p class="stat-explanation">Крупно — итог, в скобках — полный расчёт с усилениями союзников. Бонус за край входит в расчёт и подписан отдельно.</p>${info.aura > 0 ? `<p class="unit-aura"><strong>Аура · ${info.aura} ${plural(info.aura, ['клетка', 'клетки', 'клеток'])}</strong><br>${bonuses}.</p>` : ''}<div class="sources"><strong>Усиления от союзников</strong>${sources.length ? `<ul class="allied-bonus-list">${sourceDetails}</ul>` : '<p>Сейчас нет усилений от союзников.</p>'}</div>`;
}
function shieldPromotionDescription() {
  const stats = config.stats.shield, p = config.shieldPromotion, allies = p.allies ?? p;
  return `Урон: ${stats.damage + p.damageBonus}, дальность: ${Math.min(stats.range + p.rangeBonus, p.maxRange)}, стойкость: ${stats.fortitude + p.defenseBonus}. Получает ауру в ${allies.aura} ${plural(allies.aura, ['клетку', 'клетки', 'клеток'])}, добавляя союзникам +${allies.damageBonus} к урону, +${allies.rangeBonus} к дальности, +${allies.defenseBonus} к стойкости. Под этой аурой фигуры поддержки могут атаковать.`;
}
function shieldDescriptionMarkup(open = false) {
  return `<p class="shield-description">Ходит вперёд и вбок. Аура ${config.stats.shield.aura} ${plural(config.stats.shield.aura, ['клетка', 'клетки', 'клеток'])}: стойкость союзников +${config.stats.shield.defenseBonus}. Ауры других фигур не увеличивают дальность атаки броненосцев.</p><details class="shield-promotion" data-shield-promotion${open ? ' open' : ''}><summary>Ветеран</summary><p>После достижения противоположного края усиливается: ${shieldPromotionDescription()}</p></details>`;
}
function unitReferenceMarkup(promotionOpen = false) {
  const rows = TYPES.map(type => {
    const stats = config.stats[type], fields = ['move', 'damage', 'range', 'fortitude'];
    let aura = '';
    if (type === 'archer' && stats.aura > 0 && stats.damageBonus > 0) aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: урон союзников +${stats.damageBonus}, кроме самого лукаря. Бонусы нескольких лукарей складываются.`;
    if (type === 'scoutLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: дальность +${stats.rangeBonus}. Не увеличивает дальность броненосцев.`;
    if (type === 'attackLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: урон +${stats.damageBonus}${stats.rangeBonus > 0 ? `, дальность +${stats.rangeBonus}` : ''}.`;
    if (type === 'defenseLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: стойкость +${stats.defenseBonus}.`;
    if (type === 'shield') aura = shieldDescriptionMarkup(promotionOpen);
    return `<tr data-reference-type="${type}"><th scope="row"><span class="reference-unit">${icon(type)}<span>${LABELS[type]}</span></span></th>${fields.map(field => `<td data-stat="${field}">${stats[field]}</td>`).join('')}</tr>${aura ? `<tr class="reference-aura" data-reference-aura="${type}"><td colspan="5">${aura}</td></tr>` : ''}`;
  }).join('');
  return '<table class="unit-reference-table"><thead><tr><th scope="col">Фигура</th><th scope="col" title="Максимальный шаг">Шаг</th><th scope="col">Урон</th><th scope="col" title="Дальность атаки">Дал.</th><th scope="col" title="Стойкость">Стойк.</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function render(deaths = []) {
  const state = visibleState(), displayLog = movement ? movement.before.log : reviewingTurn && lastTurn ? lastTurn.before.log : log;
  for (const view of ['attacks', 'auras']) $('#show-' + view).setAttribute('aria-pressed', String(fieldView === view));
  clearTimeout(deathEffectTimer);
  currentDeaths = Array.isArray(deaths) && !matchMedia('(prefers-reduced-motion: reduce)').matches ? deaths : [];
  $('#first-move').value = firstMove;
  $('#play-mode').value = playMode; $('#human-side').value = String(humanTeam);
  $('#bot-difficulty').value = botDifficulty;
  $('#human-side-field').hidden = playMode !== 'bot'; $('#bot-controls').hidden = playMode !== 'bot' || gamePhase !== 'playing';
  $('#start-setup').hidden = gamePhase !== 'setup' || editor;
  $('#start-setup').disabled = refreshingNewGame;
  $('#settings-open').disabled = refreshingNewGame;
  $('#new-game').hidden = gamePhase !== 'playing';
  $('#cancel-new-game').hidden = !previousGame;
  $('#position-kind').value = positionKind;
  $('#configure-position').disabled = positionKind !== 'custom';
  $('#configure-position').hidden = positionKind !== 'custom';
  $('#mode-caption').textContent = playMode === 'bot' ? `Против бота · ${BOT_DIFFICULTIES[botDifficulty].label.toLowerCase()}` : '2 игрока на одном экране';
  hover = null; inspection = null; report = analyze(state, config);
  const p = state.pieces.find(p => p.id === selected); if (!p) selected = null;
  available = p && !editor && humanCanMove() && p.team === state.turn && state.winner === null ? reachable(p, state, config) : [];
  boardMarkup(); paintAuras(); highlightSources();
  $('#board').setAttribute('aria-busy', String(Boolean(movement)));
  $('#move-counter').textContent = gamePhase === 'setup' ? editor ? 'Редактор' : 'Подготовка' : `${reviewingTurn ? 'Просмотр · ' : ''}Ход ${state.ply + 1}${movement ? ' · движение' : ''}`;
  $('#scoreboard').innerHTML = [0, 1].map(team => {
    const pieces = state.pieces.filter(p => p.team === team), n = pieces.length;
    const active = gamePhase === 'playing' && state.turn === team && state.winner === null && !editor && !currentDeaths.length;
    const roster = TYPES.map(type => {
      const count = pieces.filter(p => p.type === type).length, label = `${LABELS[type]}: ${count}`;
      return `<li class="team-unit ${count ? '' : 'empty'}" data-unit-type="${type}" title="${label}" aria-label="${label}">${icon(type)}<span aria-hidden="true">${count}</span></li>`;
    }).join('');
    return `<div class="team-card ${team ? 'south' : 'north'} ${active ? 'active' : ''}"><div><span class="team-title"><span class="team-dot"></span>${TEAM_NAMES[team]}${playMode === 'bot' ? `<span class="team-role">${team === humanTeam ? 'Вы' : 'Бот'}</span>` : ''}</span><div class="turn-tag">${gamePhase === 'setup' ? 'РАССТАНОВКА' : currentDeaths.length ? 'РАСЧЁТ БОЯ' : active ? movement ? 'ДВИЖЕНИЕ' : reviewingTurn ? 'ПЕРЕД ХОДОМ' : playMode === 'bot' && team !== humanTeam ? 'ХОД БОТА' : 'ВАШ ХОД' : ' '}</div></div><span class="team-count">${n} ${plural(n, ['фигура', 'фигуры', 'фигур'])}</span><ul class="team-roster" role="list" aria-label="Оставшиеся фигуры команды ${TEAM_NAMES[team]}">${roster}</ul></div>`;
  }).join('');
  $('#unit-reference').innerHTML = unitReferenceMarkup(Boolean($('#unit-reference [data-shield-promotion]')?.open));
  $('#config-summary').innerHTML = `<div class="summary-row"><span>Групп на игрока</span><strong>${config.army.groups}</strong></div><div class="summary-row"><span>Состав группы</span><strong>${config.army.shields} ${plural(config.army.shields, ['броненосец', 'броненосца', 'броненосцев'])} + ${config.army.archers} ${plural(config.army.archers, ['лукарь', 'лукаря', 'лукарей'])}</strong></div><div class="summary-row"><span>Барабанщики / знаменосцы / разведчики</span><strong>${config.army.attackLamps} / ${config.army.defenseLamps} / ${config.army.scoutLamps}</strong></div><div class="summary-row"><span>Стрельба</span><strong>${config.geometry === 'hex' ? '6 лучей через грани' : config.experiments.squareDiagonals ? '8 направлений' : '4 направления'}</strong></div>`;
  $('#editor-controls').hidden = !editor;
  $('#pass-turn').hidden = !config.experiments.allowPass || gamePhase !== 'playing';
  $('#pass-turn').disabled = !humanCanMove();
  $('#undo').disabled = !history.length || reviewingTurn || (gamePhase === 'setup' && !editor);
  $('#undo').title = playMode === 'bot' && !editor ? 'Отменить свой ход и ответ бота' : 'Отменить последнее действие';
  $('#review-previous').disabled = !lastTurn || gamePhase !== 'playing' || reviewingTurn;
  $('#review-previous').setAttribute('aria-pressed', String(reviewingTurn));
  $('#review-current').disabled = !reviewingTurn;
  $('#resume-bot').hidden = !isBotTurn() || reviewingTurn || editor || (!botIssue && !botSuspended);
  $('#resume-bot').textContent = botIssue ? 'Повторить ход бота' : 'Ход бота';
  const lastAction = lastTurn?.action;
  const lastPiece = lastAction && !lastAction.pass ? lastTurn.before.state.pieces.find(p => p.id === lastAction.id) : null;
  const lastMoveText = lastAction ? lastAction.pass ? `Последний ход: ${TEAM_NAMES[lastTurn.before.state.turn]} · пропуск.` : `Последний ход: ${TEAM_NAMES[lastTurn.before.state.turn]} · ${LABELS[lastPiece?.type] || 'Фигура'} · ${positionText(lastAction.from)} → ${positionText(lastAction.to)}.` : 'Сделайте ход. Стрелки рядом с «Отменить» позволяют посмотреть предыдущую позицию.';
  $('#bot-status').textContent = movement ? `${TEAM_NAMES[movement.piece.team]} · ${LABELS[movement.piece.type]} перемещается…` : currentDeaths.length ? 'Расчёт боя…' : editor ? 'Бот не ходит в редакторе.' : reviewingTurn ? lastMoveText : botIssue || (isBotTurn() ? botSuspended ? 'Ход бота приостановлен. Нажмите «Ход бота», чтобы продолжить.' : $('dialog[open]') ? 'Бот ждёт закрытия окна.' : 'Бот выбирает ход…' : lastMoveText);
  $('#result-banner').hidden = state.winner === null || gamePhase !== 'playing' || Boolean(movement) || Boolean(currentDeaths.length);
  $('#result-banner').textContent = state.winner === 'draw' ? config.victoryCondition === 'combat-units' ? 'Ничья · у обеих сторон не осталось броненосцев и лукарей' : 'Ничья · все фигуры уничтожены' : state.winner !== null ? `Победа команды «${TEAM_NAMES[state.winner]}»` : '';
  let hint = editor ? 'Выберите фигуру в палитре и нажмите на пустую клетку. Для удаления выберите ластик.' : selected && p?.team === state.turn ? 'Подсвечены пустые клетки, до которых можно пройти. Наведите на клетку для прогноза.' : 'Выберите свою фигуру, затем подсвеченную клетку.';
  if (!editor && selected && p?.team === state.turn && p.type === 'shield') hint = shieldCanRetreat(p, config) ? `Край достигнут: ход во все стороны, постоянные +${config.shieldPromotion.damageBonus} к урону и +${config.shieldPromotion.defenseBonus} к стойкости, дальность до ${config.shieldPromotion.maxRange}; аура атаки и защиты — ${(config.shieldPromotion.allies ?? config.shieldPromotion).aura} ${plural((config.shieldPromotion.allies ?? config.shieldPromotion).aura, ['клетка', 'клетки', 'клеток'])}.` : 'Броненосец ходит вперёд и вбок. Достигнув противоположного края поля, навсегда получает ход назад.';
  if (!editor && state.winner === null && !state.pieces.filter(p => p.team === state.turn).some(p => reachable(p, state, config).length)) hint = 'У команды нет доступных ходов. Исследуйте позицию в редакторе или разрешите пропуск в настройках.';
  if (!editor && isBotTurn()) hint = 'Сейчас ход бота. Можно рассматривать атаки и ауры или открыть настройки.';
  else if (!editor && !selected && lastAction) hint = `${lastMoveText} Выберите свою фигуру.`;
  if (!editor && p && p.team !== state.turn && !isBotTurn()) hint = `Выбрана фигура команды «${TEAM_NAMES[p.team]}». Сейчас ходит «${TEAM_NAMES[state.turn]}» — выберите ${state.turn === 0 ? 'синюю' : 'оранжевую'} фигуру.`;
  if (gamePhase === 'setup') hint = editor ? 'Выберите фигуру и пустую клетку для перестановки. Палитра добавляет фигуры. «Готово» завершает настройку позиции.' : '';
  if (fieldView) hint = `${{ attacks: 'Показаны атаки обеих команд', auras: 'Показаны ауры всех фигур' }[fieldView]}. Нажмите кнопку ещё раз или выберите фигуру, чтобы выйти.`;
  if (reviewingTurn) hint = `Просмотр перед последним ходом. ${lastMoveText} Нажмите →, чтобы вернуться к партии.`;
  if (currentDeaths.length) hint = 'Расчёт боя: погибшие фигуры удаляются одновременно.';
  if (movement) hint = `${TEAM_NAMES[movement.piece.team]} · ${LABELS[movement.piece.type]}: ${positionText(lastAction.from)} → ${positionText(lastAction.to)}. Движение…`;
  $('#board-hint').textContent = hint;
  $('#board-hint').hidden = !hint;
  $('#log-count').textContent = `${state.ply} ${plural(state.ply, ['ход', 'хода', 'ходов'])}`;
  $('#move-log').innerHTML = displayLog.length ? displayLog.map((entry, i) => `<div class="log-row"><span class="log-number">${i + 1}</span><p>${escape(entry.text)}<small>${escape(entry.detail)}</small></p></div>`).reverse().join('') : '<p class="log-empty">Здесь появятся перемещения и результат каждого расчёта. Урон не накапливается.</p>';
  document.querySelectorAll('[data-team]').forEach(b => b.classList.toggle('active', Number(b.dataset.team) === editorTeam));
  $('#erase-tool').classList.toggle('selected-tool', tool === 'erase');
  $('#piece-palette').innerHTML = TYPES.map(type => `<button class="palette-item ${tool === type ? 'active' : ''}" data-tool="${type}">${icon(type)}<span>${LABELS[type]}</span></button>`).join('');
  save();
  if (currentDeaths.length) deathEffectTimer = setTimeout(() => { currentDeaths = []; render(); }, DEATH_EFFECT_DURATION);
  queueBot();
}
function deathDetail(deaths) { return deaths.length ? 'Погибли: ' + [0, 1].map(team => { const n = deaths.filter(p => p.team === team).length; return n ? `${TEAM_NAMES[team]} — ${n}` : ''; }).filter(Boolean).join(', ') : 'Все фигуры держатся.'; }
function clearSelection() {
  if (!selected || movement || currentDeaths.length) return;
  selected = null; render();
}
function onCell(q, r) {
  const occupant = visibleState().pieces.find(p => p.q === q && p.r === r);
  if (!editor && occupant && !movement && !currentDeaths.length) { fieldView = null; selected = selected === occupant.id ? null : occupant.id; render(); return; }
  if (!editor && !humanCanMove()) { clearSelection(); return; }
  if (editor) {
    if (tool === 'erase') { if (occupant) { checkpoint(); state.pieces = state.pieces.filter(p => p !== occupant); selected = null; state.winner = null; render(); } return; }
    if (occupant) { fieldView = null; selected = selected === occupant.id ? null : occupant.id; render(); return; }
    const moving = state.pieces.find(p => p.id === selected);
    if (moving) { checkpoint(); moving.q = q; moving.r = r; state.winner = null; selected = null; render(); return; }
    checkpoint(); const id = 'e' + crypto.randomUUID(); state.pieces.push({ id, type: tool, team: editorTeam, q, r, group: null }); state.winner = null; selected = id; render(); return;
  }
  if (occupant) { fieldView = null; selected = selected === occupant.id ? null : occupant.id; render(); return; }
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
  if (fieldView) return;
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
for (const view of ['attacks', 'auras']) $('#show-' + view).addEventListener('click', () => { fieldView = fieldView === view ? null : view; selected = null; render(); });
$('#undo').addEventListener('click', () => {
  if (!history.length || reviewingTurn || (gamePhase === 'setup' && !editor)) return;
  let previous = history.pop();
  if (playMode === 'bot' && !editor && previous.actor === 'bot' && history.at(-1)?.actor === 'human' && history.at(-1).state.ply === previous.state.ply - 1) previous = history.pop();
  resetBotContext(); config = previous.config; state = previous.state; log = previous.log; positionKind = previous.positionKind; selected = null;
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
  if (gamePhase !== 'playing' || refreshingNewGame) return;
  const backup = { snapshot: currentSnapshot(), history: clone(history), lastTurn: clone(lastTurn), playMode, humanTeam, firstMove, botDifficulty };
  resetBotContext(); previousGame = backup; gamePhase = 'setup'; editor = false;
  playMode = 'bot'; humanTeam = 1; firstMove = 'south'; botDifficulty = DEFAULT_BOT_DIFFICULTY;
  resetNewGameDefaults();
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
    resetBotContext(); state = next; gamePhase = 'playing'; positionKind = classifyPosition(state, config);
    archiveRecorder.start(archiveGameMetadata());
    history = []; log = []; previousGame = null; selected = null; $('#start-dialog').close(); render();
  } catch (error) { toast(error.message); }
}
$('#start-setup').addEventListener('click', openStartSettings);
$('#new-game').addEventListener('click', openNewGame);
$('#start-game').addEventListener('click', startGame);
function returnToGame() {
  if (!previousGame || gamePhase !== 'setup') return;
  const backup = previousGame; resetBotContext();
  config = backup.snapshot.config; state = backup.snapshot.state; log = backup.snapshot.log; positionKind = backup.snapshot.positionKind;
  history = backup.history; lastTurn = backup.lastTurn; playMode = backup.playMode; humanTeam = backup.humanTeam; firstMove = backup.firstMove; botDifficulty = readBotDifficulty(backup.botDifficulty);
  previousGame = null; gamePhase = 'playing'; editor = false; selected = null; $('#start-dialog').close(); render();
  archiveRecorder.resume(archiveGameMetadata());
}
$('#cancel-new-game').addEventListener('click', returnToGame);
$('#start-dialog').addEventListener('cancel', event => { event.preventDefault(); dismissDialog(event.currentTarget); });
$('#first-move').addEventListener('change', event => { if (gamePhase !== 'setup') return; firstMove = event.target.value; save(); });
$('#play-mode').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); playMode = event.target.value; selected = null; render(); });
$('#human-side').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); humanTeam = Number(event.target.value); selected = null; render(); });
$('#bot-difficulty').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); botDifficulty = readBotDifficulty(event.target.value); render(); });
$('#position-kind').addEventListener('change', event => {
  if (gamePhase !== 'setup' || editor) return;
  try {
    const kind = event.target.value;
    if (kind === 'default') { const next = createGame(config); resetBotContext(); state = next; history = []; log = []; selected = null; }
    positionKind = kind; render();
  } catch (error) { render(); toast(error.message); }
});
$('#configure-position').addEventListener('click', () => {
  if (gamePhase !== 'setup' || positionKind !== 'custom' || editor) return;
  resetBotContext(); editor = true; history = []; selected = null; $('#start-dialog').close(); render();
});
$('#editor-done').addEventListener('click', () => {
  if (!editor) return;
  try { state = validateState(state, config); positionKind = classifyPosition(state, config); editor = false; history = []; log = []; selected = null; render(); openStartSettings(); }
  catch (error) { toast(error.message); }
});
$('#review-previous').addEventListener('click', () => { if (!lastTurn || gamePhase !== 'playing' || reviewingTurn) return; cancelBot(); cancelMovement(); reviewingTurn = true; selected = null; render(); });
$('#review-current').addEventListener('click', () => { if (!reviewingTurn) return; reviewingTurn = false; selected = null; render(); });
$('#resume-bot').addEventListener('click', () => { botIssue = ''; botSuspended = false; render(); });
document.querySelector('.team-select').addEventListener('click', event => { const b = event.target.closest('[data-team]'); if (b) { editorTeam = Number(b.dataset.team); selected = null; render(); } });
$('#piece-palette').addEventListener('click', event => { const b = event.target.closest('[data-tool]'); if (b) { tool = b.dataset.tool; selected = null; render(); } });
$('#erase-tool').addEventListener('click', () => { tool = 'erase'; selected = null; render(); });
$('#clear-board').addEventListener('click', () => { if (!editor) return; resetBotContext(); checkpoint(); state = { pieces: [], turn: 0, ply: 0, winner: null }; log = []; selected = null; render(); });
$('#resolve-position').addEventListener('click', () => { if (!editor) return; resetBotContext(); checkpoint(); const result = resolve(state, config); state = result.state; state.ply = 0; state.winner = null; log.push({ text: 'Расчёт позиции без перемещения', detail: deathDetail(result.deaths) }); selected = null; render(result.deaths); toast(deathDetail(result.deaths)); });
$('#pass-turn').addEventListener('click', () => { if (!humanCanMove()) return; try { const result = pass(state, config), before = currentSnapshot(), action = { pass: true }; checkpoint(playMode === 'bot' ? 'human' : 'other', action); lastTurn = { before, action }; log.push({ text: `${TEAM_NAMES[state.turn]} · пропуск хода`, detail: deathDetail(result.deaths) }); state = result.state; recordGameAction('pass', { action, deaths: result.deaths, actor: 'human' }); selected = null; render(result.deaths); } catch (e) { toast(e.message); } });

const statFields = [['move', 'Шаг'], ['damage', 'Урон'], ['range', 'Дальность поражения'], ['fortitude', 'Стойкость'], ['aura', 'Радиус ауры'], ['damageBonus', 'Бонус урона'], ['rangeBonus', 'Бонус дальности'], ['defenseBonus', 'Бонус стойкости']];
const promotionFields = [['damageBonus', 'Личный бонус урона'], ['rangeBonus', 'Личный бонус дальности'], ['defenseBonus', 'Личный бонус стойкости'], ['maxRange', 'Предел дальности броненосца']];
const promotionAllyFields = [['aura', 'Радиус ауры'], ['damageBonus', 'Союзникам: бонус урона'], ['rangeBonus', 'Союзникам: бонус дальности'], ['defenseBonus', 'Союзникам: бонус стойкости']];
const armyFields = [['groups', 'Групп на игрока'], ['shields', 'Броненосцев в группе'], ['archers', 'Лукарей в группе'], ['attackLamps', 'Барабанщиков'], ['defenseLamps', 'Знаменосцев'], ['scoutLamps', 'Разведчиков']];
const experimentFields = [['squareDiagonals', 'На квадратах диагональ считается одним шагом; атака по 8 направлениям'], ['lampShieldBlocking', 'Вражеские щиты перекрывают поражение барабанщика'], ['allyShotsPass', 'Союзные фигуры пропускают атаки своей команды'], ['aurasThroughShields', 'Ауры поддержки проходят сквозь щиты'], ['allowPass', 'Разрешить пропуск хода с обычным расчётом боя']];
function fillSettings(c) {
  const form = $('#settings-form'); form.elements.geometry.value = c.geometry; form.elements.size.value = c.size; form.elements.auraDefenseCap.value = c.auraDefenseCap ?? -1; form.elements.victoryCondition.value = c.victoryCondition ?? 'all-units'; form.elements.deploymentOffset.value = c.deploymentOffset ?? 0;
  $('#army-inputs').innerHTML = armyFields.map(([name, label]) => `<label>${label}<input type="number" name="army.${name}" value="${c.army[name]}" min="0" max="${name === 'groups' ? 6 : 12}" required></label>`).join('');
  $('#stats-table').innerHTML = `<thead><tr><th>Параметр</th>${TYPES.map(t => `<th>${LABELS[t]}</th>`).join('')}</tr></thead><tbody>${statFields.map(([field, label]) => `<tr><td>${label}</td>${TYPES.map(type => { const na = (type === 'scoutLamp' && ['damage','range','damageBonus','defenseBonus'].includes(field)) || (type === 'attackLamp' && field === 'rangeBonus') || (type === 'defenseLamp' && ['damage', 'range'].includes(field)) || (type === 'archer' && ['rangeBonus', 'defenseBonus'].includes(field)) || (type === 'shield' && ['damageBonus', 'rangeBonus'].includes(field)) || (type === 'attackLamp' && field === 'defenseBonus') || (type === 'defenseLamp' && ['damageBonus', 'rangeBonus'].includes(field)); return `<td>${na ? '<span class="na">—</span>' : `<input aria-label="${LABELS[type]}: ${label}" name="stats.${type}.${field}" type="number" min="${field === 'move' ? 1 : 0}" max="${field === 'move' ? 6 : 20}" value="${c.stats[type][field]}" required>`}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
  $('#promotion-inputs').innerHTML = promotionFields.map(([name, label]) => `<label>${label}<input aria-label="Броненосец после края: ${label}" type="number" name="shieldPromotion.${name}" value="${c.shieldPromotion[name]}" min="0" max="20" required></label>`).join('');
  const allies = c.shieldPromotion.allies ?? c.shieldPromotion;
  $('#promotion-allies-inputs').innerHTML = promotionAllyFields.map(([name, label]) => `<label>${label}<input aria-label="Аура ветерана: ${label}" type="number" name="shieldPromotion.allies.${name}" value="${allies[name]}" min="0" max="20" required></label>`).join('');
  $('#experiment-inputs').innerHTML = experimentFields.map(([name, label]) => `<label><input type="checkbox" name="experiment.${name}" ${c.experiments[name] ? 'checked' : ''}>${label}</label>`).join('');
  $('#settings-error').textContent = ''; updateSizeLabel();
}
function updateSizeLabel() { const form = $('#settings-form'), hex = form.elements.geometry.value === 'hex'; $('#size-label').textContent = hex ? 'Радиус поля' : 'Сторона поля'; form.elements.size.min = hex ? 3 : 6; form.elements.size.max = hex ? 6 : 12; }
function settingsFromForm() {
  const next = clone(config), form = $('#settings-form'); next.geometry = form.elements.geometry.value; next.size = Number(form.elements.size.value); next.auraDefenseCap = Number(form.elements.auraDefenseCap.value); next.victoryCondition = form.elements.victoryCondition.value; next.deploymentOffset = Number(form.elements.deploymentOffset.value);
  for (const [name] of armyFields) next.army[name] = Number(form.elements['army.' + name].value);
  for (const type of TYPES) for (const [field] of statFields) { const input = form.elements[`stats.${type}.${field}`]; if (input) { if (input.value.trim() === '') throw new Error('Заполните все числовые параметры.'); next.stats[type][field] = Number(input.value); } }
  for (const [name] of promotionFields) { const input = form.elements['shieldPromotion.' + name]; if (input.value.trim() === '') throw new Error('Заполните параметры усиления броненосца.'); next.shieldPromotion[name] = Number(input.value); }
  next.shieldPromotion.allies = {};
  for (const [name] of promotionAllyFields) { const input = form.elements['shieldPromotion.allies.' + name]; if (input.value.trim() === '') throw new Error('Заполните параметры ауры ветерана.'); next.shieldPromotion.allies[name] = Number(input.value); }
  for (const [name] of experimentFields) next.experiments[name] = form.elements['experiment.' + name].checked;
  return validateConfig(next);
}
$('#settings-open').addEventListener('click', () => { cancelBot(); cancelMovement(); fillSettings(config); $('#settings-dialog').showModal(); render(); });
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
function victoryDescription() {
  return config.victoryCondition === 'combat-units' ? 'Армия проигрывает, когда у неё не остаётся ни броненосцев, ни лукарей, даже если поддержка ещё на поле. Если обе армии одновременно теряют последних броненосцев и лукарей — ничья.' : 'Уничтожьте все фигуры противника, включая поддержку. Если обе стороны одновременно теряют все фигуры — ничья.';
}
function renderAbout() {
  $('#about-victory').textContent = victoryDescription();
  $('#about-directions').textContent = config.geometry === 'hex' ? 'На шестиугольном поле атаки идут по шести прямым лучам через стороны клеток. Ауры барабанщика, знаменосца и разведчика охватывают все клетки в пределах радиуса, включая клетки между лучами. Остальные ауры следуют направлениям сетки.' : `На квадратном поле атаки идут по ${config.experiments.squareDiagonals ? 'восьми направлениям, включая диагонали' : 'четырём направлениям через грани'}. Длина луча — число клеток от источника. Ауры барабанщика, знаменосца и разведчика охватывают все клетки в пределах радиуса.`;
  $('#about-promotion').innerHTML = shieldDescriptionMarkup();
  $('#about-stats').innerHTML = '<thead><tr><th>Фигура</th><th>Шаг</th><th>Урон</th><th>Дальность</th><th>Стойкость</th><th>Аура</th></tr></thead><tbody>' + TYPES.map(type => { const stats = config.stats[type]; return `<tr><td>${LABELS[type]}</td><td>${stats.move}</td><td>${stats.damage || '—'}</td><td>${stats.range || '—'}</td><td>${stats.fortitude}</td><td>${stats.aura || '—'}</td></tr>`; }).join('') + '</tbody>';
  const experiments = config.experiments;
  $('#about-blocking').textContent = [experiments.lampShieldBlocking ? 'Вражеский броненосец перекрывает все атаки, проходящие через его клетку, и закрывает фигуры за собой.' : 'Вражеский броненосец перекрывает атаки лукарей и других броненосцев, проходящие через его клетку. Атаки барабанщика проходят через броненосцев.', experiments.allyShotsPass ? 'Свои фигуры не мешают союзным атакам.' : 'Свои фигуры перекрывают союзные атаки, проходящие через их клетки.'].join(' ');
  $('#about-auras').textContent = [experiments.aurasThroughShields ? 'Ауры проходят через любые фигуры.' : 'Броненосцы обеих сторон перекрывают распространение аур через свои клетки. Другие фигуры аурам не мешают.', config.auraDefenseCap < 0 ? 'Все полученные бонусы стойкости от аур складываются.' : `Общий бонус стойкости от аур не превышает +${config.auraDefenseCap}. Личное усиление броненосца после края считается отдельно.`].join(' ');
  $('#about-pass').hidden = !experiments.allowPass;
  $('#about-pass').textContent = experiments.allowPass ? 'Вместо перемещения можно пропустить ход. После пропуска обе стороны проходят обычный расчёт боя.' : 'Каждый ход требует перемещения: пропускать ход нельзя.';
}
$('#reset-defaults').addEventListener('click', () => fillSettings(DEFAULT_CONFIG));

const onboardingSteps = ['Идея', 'Фигуры', 'Ход', 'Бой', 'Старт'];
let onboardingStep = 0, onboardingDamage = 2;
let onboardingExamples = {};
let onboardingShowcaseStep = 0;
let onboardingAnimation = null;
let onboardingPreviewByKeyboard = false;
function onboardingUnit(type) { return `<span class="onboarding-unit">${icon(type)}</span>`; }
function renderOnboarding() {
  $('#onboarding-progress').innerHTML = onboardingSteps.map((label, index) => `<button type="button" data-onboarding-step="${index}"${index === onboardingStep ? ' aria-current="step"' : ''} aria-label="Шаг ${index + 1}: ${label}"><span class="step-number">${index + 1}</span>${label}</button>`).join('');
  const heading = (title, text) => `<p class="eyebrow">${onboardingSteps[onboardingStep].toUpperCase()}</p><h3 id="onboarding-title">${title}</h3>${text ? `<p>${text}</p>` : ''}`;
  let content = '';
  if (onboardingStep === 0) content = heading('Вы командуете армией', 'Под вашим началом — броненосцы со щитами, лукари, барабанщик, знаменосец и разведчик.') +
    `<p>${victoryDescription()}</p><p>Солдаты сами выбирают цели и атакуют — с этим они разберутся. Ваша задача — помочь им занять выгодные позиции и сохранить строй.</p>` +
    `<div class="onboarding-formation">${[['shield', 'Прикрывает'], ['archer', 'Бьёт издалека'], ['attackLamp', 'Усиливает атаку'], ['defenseLamp', 'Усиливает защиту'], ['scoutLamp', 'Добавляет дальность']].map(([type, role]) => `<div>${onboardingUnit(type)}<strong>${LABELS[type]}</strong><br>${role}</div>`).join('')}</div>` + renderShowcaseBattle(onboardingShowcaseStep, ICON_PATHS, unitBadges, onboardingAnimation?.sceneKey === 'showcase' ? onboardingAnimation : null);
  if (onboardingStep === 1) content = heading('У каждой фигуры своя работа', 'Сначала разберись с бейджами, затем попробуй, как фигуры двигаются, атакуют и поддерживают друг друга.') + renderUnitExamples(onboardingExamples, ICON_PATHS, unitBadges, onboardingAnimation);
  if (onboardingStep === 2) {
    content = heading('Один ход меняет всё построение', 'Шесть примеров: пробуйте ходы и смотрите, что изменится.') + renderMoveExamples(onboardingExamples, ICON_PATHS, unitBadges, onboardingAnimation);
  }
  if (onboardingStep === 3) content = heading('Вы двигаете — армия атакует', 'После каждого хода обе армии атакуют автоматически. Попробуй уйти из-под обстрела, сложить урон и обменяться ударами.') + renderCombatExamples(onboardingExamples, ICON_PATHS, unitBadges, onboardingAnimation);
  if (onboardingStep === 4) content = heading('Теперь можно попробовать партию', 'Для начала достаточно одного решения: куда передвинуть фигуру, чтобы сохранить поддержку и достать противника.') +
    `<ol class="onboarding-checklist">${(editor ? ['Закончите расстановку кнопкой «Готово».', 'В подготовке выберите режим и нажмите «Начать».', 'Выберите свою фигуру, посмотрите подсветку и сделайте ход.'] : gamePhase === 'setup' ? ['Выберите режим: против бота или вдвоём. Для первой партии оставьте позицию «Стандартная».', 'Выберите первый ход и свою сторону, если играете против бота. Нажмите «Начать».', 'Нажмите на свою фигуру, затем на доступную пустую клетку.'] : ['Продолжайте текущую партию: окно знакомства её не сбрасывает.', 'Выберите свою фигуру и посмотрите доступные клетки.', 'Передвиньте фигуру. Если сейчас ход бота, дождитесь его ответа.']).map(text => `<li>${text}</li>`).join('')}</ol><div class="onboarding-note"><strong>Подсказки всегда рядом.</strong> Снизу слева — сила атаки, справа — стойкость после потенциального урона или череп. Выбор фигуры показывает её дальность значками меча или стрелы. «Ауры» показывает поддержку, «Атаки» — угрозы. Стрелки ← и → позволяют посмотреть последний ход; «Отменить» возвращает позицию.</div>`;
  $('#onboarding-body').innerHTML = content;
  $('#onboarding-body').scrollTop = 0;
  $('#onboarding-back').disabled = onboardingStep === 0;
  $('#onboarding-count').textContent = `${onboardingStep + 1} из ${onboardingSteps.length}`;
  $('#onboarding-next').textContent = onboardingStep === 4 ? (editor ? 'К расстановке →' : gamePhase === 'setup' ? 'К подготовке →' : 'Вернуться к партии →') : 'Далее →';
}
function showAboutView(guide) {
  if (cancelOnboardingAnimation()) redrawOnboarding();
  $('#onboarding').hidden = !guide;
  $('#rules-reference').hidden = guide;
  $('#about-guide-tab').setAttribute('aria-pressed', String(guide));
  $('#about-reference-tab').setAttribute('aria-pressed', String(!guide));
}
function openAbout() {
  cancelOnboardingAnimation();
  cancelBot(); cancelMovement(); renderAbout();
  onboardingStep = 0; onboardingDamage = 2;
  onboardingExamples = {}; onboardingShowcaseStep = 0;
  renderOnboarding(); showAboutView(true); $('#rules-dialog').showModal(); render();
  $('#onboarding-body').focus({ preventScroll: true });
}
function goToOnboardingStep(step) {
  cancelOnboardingAnimation();
  onboardingPreviewByKeyboard = false;
  onboardingStep = Math.max(0, Math.min(onboardingSteps.length - 1, step));
  renderOnboarding(); $('#onboarding-body').focus();
}
$('#rules-dialog').addEventListener('cancel', event => event.preventDefault());
$('#about-guide-tab').addEventListener('click', () => showAboutView(true));
$('#about-reference-tab').addEventListener('click', () => showAboutView(false));
$('#onboarding-progress').addEventListener('click', event => { const button = event.target.closest('[data-onboarding-step]'); if (button) goToOnboardingStep(Number(button.dataset.onboardingStep)); });
$('#onboarding-back').addEventListener('click', () => goToOnboardingStep(onboardingStep - 1));
$('#onboarding-next').addEventListener('click', () => {
  if (onboardingStep < onboardingSteps.length - 1) return goToOnboardingStep(onboardingStep + 1);
  $('#rules-dialog').close();
  requestAnimationFrame(() => {
    if (gamePhase === 'setup' && !editor) openStartSettings();
    const target = editor ? $('#editor-done') : gamePhase === 'setup' ? $('#start-game') : $('#board .cell[tabindex="0"]');
    target?.focus(); target?.scrollIntoView({ block: 'nearest' });
  });
});
function onboardingLessonModel(sceneKey, example) {
  if (sceneKey.startsWith('unit-')) return createUnitLesson(sceneKey.slice(5), example);
  if (['8', '9', '10'].includes(sceneKey)) return createCombatLesson(Number(sceneKey) - 8, example);
  return createMoveLesson(sceneKey.startsWith('4-') ? 4 : Number(sceneKey), { ...example, aura: sceneKey === '4-defense' ? 'defense' : 'attack' });
}
function cancelOnboardingAnimation() {
  const previous = onboardingAnimation;
  onboardingAnimation = null;
  previous?.animator.cancel();
  return Boolean(previous);
}
function redrawOnboarding() {
  const scroll = $('#onboarding-body').scrollTop;
  renderOnboarding(); $('#onboarding-body').scrollTop = scroll;
}
function presentOnboardingAction(sceneKey) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const lesson = sceneKey === 'showcase' ? createShowcaseBattle(onboardingShowcaseStep) : onboardingLessonModel(sceneKey, onboardingExamples[sceneKey]);
  const plan = lesson.path.length > 1 ? createMovementPlan(lesson.path.map(lesson.point || lessonPoint)) : null;
  if (!plan && !lesson.deaths.length) return false;
  const presentation = { sceneKey, phase: 'idle', frame: null, animator: null };
  presentation.animator = new CombatAnimator(phase => {
    if (onboardingAnimation !== presentation) return;
    presentation.phase = phase;
    if (phase === 'idle') onboardingAnimation = null;
    redrawOnboarding();
    const target = sceneKey === 'showcase' ? '[data-showcase-action="next"]:not(:disabled),[data-showcase-action="prev"]:not(:disabled)' : `[data-lesson-scene="${sceneKey}"] [data-lesson-action="reset"]`;
    $('#onboarding-body').querySelector(target)?.focus({ preventScroll: true });
  }, frame => {
    if (onboardingAnimation !== presentation) return;
    presentation.frame = frame;
    const token = $('#onboarding-body').querySelector(`#lesson-moving-token-${sceneKey}`);
    if (token) { token.setAttribute('transform', `translate(${frame.x},${frame.y})`); token.dataset.progress = String(frame.progress); }
  });
  onboardingAnimation = presentation;
  presentation.animator.start(plan, lesson.deaths.length > 0);
  return true;
}
function updateShowcaseBattle(button) {
  const action = button.dataset.showcaseAction;
  if (!['prev', 'next'].includes(action) || button.disabled || onboardingAnimation && action === 'next') return;
  const next = Math.max(0, Math.min(createShowcaseBattle().total, onboardingShowcaseStep + (action === 'next' ? 1 : -1)));
  if (next === onboardingShowcaseStep) return;
  cancelOnboardingAnimation();
  onboardingShowcaseStep = next;
  if (action === 'prev' || !presentOnboardingAction('showcase')) redrawOnboarding();
  $('#onboarding-body').querySelector(`[data-showcase-action="${action}"]:not(:disabled)`)?.focus({ preventScroll: true });
}
function updateOnboardingLesson(button) {
  const sceneKey = button.closest('[data-lesson-scene]')?.dataset.lessonScene;
  if (!sceneKey) return false;
  const data = button.dataset;
  if (onboardingAnimation && data.lessonAction !== 'reset') return true;
  if (data.lessonAction === 'reset') cancelOnboardingAnimation();
  const example = onboardingExamples[sceneKey] ||= { selected: false, advanced: false, destination: null, placement: null, previewPlacement: null };
  let selector;
  if (data.lessonUnit) {
    onboardingPreviewByKeyboard = false;
    const currentSelection = example.selectedId || (sceneKey === 'unit-shield' ? 'blue' : data.lessonUnit);
    example.selected = !example.selected || currentSelection !== data.lessonUnit;
    example.selectedId = example.selected ? data.lessonUnit : null;
    example.previewPlacement = null;
    if (!example.advanced) example.destination = null;
    selector = `[data-lesson-unit="${data.lessonUnit}"]`;
  } else if (data.lessonPlace) {
    if (!example.selected || example.advanced) return true;
    const [q, r] = data.lessonPlace.split(',').map(Number);
    if (!onboardingLessonModel(sceneKey, example).available.some(cell => cell.q === q && cell.r === r)) return true;
    example.placement = { q, r }; example.previewPlacement = null; example.advanced = true; example.selected = false;
    selector = '[data-lesson-action="reset"]';
  } else if (data.lessonCell) {
    if (!example.selected || example.advanced) return true;
    const [q, r] = data.lessonCell.split(',').map(Number);
    const lesson = onboardingLessonModel(sceneKey, example);
    if (!lesson.available.some(cell => cell.q === q && cell.r === r)) return true;
    example.movedId = lesson.moverId;
    example.destination = { q, r }; example.advanced = true; example.selected = false; example.selectedId = null;
    selector = '[data-lesson-action="reset"]';
  } else if (data.lessonAction === 'remove-shield' && sceneKey === '2') {
    if (example.advanced || example.shieldRemoved) return true;
    example.shieldRemoved = true; example.selected = false; example.previewPlacement = null;
    if (!example.advanced) example.destination = null;
    selector = '[data-lesson-action="reset"]';
  } else if (data.lessonAction === 'toggle-archer' && sceneKey === '9') {
    cancelOnboardingAnimation();
    Object.assign(example, { selected: false, advanced: false, destination: null, secondArcher: example.secondArcher === false });
    selector = '[data-lesson-action="toggle-archer"]';
  } else if (data.lessonAction === 'reset') {
    Object.assign(example, { selected: false, selectedId: null, movedId: null, advanced: false, destination: null, placement: null, previewPlacement: null, shieldRemoved: false, secondArcher: true });
    selector = '[data-lesson-unit]';
  } else return false;
  const isAction = data.lessonCell || data.lessonPlace || data.lessonAction === 'remove-shield';
  if (!isAction || !presentOnboardingAction(sceneKey)) redrawOnboarding();
  $('#onboarding-body').querySelector(`[data-lesson-scene="${sceneKey}"] ${selector}`)?.focus({ preventScroll: true });
  return true;
}
function refreshOnboardingMovePreview(sceneKey) {
  const example = onboardingExamples[sceneKey];
  const scene = $('#onboarding-body').querySelector(`[data-lesson-scene="${sceneKey}"]`);
  if (!scene || !example?.selected || example.advanced) return;
  const lesson = onboardingLessonModel(sceneKey, example);
  const template = document.createElement('template');
  template.innerHTML = renderMoveLesson(lesson, ICON_PATHS, unitBadges);
  for (const selector of ['.lesson-attack-reach', '.lesson-lines', '.lesson-numbers', '.lesson-ghost', '.lesson-aura-circles', '.lesson-details dl', '.lesson-feedback', '.lesson-state']) {
    scene.querySelector(selector).innerHTML = template.content.querySelector(selector).innerHTML;
  }
  const auraDefinitions = scene.querySelector('defs');
  if (auraDefinitions) auraDefinitions.innerHTML = template.content.querySelector('defs').innerHTML;
  scene.querySelectorAll('[data-lesson-position]').forEach(cell => {
    const source = template.content.querySelector(`[data-lesson-position="${cell.dataset.lessonPosition}"]`);
    for (const name of ['lesson-route']) cell.classList.toggle(name, source.classList.contains(name));
    const overlay = cell.querySelector('.lesson-aura-overlay');
    if (overlay) overlay.setAttribute('style', source.querySelector('.lesson-aura-overlay').getAttribute('style'));
  });
  scene.querySelectorAll('[data-lesson-piece]').forEach(piece => {
    const source = template.content.querySelector(`[data-lesson-piece="${piece.dataset.lessonPiece}"]`);
    piece.querySelector('.lesson-unit-badges').innerHTML = source.querySelector('.lesson-unit-badges').innerHTML;
    piece.classList.toggle('lesson-preview-origin', source.classList.contains('lesson-preview-origin'));
    piece.classList.toggle('lesson-fatal', source.classList.contains('lesson-fatal'));
  });
}
function onboardingPreviewTarget(element) {
  return element?.closest?.('[data-lesson-cell],[data-lesson-place]');
}
function previewOnboardingMove(event) {
  if (onboardingAnimation) return;
  const cell = onboardingPreviewTarget(event.target);
  const sceneKey = cell?.closest('[data-lesson-scene]')?.dataset.lessonScene;
  const example = onboardingExamples[sceneKey];
  if (!sceneKey || !example?.selected || example.advanced) return;
  if (event.type === 'focusin') onboardingPreviewByKeyboard = true;
  else if (onboardingPreviewByKeyboard) {
    // Scrolling a focused cell under a stationary mouse must not replace its forecast.
    if (event.type !== 'pointermove' || !event.movementX && !event.movementY) return;
    onboardingPreviewByKeyboard = false;
  }
  const property = cell.dataset.lessonPlace ? 'previewPlacement' : 'destination';
  const [q, r] = (cell.dataset.lessonPlace || cell.dataset.lessonCell).split(',').map(Number);
  if (example[property]?.q === q && example[property]?.r === r) return;
  example[property] = { q, r };
  refreshOnboardingMovePreview(sceneKey);
}
function clearOnboardingMovePreview(event) {
  if (onboardingAnimation) return;
  if (onboardingPreviewByKeyboard && event.type === 'pointerout') return;
  const cell = onboardingPreviewTarget(event.target);
  const sceneKey = cell?.closest('[data-lesson-scene]')?.dataset.lessonScene;
  if (!sceneKey) return;
  const next = onboardingPreviewTarget(event.relatedTarget);
  if (next?.closest('[data-lesson-scene]')?.dataset.lessonScene === sceneKey) return;
  const example = onboardingExamples[sceneKey];
  if (!example?.selected || example.advanced || !example.destination && !example.previewPlacement) return;
  example.destination = null; example.previewPlacement = null;
  refreshOnboardingMovePreview(sceneKey);
}
$('#onboarding-body').addEventListener('pointerover', previewOnboardingMove);
$('#onboarding-body').addEventListener('pointermove', previewOnboardingMove);
$('#onboarding-body').addEventListener('focusin', previewOnboardingMove);
$('#onboarding-body').addEventListener('pointerout', clearOnboardingMovePreview);
$('#onboarding-body').addEventListener('focusout', clearOnboardingMovePreview);
$('#onboarding-body').addEventListener('click', event => {
  const showcaseButton = event.target.closest('[data-showcase-action]');
  if (showcaseButton?.dataset.showcaseAction) { updateShowcaseBattle(showcaseButton); return; }
  const button = event.target.closest('button,[data-lesson-cell],[data-lesson-unit],[data-lesson-place]');
  if (onboardingAnimation && button?.dataset.lessonAction !== 'reset') return;
  const sceneKey = button?.closest('[data-lesson-scene]')?.dataset.lessonScene;
  let cleared = false;
  for (const [key, example] of Object.entries(onboardingExamples)) {
    if (!example.selected || key === sceneKey && (button.dataset.lessonUnit || button.dataset.lessonCell || button.dataset.lessonPlace || button.dataset.lessonAction === 'reset')) continue;
    example.selected = false; example.selectedId = null; example.previewPlacement = null;
    if (!example.advanced) example.destination = null;
    cleared = true;
  }
  if (button && updateOnboardingLesson(button)) return;
  if (button?.dataset.damage) {
    onboardingDamage = Number(button.dataset.damage);
    renderOnboarding(); $('#onboarding-body').querySelector(`[data-damage="${button.dataset.damage}"]`)?.focus();
  } else if (cleared) {
    const scroll = $('#onboarding-body').scrollTop;
    renderOnboarding(); $('#onboarding-body').scrollTop = scroll;
  }
});
$('#onboarding-body').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key) && (onboardingStep === 0 || event.target.closest('[data-showcase-battle]'))) {
    event.preventDefault();
    $('#onboarding-body').querySelector('[data-showcase-battle]')?.scrollIntoView({ block: 'nearest' });
    $('#onboarding-body').querySelector(`[data-showcase-action="${event.key === 'ArrowRight' ? 'next' : 'prev'}"]`)?.click();
    return;
  }
  if (!['Enter', ' '].includes(event.key)) return;
  const cell = event.target.closest('[data-lesson-cell],[data-lesson-unit],[data-lesson-place]'); if (!cell) return;
  event.preventDefault(); updateOnboardingLesson(cell);
});
$('#onboarding-open').addEventListener('click', openAbout);

$('#rules-open').addEventListener('click', openAbout);
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => { if (dialog.id === 'rules-dialog') cancelOnboardingAnimation(); render(); }));
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => dismissDialog(b.closest('dialog'))));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', event => { if (event.target === d) { const r = d.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dismissDialog(d); } }));
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('dialog[open]')) { reviewingTurn = false; fieldView = null; selected = null; render(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('dialog[open]')) { event.preventDefault(); $('#undo').click(); } });
document.querySelectorAll('[data-icon]').forEach(element => element.innerHTML = icon(element.dataset.icon));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches && movement) { const deaths = movement.deaths; cancelMovement(); render(deaths); } if (event.matches && onboardingAnimation) onboardingAnimation.animator.finish(); });
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
if (freshNewGameRequested && gamePhase === 'setup' && previousGame) openStartSettings();
if (presetUpdated) toast('Подготовлена расстановка с одним барабанщиком и одним знаменосцем. Нажмите «Начать», чтобы играть.');

if (balanceUpdated) toast('Обновлена расстановка: новое поле, разведчик и усиленный знаменосец.');
