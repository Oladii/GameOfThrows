import { cells, attacks, effective, shieldCanRetreat } from './engine.js';

export const AURA_COLORS = ['#a9cf91', '#c6a5df', '#b66a80', '#edd46c'];
export const VETERAN_SHIELD_ICON = '<path d="M12 2 20 5v8l-8 9-8-9V5Z"/><path d="m4 7 8-3 8 3M12 4v16M6 10l4 2m4 0 4-2M8 16h8M9 18h6"/><path d="M4 8 1 6v6l3 3m16-7 3-2v6l-3 3"/>';

export function unitAppearance(piece, config, icons) {
  const veteran = config ? shieldCanRetreat(piece, config) : piece.type === 'shield' && piece.reachedFarEdge === true;
  return { veteran, icon: veteran ? VETERAN_SHIELD_ICON : icons[piece.type] };
}

// Both weapon glyphs point up and right before rotation, at -45 degrees.
export function attackMarkerRotation(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 45;
}

export const skullShape = () => '<path class="skull-head" d="M8 1.5c-3.4 0-5.5 2.4-5.5 5.3 0 2 1.2 3.4 2.5 3.9V14h6v-3.3c1.3-.5 2.5-1.9 2.5-3.9C13.5 3.9 11.4 1.5 8 1.5Z"/><circle class="skull-eye" cx="5.5" cy="6.8" r="1.4"/><circle class="skull-eye" cx="10.5" cy="6.8" r="1.4"/><path class="skull-nose" d="m8 8.6-1.2 1.8h2.4Z"/><path class="skull-teeth" d="M7 11.5V14m2-2.5V14"/>';

export function renderDeathEffects(deaths, point, polygonPoints, icons, config = null) {
  return deaths.map(piece => {
    const { x, y } = point(piece);
    const appearance = unitAppearance(piece, config, icons);
    return `<g transform="translate(${x},${y})"><polygon class="death-glow" points="${polygonPoints}"/><circle class="death-pulse" r="22"/><g class="death-ghost${appearance.veteran ? ' veteran' : ''} ${piece.team === 0 ? 'north' : 'south'}"><g class="death-token"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${appearance.icon}</g></g><g class="death-skull"><g class="fatal-mark" transform="translate(-16,-17) scale(2)">${skullShape()}</g></g></g></g>`;
  }).join('');
}

export function renderMovingToken(piece, frame, icons, id = 'moving-token', config = null) {
  const appearance = unitAppearance(piece, config, icons);
  return `<g id="${id}" class="moving-token${appearance.veteran ? ' veteran' : ''} ${piece.team ? 'south' : 'north'}" data-progress="${frame.progress}" transform="translate(${frame.x},${frame.y})" aria-hidden="true"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${appearance.icon}</g>${piece.group ? `<text class="group-text" x="0" y="16">${piece.group === 1 ? 'I' : piece.group === 2 ? 'II' : piece.group}</text>` : ''}</g>`;
}

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
