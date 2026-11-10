import { cells, attacks, effective, shieldCanRetreat, key } from './engine.js';

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

export function renderMovingToken(piece, frame, icons, id = 'moving-token', config = null, displayTeam = piece.team, info = null) {
  const appearance = unitAppearance(piece, config, icons, displayTeam);
  return `<g id="${id}" class="moving-token${appearance.veteran ? ' veteran' : ''} ${displayTeam ? 'south' : 'north'}" data-progress="${frame.progress}" transform="translate(${frame.x},${frame.y})" aria-hidden="true"><circle class="piece-circle" r="21"/><g class="piece-icon" transform="translate(-11,-12) scale(.92)">${appearance.icon}</g>${piece.group ? `<text class="group-text" x="0" y="16">${piece.group === 1 ? 'I' : piece.group === 2 ? 'II' : piece.group}</text>` : ''}${info ? renderUnitBadges(info, { showIncoming: true }) : ''}</g>`;
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
  return { value: info.fortitude,
    threatened: info.incoming > 0, dead: info.dead,
    description: `Стойкость: ${info.fortitude}` };
}

export function renderUnitBadges(info, { showIncoming = false } = {}) {
  const defense = durabilityDisplay(info);
  const attack = `<g class="attack-indicator" data-attack="${info.damage}"><title>Урон атаки: ${info.damage}</title>${numberBadge(info.damage, -13, 13, 'attack')}</g>`;
  const fortitude = `<g class="survival-indicator" data-fortitude="${defense.value}"><title>${defense.description}</title>${numberBadge(defense.value, 13, 13, 'fort')}</g>`;
  const incoming = info.dead || info.incoming > 0
    ? `<g class="incoming-indicator${info.dead ? ' lethal' : ''}" data-incoming="${info.incoming}"><title>Входящий урон: ${info.incoming}${info.dead ? ' · погибнет при расчёте' : ''}</title>${info.dead
      ? `<g class="fatal-mark" transform="translate(-8,-28)"><circle class="skull-badge" cx="8" cy="8" r="8.5"/>${skullShape()}</g>`
      : showIncoming ? numberBadge(`−${info.incoming}`, 0, -20, 'incoming')
      : `<g class="under-fire-target" aria-label="Под несмертельным огнём"><circle class="incoming-badge" cx="0" cy="-20" r="8.5"/><g class="target-icon" transform="translate(0,-20)"><circle r="4.5"/><circle r="1.4"/><path d="M0-7v2M0 5v2M-7 0h2M5 0h2"/></g></g>`}</g>` : '';
  return `<g class="unit-badges">${attack}${fortitude}${incoming}</g>`;
}

export function numberBadge(value, x, y, kind, radius = 8.5) {
  const text = String(value), width = damageBadgeWidth(value, radius);
  // Corner badges grow outwards so large attack and defense values never meet.
  const center = kind === 'attack' ? x - (width - radius * 2) / 2 : kind === 'fort' ? x + (width - radius * 2) / 2 : x;
  return `<rect class="${kind}-badge" x="${center - width / 2}" y="${y - radius}" width="${width}" height="${radius * 2}" rx="${radius}"/><text class="${kind}-text" x="${center}" y="${y + .4}" style="font-size:10px">${text}</text>`;
}
function damageBadgeWidth(value, radius) { return Math.max(radius * 2, 7 + String(value).length * 6.5); }

// Every contributor to a lethal combined hit participates, including attackers
// which die in the same simultaneous calculation.
export function lethalAttackPresentation(position, report, deaths) {
  const victims = new Set(deaths.map(p => p.id)), participants = new Set(victims), arrows = [];
  const pieces = new Map(position.pieces.map(p => [p.id, p]));
  for (const id of victims) {
    const target = pieces.get(id);
    for (const attack of report.get(id)?.attackers || []) {
      const source = pieces.get(attack.id);
      if (!source || !target || attack.damage <= 0) continue;
      participants.add(source.id); arrows.push({ source, target, damage: attack.damage });
    }
  }
  // Resolve victims with no outgoing lethal contribution first, one at a
  // time. Removing a sink can expose another; cycles remain together so no
  // attacker disappears before its own contribution has been explained.
  const remaining = new Set(victims), groups = [];
  while (remaining.size) {
    const sink = deaths.find(p => remaining.has(p.id) && !arrows.some(a => a.source.id === p.id && remaining.has(a.target.id)));
    if (!sink) break;
    groups.push({ deaths: [sink], arrows: arrows.filter(a => a.target.id === sink.id) });
    remaining.delete(sink.id);
  }
  if (remaining.size) groups.push({ deaths: deaths.filter(p => remaining.has(p.id)),
    arrows: deaths.filter(p => remaining.has(p.id)).flatMap(p => arrows.filter(a => a.target.id === p.id)) });
  return { participants, victims, arrows, groups };
}

