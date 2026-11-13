import { DEFAULT_CONFIG, LABELS, TEAM_NAMES } from './rules.js';
import { renderTokenBody } from './token-presentation.js';
import { clone, cells, analyze, inspectCell, move, movementPath, reachable } from './engine.js';
import { hexGridPoint, hexGridPolygon, unitAppearance, inspectionDamageArrows, renderDamageArrows, ATTACK_TEAM_COLORS, renderMovingToken, renderDeathEffects, attackReachPresentation, auraCircleMarkup, lethalAttackPresentation, renderHintArrow } from './board-presentation.js';
import { CombatAnimator, MovementAnimator, createMovementPlan } from './move-animation.js';

export const showcasePoint = cell => { const point = hexGridPoint(cell); return { x: 280 + point.x, y: 205 + point.y }; };
export const TRAINING_ACTIONS = [
  { id: 's-shield-left', to: { q: -1, r: 0 } },
  { id: 'n-shield-left', to: { q: 0, r: 0 } },
  { id: 's-shield-left', to: { q: 0, r: -1 } }
];
export const TRAINING_COPY = [
  ['Следуй советам и победишь!',
    'Выбери левого броненосца и подведи его к вражескому броненосцу.',
    'Лучники держат под перекрёстным огнём щитовиков.',
    'Первым ходом атакуем броненосцем броненосца противника. Вместе с лукарем они нанесут достаточно урона, чтобы вывести его из игры. Действуй!'],
  ['Вражеский броненосец уничтожен: броненосец и лукарь сложили урон. Теперь враг контратакует — ставит оставшегося броненосца между двумя нашими.',
    'Он ударит по обоим. Наш левый выдержит 5 урона при стойкости 6. Правый получит ещё и 2 урона от лукаря: всего 7 против стойкости 6 — и погибнет.',
    'Вражеский броненосец тоже погибнет под ответным огнём. Атаки происходят одновременно: фигура успевает ударить, даже если в этом же бою погибает.'],
  ['Враг контратаковал. Но наш левый щитоносец выжил и может продолжить наступление. Враг не увёл знамя и оставил его без прикрытия. Потеря знамени сразу завершает партию — уничтожать остальных врагов не нужно.'],
  ['Победа! Ты уничтожил вражеское знамя и сохранил своё']
];
const sameCell = (a, b) => a && b && a.q === b.q && a.r === b.r;

export function createShowcaseBattle() {
  const config = clone(DEFAULT_CONFIG);
  config.geometry = 'hex'; config.size = 3;
  config.army = { ...config.army, groups: 2, shields: 1, archers: 1, attackLamps: 0, scoutLamps: 0, horns: 0, defenseLamps: 1, centralShields: 0, rearArchers: 0, rearShields: 0 };
  const south = [
    ['shield-left', 'shield', -1, 1], ['shield-right', 'shield', 0, 1],
    ['bow-left', 'archer', -2, 2], ['flag', 'defenseLamp', -1, 2], ['bow-right', 'archer', 0, 2]
  ];
  const pieces = [0, 1].flatMap(team => south.map(([id, type, q, r]) => ({
    id: `${team ? 's' : 'n'}-${id}`, type, team, q: team ? q : -q || 0, r: team ? r : -r
  })));
  return { config, position: { pieces, turn: 1, ply: 0, winner: null }, phase: 'ready', selectedId: null, previewCell: null, hoverCell: null, reviewIndex: null };
}

