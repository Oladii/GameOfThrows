import { createGame, validateConfig, validateState } from './engine.js';

// IDs and game history do not describe the deployment. Missing/false promotion
// flags and missing/null groups have the same meaning to the rules engine.
export function deploymentKey(state) {
  return JSON.stringify(state.pieces.map(piece => JSON.stringify([
    piece.type, piece.team, piece.q, piece.r, piece.group ?? null, piece.reachedFarEdge === true
  ])).sort());
}

export function classifyPosition(state, inputConfig) {
  const config = validateConfig(inputConfig), position = validateState(state, config);
  let standard;
  try {
    standard = createGame(config);
  } catch {
    // A valid editor configuration can have no standard deployment (for
    // example, an empty army). It can still describe a custom draft.
    return 'custom';
  }
  return deploymentKey(position) === deploymentKey(validateState(standard, config)) ? 'default' : 'custom';
}

export function prepareStartPosition(state, inputConfig, turn) {
  const config = validateConfig(inputConfig), position = validateState(state, config);
  if (![0, 1].includes(turn)) throw new Error('Выберите, какая сторона ходит первой: Север или Юг.');
  if (![0, 1].every(team => position.pieces.some(piece => piece.team === team))) {
    throw new Error('Для начала игры нужна хотя бы одна фигура у каждой стороны.');
  }
  position.turn = turn;
  position.ply = 0;
  position.winner = null;
  return position;
}
