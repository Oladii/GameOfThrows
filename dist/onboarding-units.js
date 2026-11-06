import { TYPES, LABELS, DEFAULT_CONFIG } from './rules.js';
import { clone, analyze, cells, auraReaches, shieldCanRetreat } from './engine.js';
import { createPositionLesson, renderMoveLesson } from './onboarding-examples.js';

const unitPiece = (id, type, team, q, r) => ({ id, type, team, q, r });

export function badgeExamples() {
  const config = clone(DEFAULT_CONFIG); config.geometry = 'hex'; config.size = 3;
  return [
    { label: 'Без угрозы', enemies: [], explanation: '15 стойкости, входящего урона нет.' },
    { label: 'Под огнём', enemies: [unitPiece('enemy', 'archer', 1, 0, 2)], explanation: '15 − 8 = 7. Красный бейдж предупреждает об угрозе.' },
    { label: 'Смертельный урон', enemies: [unitPiece('enemy', 'archer', 1, 0, 2), unitPiece('second', 'archer', 1, -2, 0)], explanation: '16 урона ≥ 15 стойкости. Фигура погибнет при расчёте.' }
  ].map(example => {
    const position = { pieces: [unitPiece('blue', 'shield', 0, 0, 0), ...example.enemies], turn: 0, ply: 0, winner: null };
    return { ...example, info: analyze(position, config).get('blue') };
  });
}

