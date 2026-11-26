import {activeConditionEffect, effectHasStatus} from './active-effect.mjs';
/**
 * Rulebook condition consequences on the PREPARED Actor data (Foundry v14).
 * Native ActiveEffect instances are the sources. No names, icon matching,
 * Actor persistence, invented durations, or new UI/conditions are involved.
 *
 * The three known reasons for "Застигнут врасплох" in this stage use ONE
 * non-stacking -2 penalty. Future field/circumstance reasons can advertise
 * the same explicit conditionId/status instead of adding another modifier.
 */
const OFF_GUARD_SOURCES = new Set(['prone', 'grabbed', 'offguard']);
const AC_FIELDS = ['partial', 'success', 'great'];
const DEFENSE_FIELDS = ['awareness', 'reflex', 'fortitude', 'will'];

function hasActiveCondition(actor, ids) {
  const effects = actor?.allApplicableEffects?.() ?? actor?.effects?.contents ?? actor?.effects ?? [];
  for (const effect of effects) {
    if (activeConditionEffect(effect) && [...ids].some(id => effectHasStatus(effect,id))) return true;
  }
  return false;
}

/** Read live Actor/Token ActiveEffects; multiple independent sources count once.
 * Use allApplicableEffects so transferred Item effects are not silently lost.
 */
export function isOffGuard(actor) {
  return hasActiveCondition(actor, OFF_GUARD_SOURCES);
}

/** Called AFTER native ActiveEffects have been prepared. This is derived data,
 * not an update to Actor._source; current sheet, checks and formulas all read
 * the same prepared values. Never subtract once per individual effect.
 */
export function prepareConditionDefenses(system) {
  if (!isOffGuard(system?.parent)) return;
  for (const field of AC_FIELDS) {
    if (Number.isFinite(system.ac?.[field])) system.ac[field] -= 2;
  }
  for (const field of DEFENSE_FIELDS) {
    if (Number.isFinite(system.defenses?.[field])) system.defenses[field] -= 2;
  }
}

/** Slow is one derived consequence regardless of the number of sources. */
export function isSlowed(actor) {
  return hasActiveCondition(actor, ['slowed']);
}

/** After native changes and permanent contributions; never persist the result.
 * Rulebook: speed and its calculated values have a minimum of 1.
 * An unset speed stays unset; immobilization is not a numeric speed change.
 */
export function prepareConditionSpeed(system) {
  if (!Number.isFinite(system?.speed)) return;
  if (isSlowed(system.parent)) system.speed = Math.floor(system.speed / 2);
  system.speed = Math.max(1, system.speed);
}

/** Frightened is one check modifier, not a hindrance penalty. */
export function isFrightened(actor) {
  return hasActiveCondition(actor, ['frightened']);
}

/** Weakened is one consequence of all active sources, not a per-die modifier. */
export function isWeakened(actor) {
  return hasActiveCondition(actor, ['weakened']);
}

/** Explicit weapon/category or unarmed declaration; never infer from its name,
 * a physical profile alone, or an unrelated spellcasting weapon. */
export function weakenedAttackReduction(actor, {sourceKind, weaponItem, attackKind, profileKind}={}) {
  if (profileKind !== 'physical' || !isWeakened(actor)) return 0;
  if (sourceKind === 'unarmed') return 2;
  if (weaponItem?.type !== 'weapon') return 0;
  const category = String(weaponItem.system?.category ?? '').trim().toLocaleLowerCase('ru');
  return attackKind === 'melee' || ['луки','bows','bow'].includes(category) ? 2 : 0;
}
