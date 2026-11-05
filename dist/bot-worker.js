import { chooseBotAction } from './bot.js';

self.onmessage = event => {
  const { id, state, config, options } = event.data;
  try { self.postMessage({ id, result: chooseBotAction(state, config, options) }); }
  catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
