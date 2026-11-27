/**
 * Fast NRI 7.0 — source-labelled per-roll contributions.
 *
 * A normal card formula (including any prepared Actor value) is ONE fixed
 * base contribution. We must not reverse-engineer its inner arithmetic or
 * add values a second time. Selectable additions are explicit card rules or
 * separately discoverable ActiveEffect changes, never guessed from labels.
 *
 * Optional Item.system.mechanics.rollContributions:
 * [{label:'Частичное укрытие',kind:'modifier',value:-4,kinds:['attack'],nonStackingGroup:'hindrance'},
 *  {label:'Улучшенный куб',kind:'replacement',from:'1d8',to:'1d10',kinds:['attack']}] 
 * This affects only the Item's own roll (sourceItem); nothing is installed
 * permanently on the Actor and no resource is charged by this facility.
 */
import {actorRoleDefinition} from '../data/roles.mjs';
const ROLL_KINDS = new Set(['skill','ability','attack','intervention','damage','maneuver','heal']);
const DICE_TERM = /^(?:[1-9]\d*)?d[1-9]\d*$/i;
const compact = v => String(v ?? '').trim();
const pr = key => game.i18n.localize(`FASTNRI.Preroll.${key}`);

/** Explicit scope for a custom card's native damage/healing formula.
 * Absence preserves the existing generic ability behavior. No inference from names.
 */
export function cardRollKind(item, execution=null) {
  const kind=execution?.rollKind??item?.system?.mechanics?.rollKind;
  return ['damage','heal','maneuver'].includes(kind)?kind:'ability';
}

/** Explicit, source-labelled components. No arbitrary JS or inferred class rules.
 * applyToOtherRolls is opt-in on passive class/race Item contributions. */
export function ruleComponents(raw, {kind,skillId=null,defenseStat=null,attackDamage=false}, {passive=false}={}) {
  if (!ROLL_KINDS.has(kind) || !Array.isArray(raw)) return [];
  const parts=[];
  raw.forEach((entry,i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    if (passive && entry.applyToOtherRolls !== true) return;
    if (!Array.isArray(entry.kinds) || !entry.kinds.includes(kind)) return;
    if (entry.attackDamageOnly===true && !attackDamage) return;
    if (entry.skillId && entry.skillId !== skillId) return;
    if (entry.defenseStat && entry.defenseStat !== defenseStat) return;
    const label = compact(entry.label) || pr('cardModifier');
    if (entry.kind === 'modifier') {
      if (entry.value === null || entry.value === undefined || entry.value === '') return;
      const value = compact(entry.value).replace(/\s+/g,'');
      if (!/^[+-]?(?:(?:\d+(?:\.\d+)?|\.\d+)|(?:[1-9]\d*)?d[1-9]\d*)$/i.test(value)) return;
      const group=entry.nonStackingGroup;
      const numeric=Number(value);
      const equipment=/^\+?(?:1)?d([1-9]\d*)$/i.exec(value);
      const nonStackingGroup=group==='hindrance' && kind==='attack' && Number.isFinite(numeric) && numeric<0
        ? 'hindrance' : group==='equipmentBonus' && kind!=='damage' && equipment ? 'equipmentBonus' : null;
      parts.push({id:`card-${i}`,kind:'modifier',label,value,
        ...(entry.defaultEnabled===false?{defaultEnabled:false}:{}),
        ...(nonStackingGroup?{nonStackingGroup}:{}),
        damageType:compact(entry.damageType),traits:Array.isArray(entry.traits)?entry.traits:[]});
    } else if (entry.kind === 'hindranceReduction' && kind === 'attack') {
      const value=Number(entry.value);
      if(Number.isSafeInteger(value)&&value>0)parts.push({id:`card-${i}`,kind:'hindranceReduction',label,value:String(value),...(entry.defaultEnabled===false?{defaultEnabled:false}:{})});
    } else if (entry.kind === 'replacement') {
      const from=compact(entry.from),to=compact(entry.to);
      if (DICE_TERM.test(from)&&DICE_TERM.test(to))
        parts.push({id:`card-${i}`,kind:'replacement',label,from,to,
          ...(entry.defaultEnabled===false?{defaultEnabled:false}:{})});
    }
  });
  return parts;
}

export function itemRollContributions(item, params={}, options={}) {
  if (!item) return [];
  return ruleComponents(item.system?.mechanics?.rollContributions,params,options);
}

/** Normalize one source Item into the SAME selection interface as an effect.
 * Its synthetic id is solely local to the current roll and is never a UUID
 * to resolve via Foundry documents. No modification of the Item is made.
 */
export function cardContributionEntry(item, params={}, options={}) {
  const parts = itemRollContributions(item,params,options);
  if (!parts.length || !compact(item?.uuid)) return null;
  return {
    uuid:`card:${item.uuid}`,sourceUuid:item.uuid,sourceType:'item',
    id:item.id??null,name:compact(item.name) || pr('card'),
    effect:null, native:false, nativeChanges:[], parts,
    modifier:null,replacement:null,onUse:'none',actorOwned:false
  };
}

