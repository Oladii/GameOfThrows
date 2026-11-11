import { TYPES, LABELS, DEFAULT_CONFIG } from './rules.js';
import { renderTokenBody } from './token-presentation.js';
import { clone, analyze, cells, auraReaches, shieldCanRetreat } from './engine.js';
import { createPositionLesson, renderMoveLesson, supportLessonPieces } from './onboarding-examples.js';

const unitPiece = (id, type, team, q, r) => ({ id, type, team, q, r });

export function badgeExamples() {
  const config = clone(DEFAULT_CONFIG); config.geometry = 'hex'; config.size = 3;
  return [
    { label: 'Без угрозы', enemies: [], explanation: `${config.stats.shield.fortitude} стойкости, входящего урона нет.` },
    { label: 'Под огнём', enemies: [unitPiece('enemy', 'archer', 1, 0, 2)], explanation: `Стойкость остаётся ${config.stats.shield.fortitude}; входящий урон ${config.stats.archer.damage} показан отдельно сверху. Прошлый урон не сохраняется.` },
    { label: 'Смертельный урон', enemies: [unitPiece('enemy', 'archer', 1, 0, 2), unitPiece('second', 'shield', 1, 1, 0)], explanation: 'Потенциальный урон равен стойкости или превышает её. Фигура погибнет в конце хода.' }
  ].map(example => {
    const position = { pieces: [unitPiece('blue', 'shield', 0, 0, 0), ...example.enemies], turn: 0, ply: 0, winner: null };
    return { ...example, info: analyze(position, config).get('blue') };
  });
}

