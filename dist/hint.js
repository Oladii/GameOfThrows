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
function beneficiaryNames(pieces) {
  const groups = new Map();
  for (const piece of pieces) groups.set(piece.type, (groups.get(piece.type) || 0) + 1);
  const counts = ['', '', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти', 'десяти', 'одиннадцати', 'двенадцати', 'тринадцати'];
  return join([...groups].map(([type, count]) => count === 1 ? unitForms[type][2]
    : counts[count] ? `${counts[count]} ${unitForms[type][5]}` : `${unitForms[type][5]} (${count})`));
}
const gains = { damage: 'урон', fortitude: 'стойкость', move: 'дальность хода', range: 'дальность атаки' };

// Keep template history across advice requests, independent of unit names.
export function createHintVoice(random = Math.random) {
  const recent = new Map();
  return (key, variants) => {
    const previous = recent.get(key) || [];
    const available = variants.map((_, index) => index).filter(index => !previous.includes(index));
    const index = available[Math.floor(random() * available.length)];
    recent.set(key, [...previous, index].slice(-Math.min(1, variants.length - 1)));
    return variants[index];
  };
}

// Explain the purpose through verified changes in the position, not invented search thoughts.
export function explainHint(state, config, action, voice = (_, variants) => variants[0]) {
  const say = (key, ...variants) => ({ key, variants });
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
      ? say('win-flag', 'Уничтожаем вражеское знамя и выигрываем бой.', 'Убираем вражеское знамя. Бой выигран.', 'Уничтожаем знамя противника — это победа.')
      : say('win-combat', `Убираем ${names(enemyLosses)} противника и выигрываем бой.`, `Уничтожаем ${names(enemyLosses)} противника. Бой выигран.`, `После этой атаки побеждаем: противник теряет ${names(enemyLosses)}.`));
  } else if (enemyLosses.length) {
    title = 'Ослабляем армию соперника';
    const enemyNames = enemyLosses.length === 1 ? `${enemyLosses[0].type === 'defenseLamp' ? 'вражеское' : ['horn', 'attackLamp'].includes(enemyLosses[0].type) ? 'вражеский' : 'вражеского'} ${names(enemyLosses)}` : `${names(enemyLosses)} противника`;
    reasons.push(say('enemy-loss', `Убираем ${enemyNames}.`, `Этим ходом уничтожаем ${enemyNames}.`, `После нашей атаки противник потеряет ${names(enemyLosses)}.`));
  }
  const rescued = state.pieces.filter(p => p.team === team && before.get(p.id).dead && survivors.has(p.id));
  if (rescued.length) {
    if (!enemyLosses.length && outcome.state.winner === null) title = 'Спасаем фигуры от гибели';
    reasons.push(say('rescue', `Этим манёвром спасаем ${names(rescued)} от ближайшей атаки. Противник уже рассчитывал ${rescued.length === 1 ? 'его' : 'их'} убрать.`, `Этим ходом сохраним ${names(rescued)}. Под удар пока не отдаём.`, `Спасаем ${names(rescued)} от ближайшей атаки. Оставим в строю.`));
  }
  if (piece && outcome.state.winner === null) {
    const oldStats = before.get(piece.id), newStats = after.get(piece.id);
    if (!newStats.dead && newStats.incoming < oldStats.incoming && !rescued.some(p => p.id === piece.id)) {
      title = reasons.length ? title : 'Уходим из-под обстрела';
      reasons.push(say('less-damage', `Переведём ${unit(piece)} сюда — по нему будут бить слабее.`, `Здесь по нашей фигуре будут бить слабее. Переведём ${unit(piece)} сюда.`, `Переставим ${unit(piece)} — на этой клетке он получит меньше урона.`));
    }
    if (shieldCanRetreat(forecast.piece, config) && !shieldCanRetreat(piece, config)) {
      title = reasons.length ? title : 'Превращаем щитоносца в ветерана';
      reasons.push(say('shield-veteran', 'Доведём щитоносца до чужого края.', 'Выведем щитоносца на чужой край. Получим ветерана.', 'Этим ходом щитоносец достигнет чужого края и станет ветераном.'));
    }
    if (archerHasEdgeBonus(forecast.piece, config) && !archerHasEdgeBonus(piece, config)) {
      title = 'Усиливаем лукаря на чужом краю';
      reasons.push(say('archer-veteran', 'Доведём лукаря до чужого края, чтобы он получил постоянную прибавку к урону.', 'Выведем лукаря на чужой край. Прибавка к урону останется с ним.', 'На чужом краю лукарь получит постоянное усиление атаки. Доведём его туда.'));
    }
    // Compare effective values and remove each provider to establish causality.
    // This also covers unblocking an existing aura, without crediting the mover for it.
    const auraBenefits = [];
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
        auraBenefits.push({ ally, source, fields });
      }
    }
    if (auraBenefits.length) {
      title = reasons.length ? title : 'Усиливаем строй';
      if (auraBenefits.length === 1) {
        const { ally, source, fields } = auraBenefits[0];
        const effect = join(fields.map(field => gains[field]));
        const increase = fields.length === 1 ? 'увеличится' : 'увеличатся';
        if (source.id === piece.id) reasons.push(say('aura-provider', `Подведём ${unit(piece)} к ${unit(ally, 1)}, чтобы увеличить ${effect}.`, `Поставим ${unit(piece)} ближе к ${unit(ally, 1)}. Увеличим ${effect}.`, `Подведём ${unit(piece)}: у ${unit(ally, 2)} ${increase} ${effect}.`));
        else if (ally.id === piece.id) reasons.push(say('aura-recipient', `Переведём ${unit(piece)} в ауру ${unit(source, 2)}, чтобы увеличить ${effect}.`, `Поставим ${unit(piece)} под действие ${unit(source, 2)}. Увеличим ${effect}.`, `Поставим ${unit(piece)} в ауру ${unit(source, 2)}. Получим прибавку: ${effect}.`));
        else reasons.push(say('aura-unblock', `Этим манёвром открываем ${unit(ally, 1)} ауру ${unit(source, 2)}, чтобы увеличить ${effect}.`, `Освободим путь ауре ${unit(source, 2)}. У ${unit(ally, 2)} ${increase} ${effect}.`, `Уберём преграду для ауры ${unit(source, 2)}, чтобы увеличить ${effect} у ${unit(ally, 2)}.`));
      } else {
        // One clause per actual bonus, with each recipient listed only once.
        const effects = Object.keys(gains).flatMap(field => {
          const recipients = [...new Map(auraBenefits.filter(b => b.fields.includes(field)).map(b => [b.ally.id, b.ally])).values()];
          return recipients.length ? [`${gains[field]} у ${beneficiaryNames(recipients)}`] : [];
        }).join('; ');
        reasons.push(say('aura-group', `Переместим ${unit(piece)}: увеличим ${effects}.`, `Этим манёвром увеличим ${effects}.`, `Переставим ${unit(piece)}. Прибавка от аур: ${effects}.`));
      }
    }
    const targets = forecast.position.pieces.filter(p => p.team !== team && after.get(p.id).attackers.some(a => a.id === piece.id));
    const newTargets = targets.filter(p => !before.get(p.id).attackers.some(a => a.id === piece.id));
    if (newTargets.length && !enemyLosses.length) {
      title = reasons.length ? title : 'Готовим совместную атаку';
      const supported = newTargets.some(p => after.get(p.id).attackers.length > 1);
      reasons.push(supported
        ? say('joint-attack', 'Подключаем бойца к общему удару. Урона пока не хватает.', `Добавим ${unit(piece)} к общей атаке. Даже вместе пока не справляемся.`, `Подключим ${unit(piece)} к удару по противнику. Урона всё ещё недостаточно.`)
        : say('new-attack', `Выведем ${unit(piece)} на ${names(newTargets)} противника. Одной этой атаки пока не хватит.`, `Отсюда сможем атаковать ${names(newTargets)} противника. Убрать одной атакой пока не получится.`, `Выведем ${unit(piece)} на ${names(newTargets)} противника. Для уничтожения цели понадобится больше урона.`));
    }
    if (!reasons.length) {
      const enemyFlag = state.pieces.find(p => p.team !== team && p.type === 'defenseLamp');
      const controlled = (p, position) => new Set(cells(config).filter(c => attacks(p, { ...c, id: '__hint_probe', type: 'archer', team: 1 - team }, position, config, effective(p, position, config))).map(c => `${c.q},${c.r}`));
      const oldControl = controlled(piece, state), newControl = controlled(forecast.piece, forecast.position);
      if ([...newControl].some(cell => !oldControl.has(cell))) {
        title = 'Занимаем новую линию атаки';
        reasons.push(say('new-cells', `Переставим ${unit(piece)} сюда, чтобы держать под обстрелом новые клетки.`, `Сместим ${unit(piece)}: отсюда достанем клетки, которые раньше не простреливали.`, `Переместим ${unit(piece)} сюда. Под обстрел попадут новые участки поля.`));
      } else if (enemyFlag && distance(forecast.piece, enemyFlag, config) < distance(piece, enemyFlag, config)) {
        title = 'Подводим фигуру к вражескому знамени';
        reasons.push(say('approach-flag', `Подведём ${unit(piece)} ближе к вражескому знамени.`, `Переведём ${unit(piece)} ближе к вражескому знамени.`, `Продвинем ${unit(piece)} к знамени противника.`));
      } else {
        title = 'Перестраиваем армию';
        reasons.push(say('quiet', `Пока переставим ${unit(piece)} сюда. Прямой выгоды этот ход ещё не даёт.`, `Переставим ${unit(piece)}. Немедленного выигрыша от этого хода нет.`, `Пока переместим ${unit(piece)} сюда. Явного преимущества этот ход ещё не даёт.`));
      }
    }
  }
  if (ownLosses.length) reasons.push(say('own-loss', `Этот манёвр будет стоить нам ${names(ownLosses, 2)}.`, `За этот манёвр заплатим потерей ${names(ownLosses, 2)}.`, `После этого хода потеряем ${names(ownLosses)}.`));
  if (action.pass && !reasons.length) { title = 'Передаём инициативу'; reasons.push(say('pass', 'Оставляем фигуры на месте и передаём ход противнику.', 'Пропускаем ход, никого не перемещаем.', 'Никого не перемещаем, передаём ход противнику.')); }
  return { title, reasons: reasons.slice(0, 3).concat(reasons.length > 3 && ownLosses.length ? [reasons.at(-1)] : []).map(({ key, variants }) => voice(key, variants)) };
}
