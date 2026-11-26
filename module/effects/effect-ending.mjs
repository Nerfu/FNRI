/** Explicit ending policy. No inference from names or free-form rule text. */
import {activeConditionEffect} from './condition-turn.mjs';
const S='fast-nri-v14';
const defaults=new Set(['frightened','weakened','slowed','immobilized']);
const particular=new Set(['grabbed','prone','unconscious','sustained','stunned','invisible','partial-cover','poor-visibility','darkness','dim-light']);
export function effectEndingMode(effect){
  const f=effect?.flags?.[S]??{};
  if(f.effectEnding==='general'||f.effectEnding==='particular')return f.effectEnding;
  // Known standalone condition definitions explicitly refer to the general rule.
  // Old instances from unclassified ability sources must be declared manually.
  if(defaults.has(f.conditionId)&&!f.abilityResultMessageId&&!f.attackOutcomeApplication&&
    (!effect.origin || effect.origin.startsWith('Compendium.fast-nri-v14.conditions.')))return 'general';
  return '';
}
export function supportsEndingChoice(effect){
  const f=effect?.flags?.[S]??{};
  return !effect?.transfer&&!f.periodicDamage&&!f.deathLifecycle&&!f.informationalMarker&&!(['remove','disable'].includes(f.rollInfluence?.onUse))&&!particular.has(f.conditionId)&&![...(effect?.statuses??[])].some(id=>typeof id==='string'&&id.startsWith('fnri7-')&&particular.has(id.slice(6)));
}
export function hasParticularDuration(effect){
  const d=effect?.duration??{};
  return (typeof d.expiry==='string'&&d.expiry.length>0)||['value','seconds','rounds','turns'].some(key=>d[key]!==null&&d[key]!==undefined&&d[key]!==''&&Number.isFinite(Number(d[key])));
}
export function eligibleForGeneralEnding(effect){
  return effect?.parent?.documentName==='Actor'&&!!effect.id&&activeConditionEffect(effect)&&
    supportsEndingChoice(effect)&&!hasParticularDuration(effect)&&effectEndingMode(effect)==='general';
}

/** HUD and attack consequences may deliberately reuse their native document ID.
 * A fresh instance tag protects pending cleanup from removing a replacement. */
export function newEndingInstance(){
  return globalThis.foundry?.utils?.randomID?.()??globalThis.crypto.randomUUID();
}
