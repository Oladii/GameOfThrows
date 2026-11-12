import { TYPES, LABELS, DEFAULT_CONFIG } from './rules.js';
import { renderTokenBody } from './token-presentation.js';
import { clone, analyze, cells, auraReaches, shieldCanRetreat } from './engine.js';
import { createPositionLesson, finishLessonGoal, renderMoveLesson, supportLessonPieces } from './onboarding-examples.js';
const unitPiece=(id,type,team,q,r)=>({id,type,team,q,r});

export function badgeExamples(){
  const config=clone(DEFAULT_CONFIG);config.size=3;
  return [
    {label:'Без угрозы',enemies:[],explanation:`Полная стойкость ${config.stats.shield.fortitude}, входящего урона нет.`},
    {label:'Под огнём',enemies:[unitPiece('enemy','archer',1,0,2)],explanation:`Стойкость остаётся ${config.stats.shield.fortitude}; сверху отдельно показан входящий урон ${config.stats.archer.damage}. Прошлый урон не сохраняется.`},
    {label:'Смертельный урон',enemies:[unitPiece('enemy','archer',1,0,2),unitPiece('second','shield',1,1,0)],explanation:'Входящий урон равен полной стойкости или превышает её. Фигура погибает при расчёте.'}
  ].map(example=>({...example,info:analyze({pieces:[unitPiece('blue','shield',0,0,0),...example.enemies],turn:0,ply:0,winner:null},config).get('blue')}));
}

