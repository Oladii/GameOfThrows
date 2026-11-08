import { LABELS } from './rules.js';
import { cells, attacks, effective, shieldCanRetreat, key, isLethalDamage } from './engine.js';

export const AURA_COLORS = { attack: '#c96060', defense: '#5d89bd', combined: '#9770be' };
export function auraKind(source, config) {
  return shieldCanRetreat(source, config) ? 'combined' : ['shield', 'defenseLamp'].includes(source.type) ? 'defense' : 'attack';
}
// Reuse the former commander's helmet for promoted shields.
export const VETERAN_SHIELD_ICON = '<path d="M3 9c0-4.3 4-7 9-7s9 2.7 9 7M6 9c0-2.5 2.7-4 6-4s6 1.5 6 4M12 2v3M6 4l2 2m10-2-2 2M12 6v3"/><path d="M6 14a6 5 0 0 1 12 0M5 14h14M6 14v6l4 2v-6m8-2v6l-4 2v-6"/>';

export function unitAppearance(piece, config, icons, displayTeam = piece.team) {
  const veteran = config ? shieldCanRetreat(piece, config) : piece.type === 'shield' && piece.reachedFarEdge === true;
  const glyph = veteran ? VETERAN_SHIELD_ICON : icons[piece.type];
  return { veteran, icon: piece.type === 'archer' ? `<g transform="rotate(${displayTeam === 0 ? 90 : -90} 12 12)">${glyph || ''}</g>` : glyph };
}

// Both weapon glyphs point up and right before rotation, at -45 degrees.
export function attackMarkerRotation(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI + 45;
}

// The ring passes a little beyond the centre of the outermost covered cell.
export function auraCircleMarkup(source, position, config, point, spacing) {
  if (!source) return '';
  const radius = effective(source, position, config).aura;
  if (radius <= 0) return '';
  const { x, y } = point(source);
  const diagonal = config.geometry === 'square' && config.experiments.squareDiagonals ? Math.SQRT2 : 1;
  const extent = radius * spacing * diagonal + spacing * .1;
  const color = AURA_COLORS[auraKind(source, config)];
  return `<g class="aura-circles" data-aura-origin="${source.q},${source.r}" data-aura-radius="${radius}" aria-hidden="true"><circle class="aura-ring" cx="${x}" cy="${y}" r="${extent}" stroke="${color}" fill="${color}"/></g>`;
}

export const skullShape = () => '<path class="skull-head" d="M8 1.5c-3.4 0-5.5 2.4-5.5 5.3 0 2 1.2 3.4 2.5 3.9V14h6v-3.3c1.3-.5 2.5-1.9 2.5-3.9C13.5 3.9 11.4 1.5 8 1.5Z"/><circle class="skull-eye" cx="5.5" cy="6.8" r="1.4"/><circle class="skull-eye" cx="10.5" cy="6.8" r="1.4"/><path class="skull-nose" d="m8 8.6-1.2 1.8h2.4Z"/><path class="skull-teeth" d="M7 11.5V14m2-2.5V14"/>';

export function renderDeathEffects(deaths, point, polygonPoints, icons, config = null, displayTeamOf = piece => piece.team) {
  return deaths.map(piece => {
    const { x, y } = point(piece);
    const displayTeam = displayTeamOf(piece), appearance = unitAppearance(piece, config, icons, displayTeam);
    return `<g transform="translate(${x},${y})"><polygon class="death-glow" points="${polygonPoints}"/><circle class="death-pulse" r="22"/><g class="death-ghost${appearance.veteran ? ' veteran' : ''} ${displayTeam === 0 ? 'north' : 'south'}"><g class="death-token"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${appearance.icon}</g></g><g class="death-skull"><g class="fatal-mark" transform="translate(-16,-17) scale(2)">${skullShape()}</g></g></g></g>`;
  }).join('');
}

