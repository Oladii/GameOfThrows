export const TYPES = ['shield', 'archer', 'attackLamp', 'defenseLamp'];
export const LABELS = { shield: 'Броненосец', archer: 'Лукарь', attackLamp: 'Знаменосец', defenseLamp: 'Командир' };
export const TEAM_NAMES = ['Север', 'Юг'];
export const DEFAULT_CONFIG = {
  version: 1, geometry: 'hex', size: 4, auraDefenseCap: -1,
  army: { groups: 2, shields: 2, archers: 2, attackLamps: 1, defenseLamps: 1 },
  shieldPromotion: { aura: 1, damageBonus: 1, rangeBonus: 1, defenseBonus: 1, maxRange: 2 },
  stats: {
    shield: { move: 1, damage: 4, range: 1, fortitude: 3, aura: 1, damageBonus: 0, rangeBonus: 0, defenseBonus: 1 },
    archer: { move: 2, damage: 2, range: 4, fortitude: 1, aura: 0, damageBonus: 0, rangeBonus: 0, defenseBonus: 0 },
    attackLamp: { move: 2, damage: 0, range: 0, fortitude: 2, aura: 2, damageBonus: 2, rangeBonus: 1, defenseBonus: 0 },
    defenseLamp: { move: 2, damage: 0, range: 0, fortitude: 2, aura: 2, damageBonus: 0, rangeBonus: 0, defenseBonus: 1 }
  },
  experiments: { squareDiagonals: true, lampShieldBlocking: true, allyShotsPass: true, aurasThroughShields: true, allowPass: false }
};

export const BALANCE_REVISION = 3;
// Upgrade the previous defaults once; explicit imports and later settings keep their values.
export function updateSavedBalance(config, revision) {
  const next = JSON.parse(JSON.stringify(config));
  if (revision === BALANCE_REVISION) return next;
  if ((revision ?? 0) < 1) {
    if (next.stats.shield.aura === 0 && next.stats.shield.defenseBonus === 0) {
      next.stats.shield.aura = 1;
      next.stats.shield.defenseBonus = 1;
    }
    if (next.stats.attackLamp.move === 1) next.stats.attackLamp.move = 2;
  }
  if ((revision ?? 0) < 2 && next.stats.archer.damage === 1) next.stats.archer.damage = 2;
  if ((revision ?? 0) < 3) {
    if (next.stats.attackLamp.damage === 2) next.stats.attackLamp.damage = 0;
    if (next.stats.attackLamp.range === 3) next.stats.attackLamp.range = 0;
    if (next.stats.attackLamp.damageBonus === 1) next.stats.attackLamp.damageBonus = 2;
  }
  return next;
}
