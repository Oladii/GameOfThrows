import { analyze, inspectCell, move, pass, shieldCanRetreat, archerHasEdgeBonus, attacks, cells, effective, distance } from './engine.js';

const unitForms = {
  shield: ['щитоносца', 'щитоносцу', 'щитоносца', 'щитоносцев', 'щитоносцам', 'щитоносцев'],
  archer: ['лукаря', 'лукарю', 'лукаря', 'лукарей', 'лукарям', 'лукарей'],
  attackLamp: ['барабан', 'барабану', 'барабана', 'барабаны', 'барабанам', 'барабанов'],
  defenseLamp: ['знамя', 'знамени', 'знамени', 'знамёна', 'знамёнам', 'знамён'],
  scoutLamp: ['командира', 'командиру', 'командира', 'командиров', 'командирам', 'командиров'],
  horn: ['горн', 'горну', 'горна', 'горны', 'горнам', 'горнов'],
};
const unit = (piece, grammaticalCase = 0) => unitForms[piece.type][grammaticalCase];
const join = words => words.length < 2 ? words[0] : `${words.slice(0, -1).join(', ')} и ${words.at(-1)}`;
function names(pieces, grammaticalCase = 0) {
  const groups = new Map();
  for (const piece of pieces) groups.set(piece.type, (groups.get(piece.type) || 0) + 1);
  return join([...groups].map(([type, count]) => count === 1 ? unitForms[type][grammaticalCase]
    : `${unitForms[type][grammaticalCase === 1 ? 4 : grammaticalCase === 2 ? 5 : 3]} (${count})`));
}
const gains = { damage: 'урон', fortitude: 'стойкость', move: 'дальность хода', range: 'дальность атаки' };

