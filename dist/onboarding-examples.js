import { DEFAULT_CONFIG, LABELS } from './rules.js';
import { renderTokenBody } from './token-presentation.js';
import { clone, cells, key, distance, reachable, movementPath, analyze, auraReaches, attacks, inspectCell, move, resolve } from './engine.js';
import { auraCircleMarkup, renderDeathEffects, renderMovingToken, unitAppearance, attackReachPresentation } from './board-presentation.js';

// The isolated player's native team0 is displayed as the familiar orange South.
const lessonDisplayTeam = piece => 1 - piece.team;
export const MOVE_LESSONS = ['Маршрут под барабаном', 'Ближний бой', 'Щит на пути', 'Дальность выстрела', 'Горн усиливает атаку', 'Знамя защищает'];
const lessonPiece = (id, type, team, q, r) => ({ id, type, team, q, r });
const lessonPosition = pieces => ({ pieces: clone(pieces), turn: 0, ply: 0, winner: null });
const trainingHint = 'Учебная цель на отдельном поле: здесь проверяется приём, а не победа полной армии. Текущая партия не меняется.';
export const lessonPoint = cell => ({ x: 280 + 45 * cell.q, y: 205 - Math.sqrt(3) * 30 * (cell.r + cell.q / 2) });
export const verticalLessonPoint = lessonPoint;
export const lessonPolygonPoints = (p, rotation = 0) => Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 180 * (60 * i + rotation);return `${(p.x + 30 * Math.cos(a)).toFixed(2)},${(p.y + 30 * Math.sin(a)).toFixed(2)}`;
}).join(' ');

// All combat and aura numbers come from the current game. Only the compact
// board and the isolated exercise's ending condition differ from a full match.
export function createPositionLesson(pieces, moverId, options = {}) {
  const { selected = false, advanced = false } = options;
  const destination = selected || advanced ? options.destination || null : null;
  const config = clone(DEFAULT_CONFIG);config.geometry = 'hex';config.size = 3;
  if (!options.matchRules) config.victoryCondition = 'all-units';
  const before = lessonPosition(pieces), mover = before.pieces.find(piece => piece.id === moverId);
  const path = destination ? movementPath(mover, before, config, destination) : [];
  if (destination && !path.length) throw new Error('Недоступная клетка учебного примера.');
  const completed = Boolean(advanced && destination), isPreview = Boolean(selected && !completed && destination);
  const inspected = destination ? inspectCell(before, config, destination, moverId) : null;
  const outcome = completed ? move(before, config, moverId, destination) : null;
  const position = outcome?.state || clone(before), beforeReport = analyze(before, config), combatPosition = inspected?.position || before;
  const report = outcome?.report || inspected?.report || beforeReport;
  return { config, before, position, combatPosition, previewPosition: isPreview ? combatPosition : position,
    beforeReport, report, displayReport: completed ? analyze(position, config) : report,
    selected, advanced: completed, completed, isPreview, moverId, destination, path, deaths: outcome?.deaths || [],
    available: selected && !completed ? reachable(mover, before, config) : [], enemyBlocked: [], matchRules: Boolean(options.matchRules) };
}

export function supportLessonPieces(type) {
  if(type==='attackLamp')return [lessonPiece('blue','archer',0,1,0),lessonPiece('support',type,0,-2,-1),lessonPiece('enemy','archer',1,3,0)];
  if(type==='horn')return [lessonPiece('blue','archer',0,0,0),lessonPiece('support',type,0,-2,-1),lessonPiece('enemy','archer',1,3,0)];
  if(type==='scoutLamp')return [lessonPiece('blue','archer',0,-1,1),lessonPiece('support',type,0,0,-1),lessonPiece('enemy','archer',1,1,1)];
  return [lessonPiece('blue','archer',0,1,0),lessonPiece('support','defenseLamp',0,-3,1),lessonPiece('enemy','scoutLamp',1,2,0)];
}