export function createUnitLesson(type, options = {}) {
  if (!TYPES.includes(type)) throw new Error('Неизвестная фигура учебного примера.');
  const support = type === 'attackLamp' || type === 'defenseLamp';
  const pieces = type === 'shield'
    ? [unitPiece('blue', type, 0, 0, 1), unitPiece('friend', 'defenseLamp', 0, 0, 0), unitPiece('enemy', 'archer', 1, 0, 3)]
    : type === 'archer'
      ? [unitPiece('blue', type, 0, -1, 1), unitPiece('enemy', 'defenseLamp', 1, 1, -2), unitPiece('wall', 'shield', 1, 1, 1)]
      : type === 'attackLamp'
        ? [unitPiece('blue', 'archer', 0, -1, 0), unitPiece('support', type, 0, 3, -3), unitPiece('enemy', 'archer', 1, 3, 0)]
        : [unitPiece('blue', 'shield', 0, 0, 0), unitPiece('support', type, 0, -2, -1), unitPiece('enemy', 'shield', 1, 1, 0)];
  const lesson = createPositionLesson(pieces, support ? 'support' : 'blue', options);
  Object.assign(lesson, { index: 20 + TYPES.indexOf(type), sceneKey: `unit-${type}`, unitType: type, title: LABELS[type] });
  const hero = lesson.report.get(lesson.moverId), ally = lesson.report.get('blue'), enemy = lesson.report.get('enemy');
  const source = lesson.previewPosition.pieces.find(piece => piece.id === lesson.moverId);
  lesson.auraMask = type === 'shield' || type === 'defenseLamp' ? 2 : 1;
  if (source && shieldCanRetreat(source, lesson.config)) lesson.auraMask = 3;
  lesson.auraCells = lesson.selected && source ? cells(lesson.config).filter(cell => auraReaches(source, cell, lesson.previewPosition, lesson.config)) : [];
  if (type === 'shield') {
    const friend = lesson.report.get('friend'), veteran = shieldCanRetreat(lesson.combatPosition.pieces.find(piece => piece.id === 'blue'), lesson.config);
    lesson.description = '<strong>Сила.</strong> Держит удар, закрывает союзников щитом и сражается вблизи.\n<strong>Слабость.</strong> До превращения в ветерана не умеет отступать. Уйдёт с линии — союзник останется под стрелами.\nВыбери броненосца. Подойди к лукарю, сохранив прикрытие знаменосца, или сравни с уходом вбок.';
    lesson.facts = [['Урон по знаменосцу', String(friend.incoming)], ['Урон по врагу', String(enemy.incoming)], ['Броненосец', veteran ? 'Ветеран' : 'Обычный воин']];
    lesson.feedback = friend.dead ? 'Щит больше не закрывает знаменосца: стрела его уничтожит.' : enemy.dead ? 'Броненосец достаёт лукаря, выдерживает его стрелу и сохраняет союзника за щитом.' : 'Знаменосец за щитом. Подойди ближе, чтобы броненосец достал лукаря.';
    if (veteran) lesson.feedback += ' На краю доски броненосец станет ветераном: бьёт сильнее и может ходить во всех направлениях.';
    lesson.hint = 'До противоположного края можно дойти и в этом примере. Но враг успеет выстрелить: проверь, кого ты оставляешь без прикрытия.';
  } else if (type === 'archer') {
    lesson.description = '<strong>Сила.</strong> Достаёт врага по прямой раньше, чем тот подойдёт вплотную.\n<strong>Слабость.</strong> Плохо держит удар, а вражеский щит перекрывает стрелу.\nВыбери лукаря. Найди выстрел по знаменосцу, сохранив расстояние до броненосца.';
    lesson.facts = [['Урон по знаменосцу', String(enemy.incoming)], ['Входящий урон по лукарю', String(hero.incoming)], ['Наш лукарь', hero.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = hero.dead ? 'Броненосец достаёт лукаря вблизи. Стрелы не спасут его от смертельного удара.' : enemy.dead ? 'Есть прямая линия: стрела уничтожит знаменосца, а броненосец до лукаря не достаёт.' : 'Знаменосец пока вне линии выстрела. Наведи на другую клетку и сравни прогноз.';
    lesson.hint = 'Для выстрела нужны прямая линия и достаточная дальность. Барабанщик усилит стрелы, броненосец прикроет от ответного огня.';
  } else if (type === 'attackLamp') {
    lesson.description = '<strong>Сила.</strong> Под барабан стрелы летят дальше и бьют сильнее.\n<strong>Слабость.</strong> Сам не держит обстрел и без ветерана не атакует.\nВыбери барабанщика. Усиль своего лукаря, оставаясь вне вражеского выстрела.';
    lesson.facts = [['Дальность лукаря', String(ally.range)], ['Урон по врагу', String(enemy.incoming)], ['Барабанщик', hero.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = hero.dead ? 'Барабанщик вышел под стрелу. Его аура не защищает его самого: он погибнет.' : enemy.dead ? 'Аура достигла союзника: теперь лукарь достаёт врага и уничтожит его.' : 'Аура ещё не помогает выстрелу. Подойди к союзнику и следи за красным бейджем барабанщика.';
    lesson.hint = 'Аура видна при выборе и в прогнозе хода. За оружие барабанщик берётся только рядом с ветераном — тот одолжит меч.';
  } else {
    lesson.description = '<strong>Сила.</strong> Вселяет уверенность в завтрашнем дне — союзники лучше держат удар.\n<strong>Слабость.</strong> Не защищает самого себя и без ветерана не атакует.\nВыбери знаменосца. Поставь его так, чтобы броненосец пережил удар врага; сравни с ходом за пределы ауры.';
    lesson.facts = [['Стойкость броненосца', String(ally.fortitude)], ['Входящий урон', String(ally.incoming)], ['Наш броненосец', ally.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = ally.dead ? 'Знамя не достаёт союзника. Броненосец нанесёт ответный удар, но сам тоже погибнет.' : 'Знамя усилило стойкость: броненосец переживёт удар и уничтожит врага.';
    lesson.hint = 'Знамя поддерживает союзников в своей ауре. Сам знаменосец берётся за оружие только рядом с ветераном.';
  }
  if (lesson.completed) {
    const fallen = lesson.deaths.map(piece => `${piece.team ? 'противник' : 'союзник'} — ${LABELS[piece.type].toLowerCase()}`);
    lesson.feedback = `Расчёт завершён. ${fallen.length ? 'Погибли: ' + fallen.join('; ') + '.' : 'Все фигуры выжили.'} Верни исходную позицию и сравни с другим ходом.`;
    lesson.facts = lesson.facts.map(([name, value]) => [name, value === 'Погибнет' ? 'Погиб' : value === 'Выживет' ? 'Выжил' : value]);
  } else if (!lesson.selected) lesson.feedback = 'Выбери синюю фигуру. Наведи на доступную клетку, чтобы увидеть её ауру и прогноз боя. Нажми, чтобы сделать ход.';
  return lesson;
}

export function renderUnitExamples(states, icons, renderBadges = () => '', animation = null) {
  const badges = `<section class="lesson-scene badge-guide" aria-labelledby="badge-guide-title"><div class="lesson-scene-heading"><h4 id="badge-guide-title">Значения на бейджах</h4><p><strong>Слева — сила атаки:</strong> сколько урона наносит фигура.<br><strong>Справа — стойкость с учётом угроз:</strong> сколько останется после ожидаемых ударов. Под огнём бейдж красный; при смертельном уроне вместо числа — череп.</p></div><div class="badge-examples">${badgeExamples().map(example => `<figure><svg viewBox="-38 -32 76 70" role="img" aria-label="${example.label}: атака ${example.info.damage}, ${example.explanation}"><g class="lesson-piece lesson-friendly${example.info.dead ? ' lesson-fatal' : ''}"><circle r="20"/><g class="lesson-piece-icon" transform="translate(-12,-12)">${icons.shield}</g>${renderBadges(example.info)}</g></svg><figcaption><strong>${example.label}</strong><span>${example.explanation}</span></figcaption></figure>`).join('')}</div><p class="badge-guide-note">Это прогноз, а не запас здоровья. После каждого хода стойкость и угрозы считаются заново: прошлый урон не накапливается.</p></section>`;
  return '<div class="lesson-page">' + badges + TYPES.map(type => {
    const sceneKey = `unit-${type}`;
    return renderMoveLesson(createUnitLesson(type, states[sceneKey] || {}), icons, renderBadges, animation?.sceneKey === sceneKey ? animation : null);
  }).join('') + '</div><p class="lesson-footnote">Четыре учебные позиции с игровыми параметрами. Выбор показывает ауру и доступные клетки; наведение — прогноз, нажатие — ход и расчёт боя. Текущая партия не меняется.</p>';
}