export function createUnitLesson(type, options = {}) {
  if (!TYPES.includes(type)) throw new Error('Неизвестная фигура учебного примера.');
  const support = ['attackLamp','defenseLamp','scoutLamp'].includes(type);
  const pieces = type === 'shield'
    ? [unitPiece('blue', type, 0, 0, 1), { ...unitPiece('veteran', 'shield', 0, -1, 3), reachedFarEdge: true }, unitPiece('enemy', 'shield', 1, 1, 2),unitPiece('sideBow','archer',1,1,-1)]
    : type === 'archer'
      ? [unitPiece('blue', type, 0, -1, -1), unitPiece('enemy', 'defenseLamp', 1, 1, 1), unitPiece('wall', 'shield', 1, 1, -1),unitPiece('drum','attackLamp',0,-2,1)]
      : supportLessonPieces(type);
  const primaryId = support ? 'support' : 'blue';
  const selectableIds = type === 'shield' ? ['blue', 'veteran'] : [primaryId];
  const selectedId = options.selected && selectableIds.includes(options.selectedId) ? options.selectedId : primaryId;
  const moverId = options.advanced ? selectableIds.includes(options.movedId) ? options.movedId : primaryId : selectedId;
  const lesson = createPositionLesson(pieces, moverId, options);
  Object.assign(lesson, { index: 20 + TYPES.indexOf(type), sceneKey: `unit-${type}`, unitType: type, title: LABELS[type], selectableIds, selectedId: options.selected ? selectedId : null });
  const hero = lesson.report.get(primaryId), ally = lesson.report.get('blue'), enemy = lesson.report.get('enemy');
  const stats = lesson.config.stats[type], promotion = lesson.config.shieldPromotion;
  const source = lesson.previewPosition.pieces.find(piece => piece.id === selectedId);
  lesson.auraMask = type === 'shield' || type === 'defenseLamp' ? 2 : 1;
  if (source && shieldCanRetreat(source, lesson.config)) lesson.auraMask = 3;
  lesson.auraCells = lesson.selected && source ? cells(lesson.config).filter(cell => auraReaches(source, cell, lesson.previewPosition, lesson.config)) : [];
  if (type === 'shield') {
    const veteran = shieldCanRetreat(lesson.combatPosition.pieces.find(piece => piece.id === 'blue'), lesson.config);
    const veteranStats = lesson.report.get('veteran'), together = hero.sources.includes('veteran');
    lesson.description = [
      `Ходит на ${stats.move} ${stats.move === 1 ? 'клетку' : 'клетки'} вперёд и вбок. Атакует по прямой. Дальность: ${stats.range}.`,
      `Перекрывает вражеские стрелы. Аура даёт соседним союзным броненосцам +${stats.defenseBonus} стойкости.`,
      'На противоположном краю становится ветераном: получает усиление и может ходить назад.'
    ].join('\n');
    const withoutVeteran = analyze({ ...lesson.combatPosition, pieces: lesson.combatPosition.pieces.filter(piece => piece.id !== 'veteran') }, lesson.config).get('blue');
    const withoutShield = analyze({ ...lesson.combatPosition, pieces: lesson.combatPosition.pieces.filter(piece => piece.id !== 'blue') }, lesson.config).get('veteran');
    const comparison = (before, after) => before === after ? String(after) : `${before} → ${after}`;
    lesson.facts = [['Атака броненосца', comparison(withoutVeteran.damage, hero.damage)], ['Стойкость броненосца', comparison(withoutVeteran.fortitude, hero.fortitude)], ['Стойкость ветерана', comparison(withoutShield.fortitude, veteranStats.fortitude)], ['Урон по врагу', String(enemy.incoming)], ['Поддержка ветерана', together ? 'Действует' : 'Вне ауры']];
    lesson.feedback = hero.dead ? 'Здесь броненосец погибнет. Попробуй другую клетку.' : enemy.dead ? 'Броненосец переживёт удар и уничтожит врага.' : together ? 'Поддержка действует: атака и стойкость выросли.' : 'Подойди к ветерану и сравни силу атаки и стойкость.';
    if (veteran) lesson.feedback += ' Край достигнут — броненосец стал ветераном.';
    lesson.hint = 'Фигура в золотом венке — броненосец-ветеран. Её тоже можно выбрать.';
  } else if (type === 'archer') {
    lesson.description = [
      `Ходит до ${stats.move} клеток. Стреляет по прямой на ${stats.range} клетки.`,
      stats.aura > 0 && stats.damageBonus > 0 ? `Аура даёт соседним союзникам +${stats.damageBonus} урона.` : 'Не даёт ауру. Для совместного огня нужны другие лукари или поддержка.'
    ].join('\n');
    lesson.facts = [['Урон по врагу', String(enemy.incoming)], ['Входящий урон по лукарю', String(hero.incoming)], ['Наш лукарь', hero.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = hero.dead ? 'Здесь лукарь погибнет. Найди безопасную линию выстрела.' : enemy.dead ? 'Выстрел уничтожит врага. Лукарь выживет.' : 'Нет выстрела по цели. Попробуй другую клетку.';
    lesson.hint = 'Держи дистанцию. Вражеский щит перекрывает стрелы.';
  } else if (type === 'attackLamp' || type === 'scoutLamp') {
    lesson.description = [
      `Ходит до ${stats.move} клеток.`,
      `Аура радиуса ${stats.aura}: ${type === 'scoutLamp' ? '+' + stats.rangeBonus + ' к дальности' : '+' + stats.damageBonus + ' к урону'} союзников.`
    ].join('\n');
    lesson.facts = [['Дальность союзника', String(ally.range)], ['Урон по врагу', String(enemy.incoming)], [LABELS[type], hero.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = hero.dead ? 'Здесь фигура погибнет. Попробуй другую клетку.' : enemy.dead ? 'Усиление сработало: союзник уничтожит врага.' : 'Подойди к союзнику, чтобы усилить его.';
    lesson.hint = type === 'scoutLamp' ? 'Не увеличивает дальность броненосцев. Атакует только рядом с ветераном.' : 'Сам себя не усиливает. Атакует только рядом с ветераном.';
  } else {
    lesson.description = [
      `Ходит до ${stats.move} клеток.`,
      `Аура радиуса ${stats.aura}: +${stats.defenseBonus} к стойкости союзников.`
    ].join('\n');
    lesson.facts = [['Стойкость союзника', String(ally.fortitude)], ['Входящий урон', String(ally.incoming)], ['Союзник', ally.dead ? 'Погибнет' : 'Выживет']];
    lesson.feedback = ally.dead ? 'Аура не достаёт союзника — он погибнет.' : 'Защита действует: союзник переживёт удар.';
    lesson.hint = 'Сам себя не защищает. Атакует только рядом с ветераном.';
  }
  if (lesson.completed) {
    const fallen = lesson.deaths.map(piece => `${piece.team ? 'противник' : 'союзник'} — ${LABELS[piece.type].toLowerCase()}`);
    lesson.feedback = `Расчёт завершён. ${fallen.length ? 'Погибли: ' + fallen.join('; ') + '.' : 'Все фигуры выжили.'} Верни исходную позицию и сравни с другим ходом.`;
    lesson.facts = lesson.facts.map(([name, value]) => [name, value === 'Погибнет' ? 'Погиб' : value === 'Выживет' ? 'Выжил' : value]);
  } else if (!lesson.selected) lesson.feedback = type === 'shield' ? 'Выбери оранжевую фигуру <strong>со щитом.</strong> Подведи её к ветерану так, чтобы уничтожить врага и выжить. Наведи на клетку для прогноза, нажми — для хода.' : ({archer: 'Выбери оранжевую фигуру с луком. Найди клетку, с которой она уничтожит врага и выживет.', attackLamp: 'Выбери оранжевую фигуру с барабаном. Усиль союзника, чтобы его урона хватило для победы над врагом.', scoutLamp: 'Выбери оранжевую фигуру с биноклем. Увеличь дальность союзника, чтобы он достал врага.', defenseLamp: 'Выбери оранжевую фигуру с флагом. Прикрой союзника аурой, чтобы он пережил удар.'}[type]);
  if (type === 'shield' && lesson.selectedId === 'veteran') {
    const blueAlive = lesson.position.pieces.some(piece => piece.id === 'blue');
    const allied = promotion.allies ?? promotion;
    lesson.feedback = !blueAlive ? 'Броненосец погиб. Сбрось пример, чтобы попробовать снова.' : hero.sources.includes('veteran')
      ? `Поддержка действует: +${allied.damageBonus} к урону и +${allied.defenseBonus} к стойкости союзного броненосца.`
      : 'Подведи ветерана ближе, чтобы усилить союзника.';
  }
  return lesson;
}

export function renderUnitExamples(states, icons, renderBadges = () => '', animation = null) {
  const badges = `<section class="lesson-scene badge-guide" aria-labelledby="badge-guide-title"><div class="lesson-scene-heading"><h4 id="badge-guide-title">Значения на бейджах</h4><p><strong>Слева — сила атаки:</strong> сколько урона наносит фигура.<br><strong>Справа — полная стойкость:</strong> с усилениями союзников, без вычитания урона.<br><strong>Сверху — угроза:</strong> в покое мишень отмечает несмертельный обстрел; при выборе и наведении вместо неё показан входящий урон со знаком минус. Смертельная угроза всегда отмечена черепом сверху.</p></div><div class="badge-examples">${badgeExamples().map(example => `<figure><svg viewBox="-38 -32 76 70" role="img" aria-label="${example.label}: атака ${example.info.damage}, ${example.explanation}"><g class="lesson-piece lesson-friendly${example.info.dead ? ' lesson-fatal' : ''}">${renderTokenBody({type:'shield',icon:icons.shield,veteran:false},1)}${renderBadges(example.info, { showIncoming: true })}</g></svg><figcaption><strong>${example.label}</strong><span>${example.explanation}</span></figcaption></figure>`).join('')}</div><p class="badge-guide-note">Это прогноз, а не запас здоровья. После каждого хода стойкость и угрозы считаются заново: прошлый урон не накапливается.</p></section>`;
  return '<div class="lesson-page">' + badges + TYPES.map(type => {
    const sceneKey = `unit-${type}`;
    return renderMoveLesson(createUnitLesson(type, states[sceneKey] || {}), icons, renderBadges, animation?.sceneKey === sceneKey ? animation : null);
  }).join('') + '</div><p class="lesson-footnote">Пять учебных позиций с игровыми параметрами. Выбор показывает ауру и доступные клетки; наведение — прогноз, нажатие — ход и расчёт боя. Текущая партия не меняется.</p>';
}
