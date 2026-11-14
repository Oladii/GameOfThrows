import { LABELS } from './rules.js';
import { analyze, inspectCell, move, pass, shieldCanRetreat, archerHasEdgeBonus, attacks, cells, effective, distance } from './engine.js';

// Explain the purpose through verified changes in the position, not invented search thoughts.
export function explainHint(state, config, action) {
  if (!action) return { title: 'Сейчас нет допустимого хода', reasons: ['Ни одна фигура не может перейти на свободную клетку по действующим правилам.'] };
  const piece = action.pass ? null : state.pieces.find(p => p.id === action.id);
  const outcome = action.pass ? pass(state, config) : move(state, config, action.id, action.to);
  const before = analyze(state, config), team = state.turn;
  const forecast = piece ? inspectCell(state, config, action.to, piece.id) : { position: state, report: before };
  const after = forecast.report, reasons = [];
  let title = 'Улучшаем позицию';
  const names = pieces => [...new Set(pieces.map(p => LABELS[p.type].toLowerCase()))].join(', ');
  const ownLosses = outcome.deaths.filter(p => p.team === team), enemyLosses = outcome.deaths.filter(p => p.team !== team);
  const survivors = new Set(outcome.state.pieces.map(p => p.id));
  if (outcome.state.winner === team) {
    title = 'Завершаем партию победой';
    reasons.push(enemyLosses.some(p => p.type === 'defenseLamp') && config.victoryCondition === 'flag-or-combat'
      ? 'Уничтожаем вражеское знамя: соперник сразу проиграет. Продолжать позиционную борьбу уже не нужно.'
      : 'Этим ходом выполняем условие победы: соперник больше не сможет продолжить партию.');
  } else if (outcome.state.winner === 'draw') {
    title = 'Сводим партию к ничьей'; reasons.push('После взаимных потерь обе команды одновременно выполняют условие поражения. Победителя не будет.');
  } else if (outcome.state.winner !== null) {
    title = 'Безопасный ход не найден'; reasons.push('Этот вариант приводит к поражению. Не стоит принимать совет как гарантию спасения позиции.');
  } else if (enemyLosses.length) {
    title = 'Ослабляем армию соперника';
    reasons.push(`Убираем из боя вражеские фигуры: ${names(enemyLosses)}. Это сокращает силы, которыми соперник сможет атаковать и прикрывать свою армию.`);
  }
  const rescued = state.pieces.filter(p => p.team === team && before.get(p.id).dead && survivors.has(p.id));
  if (rescued.length) {
    if (!enemyLosses.length && outcome.state.winner === null) title = 'Спасаем фигуры от гибели';
    reasons.push(`Выводим из-под смертельной угрозы союзные фигуры: ${names(rescued)}. Они переживут ближайший расчёт и останутся в бою.`);
  }
  if (piece && outcome.state.winner === null) {
    const oldStats = before.get(piece.id), newStats = after.get(piece.id);
    if (!newStats.dead && newStats.incoming < oldStats.incoming && !rescued.some(p => p.id === piece.id)) {
      title = reasons.length ? title : 'Уходим из-под обстрела';
      reasons.push('Снижаем давление на выбранную фигуру: на новой клетке по ней смогут стрелять слабее. Так её труднее уничтожить совместной атакой.');
    }
    if (shieldCanRetreat(forecast.piece, config) && !shieldCanRetreat(piece, config)) {
      title = reasons.length ? title : 'Превращаем броненосца в ветерана';
      reasons.push('Достигаем дальнего края, чтобы получить постоянное усиление и возможность отступать. Ветерана будет проще сохранить и использовать для поддержки союзников.');
    }
    if (archerHasEdgeBonus(forecast.piece, config) && !archerHasEdgeBonus(piece, config)) {
      title = 'Усиливаем лучника на чужом краю';
      reasons.push('Достигаем края ради постоянного усиления атаки. После отхода лукарь сохранит прибавку к урону и венок, поэтому его можно вернуть к союзникам для совместного удара.');
    }
    const benefits = new Set();
    for (const ally of forecast.position.pieces.filter(p => p.team === team && p.id !== piece.id && survivors.has(p.id))) {
      for (const field of ['damage', 'fortitude', 'move', 'range']) if (after.get(ally.id)[field] > before.get(ally.id)[field]) benefits.add(field);
    }
    if (benefits.size) {
      title = reasons.length ? title : 'Усиливаем строй';
      const goals = { damage: 'союзники смогут сильнее бить общую цель', fortitude: 'союзникам будет легче пережить ответную атаку', move: 'союзники смогут быстрее занять нужные клетки', range: 'союзники смогут доставать противника с более безопасного расстояния' };
      reasons.push(`Переносим поддержку ближе к своим фигурам: ${[...benefits].map(field => goals[field]).join('; ')}.`);
    }
    const targets = forecast.position.pieces.filter(p => p.team !== team && after.get(p.id).attackers.some(a => a.id === piece.id));
    const newTargets = targets.filter(p => !before.get(p.id).attackers.some(a => a.id === piece.id));
    if (newTargets.length && !enemyLosses.length) {
      title = reasons.length ? title : 'Готовим совместную атаку';
      const supported = newTargets.some(p => after.get(p.id).attackers.length > 1);
      reasons.push(supported
        ? 'Выводим фигуру на линию огня по цели, которую уже атакуют союзники. Так собираем удар нескольких фигур в одном месте. Сейчас его ещё недостаточно для уничтожения — потребуется усиление или ещё один атакующий.'
        : 'Выводим фигуру на линию огня по противнику, чтобы подготовить совместный удар. Одна эта атака пока не уничтожает цель: к ней нужно подключить союзников, потому что урон между ходами не сохраняется.');
    }
    if (!reasons.length) {
      const enemyFlag = state.pieces.find(p => p.team !== team && p.type === 'defenseLamp');
      const controlled = (p, position) => new Set(cells(config).filter(c => attacks(p, { ...c, id: '__hint_probe', type: 'archer', team: 1 - team }, position, config, effective(p, position, config))).map(c => `${c.q},${c.r}`));
      const oldControl = controlled(piece, state), newControl = controlled(forecast.piece, forecast.position);
      if ([...newControl].some(cell => !oldControl.has(cell))) {
        title = 'Занимаем новую линию атаки';
        reasons.push('С новой позиции держим под огнём клетки, которые раньше не доставали. Это даёт больше вариантов для следующей атаки; немедленного уничтожения противника этот ход не даёт.');
      } else if (enemyFlag && distance(forecast.piece, enemyFlag, config) < distance(piece, enemyFlag, config)) {
        title = 'Подводим фигуру к вражескому знамени';
        reasons.push('Сокращаем расстояние до важной цели, чтобы в следующих ходах было проще вывести фигуру на атаку. Этот шаг сам по себе ещё не угрожает уничтожением знамени.');
      } else {
        title = 'Перестраиваем армию';
        reasons.push('Это подготовительная перестановка: прямого выигрыша фигур или усиления сейчас нет. По оценке бота она оставляет более выгодное продолжение, но конкретной тактической выгоды на ближайшем расчёте не видно.');
      }
    }
  }
  if (ownLosses.length) reasons.push(`Цена этого плана — потеря союзных фигур: ${names(ownLosses)}. Учитывайте этот размен перед ходом.`);
  if (action.pass && !reasons.length) { title = 'Передаём инициативу'; reasons.push('Оставляем строй на месте и передаём ход сопернику. По оценке бота доступные перестановки менее выгодны, чем ожидание.'); }
  return { title, reasons: reasons.slice(0, 3).concat(reasons.length > 3 && ownLosses.length ? [reasons.at(-1)] : []) };
}
