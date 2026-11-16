/**
 * Stage 1 data schemas. Game-context fields are optional.
 * All numeric values start null, NOT with invented game-rule numbers.
 * No roll/damage/action workflow is implemented in these models.
 */
const F = foundry.data.fields;
const T = foundry.abstract.TypeDataModel;

const text = () => new F.StringField({ required: false, blank: true, initial: "" });
const integer = () => new F.NumberField({ required: false, nullable: true, integer: true, initial: null });
const number = () => new F.NumberField({ required: false, nullable: true, initial: null });

function actorSchema() {
  return {
    notes: text(),
    description: text(),
    level: integer(),
    race: text(),
    className: text(),
    path: text(),
    hp: new F.SchemaField({current: integer(), max: integer(), temp: integer()}),
    speed: number(),
    combatDie: text(),
    ac: new F.SchemaField({partial: number(), success: number(), great: number()}),
    defenses: new F.SchemaField({
      awareness: number(), reflex: number(), fortitude: number(), will: number()
    }),
    // Stage 2+ will add structured skills, equipment slots, resources, effects.
    // Notes and existing documents already work without them.
  };
}

export class CharacterModel extends T {
  static defineSchema() { return actorSchema(); }
}

export class NPCModel extends T {
  static defineSchema() {
    return {
      ...actorSchema(),
      rank: text(),
      role: text(),
      weight: number(),
      attackModifier: number()
    };
  }
}

function commonItemSchema() {
  return {
    notes: text(),
    description: text(),
    tags: text(),
    // Structured parameters and mechanics will evolve with actual cards.
    // ObjectField intentionally stores data without evaluating arbitrary code.
    mechanics: new F.ObjectField({ required: false, initial: () => ({}) })
  };
}

export class WeaponModel extends T {
  static defineSchema() {
    return {
      ...commonItemSchema(),
      hands: integer(),
      reach: number(),
      range: number(),
      damageProfile: new F.ObjectField({ required: false, initial: () => ({}) })
    };
  }
}

export class ArmorModel extends T {
  static defineSchema() {
    return {
      ...commonItemSchema(),
      ac: new F.SchemaField({partial: number(), success: number(), great: number()})
    };
  }
}

export class GearModel extends T {
  static defineSchema() {
    return {
      ...commonItemSchema(),
      category: text(),
      quantity: integer(),
      charges: integer()
    };
  }
}

export class AbilityModel extends T {
  static defineSchema() {
    return {
      ...commonItemSchema(),
      category: text(),
      cost: text(),
      trigger: text(),
      effect: text(),
      frequency: text()
    };
  }
}

/** Old starter subtype is retained so its Item documents remain readable.
 * It is not a fifth main gameplay category; its migration is NOT automatic.
 */
export class LegacyItemModel extends T {
  static defineSchema() {
    return { notes: text(), description: text(), tags: text(),
      mechanics: new F.ObjectField({required: false, initial: () => ({})}) };
  }
}