export function createUnitLesson(type,options={}){
  if(!TYPES.includes(type))throw new Error('Неизвестная фигура учебного примера.');
  const support=!['shield','archer'].includes(type);
  const pieces=type==='shield'?[unitPiece('blue',type,0,0,1),{...unitPiece('veteran','shield',0,-1,3),reachedFarEdge:true},unitPiece('enemy','shield',1,1,2),unitPiece('sideBow','archer',1,1,-1),unitPiece('ally','archer',0,-1,2)]
    :type==='archer'?[unitPiece('blue',type,0,-1,-1),unitPiece('enemy','defenseLamp',1,1,1),unitPiece('wall','shield',1,1,-1),unitPiece('horn','horn',0,-2,1)]:supportLessonPieces(type);
  const primaryId=support?'support':'blue',selectableIds=type==='shield'?['blue','veteran']:[primaryId];
  const selectedId=options.selected&&selectableIds.includes(options.selectedId)?options.selectedId:primaryId;
  const moverId=options.advanced&&selectableIds.includes(options.movedId)?options.movedId:selectedId;
  const lesson=createPositionLesson(pieces,moverId,options);
  Object.assign(lesson,{index:20+TYPES.indexOf(type),sceneKey:`unit-${type}`,unitType:type,title:LABELS[type],selectableIds,selectedId:options.selected?selectedId:null});
  const hero=lesson.report.get(primaryId),ally=lesson.report.get('blue'),enemy=lesson.report.get('enemy'),stats=lesson.config.stats[type];
  const source=lesson.previewPosition.pieces.find(p=>p.id===selectedId);
  lesson.auraMask=source&&shieldCanRetreat(source,lesson.config)?3:['shield','defenseLamp'].includes(type)?2:1;
  lesson.auraCells=lesson.selected&&source?cells(lesson.config).filter(cell=>auraReaches(source,cell,lesson.previewPosition,lesson.config)):[];
  let description,objective,destination,instruction,feedback,hint,met;
  if(type==='shield'){
    destination={q:0,r:2};description=`Шаг ${stats.move}, атака ${stats.damage}, дальность обычного броненосца ${stats.range}. Перекрывает вражеские стрелы.\nАура соседнего броненосца даёт +${stats.defenseBonus} к стойкости союзников всех типов. Защита от нескольких источников складывается.\nБроненосец в венке — ветеран: его тоже можно выбрать. Подойди к нему, уничтожь врага и выживи.`;
    const protectedArcher=lesson.report.get('ally'),veteran=lesson.report.get('veteran');
    lesson.facts=[['Атака броненосца',String(hero.damage)],['Дальность обычного щита',String(hero.range)],['Стойкость броненосца',String(hero.fortitude)],['Стойкость ветерана',String(veteran.fortitude)],['Стойкость союзного лукаря',`${lesson.config.stats.archer.fortitude} → ${protectedArcher.fortitude}`],['Урон по врагу',String(enemy.incoming)]];
    met=enemy.dead&&!hero.dead&&hero.sources.includes('veteran');objective='Подойти к ветерану, уничтожить вражеский щит и выжить.';instruction='Выбери оранжевую фигуру со щитом. Подойди к ветерану и сравни прогноз атаки и стойкости.';
    feedback=`Броненосец: атака ${hero.damage}, стойкость ${hero.fortitude}, входящий урон ${hero.incoming}. ${enemy.dead?'Вражеский щит погибает.':'Для удара нужна соседняя клетка.'}`;
    hint='Обычный щит не получает дальность от союзных аур. После противоположного края он навсегда становится ветераном и получает личное усиление.';
  }else if(type==='archer'){
    destination={q:-1,r:1};description=`Шаг ${stats.move}, базовая атака ${stats.damage}, дальность ${stats.range}. Стреляет по прямой, своей ауры не даёт.\nВ этом примере горн добавляет лукарю +1 к урону. Найди безопасную линию выстрела к цели.\n${lesson.config.archerEdgeDamageBonus > 0 ? `За достижение чужого края навсегда получает +${lesson.config.archerEdgeDamageBonus} к урону и венок. После отхода усиление остаётся, повторно не складывается и не даёт ауру ветерана.` : 'В правилах этой партии усиление лукаря за край не включено.'}`;
    lesson.facts=[['Атака лукаря',String(hero.damage)],['Урон по цели',String(enemy.incoming)],['Ответный урон',String(hero.incoming)]];
    met=enemy.dead&&!hero.dead;objective='Уничтожить цель выстрелом и сохранить лукаря.';instruction='Выбери оранжевую фигуру с луком. Наведи на клетку с прямой линией выстрела.';
    feedback=`Цель получает ${enemy.incoming} урона при стойкости ${enemy.fortitude}. ${hero.dead?'Наш лукарь здесь погибает.':'Наш лукарь выживает.'}`;hint='Вражеский щит перекрывает луч. Соседство с ним опасно: сила его атаки 5.';
  }else if(type==='attackLamp'){
    destination={q:0,r:-1};description=`Барабан ходит на ${stats.move}, сам без ветерана не атакует. Аура радиуса ${stats.aura} даёт +1 к шагу союзников всех типов.\nПодведи барабан к лукарю: его доступный ход должен вырасти с 2 до 3.`;
    lesson.facts=[['Шаг союзного лукаря',`${lesson.config.stats.archer.move} → ${ally.move}`],['Шаг барабана',String(hero.move)],['Атака барабана',String(hero.damage)]];
    met=ally.move===3&&ally.sources.includes('support')&&!hero.dead;objective='Дать союзному лукарю дополнительный шаг.';instruction='Выбери барабан и поставь его в радиусе двух клеток от союзного лукаря.';
    feedback=`Шаг лукаря сейчас ${ally.move}. Барабан не добавляет урон: атака лукаря ${ally.damage}.`;hint='Дополнительный шаг фиксируется в начале действия союзника и сохраняется после выхода из ауры. Сам себя барабан не ускоряет.';
  }else if(type==='horn'){
    destination={q:-1,r:0};description=`Горн ходит на ${stats.move}, аура радиуса ${stats.aura} даёт +${stats.damageBonus} к урону союзников всех типов.\nПодведи горн к лукарю: атака 2 станет 3 и уничтожит вражеского лукаря.`;
    lesson.facts=[['Атака союзного лукаря',`${lesson.config.stats.archer.damage} → ${ally.damage}`],['Урон по врагу',String(enemy.incoming)],['Атака горна',String(hero.damage)]];
    met=enemy.dead&&ally.sources.includes('support')&&!hero.dead;objective='Усилить лукаря горном и уничтожить врага.';instruction='Выбери оранжевую фигуру с рогом и подведи к союзному лукарю.';
    feedback=`Лукарь наносит ${ally.damage}, враг получает ${enemy.incoming} при стойкости ${enemy.fortitude}. Горн сам наносит ${hero.damage}.`;hint='Горн не усиливает себя. Без базовой атаки и поддержки ветерана он не атакует, даже находясь рядом с врагом.';
  }else if(type==='scoutLamp'){
    destination={q:1,r:-1};description=`Командир атакует самостоятельно: урон ${stats.damage}, дальность ${stats.range}, шаг ${stats.move}. Дальность его атаки не увеличивается аурами.\nЕго аура радиуса ${stats.aura} даёт лукарю +${stats.rangeBonus} к дальности: 4 становится 5. Подойди на две клетки к врагу и ударь командиром.`;
    lesson.facts=[['Атака командира',String(hero.damage)],['Дальность командира',String(hero.range)],['Дальность союзного лукаря',`${lesson.config.stats.archer.range} → ${ally.range}`],['Урон по врагу',String(enemy.incoming)]];
    met=enemy.dead&&!hero.dead&&enemy.attackers.some(p=>p.id==='support');objective='Нанести самостоятельный удар командиром и уничтожить врага.';instruction='Выбери оранжевую фигуру со шлемом и займи клетку в двух шагах от врага.';
    feedback=`Командир наносит ${hero.damage} на дальности ${hero.range}. Союзный лукарь имеет дальность ${ally.range}; враг получает ${enemy.incoming} суммарного урона.`;hint='Дальность атаки командира фиксирована: 2 клетки, без увеличения от своей или чужих аур. Аура командира расширяет выстрел лукаря. Барабан по-прежнему даёт командиру дополнительный шаг.';
  }else{
    destination={q:-1,r:1};description=`Знамя: шаг ${stats.move}, стойкость ${stats.fortitude}, аура радиуса ${stats.aura} даёт +${stats.defenseBonus} к стойкости союзников.\nПрикрой лукаря: он должен пережить удар командира с силой 3.`;
    lesson.facts=[['Стойкость союзного лукаря',`${lesson.config.stats.archer.fortitude} → ${ally.fortitude}`],['Входящий урон',String(ally.incoming)],['Стойкость знамени',String(hero.fortitude)]];
    met=!ally.dead&&ally.sources.includes('support')&&!hero.dead;objective='Прикрыть лукаря знаменем и сохранить его при 3 входящего урона.';instruction='Выбери фигуру с флагом и подведи её ауру к лукарю.';
    feedback=`У лукаря стойкость ${ally.fortitude}, входящий урон ${ally.incoming}. ${ally.dead?'Он погибает.':'Он выживает.'}`;hint='Знамя не защищает себя. В настоящей партии потеря флага означает поражение; отдельный пример этого есть в разделе «Бой».';
  }
  lesson.description=description;return finishLessonGoal(lesson,{objective,destination,met,instruction,feedback,hint});
}