export function layoutDamageArrows(arrows, point, { pieces = [], bounds = null } = {}) {
  const edges = arrows.map((arrow, order) => {
    const { source, target } = arrow;
    const start = point(source), end = point(target), length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!length) return null;
    const shorten = Math.min(24, length / 3), dx = (end.x - start.x) / length, dy = (end.y - start.y) / length;
    // Canonical direction gives opposite and overlapping rays separate lanes.
    const sign = dx < -1e-6 || Math.abs(dx) < 1e-6 && dy < 0 ? -1 : 1;
    const ux = dx * sign, uy = dy * sign;
    const lineKey = `${ux.toFixed(5)},${uy.toFixed(5)},${(ux * start.y - uy * start.x).toFixed(3)}`;
    const a = ux * start.x + uy * start.y, b = ux * end.x + uy * end.y;
    return { ...arrow, order, start, end, dx, dy, ux, uy, shorten, lineKey, low: Math.min(a,b), high: Math.max(a,b) };
  }).filter(Boolean).sort((a,b) => `${a.source.id}:${a.target.id}`.localeCompare(`${b.source.id}:${b.target.id}`));
  const groups = new Map();
  for (const edge of edges) {
    if (!groups.has(edge.lineKey)) groups.set(edge.lineKey, []);
    const group = groups.get(edge.lineKey);
    let lane = 0;
    while (group.some(other => other.lane === lane && edge.low < other.high && edge.high > other.low)) lane++;
    edge.lane = lane; group.push(edge);
  }
  const obstacles = [...new Map([...pieces, ...arrows.flatMap(a => [a.source,a.target])].map(p => [p.id,p])).values()].map(p => {
    const c = point(p); return { id:p.id,left:c.x-32, right:c.x+32, top:c.y-30, bottom:c.y+24 };
  });
  const placed = [];
  const intersects = (a,b) => a.left < b.right+3 && a.right > b.left-3 && a.top < b.bottom+3 && a.bottom > b.top-3;
  const fits = (box,edge) => !placed.some(other => intersects(box,other)) && !obstacles.some(other => other.id !== edge.source.id && other.id !== edge.target.id && intersects(box,other));
  for (const edge of edges) {
    const group = groups.get(edge.lineKey), lanes = Math.max(...group.map(e => e.lane))+1;
    const offset = (edge.lane-(lanes-1)/2)*Math.min(28,64/Math.max(1,lanes-1));
    edge.from = { x:edge.start.x+edge.dx*edge.shorten, y:edge.start.y+edge.dy*edge.shorten };
    edge.to = { x:edge.end.x-edge.dx*edge.shorten, y:edge.end.y-edge.dy*edge.shorten };
    const width = damageBadgeWidth(edge.damage,9);
    const middle = { x:(edge.from.x+edge.to.x)/2,y:(edge.from.y+edge.to.y)/2 };
    const controlAt = bend => ({x:middle.x-edge.uy*bend*2,y:middle.y+edge.ux*bend*2});
    const at = (t,control) => ({ x:(1-t)**2*edge.from.x+2*(1-t)*t*control.x+t*t*edge.to.x, y:(1-t)**2*edge.from.y+2*(1-t)*t*control.y+t*t*edge.to.y });
    const boxAt = (x,y) => ({ left:x-width/2,right:x+width/2,top:y-9,bottom:y+9,x,y,width });
    let placement;
    for (const extra of [0,24,-24,48,-48,72,-72,96,-96,120,-120]) {
      const control=controlAt(offset+extra);
      for (const t of [.55,.35,.75,.2,.85,.45,.65,.1,.9,.5]) {
        const p=at(t,control),label=boxAt(p.x,p.y);
        const inside=!bounds||label.left>=bounds.left&&label.right<=bounds.right&&label.top>=bounds.top&&label.bottom<=bounds.bottom;
        if (inside&&fits(label,edge)) {placement={label,control,t};break;}
      }
      if (placement) break;
    }
    const preferred = at(.55,controlAt(offset));
    // If a dense fight exhausts the simple curves, route the arrow itself
    // through a free point. Its number remains exactly on that same path.
    if (!placement && bounds) {
      const grid = [];
      for (let y=bounds.top+9;y<=bounds.bottom-9;y+=12) for (let x=bounds.left+width/2;x<=bounds.right-width/2;x+=12) {
        grid.push(boxAt(x,y));
      }
      grid.sort((a,b) => Math.hypot(a.x-preferred.x,a.y-preferred.y)-Math.hypot(b.x-preferred.x,b.y-preferred.y));
      const label = grid.find(label=>fits(label,edge));
      if (label) placement = {label,control:{x:2*label.x-middle.x,y:2*label.y-middle.y},t:.5};
    }
    // Always keep labels distinct, even in an unusually crowded imported scene.
    for (let distance=110;!placement;distance+=22) {
      const control=controlAt(offset+distance),p=at(.5,control),label=boxAt(p.x,p.y);
      if (fits(label,edge)) placement={label,control,t:.5};
    }
    edge.label = placement.label; edge.control = placement.control; edge.labelT = placement.t; placed.push(edge.label);
  }
  return edges;
}

