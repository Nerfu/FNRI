/**
 * Fast NRI 7.0 — optional Item-defined weapon-attack enhancements.
 *
 * The attacker selects one in the EXISTING attack preroll. It changes neither
 * the attack formula nor the Actor/weapon documents. On a published attack, its
 * independently typed dice are saved as minimal component definitions for the
 * normal damage roll and its Item-defined accounting is recorded once.
 *
 * Item.system.mechanics.attackAugment = {
 *   id: 'example', label: '...',
 *   damageParts: [{formula:'1d8', damageType:'магический'}],
 *   requirements: {attackKind:'melee', weaponContentIds:['...']}
 * };
 * Item.system.mechanics.accounting owns the actual resource cost.
 * Requirements are advisory; an invalid weapon never blocks a roll.
 */
import {abilityCostPreview} from '../data/ability-accounting.mjs';
import {itemSlot} from '../equipment/equipment.mjs';

const SCOPE='fast-nri-v14';
const VALID_ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DIE=/^([1-9]\d*)d([1-9]\d*)$/i;
const tr=key=>game.i18n.localize(`FASTNRI.AttackAugment.${key}`);
const trimmed=value=>String(value??'').trim();
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);

function validatedDamageParts(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length>16) return null;
  const result=[];
  for (const part of raw) {
    if (!isObject(part)) return null;
    const match=DIE.exec(trimmed(part.formula));
    if (!match) return null;
    const count=Number(match[1]), faces=Number(match[2]);
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(faces) || count>32 || faces>1000)
      return null;
    const damageType=trimmed(part.damageType);
    if (!damageType || damageType.length>100) return null;
    for (let i=0;i<count;i++) result.push({kind:'die',faces,formula:`1d${faces}`,damageType});
  }
  return result.length<=100 ? result : null;
}

/** The existence of a card never implicitly enables it. */
export function attackAugmentRule(item) {
  if (item?.type!=='ability') return null;
  const raw=item.system?.mechanics?.attackAugment;
  if (!isObject(raw) || !VALID_ID.test(raw.id)) return null;
  const parts=validatedDamageParts(raw.damageParts);
  if (!parts) return null;
  const requirements=isObject(raw.requirements)?raw.requirements:{};
  return {id:raw.id,label:trimmed(raw.label)||trimmed(item.name),parts,
    requirements:{attackKind:trimmed(requirements.attackKind),
      weaponContentIds:Array.isArray(requirements.weaponContentIds)
        ? requirements.weaponContentIds.map(trimmed).filter(Boolean) : []}};
}

/** Compare only declared properties; names never grant eligibility. */
export function attackAugmentWarnings({actor=null,weaponItem=null,attackKind='melee',rule=null,item=null}={}) {
  if (!rule) return [];
  const warnings=[];
  const req=rule.requirements;
  if (req.attackKind && req.attackKind!==attackKind) warnings.push(tr('wrongAttackKind'));
  if (req.weaponContentIds.length) {
    if (weaponItem?.type!=='weapon') warnings.push(tr('requiresWeapon'));
    else {
      const sourceId=trimmed(weaponItem.flags?.[SCOPE]?.contentId);
      if (!req.weaponContentIds.includes(sourceId)) warnings.push(tr('wrongWeapon'));
      if (!itemSlot(weaponItem.id,actor?.system)?.positions?.length) warnings.push(tr('weaponNotHeld'));
    }
  }
  for (const shortage of abilityCostPreview(actor,item)) {
    warnings.push(shortage.reason==='insufficient'?tr('insufficientResource'):
      shortage.reason==='ambiguous'?tr('ambiguousResource'):tr('missingResource'));
  }
  return [...new Set(warnings)];
}

/** Generate a selectable component for each owned ability with explicit data. */
export function attackAugmentEntries(actor,{kind='attack',weaponItem=null,attackKind='melee'}={}) {
  if (kind!=='attack' || !actor) return [];
  return (actor.items?.contents??[]).flatMap(item=>{
    const rule=attackAugmentRule(item);
    if (!rule || !item.uuid) return [];
    const warnings=attackAugmentWarnings({actor,weaponItem,attackKind,rule,item});
    const description=rule.parts.map(p=>p.formula).join(' + ') +
      ` (${[...new Set(rule.parts.map(p=>p.damageType))].join(', ')})`;
    return [{uuid:`attack-augment:${item.uuid}:${rule.id}`,
      sourceUuid:item.uuid,sourceType:'item',id:item.id,name:item.name,
      effect:null,native:false,nativeChanges:[],onUse:'none',actorOwned:false,
      augment:{item,rule,warnings},
      parts:[{id:`augment-${rule.id}`,kind:'attackAugment',label:rule.label,
        value:`+${description}${warnings.length?` · ⚠ ${warnings.join('; ')}`:''}`,
        defaultEnabled:false}]}];
  });
}

/** Already-selected preroll decisions, not a second decision at damage time. */
export function selectedAttackAugments(context) {
  return (context?.selected??[]).filter(entry=>entry.augment &&
    entry.enabledPartIds?.includes(`augment-${entry.augment.rule.id}`))
    .map(entry=>({...entry.augment,sourceUuid:entry.sourceUuid}));
}

/** Minimal, immutable roll-component data; no Item contents or effect snapshot. */
export function attackAugmentDamageParts(augments,{redactSources=false}={}) {
  return augments.flatMap((augment,augmentIndex)=>augment.rule.parts.map((part,index)=>({
    id:`augment-${augmentIndex}-${index}`,kind:'die',faces:part.faces,formula:part.formula,
    damageType:part.damageType,partOrigin:'attackAugment',spellDamage:augment.item.system?.mechanics?.attackAugment?.spellDamage===true || augment.item.flags?.[SCOPE]?.contentId==='fnri7.rulebook.ability.warlock.blade',traits:[],
    source:redactSources?null:augment.sourceUuid
  })));
}

/** Accept saved message data only if it is a typed independent-die definition. */
export function readAttackAugmentDamageParts(raw) {
  if (!Array.isArray(raw) || raw.length>100) return [];
  return raw.map((part,index)=>{
    const faces=Number(part?.faces);
    if (!Number.isSafeInteger(faces) || faces<1 || faces>1000 ||
      part?.kind!=='die' || part?.formula!==`1d${faces}` ||
      !trimmed(part?.damageType) || trimmed(part.damageType).length>100)
      throw new Error('Invalid saved attack enhancement');
    return {id:`augment-${index}`,kind:'die',faces,formula:`1d${faces}`,
      damageType:trimmed(part.damageType),partOrigin:'attackAugment',spellDamage:part.spellDamage===true,traits:[],
      source:typeof part.source==='string'?part.source:null};
  });
}
