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
import {abilityCostPreview,abilityAccountingStatus} from '../data/ability-accounting.mjs';
import {itemSlot} from '../equipment/equipment.mjs';
import {creatureNature} from '../data/racial-properties.mjs';

const SCOPE='fast-nri-v14';
const VALID_ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DIE=/^([1-9]\d*)d([1-9]\d*)$/i;
const tr=key=>game.i18n.localize(`FASTNRI.AttackAugment.${key}`);
const trimmed=value=>String(value??'').trim();
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);

function validatedDamageParts(raw,{allowFixed=false}={}) {
  if (!Array.isArray(raw) || !raw.length || raw.length>16) return null;
  const result=[];
  for (const part of raw) {
    if (!isObject(part)) return null;
    const match=DIE.exec(trimmed(part.formula));
    if (!match) {
      const value=Number(trimmed(part.formula)),damageType=trimmed(part.damageType);
      if(!allowFixed||!Number.isSafeInteger(value)||value<1||value>1000||String(value)!==trimmed(part.formula)||!damageType||damageType.length>100)return null;
      result.push({kind:'fixed',value,formula:String(value),damageType});continue;
    }
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
  const parts=validatedDamageParts(raw.damageParts,{allowFixed:raw.afterDefenses===true});
  if (!parts) return null;
  const requirements=isObject(raw.requirements)?raw.requirements:{};
  return {id:raw.id,label:trimmed(raw.label)||trimmed(item.name),parts,singleTarget:raw.singleTarget===true,afterDefenses:raw.afterDefenses===true,
    oppositeNatureParts:raw.afterDefenses===true&&raw.oppositeNaturePart?validatedDamageParts([raw.oppositeNaturePart]):null,
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
  if(rule.singleTarget && abilityAccountingStatus(actor,item)?.remaining===0)
    warnings.push(game.i18n.localize('FASTNRI.GameReroll.exhausted'));
  for (const shortage of abilityCostPreview(actor,item)) {
    warnings.push(shortage.reason==='insufficient'?tr('insufficientResource'):
      shortage.reason==='ambiguous'?tr('ambiguousResource'):tr('missingResource'));
  }
  return [...new Set(warnings)];
}

/** Generate a selectable component for each owned ability with explicit data. */
export function attackAugmentEntries(actor,{kind='attack',weaponItem=null,attackKind='melee',declaredTargets=[]}={}) {
  if (kind!=='attack' || !actor) return [];
  return (actor.items?.contents??[]).flatMap(item=>{
    const rule=attackAugmentRule(item);
    if (!rule || !item.uuid) return [];
    const warnings=attackAugmentWarnings({actor,weaponItem,attackKind,rule,item});
    const description=rule.parts.map(p=>p.formula).join(' + ') +
      ` (${[...new Set(rule.parts.map(p=>p.damageType))].join(', ')})`;
    const remaining=rule.singleTarget?abilityAccountingStatus(actor,item)?.remaining:null;
    const note=remaining!=null&&remaining>0?game.i18n.localize('FASTNRI.AbilityChat.dailyRemaining').replace('{remaining}',String(remaining)):null;
    const targets=rule.singleTarget?[...declaredTargets].filter(t=>t?.document?.hidden!==true&&t?.hidden!==true).map(t=>({uuid:t?.document?.uuid??t?.uuid??null,name:t?.name??t?.document?.name??''})):[];
    const targetOptions=targets.length?targets:[{uuid:null,name:game.i18n.localize('FASTNRI.AttackAugment.manualTarget')}];
    const parts=rule.singleTarget?targetOptions.map((target,index)=>({id:`augment-${rule.id}-${index}`,kind:'attackAugment',
      label:`${rule.label} · ${target.name}`,value:`+${description}`,targetUuid:target.uuid,defaultEnabled:false,
      warning:warnings.join('; ')||null,note})): [{id:`augment-${rule.id}`,kind:'attackAugment',label:rule.label,
        value:`+${description}${warnings.length?` · ⚠ ${warnings.join('; ')}`:''}`,defaultEnabled:false}];
    return [{uuid:`attack-augment:${item.uuid}:${rule.id}`,
      sourceUuid:item.uuid,sourceType:'item',id:item.id,name:item.name,
      effect:null,native:false,nativeChanges:[],onUse:'none',actorOwned:false,
      augment:{item,rule,warnings},
      exclusiveParts:rule.singleTarget,parts}];
  });
}

/** Already-selected preroll decisions, not a second decision at damage time. */
export function selectedAttackAugments(context) {
  return (context?.selected??[]).flatMap(entry=>{
    if(!entry.augment)return [];
    const part=entry.parts?.find(p=>p.kind==='attackAugment' && entry.enabledPartIds?.includes(p.id));
    return part?[{...entry.augment,sourceUuid:entry.sourceUuid,
      ...(entry.augment.rule.singleTarget?{targetUuid:part.targetUuid??null}:{})}]:[];
  });
}

/** Minimal, immutable roll-component data; no Item contents or effect snapshot. */
export function attackAugmentDamageParts(augments,{redactSources=false}={}) {
  return augments.filter(augment=>!augment.rule.afterDefenses).flatMap((augment,augmentIndex)=>augment.rule.parts.map((part,index)=>({
    id:`augment-${augmentIndex}-${index}`,kind:'die',faces:part.faces,formula:part.formula,
    damageType:part.damageType,partOrigin:'attackAugment',spellDamage:augment.item.system?.mechanics?.attackAugment?.spellDamage===true,traits:[],
    ...(augment.rule.singleTarget?{singleTarget:true,targetUuid:augment.targetUuid??null}:{}),
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
      ...(part.ferocityDamage===true?{ferocityDamage:true}:{}),
      ...(part.singleTarget===true?{singleTarget:true,targetUuid:typeof part.targetUuid==='string'?part.targetUuid:null}:{}),
      source:typeof part.source==='string'?part.source:null};
  });
}

/** Separate post-defense rolls, not part of the original profile. */
export function postDefenseDamageOffers(augments,{redactSources=false,actor=null,targets=[]}={}) {
  return augments.filter(a=>a.rule.afterDefenses).map((a,index)=>{
    let parts=a.rule.parts.map(p=>({...p}));
    if(a.rule.oppositeNatureParts){
      const own=creatureNature(actor);
      const token=targets.find(t=>(t.document?.uuid??t.uuid)===a.targetUuid && t.document?.hidden!==true && t.hidden!==true);
      const target=token?.actor??token?.document?.actor;
      // Unreadable or unrepresented Nature stays a manual correction.
      const other=target&&(target.isOwner||target.testUserPermission?.(game.user,'OBSERVER'))?creatureNature(target):null;
      if(own&&other&&own!==other)parts.push(...a.rule.oppositeNatureParts.map(p=>({...p})));
      if(own)parts=parts.map(p=>({...p,traits:[own==='holy'?'Святой':'Нечестивый']}));
    }
    return {id:`after-${index}`,label:redactSources?null:a.rule.label,targetUuid:a.targetUuid??null,
      singleTarget:a.rule.singleTarget,parts,sourceUuid:redactSources?null:a.sourceUuid};
  });
}