// Explain the purpose through verified changes in the position, not invented search thoughts.
export function explainHint(state, config, action) {
  if (!action) return { title: 'Сейчас нет допустимого хода', reasons: ['Ни у одной нашей фигуры нет доступной клетки для хода.'] };
  const piece = action.pass ? null : state.pieces.find(p => p.id === action.id);
  const outcome = action.pass ? pass(state, config) : move(state, config, action.id, action.to);
  const before = analyze(state, config), team = state.turn;
  const forecast = piece ? inspectCell(state, config, action.to, piece.id) : { position: state, report: before };
  const after = forecast.report, reasons = [];
  let title = 'Улучшаем позицию';
  const ownLosses = outcome.deaths.filter(p => p.team === team), enemyLosses = outcome.deaths.filter(p => p.team !== team);
  const survivors = new Set(outcome.state.pieces.map(p => p.id));
  if (outcome.state.winner === 'draw') {
    return { title: 'Поражение обеих сторон', suppressArrow: true, reasons: ['После этого хода проиграют обе стороны.'] };
  }
  if (outcome.state.winner !== null && outcome.state.winner !== team) {
    return { title: 'Ход ведёт к поражению', suppressArrow: true, reasons: ['Ход ведёт к поражению. Дальше сражаться смысла нет. Прости, я очень старался, но подвёл тебя.'] };
  }
  if (outcome.state.winner === team) {
    title = 'Завершаем партию победой';
    reasons.push(enemyLosses.some(p => p.type === 'defenseLamp') && config.victoryCondition === 'flag-or-combat'
      ? 'Уничтожаем вражеское знамя и выигрываем бой.'
      : `Убираем ${names(enemyLosses)} противника и выигрываем бой.`);
  } else if (enemyLosses.length) {
    title = 'Ослабляем армию соперника';
    reasons.push(enemyLosses.length === 1 ? `Убираем ${enemyLosses[0].type === 'defenseLamp' ? 'вражеское' : ['horn', 'attackLamp'].includes(enemyLosses[0].type) ? 'вражеский' : 'вражеского'} ${names(enemyLosses)}.` : `Убираем ${names(enemyLosses)} противника.`);
  }
  const rescued = state.pieces.filter(p => p.team === team && before.get(p.id).dead && survivors.has(p.id));
  if (rescued.length) {
    if (!enemyLosses.length && outcome.state.winner === null) title = 'Спасаем фигуры от гибели';
    reasons.push(`Этим манёвром спасаем ${names(rescued)} от ближайшей атаки. Противник уже рассчитывал ${rescued.length === 1 ? 'его' : 'их'} убрать.`);
  }
  if (piece && outcome.state.winner === null) {
    const oldStats = before.get(piece.id), newStats = after.get(piece.id);
    if (!newStats.dead && newStats.incoming < oldStats.incoming && !rescued.some(p => p.id === piece.id)) {
      title = reasons.length ? title : 'Уходим из-под обстрела';
      reasons.push(`Переведём ${unit(piece)} сюда — по нему будут бить слабее.`);
    }
    if (shieldCanRetreat(forecast.piece, config) && !shieldCanRetreat(piece, config)) {
      title = reasons.length ? title : 'Превращаем щитоносца в ветерана';
      reasons.push('Доведём щитоносца до чужого края.');
    }
    if (archerHasEdgeBonus(forecast.piece, config) && !archerHasEdgeBonus(piece, config)) {
      title = 'Усиливаем лукаря на чужом краю';
      reasons.push('Доведём лукаря до чужого края, чтобы он получил постоянную прибавку к урону.');
    }
    // Compare effective values and remove each provider to establish causality.
    // This also covers unblocking an existing aura, without crediting the mover for it.
    for (const ally of forecast.position.pieces.filter(p => p.team === team && survivors.has(p.id))) {
      const previous = before.get(ally.id), current = after.get(ally.id);
      const increases = Object.keys(gains).filter(field => current[field] > previous[field]);
      if (!increases.length) continue;
      for (const sourceId of current.sources) {
        const source = forecast.position.pieces.find(p => p.id === sourceId);
        const without = effective(ally, { ...forecast.position, pieces: forecast.position.pieces.filter(p => p.id !== sourceId) }, config);
        const oldWithout = effective(state.pieces.find(p => p.id === ally.id), { ...state, pieces: state.pieces.filter(p => p.id !== sourceId) }, config);
        const fields = increases.filter(field => current[field] > without[field] && current[field] - without[field] > previous[field] - oldWithout[field]);
        if (!fields.length) continue;
        title = reasons.length ? title : 'Усиливаем строй';
        const effect = join(fields.map(field => gains[field]));
        if (source.id === piece.id) reasons.push(`Подведём ${unit(piece)} к ${unit(ally, 1)}, чтобы увеличить ${effect}.`);
        else if (ally.id === piece.id) reasons.push(`Переведём ${unit(piece)} в ауру ${unit(source, 2)}, чтобы увеличить ${effect}.`);
        else reasons.push(`Этим манёвром открываем ${unit(ally, 1)} ауру ${unit(source, 2)}, чтобы увеличить ${effect}.`);
      }
    }
    const targets = forecast.position.pieces.filter(p => p.team !== team && after.get(p.id).attackers.some(a => a.id === piece.id));
    const newTargets = targets.filter(p => !before.get(p.id).attackers.some(a => a.id === piece.id));
    if (newTargets.length && !enemyLosses.length) {
      title = reasons.length ? title : 'Готовим совместную атаку';
      const supported = newTargets.some(p => after.get(p.id).attackers.length > 1);
      reasons.push(supported
        ? 'Подключаем бойца к общему удару. Урона пока не хватает.'
        : `Выведем ${unit(piece)} на ${names(newTargets)} противника. Одной этой атаки пока не хватит.`);
    }
    if (!reasons.length) {
      const enemyFlag = state.pieces.find(p => p.team !== team && p.type === 'defenseLamp');
      const controlled = (p, position) => new Set(cells(config).filter(c => attacks(p, { ...c, id: '__hint_probe', type: 'archer', team: 1 - team }, position, config, effective(p, position, config))).map(c => `${c.q},${c.r}`));
      const oldControl = controlled(piece, state), newControl = controlled(forecast.piece, forecast.position);
      if ([...newControl].some(cell => !oldControl.has(cell))) {
        title = 'Занимаем новую линию атаки';
        reasons.push(`Переставим ${unit(piece)} сюда, чтобы держать под обстрелом новые клетки.`);
      } else if (enemyFlag && distance(forecast.piece, enemyFlag, config) < distance(piece, enemyFlag, config)) {
        title = 'Подводим фигуру к вражескому знамени';
        reasons.push(`Подведём ${unit(piece)} ближе к вражескому знамени.`);
      } else {
        title = 'Перестраиваем армию';
        reasons.push(`Пока переставим ${unit(piece)} сюда. Прямой выгоды этот ход ещё не даёт.`);
      }
    }
  }
  if (ownLosses.length) reasons.push(`Этот манёвр будет стоить нам ${names(ownLosses, 2)}.`);
  if (action.pass && !reasons.length) { title = 'Передаём инициативу'; reasons.push('Оставляем фигуры на месте и передаём ход противнику.'); }
  return { title, reasons: reasons.slice(0, 3).concat(reasons.length > 3 && ownLosses.length ? [reasons.at(-1)] : []) };
}
