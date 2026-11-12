/** Exact native one-reply non-loss check. No heuristic, beam, or budget.
 * `safe` promises only absence of a terminal enemy win through the next reply.
 * A position with no legal reply is not labelled a win.
 */
export function oneReplySafety(position, team, legalActions, simulate) {
  if (position.winner === team) return { safe: true, status: 'own-win', replies: 0 };
  if (position.winner === 'draw') return { safe: true, status: 'draw', replies: 0 };
  if (position.winner !== null) return { safe: false, status: 'opponent-win', replies: 0 };
  const actions = legalActions(position);
  let replies = 0;
  for (const action of actions) {
    const outcome = simulate(position, action); replies++;
    if (outcome.state.winner === 1 - team) return { safe: false, status: 'opponent-reply-win', replies };
  }
  return { safe: true, status: actions.length ? 'safe-one-reply' : 'no-legal-replies', replies };
}
