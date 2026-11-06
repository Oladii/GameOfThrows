import { cells, attacks, effective, shieldCanRetreat } from './engine.js';

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
