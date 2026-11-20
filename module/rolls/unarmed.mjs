/** Always-available unarmed action with selectable card-provided alternatives. */
import { BASE_UNARMED_ATTACK } from '../data/core-actions.mjs';
import { parseStandardPhysicalProfile } from './attack-core.mjs';
import { sendAttackSnapshot } from '../weapon/weapon-attack.mjs';
import { itemSlot } from '../equipment/equipment.mjs';

const die = value => {
  const str = String(value ?? '').trim();
  return /^d([1-9]\d*)$/i.test(str) ? '1' + str.toLowerCase() :
    /^1d([1-9]\d*)$/i.test(str) ? str.toLowerCase() : '';
};

export function unarmedExpression(actor, override = null) {
  const explicit = String(override?.rollFormula ?? '').trim();
  if (explicit) return { expression: explicit, warning: null };
  if (actor?.type === 'npc') {
    const mod = actor.system?.attackModifier;
    if (typeof mod === 'number' && Number.isFinite(mod))
      return {expression: `1d20 ${mod < 0 ? '-' : '+'} ${Math.abs(mod)}`,warning:null};
    return { expression: '1d20', warning: 'missingCombatDie' };
  }
  const combat = die(actor?.system?.combatDie);
  return { expression: combat ? `1d20 + ${combat}` : '1d20',
    warning: combat ? null : 'missingCombatDie' };
}

/**
 * The base action never occupies a hand. Eligible owned ability cards and
 * equipped gear cards supply additional, selectable unarmed profiles.
 * Existing mode='replace' cards remain valid; mode='option' lets new cards
 * explicitly offer another attack without implying that base is deleted.
 * An old actor with exactly one replacement and no saved choice keeps its
 * previous default (that replacement). No card or inventory data is modified.
 */
export const BASE_UNARMED_CHOICE = 'base';
export const UNARMED_CHOICE_FLAG = 'selectedUnarmedAttack';
const SYSTEM_ID = 'fast-nri-v14';
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function availableUnarmedActions(actor) {
  const base = {
    key: BASE_UNARMED_CHOICE, name: 'Безоружная атака',
    damageProfile: { ...BASE_UNARMED_ATTACK.damageProfile },
    damageType: BASE_UNARMED_ATTACK.damageType, properties: BASE_UNARMED_ATTACK.properties,
    sourceUuid: null, rollFormula: '', sourceItemId: null, mode: 'base'
  };
  const cards = (actor?.items?.contents ?? []).filter(item => {
    const rule = item.system?.mechanics?.unarmedAttack;
    if (!['replace', 'option'].includes(rule?.mode) || rule.active === false ||
        !ITEM_ID.test(String(item.id ?? '')) ||
        !parseStandardPhysicalProfile(rule.damageProfile).ok) return false;
    return item.type === 'ability' || Boolean(itemSlot(item.id, actor.system));
  }).map(item => {
    const rule = item.system.mechanics.unarmedAttack;
    return {
      key: `item:${item.id}`, name: String(rule.name || item.name || base.name),
      damageProfile: {A: rule.damageProfile.A, B: rule.damageProfile.B, C: rule.damageProfile.C},
      damageType: String(rule.damageType || base.damageType),
      properties: String(rule.properties || base.properties),
      rollFormula: String(rule.rollFormula ?? ''), sourceUuid: item.uuid ?? null,
      sourceItemId: item.id, mode: rule.mode
    };
  });
  return [base, ...cards];
}

export function resolveUnarmedAction(actor, choice = undefined) {
  const options = availableUnarmedActions(actor);
  const saved = choice === undefined ? actor?.getFlag?.(SYSTEM_ID, UNARMED_CHOICE_FLAG) ??
    actor?.flags?.[SYSTEM_ID]?.[UNARMED_CHOICE_FLAG] : choice;
  let selected;
  if (typeof saved === 'string' && saved.length) {
    // Missing/deleted/unequipped card: safe base fallback, no flag rewriting.
    selected = options.find(option => option.key === saved) ?? options[0];
  } else {
    // Preserve the previous implicit behaviour for one replacement card.
    const replacements = options.filter(option => option.mode === 'replace');
    selected = replacements.length === 1 ? replacements[0] : options[0];
  }
  return {
    ...selected, selectedKey: selected.key, hasChoices: options.length > 1,
    choices: options.map(option => ({
      key: option.key, name: option.name, selected: option.key === selected.key
    }))
  };
}

export async function sendUnarmedAttack(actor) {
  if (!actor) throw new Error('An Actor is required for an unarmed attack');
  const action = resolveUnarmedAction(actor);
  const {expression,warning} = unarmedExpression(actor, action);
  return sendAttackSnapshot({
    actor, name: action.name, profile: action.damageProfile, damageType: action.damageType,
    properties: action.properties, sourceUuid: action.sourceUuid,
    expression, warning, sourceKind: 'unarmed', attackKind:'melee'
  });
}
