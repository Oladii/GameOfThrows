import { DEFAULT_CONFIG, LABELS, TEAM_NAMES } from './rules.js';
import { renderTokenBody } from './token-presentation.js';
import { clone, cells, analyze, inspectCell, movementPath, move } from './engine.js';
import { lessonPolygonPoints } from './onboarding-examples.js';
import { unitAppearance, renderDeathEffects, renderMovingToken } from './board-presentation.js';

// Native teams: blue North above, orange South below, as in the default game.
export const showcasePoint = cell => ({ x: 280 + Math.sqrt(3) * 30 * (cell.q + cell.r / 2), y: 205 + 45 * cell.r });
const showcasePiece = (id, type, team, q, r) => ({ id, type, team, q, r });
export const SHOWCASE_MOVES = [
  { id: 's-commander', to: { q: 0, r: 1 }, comment: 'Подвожу командира. Он бьёт на две клетки; знамя пока слишком далеко.' },
  { id: 'n-shield', to: { q: 2, r: 0 }, comment: 'Щит Севера меняет фланг. Лукарь продолжает искать линию выстрела.' },
  { id: 's-commander', to: { q: 0, r: 0 }, comment: 'Командир наносит 3 урона знамени. У Севера остались бойцы, но потеря флага уже означает поражение.' }
];
let showcaseFrames = null;
function buildShowcaseFrames() {
  const config = clone(DEFAULT_CONFIG); config.geometry = 'hex'; config.size = 3;
  // A compact battle with both flags uses the real current match-ending rule.
  const initial = { pieces: [
    showcasePiece('n-flag', 'defenseLamp', 0, 0, -2), showcasePiece('n-shield', 'shield', 0, 2, -1), showcasePiece('n-bow', 'archer', 0, 3, -3),
    showcasePiece('s-commander', 'scoutLamp', 1, 0, 2), showcasePiece('s-flag', 'defenseLamp', 1, -3, 2), showcasePiece('s-bow', 'archer', 1, -3, 1)
  ], turn: 1, ply: 0, winner: null };
  const frames = [{ before: initial, position: initial, action: null, moverId: null, path: [], deaths: [],
    comment: 'У обеих сторон есть знамя и боевые фигуры. Юг начинает; можно победить, уничтожив вражеский флаг.' }];
  let position = initial;
  for (const entry of SHOWCASE_MOVES) {
    const before = position, mover = before.pieces.find(piece => piece.id === entry.id);
    const path = movementPath(mover, before, config, entry.to);
    const outcome = move(before, config, entry.id, entry.to);
    position = outcome.state;
    frames.push({ before, position, action: outcome.action, moverId: entry.id, path, deaths: outcome.deaths, comment: entry.comment });
  }
  return { config, frames };
}

export function createShowcaseBattle(step = 0) {
  showcaseFrames ||= buildShowcaseFrames();
  const index = Math.max(0, Math.min(SHOWCASE_MOVES.length, Math.trunc(Number(step) || 0)));
  const { config, frames } = showcaseFrames, frame = clone(frames[index]);
  return { ...frame, config: clone(config), index, total: SHOWCASE_MOVES.length, point: showcasePoint,
    beforeReport: analyze(frame.before, config), displayReport: analyze(frame.position, config) };
}

