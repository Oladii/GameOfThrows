import { TYPES, DEFAULT_CONFIG, PREVIOUS_SCOUT_CONFIG } from './rules.js';
export const clone = value => JSON.parse(JSON.stringify(value));
export const key = (q, r) => `${q},${r}`;
const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const SQUARE_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const directions = config => config.geometry === 'hex' ? HEX_DIRS : SQUARE_DIRS.slice(0, config.experiments.squareDiagonals ? 8 : 4);
const farRow = (team, config) => config.geometry === 'hex' ? (team === 0 ? config.size : -config.size) : (team === 0 ? config.size - 1 : 0);
export const shieldCanRetreat = (piece, config) => piece.type === 'shield' && (piece.reachedFarEdge === true || piece.r === farRow(piece.team, config));
// Permanent personal archer promotion, independent of shield veteran auras.
export const archerHasEdgeBonus = (piece, config) => piece.type === 'archer' && config.archerEdgeDamageBonus > 0 && (piece.archerReachedFarEdge === true || piece.r === farRow(piece.team, config));
const promotionStats = config => config.shieldPromotion ?? PREVIOUS_SCOUT_CONFIG.shieldPromotion;
const alliedPromotionStats = config => promotionStats(config).allies ?? promotionStats(config);
export const isCombatUnit = piece => piece.type === 'shield' || piece.type === 'archer';
export function winnerForPieces(pieces, config) {
  const alive = [0, 1].map(team => config.victoryCondition === 'flag-or-combat'
    ? pieces.some(p => p.team === team && isCombatUnit(p)) && pieces.some(p => p.team === team && p.type === 'defenseLamp')
    : pieces.some(piece => piece.team === team && (config.victoryCondition !== 'combat-units' || isCombatUnit(piece))));
  return !alive[0] && !alive[1] ? 'draw' : !alive[0] ? 1 : !alive[1] ? 0 : null;
}
export function cells(config) {
  const out = [];
  if (config.geometry === 'hex') {
    for (let q = -config.size; q <= config.size; q++) for (let r = -config.size; r <= config.size; r++) {
      if (Math.abs(q + r) <= config.size) out.push({ q, r });
    }
  } else for (let q = 0; q < config.size; q++) for (let r = 0; r < config.size; r++) out.push({ q, r });
  return out;
}
export function distance(a, b, config) {
  const q = a.q - b.q, r = a.r - b.r;
  if (config.geometry === 'hex') return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
  return config.experiments.squareDiagonals ? Math.max(Math.abs(q), Math.abs(r)) : Math.abs(q) + Math.abs(r);
}
export function validateConfig(input) {
  const config = clone(input);
  if (!config || !['hex', 'square'].includes(config.geometry)) throw new Error('Неизвестный тип поля.');
  const number = (n, min, max, label) => { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: нужно целое число от ${min} до ${max}.`); };
  number(config.size, config.geometry === 'hex' ? 3 : 6, config.geometry === 'hex' ? 6 : 12, 'Размер поля');
  if (config.archerEdgeDamageBonus !== undefined) number(config.archerEdgeDamageBonus, 0, 20, 'Усиление лукаря за край');
  config.auraDefenseCap ??= -1;
  number(config.auraDefenseCap, -1, 20, 'Предел защиты от аур');
  if (config.drumShieldMoveBonus !== undefined) number(config.drumShieldMoveBonus, 0, 6, 'Бонус шага от барабанщика');
  if (config.drumMoveAllies !== undefined && typeof config.drumMoveAllies !== 'boolean') throw new Error('Неверное правило шага союзников.');
  if (config.centerArchers !== undefined && typeof config.centerArchers !== 'boolean') throw new Error('Неверная расстановка лукарей.');
  if (config.shieldDefenseOnly !== undefined && typeof config.shieldDefenseOnly !== 'boolean') throw new Error('Неверное правило защиты броненосцев.');
  if (config.victoryCondition !== undefined && !['all-units', 'combat-units', 'flag-or-combat'].includes(config.victoryCondition)) throw new Error('Неизвестное условие окончания партии.');
  if (config.deploymentOffset !== undefined) number(config.deploymentOffset, 0, 1, 'Отступ начальной расстановки');
  if (!config.army || !config.stats || !config.experiments) throw new Error('Неполные настройки.');
  // Historical saves have no scout; extend the schema without adding units to a running game.
  config.army.scoutLamps ??= 0;
  config.stats.scoutLamp ??= clone(PREVIOUS_SCOUT_CONFIG.stats.scoutLamp);
  for (const field of ['groups', 'shields', 'archers', 'attackLamps', 'defenseLamps', 'scoutLamps']) number(config.army[field], 0, field === 'groups' ? 6 : 12, 'Состав армии');
  for (const field of ['centralShields', 'rearArchers', 'rearShields']) if (config.army[field] !== undefined) number(config.army[field], 0, 12, 'Фигуры в центре');
  if (config.army.rearSupportOffset !== undefined) number(config.army.rearSupportOffset, 0, 1, 'Отступ поддержки');
  if (config.army.horns !== undefined) number(config.army.horns, 0, 12, 'Горнисты');
  for (const type of TYPES) {
    // Old imported configurations may omit the horn schema when no horns are present.
    if (type === 'horn' && !config.stats.horn && !(config.army.horns > 0)) continue;
    const stats = config.stats[type];
    if (!stats) throw new Error('В настройках отсутствует тип фигуры.');
    for (const field of ['move', 'damage', 'range', 'fortitude', 'aura', 'damageBonus', 'rangeBonus', 'defenseBonus']) {
      number(stats[field], field === 'move' ? 1 : 0, field === 'move' ? 6 : 20, `${type}.${field}`);
    }
  }
  const unsupported = {
    shield: ['damageBonus', 'rangeBonus'],
    archer: ['rangeBonus', 'defenseBonus'],
    attackLamp: ['defenseBonus'],
    ...(config.stats.horn ? { horn: ['damage', 'range', 'rangeBonus', 'defenseBonus'] } : {}),
    scoutLamp: ['damageBonus', 'defenseBonus'],
    defenseLamp: ['damage', 'range', 'damageBonus', 'rangeBonus']
  };
  for (const [type, fields] of Object.entries(unsupported)) for (const field of fields) {
    if (config.stats[type][field] !== 0) throw new Error(`${type} не поддерживает параметр ${field}: требуется 0.`);
  }
  config.shieldPromotion ??= clone(PREVIOUS_SCOUT_CONFIG.shieldPromotion);
  config.shieldPromotion.maxRange ??= PREVIOUS_SCOUT_CONFIG.shieldPromotion.maxRange;
  for (const field of ['aura', 'damageBonus', 'rangeBonus', 'defenseBonus', 'maxRange']) number(config.shieldPromotion[field], 0, 20, `shieldPromotion.${field}`);
  if (config.shieldPromotion.allies !== undefined) {
    if (!config.shieldPromotion.allies || typeof config.shieldPromotion.allies !== 'object' || Array.isArray(config.shieldPromotion.allies)) throw new Error('Неверная аура ветерана для союзников.');
    for (const field of ['aura', 'damageBonus', 'rangeBonus', 'defenseBonus']) number(config.shieldPromotion.allies[field], 0, 20, `shieldPromotion.allies.${field}`);
  }
  for (const field of Object.keys(DEFAULT_CONFIG.experiments)) if (typeof config.experiments[field] !== 'boolean') throw new Error('Неверный переключатель правила.');
  config.version = 1;
  return config;
}
export function validateState(input, config) {
  const state = clone(input);
  if (!state || !Array.isArray(state.pieces) || ![0, 1].includes(state.turn)) throw new Error('Неверная позиция.');
  if (!Number.isInteger(state.ply) || state.ply < 0) throw new Error('Неверный номер хода.');
  const board = new Set(cells(config).map(c => key(c.q, c.r))), positions = new Set(), ids = new Set();
  for (const p of state.pieces) {
    if (!p || !TYPES.includes(p.type) || ![0, 1].includes(p.team) || typeof p.id !== 'string' || !/^[\w-]{1,60}$/.test(p.id)) throw new Error('Неверная фигура.');
    const pos = key(p.q, p.r);
    if (!Number.isInteger(p.q) || !Number.isInteger(p.r) || !board.has(pos) || positions.has(pos) || ids.has(p.id)) throw new Error('Позиция содержит пересечение фигур или клетку вне поля.');
    positions.add(pos); ids.add(p.id);
    if (p.group != null && (!Number.isInteger(p.group) || p.group < 1 || p.group > 100)) throw new Error('Неверная группа.');
    if (p.reachedFarEdge !== undefined && (p.type !== 'shield' || typeof p.reachedFarEdge !== 'boolean')) throw new Error('Неверный признак достижения края броненосцем.');
    if (shieldCanRetreat(p, config)) p.reachedFarEdge = true;
    if (p.archerReachedFarEdge !== undefined && (p.type !== 'archer' || typeof p.archerReachedFarEdge !== 'boolean')) throw new Error('Неверный признак достижения края лукарем.');
    if (archerHasEdgeBonus(p, config)) p.archerReachedFarEdge = true;
  }
  if (![null, 0, 1, 'draw'].includes(state.winner)) throw new Error('Неверный результат партии.');
  if (['combat-units', 'flag-or-combat'].includes(config.victoryCondition)) state.winner = winnerForPieces(state.pieces, config);
  return state;
}
function roundCube(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}
export function lineBetween(a, b, config) {
  const steps = config.geometry === 'hex' ? distance(a, b, config) : Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
  if (!steps) return [{ q: a.q, r: a.r }];
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const q = a.q + (b.q - a.q) * t, r = a.r + (b.r - a.r) * t;
    const c = config.geometry === 'hex' ? roundCube(q + 1e-6, r + 1e-6) : { q: Math.round(q), r: Math.round(r) };
    if (!out.length || key(c.q, c.r) !== key(out.at(-1).q, out.at(-1).r)) out.push(c);
  }
  return out;
}
export function isRay(a, b, config) {
  const dq = b.q - a.q, dr = b.r - a.r;
  return directions(config).some(([q, r]) => q === 0 ? dq === 0 && dr * r > 0 : r === 0 ? dr === 0 && dq * q > 0 : dq / q === dr / r && dq / q > 0);
}
function blocked(a, b, state, config, aura = false) {
  if (aura && config.experiments.aurasThroughShields) return false;
  const occupied = new Map(state.pieces.map(p => [key(p.q, p.r), p]));
  for (const c of lineBetween(a, b, config).slice(1, -1)) {
    const p = occupied.get(key(c.q, c.r));
    if (!p) continue;
    if (aura ? p.type === 'shield' : p.team !== a.team && p.type === 'shield' && (a.type !== 'attackLamp' || config.experiments.lampShieldBlocking)) return true;
    if (!aura && p.team === a.team && !config.experiments.allyShotsPass) return true;
  }
  return false;
}
export function auraReaches(source, target, state, config) {
  // Empty cells still describe coverage; actual non-shield recipients get no ordinary shield aura.
  if (config.shieldDefenseOnly && source.type === 'shield' && target.type && target.type !== 'shield' && !shieldCanRetreat(source, config)) return false;
  const radius = shieldCanRetreat(source, config) ? alliedPromotionStats(config).aura : config.stats[source.type].aura;
  const separation = distance(source, target, config);
  const areaAura = ['attackLamp', 'defenseLamp', 'scoutLamp', 'horn'].includes(source.type);
  return separation > 0 && separation <= radius && (areaAura || isRay(source, target, config)) && !blocked(source, target, state, config, true);
}
export function effective(piece, state, config) {
  const stats = config.stats[piece.type];
  const sources = [];
  const veteran = shieldCanRetreat(piece, config), promotion = promotionStats(config);
  let damageBonus = veteran ? promotion.damageBonus : archerHasEdgeBonus(piece, config) ? config.archerEdgeDamageBonus : 0, rangeBonus = veteran ? promotion.rangeBonus : 0, defenseBonus = veteran ? promotion.defenseBonus : 0;
  let veteranSupport = false, moveBonus = 0;
  for (const source of state.pieces) {
    const veteranSource = shieldCanRetreat(source, config);
    if (source.id === piece.id || source.team !== piece.team || !veteranSource && !['shield', 'archer', 'attackLamp', 'defenseLamp', 'scoutLamp', 'horn'].includes(source.type)) continue;
    const aura = veteranSource ? alliedPromotionStats(config) : config.stats[source.type];
    if (!auraReaches(source, piece, state, config)) continue;
    if (veteranSource) veteranSupport = true;
    sources.push(source.id);
    if (source.type === 'attackLamp' && (config.drumMoveAllies === true || piece.type === 'shield')) moveBonus += config.drumShieldMoveBonus ?? 0;
    if (['attackLamp', 'archer', 'scoutLamp', 'horn'].includes(source.type) || veteranSource) {
      damageBonus += aura.damageBonus;
      if (piece.type !== 'shield') rangeBonus += aura.rangeBonus;
    }
    if ((['shield', 'defenseLamp'].includes(source.type) || veteranSource) && (!config.shieldDefenseOnly || source.type !== 'shield' || piece.type === 'shield')) defenseBonus += aura.defenseBonus;
  }
  if ((config.auraDefenseCap ?? -1) >= 0) {
    const personal = veteran ? promotion.defenseBonus : 0;
    defenseBonus = personal + Math.min(config.auraDefenseCap, defenseBonus - personal);
  }
  const support = ['attackLamp', 'defenseLamp', 'scoutLamp', 'horn'].includes(piece.type);
  const armedCommander = piece.type === 'scoutLamp' && stats.damage > 0 && stats.range > 0;
  const canAttack = !support || armedCommander || veteranSupport;
  const damage = canAttack ? stats.damage + damageBonus : 0;
  // An armed commander keeps its base attack reach; auras still grant its
  // damage, defense and movement. Legacy unarmed support keeps veteran range.
  const range = !canAttack ? 0 : armedCommander ? stats.range : support && stats.range === 0 ? Math.min(rangeBonus, 1) : piece.type === 'shield' ? Math.min(stats.range + rangeBonus, promotion.maxRange ?? PREVIOUS_SCOUT_CONFIG.shieldPromotion.maxRange) : stats.range + rangeBonus;
  return { damage, range, fortitude: stats.fortitude + defenseBonus, aura: veteran ? alliedPromotionStats(config).aura : stats.aura, move: stats.move + moveBonus, damageBonus: canAttack ? damageBonus : 0, rangeBonus: Math.max(0, range - stats.range), defenseBonus, sources };
}
export function attacks(attacker, target, state, config, stats = effective(attacker, state, config)) {
  if (attacker.id === target.id || attacker.team === target.team || stats.damage <= 0) return false;
  if (distance(attacker, target, config) > stats.range) return false;
  if (!isRay(attacker, target, config)) return false;
  return !blocked(attacker, target, state, config);
}
export const isLethalDamage = (incoming, fortitude) => incoming > 0 && incoming >= fortitude;
export function analyze(state, config) {
  const result = new Map();
  for (const piece of state.pieces) result.set(piece.id, { ...effective(piece, state, config), incoming: 0, attackers: [], dead: false });
  for (const attacker of state.pieces) for (const target of state.pieces) {
    const power = result.get(attacker.id);
    if (attacks(attacker, target, state, config, power)) {
      const record = result.get(target.id);
      record.incoming += power.damage;
      record.attackers.push({ id: attacker.id, damage: power.damage, type: attacker.type });
    }
  }
  for (const record of result.values()) record.dead = isLethalDamage(record.incoming, record.fortitude);
  return result;
}
// Hover/focus inspection uses the same pre-removal report as combat.
export function inspectCell(state, config, cell, selectedId = null, currentReport = analyze(state, config)) {
  const occupant = state.pieces.find(p => p.q === cell.q && p.r === cell.r);
  if (occupant) return { piece: occupant, position: state, report: currentReport, isPreview: false };
  const selected = state.pieces.find(p => p.id === selectedId);
  const route = selected && state.winner === null && selected.team === state.turn ? reachable(selected, state, config).find(c => c.q === cell.q && c.r === cell.r) : null;
  if (route) {
    const position = clone(state), piece = position.pieces.find(p => p.id === selectedId);
    piece.q = cell.q; piece.r = cell.r;
    if (route.reachedFarEdge) piece.reachedFarEdge = true;
    if (route.archerReachedFarEdge) piece.archerReachedFarEdge = true;
    return { piece, position, report: analyze(position, config), isPreview: true };
  }
  return { piece: selected || null, position: state, report: currentReport, isPreview: false };
}
export function resolve(state, config) {
  const next = clone(state), report = analyze(state, config);
  const deaths = state.pieces.filter(p => report.get(p.id).dead).map(p => ({ ...p, incoming: report.get(p.id).incoming, fortitude: report.get(p.id).fortitude }));
  const removed = new Set(deaths.map(p => p.id));
  next.pieces = next.pieces.filter(p => !removed.has(p.id));
  next.winner = winnerForPieces(next.pieces, config);
  return { state: next, deaths, report };
}
function movementSearch(piece, state, config, includePath = false) {
  const board = new Set(cells(config).map(c => key(c.q, c.r)));
  const occupied = new Map(state.pieces.map(p => [key(p.q, p.r), p]));
  const unlocked = shieldCanRetreat(piece, config) || archerHasEdgeBonus(piece, config);
  // Fix the allowance at the start, even when the destination leaves the aura.
  const movementAllowance = effective(piece, state, config).move;
  const seen = new Set([`${key(piece.q, piece.r)}:${unlocked}`]), out = new Map(), queue = [{ q: piece.q, r: piece.r, steps: 0, unlocked }];
  const parents = includePath ? [-1] : null, endpoints = includePath ? new Map() : null;
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current.steps >= movementAllowance) continue;
    for (const [dq, dr] of directions(config)) {
      if (piece.type === 'shield' && !current.unlocked && dr * (piece.team === 0 ? 1 : -1) < 0) continue;
      const q = current.q + dq, r = current.r + dr, pos = key(q, r);
      const reached = current.unlocked || ((piece.type === 'shield' || piece.type === 'archer' && config.archerEdgeDamageBonus > 0) && r === farRow(piece.team, config));
      const visit = `${pos}:${reached}`;
      if (!board.has(pos) || seen.has(visit)) continue;
      const blocking = occupied.get(pos);
      if (blocking && blocking.team !== piece.team) continue;
      seen.add(visit); queue.push({ q, r, steps: current.steps + 1, unlocked: reached });
      if (parents) parents.push(i);
      // If either route reaches the edge, use that route and retain its permission.
      if (!blocking && (!out.has(pos) || reached && !out.get(pos).reachedFarEdge && !out.get(pos).archerReachedFarEdge)) {
        out.set(pos, { q, r, steps: current.steps + 1, ...(piece.type === 'shield' && reached ? { reachedFarEdge: true } : {}), ...(piece.type === 'archer' && reached ? { archerReachedFarEdge: true } : {}) });
        if (endpoints) endpoints.set(pos, queue.length - 1);
      }
    }
  }
  return { out, queue, parents, endpoints };
}
export function reachable(piece, state, config) {
  return [...movementSearch(piece, state, config).out.values()];
}
export function movementPath(piece, state, config, destination) {
  if (!destination || !Number.isInteger(destination.q) || !Number.isInteger(destination.r)) return [];
  const { queue, parents, endpoints } = movementSearch(piece, state, config, true);
  let index = endpoints.get(key(destination.q, destination.r));
  if (index === undefined) return [];
  const path = [];
  while (index !== -1) {
    const { q, r } = queue[index];
    path.push({ q, r });
    index = parents[index];
  }
  return path.reverse();
}
export function move(state, config, id, destination) {
  if (state.winner !== null || ['combat-units', 'flag-or-combat'].includes(config.victoryCondition) && winnerForPieces(state.pieces, config) !== null) throw new Error('Партия завершена. Можно отменить ход или открыть расстановку.');
  const piece = state.pieces.find(p => p.id === id);
  if (!piece || piece.team !== state.turn) throw new Error('Сейчас ход другой команды.');
  const route = reachable(piece, state, config).find(c => c.q === destination.q && c.r === destination.r);
  if (!route) throw new Error('На эту клетку нельзя пойти.');
  const next = clone(state), moving = next.pieces.find(p => p.id === id);
  moving.q = destination.q; moving.r = destination.r;
  if (route.reachedFarEdge) moving.reachedFarEdge = true;
  if (route.archerReachedFarEdge) moving.archerReachedFarEdge = true;
  const outcome = resolve(next, config);
  outcome.state.turn = 1 - state.turn; outcome.state.ply = state.ply + 1;
  return { ...outcome, action: { team: piece.team, type: piece.type, from: { q: piece.q, r: piece.r }, to: destination } };
}
export function pass(state, config) {
  if (!config.experiments.allowPass) throw new Error('Пропуск хода выключен в настройках эксперимента.');
  if (state.winner !== null || ['combat-units', 'flag-or-combat'].includes(config.victoryCondition) && winnerForPieces(state.pieces, config) !== null) throw new Error('Партия завершена.');
  const outcome = resolve(state, config);
  outcome.state.turn = 1 - state.turn; outcome.state.ply = state.ply + 1;
  return outcome;
}
function mirror(c, config) { return config.geometry === 'hex' ? { q: -c.q, r: -c.r } : { q: config.size - 1 - c.q, r: config.size - 1 - c.r }; }
export function createGame(input) {
  const config = validateConfig(input), board = cells(config), pieces = [];
  const army = config.army, centralShields = army.centralShields ?? 0, rearArchers = army.rearArchers ?? 0, rearShields = army.rearShields ?? 0;
  const total = army.groups * (army.shields + army.archers) + army.attackLamps + army.defenseLamps + army.scoutLamps + centralShields + rearArchers + rearShields + (army.horns ?? 0);
  if (!total) throw new Error('Добавьте хотя бы одну фигуру в армию.');
  const side = board.filter(c => config.geometry === 'hex' ? c.r < 0 : c.r < Math.floor(config.size / 2));
  if (total > side.length) throw new Error(`Армия из ${total} фигур не помещается на своей половине (${side.length} клеток). Увеличьте поле или уменьшите состав.`);
  const occupied = new Set(), rowTarget = config.geometry === 'hex' ? -2 : Math.floor(config.size / 2) - 2;
  const centerX = c => config.geometry === 'hex' ? c.q + c.r / 2 : c.q - (config.size - 1) / 2;
  let id = 0;
  const chooseCell = target => side.filter(c => !occupied.has(key(c.q, c.r))).sort((a, b) => (Math.abs(a.r - target.r) * 3 + Math.abs(centerX(a) - target.x)) - (Math.abs(b.r - target.r) * 3 + Math.abs(centerX(b) - target.x)) || a.q - b.q)[0];
  const place = (type, group, target) => {
    const cell = chooseCell(target); occupied.add(key(cell.q, cell.r));
    const reflected = mirror(cell, config);
    pieces.push({ id: `p${++id}`, type, team: 0, q: cell.q, r: cell.r, group }, { id: `p${++id}`, type, team: 1, ...reflected, group });
  };
  // Reserve the rear centre for support before the groups fill that row.
  const banners = [['attackLamp', army.attackLamps], ['defenseLamp', army.defenseLamps]].flatMap(([type, count]) => Array(count).fill(type));
  for (const [index, type] of banners.entries()) place(type, null, { r: rowTarget - 1, x: index - (banners.length - 1) / 2 });
  // Scout occupies the rear centre; adding it keeps the existing two wings intact.
  for (let n = 0; n < army.scoutLamps; n++) place('scoutLamp', null, { r: rowTarget - 2, x: n - (army.scoutLamps - 1) / 2 });
  for (let group = 1; group <= army.groups; group++) {
    const x = (group - (army.groups + 1) / 2) * 3;
    for (let n = 0; n < army.shields; n++) place('shield', group, { r: rowTarget, x: x + (n - (army.shields - 1) / 2) });
    for (let n = 0; n < army.archers; n++) place('archer', group, { r: rowTarget - 1, x: x + n });
  }
  const rearSupportOffset = army.rearSupportOffset ?? (rearArchers || rearShields ? 1 : 0);
  if (rearSupportOffset) {
    // Keep the wings and scout fixed. Support retreats by one adjacent cell;
    // the two rearward hex directions let it flank the scout without overlap.
    const supports = pieces.filter(p => p.team === 0 && ['attackLamp', 'defenseLamp'].includes(p.type));
    for (const p of supports) occupied.delete(key(p.q, p.r));
    const rearSteps = config.geometry === 'hex' ? [0, 1] : config.experiments.squareDiagonals ? [0, -1, 1] : [0];
    for (const p of supports) {
      const cell = rearSteps.map(dq => ({ q: p.q + dq, r: p.r - 1 })).find(c => side.some(s => s.q === c.q && s.r === c.r) && !occupied.has(key(c.q, c.r)));
      if (!cell) throw new Error('Поддержку нельзя сдвинуть назад на одну клетку. Увеличьте поле или уменьшите состав.');
      occupied.add(key(cell.q, cell.r));
      const reflected = pieces[pieces.indexOf(p) + 1];
      Object.assign(p, cell); Object.assign(reflected, mirror(cell, config));
    }
  }
  for (let n = 0; n < centralShields; n++) place('shield', null, { r: rowTarget, x: n - (centralShields - 1) / 2 });
  const rearUnits = [...Array(rearShields).fill('shield'), ...Array(rearArchers).fill('archer')];
  for (const [n, type] of rearUnits.entries()) place(type, null, { r: rowTarget - 1, x: n - (rearUnits.length - 1) / 2 });
  if (config.centerArchers) {
    const archers = pieces.filter(p => p.team === 0 && p.type === 'archer').sort((a,b) => centerX(a) - centerX(b));
    for (const p of archers) occupied.delete(key(p.q,p.r));
    for (const [n,p] of archers.entries()) {
      const cell = chooseCell({ r: rowTarget - 1, x: n - (archers.length - 1) / 2 });
      occupied.add(key(cell.q,cell.r));
      const reflected = pieces[pieces.indexOf(p) + 1];
      Object.assign(p,cell); Object.assign(reflected,mirror(cell,config));
    }
  }
  // In the four-support formation the flag sits between drum and scout.
  // Reorder their cells after placing combat units so existing ids and wings stay stable.
  if ((army.horns ?? 0) > 0 && rearSupportOffset && config.geometry === 'hex' && army.defenseLamps === 1 && army.scoutLamps === 1) {
    const flag = pieces.find(p => p.team === 0 && p.type === 'defenseLamp');
    const scout = pieces.find(p => p.team === 0 && p.type === 'scoutLamp');
    if (flag.r === scout.r && flag.q > scout.q) {
      const flagCell = { q: flag.q, r: flag.r }, scoutCell = { q: scout.q, r: scout.r };
      Object.assign(flag, scoutCell); Object.assign(pieces[pieces.indexOf(flag) + 1], mirror(scoutCell, config));
      Object.assign(scout, flagCell); Object.assign(pieces[pieces.indexOf(scout) + 1], mirror(flagCell, config));
    }
  }
  // Append horns after the existing army so old piece ids retain their meaning.
  for (let n = 0; n < (army.horns ?? 0); n++) place('horn', null, { r: rowTarget - 2, x: -2 - n });
  // Screenshot-approved local13 formation. Keep the existing pair ids and
  // combat groups; only their deployment cells change. Other army shapes keep
  // the generic placement above, including all legacy imports without horns.
  const local13Formation = config.geometry === 'hex' && config.size >= 5 && config.centerArchers && rearSupportOffset === 1
    && army.groups === 2 && army.shields === 2 && army.archers === 2 && centralShields === 1
    && rearArchers === 0 && rearShields === 0 && army.attackLamps === 1 && army.defenseLamps === 1
    && army.scoutLamps === 1 && army.horns === 1;
  if (local13Formation) {
    const north = pieces.filter(p => p.team === 0), archers = north.filter(p => p.type === 'archer');
    const setPair = (piece, q, r) => {
      Object.assign(piece, { q, r });
      Object.assign(pieces[pieces.indexOf(piece) + 1], { q: q === 0 ? 0 : -q, r: -r });
    };
    for (const [index, q] of [4, 3, 0, -1].entries()) setPair(archers[index], q, -3);
    for (const [type, q, r] of [['scoutLamp', 2, -3], ['defenseLamp', 1, -3], ['attackLamp', 3, -4], ['horn', 1, -4]]) {
      setPair(north.find(p => p.type === type), q, r);
    }
  }
  const offset = config.deploymentOffset ?? 0, boardKeys = new Set(board.map(c => key(c.q, c.r))), deployed = new Set();
  for (const piece of pieces) {
    if ((army.horns ?? 0) > 0 && Object.is(piece.q, -0)) piece.q = 0;
    piece.r += piece.team === 0 ? -offset : offset;
    const pos = key(piece.q, piece.r);
    if (!boardKeys.has(pos) || deployed.has(pos)) throw new Error('Начальная расстановка с выбранным отступом не помещается на поле. Увеличьте поле, уменьшите армию или измените отступ.');
    deployed.add(pos);
  }
  return { pieces, turn: 0, ply: 0, winner: ['combat-units', 'flag-or-combat'].includes(config.victoryCondition) ? winnerForPieces(pieces, config) : null };
}
export function createScenario(name, config) {
  if (name === 'start') return createGame(config);
  const row = config.geometry === 'hex' ? 0 : Math.floor(config.size / 2);
  const offset = config.geometry === 'hex' ? -3 : 0;
  const specs = name === 'adjacent' ? [[0, 'archer', 0], [1, 'archer', 0], [2, 'shield', 0], [3, 'shield', 1], [4, 'archer', 1], [5, 'archer', 1]] : [[0, 'archer', 0], [1, 'archer', 0], [2, 'shield', 0], [4, 'shield', 1], [5, 'archer', 1], [6, 'archer', 1]];
  if (config.geometry === 'square' && config.size < 7 && name !== 'adjacent') throw new Error('Для этого сценария нужен квадрат хотя бы 7 × 7.');
  return { pieces: specs.map(([q, type, team], i) => ({ id: `s${i}`, q: q + offset, r: row, team, type, group: 1 })), turn: 0, ply: 0, winner: null };
}
