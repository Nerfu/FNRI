import {CONDITION_STATUSES} from './condition-statuses.generated.mjs';

/** Foundry v14 CONFIG.statusEffects is indexed by status ID (not the legacy
 * array). Supply complete native AE data, not separate flags on an Actor.
 * Hide non-system entries present at init from the palette, without deleting
 * registrations. Retain the native defeated service entry and special IDs.
 * The native TokenHUD condition action is adapted in condition-hud.mjs. */
export function registerConditionStatuses(config = CONFIG) {
  const registry = config.statusEffects;
  if (!registry) throw Error('Foundry v14 status effect registry unavailable');
  const defeated = config.specialStatusEffects?.DEFEATED ?? 'dead';
  for (const [id, entry] of Object.entries(registry)) {
    if (id !== defeated && !Object.hasOwn(CONDITION_STATUSES, id)) {
      registry[id] = {...entry, hud: false};
    }
  }
  for (const [id, entry] of Object.entries(CONDITION_STATUSES)) {
    registry[id] = structuredClone(entry);
  }
}