// Read-only metadata lets tests and the UI explain a reproducible legal move.
export function finishLessonGoal(lesson, { objective, destination, met, instruction, feedback, hint }) {
  lesson.objective=objective;lesson.solution=[{id:lesson.moverId,to:{...destination}}];lesson.previewSuccess=Boolean(met);lesson.success=Boolean(lesson.completed&&met);
  lesson.feedback=lesson.completed ? `${lesson.success?'Цель выполнена.':'Ход выполнен, но цель ещё не достигнута.'} ${feedback} Верни исходную позицию, чтобы попробовать снова.` : lesson.selected ? feedback : instruction;
  lesson.hint=`${hint} ${lesson.matchRules?'Здесь действует настоящее правило: потеря знамени завершает партию, даже если остались броненосцы и лукари.':trainingHint}`;
  return lesson;
}

export function createMoveLesson(index=0, options={}) {
  const aura=options.aura||'attack',defensive=aura==='defense';
  const chosen=index===4?options.placement||options.previewPlacement||options.destination:options.destination;
  const advanced=index===4?Boolean(options.placement||options.advanced&&options.destination):Boolean(options.advanced&&chosen);
  let pieces,moverId='blue',destination,title,description,instruction,hint;
  if(index===0){
    pieces=[lessonPiece('blue','archer',0,-2,0),lessonPiece('enemy','shield',1,0,0),lessonPiece('friend','shield',0,-2,1),lessonPiece('drum','attackLamp',0,-3,0)];destination={q:-2,r:3};
    title='Три шага под барабаном';description='У лукаря обычный шаг 2. В начале действия барабан добавляет ещё 1: можно пройти 3 клетки.\nПройди через союзника к верхней клетке в той же колонке. На занятой клетке останавливаться нельзя; враг перекрывает путь.';
    instruction='Выбери лукаря. Наведи на клетку через три шага вверх и выполни ход.';hint='Барабан ускоряет союзников всех типов. Если действие началось в его ауре, дополнительный шаг сохраняется до конца маршрута, даже после выхода из ауры.';
  }else if(index===1){
    pieces=[lessonPiece('blue','shield',0,0,0),lessonPiece('enemy','archer',1,0,2)];destination={q:0,r:1};title='Подойти, чтобы ударить';description='Обычный броненосец бьёт только соседнюю клетку: дальность 1.\nПодойди к лукарю и уничтожь его, пережив ответный выстрел.';instruction='Выбери броненосца и займи клетку между фигурами.';hint='Движение и атака — одно действие. После перемещения все атаки рассчитываются автоматически.';
  }else if(index===2){
    pieces=[lessonPiece('blue','archer',0,0,-2),lessonPiece('enemy','archer',1,0,1),lessonPiece('wall','shield',1,0,0),lessonPiece('drum','attackLamp',0,0,-3)];destination={q:-2,r:1};title='Щит перекрывает стрелу';description='Вражеский щит закрывает лукаря за собой.\nОбойди щит слева и найди прямую линию выстрела. Кнопка «Убрать щитовика» позволяет отдельно сравнить ту же позицию без преграды.';instruction='Выбери лукаря и обойди щит, чтобы стрела достигла цели.';hint='Стрелы летят по прямым линиям сетки. Вражеский броненосец перекрывает луч; союзники пропускают выстрелы.';
    if(options.shieldRemoved)pieces=pieces.filter(p=>p.id!=='wall');
  }else if(index===3){
    pieces=[lessonPiece('blue','archer',0,-3,0),lessonPiece('enemy','shield',1,2,0)];destination={q:-1,r:0};title='Достать до врага';description='Обычный лукарь стреляет на 4 клетки. Враг стоит в пяти.\nПереместись ближе и добейся попадания по прямой.';instruction='Выбери лукаря и сократи расстояние до цели.';hint='Одного расстояния недостаточно: цель должна лежать на прямой линии сетки.';
  }else{
    moverId='support';pieces=supportLessonPieces(defensive?'defenseLamp':'horn');destination=defensive?{q:-1,r:1}:{q:-1,r:0};
    title=defensive?'Знамя спасает союзника':'Горн добавляет урон';
    description=defensive?'Знамя даёт +1 к стойкости союзников в радиусе 3. Сам он имеет стойкость 3.\nПодведи знамя: лукарь должен пережить удар командира с уроном 3.':'Горн даёт +1 к урону союзников всех типов в радиусе 2.\nПодведи его к лукарю: атака вырастет с 2 до 3 и уничтожит вражеского лукаря.';
    instruction=defensive?'Выбери знамя и прикрой союзника аурой.':'Выбери горн и усиль выстрел союзного лукаря.';
    hint=defensive?'Защита от разных союзников складывается. Источник не защищает себя.':'Горн не усиливает себя и не начинает атаковать от собственной ауры. Поддержка без базовой атаки может бить только рядом с ветераном.';
  }
  const lesson=createPositionLesson(pieces,moverId,{...options,advanced,destination:chosen});
  Object.assign(lesson,{index,aura,title,description,supportLesson:index===4,sourceId:index===4?'support':null,targetId:'enemy',shieldRemoved:index===2&&Boolean(options.shieldRemoved)});
  if(lesson.shieldRemoved){const outcome=resolve(lesson.before,lesson.config);Object.assign(lesson,{completed:true,position:outcome.state,deaths:outcome.deaths,report:outcome.report,displayReport:analyze(outcome.state,lesson.config),available:[]});}
  const blue=lesson.combatPosition.pieces.find(p=>p.id==='blue'),enemy=lesson.combatPosition.pieces.find(p=>p.id==='enemy'),blueStats=lesson.report.get('blue'),target=lesson.report.get('enemy');
  lesson.canHit=attacks(blue,enemy,lesson.combatPosition,lesson.config);
  lesson.passesAlly=lesson.path.slice(1,-1).some(cell=>lesson.before.pieces.some(p=>p.id!==moverId&&p.team===0&&p.q===cell.q&&p.r===cell.r));
  let met,feedback,objective;
  if(index===0){
    const allowance=lesson.beforeReport.get('blue').move,spent=lesson.path.length?lesson.path.length-1:0;
    lesson.facts=[['Обычный шаг',String(lesson.config.stats.archer.move)],['В начале действия',String(allowance)],['Длина маршрута',`${spent} из ${allowance}`],['Шаг на конечной клетке',String(blueStats.move)]];
    met=spent===3&&lesson.passesAlly;objective='Пройти три шага через союзника, сохранив дополнительный шаг после выхода из ауры.';
    feedback=spent?`Маршрут: ${spent} шага. ${lesson.passesAlly?'Союзник пропускает фигуру. ':''}Допуск на это действие — ${allowance}; на конечной клетке обычный шаг снова ${blueStats.move}.`:'Барабан даёт лукарю 2 + 1 = 3 шага на начатое действие.';
    const moves=reachable(lesson.before.pieces.find(p=>p.id===moverId),lesson.before,lesson.config),actual=new Set(moves.map(c=>key(c.q,c.r))),own=new Set(pieces.filter(p=>p.team===0).map(p=>key(p.q,p.r)));
    lesson.enemyBlocked=reachable(lesson.before.pieces.find(p=>p.id===moverId),{...lesson.before,pieces:pieces.filter(p=>p.team===0)},lesson.config).filter(c=>!actual.has(key(c.q,c.r))&&!own.has(key(c.q,c.r)));
  }else if(index===1){lesson.facts=[['Дальность щита',String(blueStats.range)],['Урон по лукарю',String(target.incoming)],['Ответный урон',String(blueStats.incoming)]];met=target.dead&&!blueStats.dead;objective='Уничтожить лукаря соседним ударом и выжить.';feedback=`По врагу: ${target.incoming} урона, по броненосцу: ${blueStats.incoming}. ${target.dead?'Лукарь погибает.':'Нужна соседняя клетка.'}`;
  }else if(index===2){lesson.facts=[['Урон по щиту',lesson.shieldRemoved?'Убран':String(lesson.report.get('wall').incoming)],['Урон по лукарю за ним',String(target.incoming)],['Ответный урон',String(blueStats.incoming)]];met=target.incoming>0&&!blueStats.dead;objective='Обойти преграду и попасть по лукарю, сохранив свою фигуру.';feedback=target.incoming?`Стрела достигла лукаря: ${target.incoming} урона. ${blueStats.dead?'Наш лукарь тоже погибает — найди безопасный обход.':'Наш лукарь переживает ответ.'}`:'Вражеский щит перекрывает луч. Лукарь за ним не получает урона.';
  }else if(index===3){lesson.facts=[['Расстояние',String(distance(blue,enemy,lesson.config))],['Дальность',String(blueStats.range)],['Урон по цели',String(target.incoming)]];met=target.incoming>0&&!blueStats.dead;objective='Найти прямую линию в пределах четырёх клеток и попасть по цели.';feedback=target.incoming?`Цель в пределах выстрела: ${target.incoming} урона.`:'Сейчас стрела не достаёт цели: проверь прямую и расстояние.';
  }else if(defensive){lesson.facts=[['Стойкость лукаря',String(blueStats.fortitude)],['Входящий урон',String(blueStats.incoming)],['Стойкость знамени',String(lesson.report.get('support').fortitude)]];met=blueStats.sources.includes('support')&&!blueStats.dead;objective='Защитить лукаря знаменем и пережить 3 урона.';feedback=`Лукарь: стойкость ${blueStats.fortitude}, входящий урон ${blueStats.incoming}. ${blueStats.dead?'Без защиты он погибает.':'Защита позволяет выжить.'}`;
  }else{lesson.facts=[['Атака лукаря',String(blueStats.damage)],['Стойкость врага',String(target.fortitude)],['Урон по врагу',String(target.incoming)],['Атака горна',String(lesson.report.get('support').damage)]];met=target.dead&&blueStats.sources.includes('support')&&!blueStats.dead;objective='Усилить лукаря горном и уничтожить врага.';feedback=`Лукарь наносит ${blueStats.damage}, цель получает ${target.incoming} при стойкости ${target.fortitude}. ${target.dead?'Этого достаточно для гибели цели.':'Нужно усиление горна.'}`;}
  return finishLessonGoal(lesson,{objective,destination,met,instruction,feedback,hint});
}

