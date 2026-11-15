import { DEFAULT_BOT_DIFFICULTY, BOT_DIFFICULTIES } from './bot-client.js';

export const DEFAULT_START_CHOICES = Object.freeze({ firstMove: 'random', humanTeam: 1, botDifficulty: DEFAULT_BOT_DIFFICULTY });
// Defaults in saves written before explicit-choice tracking was introduced.
const LEGACY_START_CHOICES = Object.freeze({ firstMove: 'random', humanTeam: 1, botDifficulty: 'training' });
const validChoice = (key, value) => key === 'firstMove' ? ['north', 'south', 'random'].includes(value)
  : key === 'humanTeam' ? value === 0 || value === 1 : typeof value === 'string' && Object.hasOwn(BOT_DIFFICULTIES, value);

export function resolveStartChoices(input = {}, defaults = DEFAULT_START_CHOICES) {
  const choices = {}, explicit = {};
  for (const key of Object.keys(DEFAULT_START_CHOICES)) {
    const valid = validChoice(key, input[key]);
    const previousDefault = validChoice(key, input.defaults?.[key]) ? input.defaults[key] : LEGACY_START_CHOICES[key];
    explicit[key] = valid && (typeof input.explicit?.[key] === 'boolean' ? input.explicit[key] : input[key] !== previousDefault);
    choices[key] = explicit[key] ? input[key] : defaults[key];
  }
  return { ...choices, explicit, defaults: { ...defaults } };
}
