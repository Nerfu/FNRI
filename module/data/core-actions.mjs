/** System action available without inventory Item, empty hands, or import. */
export const BASE_UNARMED_ATTACK = Object.freeze({
  id: 'unarmed', nameKey: 'Attacks.unarmed', actionCost: '1 Воздействие',
  damageType: 'физический', damageProfile: Object.freeze({ A: '1d4', B: '1d4', C: 1 }),
  properties: 'Воздействие, Атака, Ближняя атака'
});

/** Read-only system action: not an Item, does not occupy an Actor slot.
 * It is exposed in both Actor sheet types and in intervention selection.
 */
export const BASE_SELF_DEFENSE = Object.freeze({
  id: 'builtin:selfDefense',
  nameKey: 'Damage.selfDefense',
  actionCostKey: 'Builtin.selfDefenseCost',
  traitsKey: 'Builtin.selfDefenseTraits',
  targetKey: 'Builtin.selfDefenseTarget'
});
