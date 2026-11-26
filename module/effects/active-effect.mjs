/** Shared read-only eligibility for effects in runtime calculations. */
export function activeConditionEffect(effect) {
  return !!effect && !effect.disabled && effect.active !== false &&
    !effect.isSuppressed && !effect.expired && effect.duration?.expired !== true &&
    effect.flags?.['fast-nri-v14']?.effectState?.strength !== 0;
}
export function effectHasStatus(effect, id) {
  const status = `fnri7-${id}`;
  return effect?.flags?.['fast-nri-v14']?.conditionId === id ||
    effect?.statuses?.has?.(status) ||
    (Array.isArray(effect?.statuses) && effect.statuses.includes(status));
}