export function renderMoveLesson(lesson, icons, renderBadges = () => '', animation = null) {
  const sceneKey = lesson.sceneKey || (lesson.index === 4 ? `4-${lesson.aura}` : String(lesson.index));
  const titleId = `lesson-title-${sceneKey}`;
  const { index, config } = lesson;
  const point = lesson.point || lessonPoint;
  const polygon = cell => lessonPolygonPoints(point(cell), lesson.rotation || 0);
  const phase = animation?.phase || 'idle', busy = phase !== 'idle';
  const position = phase === 'movement' ? lesson.before : lesson.position;
  const displayReport = phase === 'movement' ? lesson.report : lesson.displayReport;
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
    return `<g class="lesson-tile${clickable ? ' lesson-available' : ''}${number ? ' lesson-route' : ''}${blocked.has(k) ? ' lesson-enemy-blocked' : ''}${selectedUnit && selectedUnit.q === cell.q && selectedUnit.r === cell.r ? ' lesson-unit-cell' : ''}" data-lesson-position="${k}"${clickable ? ` ${lesson.supportLesson ? 'data-lesson-place' : 'data-lesson-cell'}="${k}" role="button" tabindex="-1" aria-label="${'Клетка ' + k + ', шагов до неё: ' + available.get(k)}"` : ''}><polygon points="${polygon(cell)}"/>${clickable && !number ? `<circle class="lesson-move-dot" cx="${p.x}" cy="${p.y}" r="3"/>` : ''}${blocked.has(k) && !position.pieces.some(piece => piece.q === cell.q && piece.r === cell.r) ? `<path class="lesson-blocked-cross" d="M${p.x - 4} ${p.y - 4}l8 8m-8 0 8-8"><title>Враг перекрыл путь</title></path>` : ''}</g>`;
  }).join('');
  const projected = lesson.previewPosition;
  const attackSource = lesson.unitType && selectedUnit ? projected.pieces.find(piece => piece.id === selectedId) : null;
  const attackMarkup = attackReachPresentation(attackSource, projected, config, {point, polygonPoints: lessonPolygonPoints({x:0,y:0}, lesson.rotation || 0), visiblePosition: position, displayTeam: attackSource && lessonDisplayTeam(attackSource), friendlyTeam: 0}).markup;
  const routeLine = visiblePath.length > 1 ? `<polyline class="lesson-path" points="${visiblePath.map(c => { const p = point(c); return `${p.x},${p.y}`; }).join(' ')}"/>` : '';
  const pieces = position.pieces.map(piece => {
    const p = point(piece), info = displayReport.get(piece.id), fatal = info.dead, appearance = unitAppearance(piece, config, icons, lessonDisplayTeam(piece));
    const selected = piece === selectedUnit, unitControl = !busy && (lesson.selectableIds || [lesson.moverId]).includes(piece.id);
    const unitLabel = LABELS[piece.type] + (appearance.veteran ? '-ветеран' : '');
    return `<g class="lesson-piece${appearance.veteran ? ' veteran' : ''}${phase === 'movement' && piece.id === lesson.moverId ? ' moving-origin' : ''} ${piece.team ? 'lesson-enemy' : 'lesson-friendly'}${fatal ? ' lesson-fatal' : ''}${selected ? ' lesson-unit-selected' : ''}${unitControl ? ' lesson-unit-control' : ''}${lesson.isPreview && piece.id === lesson.moverId ? ' lesson-preview-origin' : ''}" data-lesson-piece="${piece.id}"${selected ? ` data-lesson-selected-unit="${piece.id}"` : ''}${unitControl ? ` data-lesson-unit="${piece.id}" role="button" tabindex="-1" aria-pressed="${selected}" aria-label="${selected ? 'Выбран: ' + unitLabel + '. Нажми, чтобы снять выбор' : 'Выбрать: ' + unitLabel}"` : ''} transform="translate(${p.x},${p.y})">${selected ? '<g class="lesson-selection-ring"><circle r="27"/></g>' : ''}<title>${piece.team ? 'Враг' : 'Союзник'}: ${LABELS[piece.type]}${appearance.veteran ? '-ветеран' : ''}${fatal ? ', погибнет при расчёте' : ''}</title>${renderTokenBody(appearance, lessonDisplayTeam(piece))}<g class="lesson-unit-badges">${renderBadges(info, { showIncoming: Boolean(busy || lesson.selected || lesson.isPreview), pieceType: piece.type, veteran: appearance.veteran })}</g></g>`;
  }).join('');
  const projectedMover = projected.pieces.find(piece => piece.id === lesson.moverId), projectedPoint = projectedMover && point(projectedMover);
  const projectedAppearance = lesson.isPreview ? unitAppearance(projectedMover, config, icons, lessonDisplayTeam(projectedMover)) : null;
  const ghost = lesson.isPreview ? `<g class="lesson-preview-piece${projectedAppearance.veteran ? ' veteran' : ''}" transform="translate(${projectedPoint.x},${projectedPoint.y})">${renderTokenBody(projectedAppearance, lessonDisplayTeam(projectedMover))}<g class="lesson-unit-badges">${renderBadges(lesson.report.get(projectedMover.id), { showIncoming: true, pieceType: projectedMover.type, veteran: projectedAppearance.veteran })}</g></g>` : '';
  const numbers = visiblePath.slice(1).map((cell, i) => {
    const p = point(cell), occupied = projected.pieces.some(piece => piece.q === cell.q && piece.r === cell.r);
    return `<g class="lesson-path-number" transform="translate(${p.x + (occupied ? 19 : 0)},${p.y + (occupied ? -20 : 0)})"><circle r="11"/><text y=".35em">${i + 1}</text></g>`;
  }).join('');

  const movingPiece = phase === 'movement' ? lesson.before.pieces.find(piece => piece.id === lesson.moverId) : null;
  const effects = phase === 'deaths' ? `<g class="death-effects" aria-hidden="true">${renderDeathEffects(lesson.deaths, point, lessonPolygonPoints({ x: 0, y: 0 }, lesson.rotation || 0), icons, config, lessonDisplayTeam)}</g>` : '';
  const movingToken = movingPiece ? renderMovingToken(movingPiece, animation.frame || { ...point(movingPiece), progress: 0 }, icons, `lesson-moving-token-${sceneKey}`, config, lessonDisplayTeam(movingPiece), lesson.report.get(movingPiece.id)) : '';
  const feedback = phase === 'movement' ? 'Фигура движется по выбранному маршруту.' : phase === 'deaths' ? 'Расчёт боя: погибшие фигуры удаляются одновременно.' : lesson.feedback;
  const stateLabel = phase === 'movement' ? 'ДВИЖЕНИЕ' : phase === 'deaths' ? 'РАСЧЁТ БОЯ' : lesson.completed ? 'ПОСЛЕ РАСЧЁТА БОЯ' : lesson.isPreview ? 'ПРОГНОЗ · НАЖМИ НА КЛЕТКУ' : lesson.selected ? showAura ? 'АУРА ВЫДЕЛЕННОЙ ФИГУРЫ' : 'НАВЕДИ НА КЛЕТКУ' : index === 2 ? 'ЩИТ НА ПУТИ' : 'ВЫБЕРИ ФИГУРУ';
  const controls = (lesson.extraControls || '') + (index === 2 && !lesson.completed ? '<button class="button primary" data-lesson-action="remove-shield">Убрать щитовика</button>' : '') +
    '<button class="button outline" data-lesson-action="reset">Вернуть исходную позицию</button>';
  return `<section class="lesson-scene" data-lesson-scene="${sceneKey}" aria-labelledby="${titleId}"><div class="lesson-scene-heading">${lesson.unitType ? '' : `<p class="eyebrow">ПРИМЕР ${lesson.exampleNumber ?? (index === 4 && lesson.aura === 'defense' ? 6 : index + 1)} ИЗ ${lesson.exampleTotal ?? MOVE_LESSONS.length}${index === 4 ? lesson.aura === 'defense' ? ' · ЗАЩИТА' : ' · АТАКА' : ''}</p>`}<h4 id="${titleId}">${lesson.title}</h4>${lesson.description.split('\n').map(text => `<p>${text}</p>`).join('')}</div><div class="lesson-layout"><div class="lesson-field"><svg class="lesson-board" aria-busy="${busy}" viewBox="${lesson.viewBox || '70 10 420 390'}" role="group" aria-label="Учебная позиция: ${lesson.title}">${tiles}<g class="lesson-aura-circles">${auraMarkup}</g><g class="lesson-lines">${routeLine}</g>${pieces}<g class="lesson-ghost">${ghost}</g><g class="lesson-attack-reach" aria-hidden="true">${attackMarkup}</g><g class="lesson-numbers">${numbers}</g>${effects}${movingToken}</svg><p class="lesson-legend"><span><i></i> Ваши — Юг</span><span><i class="enemy"></i> Север</span>${index === 0 ? '<span>Цифры — шаги маршрута</span><span>× — враг перекрыл путь</span>' : '<span>Череп — погибнет при расчёте</span>'}</p></div><div class="lesson-details"><p class="lesson-state">${stateLabel}</p><dl>${lesson.facts.map(([name, value]) => `<div><dt>${name}</dt><dd>${value}</dd></div>`).join('')}</dl><p class="lesson-feedback" role="status">${feedback}</p>${controls}<p class="lesson-hint">${lesson.hint}</p></div></div></section>`;
}


