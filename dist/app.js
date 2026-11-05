import { DEFAULT_CONFIG, TYPES, LABELS, TEAM_NAMES } from './rules.js';
import { clone, key, cells, distance, validateConfig, validateState, createGame, analyze, inspectCell, effective, attacks, auraReaches, reachable, movementPath, shieldCanRetreat, move, pass, resolve } from './engine.js';
import { BotRunner } from './bot-client.js';
import { classifyPosition, prepareStartPosition } from './start-position.js';
import { createMovementPlan, sampleMovement, MovementAnimator } from './move-animation.js';
const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, forms) => n % 100 >= 11 && n % 100 <= 14 ? forms[2] : n % 10 === 1 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 ? forms[1] : forms[2];
const ICON_PATHS = {
  shield: '<path d="M12 2 20 5v6c0 5-4 8-8 11-4-3-8-6-8-11V5Z"/><path d="M12 6v11M8 10h8"/>',
  archer: '<path d="M8 3c10 4 10 14 0 18L12 12Z"/><path d="M3 12h18m-4-3 4 3-4 3"/>',
  attackLamp: '<path d="M4 22V3m0 2c5-4 10 4 16 0v11c-6 4-11-4-16 0"/><path d="m13 7-3 5h4l-2 4"/>',
  defenseLamp: '<path d="M3 9c0-4.3 4-7 9-7s9 2.7 9 7M6 9c0-2.5 2.7-4 6-4s6 1.5 6 4M12 2v3M6 4l2 2m10-2-2 2M12 6v3"/><path d="M6 14a6 5 0 0 1 12 0M5 14h14M6 14v6l4 2v-6m8-2v6l-4 2v-6"/>'
};
const icon = type => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[type]}</svg>`;
const incomingBadge = info => `<g class="incoming-indicator ${info.incoming > 0 ? 'under-fire' : ''}" data-damage="${info.incoming}"><title>Входящий урон: ${info.incoming}</title><circle class="incoming-badge" cx="-17" cy="17" r="8.5"/><text class="incoming-text" x="-17" y="17.4" style="font-size:${String(info.incoming).length > 3 ? 5.5 : String(info.incoming).length > 2 ? 7 : 9}px">${info.incoming}</text></g>`;
const attackBadge = info => `<g class="attack-indicator" data-attack="${info.damage}"><title>Урон атаки: ${info.damage}</title><circle class="attack-badge" cx="-6.5" cy="-20" r="7.5"/><text class="attack-text" x="-6.5" y="-19.6" style="font-size:${String(info.damage).length > 2 ? 6 : 9}px">${info.damage}</text></g>`;
const rangeBadge = info => `<g class="range-indicator" data-range="${info.range}"><title>Дальность атаки: ${info.range}</title><circle class="range-badge" cx="6.5" cy="-20" r="7.5"/><text class="range-text" x="6.5" y="-19.6" style="font-size:${String(info.range).length > 2 ? 6 : 9}px">${info.range}</text></g>`;
const fortBadge = value => `<g class="fort-indicator"><title>Стойкость: ${value}</title><circle class="fort-badge" cx="17" cy="17" r="7.5"/><text class="fort-text" x="17" y="17.4">${value}</text></g>`;
const AURA_COLORS = ['#a9cf91', '#c6a5df', '#b66a80', '#edd46c'];
// One bit per team/type; sharp bands preserve every aura in an overlap.
const auraGradients = Array.from({ length: 15 }, (_, i) => {
  const mask = i + 1, colors = AURA_COLORS.filter((_, bit) => mask & (1 << bit));
  const stops = colors.map((color, index) => `<stop offset="${index * 100 / colors.length}%" stop-color="${color}"/><stop offset="${(index + 1) * 100 / colors.length}%" stop-color="${color}"/>`).join('');
  return `<linearGradient id="aura-${mask}" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient>`;
}).join('');
const skullShape = () => '<path class="skull-head" d="M8 1.5c-3.4 0-5.5 2.4-5.5 5.3 0 2 1.2 3.4 2.5 3.9V14h6v-3.3c1.3-.5 2.5-1.9 2.5-3.9C13.5 3.9 11.4 1.5 8 1.5Z"/><circle class="skull-eye" cx="5.5" cy="6.8" r="1.4"/><circle class="skull-eye" cx="10.5" cy="6.8" r="1.4"/><path class="skull-nose" d="m8 8.6-1.2 1.8h2.4Z"/><path class="skull-teeth" d="M7 11.5V14m2-2.5V14"/>';
const fatalMark = () => `<g class="fatal-mark" transform="translate(-25,9)" aria-hidden="true"><circle class="skull-badge" cx="8" cy="8" r="8.5"/>${skullShape()}</g>`;
let config = clone(DEFAULT_CONFIG), state = createGame(config), history = [], log = [];
let firstMove = 'south';
let gamePhase = 'setup', positionKind = 'default', previousGame = null;
let playMode = 'bot', humanTeam = 1, lastTurn = null, reviewingTurn = false, botTimer = null, botIssue = '', botSuspended = false;
const botRunner = new BotRunner();
let selected = null, editor = false, tool = 'shield', editorTeam = 0, hover = null, inspection = null, toastTimer;
let report = analyze(state, config), available = [], ready = false;
const STORAGE = 'lamps-prototype-v1';
const PRESET_REVISION = 1;
const START_PREFS_REVISION = 1;
let presetUpdated = false;
let currentDeaths = [], deathEffectTimer;
let movement = null;
const moveAnimator = new MovementAnimator(frame => {
  const token = $('#moving-token');
  if (token) { token.setAttribute('transform', `translate(${frame.x},${frame.y})`); token.dataset.progress = String(frame.progress); }
}, () => { const completed = movement; movement = null; if (completed) render(completed.deaths); });
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function currentSnapshot() { return clone({ config, state, log, positionKind }); }
function checkpoint(actor = 'other', action = null) { history.push({ ...currentSnapshot(), actor, action }); if (history.length > 40) history.shift(); }
function save() { try { localStorage.setItem(STORAGE, JSON.stringify({ ...currentSnapshot(), history, firstMove, playMode, humanTeam, lastTurn, gamePhase, editor, previousGame, presetRevision: PRESET_REVISION, startPrefsRevision: START_PREFS_REVISION })); } catch { if (ready) toast('Не удалось сохранить позицию в браузере. Можно скачать JSON.'); } }
function normalizeUnitNames(value) {
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
    return { snapshot, history: (Array.isArray(value.history) ? value.history.slice(-40) : []).map(readSnapshot), lastTurn: readLastTurn(value.lastTurn, snapshot.config, snapshot.state), playMode: value.playMode === 'bot' ? 'bot' : 'local', humanTeam: value.humanTeam === 1 ? 1 : 0, firstMove: ['north', 'south', 'random'].includes(value.firstMove) ? value.firstMove : 'north' };
  } catch { return null; }
}
try {
  const raw = localStorage.getItem(STORAGE);
  if (raw) {
    const saved = JSON.parse(raw), restored = readSnapshot(saved);
    if (['north', 'south', 'random'].includes(saved.firstMove)) firstMove = saved.firstMove;
    if (['local', 'bot'].includes(saved.playMode)) playMode = saved.playMode;
    if ([0, 1].includes(saved.humanTeam)) humanTeam = saved.humanTeam;
    config = restored.config; state = restored.state; log = restored.log;
    positionKind = restored.positionKind;
    gamePhase = saved.gamePhase === 'playing' || (saved.gamePhase === undefined && (state.ply > 0 || state.winner !== null)) ? 'playing' : 'setup';
    if (gamePhase === 'setup' && saved.startPrefsRevision !== START_PREFS_REVISION) { playMode = 'bot'; humanTeam = 1; firstMove = 'south'; }
    editor = gamePhase === 'setup' && saved.editor === true;
    previousGame = gamePhase === 'setup' ? readPreviousGame(saved.previousGame) : null;
    history = (Array.isArray(saved.history) ? saved.history.slice(-40) : []).map(readSnapshot);
    lastTurn = readLastTurn(saved.lastTurn || saved.lastBotTurn) || lastTurnFromHistory();
    if (saved.presetRevision !== PRESET_REVISION && (config.army.attackLamps !== 1 || config.army.defenseLamps !== 1 || config.stats.attackLamp.damage !== 2)) {
      const next = clone(config); next.army.attackLamps = 1; next.army.defenseLamps = 1; next.stats.attackLamp.damage = 2;
      const fresh = createGame(next);
      checkpoint(); config = next; state = fresh; log = []; lastTurn = null; gamePhase = 'setup'; positionKind = 'default'; editor = false; presetUpdated = true;
    }
  }
} catch { toast('Сохранённая позиция не прошла проверку. Загружена исходная расстановка.'); }
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
  botRunner.run({ state, config, options: { depth: 4, seed: 17001, previousStates: [...recent.map(entry => entry.state), state], lastActions: [...lastActions] } }, result => {
    if (state !== requestedState || config !== requestedConfig || !isBotTurn() || editor || reviewingTurn) return;
    if (!result?.action) { botIssue = 'У бота нет допустимого хода. Можно разрешить пропуск в настройках или исследовать позицию в редакторе.'; render(); return; }
    try {
      const before = currentSnapshot(), action = result.action.pass ? { pass: true } : { ...result.action, from: clone(state.pieces.find(p => p.id === result.action.id)) };
      const outcome = action.pass ? pass(state, config) : move(state, config, action.id, action.to);
      checkpoint('bot', action); lastTurn = { before, action: readAction(action) }; state = outcome.state;
      log.push({ text: action.pass ? `${TEAM_NAMES[before.state.turn]} · бот · пропуск хода` : `${TEAM_NAMES[outcome.action.team]} · бот · ${LABELS[outcome.action.type]}: ${positionText(outcome.action.from)} → ${positionText(outcome.action.to)}`, detail: deathDetail(outcome.deaths) });
      selected = null; botIssue = ''; presentMove(before, action, outcome.deaths);
    } catch { botIssue = 'Не удалось применить ход бота. Попробуйте ещё раз.'; render(); }
  }, error => { botIssue = error.message || 'Не удалось запустить бота. Попробуйте ещё раз.'; render(); });
}
function point(c) { return config.geometry === 'hex' ? { x: Math.sqrt(3) * 33 * (c.q + c.r / 2), y: 49.5 * c.r } : { x: c.q * 59, y: c.r * 59 }; }
function polygon(c) { const { x, y } = point(c); return config.geometry === 'hex' ? Array.from({ length: 6 }, (_, i) => `${x + 32 * Math.cos((60 * i - 30) * Math.PI / 180)},${y + 32 * Math.sin((60 * i - 30) * Math.PI / 180)}`).join(' ') : `${x-28},${y-28} ${x+28},${y-28} ${x+28},${y+28} ${x-28},${y+28}`; }
function boardMarkup() {
  const state = visibleState();
  const board = cells(config), points = board.map(point), minX = Math.min(...points.map(p => p.x)) - 37, maxX = Math.max(...points.map(p => p.x)) + 37, minY = Math.min(...points.map(p => p.y)) - 40, maxY = Math.max(...points.map(p => p.y)) + 40;
  $('#board').setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  const occupied = new Map(state.pieces.map(p => [key(p.q, p.r), p])), destinations = new Set(available.map(c => key(c.q, c.r)));
  const selectedPiece = state.pieces.find(p => p.id === selected);
  const showAttacks = $('#show-attacks').checked, showTeamDamage = showAttacks && !selectedPiece;
  const attackSources = showAttacks ? state.pieces.map(piece => ({ piece, stats: report.get(piece.id) })).filter(source => source.stats.damage > 0) : [];
  $('#attack-legend').hidden = !showAttacks;
  $('#attack-legend').innerHTML = `<span class="attack-team north">${TEAM_NAMES[0]}</span><span class="attack-team south">${TEAM_NAMES[1]}</span><span>${!attackSources.length ? 'Нет атакующих фигур' : showTeamDamage ? 'Суммарный урон каждой команды' : 'Зоны обеих команд · снимите выбор для чисел урона'}</span>`;
  $('#board').innerHTML = `<defs>${auraGradients}<linearGradient id="attack-overlap" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="50%" stop-color="#d6e6ef"/><stop offset="50%" stop-color="#f3d6c2"/></linearGradient><marker id="damage-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="#b98227"/></marker></defs>` + board.map(c => {
    const k = key(c.q, c.r), p = occupied.get(k), { x, y } = point(c);
    const classes = ['cell']; if ((c.q + c.r) % 2) classes.push('alt');
    if (destinations.has(k) && !editor && selectedPiece?.team === state.turn) classes.push('reachable');
    if (p?.id === selected) classes.push('selected');
    const cellDamage = [0, 0];
    for (const source of attackSources) if (p?.team !== source.piece.team && attacks(source.piece, { ...c, id: '__probe', type: 'archer', team: 1 - source.piece.team }, state, config, source.stats)) cellDamage[source.piece.team] += source.stats.damage;
    if (cellDamage.some(Boolean)) classes.push('attack-zone');
    if (cellDamage[0]) classes.push('attack-north');
    if (cellDamage[1]) classes.push('attack-south');
    if (cellDamage.every(Boolean)) classes.push('attack-both');
    const details = p ? `${TEAM_NAMES[p.team]}, ${LABELS[p.type]}` : 'пусто';
    let token = '';
    const damageY = p ? 28 : 0;
    const damageLabel = showTeamDamage ? cellDamage.map((damage, team) => {
      if (!damage) return '';
      const labelX = x + (cellDamage.every(Boolean) ? team === 0 ? -9 : 9 : 0);
      return `<g class="attack-map-label ${team === 0 ? 'north' : 'south'}" data-attack-team="${team}"><title>Урон команды «${TEAM_NAMES[team]}»: ${damage}</title><circle cx="${labelX}" cy="${y + damageY}" r="${p ? 7.5 : cellDamage.every(Boolean) ? 9 : 10}"/><text x="${labelX}" y="${y + damageY + .4}" style="font-size:${p ? String(damage).length > 2 ? 6 : 9 : String(damage).length > 2 ? 8 : String(damage).length > 1 ? 11 : 13}px">${damage}</text></g>`;
    }).join('') : '';
    if (p) {
      const info = report.get(p.id);
      token = `<g class="piece ${p.team === 0 ? 'north' : 'south'} ${info.dead ? 'fatal' : ''} ${movement?.piece.id === p.id ? 'moving-origin' : ''}" data-piece-id="${p.id}" transform="translate(${x},${y})"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${ICON_PATHS[p.type]}</g>${p.group ? `<text class="group-text" x="0" y="16">${p.group === 1 ? 'I' : p.group === 2 ? 'II' : p.group}</text>` : ''}${fortBadge(info.fortitude)}${incomingBadge(info)}${attackBadge(info)}${rangeBadge(info)}${fatalMark()}</g>`;
    }
    return `<g class="${classes.join(' ')}" data-cell="${k}" tabindex="0" role="button" aria-label="Клетка ${k}: ${details}"><polygon class="tile" points="${polygon(c)}"/>${!p && destinations.has(k) && !editor ? `<circle class="move-dot" cx="${x}" cy="${y}" r="3"/>` : ''}${$('#show-coordinates').checked ? `<text class="coordinate" x="${x}" y="${y + (p && damageLabel ? -32 : 29)}">${k}</text>` : ''}${damageLabel}${token}</g>`;
  }).join('') + '<g id="attack-lines" class="attack-lines" aria-hidden="true"></g>' + `<g id="death-effects" aria-hidden="true">${currentDeaths.map(piece => {
    const { x, y } = point(piece);
    return `<g transform="translate(${x},${y})"><polygon class="death-glow" points="${polygon({ q: 0, r: 0 })}"/><circle class="death-pulse" r="22"/><g class="death-ghost ${piece.team === 0 ? 'north' : 'south'}"><g class="death-token"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${ICON_PATHS[piece.type]}</g></g><g class="death-skull"><g class="fatal-mark" transform="translate(-16,-17) scale(2)">${skullShape()}</g></g></g></g>`;
  }).join('')}</g>` + lastMoveTrace() + movingTokenMarkup();
}
function paintAuras() {
  const state = visibleState(), showAll = $('#show-auras').checked;
  const selectedPiece = state.pieces.find(p => p.id === selected);
  const support = selectedPiece && ['attackLamp', 'defenseLamp'].includes(selectedPiece.type);
  const isPreview = !showAll && support && inspection?.isPreview && inspection.piece?.id === selected;
  const position = isPreview ? inspection.position : state;
  const source = support ? position.pieces.find(p => p.id === selected) : null;
  const sources = showAll ? state.pieces.filter(p => ['attackLamp', 'defenseLamp'].includes(p.type) || shieldCanRetreat(p, config)) : source ? [source] : [];
  document.querySelectorAll('#board [data-cell]').forEach(element => {
    const [q, r] = element.dataset.cell.split(',').map(Number);
    let mask = 0;
    for (const lamp of sources) if (auraReaches(lamp, { q, r }, position, config)) mask |= (lamp.type === 'shield' ? 3 : lamp.type === 'defenseLamp' ? 2 : 1) << (lamp.team * 2);
    element.classList.toggle('has-aura', Boolean(mask));
    if (mask) element.style.setProperty('--aura-fill', `url(#aura-${mask})`);
    else element.style.removeProperty('--aura-fill');
  });
  const legend = $('#aura-legend');
  legend.hidden = !showAll && !source;
  if (showAll) {
    legend.innerHTML = [0, 1].map(team => `<span><i class="aura-swatch ${team ? 'south' : 'north'}-attack"></i> ${TEAM_NAMES[team]} · атака</span><span><i class="aura-swatch ${team ? 'south' : 'north'}-defense"></i> ${TEAM_NAMES[team]} · защита</span>`).join('') + '<span>Пересечения — цветными полосами</span>';
  } else if (source) {
    legend.innerHTML = `<span><i class="aura-swatch ${source.team ? 'south' : 'north'}-${source.type === 'attackLamp' ? 'attack' : 'defense'}"></i> ${TEAM_NAMES[source.team]} · ${LABELS[source.type]} · аура ${config.stats[source.type].aura} ${plural(config.stats[source.type].aura, ['клетка', 'клетки', 'клеток'])}${isPreview ? ' · предпросмотр' : ''}</span>`;
  } else legend.innerHTML = '';
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
  return `<g id="moving-token" class="moving-token ${p.team ? 'south' : 'north'}" data-progress="${frame.progress}" transform="translate(${frame.x},${frame.y})" aria-hidden="true"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${ICON_PATHS[p.type]}</g>${p.group ? `<text class="group-text" x="0" y="16">${p.group === 1 ? 'I' : p.group === 2 ? 'II' : p.group}</text>` : ''}</g>`;
}
function inspectionContext() {
  const position = visibleState();
  return inspection || { piece: position.pieces.find(p => p.id === selected), position, report, isPreview: false };
}
function highlightSources() {
  const context = inspectionContext(), target = context.piece;
  const sourceIds = new Set(target ? context.report.get(target.id).attackers.map(a => a.id) : []);
  document.querySelectorAll('[data-piece-id]').forEach(element => {
    const id = element.dataset.pieceId;
    const previewOrigin = context.isPreview && id === target?.id;
    element.classList.toggle('preview-origin', previewOrigin);
    const info = previewOrigin ? report.get(id) : context.report.get(id);
    element.classList.toggle('fatal', !previewOrigin && (info?.dead || false));
    element.classList.toggle('attacking-source', sourceIds.has(id));
    if (info) {
      const indicator = element.querySelector('.incoming-indicator');
      if (indicator.dataset.damage !== String(info.incoming)) indicator.outerHTML = incomingBadge(info);
      const attackIndicator = element.querySelector('.attack-indicator');
      if (attackIndicator.dataset.attack !== String(info.damage)) attackIndicator.outerHTML = attackBadge(info);
      const rangeIndicator = element.querySelector('.range-indicator');
      if (rangeIndicator.dataset.range !== String(info.range)) rangeIndicator.outerHTML = rangeBadge(info);
      element.querySelector('.fort-text').textContent = info.fortitude;
      element.querySelector('.fort-indicator title').textContent = `Стойкость: ${info.fortitude}`;
    }
  });
  document.querySelectorAll('[data-cell]').forEach(element => element.classList.toggle('inspection-target', !!target && element.dataset.cell === key(target.q, target.r)));
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
    return `<line x1="${start.x + dx * shorten}" y1="${start.y + dy * shorten}" x2="${end.x - dx * shorten}" y2="${end.y - dy * shorten}" marker-end="url(#damage-arrow)"><title>${escape(LABELS[source.type])}: ${attack.damage} урона</title></line>`;
  }).join('');
  const targetInfo = context.report.get(target.id);
  const ghost = context.isPreview ? `<g class="preview-ghost ${targetInfo.dead ? 'fatal' : ''}" transform="translate(${end.x},${end.y})"><circle r="19"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${ICON_PATHS[target.type]}</g>${fortBadge(targetInfo.fortitude)}${incomingBadge(targetInfo)}${attackBadge(targetInfo)}${rangeBadge(targetInfo)}${fatalMark()}</g>` : '';
  layer.innerHTML = lines + ghost;
}
function shieldPromotionDescription() {
  const stats = config.stats.shield, p = config.shieldPromotion;
  return `После достижения противоположного края усиливается: урон — ${stats.damage + p.damageBonus}, дальность — ${Math.min(stats.range + p.rangeBonus, p.maxRange)}, стойкость — ${stats.fortitude + p.defenseBonus}. Получает ауру в ${p.aura} ${plural(p.aura, ['клетку', 'клетки', 'клеток'])}: союзникам +${p.damageBonus} к урону, +${p.rangeBonus} к дальности, +${p.defenseBonus} к стойкости. Ауры других фигур не увеличивают дальность атаки броненосцев.`;
}
function unitReferenceMarkup() {
  const rows = TYPES.map(type => {
    const stats = config.stats[type], fields = ['move', 'damage', 'range', 'fortitude'];
    let aura = '';
    if (type === 'attackLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: урон +${stats.damageBonus}, дальность +${stats.rangeBonus}.`;
    if (type === 'defenseLamp') aura = `Аура ${stats.aura} ${plural(stats.aura, ['клетка', 'клетки', 'клеток'])}: стойкость +${stats.defenseBonus}.`;
    if (type === 'shield') aura = shieldPromotionDescription();
    return `<tr data-reference-type="${type}"><th scope="row"><span class="reference-unit">${icon(type)}<span>${LABELS[type]}</span></span></th>${fields.map(field => `<td data-stat="${field}">${stats[field]}</td>`).join('')}</tr>${aura ? `<tr class="reference-aura" data-reference-aura="${type}"><td colspan="5">${aura}</td></tr>` : ''}`;
  }).join('');
  return '<table class="unit-reference-table"><thead><tr><th scope="col">Фигура</th><th scope="col" title="Максимальный шаг">Шаг</th><th scope="col">Урон</th><th scope="col" title="Дальность атаки">Дал.</th><th scope="col" title="Стойкость">Стойк.</th></tr></thead><tbody>' + rows + '</tbody></table><p class="reference-note">Параметры до усилений.</p>';
}
function render(deaths = []) {
  const state = visibleState(), displayLog = movement ? movement.before.log : reviewingTurn && lastTurn ? lastTurn.before.log : log;
  clearTimeout(deathEffectTimer);
  currentDeaths = Array.isArray(deaths) && !matchMedia('(prefers-reduced-motion: reduce)').matches ? deaths : [];
  $('#first-move').value = firstMove;
  $('#play-mode').value = playMode; $('#human-side').value = String(humanTeam);
  $('#human-side-field').hidden = playMode !== 'bot'; $('#bot-controls').hidden = playMode !== 'bot' || gamePhase !== 'playing';
  $('#start-settings').hidden = gamePhase !== 'setup' || editor;
  $('#new-game').hidden = gamePhase !== 'playing';
  $('#cancel-new-game').hidden = !previousGame;
  $('#position-kind').value = positionKind;
  $('#configure-position').disabled = positionKind !== 'custom';
  $('#mode-caption').textContent = playMode === 'bot' ? 'Локально · против бота' : 'Локально · 2 игрока';
  hover = null; inspection = null; report = analyze(state, config);
  const p = state.pieces.find(p => p.id === selected); if (!p) selected = null;
  available = p && !editor && humanCanMove() && p.team === state.turn && state.winner === null ? reachable(p, state, config) : [];
  boardMarkup(); paintAuras(); highlightSources();
  $('#board').setAttribute('aria-busy', String(Boolean(movement)));
  const cellCount = cells(config).length;
  $('#board-name').textContent = `${config.geometry === 'hex' ? 'Гексы' : 'Квадраты'} · ${cellCount} ${plural(cellCount, ['клетка', 'клетки', 'клеток'])}`;
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
  $('#unit-reference').innerHTML = unitReferenceMarkup();
  $('#config-summary').innerHTML = `<div class="summary-row"><span>Групп на игрока</span><strong>${config.army.groups}</strong></div><div class="summary-row"><span>Состав группы</span><strong>${config.army.shields} ${plural(config.army.shields, ['броненосец', 'броненосца', 'броненосцев'])} + ${config.army.archers} ${plural(config.army.archers, ['лукарь', 'лукаря', 'лукарей'])}</strong></div><div class="summary-row"><span>Знаменосцы / командиры</span><strong>${config.army.attackLamps} / ${config.army.defenseLamps}</strong></div><div class="summary-row"><span>Стрельба</span><strong>${config.geometry === 'hex' ? '6 лучей через грани' : config.experiments.squareDiagonals ? '8 направлений' : '4 направления'}</strong></div>`;
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
  $('#result-banner').textContent = state.winner === 'draw' ? 'Ничья · все фигуры уничтожены' : state.winner !== null ? `Победа команды «${TEAM_NAMES[state.winner]}»` : '';
  let hint = editor ? 'Выберите фигуру в палитре и нажмите на пустую клетку. Для удаления выберите ластик.' : selected && p?.team === state.turn ? 'Подсвечены пустые клетки, до которых можно пройти. Наведите на клетку для прогноза.' : 'Выберите свою фигуру, затем подсвеченную клетку.';
  if (!editor && selected && p?.team === state.turn && p.type === 'shield') hint = shieldCanRetreat(p, config) ? `Край достигнут: ход во все стороны, постоянные +${config.shieldPromotion.damageBonus} к урону и +${config.shieldPromotion.defenseBonus} к стойкости, дальность до ${config.shieldPromotion.maxRange}; аура атаки и защиты — ${config.shieldPromotion.aura} ${plural(config.shieldPromotion.aura, ['клетка', 'клетки', 'клеток'])}.` : 'Броненосец ходит вперёд и вбок. Достигнув противоположного края поля, навсегда получает ход назад.';
  if (!editor && state.winner === null && !state.pieces.filter(p => p.team === state.turn).some(p => reachable(p, state, config).length)) hint = 'У команды нет доступных ходов. Исследуйте позицию в редакторе или разрешите пропуск в настройках.';
  if (!editor && isBotTurn()) hint = 'Сейчас ход бота. Можно рассматривать атаки и ауры или открыть настройки.';
  else if (!editor && !selected && lastAction) hint = `${lastMoveText} Выберите свою фигуру.`;
  if (gamePhase === 'setup') hint = editor ? 'Выберите фигуру и пустую клетку для перестановки. Палитра добавляет фигуры. «Готово» завершает настройку позиции.' : 'Настройте партию и нажмите «Начать». До этого фигуры и бот не ходят.';
  if (reviewingTurn) hint = `Просмотр перед последним ходом. ${lastMoveText} Нажмите →, чтобы вернуться к партии.`;
  if (currentDeaths.length) hint = 'Расчёт боя: погибшие фигуры удаляются одновременно.';
  if (movement) hint = `${TEAM_NAMES[movement.piece.team]} · ${LABELS[movement.piece.type]}: ${positionText(lastAction.from)} → ${positionText(lastAction.to)}. Движение…`;
  $('#board-hint').textContent = hint;
  $('#log-count').textContent = `${state.ply} ${plural(state.ply, ['ход', 'хода', 'ходов'])}`;
  $('#move-log').innerHTML = displayLog.length ? displayLog.map((entry, i) => `<div class="log-row"><span class="log-number">${i + 1}</span><p>${escape(entry.text)}<small>${escape(entry.detail)}</small></p></div>`).reverse().join('') : '<p class="log-empty">Здесь появятся перемещения и результат каждого расчёта. Урон не накапливается.</p>';
  document.querySelectorAll('[data-team]').forEach(b => b.classList.toggle('active', Number(b.dataset.team) === editorTeam));
  $('#erase-tool').classList.toggle('selected-tool', tool === 'erase');
  $('#piece-palette').innerHTML = TYPES.map(type => `<button class="palette-item ${tool === type ? 'active' : ''}" data-tool="${type}">${icon(type)}<span>${LABELS[type]}</span></button>`).join('');
  save();
  if (currentDeaths.length) deathEffectTimer = setTimeout(() => { currentDeaths = []; render(); }, 400);
  queueBot();
}
function deathDetail(deaths) { return deaths.length ? 'Погибли: ' + [0, 1].map(team => { const n = deaths.filter(p => p.team === team).length; return n ? `${TEAM_NAMES[team]} — ${n}` : ''; }).filter(Boolean).join(', ') : 'Все фигуры держатся.'; }
function onCell(q, r) {
  if (!editor && !humanCanMove()) return;
  const occupant = state.pieces.find(p => p.q === q && p.r === r);
  if (editor) {
    if (tool === 'erase') { if (occupant) { checkpoint(); state.pieces = state.pieces.filter(p => p !== occupant); selected = null; state.winner = null; render(); } return; }
    if (occupant) { selected = occupant.id; render(); return; }
    const moving = state.pieces.find(p => p.id === selected);
    if (moving) { checkpoint(); moving.q = q; moving.r = r; state.winner = null; selected = null; render(); return; }
    checkpoint(); const id = 'e' + crypto.randomUUID(); state.pieces.push({ id, type: tool, team: editorTeam, q, r, group: null }); state.winner = null; selected = id; render(); return;
  }
  if (occupant) { selected = occupant.id; render(); return; }
  if (!selected || !available.some(c => c.q === q && c.r === r)) return;
  try { const result = move(state, config, selected, { q, r }), before = currentSnapshot(), action = { id: selected, from: result.action.from, to: result.action.to }; checkpoint(playMode === 'bot' ? 'human' : 'other', action); lastTurn = { before, action }; state = result.state; log.push({ text: `${TEAM_NAMES[result.action.team]} · ${LABELS[result.action.type]}: ${positionText(result.action.from)} → ${q}, ${r}`, detail: deathDetail(result.deaths) }); selected = null; presentMove(before, action, result.deaths); } catch (error) { toast(error.message); }
}
$('#board').addEventListener('click', event => { const c = event.target.closest('[data-cell]'); if (c) onCell(...c.dataset.cell.split(',').map(Number)); });
$('#board').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { const c = event.target.closest('[data-cell]'); if (c) { event.preventDefault(); onCell(...c.dataset.cell.split(',').map(Number)); } } });
function hoverCell(event) {
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
for (const id of ['show-attacks', 'show-auras', 'show-coordinates']) $('#' + id).addEventListener('change', render);
$('#undo').addEventListener('click', () => {
  if (!history.length || reviewingTurn || (gamePhase === 'setup' && !editor)) return;
  let previous = history.pop();
  if (playMode === 'bot' && !editor && previous.actor === 'bot' && history.at(-1)?.actor === 'human' && history.at(-1).state.ply === previous.state.ply - 1) previous = history.pop();
  resetBotContext(); config = previous.config; state = previous.state; log = previous.log; positionKind = previous.positionKind; selected = null;
  lastTurn = lastTurnFromHistory(); botSuspended = isBotTurn(); render();
});
function openNewGame() {
  if (gamePhase !== 'playing') return;
  const backup = { snapshot: currentSnapshot(), history: clone(history), lastTurn: clone(lastTurn), playMode, humanTeam, firstMove };
  let next;
  try { next = createGame(config); }
  catch { next = clone(state); next.turn = 0; next.ply = 0; next.winner = null; }
  resetBotContext(); previousGame = backup; gamePhase = 'setup'; editor = false;
  playMode = 'bot'; humanTeam = 1; firstMove = 'south';
  state = next; positionKind = classifyPosition(state, config); history = []; log = []; selected = null; render();
}
function startGame() {
  if (gamePhase !== 'setup' || editor) return;
  try {
    const next = prepareStartPosition(state, config, startingTeam());
    resetBotContext(); state = next; gamePhase = 'playing'; positionKind = classifyPosition(state, config);
    history = []; log = []; previousGame = null; selected = null; render();
  } catch (error) { toast(error.message); }
}
$('#new-game').addEventListener('click', openNewGame);
$('#start-game').addEventListener('click', startGame);
$('#cancel-new-game').addEventListener('click', () => {
  if (!previousGame || gamePhase !== 'setup') return;
  const backup = previousGame; resetBotContext();
  config = backup.snapshot.config; state = backup.snapshot.state; log = backup.snapshot.log; positionKind = backup.snapshot.positionKind;
  history = backup.history; lastTurn = backup.lastTurn; playMode = backup.playMode; humanTeam = backup.humanTeam; firstMove = backup.firstMove;
  previousGame = null; gamePhase = 'playing'; editor = false; selected = null; render();
});
$('#first-move').addEventListener('change', event => { if (gamePhase !== 'setup') return; firstMove = event.target.value; save(); });
$('#play-mode').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); playMode = event.target.value; selected = null; render(); });
$('#human-side').addEventListener('change', event => { if (gamePhase !== 'setup') return; resetBotContext(false); humanTeam = Number(event.target.value); selected = null; render(); });
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
  resetBotContext(); editor = true; history = []; selected = null; render();
});
$('#editor-done').addEventListener('click', () => {
  if (!editor) return;
  try { state = validateState(state, config); positionKind = classifyPosition(state, config); editor = false; history = []; log = []; selected = null; render(); }
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
$('#pass-turn').addEventListener('click', () => { if (!humanCanMove()) return; try { const result = pass(state, config), before = currentSnapshot(), action = { pass: true }; checkpoint(playMode === 'bot' ? 'human' : 'other', action); lastTurn = { before, action }; log.push({ text: `${TEAM_NAMES[state.turn]} · пропуск хода`, detail: deathDetail(result.deaths) }); state = result.state; selected = null; render(result.deaths); } catch (e) { toast(e.message); } });

const statFields = [['move', 'Шаг'], ['damage', 'Урон'], ['range', 'Дальность поражения'], ['fortitude', 'Стойкость'], ['aura', 'Радиус ауры'], ['damageBonus', 'Бонус урона'], ['rangeBonus', 'Бонус дальности'], ['defenseBonus', 'Бонус стойкости']];
const promotionFields = [['aura', 'Радиус ауры'], ['damageBonus', 'Бонус урона'], ['rangeBonus', 'Бонус дальности'], ['defenseBonus', 'Бонус стойкости'], ['maxRange', 'Предел дальности броненосца']];
const armyFields = [['groups', 'Групп на игрока'], ['shields', 'Броненосцев в группе'], ['archers', 'Лукарей в группе'], ['attackLamps', 'Знаменосцев'], ['defenseLamps', 'Командиров']];
const experimentFields = [['squareDiagonals', 'На квадратах диагональ считается одним шагом; атака по 8 направлениям'], ['lampShieldBlocking', 'Вражеские щиты перекрывают поражение знаменосца'], ['allyShotsPass', 'Союзные фигуры пропускают атаки своей команды'], ['aurasThroughShields', 'Ауры знамён проходят сквозь щиты'], ['allowPass', 'Разрешить пропуск хода с обычным расчётом боя']];
function fillSettings(c) {
  const form = $('#settings-form'); form.elements.geometry.value = c.geometry; form.elements.size.value = c.size; form.elements.auraDefenseCap.value = c.auraDefenseCap ?? -1;
  $('#army-inputs').innerHTML = armyFields.map(([name, label]) => `<label>${label}<input type="number" name="army.${name}" value="${c.army[name]}" min="0" max="${name === 'groups' ? 6 : 12}" required></label>`).join('');
  $('#stats-table').innerHTML = `<thead><tr><th>Параметр</th>${TYPES.map(t => `<th>${LABELS[t]}</th>`).join('')}</tr></thead><tbody>${statFields.map(([field, label]) => `<tr><td>${label}</td>${TYPES.map(type => { const na = (type === 'defenseLamp' && ['damage', 'range'].includes(field)) || (['shield', 'archer'].includes(type) && ['aura', 'damageBonus', 'rangeBonus', 'defenseBonus'].includes(field)) || (type === 'attackLamp' && field === 'defenseBonus') || (type === 'defenseLamp' && ['damageBonus', 'rangeBonus'].includes(field)); return `<td>${na ? '<span class="na">—</span>' : `<input aria-label="${LABELS[type]}: ${label}" name="stats.${type}.${field}" type="number" min="${field === 'move' ? 1 : 0}" max="${field === 'move' ? 6 : 20}" value="${c.stats[type][field]}" required>`}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
  $('#promotion-inputs').innerHTML = promotionFields.map(([name, label]) => `<label>${label}<input aria-label="Броненосец после края: ${label}" type="number" name="shieldPromotion.${name}" value="${c.shieldPromotion[name]}" min="0" max="20" required></label>`).join('');
  $('#experiment-inputs').innerHTML = experimentFields.map(([name, label]) => `<label><input type="checkbox" name="experiment.${name}" ${c.experiments[name] ? 'checked' : ''}>${label}</label>`).join('');
  $('#settings-error').textContent = ''; updateSizeLabel();
}
function updateSizeLabel() { const form = $('#settings-form'), hex = form.elements.geometry.value === 'hex'; $('#size-label').textContent = hex ? 'Радиус поля' : 'Сторона поля'; form.elements.size.min = hex ? 3 : 6; form.elements.size.max = hex ? 6 : 12; }
function settingsFromForm() {
  const next = clone(config), form = $('#settings-form'); next.geometry = form.elements.geometry.value; next.size = Number(form.elements.size.value); next.auraDefenseCap = Number(form.elements.auraDefenseCap.value);
  for (const [name] of armyFields) next.army[name] = Number(form.elements['army.' + name].value);
  for (const type of TYPES) for (const [field] of statFields) { const input = form.elements[`stats.${type}.${field}`]; if (input) { if (input.value.trim() === '') throw new Error('Заполните все числовые параметры.'); next.stats[type][field] = Number(input.value); } }
  for (const [name] of promotionFields) { const input = form.elements['shieldPromotion.' + name]; if (input.value.trim() === '') throw new Error('Заполните параметры усиления броненосца.'); next.shieldPromotion[name] = Number(input.value); }
  for (const [name] of experimentFields) next.experiments[name] = form.elements['experiment.' + name].checked;
  return validateConfig(next);
}
$('#settings-open').addEventListener('click', () => { cancelBot(); cancelMovement(); fillSettings(config); $('#settings-dialog').showModal(); render(); });
$('#settings-form').elements.geometry.addEventListener('change', () => { $('#settings-form').elements.size.value = $('#settings-form').elements.geometry.value === 'hex' ? 4 : 8; updateSizeLabel(); });
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const next = settingsFromForm();
    if (gamePhase === 'playing' && (next.geometry !== config.geometry || next.size !== config.size)) throw new Error('Для изменения поля откройте «Новую игру».');
    const nextState = gamePhase === 'setup' && positionKind === 'default' ? createGame(next) : validateState(state, next);
    if (gamePhase === 'playing' || editor) checkpoint();
    resetBotContext(); config = next; state = nextState; selected = null;
    $('#settings-dialog').close(); render();
  } catch (error) { $('#settings-error').textContent = error.message; }
});
function renderAbout() {
  $('#about-directions').textContent = config.geometry === 'hex' ? 'На шестиугольном поле атаки и ауры идут по шести прямым линиям через стороны клеток. Через углы они не идут. Дальность — сколько клеток проходит такая линия от фигуры.' : `На квадратном поле атаки и ауры идут по ${config.experiments.squareDiagonals ? 'восьми направлениям, включая диагонали' : 'четырём направлениям через грани'}. Длина луча — число клеток от источника.`;
  $('#about-promotion').textContent = shieldPromotionDescription();
  $('#about-stats').innerHTML = '<thead><tr><th>Фигура</th><th>Шаг</th><th>Урон</th><th>Дальность</th><th>Стойкость</th><th>Аура</th></tr></thead><tbody>' + TYPES.map(type => { const stats = config.stats[type]; return `<tr><td>${LABELS[type]}</td><td>${stats.move}</td><td>${stats.damage || '—'}</td><td>${stats.range || '—'}</td><td>${stats.fortitude}</td><td>${stats.aura || '—'}</td></tr>`; }).join('') + '</tbody>';
  const experiments = config.experiments;
  $('#about-blocking').textContent = [experiments.lampShieldBlocking ? 'Вражеский броненосец перекрывает все атаки, проходящие через его клетку, и закрывает фигуры за собой.' : 'Вражеский броненосец перекрывает атаки лукарей и других броненосцев, проходящие через его клетку. Атаки знаменосца проходят через броненосцев.', experiments.allyShotsPass ? 'Свои фигуры не мешают союзным атакам.' : 'Свои фигуры перекрывают союзные атаки, проходящие через их клетки.'].join(' ');
  $('#about-auras').textContent = [experiments.aurasThroughShields ? 'Ауры проходят через любые фигуры.' : 'Броненосцы обеих сторон перекрывают распространение аур через свои клетки. Другие фигуры аурам не мешают.', config.auraDefenseCap < 0 ? 'Все полученные бонусы стойкости от аур складываются.' : `Общий бонус стойкости от аур не превышает +${config.auraDefenseCap}. Личное усиление броненосца после края считается отдельно.`].join(' ');
  $('#about-pass').hidden = !experiments.allowPass;
  $('#about-pass').textContent = experiments.allowPass ? 'Вместо перемещения можно пропустить ход. После пропуска обе стороны проходят обычный расчёт боя.' : 'Каждый ход требует перемещения: пропускать ход нельзя.';
}
$('#reset-defaults').addEventListener('click', () => fillSettings(DEFAULT_CONFIG));
$('#rules-open').addEventListener('click', () => { cancelBot(); cancelMovement(); renderAbout(); $('#rules-dialog').showModal(); render(); });
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => render()));
document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', event => { if (event.target === d) { const r = d.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) d.close(); } }));
$('#export-game').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ format: 'lamps-prototype', version: 1, ...currentSnapshot() }, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `lamps-position-${state.ply}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); });
$('#import-game').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 500000) throw new Error('Файл слишком большой.');
    const data = JSON.parse(await file.text());
    if (data.format !== 'lamps-prototype' || data.version !== 1) throw new Error('Это не файл позиции прототипа.');
    const restored = readSnapshot(data);
    if (gamePhase === 'playing') previousGame = { snapshot: currentSnapshot(), history: clone(history), lastTurn: clone(lastTurn), playMode, humanTeam, firstMove };
    resetBotContext(); config = restored.config; state = restored.state; state.ply = 0; state.winner = null;
    log = []; history = []; positionKind = classifyPosition(state, config); gamePhase = 'setup'; selected = null; editor = false;
    render(); toast('Позиция загружена. Нажмите «Начать», чтобы запустить партию.');
  } catch (error) { toast(error.message); }
  event.target.value = '';
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('dialog[open]')) { reviewingTurn = false; selected = null; render(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('dialog[open]')) { event.preventDefault(); $('#undo').click(); } });
document.querySelectorAll('[data-icon]').forEach(element => element.innerHTML = icon(element.dataset.icon));
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches && movement) { const deaths = movement.deaths; cancelMovement(); render(deaths); } });
ready = true; render();
if (presetUpdated) toast('Подготовлена расстановка с одним знаменем каждого типа. Нажмите «Начать», чтобы играть.');
