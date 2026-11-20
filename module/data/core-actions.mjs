/** System action available without inventory Item, empty hands, or import. */
export const BASE_UNARMED_ATTACK = Object.freeze({
  id: 'unarmed', nameKey: 'Attacks.unarmed', actionCost: '1 Воздействие',
  damageType: 'физический', damageProfile: Object.freeze({ A: '1d4', B: '1d4', C: 1 }),
  properties: 'Воздействие, Атака, Ближняя атака'
});
