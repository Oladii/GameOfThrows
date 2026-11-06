import { DEFAULT_CONFIG, LABELS } from './rules.js';
import { clone, cells, key, distance, reachable, movementPath, analyze, auraReaches, attacks, inspectCell, move, resolve } from './engine.js';
import { auraCircleMarkup, renderDeathEffects, renderMovingToken, unitAppearance, attackReachPresentation } from './board-presentation.js';

// Training models use relative team 0 for the player; show that army as the default South.
const lessonDisplayTeam = piece => 1 - piece.team;
export const MOVE_LESSONS = ['Маршруты', 'Ближний бой', 'Щит на пути', 'Достать до врага', 'Аура атаки', 'Аура защиты'];
const lessonPiece = (id, type, team, q, r) => ({ id, type, team, q, r });
const lessonPosition = pieces => ({ pieces, turn: 0, ply: 0, winner: null });
// Match the player's default view: the friendly army advances from bottom to top.
export const lessonPoint = cell => ({ x: 280 + 45 * cell.q, y: 205 - Math.sqrt(3) * 30 * (cell.r + cell.q / 2) });
export const lessonPolygonPoints = (p, rotation = 0) => {
  return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i + rotation); return `${(p.x + 30 * Math.cos(a)).toFixed(2)},${(p.y + 30 * Math.sin(a)).toFixed(2)}`; }).join(' ');
};
export const verticalLessonPoint = lessonPoint;
// Combat always uses the game's current default rules; only lesson one has a three-step training move.
export function createMoveLesson(index = 0, { advanced = false, selected = false, aura = 'attack', destination = null, placement = null, previewPlacement = null, shieldRemoved = false } = {}) {
  if (!selected && !advanced) destination = null;
  advanced = index === 4 ? Boolean(placement) : Boolean(advanced && destination);
  if (!selected) previewPlacement = null;
  const config = clone(DEFAULT_CONFIG); config.geometry = 'hex'; config.size = 3;
  const lesson = { index, advanced, selected, aura, placement, previewPlacement, shieldRemoved: index === 2 && shieldRemoved, supportLesson: index === 4, config, moverId: 'blue', sourceId: null, targetId: 'enemy', facts: [] };
  let pieces;
  if (index === 0) {
    config.stats.archer.move = 3;
    pieces = [lessonPiece('blue', 'archer', 0, -2, 0), lessonPiece('enemy', 'shield', 1, 0, 0), lessonPiece('friend', 'shield', 0, -2, 1)];
    lesson.title = 'Ходим по кратчайшему пути.';
    lesson.description = 'За один ход лукарь может пройти до трёх шагов.\nВыбери его, чтобы увидеть доступные клетки.\nСквозь врага пройти нельзя, сквозь союзника — можно: он пропустит.\nЗакончить ход на клетке, где уже стоит любая фишка, нельзя.';
    lesson.hint = 'Враг перекрывает путь. Союзник пропускает лукаря и остаётся на месте. Радиус поля — 3 клетки.';
  } else if (index === 1) {
    pieces = [lessonPiece('blue', 'shield', 0, 0, 0), lessonPiece('enemy', 'archer', 1, 0, 2)];
    lesson.title = 'Подойти, чтобы ударить';
    lesson.description = 'Выбери броненосца и наведи на доступную клетку. Найди позицию для удара вблизи, затем нажми на клетку, чтобы сделать ход.';
    lesson.hint = 'Нужно занять пустую клетку рядом с врагом. Щит ходит вперёд и вбок; на клетку противника вставать нельзя.';
  } else if (index === 2) {
    pieces = [lessonPiece('blue', 'archer', 0, -3, 0), lessonPiece('drummer', 'scoutLamp', 0, -3, 1), lessonPiece('wall', 'shield', 1, -1, 0), lessonPiece('enemy', 'archer', 1, 1, 0)];
    lesson.title = 'Щит закрывает тех, кто за ним';
    if (shieldRemoved) pieces = pieces.filter(piece => piece.id !== 'wall');
    lesson.description = 'Щит закрывает вражеского лукаря. Убери щитовика кнопкой и посмотри, кому теперь достанется стрела.';
    lesson.hint = 'Разведчик даёт нашему лукарю дальность до врага. Можно также выбрать лукаря и проверить другие позиции.';
  } else if (index === 3) {
    pieces = [lessonPiece('blue', 'archer', 0, -3, 0), lessonPiece('enemy', 'shield', 1, 2, 0)];
    lesson.title = 'Найди клетку, с которой достаёт стрела';
    lesson.description = 'Выбери лукаря и наведи на доступные клетки. Прогноз покажет, откуда стрела долетает до врага. Сделай ход нажатием.';
    lesson.hint = 'Для выстрела нужны и прямая линия, и достаточная дальность. Следи за прогнозом урона, а не только за расстоянием.';
  } else {
    const defensive = aura === 'defense';
    pieces = [lessonPiece('blue', defensive ? 'shield' : 'archer', 0, defensive ? 0 : -1, 0), lessonPiece('support', defensive ? 'defenseLamp' : 'attackLamp', 0, defensive ? -2 : 3, defensive ? -1 : -3), lessonPiece('enemy', defensive ? 'shield' : 'archer', 1, defensive ? 1 : 3, 0)];
    if (!defensive) pieces = [lessonPiece('blue','archer',0,-1,0),lessonPiece('support','attackLamp',0,3,-3),lessonPiece('guard','shield',0,-2,0),lessonPiece('enemy','archer',1,2,0),lessonPiece('flag','defenseLamp',1,2,-1)];
    lesson.moverId = 'support'; lesson.sourceId = 'support';
    lesson.title = defensive ? 'Под знаменем легче держать удар' : 'Под барабан стрелы становятся опаснее';
    lesson.description = defensive ? 'Выбери знаменосца. Поставь его так, чтобы его аура усилила броненосца и тот пережил удар врага.' : 'Выбери барабанщика. Поставь его так, чтобы его аура усилила лукаря и он смог уничтожить врага.';
    lesson.hint = `За ход ${defensive ? 'знаменосец' : 'барабанщик'} проходит до ${config.stats[defensive ? 'defenseLamp' : 'attackLamp'].move} клеток. После хода проходит расчёт боя. Аура усиливает только союзников и не действует на источник. Без ветерана поддержка не атакует.`;
  }
  lesson.before = lessonPosition(pieces);
  lesson.destination = index === 4 ? placement || previewPlacement : destination;
  const mover = pieces.find(piece => piece.id === lesson.moverId);
  lesson.path = lesson.destination ? movementPath(mover, lesson.before, config, lesson.destination) : [];
  if (lesson.destination && !lesson.path.length) throw new Error('Недоступная клетка учебного примера.');
  const moved = lesson.path.length ? inspectCell(lesson.before, config, lesson.destination, mover.id).position : null;
  lesson.combatPosition = moved || lesson.before;
  lesson.completed = advanced || lesson.shieldRemoved;
  const outcome = advanced ? move(lesson.before, config, mover.id, lesson.destination) : lesson.shieldRemoved ? resolve(lesson.before, config) : null;
  lesson.position = outcome ? outcome.state : clone(lesson.before);
  lesson.deaths = outcome?.deaths || [];
  lesson.isPreview = Boolean(selected && !lesson.completed && moved);
  lesson.previewPosition = lesson.isPreview ? clone(moved) : clone(lesson.position);
  lesson.beforeReport = analyze(lesson.before, config);
  lesson.report = outcome?.report || analyze(lesson.combatPosition, config);
  lesson.displayReport = lesson.completed ? analyze(lesson.position, config) : lesson.report;
  const moves = reachable(mover, lesson.before, config);
  lesson.available = selected && !lesson.completed ? moves : [];
  lesson.enemyBlocked = [];
  if (index === 0 && selected && !advanced) {
    const actual = new Set(moves.map(cell => key(cell.q, cell.r))), own = new Set(pieces.filter(piece => piece.team === 0).map(piece => key(piece.q, piece.r)));
    lesson.enemyBlocked = reachable(mover, { ...lesson.before, pieces: pieces.filter(piece => piece.team === 0) }, config).filter(cell => !actual.has(key(cell.q, cell.r)) && !own.has(key(cell.q, cell.r)));
  }
  lesson.passesAlly = lesson.path.slice(1, -1).some(cell => pieces.some(piece => piece.id !== mover.id && piece.team === 0 && piece.q === cell.q && piece.r === cell.r));
  const blue = lesson.combatPosition.pieces.find(piece => piece.id === 'blue'), enemy = lesson.combatPosition.pieces.find(piece => piece.id === 'enemy');
  const blueStats = lesson.report.get('blue'), enemyStats = lesson.report.get('enemy');
  lesson.canHit = attacks(blue, enemy, lesson.combatPosition, config);
  if (index === 0) {
    lesson.facts = [['Максимальный ход', `${config.stats.archer.move}`], ['Маршрут', destination ? `${lesson.path.length - 1} из ${config.stats.archer.move} шагов` : 'Не показан']];
    lesson.feedback = advanced ? lesson.passesAlly ? 'Лукарь прошёл сквозь союзника. Союзник остался на своей клетке.' : 'Лукарь занял выбранную клетку.' : destination ? lesson.passesAlly ? 'Маршрут проходит сквозь союзника. На его клетке останавливаться нельзя.' : 'Цифры считают шаги. Нажми на клетку, чтобы передвинуть лукаря.' : selected ? 'Наведи на зелёную клетку — появятся номера шагов. Нажатие сразу выполняет ход.' : 'Сначала выбери своего лукаря.';
  } else if (index === 1) {
    lesson.facts = [['Дальность броненосца', `${blueStats.range}`], ['Расстояние до врага', `${distance(blue, enemy, config)}`], ['Урон по лукарю', `${enemyStats.incoming}`]];
    lesson.feedback = enemyStats.incoming ? `Броненосец достаёт лукаря: ${enemyStats.incoming} урона. Лукарь ${enemyStats.dead ? 'погибнет' : 'выживет'} при расчёте.` : 'С этой клетки броненосец ещё не достаёт до лукаря.';
  } else if (index === 2) {
    lesson.facts = [['Урон по броненосцу', shieldRemoved ? 'Убран' : `${lesson.report.get('wall').incoming}`], ['Урон по лукарю за ним', `${enemyStats.incoming}`], ['Ответный урон по нашему лукарю', `${blueStats.incoming}`]];
    lesson.feedback = enemyStats.incoming ? `Стрела достигает вражеского лукаря: ${enemyStats.incoming} урона. Он ${enemyStats.dead ? 'погибнет' : 'выживет'}.` : lesson.report.get('wall')?.incoming ? 'Стрела попадает в броненосца. Щит перекрывает луч, и лукарь за ним не получает урона.' : 'С этой позиции стрела не достигает вражеского лукаря. Проверь направление и дальность.';
    lesson.feedback += blueStats.incoming ? ` Ответный урон — ${blueStats.incoming}: наш лукарь ${blueStats.dead ? 'погибнет' : 'выживет'}.` : ' Ответный выстрел до нашего лукаря не достаёт.';
  } else if (index === 3) {
    lesson.facts = [['Расстояние до врага', `${distance(blue, enemy, config)}`], ['Дальность лукаря', `${blueStats.range}`], ['Урон по врагу', `${enemyStats.incoming}`]];
    lesson.feedback = lesson.canHit ? `Враг в пределах выстрела: ${enemyStats.incoming} урона. Он ${enemyStats.dead ? 'погибнет' : 'выживет'} при расчёте.` : 'Лукарь не достаёт врага: нужна прямая линия в пределах дальности.';
  } else {
    const withoutSupport = analyze({ ...lesson.combatPosition, pieces: lesson.combatPosition.pieces.filter(piece => piece.id !== 'support') }, config).get('blue');
    const value = field => withoutSupport[field] === blueStats[field] ? `${blueStats[field]}` : `${withoutSupport[field]} → ${blueStats[field]}`;
    lesson.facts = aura === 'defense' ? [['Стойкость броненосца', value('fortitude')], ['Входящий урон', `${blueStats.incoming}`], ['После расчёта', blueStats.dead ? 'Погибнет' : 'Выживет']] : [['Урон лукаря', value('damage')], ['Дальность лукаря', value('range')], ['Урон по врагу', `${enemyStats.incoming}`], ['Вражеский лукарь', enemyStats.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = blueStats.sources.includes('support') ? aura === 'defense' ? `Знамя повышает стойкость до ${blueStats.fortitude}. При входящем уроне ${blueStats.incoming} броненосец ${blueStats.dead ? 'погибнет' : 'выживет'}.` : `Барабанщик добавляет ${blueStats.damage - withoutSupport.damage} к урону. ${enemyStats.incoming ? `Вражеский лукарь получает ${enemyStats.incoming} урона и ${enemyStats.dead ? 'погибнет' : 'выживет'}.` : 'Стрела пока не достигает вражеского лукаря.'}` : selected ? `Аура пока не достигает ${aura === 'defense' ? 'броненосца' : 'лукаря'}. Наведи на другую пустую клетку и сравни прогноз.` : aura === 'defense' ? `Без знамени броненосец ${blueStats.dead ? 'погибнет' : 'выживет'} при расчёте. Выбери знаменосца и найди место, где его аура защитит союзника.` : 'Выбери барабанщика, чтобы увидеть ауру и доступные места.';
    const source = lesson.previewPosition.pieces.find(piece => piece.id === 'support');
    lesson.auraCells = selected && source ? cells(config).filter(cell => auraReaches(source, cell, lesson.previewPosition, config)) : [];
  }
  if (lesson.completed) {
    const fallen = lesson.deaths.map(piece => `${piece.team ? 'противник' : 'союзник'} — ${LABELS[piece.type].toLowerCase()}`);
    lesson.feedback = `Расчёт завершён. ${fallen.length ? 'Погибли: ' + fallen.join('; ') + '.' : 'Все фигуры выжили.'} Верни исходную позицию, чтобы попробовать другой ход.`;
    lesson.facts = lesson.facts.map(([label, value]) => [label, value === 'Погибнет' ? 'Погиб' : value === 'Выживет' ? 'Выжил' : value]);
  } else if ((index === 1 || index === 3) && !selected) lesson.feedback = `Выбери ${index === 1 ? 'броненосца' : 'лукаря'}, наведи на доступную клетку и сравни прогноз. ${lesson.feedback}`;
  return lesson;
}

export function renderMoveLesson(lesson, icons, renderBadges = () => '', animation = null) {
  const sceneKey = lesson.sceneKey || (lesson.index === 4 ? `4-${lesson.aura}` : String(lesson.index));
  const titleId = `lesson-title-${sceneKey}`;
  const { index, config } = lesson;
  const point = lesson.point || lessonPoint;
  const polygon = cell => lessonPolygonPoints(point(cell), lesson.rotation || 0);
  const phase = animation?.phase || 'idle', busy = phase !== 'idle';
  const position = phase === 'movement' ? lesson.before : lesson.position;
  const displayReport = phase === 'movement' ? lesson.beforeReport : lesson.displayReport;
  const visiblePath = !busy && index === 0 && !lesson.completed ? lesson.path : [];
  const path = new Map(visiblePath.slice(1).map((c, i) => [key(c.q, c.r), i + 1]));
  const available = new Map((busy ? [] : lesson.available).map(c => [key(c.q, c.r), c.steps]));
  const showAura = index === 4 || lesson.auraMask !== undefined;
  const selectedId = lesson.selectedId || lesson.moverId;
  const auraSource = !busy && lesson.selected && showAura ? lesson.previewPosition.pieces.find(piece => piece.id === selectedId) : null;
  const auraMarkup = auraCircleMarkup(auraSource, lesson.previewPosition, config, point, Math.sqrt(3) * 30);
  const blocked = new Set(lesson.enemyBlocked.map(c => key(c.q, c.r)));
  const selectedUnit = !busy && lesson.selected ? position.pieces.find(piece => piece.id === selectedId) : null;
  const tiles = cells(config).map(cell => {
    const k = key(cell.q, cell.r), p = point(cell), number = path.get(k), clickable = available.has(k);
    return `<g class="lesson-tile${clickable ? ' lesson-available' : ''}${number ? ' lesson-route' : ''}${blocked.has(k) ? ' lesson-enemy-blocked' : ''}${selectedUnit && selectedUnit.q === cell.q && selectedUnit.r === cell.r ? ' lesson-unit-cell' : ''}" data-lesson-position="${k}"${clickable ? ` ${lesson.supportLesson ? 'data-lesson-place' : 'data-lesson-cell'}="${k}" role="button" tabindex="0" aria-label="${'Клетка ' + k + ', шагов до неё: ' + available.get(k)}"` : ''}><polygon points="${polygon(cell)}"/>${clickable && !number ? `<circle class="lesson-move-dot" cx="${p.x}" cy="${p.y}" r="3"/>` : ''}${blocked.has(k) && !position.pieces.some(piece => piece.q === cell.q && piece.r === cell.r) ? `<path class="lesson-blocked-cross" d="M${p.x - 4} ${p.y - 4}l8 8m-8 0 8-8"><title>Враг перекрыл путь</title></path>` : ''}</g>`;
  }).join('');
  const projected = lesson.previewPosition;
  const attackSource = lesson.unitType && selectedUnit ? projected.pieces.find(piece => piece.id === selectedId) : null;
  const attackMarkup = attackReachPresentation(attackSource, projected, config, {point, polygonPoints: lessonPolygonPoints({x:0,y:0}, lesson.rotation || 0), visiblePosition: position, displayTeam: attackSource && lessonDisplayTeam(attackSource)}).markup;
  const routeLine = visiblePath.length > 1 ? `<polyline class="lesson-path" points="${visiblePath.map(c => { const p = point(c); return `${p.x},${p.y}`; }).join(' ')}"/>` : '';
  const pieces = position.pieces.map(piece => {
    const p = point(piece), info = displayReport.get(piece.id), fatal = info.dead, appearance = unitAppearance(piece, config, icons, lessonDisplayTeam(piece));
    const selected = piece === selectedUnit, unitControl = !busy && (lesson.selectableIds || [lesson.moverId]).includes(piece.id);
    const unitLabel = LABELS[piece.type] + (appearance.veteran ? '-ветеран' : '');
    return `<g class="lesson-piece${appearance.veteran ? ' veteran' : ''}${phase === 'movement' && piece.id === lesson.moverId ? ' moving-origin' : ''} ${piece.team ? 'lesson-enemy' : 'lesson-friendly'}${fatal ? ' lesson-fatal' : ''}${selected ? ' lesson-unit-selected' : ''}${unitControl ? ' lesson-unit-control' : ''}${lesson.isPreview && piece.id === lesson.moverId ? ' lesson-preview-origin' : ''}" data-lesson-piece="${piece.id}"${selected ? ` data-lesson-selected-unit="${piece.id}"` : ''}${unitControl ? ` data-lesson-unit="${piece.id}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${selected ? 'Выбран: ' + unitLabel + '. Нажми, чтобы снять выбор' : 'Выбрать: ' + unitLabel}"` : ''} transform="translate(${p.x},${p.y})">${selected ? '<g class="lesson-selection-ring"><circle r="24"/></g>' : ''}<title>${piece.team ? 'Враг' : 'Союзник'}: ${LABELS[piece.type]}${appearance.veteran ? '-ветеран' : ''}${fatal ? ', погибнет при расчёте' : ''}</title><circle r="20"/><g class="lesson-piece-icon" transform="translate(-12,-12)">${appearance.icon}</g><g class="lesson-unit-badges">${renderBadges(info)}</g></g>`;
  }).join('');
  const projectedMover = projected.pieces.find(piece => piece.id === lesson.moverId), projectedPoint = projectedMover && point(projectedMover);
  const ghost = lesson.isPreview ? `<g class="lesson-preview-piece${unitAppearance(projectedMover, config, icons, lessonDisplayTeam(projectedMover)).veteran ? ' veteran' : ''}" transform="translate(${projectedPoint.x},${projectedPoint.y})"><circle r="20"/><g class="lesson-piece-icon" transform="translate(-12,-12)">${unitAppearance(projectedMover, config, icons, lessonDisplayTeam(projectedMover)).icon}</g><g class="lesson-unit-badges">${renderBadges(lesson.report.get(projectedMover.id))}</g></g>` : '';
  const numbers = visiblePath.slice(1).map((cell, i) => {
    const p = point(cell), occupied = projected.pieces.some(piece => piece.q === cell.q && piece.r === cell.r);
    return `<g class="lesson-path-number" transform="translate(${p.x + (occupied ? 19 : 0)},${p.y + (occupied ? -20 : 0)})"><circle r="11"/><text y=".35em">${i + 1}</text></g>`;
  }).join('');

  const movingPiece = phase === 'movement' ? lesson.before.pieces.find(piece => piece.id === lesson.moverId) : null;
  const effects = phase === 'deaths' ? `<g class="death-effects" aria-hidden="true">${renderDeathEffects(lesson.deaths, point, lessonPolygonPoints({ x: 0, y: 0 }, lesson.rotation || 0), icons, config, lessonDisplayTeam)}</g>` : '';
  const movingToken = movingPiece ? renderMovingToken(movingPiece, animation.frame || { ...point(movingPiece), progress: 0 }, icons, `lesson-moving-token-${sceneKey}`, config, lessonDisplayTeam(movingPiece)) : '';
  const feedback = phase === 'movement' ? 'Фигура движется по выбранному маршруту.' : phase === 'deaths' ? 'Расчёт боя: погибшие фигуры удаляются одновременно.' : lesson.feedback;
  const stateLabel = phase === 'movement' ? 'ДВИЖЕНИЕ' : phase === 'deaths' ? 'РАСЧЁТ БОЯ' : lesson.completed ? 'ПОСЛЕ РАСЧЁТА БОЯ' : lesson.isPreview ? 'ПРОГНОЗ · НАЖМИ НА КЛЕТКУ' : lesson.selected ? showAura ? 'АУРА ВЫДЕЛЕННОЙ ФИГУРЫ' : 'НАВЕДИ НА КЛЕТКУ' : index === 2 ? 'ЩИТ НА ПУТИ' : 'ВЫБЕРИ ФИГУРУ';
  const controls = (lesson.extraControls || '') + (index === 2 && !lesson.completed ? '<button class="button primary" data-lesson-action="remove-shield">Убрать щитовика</button>' : '') +
    '<button class="button outline" data-lesson-action="reset">Вернуть исходную позицию</button>';
  return `<section class="lesson-scene" data-lesson-scene="${sceneKey}" aria-labelledby="${titleId}"><div class="lesson-scene-heading">${lesson.unitType ? '' : `<p class="eyebrow">ПРИМЕР ${lesson.exampleNumber ?? (index === 4 && lesson.aura === 'defense' ? 6 : index + 1)} ИЗ ${lesson.exampleTotal ?? MOVE_LESSONS.length}${index === 4 ? lesson.aura === 'defense' ? ' · ЗАЩИТА' : ' · АТАКА' : ''}</p>`}<h4 id="${titleId}">${lesson.title}</h4>${lesson.description.split('\n').map(text => `<p>${text}</p>`).join('')}</div><div class="lesson-layout"><div class="lesson-field"><svg class="lesson-board" aria-busy="${busy}" viewBox="${lesson.viewBox || '70 10 420 390'}" role="group" aria-label="Учебная позиция: ${lesson.title}">${tiles}<g class="lesson-aura-circles">${auraMarkup}</g><g class="lesson-lines">${routeLine}</g>${pieces}<g class="lesson-ghost">${ghost}</g><g class="lesson-attack-reach" aria-hidden="true">${attackMarkup}</g><g class="lesson-numbers">${numbers}</g>${effects}${movingToken}</svg><p class="lesson-legend"><span><i></i> Ваши — Юг</span><span><i class="enemy"></i> Север</span>${index === 0 ? '<span>Цифры — шаги маршрута</span><span>× — враг перекрыл путь</span>' : '<span>Череп — погибнет при расчёте</span>'}</p></div><div class="lesson-details"><p class="lesson-state">${stateLabel}</p><dl>${lesson.facts.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="lesson-feedback" role="status">${feedback}</p>${controls}<p class="lesson-hint">${lesson.hint}</p></div></div></section>`;
}

export function renderMoveExamples(exampleStates, icons, renderBadges = () => '', animation = null) {
  const examples = [
    { index: 0, key: '0' }, { index: 1, key: '1' }, { index: 2, key: '2' }, { index: 3, key: '3' },
    { index: 4, key: '4-attack', aura: 'attack' }, { index: 4, key: '4-defense', aura: 'defense' }
  ];
  return '<div class="lesson-page">' + examples.map(example => {
    const state = exampleStates[example.key] || {};
    return renderMoveLesson(createMoveLesson(example.index, { advanced: state.advanced || false, selected: state.selected || false, destination: state.destination || null, placement: state.placement || null, previewPlacement: state.previewPlacement || null, shieldRemoved: state.shieldRemoved || false, aura: example.aura || 'attack' }), icons, renderBadges, animation?.sceneKey === example.key ? animation : null);
  }).join('') + '</div><p class="lesson-footnote">Учебные позиции: в первом примере лукарь ходит на 3 клетки, боевые параметры фигур — как в игре. Под фигурами — сила атаки и стойкость после ожидаемого урона, как в игре. Можно пробовать — ваша партия не изменится.</p>';
}

// A single legal move, forecast and simultaneous resolution for every new sandbox.
export function createPositionLesson(pieces, moverId, options = {}) {
  const { selected = false, advanced = false } = options;
  const destination = selected || advanced ? options.destination || null : null;
  const config = clone(DEFAULT_CONFIG); config.geometry = 'hex'; config.size = 3;
  const before = lessonPosition(pieces), mover = pieces.find(piece => piece.id === moverId);
  const path = destination ? movementPath(mover, before, config, destination) : [];
  if (destination && !path.length) throw new Error('Недоступная клетка учебного примера.');
  const completed = Boolean(advanced && destination), isPreview = Boolean(selected && !completed && destination);
  const inspected = destination ? inspectCell(before, config, destination, moverId) : null;
  const outcome = completed ? move(before, config, moverId, destination) : null;
  const position = outcome?.state || clone(before), beforeReport = analyze(before, config);
  const combatPosition = inspected?.position || before;
  const report = outcome?.report || inspected?.report || beforeReport;
  return { config, before, position, combatPosition, previewPosition: isPreview ? combatPosition : position,
    beforeReport, report, displayReport: completed ? analyze(position, config) : report,
    selected, advanced: completed, completed, isPreview, moverId, destination, path, deaths: outcome?.deaths || [],
    available: selected && !completed ? reachable(mover, before, config) : [], enemyBlocked: [] };
}

export function createCombatLesson(index, options = {}) {
  const pieces = index === 0
    ? [lessonPiece('blue', 'shield', 0, 0, 0), lessonPiece('enemy', 'archer', 1, 0, 2)]
    : index === 1
      ? [lessonPiece('blue', 'archer', 0, -2, -1), lessonPiece('enemy', 'shield', 1, 0, 0), ...(options.secondArcher === false ? [] : [lessonPiece('second', 'archer', 0, 0, -2)])]
      : [lessonPiece('blue', 'shield', 0, 0, 0), lessonPiece('enemy', 'shield', 1, 0, 2)];
  const lesson = createPositionLesson(pieces, 'blue', options);
  Object.assign(lesson, { index: 8 + index, exampleNumber: index + 1, exampleTotal: 3 });
  if (index !== 1) Object.assign(lesson, { point: verticalLessonPoint, rotation: 0, viewBox: '70 10 420 390' });
  const current = lesson.report.get('blue'), target = lesson.report.get('enemy');
  if (index === 0) {
    const initial = lesson.beforeReport.get('blue'), oldValue = initial.fortitude - initial.incoming;
    const value = current.fortitude - current.incoming;
    lesson.title = 'Выйди из-под обстрела';
    lesson.description = `Лукарь впереди держит броненосца под огнём. Бейдж стойкости справа подсвечивается красным: ${initial.fortitude} − ${initial.incoming} = ${oldValue}.\nВыбери броненосца и уведи его с линии выстрела. Наведи на доступную клетку, сравни прогноз и сделай ход нажатием.`;
    lesson.facts = [['Стойкость броненосца', String(current.fortitude)], ['Урон от лукаря', String(current.incoming)], ['Бейдж справа', value === oldValue ? String(value) : `${oldValue} → ${value}`]];
    lesson.feedback = current.incoming ? `Здесь лукарь достаёт: на бейдже ${value}. Отойди в сторону от линии выстрела.` : `Здесь лукарь не достаёт: бейдж показывает ${value} и больше не подсвечивается красным.`;
    lesson.hint = 'Число справа — стойкость за вычетом ожидаемого урона. После каждого хода оно считается заново; прошлый урон не сохраняется.';
  } else if (index === 1) {
    lesson.title = 'Урон складывается';
    lesson.description = 'До врага достаёт только лукарь справа. Его урона не хватает.\nВыбери лукаря слева и найди клетку, с которой он тоже достанет броненосца. Сделай ход — обе стрелы полетят автоматически.';
    lesson.facts = [['Суммарный урон по врагу', String(target.incoming)], ['Стойкость врага', String(target.fortitude)], ['Враг', target.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = target.dead ? `Оба лукаря достают врага. Их урон складывается: ${target.incoming} — этого хватает, чтобы уничтожить броненосца.` : `Враг получает ${target.incoming} урона при стойкости ${target.fortitude} и выживает. Нужна прямая линия для второго лукаря.`;
    lesson.extraControls = `<button class="button outline" data-lesson-action="toggle-archer">${options.secondArcher === false ? 'Вернуть второго лукаря' : 'Убрать второго лукаря'}</button>`;
    lesson.hint = 'Сравни ход с одним и двумя лукарями. Урон от нескольких врагов складывается в одном расчёте, но между ходами не накапливается.';
  } else {
    lesson.title = 'Атаки происходят одновременно';
    lesson.description = 'Броненосцы стоят по вертикали, через пустую клетку.\nПододвинь своего броненосца к врагу и посмотри, как они обменяются ударами.';
    lesson.facts = [['Урон по нашему броненосцу', String(current.incoming)], ['Урон по врагу', String(target.incoming)], ['Итог расчёта', current.dead && target.dead ? 'Оба погибнут' : 'Оба выживут']];
    lesson.feedback = current.dead && target.dead ? 'Каждый наносит смертельный удар. Оба погибнут одновременно: гибель не отменяет ответную атаку.' : 'Пока они не достают друг друга. Займи пустую клетку рядом с врагом.';
    lesson.hint = 'Сначала все фигуры атакуют, затем погибшие удаляются одновременно. В этом расчёте они ещё успевают ударить и усилить союзников.';
  }
  if (lesson.completed) {
    lesson.facts = lesson.facts.map(([name, value]) => [name, value.replace('погибнут', 'погибли').replace('выживут', 'выжили').replace('Погибнет', 'Погиб').replace('Выживет', 'Выжил')]);
    lesson.feedback = index === 2 && current.dead && target.dead ? 'Оба броненосца погибли одновременно. Каждый успел нанести ответный удар.' : lesson.feedback.replaceAll('погибнут', 'погибли');
    lesson.feedback += ' Верни исходную позицию, чтобы попробовать другой ход.';
  } else if (!lesson.selected) lesson.feedback = 'Выбери оранжевую фигуру, затем наведи на доступную клетку и сравни прогноз.';
  return lesson;
}

export function renderCombatExamples(states, icons, renderBadges = () => '', animation = null) {
  return '<div class="lesson-page">' + [0, 1, 2].map(index => {
    const sceneKey = String(8 + index);
    return renderMoveLesson(createCombatLesson(index, states[sceneKey] || {}), icons, renderBadges, animation?.sceneKey === sceneKey ? animation : null);
  }).join('') + '</div>';
}