export function renderShowcaseBattle(step, icons, renderBadges = () => '', animation = null) {
  const battle = createShowcaseBattle(step), phase = animation?.phase || 'idle', busy = phase !== 'idle';
  const position = phase === 'movement' ? battle.before : battle.position;
  const forecast = phase === 'movement' ? inspectCell(battle.before, battle.config, battle.action.to, battle.moverId) : null;
  const report = forecast?.report || battle.displayReport;
  const tiles = cells(battle.config).map(cell => `<g class="lesson-tile${battle.action && battle.action.to.q === cell.q && battle.action.to.r === cell.r ? ' showcase-arrival' : ''}"><polygon points="${lessonPolygonPoints(showcasePoint(cell), -30)}"/></g>`).join('');
  const pieces = position.pieces.map(piece => {
    const p = showcasePoint(piece), info = report.get(piece.id), appearance = unitAppearance(piece, battle.config, icons);
    return `<g class="piece ${piece.team ? 'south' : 'north'}${appearance.veteran ? ' veteran' : ''}${info.dead ? ' fatal' : ''}${phase === 'movement' && piece.id === battle.moverId ? ' moving-origin' : ''}" data-showcase-piece="${piece.id}" transform="translate(${p.x},${p.y})"><title>${TEAM_NAMES[piece.team]}: ${LABELS[piece.type]}</title>${renderTokenBody(appearance, piece.team)}${renderBadges(info, { showIncoming: busy, pieceType: piece.type, veteran: appearance.veteran })}</g>`;
  }).join('');
  const movingPiece = phase === 'movement' ? battle.before.pieces.find(piece => piece.id === battle.moverId) : null;
  const moving = movingPiece ? renderMovingToken(movingPiece, animation.frame || { ...showcasePoint(movingPiece), progress: 0 }, icons, 'lesson-moving-token-showcase', battle.config, movingPiece.team, report.get(movingPiece.id)) : '';
  const deaths = phase === 'deaths' ? `<g class="death-effects" aria-hidden="true">${renderDeathEffects(battle.deaths, showcasePoint, lessonPolygonPoints({ x: 0, y: 0 }, -30), icons, battle.config)}</g>` : '';
  const commentTeam = battle.action?.team ?? battle.position.turn;
  const counts = [0, 1].map(team => battle.position.pieces.filter(piece => piece.team === team).length);
  const turn = battle.position.winner === 1 ? 'Юг победил' : battle.action ? `Ход ${battle.index} · ${TEAM_NAMES[battle.action.team]}: ${LABELS[battle.action.type].toLowerCase()}` : 'Исходная позиция';
  const chevron = right => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${right ? 'm9 5 7 7-7 7' : 'm15 5-7 7 7 7'}"/></svg>`;
  return `<section class="lesson-scene showcase-scene" data-showcase-battle aria-labelledby="showcase-title"><div class="lesson-scene-heading"><h4 id="showcase-title">Показательный бой</h4><p>Листай три легальных хода стрелками. Действуют текущие характеристики и настоящее правило потери знамени. Юг — оранжевый, Север — синий.</p></div><div class="lesson-layout"><div class="lesson-field"><svg class="lesson-board showcase-board" aria-busy="${busy}" viewBox="70 10 420 390" role="img" aria-label="Показательный бой, ход ${battle.index}. Фигуры Севера: ${counts[0]}. Фигуры Юга: ${counts[1]}.">${tiles}${pieces}${deaths}${moving}</svg><p class="showcase-legend"><span><i class="north"></i> Север · ${counts[0]}</span><span><i class="south"></i> Юг · ${counts[1]}</span></p></div><div class="lesson-details showcase-details"><p class="showcase-turn" role="status">${turn}</p><div class="showcase-comments" aria-live="polite"><div class="showcase-comment ${commentTeam ? 'south' : 'north'}"><strong>${TEAM_NAMES[commentTeam]}</strong><p>${battle.comment}</p></div></div><div class="showcase-controls"><button type="button" class="button outline" data-showcase-action="prev" aria-label="Предыдущий ход показательного боя"${battle.index === 0 ? ' disabled' : ''}>${chevron(false)}</button><span class="showcase-progress">${battle.index === 0 ? 'Начало' : `${battle.index} из ${battle.total}`}</span><button type="button" class="button primary" data-showcase-action="next" aria-label="Следующий ход показательного боя"${busy || battle.index === battle.total ? ' disabled' : ''}>${chevron(true)}</button></div></div></div></section>`;
}