/** Role rules use the same selectable components as cards, without an Item. */
export function roleContributionEntry(actor,params) {
  const definition=actorRoleDefinition(actor);
  if(!definition)return null;
  const [id,rule]=definition;
  const parts=ruleComponents(rule.rollContributions,params);
  if(!parts.length)return null;
  return {uuid:`role:${actor.uuid??actor.id??'actor'}:${id}`,sourceUuid:actor.uuid??null,
    sourceType:'role',id,name:rule.name,effect:null,native:false,nativeChanges:[],parts,
    modifier:null,replacement:null,onUse:'none',actorOwned:false};
}

/** Rules-recognized non-stacking groups. Individual switches remain independent.
 * Hindrance: strongest negative value; Equipment Bonus: die with most faces.
 * Class bonuses and all unnamed sources retain their normal stacking rules.
 */
export function nonStackingSelections(selected=[]) {
  const groups=new Map();
  for(const entry of selected) {
    const enabled=Array.isArray(entry.enabledPartIds)?new Set(entry.enabledPartIds):null;
    for(const part of entry.parts??[]) {
      if(enabled?!enabled.has(part.id):part.defaultEnabled===false)continue;
      if(part.kind!=='modifier')continue;
      const group=part.nonStackingGroup;
      let rank=null;
      if(group==='hindrance'){
        const v=Number(part.value);
        if(Number.isFinite(v)&&v<0)rank=-v;
      }else if(group==='equipmentBonus'){
        const die=/^\+?(?:1)?d([1-9]\d*)$/i.exec(String(part.value??''));
        if(die)rank=Number(die[1]);
      }
      if(!Number.isFinite(rank))continue;
      const candidate={entry:entry.uuid,part:part.id,value:String(part.value),rank};
      let data=groups.get(group);
      if(!data)groups.set(group,data={winner:candidate,candidates:[]});
      data.candidates.push(candidate);
      if(rank>data.winner.rank)data.winner=candidate;
    }
  }
  return groups;
}

/** Reduce only the winning hindrance. Duplicate effects do not multiply the relief. */
export function effectiveHindrance(selected=[],group=nonStackingSelections(selected).get('hindrance')) {
  if(!group)return null;
  let reduction=0;
  for(const entry of selected){
    const enabled=Array.isArray(entry.enabledPartIds)?new Set(entry.enabledPartIds):null;
    for(const part of entry.parts??[]){
      if(enabled?!enabled.has(part.id):part.defaultEnabled===false)continue;
      if(part.kind==='hindranceReduction'&&Number.isSafeInteger(Number(part.value))&&Number(part.value)>0)
        reduction=Math.max(reduction,Number(part.value));
    }
  }
  const raw=Number(group.winner.value);
  return {value:Math.min(0,raw+reduction),raw,reduction:Math.min(-raw,reduction)};
}

/** A single presentation/snapshot catalog describing every contribution
 * which this engine can actually identify. The base formula is not split.
 */
export function buildRollContributionCatalog({actor=null,sourceItem=null,
  formula='',available=[],selected=available,manual=[]}={}) {
  const selectedById=new Map(selected.map(entry=>[entry.uuid,entry]));
  const winners=nonStackingSelections(selected);
  const base={id:'base',kind:'base',sourceType:sourceItem?'item':actor?'actor':'formula',
    sourceUuid:sourceItem?.uuid??actor?.uuid??null,
    sourceName:compact(sourceItem?.name ?? actor?.name) || pr('rollFormula'),
    label:pr('baseFormula'),value:String(formula??''),selectable:false,enabled:true};
  const contributions=[base];
  for (const entry of available) {
    const chosen=selectedById.get(entry.uuid);
    const included=new Set(chosen?.enabledPartIds ?? (chosen?.parts ?? []).map(part=>part.id));
    for (const part of entry.parts??[]) {
      const group=part.nonStackingGroup;
      const winning=group && winners.get(group)?.winner;
      const isApplied=!group || (winning?.entry===entry.uuid && winning?.part===part.id);
      contributions.push({
      id:`${entry.uuid}::${part.id}`,kind:part.kind,
      sourceType:entry.sourceType??'effect',sourceUuid:entry.sourceUuid??entry.uuid,
      sourceName:entry.name,label:part.label??
        (part.kind==='native'?part.key:part.kind==='replacement'?pr('replaceDie'):
          part.kind==='modifier'?pr('modifier'):pr('activation')),
      value:part.kind==='replacement'?`${part.from} → ${part.to}`:
        part.kind==='native'?part.value:part.value??'',
      selectable:true,enabled:included.has(part.id),
      ...(group?{nonStackingGroup:group,applied:!!isApplied&&included.has(part.id)}:{})
    });
    }
  }
  for (const [i,component] of (manual ?? []).entries()) contributions.push({
    id:`manual-${i}`,kind:'modifier',sourceType:'manual',sourceUuid:null,
    sourceName:component.comment || pr('manual'),label:component.comment || pr('manual'),
    value:component.value,selectable:true,enabled:true
  });
  return contributions;
}

/** Card-defined replacement of the combat die for Protective checks. */
export function protectiveCombatDice(actor,base){
  if(!base)return base;
  const replacement=[...(actor?.items?.contents??actor?.items??[])].find(i=>i.type==='ability'&&DICE_TERM.test(String(i.system?.mechanics?.defensiveCombatDice??'')))?.system.mechanics.defensiveCombatDice;
  return replacement??base;
}
