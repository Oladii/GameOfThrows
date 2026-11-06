import { DEFAULT_CONFIG, LABELS } from './rules.js';
import { clone, cells, key, distance, reachable, movementPath, analyze, auraReaches, attacks } from './engine.js';

export const MOVE_LESSONS = ['Маршруты', 'Ближний бой', 'Щит на пути', 'Достать до врага', 'Аура атаки', 'Аура защиты'];
const lessonPiece = (id, type, team, q, r) => ({ id, type, team, q, r });
const lessonPosition = pieces => ({ pieces, turn: 0, ply: 0, winner: null });
const lessonPoint = cell => ({ x: 280 + Math.sqrt(3) * 30 * (cell.q + cell.r / 2), y: 205 + 45 * cell.r });
const lessonPolygon = cell => {
  const p = lessonPoint(cell);
  return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 180 * (60 * i - 30); return `${(p.x + 30 * Math.cos(a)).toFixed(2)},${(p.y + 30 * Math.sin(a)).toFixed(2)}`; }).join(' ');
};

// These small positions always use the standard rules, independently of the live game.
export function createMoveLesson(index = 0, { advanced = false, selected = false, aura = 'attack', destination = null, placement = null } = {}) {
  if (index === 0 && !selected && !advanced) destination = null;
  if (index === 0 && !destination) advanced = false;
  if (index === 4) advanced = false;
  const config = clone(DEFAULT_CONFIG); config.geometry = 'hex'; config.size = 3;
  const lesson = { index, advanced, selected, aura, placement, placementMode: index === 4, config, moverId: 'blue', attackerId: 'blue', targetId: 'enemy', facts: [], hint: '', action: 'Показать ход' };
  let pieces;
  if (index === 0) {
    config.stats.archer.move = 3;
    pieces = [lessonPiece('blue', 'archer', 0, -2, 0), lessonPiece('enemy', 'shield', 1, 0, 0), lessonPiece('friend', 'shield', 0, -2, 1)];
    lesson.destination = destination;
    lesson.title = 'Ходим по кратчайшему пути.';
    lesson.description = 'За один ход лукарь может пройти до трёх шагов.\nВыбери его, чтобы увидеть доступные клетки.\nСквозь врага пройти нельзя, сквозь союзника — можно: он пропустит.\nЗакончить ход на клетке, где уже стоит любая фишка, нельзя.';
    lesson.hint = 'Враг справа перекрывает путь: через его клетку пройти нельзя. Союзник ниже пропускает лукаря и остаётся на своей клетке. Радиус поля — 3 клетки.';
  } else if (index === 1) {
    pieces = [lessonPiece('blue', 'shield', 0, 0, 0), lessonPiece('enemy', 'archer', 1, 2, 0)];
    lesson.destination = { q: 1, r: 0 };
    lesson.title = 'Подойти, чтобы ударить';
    lesson.description = 'Броненосец бьёт на соседнюю клетку. Подвиньте его ближе — после хода он сам атакует лукаря.';
    lesson.hint = 'На клетку врага вставать не нужно. Вы занимаете пустую клетку, а бой рассчитывается после перемещения.';
    lesson.action = 'Подойти в упор';
  } else if (index === 2) {
    pieces = [lessonPiece('blue', 'archer', 0, -3, 0), lessonPiece('drummer', 'attackLamp', 0, -3, 1), lessonPiece('wall', 'shield', 1, 0, 0), lessonPiece('enemy', 'archer', 1, 1, 0)];
    lesson.title = 'Щит закрывает тех, кто за ним';
    lesson.description = 'Барабанщик усиливает нашего лукаря. Вражеский броненосец стоит на линии выстрела — сравните, куда попадёт стрела со щитом и без него.';
    lesson.hint = `С барабанщиком наш лукарь стреляет на ${config.stats.archer.range + config.stats.attackLamp.rangeBonus} клетки, враг — на ${config.stats.archer.range}: ответная стрела не достаёт. Броненосец перекрывает луч к лукарю за ним.`;
    lesson.action = 'Сравнить без щита';
  } else if (index === 3) {
    pieces = [lessonPiece('blue', 'archer', 0, -3, 0), lessonPiece('enemy', 'shield', 1, 2, 0)];
    lesson.destination = { q: -1, r: 0 };
    lesson.title = 'Найдите клетку, с которой достаёт стрела';
    lesson.description = 'Враг стоит на прямой линии, но слишком далеко. Подвиньте лукаря на две клетки вперёд.';
    lesson.hint = 'Для выстрела нужны и подходящее направление, и достаточная дальность. Само по себе сближение не гарантирует попадания.';
    lesson.action = 'Подвинуть лукаря';
  } else {
    const defensive = aura === 'defense';
    const at = placement || { q: -2, r: 1 };
    if (!cells(config).some(cell => cell.q === at.q && cell.r === at.r) || at.q === 0 && at.r === 0 || at.q === 3 && at.r === 0) throw new Error('Поставить поддержку можно только на пустую клетку поля.');
    pieces = [lessonPiece('blue', 'archer', 0, 0, 0), lessonPiece('support', defensive ? 'defenseLamp' : 'attackLamp', 0, at.q, at.r), lessonPiece('enemy', defensive ? 'archer' : 'shield', 1, 3, 0)];
    lesson.moverId = 'support'; lesson.sourceId = 'support';
    lesson.title = defensive ? 'Под знаменем легче держать удар' : 'Под барабан стрелы становятся опаснее';
    lesson.description = defensive ? 'Выбери знаменосца, чтобы увидеть его ауру. В этом примере можно свободно переставлять его на пустые клетки. Найди позицию, где стойкость лукаря вырастет. Сравни её с уроном врага: одной ауры может не хватить.' : 'Выбери барабанщика, чтобы увидеть его ауру. В этом примере можно свободно переставлять его на пустые клетки. Найди позицию, где он усилит лукаря.';
    lesson.hint = 'Цветные клетки — аура: она идёт по прямым лучам и усиливает только союзников. Своей аурой фигура себя не усиливает. Здесь нет ветерана, поэтому сама поддержка не атакует.';
  }
  lesson.before = lessonPosition(pieces);
  const mover = pieces.find(p => p.id === lesson.moverId);
  lesson.path = lesson.destination ? movementPath(mover, lesson.before, config, lesson.destination) : [];
  if (lesson.destination && !lesson.path.length) throw new Error('Недоступная клетка учебного примера.');
  lesson.position = clone(lesson.before);
  if (advanced && lesson.destination) Object.assign(lesson.position.pieces.find(p => p.id === mover.id), lesson.destination);
  if (advanced && index === 2) lesson.position.pieces = lesson.position.pieces.filter(p => p.id !== 'wall');
  lesson.report = analyze(lesson.position, config);
  lesson.beforeReport = analyze(lesson.before, config);
  const available = index === 0 ? reachable(mover, lesson.before, config) : [];
  lesson.available = index === 4 && selected ? cells(config).filter(cell => !pieces.some(piece => piece.q === cell.q && piece.r === cell.r)) : !advanced && selected ? available : [];
  lesson.enemyBlocked = [];
  if (index === 0) {
    const actual = new Set(available.map(cell => key(cell.q, cell.r)));
    const occupied = new Set(pieces.filter(piece => piece.team === mover.team).map(piece => key(piece.q, piece.r)));
    const withoutEnemy = { ...lesson.before, pieces: pieces.filter(piece => piece.team === mover.team) };
    lesson.enemyBlocked = !advanced && selected ? reachable(mover, withoutEnemy, config).filter(cell => !actual.has(key(cell.q, cell.r)) && !occupied.has(key(cell.q, cell.r))) : [];
    lesson.passesAlly = lesson.path.slice(1, -1).some(cell => pieces.some(piece => piece.id !== mover.id && piece.team === mover.team && piece.q === cell.q && piece.r === cell.r));
  }
  const blue = lesson.position.pieces.find(p => p.id === 'blue'), blueStats = lesson.report.get('blue');
  const enemy = lesson.position.pieces.find(p => p.id === 'enemy'), enemyStats = lesson.report.get('enemy');
  if (index === 0) {
    const steps = Math.max(0, lesson.path.length - 1);
    lesson.facts = [['Максимальный ход', `${config.stats.archer.move}`], ['Маршрут', destination ? `${steps} из ${config.stats.archer.move} шагов` : 'Не показан']];
    lesson.feedback = !selected && !advanced ? 'Сначала нажмите на синего лукаря — появятся доступные клетки.' : !destination ? 'Наведи на доступную клетку, чтобы увидеть маршрут. Нажми на неё, чтобы передвинуть лукаря.' : advanced ? lesson.passesAlly ? 'Лукарь прошёл сквозь союзника. Союзник остался на месте, а лукарь занял пустую клетку.' : 'Лукарь занял выбранную клетку. За один ход передвигается одна фигура.' : lesson.passesAlly ? 'Кратчайший путь проходит сквозь союзника. Он пропускает лукаря, но на его клетке останавливаться нельзя.' : 'Цифры считают пройденные клетки. Стартовая клетка в ход не входит.';
  } else if (index === 1) {
    lesson.facts = [['Дальность броненосца', `${blueStats.range} клетка`], ['Урон по лукарю', `${enemyStats.incoming}`]];
    lesson.feedback = advanced ? 'Враг на соседней клетке: броненосец наносит удар. Череп показывает, что лукарь погибнет при расчёте.' : 'Между фигурами ещё есть пустая клетка. Ближняя атака не достаёт до лукаря.';
  } else if (index === 2) {
    lesson.facts = [['Урон по броненосцу', advanced ? 'Щита нет' : `${lesson.report.get('wall').incoming}`], ['Урон по лукарю за ним', `${enemyStats.incoming}`], ['Ответный урон по нашему лукарю', `${blueStats.incoming}`]];
    lesson.feedback = advanced ? 'Без щита усиленная стрела доходит до вражеского лукаря. Он погибнет, а наш лукарь остаётся вне дальности ответного выстрела.' : 'Усиленная стрела поражает броненосца. Он погибнет, но в этом расчёте ещё закрывает лукаря за собой. Наш лукарь слишком далеко для ответного выстрела.';
  } else if (index === 3) {
    lesson.facts = [['Расстояние до врага', `${distance(blue, enemy, config)}`], ['Дальность лукаря', `${blueStats.range} клетки`], ['Урон по врагу', `${enemyStats.incoming}`]];
    lesson.feedback = advanced ? 'После двух шагов враг попал в дальность выстрела. Стрела наносит ему урон, но этого пока недостаточно для гибели.' : 'До врага 6 клеток, а стрела летит только на 4. На этой позиции лукарь ещё не достаёт.';
  } else {
    const previous = analyze({ ...lesson.position, pieces: lesson.position.pieces.filter(piece => piece.id !== lesson.sourceId) }, config).get('blue');
    const value = field => previous[field] !== blueStats[field] ? `${previous[field]} → ${blueStats[field]}` : `${blueStats[field]}`;
    lesson.facts = aura === 'defense' ? [['Стойкость лукаря', value('fortitude')], ['Входящий урон', `${blueStats.incoming}`], ['После расчёта', blueStats.dead ? 'Погибнет' : 'Выживет']] : [['Урон лукаря', value('damage')], ['Дальность лукаря', value('range')], ['Урон по врагу', `${enemyStats.incoming}`]];
    lesson.feedback = blueStats.sources.includes(lesson.sourceId) ? aura === 'defense' ? 'Знаменосец добавил стойкости. Теперь лукарь выдерживает ответную стрелу и выживает.' : 'Барабанщик усилил лукаря: +2 к урону и +1 к дальности. Теперь выстрел пробивает защиту врага.' : !selected ? `Выбери ${aura === 'defense' ? 'знаменосца' : 'барабанщика'} — появится его аура. Затем нажми на пустую клетку, чтобы поставить его туда.` : 'Лучи поддержки не доходят до лукаря. Переставь фигуру на пустую клетку и посмотри, как изменится усиление.';
    const source = lesson.position.pieces.find(p => p.id === lesson.sourceId);
    lesson.auraCells = selected ? cells(config).filter(cell => auraReaches(source, cell, lesson.position, config)) : [];
  }
  lesson.canHit = enemy ? attacks(blue, enemy, lesson.position, config) : false;
  return lesson;
}

