import {initialSkillAllocation,prepareSkillAllocation} from "./skill-allocation.mjs";
import {prepareClassBaseStats} from "./classes.mjs";
import {preparePermanentRacialStats} from "./character-contributions.mjs";
import { prepareRoleDefenses } from "./roles.mjs";
import { initialSkillEntries } from "./skills-catalog.mjs";
import { prepareConditionDefenses } from "../effects/condition-calculations.mjs";
import {projectionCaster} from "../projection/projection.mjs";
/**
 * Fast NRI 7.0 — editable document data models.
 * Stage 2 adds unrestricted skill/specialization entries, resource lists,
 * standard equipment references and user-defined additional slots.
 * Stage 3 adds optional numeric check modifiers and card-owned roll formulas.
 */
const F = foundry.data.fields;
const T = foundry.abstract.TypeDataModel;

const text = () => new F.StringField({ required: false, blank: true, initial: "" });
const integer = () => new F.NumberField({ required: false, nullable: true, integer: true, initial: null });
const number = () => new F.NumberField({ required: false, nullable: true, initial: null });

function checkEntrySchema() {
  // A check entry is either a skill or a specialization. These labels describe
  // the row, not restrictions on number of rows or its freely editable dice.
  // The old numeric value survives for possible stage-2 draft data; it is not
  // silently interpreted as a dice formula.
  return new F.SchemaField({ name: text(), kind: text(), catalogId: text(), group: text(), dice: text(), modifier: number(), value: number() });
}

function customSlotSchema() {
  return new F.SchemaField({ name: text(), itemId: text() });
}

function resourceSchema() {
  return new F.SchemaField({ name: text(), current: number(), max: number(), kind: text() });
}

function actorSchema() {
  return {
    notes: text(),
    description: text(),
    wealth: text(),
    potionsUsed: new F.NumberField({required: false, integer: true, initial: 0, nullable: true}),
    level: integer(),
    race: text(),
    className: text(),
    path: text(),
    hp: new F.SchemaField({ current: integer(), max: integer(), temp: integer() }),
    speed: number(),
    combatDie: text(),
    ac: new F.SchemaField({ partial: number(), success: number(), great: number() }),
    defenses: new F.SchemaField({
      awareness: number(), reflex: number(), fortitude: number(), will: number()
    }),
    // Dynamic dictionaries allow independent field updates for each row,
    // including edits made by different Foundry clients. Not arrays.
    skills: new F.TypedObjectField(checkEntrySchema(), { required: false, initial: initialSkillEntries }),
    resources: new F.TypedObjectField(resourceSchema(), { required: false, initial: () => ({}) }),
    // References to embedded Item IDs, not copies of equipment data.
    equipment: new F.SchemaField({
      leftHand: text(), rightHand: text(), armor: text()
    }),
    // No limit on extra equipment positions or Item types assigned to them.
    equipmentSlots: new F.TypedObjectField(customSlotSchema(), { required: false, initial: () => ({}) }),
    // Sequence is monotonic; the older of two occupied hands is replaced first.
    equipmentWear: new F.SchemaField({
      sequence: new F.NumberField({ required: false, integer: true, initial: 0 }),
      leftHand: new F.NumberField({ required: false, integer: true, initial: 0 }),
      rightHand: new F.NumberField({ required: false, integer: true, initial: 0 })
    })
  };
}

export class CharacterModel extends T {
  static defineSchema() { return {...actorSchema(), role:text(), potionsBaseMax:integer(), classTradition:text(), skillAllocation:new F.ObjectField({required:false,initial:initialSkillAllocation})}; }
  prepareBaseData() {
    super.prepareBaseData();
    prepareClassBaseStats(this);
    prepareSkillAllocation(this);
  }
  prepareDerivedData() {
    super.prepareDerivedData();
    preparePermanentRacialStats(this);
    prepareRoleDefenses(this);
    prepareConditionDefenses(this);
  }
}

export class NPCModel extends T {
  static defineSchema() {
    return { ...actorSchema(), rank: text(), role: text(), weight: number(), attackModifier: number() };
  }
  prepareDerivedData() {
    super.prepareDerivedData();
    prepareConditionDefenses(this);
    const caster=projectionCaster(this.parent);
    const ac=caster?.system?.ac;
    if(ac && [ac.partial,ac.success,ac.great].every(Number.isFinite)){
      this.ac.partial=ac.partial;
      this.ac.success=ac.success;
      this.ac.great=ac.great;
    }
  }
}

function commonItemSchema() {
  return {
    notes: text(), description: text(), tags: text(), rollFormula: text(),
    mechanics: new F.ObjectField({ required: false, initial: () => ({}) })
  };
}

export class WeaponModel extends T {
  static defineSchema() {
    return {
      ...commonItemSchema(), hands: integer(), reach: number(), range: number(),
      level: integer(), category: text(), proficiencyClasses: text(),
      grip: text(), distance: text(), attackKind: text(), proficiencyMode: text(),
      properties: text(), damageType: text(),
      damageProfile: new F.ObjectField({ required: false, initial: () => ({}) })
    };
  }
}

export class ArmorModel extends T {
  static defineSchema() {
    return { ...commonItemSchema(), ac: new F.SchemaField({
      partial: number(), success: number(), great: number()
    }) };
  }
}

export class GearModel extends T {
  static defineSchema() {
    return { ...commonItemSchema(), category: text(), quantity: integer(), charges: integer() };
  }
}

export class AbilityModel extends T {
  static defineSchema() {
    return {
      ...commonItemSchema(), category: text(), cost: text(), trigger: text(),
      effect: text(), frequency: text()
    };
  }
}

/** Legacy item subtype stays supported until an explicitly approved migration. */
export class LegacyItemModel extends T {
  static defineSchema() {
    return { ...commonItemSchema() };
  }
}
