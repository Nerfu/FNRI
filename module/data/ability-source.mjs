import {actorClassDefinition} from './classes.mjs';
import {racialPropertyRule, racialState, racialRaceName} from './racial-properties.mjs';
const ID='fast-nri-v14';
const flag=(item,key)=>item?.getFlag?.(ID,key) ?? item?.flags?.[ID]?.[key] ?? item?.[`flags.${ID}.${key}`];
const tr=key=>globalThis.game?.i18n?.localize?.(`FASTNRI.AbilitySource.${key}`) ?? key;

/** Acquisition context is not the authored provenance of the content template.
 * The current class's registered ability list is the existing class action
 * relationship; racial property membership is explicit, not guessed by name.
 * No inferred source for arbitrary embedded items or unsupported future grants. */
export function abilitySource(actor,item,{classContentId=null}={}) {
  const contentOrigin=flag(item,'source') ?? null;
  const id=classContentId ?? flag(item,'contentId');
  const cls=actorClassDefinition(actor);
  if (cls?.abilityIds?.includes(id) && (classContentId || item?.type==='ability'))
    return {kind:'class',label:cls.name,contentOrigin};
  const rule=racialPropertyRule(item);
  if (rule) {
    const state=actor?.type==='character' ? racialState(actor) : null;
    const matching=state?.races.filter(r=>rule.races?.includes(r)) ?? [];
    // Universal or ambiguous properties are not assigned a fictitious race.
    const race=rule.universal !== true && matching.length===1 ? racialRaceName(matching[0]) : null;
    return {kind:'racial',label:race ?? tr('racial'),contentOrigin};
  }
  return {kind:'unknown',label:null,contentOrigin};
}
