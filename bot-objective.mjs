export function botOutcomeScore(state, team, maxPlies, failedTest = false) {
  if (state.winner === team) return 1e7 - state.ply;
  if (state.winner !== null || state.ply >= maxPlies || failedTest) return -1e7 + state.ply;
  return null;
}