export function renderMoveExamples(states,icons,renderBadges=()=>'',animation=null){
  const examples=[{index:0,key:'0'},{index:1,key:'1'},{index:2,key:'2'},{index:3,key:'3'},{index:4,key:'4-attack',aura:'attack'},{index:4,key:'4-defense',aura:'defense'}];
  return '<div class="lesson-page">'+examples.map(example=>renderMoveLesson(createMoveLesson(example.index,{...states[example.key],aura:example.aura||'attack'}),icons,renderBadges,animation?.sceneKey===example.key?animation:null)).join('')+'</div><p class="lesson-footnote">Это отдельные учебные позиции с характеристиками текущей игры. Справа показана полная стойкость, сверху — входящий урон. Учебная цель заменяет правило полной партии, если не указано обратное. Выбор, прогноз, ход и сброс не меняют вашу партию.</p>';
}

export function createCombatLesson(index,options={}){
  let pieces,destination;
  if(index===0){pieces=[lessonPiece('blue','shield',0,0,0),lessonPiece('enemy','archer',1,0,3)];destination={q:1,r:0};}
  else if(index===1){pieces=[lessonPiece('blue','archer',0,-2,-1),lessonPiece('enemy','archer',1,0,0),...(options.secondArcher===false?[]:[lessonPiece('second','archer',0,0,-2)])];destination={q:-2,r:0};}
  else if(index===2){pieces=[lessonPiece('blue','shield',0,0,0),lessonPiece('enemy','shield',1,0,2),lessonPiece('drum','attackLamp',0,-1,1),lessonPiece('enemyDrum','attackLamp',1,1,2)];destination={q:0,r:1};}
  else if(index===3){pieces=[lessonPiece('blue','scoutLamp',0,0,0),lessonPiece('enemy','defenseLamp',1,0,3),lessonPiece('enemy-fighter','shield',1,2,1),lessonPiece('own-flag','defenseLamp',0,-3,1),lessonPiece('own-fighter','archer',0,-3,0)];destination={q:0,r:1};}
  else throw new Error('Неизвестный учебный пример боя.');
  const lesson=createPositionLesson(pieces,'blue',{...options,matchRules:index===3});
  Object.assign(lesson,{index:8+index,exampleNumber:index+1,exampleTotal:4});
  if(index!==1)Object.assign(lesson,{point:verticalLessonPoint,rotation:0,viewBox:'70 10 420 390'});
  const own=lesson.report.get('blue'),enemy=lesson.report.get('enemy');let title,description,objective,instruction,feedback,hint,met;
  if(index===0){title='Урон не накапливается';description=`Лукарь обстреливает броненосца: ${lesson.beforeReport.get('blue').incoming} урона при полной стойкости ${lesson.beforeReport.get('blue').fortitude}.\nВыведи броненосца из линии выстрела. Стойкость не расходуется как здоровье и останется прежней.`;objective='Уйти с линии огня, сохранив полную стойкость 5.';instruction='Выбери броненосца, наведи на соседнюю клетку сбоку и сравни верхний бейдж.';met=own.incoming===0;feedback=`Справа полная стойкость ${own.fortitude}. ${own.incoming?`Сверху входящий урон −${own.incoming}.`:'Входящего урона нет: верхний бейдж исчезает.'}`;hint='Урон считается заново после каждого действия. Несмертельный урон не переносится на следующий ход.';lesson.facts=[['Полная стойкость',String(own.fortitude)],['Входящий урон',String(own.incoming)],['Накопленный урон','Не хранится']];}
  else if(index===1){title='Урон союзников складывается';description='Одна стрела наносит 2 урона, а стойкость лукаря равна 3.\nПодведи второго лукаря на линию выстрела: две атаки сложатся в одном расчёте.';objective='Двумя лукарями нанести 4 урона и уничтожить цель.';instruction='Выбери лукаря слева и найди прямую линию к врагу.';met=enemy.dead;feedback=`По цели ${enemy.incoming} урона при стойкости ${enemy.fortitude}. ${enemy.dead?'Совместного огня достаточно.':'Одной стрелы не хватает.'}`;hint='Убери второго лукаря кнопкой и сравни тот же ход. Между ходами урон не накапливается.';lesson.facts=[['Суммарный урон',String(enemy.incoming)],['Стойкость цели',String(enemy.fortitude)],['Цель',enemy.dead?'Погибает':'Выживает']];lesson.extraControls=`<button class="button outline" data-lesson-action="toggle-archer">${options.secondArcher===false?'Вернуть второго лукаря':'Убрать второго лукаря'}</button>`;}
  else if(index===2){title='Смерти происходят одновременно';description='Между броненосцами одна пустая клетка. Их атака 5, стойкость 5.\nПодойди вплотную: оба нанесут ответный удар, даже если погибают сами.';objective='Вызвать одновременную гибель обоих броненосцев.';instruction='Выбери броненосца и займи клетку между ними.';met=own.dead&&enemy.dead;feedback=met?'Оба броненосца наносят по 5 урона и погибают одновременно.':'Пока расстояние слишком велико для удара. Дальность обычного броненосца — 1.';hint='Сначала считается урон всех фигур, затем погибшие удаляются одновременно. Барабан здесь даёт шаг, а не атаку.';lesson.facts=[['Наш входящий урон',String(own.incoming)],['Вражеский входящий урон',String(enemy.incoming)],['Итог',met?'Оба погибают':'Оба живы']];}
  else{title='Потеря знамени завершает партию';description='На поле два знамени и боевые фигуры обеих сторон. Здесь действует настоящее условие победы.\nПодведи командира на две клетки к вражескому знамени и нанеси 3 урона при стойкости 3.';objective='Победить, уничтожив знамя, пока вражеский броненосец остаётся жив.';instruction='Выбери командира и подойди к вражескому флагу на две клетки.';met=enemy.dead&&(!lesson.completed||lesson.position.winner===0)&&lesson.position.pieces.some(p=>p.id==='enemy-fighter');feedback=lesson.completed&&met?'Знамя погиб. У Севера остался броненосец, но потеря флага уже принесла победу Югу.':`Стойкость знамени ${enemy.fortitude}, входящий урон ${enemy.incoming}. Для атаки командиру нужна цель в пределах двух клеток.`;hint='Командир атакует самостоятельно, но не считается броненосцем или лукарём для условия сохранения боевых фигур.';lesson.facts=[['Урон по знамени',String(enemy.incoming)],['Стойкость знамени',String(enemy.fortitude)],['Вражеский броненосец',lesson.position.pieces.some(p=>p.id==='enemy-fighter')?'Жив':'Погиб'],['Победа',lesson.position.winner===0?'Юг победил':'Ещё не завершено']];}
  Object.assign(lesson,{title,description});return finishLessonGoal(lesson,{objective,destination,met,instruction,feedback,hint});
}
export function renderCombatExamples(states,icons,renderBadges=()=>'',animation=null){return '<div class="lesson-page">'+[0,1,2,3].map(index=>{const key=String(8+index);return renderMoveLesson(createCombatLesson(index,states[key]||{}),icons,renderBadges,animation?.sceneKey===key?animation:null);}).join('')+'</div>';}