export function renderMovingToken(piece, frame, icons, id = 'moving-token', config = null, displayTeam = piece.team) {
  const appearance = unitAppearance(piece, config, icons, displayTeam);
  return `<g id="${id}" class="moving-token${appearance.veteran ? ' veteran' : ''} ${displayTeam ? 'south' : 'north'}" data-progress="${frame.progress}" transform="translate(${frame.x},${frame.y})" aria-hidden="true"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${appearance.icon}</g>${piece.group ? `<text class="group-text" x="0" y="16">${piece.group === 1 ? 'I' : piece.group === 2 ? 'II' : piece.group}</text>` : ''}</g>`;
}

// Both the board and onboarding use the same selected-aura palette and hatch.
export function auraPatternDefinitions(prefix = 'aura', masks = Array.from({ length: 15 }, (_, i) => i + 1)) {
  return masks.map(mask => {
    const strokes = [AURA_COLORS.attack, AURA_COLORS.defense, AURA_COLORS.attack, AURA_COLORS.defense].map((color, bit) => {
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
    const aura = veteran ? config.shieldPromotion.allies ?? config.shieldPromotion : config.stats[source.type];
    const offensive = veteran || ['attackLamp', 'archer', 'scoutLamp'].includes(source.type);
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

// Shared by the live board and unit lessons, including movement forecasts.
export function attackReachPresentation(piece, position, config, {point, polygonPoints, visiblePosition = position, displayTeam = piece?.team}) {
  if (!piece) return { cells: [], markup: '' };
  const attackPower = effective(piece, position, config);
  const friendlyCells = new Set([...visiblePosition.pieces, ...position.pieces].filter(p => p.team === piece.team).map(p => key(p.q, p.r)));
  const attackCells = attackCellsFor(piece, position, config).filter(cell => !friendlyCells.has(key(cell.q, cell.r)));
  const outlines = [], markers = [];
  const targetHex = Array.from({ length: 6 }, (_, i) => `${12 * Math.cos((60 * i - 30) * Math.PI / 180)},${12 * Math.sin((60 * i - 30) * Math.PI / 180)}`).join(' ');
  for (const cell of attackCells) {
    const { x, y } = point(cell);
    const target = position.pieces.find(p => p.q === cell.q && p.r === cell.r);
    const lethal = target && isLethalDamage(attackPower.damage, effective(target, position, config).fortitude);
    outlines.push(`<polygon class="${target ? 'attack-target-fill' : 'attack-target-outline'} ${displayTeam ? 'south' : 'north'}" data-threat-cell="${key(cell.q, cell.r)}" transform="translate(${x},${y})" points="${target ? polygonPoints : targetHex}"/>`);
    if (!target) {
      const kind = piece.type === 'archer' ? 'arrow' : 'sword';
      const glyph = kind === 'arrow'
        ? '<path d="M3 21 18 6M13 5l8-2-2 8Z"/><path d="M3 15l5 1 1 5M6 12l5 1 1 5"/>'
        : '<path d="m5 19 9-9M10 8l6-6 6-1-1 6-6 6M6 12l6 6M3 21l3-3"/>';
      markers.push(`<g class="attack-target-weapon ${displayTeam ? 'south' : 'north'}" data-weapon-cell="${key(cell.q, cell.r)}" data-weapon-kind="${kind}" transform="translate(${x},${y}) rotate(${attackMarkerRotation(point(piece), { x, y })})"><g transform="translate(-5.04,-5.04) scale(.42)">${glyph}</g></g>`);
    }
    if (lethal) markers.push(`<g class="attack-reach ${displayTeam ? 'south' : 'north'} occupied" data-reach-cell="${key(cell.q, cell.r)}" data-attack-kind="skull" transform="translate(${x},${y})"><title>Смертельная атака: ${LABELS[piece.type]}</title><g class="reach-skull" transform="translate(-8,-8)">${skullShape()}</g></g>`);
  }
  const markup = outlines.join('') + markers.join('');
  return { cells: attackCells, markup };
}
