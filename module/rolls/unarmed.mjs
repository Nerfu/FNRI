/** Always-available unarmed action with selectable card-provided alternatives. */
import { BASE_UNARMED_ATTACK } from '../data/core-actions.mjs';
import { bestiaryAttackExpression, parseStandardPhysicalProfile } from './attack-core.mjs';
import { sendAttackSnapshot } from '../weapon/weapon-attack.mjs';
import { itemSlot, HANDS } from '../equipment/equipment.mjs';
import { itemAttackRules } from '../equipment/item-properties.mjs';
import { nativeUnarmedGrant } from '../data/native-unarmed-grants.mjs';

const die = value => {
  const str = String(value ?? '').trim();
  return /^d([1-9]\d*)$/i.test(str) ? '1' + str.toLowerCase() :
    /^1d([1-9]\d*)$/i.test(str) ? str.toLowerCase() : '';
};

export function unarmedExpression(actor, override = null) {
  const explicit = String(override?.rollFormula ?? '').trim();
  if (explicit) return { expression: explicit, warning: null };
  if (actor?.type === 'npc') {
    return { expression: bestiaryAttackExpression(actor) ?? '1d20', warning: null };
  }
  const combat = die(actor?.system?.combatDie);
  return { expression: combat ? `1d20 + ${combat}` : '1d20',
    warning: null };
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
const unarmedRule = item => {
  const mechanics = item.system?.mechanics ?? {};
  return Object.hasOwn(mechanics, 'unarmedAttack') ? mechanics.unarmedAttack : nativeUnarmedGrant(item)?.unarmedAttack;
};

export function availableUnarmedActions(actor) {
  const base = {
    key: BASE_UNARMED_CHOICE, name: 'Безоружная атака',
    damageProfile: { ...BASE_UNARMED_ATTACK.damageProfile },
    damageType: BASE_UNARMED_ATTACK.damageType, properties: BASE_UNARMED_ATTACK.properties,
    sourceUuid: null, rollFormula: '', sourceItemId: null, mode: 'base', isIntervention:false
  };
  const cards = (actor?.items?.contents ?? []).filter(item => {
    const rule = unarmedRule(item);
    if (!['replace', 'option'].includes(rule?.mode) || rule.active === false ||
        !ITEM_ID.test(String(item.id ?? '')) ||
        !parseStandardPhysicalProfile(rule.damageProfile).ok) return false;
    return item.type === 'ability' || Boolean(itemSlot(item.id, actor.system));
  }).map(item => {
    const rule = unarmedRule(item);
    return {
      key: `item:${item.id}`, name: String(rule.name || item.name || base.name),
      damageProfile: {A: rule.damageProfile.A, B: rule.damageProfile.B, C: rule.damageProfile.C},
      damageType: String(rule.damageType || base.damageType),
      properties: String(rule.properties || base.properties),
      rollFormula: String(rule.rollFormula ?? ''), sourceUuid: item.uuid ?? null,
      sourceItemId: item.id, mode: rule.mode,
      freeHandWarning: rule.requiresFreeHand === true && HANDS.every(hand => Boolean(actor.system?.equipment?.[hand])),
      isIntervention:item.system?.mechanics?.isIntervention===true,
      criticalThreshold:rule.criticalThreshold ?? item.system?.mechanics?.attack?.criticalThreshold ?? 20,
      criticalMultiplier:rule.criticalMultiplier ?? item.system?.mechanics?.attack?.criticalMultiplier ?? null
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

export async function sendUnarmedAttack(actor,{skipPreroll=false,actionId=null,accountingItem=null,
  choice=undefined,isIntervention=false,targetTokens=null}={}) {
  if (!actor) throw new Error('An Actor is required for an unarmed attack');
  const action = resolveUnarmedAction(actor, choice);
  if (choice !== undefined && action.key !== choice) return null;
  const sourceItem = action.sourceItemId ? actor.items?.get?.(action.sourceItemId) : null;
  const {expression,warning} = unarmedExpression(actor, action);
  if (action.freeHandWarning) globalThis.ui?.notifications?.warn(game.i18n.localize('FASTNRI.Equipment.freeHandRequired'));
  return sendAttackSnapshot({
    actor, name: action.name, profile: action.damageProfile, damageType: action.damageType,
    properties: action.properties, sourceUuid: action.sourceUuid,
    expression, warning, skipPreroll,actionId,accountingItem,sourceItem,sourceKind: 'unarmed', attackKind:'melee',
    formulaForActor: temp=>unarmedExpression(temp,action).expression,
    usesCombatDie:!String(action.rollFormula??'').trim() && actor.type!=='npc',
    isIntervention:isIntervention || action.isIntervention,targetTokens,
    criticalThreshold:action.criticalThreshold ?? 20,criticalMultiplier:action.criticalMultiplier ?? null,
    ...itemAttackRules(sourceItem)
  });
}
