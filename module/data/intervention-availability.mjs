import {abilityAccountingStatus, abilityCostPreview} from './ability-accounting.mjs';

const WARNING_KEYS = {
  ambiguous: 'ambiguousResource',
  kindMismatch:'resourceKindMismatch',
  'intervention-resource-unknown': 'unassignedIntervention'
};

/** Accounting information is advisory for every displayed choice. */
export function interventionWarningGroups(actor, item = null, accounting = null) {
  const common=[],individual=[];
  for (const warning of abilityCostPreview(actor, item, {isIntervention: true, accounting})) {
    const extra=warning.scope==='common' && (warning.amount??1)>1;
    const warnings=warning.scope==='common' && (!extra || warning.reason!=='insufficient') ? common : individual;
    const row = actor.system?.resources?.[warning.resourceId];
    const name = row?.name || warning.resourceName ||
      (row?.kind === 'intervention' ? game.i18n.localize('FASTNRI.Damage.intervention') : warning.resourceId);
    if (warning.reason === 'insufficient') {
      const text=game.i18n.format('FASTNRI.InterventionOptions.insufficient', {resource:name});
      warnings.push(extra?`${text} (${warning.amount})`:text);
      if(extra&&Math.min(warning.current??0,warning.baseCurrent??0)<1)common.push(text);
      continue;
    }
    const key = warning.reason==='missing'&&warning.scope==='common'?'unassignedIntervention':WARNING_KEYS[warning.reason] ?? 'unavailable';
    const text = game.i18n.localize(`FASTNRI.AbilityChat.${key}`);
    warnings.push(name ? `${text} (${name})` : text);
  }
  const warnings=individual;
  const status = item ? abilityAccountingStatus(actor, item) : null;
  if (status?.remaining === 0) warnings.push(game.i18n.localize('FASTNRI.AbilityChat.noDailyUses'));
  if (status?.cooldownRemainingRounds > 0) {
    warnings.push(game.i18n.format('FASTNRI.AbilityChat.roundCooldown', {rounds: status.cooldownRemainingRounds}));
  }
  return {common:[...new Set(common)],individual:[...new Set(individual)]};
}
export function interventionWarnings(actor,item=null,accounting=null) {
  const {common,individual}=interventionWarningGroups(actor,item,accounting);
  return [...new Set([...common,...individual])];
}
