import { createStrategyPolicy } from './formation-strategy.mjs';

// Use the checked formation policy unchanged in both module and bundled Workers.
const formationPolicy = createStrategyPolicy('formation');
export const chooseBotAction = formationPolicy.chooseBotAction;
export const botPositionKey = formationPolicy.botPositionKey;
