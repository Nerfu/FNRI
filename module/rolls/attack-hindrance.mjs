import {activeConditionEffect, effectHasStatus} from '../effects/active-effect.mjs';
/** Explicit attack circumstances supplied by native ActiveEffects.
 * An effect represents an observed condition, NOT a second native stat change.
 * It is read on demand at attack declaration; no canvas lighting or walls.
 * Only effects attached to the TARGET contribute. Vision comes from explicit
 * traits on the ATTACKER, never from the source token (which may be a Projection).
 */
const SCOPE='fast-nri-v14';
const CONDITIONS=new Map([
  ['partial-cover',{label:'Частичное укрытие',value:-4}],
  ['poor-visibility',{label:'Плохая видимость',value:-4}],
  ['dim-light',{label:'Тусклый свет',value:-4,light:'dim'}],
  ['darkness',{label:'Темнота',value:-10,light:'dark'}],
  ['invisible',{label:'Невидимая цель',value:-10}]
]);
const VISION_KINDS=new Set(['low-light','darkvision']);
function applicableEffects(actor){
  if(!actor)return [];
  try {
    const result=typeof actor.allApplicableEffects==='function'
      ? [...actor.allApplicableEffects()]
      : [...(actor.effects?.contents??[])];
    return result.filter(activeConditionEffect);
  } catch{return [];}
}
function conditionId(effect){
  const marked=String(effect?.flags?.[SCOPE]?.conditionId??'').trim();
  if(CONDITIONS.has(marked))return marked;
  for(const key of CONDITIONS.keys())if(effectHasStatus(effect,key))return key;
  return null;
}
export function attackVision(actor){
  const kinds=new Set();
  const add=value=>{if(VISION_KINDS.has(value))kinds.add(value);};
  add(actor?.flags?.[SCOPE]?.visionKind);
  for(const item of (actor?.items?.contents??[]))add(item?.flags?.[SCOPE]?.visionKind);
  for(const effect of applicableEffects(actor))add(effect?.flags?.[SCOPE]?.visionKind);
  return kinds.has('darkvision')?'darkvision':kinds.has('low-light')?'low-light':'normal';
}
/** Read only conditions the current user is allowed to inspect. GM-visible
 * private target effects must not leak their labels or document UUIDs into a
 * public attacker-side roll message. Unreadable conditions remain manual. */
function readableTarget(target){
  if(!target)return false;
  if(globalThis.game?.user?.isGM)return true;
  return typeof target.testUserPermission==='function' &&
    target.testUserPermission(game.user,'OBSERVER');
}
// Private circumstances are resolved manually using the existing generic
// switches. Even a GM's public attack must not publish a private effect's
// identity via fixed-roll component labels or flags.
function privateCircumstance(effect){
  const f=effect?.flags?.[SCOPE]??{};
  const sourceId=f.abilityResultMessageId??f.periodicDamage?.sourceMessageId;
  const source=sourceId?globalThis.game?.messages?.get?.(sourceId):null;
  return effect.showIcon===0||effect.hidden===true||f.hidden===true||
    f.privateToGm===true||f.attackOutcomeApplication===true||f.periodicDamage?.privateToGm===true||
    !!(sourceId&&(!source||source.blind||source.whisper?.length));
}
export function targetHindranceEntries({attacker=null,target=null,targetToken=null,area=false}={}){
  if(area || !target || targetToken?.hidden===true ||
    targetToken?.document?.hidden===true || targetToken?.visible===false)return [];
  const fullAccess=readableTarget(target);
  // Visible token-status icons are a legitimate source even without Observer
  // permission for the entire target Actor. Hide effects that have no public
  // status icon, so private GM flags are not exposed in player roll summaries.
  const publicToken=targetToken?.visible===true;
  const vision=attackVision(attacker),found=[];
  const duplicateCounts=new Map();
  for(const effect of applicableEffects(target)){
    if(privateCircumstance(effect) || (!fullAccess && (!publicToken || effect.showIcon!==2)))continue;
    const id=conditionId(effect),rule=CONDITIONS.get(id);
    if(!rule)continue;
    if(rule.light==='dim' && vision!=='normal')continue;
    if(rule.light==='dark' && vision==='darkvision')continue;
    const value=rule.light==='dark' && vision==='low-light' ? -4 : rule.value;
    const index=(duplicateCounts.get(id)??0)+1;duplicateCounts.set(id,index);
    found.push({
      uuid:`target-hindrance:${id}:${index}`,sourceUuid:null,sourceType:'target-condition',
      id:`condition-${id}-${index}`,name:'Условия цели',effect:null,native:false,
      nativeChanges:[],actorOwned:false,onUse:'none',
      parts:[{id:'condition',kind:'modifier',label:rule.label+(index>1?` (${index})`:''),
        value:String(value),nonStackingGroup:'hindrance'}]
    });
  }
  return found;
}
