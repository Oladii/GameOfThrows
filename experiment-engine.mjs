import { clone, cells, reachable as baseReachable, move as baseMove, resolve } from './dist/engine.js';

export function createExperiment(config, rule = 'none') {
  if (!['none', 'shield_edge_sideways', 'immobility_loss', 'combat_loss'].includes(rule)) throw new Error('Unknown experiment rule');
  if (rule === 'shield_edge_sideways' && config.stats.shield.move !== 1) throw new Error('Edge experiment requires shield move 1');
  const board = new Set(cells(config).map(c => `${c.q},${c.r}`));
  const farRow = team => config.geometry === 'hex' ? (team === 0 ? config.size : -config.size) : (team === 0 ? config.size - 1 : 0);
  const atEdge = piece => rule === 'shield_edge_sideways' && piece.type === 'shield' && piece.r === farRow(piece.team);
  function reachable(piece, state) {
    if (!atEdge(piece)) return baseReachable(piece, state, config);
    return [-1, 1].map(dq => ({ q: piece.q + dq, r: piece.r, steps: 1 })).filter(c => board.has(`${c.q},${c.r}`) && !state.pieces.some(p => p.q === c.q && p.r === c.r));
  }
  function adjudicate(state) {
    if (state.winner !== null) return { state, adjudication: null };
    let winner = null;
    if (rule === 'combat_loss') {
      const combat = [0, 1].map(team => state.pieces.some(p => p.team === team && ['shield', 'archer'].includes(p.type)));
      winner = !combat[0] && !combat[1] ? 'draw' : !combat[0] ? 1 : !combat[1] ? 0 : null;
    }
    if (rule === 'immobility_loss' && !state.pieces.some(p => p.team === state.turn && reachable(p, state).length)) winner = 1 - state.turn;
    return winner === null ? { state, adjudication: null } : { state: { ...state, winner }, adjudication: { rule, winner } };
  }
  function move(state, id, to) {
    const piece = state.pieces.find(p => p.id === id);
    let outcome;
    if (piece && atEdge(piece)) {
      if (state.winner !== null || piece.team !== state.turn || !reachable(piece, state).some(c => c.q === to.q && c.r === to.r)) throw new Error('Illegal experimental move');
      const next = clone(state), moving = next.pieces.find(p => p.id === id); moving.q = to.q; moving.r = to.r;
      outcome = resolve(next, config); outcome.state.turn = 1 - state.turn; outcome.state.ply = state.ply + 1;
      outcome.action = { team: piece.team, type: piece.type, from: { q: piece.q, r: piece.r }, to: { q: to.q, r: to.r } };
    } else outcome = baseMove(state, config, id, to);
    return { ...outcome, ...adjudicate(outcome.state) };
  }
  return { reachable, move, initial: state => adjudicate(state).state };
}