// Unit demos share the tutorial battle's controller, preview and combat presentation.
export const UNIT_BATTLE_SCENES = ['unit-shield', 'unit-shield-defense', 'unit-drum-shield', 'unit-archer'];
export function createUnitBattle(sceneKey) {
  const config = clone(DEFAULT_CONFIG);
  config.geometry = 'hex'; config.size = 3; config.victoryCondition = 'all-units';
  const piece = (id, type, team, q, r) => ({id, type, team, q, r});
  const scenarios = {
    'unit-shield': {
      title: 'Броненосец — ветеран',
      description: 'Обычный броненосец не может ходить назад, но как только он достигает противоположного края он становится ветераном. Ветеран может ходить назад и наносить урон на дистанции.',
      pieces: [piece('blue','shield',1,0,-2), piece('enemy','shield',0,0,1)],
      actions: [{id:'blue',to:{q:0,r:-3}}, {id:'blue',to:{q:0,r:-2}}],
      copy: [
        ['Выбери оранжевого броненосца возле края. Сделай ход вперёд на отмеченную стрелкой клетку, чтобы стать ветераном.'],
        ['Броненосец достиг противоположного края и стал ветераном. Теперь выбери его и сделай ход на одну клетку назад. Ветеран поразит врага на расстоянии трёх клеток.'],
        ['Ветеран отступил на одну клетку и уничтожил врага дистанционной атакой. Венок и способности сохраняются после отхода от края.']
      ]
    },
    'unit-shield-defense': {
      title: 'Броненосец — защитник',
      description: 'Броненосец перекрывает вражеские стрелы. Поставь его между своим лукарём и вражеским, чтобы закрыть союзника от выстрела.',
      pieces: [piece('blue','shield',1,1,0), piece('ally','archer',1,0,2), piece('enemy','archer',0,0,-2)],
      actions: [{id:'blue',to:{q:0,r:0}}],
      copy: [
        ['Выбери оранжевого броненосца. Поставь его между двумя лукарями на отмеченную стрелкой клетку. Посмотри прогноз: броненосец примет выстрел и защитит союзника.'],
        ['Броненосец перекрыл стрелу и выдержал выстрел. Наш лукарь больше не получает урон. Его собственные стрелы проходят через союзный щит.']
      ]
    },
    'unit-drum-shield': {
      title: 'Барабан и броненосец',
      description: 'Барабан добавляет союзникам один шаг. Вместе с ним броненосец за один ход достаёт до вражеского лукаря.',
      pieces: [piece('blue','shield',1,0,2), piece('drum','attackLamp',1,-1,3), piece('enemy','archer',0,0,-1)],
      actions: [{id:'blue',to:{q:0,r:0}}],
      copy: [
        ['Выбери броненосца. Без барабана он может пройти одну клетку, а под барабаном — две. Сделай ход на отмеченную клетку и уничтожь лукаря.'],
        ['Броненосец прошёл две клетки за один ход и уничтожил лукаря. Дополнительный шаг от барабана сохраняется до конца хода, даже после выхода из его ауры.']
      ]
    },
    'unit-archer': {
      title: 'Лукарь, горн и командир',
      description: 'Горн усиливает атаку лукаря с 2 до 3, а командир увеличивает дальность с 4 до 5. Вместе они помогают уничтожить цель, до которой лукарь раньше не доставал.',
      pieces: [piece('commander','scoutLamp',1,-2,0), piece('archer','archer',1,0,2), piece('horn','horn',1,1,1), piece('enemy','archer',0,0,-3)],
      actions: [{id:'commander',to:{q:-1,r:1}}],
      copy: [
        ['Враг стоит в пяти клетках от нашего лукаря. Горн уже дал лукарю +1 к урону, но его дальности 4 не хватает. Выбери командира и подведи его к лукарю на отмеченную клетку.'],
        ['Командир увеличил дальность лукаря до 5. Под усилением горна лукарь нанёс 3 урона и уничтожил цель, до которой прежде не доставал.']
      ]
    }
  };
  const scenario = scenarios[sceneKey];
  if (!scenario) throw new Error('Неизвестная учебная сцена.');
  const {pieces, ...details} = scenario;
  return {config, sceneKey, ...details, position:{pieces,turn:1,ply:0,winner:null}, phase:'ready',
    selectedId:null, previewCell:null, hoverCell:null, reviewIndex:null};
}