export function renderMoveLesson(lesson, icons, renderBadges = () => '') {
  const sceneKey = lesson.index === 4 ? `4-${lesson.aura}` : String(lesson.index);
  const titleId = `lesson-title-${sceneKey}`, markerId = `lesson-arrow-${sceneKey}`;
  const { index, config, position, advanced } = lesson;
  const visiblePath = index === 0 && advanced ? [] : lesson.path;
  const path = new Map(visiblePath.slice(1).map((c, i) => [key(c.q, c.r), i + 1]));
  const available = new Map(lesson.available.map(c => [key(c.q, c.r), c.steps]));
  const aura = new Set((lesson.auraCells || []).map(c => key(c.q, c.r)));
  const blocked = new Set(lesson.enemyBlocked.map(c => key(c.q, c.r)));
  const selectedUnit = (index === 0 || index === 4) && lesson.selected && !advanced ? position.pieces.find(piece => piece.id === lesson.moverId) : null;
  const tiles = cells(config).map(cell => {
    const k = key(cell.q, cell.r), p = lessonPoint(cell), number = path.get(k), clickable = available.has(k);
    return `<g class="lesson-tile${clickable ? lesson.placementMode ? ' lesson-placeable' : ' lesson-available' : ''}${number ? ' lesson-route' : ''}${blocked.has(k) ? ' lesson-enemy-blocked' : ''}${selectedUnit && selectedUnit.q === cell.q && selectedUnit.r === cell.r ? ' lesson-unit-cell' : ''}${aura.has(k) ? lesson.aura === 'defense' ? ' lesson-defense-aura' : ' lesson-attack-aura' : ''}" data-lesson-position="${k}"${clickable ? ` ${lesson.placementMode ? 'data-lesson-place' : 'data-lesson-cell'}="${k}" role="button" tabindex="0" aria-label="${lesson.placementMode ? 'Поставить поддержку на пустую клетку ' + k : 'Клетка ' + k + ', шагов до неё: ' + available.get(k)}"` : ''}><polygon points="${lessonPolygon(cell)}"/>${clickable && !lesson.placementMode && !number ? `<circle class="lesson-move-dot" cx="${p.x}" cy="${p.y}" r="3"/>` : ''}${blocked.has(k) ? `<path class="lesson-blocked-cross" transform="${position.pieces.some(piece => piece.q === cell.q && piece.r === cell.r) ? 'translate(19,-20)' : ''}" d="M${p.x - 4} ${p.y - 4}l8 8m-8 0 8-8"><title>Враг перекрыл путь</title></path>` : ''}</g>`;
  }).join('');
  const line = (a, b, className) => {
    const p = lessonPoint(a), q = lessonPoint(b), length = Math.hypot(q.x - p.x, q.y - p.y), trim = Math.min(22, length / 3);
    const dx = (q.x - p.x) / length, dy = (q.y - p.y) / length;
    return `<line class="${className}" x1="${p.x + dx * trim}" y1="${p.y + dy * trim}" x2="${q.x - dx * trim}" y2="${q.y - dy * trim}" marker-end="url(#${markerId})"/>`;
  };
  let rays = '';
  const blue = position.pieces.find(p => p.id === 'blue'), enemy = position.pieces.find(p => p.id === 'enemy');
  if (index !== 0 && lesson.canHit) rays += line(blue, enemy, 'lesson-shot');
  if (index === 2 && !advanced) {
    const wall = position.pieces.find(p => p.id === 'wall');
    rays += line(blue, wall, 'lesson-shot') + line(wall, enemy, 'lesson-blocked-shot');
  }
  if (index === 4 && lesson.aura === 'defense' && attacks(enemy, blue, position, config)) rays += line(enemy, blue, 'lesson-enemy-shot');
  if (index === 4 && lesson.selected && lesson.report.get('blue').sources.includes(lesson.sourceId)) rays += line(position.pieces.find(p => p.id === 'support'), blue, 'lesson-aura-link');
  const routeLine = visiblePath.length > 1 ? `<polyline class="lesson-path" points="${visiblePath.map(c => { const p = lessonPoint(c); return `${p.x},${p.y}`; }).join(' ')}"/>` : '';
  const pieces = position.pieces.map(piece => {
    const p = lessonPoint(piece), info = lesson.report.get(piece.id), fatal = index !== 0 && info.dead;
    const selected = piece === selectedUnit, unitControl = (index === 0 || index === 4) && !advanced && piece.id === lesson.moverId;
    return `<g class="lesson-piece ${piece.team ? 'lesson-enemy' : 'lesson-friendly'}${fatal ? ' lesson-fatal' : ''}${selected ? ' lesson-unit-selected' : ''}${unitControl ? ' lesson-unit-control' : ''}"${selected ? ` data-lesson-selected-unit="${piece.id}"` : ''}${unitControl ? ` data-lesson-unit="${piece.id}" role="button" tabindex="0" aria-pressed="${selected}" aria-label="${selected ? 'Выбран: ' + LABELS[piece.type] + '. Нажми, чтобы снять выбор' : 'Выбрать: ' + LABELS[piece.type]}"` : ''} transform="translate(${p.x},${p.y})">${selected ? '<g class="lesson-selection-ring"><circle r="24"/></g>' : ''}<title>${piece.team ? 'Враг' : 'Союзник'}: ${LABELS[piece.type]}${fatal ? ', погибнет при расчёте' : ''}</title><circle r="20"/><g class="lesson-piece-icon" transform="translate(-12,-12)">${icons[piece.type]}</g><g class="lesson-unit-badges">${renderBadges(info)}</g></g>`;
  }).join('');
  const numbers = visiblePath.slice(1).map((cell, i) => {
    const p = lessonPoint(cell), occupied = position.pieces.some(piece => piece.q === cell.q && piece.r === cell.r);
    return `<g class="lesson-path-number" transform="translate(${p.x + (occupied ? 19 : 0)},${p.y + (occupied ? -20 : 0)})"><circle r="11"/><text y=".35em">${i + 1}</text></g>`;
  }).join('');

  const controls = index === 4 ? lesson.selected || lesson.placement ? '<button class="button outline" data-lesson-action="reset">Вернуть исходную позицию</button>' : '' : index === 0 && !advanced ? '' : `<button class="button ${advanced ? 'outline' : 'primary'}" data-lesson-action="${advanced ? 'reset' : 'advance'}">${advanced ? 'Вернуть исходную позицию' : lesson.action}</button>`;
  return `<section class="lesson-scene" data-lesson-scene="${sceneKey}" aria-labelledby="${titleId}"><div class="lesson-scene-heading"><p class="eyebrow">ПРИМЕР ${index === 4 && lesson.aura === 'defense' ? 6 : index + 1} ИЗ ${MOVE_LESSONS.length}${index === 4 ? lesson.aura === 'defense' ? ' · ЗАЩИТА' : ' · АТАКА' : ''}</p><h4 id="${titleId}">${lesson.title}</h4>${lesson.description.split('\n').map(text => `<p>${text}</p>`).join('')}</div><div class="lesson-layout"><div class="lesson-field"><svg class="lesson-board" viewBox="70 25 420 360" role="group" aria-label="Учебная позиция: ${lesson.title}"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="context-stroke"/></marker></defs>${tiles}<g class="lesson-lines">${routeLine}${rays}</g>${pieces}<g class="lesson-numbers">${numbers}</g></svg><p class="lesson-legend"><span><i></i> Ваши фигуры</span><span><i class="enemy"></i> Противник</span>${index === 0 ? '<span>Цифры — шаги маршрута</span><span>× — враг перекрыл путь</span>' : '<span>Череп — погибнет при расчёте</span>'}</p></div><div class="lesson-details"><p class="lesson-state">${index === 4 ? lesson.selected ? 'АУРА ВЫДЕЛЕННОЙ ФИГУРЫ' : lesson.aura === 'defense' ? 'ВЫБЕРИ ЗНАМЕНОСЦА' : 'ВЫБЕРИ БАРАБАНЩИКА' : index === 0 ? advanced ? 'ПОСЛЕ ПЕРЕМЕЩЕНИЯ' : lesson.selected ? lesson.destination ? 'ПРОГНОЗ МАРШРУТА' : 'НАВЕДИ НА КЛЕТКУ' : 'ВЫБЕРИТЕ ЛУКАРЯ' : index === 2 ? advanced ? 'БЕЗ ЩИТА' : 'СО ЩИТОМ' : advanced ? 'ПРОГНОЗ ПОСЛЕ ХОДА' : 'ПРОГНОЗ ДО ХОДА'}</p><dl>${lesson.facts.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="lesson-feedback" role="status">${lesson.feedback}</p>${controls}<p class="lesson-hint">${lesson.hint}</p></div></div></section>`;
}

export function renderMoveExamples(exampleStates, icons, renderBadges = () => '') {
  const examples = [
    { index: 0, key: '0' }, { index: 1, key: '1' }, { index: 2, key: '2' }, { index: 3, key: '3' },
    { index: 4, key: '4-attack', aura: 'attack' }, { index: 4, key: '4-defense', aura: 'defense' }
  ];
  return '<div class="lesson-page">' + examples.map(example => {
    const state = exampleStates[example.key] || {};
    return renderMoveLesson(createMoveLesson(example.index, { advanced: state.advanced || false, selected: state.selected || false, destination: state.destination || null, placement: state.placement || null, aura: example.aura || 'attack' }), icons, renderBadges);
  }).join('') + '</div><p class="lesson-footnote">Учебные позиции: в первом примере лукарь ходит на 3 клетки, боевые параметры фигур — как в игре. Под фигурами — сила атаки и стойкость после ожидаемого урона, как в игре. Можно пробовать — ваша партия не изменится.</p>';
}