export function renderDamageArrows(arrows, point, { pieces = [], board = [], visibleCount = null } = {}) {
  const points = board.map(point), bounds = points.length ? { left:Math.min(...points.map(p=>p.x))-32,right:Math.max(...points.map(p=>p.x))+32,top:Math.min(...points.map(p=>p.y))-32,bottom:Math.max(...points.map(p=>p.y))+32 } : null;
  // Lay out the complete group before revealing it so existing arrows and
  // their labels stay in place when the next contribution appears.
  const edges = layoutDamageArrows(arrows,point,{pieces,bounds}).filter(e => visibleCount === null || e.order < visibleCount);
  const reveal = e => visibleCount !== null && e.order === visibleCount - 1 ? ' data-revealing="true"' : '';
  const rays = edges.map(e => `<g class="attack-ray" data-source="${e.source.id}" data-target="${e.target.id}"${reveal(e)}><path class="damage-arrow-path" d="M${e.from.x},${e.from.y}Q${e.control.x},${e.control.y} ${e.to.x},${e.to.y}" marker-end="url(#damage-arrow)"><title>${e.damage} урона</title></path></g>`).join('');
  // Labels go above every shaft, so a later arrow cannot paint over a number.
  const labels = edges.map(e => `<g class="attack-ray-label" data-source="${e.source.id}" data-target="${e.target.id}"${reveal(e)}>${numberBadge(e.damage,e.label.x,e.label.y,'ray',9)}</g>`).join('');
  return rays+labels;
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
export function attackReachPresentation(piece, position, config, {point, polygonPoints, visiblePosition = position, displayTeam = piece?.team, friendlyTeam = position.turn}) {
  if (!piece) return { cells: [], markup: '' };
  const friendlyCells = new Set([...visiblePosition.pieces, ...position.pieces].filter(p => p.team === piece.team).map(p => key(p.q, p.r)));
  const attackCells = attackCellsFor(piece, position, config).filter(cell => !friendlyCells.has(key(cell.q, cell.r)));
  const outlines = [], markers = [];
  for (const cell of attackCells) {
    const { x, y } = point(cell);
    const target = position.pieces.find(p => p.q === cell.q && p.r === cell.r);
    const friendly = piece.team === friendlyTeam ? ' friendly-target' : '';
    if (target) outlines.push(`<polygon class="attack-target-fill ${displayTeam ? 'south' : 'north'}" data-threat-cell="${key(cell.q, cell.r)}" transform="translate(${x},${y})" points="${polygonPoints}"/>`);
    if (!target) {
      const kind = piece.type === 'archer' ? 'arrow' : 'sword';
      const glyph = kind === 'arrow'
        ? '<path d="M3 21 18 6M13 5l8-2-2 8Z"/><path d="M3 15l5 1 1 5M6 12l5 1 1 5"/>'
        : '<path d="m5 19 9-9M10 8l6-6 6-1-1 6-6 6M6 12l6 6M3 21l3-3"/>';
      markers.push(`<g class="attack-target-weapon ${displayTeam ? 'south' : 'north'}${friendly}" data-weapon-cell="${key(cell.q, cell.r)}" data-weapon-kind="${kind}" transform="translate(${x},${y}) rotate(${attackMarkerRotation(point(piece), { x, y })})" data-threat-cell="${key(cell.q, cell.r)}"><g transform="translate(-6.24,-6.24) scale(.52)">${glyph}</g></g>`);
    }
  }
  const markup = outlines.join('') + markers.join('');
  return { cells: attackCells, markup };
}