// This isolated lesson executes the approved moves through the regular engine.
// Its snapshots and timers never touch the player's saved game or bot.
export class ShowcaseBattle {
  constructor({ onChange = () => {}, onPreview = onChange, onFrame = () => {}, clock = {}, reducedMotion = () => false, sceneKey = null } = {}) {
    this.initialSceneKey=sceneKey;
    Object.assign(this, sceneKey?createUnitBattle(sceneKey):createShowcaseBattle());
    Object.assign(this, { onChange, onPreview, onFrame, clock, reducedMotion });
    this.history = [clone(this.position)]; this.presentation = null; this.replyTimer = null; this.serial = 0;
    this.setTimer = clock.setTimer || ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = clock.clearTimer || (handle => clearTimeout(handle));
  }
  get busy() { return Boolean(this.presentation) || this.phase === 'reply-preview' || this.phase === 'paused'; }
  get viewedPosition() { return this.reviewIndex === null ? this.position : this.history[this.reviewIndex]; }
  get expectedAction() { return !this.busy && this.reviewIndex === null && this.position.winner === null && this.position.turn === 1 ? (this.actions||TRAINING_ACTIONS)[this.position.ply] : null; }
  get previewMoves() {
    const position = this.viewedPosition;
    const piece = position.pieces.find(piece => piece.id === this.selectedId);
    if (this.busy || this.reviewIndex !== null || position.turn !== 1 || position.winner !== null || !piece || piece.team !== position.turn) return [];
    return reachable(piece, position, this.config);
  }
  selectPiece(id) {
    if (this.busy || !this.viewedPosition.pieces.some(piece => piece.id === id)) return;
    this.selectedId = this.selectedId === id ? null : id; this.previewCell = null; this.hoverCell = null; this.onChange();
  }
  clearSelection() { if (!this.busy && this.selectedId !== null) { this.selectedId = null; this.previewCell = null; this.hoverCell = null; this.onChange(); } }
  preview(cell) {
    if (this.busy) return;
    const hovered = cell && cells(this.config).some(candidate => sameCell(candidate, cell)) ? { q: cell.q, r: cell.r } : null;
    const route = hovered && this.previewMoves.find(candidate => sameCell(candidate, hovered));
    const next = route ? { q: route.q, r: route.r } : null;
    if (((!next && !this.previewCell) || sameCell(next, this.previewCell)) &&
        ((!hovered && !this.hoverCell) || sameCell(hovered, this.hoverCell))) return;
    this.previewCell = next; this.hoverCell = hovered; this.onPreview();
  }
  moveTo(cell) {
    const action = this.expectedAction;
    if (!action || action.id !== this.selectedId || !sameCell(cell, action.to)) return false;
    this.playAction(action); return true;
  }
  playAction(action) {
    const before = clone(this.position), forecast = inspectCell(before, this.config, action.to, action.id);
    const outcome = move(before, this.config, action.id, action.to);
    const piece = before.pieces.find(piece => piece.id === action.id);
    const plan = createMovementPlan(movementPath(piece, before, this.config, action.to).map(showcasePoint));
    this.selectedId = null; this.previewCell = null; this.hoverCell = null; this.phase = 'playing';
    const combat = lethalAttackPresentation(forecast.position, forecast.report, outcome.deaths);
    const presentation = { before, forecast, outcome, action, combat, visiblePosition: forecast.position,
      activeDeaths: [], groupIndex: 0, arrowCount: 0, frame: { ...showcasePoint(piece), progress: 0 }, phase: 'movement' };
    this.presentation = presentation;
    const finish = () => {
      if (this.presentation !== presentation) return;
      this.position = outcome.state; this.presentation = null;
      // Unit exercises allow the next prescribed friendly action without a bot reply.
      if (this.sceneKey && this.position.winner === null) this.position.turn = 1;
      this.history.push(clone(this.position));
      this.phase = this.position.winner !== null || this.actions&&this.position.ply>=this.actions.length ? 'finished' : 'ready';
      if (!this.sceneKey&&this.position.ply === 1) this.scheduleReply();
      this.onChange();
    };
    const animator = new CombatAnimator((phase, frame) => {
      if (this.presentation !== presentation) return;
      if (phase === 'idle') return finish();
      presentation.phase = phase;
      presentation.groupIndex = frame.groupIndex; presentation.arrowCount = frame.arrowCount;
      presentation.activeDeaths = phase === 'deaths' ? combat.groups[frame.groupIndex].deaths : [];
      if (phase === 'deaths') {
        const removed = new Set(presentation.activeDeaths.map(piece => piece.id));
        presentation.visiblePosition = { ...presentation.visiblePosition, pieces: presentation.visiblePosition.pieces.filter(piece => !removed.has(piece.id)) };
      }
      this.onChange();
    }, () => {}, this.clock);
    const startCombat = () => {
      if (this.presentation !== presentation) return;
      if (outcome.deaths.length) animator.startSequence(combat.groups);
      else finish();
    };
    const movement = new MovementAnimator(frame => {
      if (this.presentation === presentation) { presentation.frame = frame; this.onFrame(frame); }
    }, startCombat, this.clock);
    presentation.animator = { cancel() { movement.cancel(); animator.cancel(); } };
    this.onChange();
    if (this.reducedMotion()) startCombat();
    else movement.start(plan);
  }
  scheduleReply() {
    this.phase = 'reply-preview';
    const serial = ++this.serial;
    this.replyTimer = this.setTimer(() => {
      if (this.serial !== serial || this.phase !== 'reply-preview' || this.position.ply !== 1) return;
      this.replyTimer = null; this.playAction(TRAINING_ACTIONS[1]);
    }, 420);
  }
  cancelPending() {
    this.serial++; this.presentation?.animator.cancel(); this.presentation = null;
    if (this.replyTimer !== null) this.clearTimer(this.replyTimer);
    this.replyTimer = null; this.selectedId = null; this.previewCell = null; this.hoverCell = null;
  }
  stop() { this.cancelPending(); this.phase = !this.sceneKey&&this.position.ply === 1 ? 'paused' : this.position.winner !== null||this.actions&&this.position.ply>=this.actions.length ? 'finished' : 'ready'; }
  resume() { if (this.phase === 'paused') this.scheduleReply(); }
  undo() {
    if (!this.position.ply && !this.presentation) return;
    const target = this.position.ply >= 2 ? 2 : 0;
    // Before the final move, undo the preceding player move and the bot's reply together.
    const index = this.sceneKey?Math.max(0,this.position.ply-(this.presentation?0:1)):this.position.ply === 2 && !this.presentation ? 0 : target;
    this.cancelPending(); this.position = clone(this.history[index]); this.history.length = index + 1;
    this.reviewIndex = null; this.phase = 'ready'; this.onChange();
  }
  restart() {
    this.cancelPending();
    Object.assign(this, this.initialSceneKey?createUnitBattle(this.initialSceneKey):createShowcaseBattle());
    this.history = [clone(this.position)]; this.focusCell = this.position.pieces.find(piece=>piece.team===1)?`${this.position.pieces.find(piece=>piece.team===1).q},${this.position.pieces.find(piece=>piece.team===1).r}`:'-1,1';
    this.onChange();
  }
  review(direction) {
    if (this.busy) return;
    const current = this.reviewIndex ?? this.position.ply;
    const next = Math.max(0, Math.min(this.position.ply, current + direction));
    this.reviewIndex = next === this.position.ply ? null : next;
    this.selectedId = null; this.previewCell = null; this.hoverCell = null; this.onChange();
  }
}

