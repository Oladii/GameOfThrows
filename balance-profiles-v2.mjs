export const BALANCE_VARIANTS = [
  { id: 'baseline', label: 'Текущий баланс', kind: 'control', changes: {}, rule: 'none' },
  { id: 'defense_cap_1', label: 'Внешняя защита максимум +1', kind: 'balance', changes: { auraDefenseCap: 1 }, rule: 'none' },
  { id: 'defense_cap_2', label: 'Внешняя защита максимум +2', kind: 'balance', changes: { auraDefenseCap: 2 }, rule: 'none' },
  { id: 'defense_move_1', label: 'Ход знамени защиты 1', kind: 'balance', changes: { 'stats.defenseLamp.move': 1 }, rule: 'none' },
  { id: 'defense_fort_1', label: 'Стойкость знамени защиты 1', kind: 'balance', changes: { 'stats.defenseLamp.fortitude': 1 }, rule: 'none' },
  { id: 'defense_aura_1', label: 'Радиус знамени защиты 1', kind: 'balance', changes: { 'stats.defenseLamp.aura': 1 }, rule: 'none' },
  { id: 'archer_damage_2', label: 'Урон стрелка 2', kind: 'balance', changes: { 'stats.archer.damage': 2 }, rule: 'none' },
  { id: 'shield_damage_4', label: 'Урон щита 4', kind: 'balance', changes: { 'stats.shield.damage': 4 }, rule: 'none' },
  { id: 'archers_1', label: 'Один стрелок в группе', kind: 'balance', changes: { 'army.archers': 1 }, rule: 'none' },
  { id: 'cap1_defense_move1', label: 'Защита +1 и ход её знамени 1', kind: 'balance', changes: { auraDefenseCap: 1, 'stats.defenseLamp.move': 1 }, rule: 'none' },
  { id: 'cap1_archer2', label: 'Защита +1 и урон стрелка 2', kind: 'balance', changes: { auraDefenseCap: 1, 'stats.archer.damage': 2 }, rule: 'none' }
];
