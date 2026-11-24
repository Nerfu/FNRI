import {abilityAccountingStatus, abilityCostPreview} from './ability-accounting.mjs';

const WARNING_KEYS = {
  ambiguous: 'ambiguousResource',
  'intervention-resource-unknown': 'unassignedIntervention'
};

/** Accounting information is advisory for every displayed choice. */
export function interventionWarnings(actor, item = null, accounting = null) {
  const warnings = abilityCostPreview(actor, item, {isIntervention: true, accounting}).map(warning => {
    const row = actor.system?.resources?.[warning.resourceId];
    const name = row?.name || warning.resourceName ||
      (row?.kind === 'intervention' ? game.i18n.localize('FASTNRI.Damage.intervention') : warning.resourceId);
    if (warning.reason === 'insufficient') {
      return game.i18n.format('FASTNRI.InterventionOptions.insufficient', {resource:name});
    }
    const key = WARNING_KEYS[warning.reason] ?? 'unavailable';
    const text = game.i18n.localize(`FASTNRI.AbilityChat.${key}`);
    return name ? `${text} (${name})` : text;
  });
  const status = item ? abilityAccountingStatus(actor, item) : null;
  if (status?.remaining === 0) warnings.push(game.i18n.localize('FASTNRI.AbilityChat.noDailyUses'));
  if (status?.cooldownRemainingRounds > 0) {
    warnings.push(game.i18n.format('FASTNRI.AbilityChat.roundCooldown', {rounds: status.cooldownRemainingRounds}));
  }
  return [...new Set(warnings)];
}
