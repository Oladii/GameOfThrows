export const TYPES = ['shield', 'archer', 'attackLamp', 'defenseLamp'];
export const LABELS = { shield: 'Броненосец', archer: 'Лукарь', attackLamp: 'Барабанщик', defenseLamp: 'Знаменосец' };
export const TEAM_NAMES = ['Север', 'Юг'];
export const DEFAULT_CONFIG = {
  "version": 1,
  "geometry": "hex",
  "size": 4,
  "auraDefenseCap": -1,
  "army": {
    "groups": 2,
    "shields": 2,
    "archers": 2,
    "attackLamps": 1,
    "defenseLamps": 1
  },
  "shieldPromotion": {
    "aura": 1,
    "damageBonus": 9,
    "rangeBonus": 2,
    "defenseBonus": 9,
    "maxRange": 3
  },
  "stats": {
    "shield": {
      "move": 2,
      "damage": 15,
      "range": 1,
      "fortitude": 15,
      "aura": 1,
      "damageBonus": 0,
      "rangeBonus": 0,
      "defenseBonus": 9
    },
    "archer": {
      "move": 2,
      "damage": 8,
      "range": 3,
      "fortitude": 6,
      "aura": 1,
      "damageBonus": 4,
      "rangeBonus": 0,
      "defenseBonus": 0
    },
    "attackLamp": {
      "move": 2,
      "damage": 0,
      "range": 0,
      "fortitude": 5,
      "aura": 2,
      "damageBonus": 4,
      "rangeBonus": 1,
      "defenseBonus": 0
    },
    "defenseLamp": {
      "move": 2,
      "damage": 0,
      "range": 0,
      "fortitude": 5,
      "aura": 1,
      "damageBonus": 0,
      "rangeBonus": 0,
      "defenseBonus": 2
    }
  },
  "experiments": {
    "squareDiagonals": true,
    "lampShieldBlocking": true,
    "allyShotsPass": true,
    "aurasThroughShields": true,
    "allowPass": false
  }
};

export const BALANCE_REVISION = 6;
const PREVIOUS_STATS = {"shield": {"move": 1, "damage": 4, "range": 1, "fortitude": 4, "aura": 1, "damageBonus": 0, "rangeBonus": 0, "defenseBonus": 1}, "archer": {"move": 2, "damage": 2, "range": 4, "fortitude": 2, "aura": 0, "damageBonus": 0, "rangeBonus": 0, "defenseBonus": 0}, "attackLamp": {"move": 2, "damage": 0, "range": 0, "fortitude": 3, "aura": 2, "damageBonus": 2, "rangeBonus": 1, "defenseBonus": 0}, "defenseLamp": {"move": 2, "damage": 0, "range": 0, "fortitude": 3, "aura": 2, "damageBonus": 0, "rangeBonus": 0, "defenseBonus": 1}};
const PREVIOUS_PROMOTION = {"aura": 1, "damageBonus": 1, "rangeBonus": 1, "defenseBonus": 1, "maxRange": 2};
// Upgrade the previous defaults once; explicit imports and later settings keep their values.
const PREVIOUS_RAY_STATS = {"shield":{"move":2,"damage":15,"range":1,"fortitude":15,"aura":1,"damageBonus":0,"rangeBonus":0,"defenseBonus":9},"archer":{"move":2,"damage":8,"range":3,"fortitude":6,"aura":1,"damageBonus":4,"rangeBonus":0,"defenseBonus":0},"attackLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":3,"damageBonus":4,"rangeBonus":1,"defenseBonus":0},"defenseLamp":{"move":2,"damage":0,"range":0,"fortitude":5,"aura":1,"damageBonus":0,"rangeBonus":0,"defenseBonus":2}};
const PREVIOUS_RAY_PROMOTION = {"aura":1,"damageBonus":9,"rangeBonus":2,"defenseBonus":9,"maxRange":3};
const SOLID_AURA_CHANGES = {"attackLamp":{"aura":2}};
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
  // Integer damage > old fortitude is equivalent to damage >= old fortitude + 1.
  // Only migrate historical defaults; explicit imports and other custom values stay intact.
  if ((revision ?? 0) < 4) {
    const previousFortitude = { shield: 3, archer: 1, attackLamp: 2, defenseLamp: 2 };
    for (const [type, value] of Object.entries(previousFortitude)) {
      if (next.stats[type].fortitude === value) next.stats[type].fortitude = value + 1;
    }
  }
  // Replace only the complete previous combat profile; keep custom settings and layout.
  if ((revision ?? 0) < 5 &&
      Object.entries(PREVIOUS_STATS).every(([type, fields]) => Object.entries(fields).every(([field, value]) => next.stats[type][field] === value)) &&
      Object.entries(PREVIOUS_PROMOTION).every(([field, value]) => next.shieldPromotion[field] === value)) {
    next.stats = JSON.parse(JSON.stringify(DEFAULT_CONFIG.stats));
    next.shieldPromotion = JSON.parse(JSON.stringify(DEFAULT_CONFIG.shieldPromotion));
  }
  // Adopt the solid-aura balance only for the complete former standard combat profile.
  if ((revision ?? 0) < 6 &&
      Object.entries(PREVIOUS_RAY_STATS).every(([type, fields]) => Object.entries(fields).every(([field, value]) => next.stats[type][field] === value)) &&
      Object.entries(PREVIOUS_RAY_PROMOTION).every(([field, value]) => next.shieldPromotion[field] === value)) {
    for (const [type, fields] of Object.entries(SOLID_AURA_CHANGES)) Object.assign(next.stats[type], fields);
  }
  return next;
}