export function renderUnitExamples(states,icons,renderBadges=()=>'',animation=null){
  const badges=`<section class="lesson-scene badge-guide" aria-labelledby="badge-guide-title"><div class="lesson-scene-heading"><h4 id="badge-guide-title">Значения на бейджах</h4><p><strong>Слева — сила атаки:</strong> сколько урона наносит фигура.<br><strong>Справа — полная стойкость:</strong> с усилениями союзников, без вычитания урона.<br><strong>Сверху — угроза:</strong> при выборе и наведении показан входящий урон; смертельная угроза отмечается черепом.</p></div><div class="badge-examples">${badgeExamples().map(example=>`<figure><svg viewBox="-38 -32 76 70" role="img" aria-label="${example.label}: ${example.explanation}"><g class="lesson-piece lesson-friendly${example.info.dead?' lesson-fatal':''}">${renderTokenBody({type:'shield',icon:icons.shield,veteran:false},1)}${renderBadges(example.info,{showIncoming:true})}</g></svg><figcaption><strong>${example.label}</strong><span>${example.explanation}</span></figcaption></figure>`).join('')}</div><p class="badge-guide-note">Это прогноз, а не запас здоровья. После каждого хода стойкость и угрозы считаются заново: прошлый урон не накапливается.</p></section>`;
  return '<div class="lesson-page">'+badges+TYPES.map(type=>{const key=`unit-${type}`;return renderMoveLesson(createUnitLesson(type,states[key]||{}),icons,renderBadges,animation?.sceneKey===key?animation:null);}).join('')+'</div><p class="lesson-footnote">Все шесть фигур используют характеристики текущей игры. Это отдельные учебные цели: выбери фигуру, сравни прогноз, сделай ход и верни исходную позицию. Ваша партия не меняется.</p>';
}