function displayBattle(battle) {
  const presentation = battle.presentation;
  let position = battle.viewedPosition || battle.position;
  let context, moving = null, deaths = [];
  const selectedId = battle.selectedId;
  if (presentation) {
    if (presentation.phase === 'movement') {
      position = presentation.before; moving = presentation;
      context = { ...presentation.forecast, isPreview: false };
    } else {
      position = presentation.visiblePosition;
      context = { position, report: presentation.forecast.report, isPreview: false, piece: null };
      deaths = presentation.activeDeaths;
    }
  } else {
    context = battle.hoverCell
      ? inspectCell(position, battle.config, battle.hoverCell, battle.reviewIndex === null && position.turn === 1 ? selectedId : null)
      : { position, report: analyze(position, battle.config), piece: position.pieces.find(piece => piece.id === selectedId), isPreview: false };
  }
  const target = context.piece, report = context.report, attackPosition = context.position;
  const potentialDamage = new Set();
  let arrows = [], visibleCount = null;
  if (!presentation || moving) {
    for (const attack of inspectionDamageArrows(target, selectedId, attackPosition, report, 1)) {
      if (attack.source.id === selectedId) potentialDamage.add(attack.target.id);
    }
    if (target) {
      const arrowTarget = attackPosition.pieces.find(piece => piece.id === selectedId && piece.team === 1) || target;
      arrows = (report.get(arrowTarget.id)?.attackers || []).map(attack => ({
        source: attackPosition.pieces.find(piece => piece.id === attack.id), target: arrowTarget, damage: attack.damage
      })).filter(attack => attack.source);
    }
  } else if (presentation.phase === 'attacks') {
    arrows = presentation.combat.groups[presentation.groupIndex].arrows;
    visibleCount = presentation.arrowCount;
  }
  const sourceIds = new Set(target ? report.get(target.id)?.attackers.map(attack => attack.id) : []);
  return { position, report, selectedId, target, potentialDamage, sourceIds, attackPosition, moving, deaths, arrows, visibleCount,
    ghost: context.isPreview ? target : null };
}

