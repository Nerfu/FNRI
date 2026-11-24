/**
 * Rulebook condition consequences on the PREPARED Actor data (Foundry v14).
 * Native ActiveEffect instances are the sources. No names, icon matching,
 * Actor persistence, invented durations, or new UI/conditions are involved.
 *
 * The three known reasons for "Застигнут врасплох" in this stage use ONE
 * non-stacking -2 penalty. Future field/circumstance reasons can advertise
 * the same explicit conditionId/status instead of adding another modifier.
 */
const SCOPE = 'fast-nri-v14';
const OFF_GUARD_SOURCES = new Set(['prone', 'grabbed', 'offguard']);
const AC_FIELDS = ['partial', 'success', 'great'];
const DEFENSE_FIELDS = ['awareness', 'reflex', 'fortitude', 'will'];

function isEnabled(effect) {
  // Foundry v14: the native "active" accessor includes the disabled,
  // expiry and suppression rules. strength=0 is also a local removal state.
  return effect && effect.disabled !== true && effect.active !== false &&
    effect.isSuppressed !== true &&
    effect.flags?.[SCOPE]?.effectState?.strength !== 0;
}

function describesOffGuard(effect) {
  const conditionId = effect.flags?.[SCOPE]?.conditionId;
  if (OFF_GUARD_SOURCES.has(conditionId)) return true;
  const statuses = effect.statuses;
  return [...OFF_GUARD_SOURCES].some(id =>
    statuses?.has?.(`fnri7-${id}`) ||
    (Array.isArray(statuses) && statuses.includes(`fnri7-${id}`)));
}

/** Read live Actor/Token ActiveEffects; multiple independent sources count once.
 * Use allApplicableEffects so transferred Item effects are not silently lost.
 */
export function isOffGuard(actor) {
  if (!actor) return false;
  const iterable = typeof actor.allApplicableEffects === 'function'
    ? actor.allApplicableEffects()
    : (actor.effects?.contents ?? []);
  for (const effect of iterable) {
    if (isEnabled(effect) && describesOffGuard(effect)) return true;
  }
  return false;
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
