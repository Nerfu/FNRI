/**
 * Common, declarative item properties. The interpreter never branches on
 * Item.name or on the Russian text of a weapon trait. Content defines rules.
 * Read-only helpers; no hidden Actor mutation or additional sheet controls.
 */
import {itemSlot} from './equipment.mjs';
import {nativeUnarmedGrant} from '../data/native-unarmed-grants.mjs';
const finite=x=>typeof x==='number' && Number.isFinite(x);
const acKeys=['partial','success','great'];
const asObject=x=>x && typeof x==='object' && !Array.isArray(x) ? x : {};

/** Return a rule encoded on the card, not guessed from the trait label. */
export function itemAttackRules(item) {
  const attack=asObject(item?.system?.mechanics?.attack ?? nativeUnarmedGrant(item)?.attack);
  const modifier=attack.defenseCheckModifier;
  return {
    defenseCheckModifier:finite(modifier)&&modifier>=-100&&modifier<=100?modifier:0,
    defenseRemovalOrder:attack.defenseRemovalOrder==='lowest'?'lowest':'highest',
    // This modifier belongs ONLY to built-in Самозащита on a Great Success.
    // It is not a global penalty to Counteraction, ally protection or AC.
    greatSelfDefenseModifier:finite(attack.greatSelfDefenseModifier) ? attack.greatSelfDefenseModifier : 0,
    // Opt-in because Размашистое says "можно", not "обязательно".
    rerollWeaponLowOnce:attack.rerollWeaponLowOnce === true
  };
}

/** A snapshot of equipped Item-owned protection. Item effects managed by
 * Foundry's transfer system are NOT repeated here. PC uses the held protection
 * result; standard class armour remains fixed until 1.0.
 */
export function equipmentDefensePreview(actor,{classAcBonus=null,system=actor?.system,shieldBonus=0}={}) {
  const items=actor?.items?.contents??[];
  const equipped=items.filter(item=>!!itemSlot(item.id,system));
  const armor=equipped.find(item=>item.id===system?.equipment?.armor && item.type==='armor')??null;
  const wornHandItems=equipped.filter(item=>itemSlot(item.id,system)?.kind==='hand');
  const protective=wornHandItems.flatMap(item=>{
    const rule=asObject(item.system?.mechanics?.protection);
    if(!finite(rule.acBonus))return [];
    return [{itemUuid:item.uuid??null,name:item.name??'',
      bonus:rule.acBonus+(rule.kind==='shield'&&finite(shieldBonus)?shieldBonus:0)}];
  });
  // The Rulebook defensive property uses the greatest bonus, never the sum.
  const protection=protective.length?Math.max(0,...protective.map(entry=>entry.bonus)):0;
  const armorThresholds=armor && acKeys.every(key=>finite(armor.system?.ac?.[key]))?
    Object.fromEntries(acKeys.map(key=>[key,armor.system.ac[key]])):null;
  const bonus=finite(classAcBonus)?classAcBonus:null;
  const total=armorThresholds && bonus!==null ?
    Object.fromEntries(acKeys.map(key=>[key,armorThresholds[key]+bonus+protection])):null;
  return {armorUuid:armor?.uuid??null,armorName:armor?.name??null,
    armorThresholds,protection,protectiveItems:protective,classAcBonus:bonus,
    total,needsClassAcBonus:!!armorThresholds&&bonus===null};
}

/** One inspection API for all existing Item types; unknown types are not
 * disabled and still retain their Foundry-native fields and effects. */
export function itemCapabilities(item) {
  const system=item?.system??{};
  const mechanics=asObject(system.mechanics);
  return {
    itemUuid:item?.uuid??null,itemType:item?.type??null,
    canAttack:((item?.type==='weapon' && system.attackKind!=='focus' && !!system.damageProfile?.A) ||
      mechanics.attack?.kind==='physical'),
    hasRoll:!!String(system.rollFormula??'').trim(),
    hasEffects:(item?.effects?.contents?.length??0)>0,
    hasUse:Array.isArray(mechanics.use?.operations)&&mechanics.use.operations.length>0,
    hasArmorThresholds:item?.type==='armor'&&acKeys.every(key=>finite(system.ac?.[key])),
    protectionBonus:finite(mechanics.protection?.acBonus)?mechanics.protection.acBonus:null,
    attackRules:itemAttackRules(item),
    attackOutcomeRules:Array.isArray(mechanics.attack?.outcomes)?mechanics.attack.outcomes.length:0,
    deprecated:item?.getFlag?.('fast-nri-v14','status')==='deprecated'
  };
}

/** Tool bonuses require an explicitly bound skill on the Item. Resolve one
 * strongest equipment die; never stack several kits/references. A reference
 * requiring a suitable circumstance is included ONLY when the caller confirms
 * those circumstances. This is a read-only source for the existing roll UI.
 */
export function equipmentSkillBonusPreview(actor,skillId,{circumstancesApproved=false}={}) {
  const candidates=(actor?.items?.contents??[]).flatMap(item=>{
    const tool=asObject(item.system?.mechanics?.tool);
    if (tool.chosenSkillId!==skillId || typeof tool.dice!=='string') return [];
    if (tool.requiresCircumstances && !circumstancesApproved) return [];
    const hit=/^1d([1-9]\d*)$/.exec(tool.dice.trim());
    if (!hit) return [];
    return [{itemUuid:item.uuid??null,itemName:item.name??'',formula:tool.dice.trim(),faces:Number(hit[1])}];
  });
  candidates.sort((a,b)=>b.faces-a.faces);
  return {skillId,candidates,chosen:candidates[0]??null,
    nonStacking:true,automaticallyAdded:false};
}

/** Focus bonus is conditional on the chosen spell weapon and proficiency;
 * spell-energy matching and spell target selection belong to the spell card.
 * No bonuses are inferred from having a focus in the backpack.
 */
export function spellFocusPreview(actor) {
  const held=(actor?.items?.contents??[]).filter(item=>
    itemSlot(item.id,actor.system)?.kind==='hand');
  const caster=String(actor?.system?.className??'').trim();
  const candidates=held.flatMap(item=>{
    const rule=asObject(item.system?.mechanics?.spell);
    if (!finite(rule.rangeBonus) || rule.rangeBonus<=0) return [];
    if (rule.requiresProficiency && !Array.isArray(rule.proficiencyClasses)) return [];
    if (rule.requiresProficiency && !rule.proficiencyClasses.includes(caster)) return [];
    return [{itemUuid:item.uuid??null,itemName:item.name??'',rangeBonus:rule.rangeBonus}];
  });
  return {candidates,rangeBonus:candidates.length?Math.max(...candidates.map(x=>x.rangeBonus)):0,
    automaticallyAdded:false};
}