export function renderShowcaseBattle(battle = createShowcaseBattle(), icons = {}, renderBadges = () => '') {
  const { config } = battle, board = cells(config), view = displayBattle(battle);
  const points = board.map(showcasePoint), minX = Math.min(...points.map(point => point.x)) - 37, minY = Math.min(...points.map(point => point.y)) - 40;
  const width = Math.max(...points.map(point => point.x)) + 37 - minX, height = Math.max(...points.map(point => point.y)) + 40 - minY;
  const { position, report, selectedId, target, potentialDamage, sourceIds, attackPosition, moving, deaths, ghost, arrows, visibleCount } = view;
  const selected = position.pieces.find(piece => piece.id === selectedId);
  const previewMoves = battle instanceof ShowcaseBattle ? battle.previewMoves : [];
  const tiles = board.map(cell => {
    const p = showcasePoint(cell), active = sameCell(selected, cell), previewable = previewMoves.some(route => sameCell(route, cell));
    return `<g class="cell lesson-tile${active ? ' selected' : ''}${previewable ? ' reachable' : ''}${sameCell(target, cell) ? ' inspection-target' : ''}" data-showcase-cell="${cell.q},${cell.r}" role="button" tabindex="${`${cell.q},${cell.r}` === (battle.focusCell || (battle.sceneKey?`${position.pieces[0].q},${position.pieces[0].r}`:'-1,1')) ? 0 : -1}" aria-label="Клетка ${cell.q},${cell.r}${previewable ? ': доступный ход' : ''}"><polygon class="tile" points="${hexGridPolygon(p)}"/></g>`;
  }).join('');
  const baseReport = ghost ? analyze(position, config) : report;
  const pieces = position.pieces.map(piece => {
    const p = showcasePoint(piece), origin = ghost?.id === piece.id;
    const info = (origin ? baseReport : report).get(piece.id), appearance = unitAppearance(piece, config, icons);
    const hidden = moving?.action.id === piece.id;
    const muted = battle.presentation && !moving && !battle.presentation.combat.participants.has(piece.id);
    return `<g class="piece training-piece${appearance.veteran ? ' veteran' : ''} ${piece.team ? 'south' : 'north'}${!origin && info.dead ? ' fatal' : ''}${hidden ? ' moving-origin' : ''}${origin ? ' preview-origin' : ''}${sourceIds.has(piece.id) ? ' attacking-source' : ''}${muted ? ' combat-muted' : ''}" data-showcase-piece="${piece.id}" role="button" tabindex="-1" aria-pressed="${piece.id === selectedId}" aria-label="Посмотреть: ${TEAM_NAMES[piece.team]}, ${LABELS[piece.type]}" transform="translate(${p.x},${p.y})"><title>${TEAM_NAMES[piece.team]}: ${LABELS[piece.type]}</title>${renderTokenBody(appearance, piece.team)}${renderBadges(info, { showIncoming: !origin && (piece.id === selectedId || piece.id === target?.id || potentialDamage.has(piece.id)), potentialDamage: potentialDamage.has(piece.id), pieceType: piece.type, veteran: appearance.veteran })}</g>`;
  }).join('');
  const defs = `<defs><clipPath id="training-field-clip">${board.map(cell => `<polygon points="${hexGridPolygon(showcasePoint(cell))}"/>`).join('')}</clipPath><filter id="training-damage-arrow-outline" filterUnits="userSpaceOnUse" x="${minX}" y="${minY}" width="${width}" height="${height}" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="dilate" radius="1" result="edge"/><feFlood flood-color="#fffefb" result="outline-color"/><feComposite in="outline-color" in2="edge" operator="in" result="outline"/><feMerge><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge></filter>${ATTACK_TEAM_COLORS.map((color, team) => `<marker id="training-damage-arrow-${team ? 'south' : 'north'}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="${color}"/></marker>`).join('')}</defs>`;
  const ghostAppearance = ghost && unitAppearance(ghost, config, icons);
  const ghostMarkup = ghost ? `<g id="training-preview-token" class="preview-ghost ${ghost.team ? 'south' : 'north'}${ghostAppearance.veteran ? ' veteran' : ''}${report.get(ghost.id).dead ? ' fatal' : ''}" transform="translate(${showcasePoint(ghost).x},${showcasePoint(ghost).y})">${renderTokenBody(ghostAppearance, ghost.team)}${renderBadges(report.get(ghost.id), {showIncoming:true,pieceType:ghost.type,veteran:ghostAppearance.veteran})}</g>` : '';
  const damageArrows = renderDamageArrows(arrows, showcasePoint, { pieces: attackPosition.pieces, board, report, visibleCount, previewMarkup: ghostMarkup,
    ...(!battle.presentation || moving ? { maxBend: 18 } : {}) }).replaceAll('url(#damage-arrow-', 'url(#training-damage-arrow-');
  const selectedPosition = ghost?.id === selectedId ? attackPosition : position;
  const selectedPiece = !battle.presentation && selectedPosition.pieces.find(piece => piece.id === selectedId);
  const reach = attackReachPresentation(selectedPiece, selectedPosition, config, { point: showcasePoint, polygonPoints: hexGridPolygon({x:0,y:0}), visiblePosition: position, friendlyTeam: 1 });
  const auras = auraCircleMarkup(selectedPiece, selectedPosition, config, showcasePoint, Math.sqrt(3)*33);
  const movingPiece = moving && position.pieces.find(piece => piece.id === moving.action.id);
  const movement = moving ? renderMovingToken(movingPiece, moving.frame, icons, 'training-moving-token', config, movingPiece.team, report.get(movingPiece.id)) : '';
  const deathEffects = renderDeathEffects(deaths, showcasePoint, hexGridPolygon({ x: 0, y: 0 }), icons, config);
  const counts = [0, 1].map(team => position.pieces.filter(piece => piece.team === team).length);
  const undoIcon = '<svg class="undo-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-5 5 5 5"/><path d="M4 8h10a6 6 0 0 1 0 12"/></svg>';
  const viewedPly = battle.reviewIndex ?? battle.position.ply;
  const advicePly = battle.presentation?.before.ply ?? viewedPly;
  const advice = (battle.copy||TRAINING_COPY)[Math.min((battle.copy||TRAINING_COPY).length-1, advicePly)];
  const action=battle.sceneKey&&!battle.busy&&battle.reviewIndex===null?battle.actions[viewedPly]:null;
  const guideSource=action&&position.pieces.find(piece=>piece.id===action.id);
  const guide=guideSource?renderHintArrow(guideSource,action.to,showcasePoint):'';
  const disabled = condition => condition ? ' disabled' : '';
  const markup = `<section class="showcase-scene training-scene" style="--training-arrow-outline:url(#${battle.sceneKey||'training'}-damage-arrow-outline)" data-showcase-battle="${battle.sceneKey||'main'}" data-phase="${battle.phase}" data-ply="${viewedPly}" aria-labelledby="showcase-title">
    <h3 id="showcase-title">${battle.title||'Учебный бой'}</h3>${battle.description?`<p class="training-description">${battle.description}</p>`:''}
    <div class="lesson-scene training-card">
    <div class="training-layout"><div class="showcase-field">
      <svg class="lesson-board showcase-board" viewBox="${minX} ${minY} ${width} ${height}" role="group" aria-label="${battle.title||'Учебный бой'}. 37 клеток. Север: ${counts[0]} фигур. Юг: ${counts[1]} фигур.">${defs}${tiles}<g id="training-overlays" pointer-events="none"><g clip-path="url(#training-field-clip)">${auras}</g>${reach.markup}</g><g id="training-units">${pieces}</g><g id="training-effects" pointer-events="none"><g class="attack-lines">${damageArrows}</g>${movement}${deathEffects}${guide}</g></svg>
      </div><aside class="lesson-details training-advice" id="training-advice" aria-label="Подсказка к учебному бою" aria-live="polite">${battle.reviewIndex !== null ? '<p class="training-history-note">Просмотр истории. Нажми →, чтобы вернуться к текущему ходу.</p>' : ''}${advice.map(text => `<p>${text}</p>`).join('')}${battle.sceneKey?'<div class="unit-demo-controls"><button class="button outline" type="button" data-showcase-action="restart">Вернуть исходную позицию</button></div>':''}</aside>
      ${battle.sceneKey?'':`<div class="board-footer training-controls"><div class="turn-actions">
        <button class="button subtle" type="button" tabindex="-1" data-showcase-action="undo" aria-label="Отменить учебный ход"${disabled(!battle.position.ply && !battle.presentation)}>${undoIcon}<span>Отменить ход</span></button>
        <button class="button subtle history-arrow" type="button" tabindex="-1" data-showcase-action="previous" aria-label="Показать предыдущий учебный ход"${disabled(battle.busy || viewedPly === 0)}>←</button>
        <button class="button subtle history-arrow" type="button" tabindex="-1" data-showcase-action="next" aria-label="Вернуться к текущему учебному ходу"${disabled(battle.busy || battle.reviewIndex === null)}>→</button>
      </div>${battle.position.winner !== null ? '<button class="button primary training-restart" type="button" data-showcase-action="restart">Сыграть ещё раз</button>' : ''}</div>`}
    </div></div></section>`;
  // All SVG references and update targets stay local when several battles share a page.
  return battle.sceneKey?markup.replace(/(id="|url\(#)training-/g,`$1${battle.sceneKey}-`).replaceAll('showcase-title',`${battle.sceneKey}-title`).replaceAll('hint-arrow-head',`${battle.sceneKey}-hint-arrow-head`):markup;
}
