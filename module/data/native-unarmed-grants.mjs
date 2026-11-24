// Defaults for previously embedded copies of these native grants.
const grants = new Map([
  ['fnri7.rulebook.racial.kogti-drakonoobraznogo', {
    unarmedAttack: {
      mode: 'option', name: 'Когти', damageType: 'физический', requiresFreeHand: true,
      damageProfile: {A: '1d6', B: '1d8', C: 6},
      properties: 'Воздействие, Атака, Ближняя атака, Смертельное'
    },
    attack: {greatSelfDefenseModifier: -10}
  }],
  ['fnri7.rulebook.racial.krepkij-khvost', {
    unarmedAttack: {
      mode: 'option', name: 'Удар хвостом', damageType: 'физический',
      damageProfile: {A: '1d6', B: '1d6', C: 2},
      properties: 'Воздействие, Атака, Ближняя атака, Сокрушение'
    },
    attack: {outcomes: [{
      kind: 'choice', minEffectDegree: 'great', afterDamage: true,
      options: ['Отбросить на 1 клетку', 'Сбить с ног'],
      choiceEffects: [{}, {
        effectRefs: [{contentId: 'fnri7.rulebook.condition.prone', effectId: 'f7Status00000001'}]
      }]
    }]}
  }]
]);

export function nativeUnarmedGrant(item) {
  if (item?.type !== 'ability') return null;
  return grants.get(item.flags?.['fast-nri-v14']?.contentId) ?? null;
}
