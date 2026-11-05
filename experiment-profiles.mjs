export const VARIANTS = [
  { id: 'baseline', label: 'Текущие правила', kind: 'control', changes: {}, rule: 'none', hypothesis: 'Контроль поиска глубиной четыре полухода.' },
  { id: 'shield_fort_3', label: 'Стойкость щита 3', kind: 'balance', changes: { 'stats.shield.fortitude': 3 }, rule: 'none', hypothesis: 'Снизить порог прорыва щитовой линии.' },
  { id: 'shield_damage_4', label: 'Урон щита 4', kind: 'balance', changes: { 'stats.shield.damage': 4 }, rule: 'none', hypothesis: 'Усиленный щит сможет пробить неусиленный щит самостоятельно.' },
  { id: 'archer_damage_2', label: 'Урон стрелка 2', kind: 'balance', changes: { 'stats.archer.damage': 2 }, rule: 'none', hypothesis: 'Сделать дальние атаки и добивание эффективнее.' },
  { id: 'attack_damage_3', label: 'Урон знамени атаки 3', kind: 'balance', changes: { 'stats.attackLamp.damage': 3 }, rule: 'none', hypothesis: 'Дать знамени возможность уничтожать другое незащищённое знамя.' },
  { id: 'attack_fort_1', label: 'Стойкость знамени атаки 1', kind: 'balance', changes: { 'stats.attackLamp.fortitude': 1 }, rule: 'none', hypothesis: 'Упростить добивание последнего атакующего знамени.' },
  { id: 'banners_fort_1', label: 'Стойкость обоих знамён 1', kind: 'balance', changes: { 'stats.attackLamp.fortitude': 1, 'stats.defenseLamp.fortitude': 1 }, rule: 'none', hypothesis: 'Устранить взаимную неуязвимость оставшихся знамён.' },
  { id: 'defense_aura_1', label: 'Аура защиты 1', kind: 'balance', changes: { 'stats.defenseLamp.aura': 1 }, rule: 'none', hypothesis: 'Уменьшить число одновременно защищённых фигур.' },
  { id: 'shield_edge_sideways', label: 'Боковой ход щита на дальнем краю', kind: 'movement', changes: {}, rule: 'shield_edge_sideways', hypothesis: 'Не оставлять дошедшие до края щиты полностью неподвижными.' },
  { id: 'immobility_loss', label: 'Нет ходов — поражение', kind: 'victory', changes: {}, rule: 'immobility_loss', hypothesis: 'Назначать исход вместо остановки при отсутствии ходов.' },
  { id: 'combat_loss', label: 'Нет щитов и стрелков — поражение', kind: 'victory', changes: {}, rule: 'combat_loss', hypothesis: 'Завершать бой при потере боевых фигур, без обязательной охоты за знамёнами.' }
];

export const usesAnnihilationGoal = variant => variant.kind !== 'victory';
