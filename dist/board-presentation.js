import { cells, attacks, effective, shieldCanRetreat } from './engine.js';

export const AURA_COLORS = ['#a9cf91', '#c6a5df', '#b66a80', '#edd46c'];

// Both the board and onboarding use the same selected-aura palette and hatch.
export function auraPatternDefinitions(prefix = 'aura', masks = Array.from({ length: 15 }, (_, i) => i + 1)) {
  return masks.map(mask => {
    const strokes = AURA_COLORS.map((color, bit) => {
      if (!(mask & (1 << bit))) return '';
      const offset = bit < 2 ? 0 : 6;
      const path = bit % 2 === 0
        ? [0, 1, 2].map(k => `M${offset + k * 12 - 12} 12L${offset + k * 12} 0`).join(' ')
        : [-1, 0, 1].map(k => `M${offset + k * 12} 0L${offset + k * 12 + 12} 12`).join(' ');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-opacity="0.4"/>`;
    }).join('');
    return `<pattern id="${prefix}-${mask}" width="12" height="12" patternUnits="userSpaceOnUse">${strokes}</pattern>`;
  }).join('');
}

export function durabilityDisplay(info) {
  return { value: info.incoming > 0 ? info.fortitude - info.incoming : info.fortitude,
    threatened: info.incoming > 0, dead: info.dead,
    description: info.incoming > 0 ? `Стойкость: ${info.fortitude} − ${info.incoming} = ${info.fortitude - info.incoming}` : `Стойкость: ${info.fortitude}` };
}
export function attackCellsFor(piece, position, config) {
  if (!piece) return [];
  const power = effective(piece, position, config);
  return cells(config).filter(cell => !position.pieces.some(p => p.team === piece.team && p.q === cell.q && p.r === cell.r)
    && attacks(piece, { ...cell, id: '__attack_cell', type: 'archer', team: 1 - piece.team }, position, config, power));
}
export function unitStatParts(piece, position, config) {
  const power = effective(piece, position, config), base = config.stats[piece.type];
  const veteran = shieldCanRetreat(piece, config), promotion = config.shieldPromotion;
  const bonusFields = { damage: 'damageBonus', range: 'rangeBonus', fortitude: 'defenseBonus' };
  return ['move', 'damage', 'range', 'fortitude'].map(field => {
    const personal = veteran && bonusFields[field] ? Math.min(promotion[bonusFields[field]], Math.max(0, power[field] - base[field])) : 0;
    return { field, base: base[field], personal, allied: power[field] - base[field] - personal, total: power[field] };
  });
}

export function alliedBonusDetails(piece, position, config) {
  const power = effective(piece, position, config);
  const remaining = Object.fromEntries(unitStatParts(piece, position, config).map(part => [part.field, Math.max(0, part.allied)]));
  return power.sources.map(id => {
    const source = position.pieces.find(p => p.id === id);
    const veteran = shieldCanRetreat(source, config);
    const aura = veteran ? config.shieldPromotion : config.stats[source.type];
    const offensive = veteran || ['attackLamp', 'archer'].includes(source.type);
    const raw = {
      damage: offensive ? aura.damageBonus : 0,
      range: offensive && piece.type !== 'shield' ? aura.rangeBonus : 0,
      fortitude: veteran || ['shield', 'defenseLamp'].includes(source.type) ? aura.defenseBonus : 0
    };
    const bonuses = Object.fromEntries(Object.entries(raw).map(([field, value]) => {
      const applied = Math.min(value, remaining[field]);
      remaining[field] -= applied;
      return [field, applied];
    }));
    return { source, bonuses };
  }).filter(detail => Object.values(detail.bonuses).some(value => value > 0));
}
