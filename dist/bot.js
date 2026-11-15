import { createStrategyPolicy } from './formation-strategy.mjs';

// Use the checked formation policy unchanged in both module and bundled Workers.
const formationPolicy = createStrategyPolicy('formation');
export const chooseBotAction = formationPolicy.chooseBotAction;
export const botPositionKey = formationPolicy.botPositionKey;

// Separate advice budget; ordinary opponent policies and their search stay unchanged.
export function chooseAdvisorAction(state, config, options = {}) {
  const started = performance.now(), budgetMs = options.budgetMs ?? 30000;
  const request = { ...options, advisor: true, adviceDiversity: true, forgiving: false, deadline: started + budgetMs };
  let completed = formationPolicy.chooseBotAction(state, config, { ...request, depth: 4, deadline: Infinity });
  if (completed.action && completed.stats.maxDepth > 0 && completed.stats.reason !== 'forced-win-three-ply') {
    try { completed = formationPolicy.chooseBotAction(state, config, { ...request, depth: 6 }); }
    catch (error) { if (error.name !== 'AdvisorSearchTimeout') throw error; completed.stats.budgetExhausted = true; }
  }
  completed.stats.advisor = true;
  completed.stats.elapsedMs = performance.now() - started;
  return completed;
}
