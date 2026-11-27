/**
 * Per-use weapon property selection. All behavior is declared on an Item,
 * never inferred from its name or Russian property text.
 * The unified preroll shows one checkbox per trait option. A choice belongs
 * only to this attack; neither the weapon nor the Actor is modified.
 */
import {itemAttackRules} from './item-properties.mjs';
const validId = value => /^[a-z][a-z0-9_-]{0,63}$/.test(String(value ?? ''));
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = value => typeof value === 'number' && Number.isFinite(value);

/** A card can declare multiple separately controllable traits. */
export function weaponTraitOptions(weapon) {
  if (weapon?.type !== 'weapon') return [];
  const raw = weapon.system?.mechanics?.attack?.traitOptions;
  if (!Array.isArray(raw)) return [];
  const seen=new Set();
  return raw.filter(option => {
    if (!validId(option?.id) || seen.has(option.id)) return false;
    seen.add(option.id);
    return !!String(option.label ?? '').trim();
  });
}

export function weaponTraitEntry(weapon,{kind='attack',declaredSpellWeapon=false}={}) {
  if (!['attack','ability'].includes(kind) || !weapon?.uuid) return null;
  const options=weaponTraitOptions(weapon).filter(option=>!declaredSpellWeapon||option.id!=='charged');
  if (!options.length) return null;
  return {uuid:`weapon-traits:${weapon.uuid}`,sourceUuid:weapon.uuid,sourceType:'weapon',
    id:weapon.id??null,name:`${weapon.name} · ${game.i18n.localize('FASTNRI.Preroll.weaponTraits')}`,
    effect:null,native:false,nativeChanges:[],onUse:'none',actorOwned:false,
    parts:options.map(option => ({id:`trait-${option.id}`,traitId:option.id,kind:'weaponTrait',
      label:option.effect?.rerollWeaponLowOnce===true && kind==='attack'
        ? `${game.i18n.localize('FASTNRI.GameReroll.autoReroll')} · ${option.label}` : String(option.label),
      value:String(option.effect?.rerollWeaponLowOnce===true || option.id==='catalyst'
        ? game.i18n.localize('FASTNRI.GameReroll.traitHint') : option.summary??option.description??''),
      defaultEnabled:option.effect?.rerollWeaponLowOnce===true && kind==='attack' ? false : option.defaultEnabled!==false}))};
}

/** Names are display-only; they never drive rules. */
export function selectedWeaponPropertyNames(weapon,traitIds=[]) {
  const chosen=new Set(traitIds);
  return weaponTraitOptions(weapon).filter(option=>chosen.has(option.id))
    .map(option=>String(option.label));
}

/** This is a selection of card rule IDs, not a second effects snapshot. */
export function selectedWeaponTraitIds(context,weapon) {
  const entry=context?.selected?.find(e=>e.uuid===`weapon-traits:${weapon?.uuid}`);
  if (!entry) return [];
  const enabled=Array.isArray(entry.enabledPartIds)?new Set(entry.enabledPartIds):null;
  return entry.parts.filter(p=>p.kind==='weaponTrait' &&
    (enabled?enabled.has(p.id):p.defaultEnabled!==false)).map(p=>p.traitId);
}

/** Convert only the selected, validated rules into the existing attack fields.
 * Legacy Items without traitOptions retain the old 2H behavior unchanged.
 */
export function selectedWeaponAttackRules(weapon,traitIds=null) {
  const options=weaponTraitOptions(weapon);
  if (!options.length) return {...itemAttackRules(weapon),
    outcomes:Array.isArray(weapon?.system?.mechanics?.attack?.outcomes)?
      weapon.system.mechanics.attack.outcomes:[]};
  const chosen=new Set(Array.isArray(traitIds)?traitIds:options.filter(o=>o.defaultEnabled!==false).map(o=>o.id));
  const result={defenseCheckModifier:0,defenseRemovalOrder:'highest',
    greatSelfDefenseModifier:0,rerollWeaponLowOnce:false,outcomes:[]};
  for(const option of options) {
    if(!chosen.has(option.id)) continue;
    const effect=object(option.effect);
    if(finite(effect.defenseCheckModifier))result.defenseCheckModifier+=effect.defenseCheckModifier;
    if(effect.defenseRemovalOrder==='lowest')result.defenseRemovalOrder='lowest';
    if(finite(effect.greatSelfDefenseModifier))result.greatSelfDefenseModifier+=effect.greatSelfDefenseModifier;
    if(effect.rerollWeaponLowOnce===true)result.rerollWeaponLowOnce=true;
    if(Array.isArray(effect.outcomes))result.outcomes.push(...effect.outcomes);
  }
  return result;
}

/** Ability-specific consequences remain separate from the weapon's rules. */
export function combinedWeaponAttackRules(sourceItem,weapon,traitIds=[]) {
  const source=sourceItem && sourceItem!==weapon ? itemAttackRules(sourceItem) : null;
  const selected=selectedWeaponAttackRules(weapon,traitIds);
  if (!source) return selected;
  return {defenseCheckModifier:(source.defenseCheckModifier??0)+selected.defenseCheckModifier,
    defenseRemovalOrder: selected.defenseRemovalOrder==='lowest'?'lowest':source.defenseRemovalOrder,
    greatSelfDefenseModifier:(source.greatSelfDefenseModifier??0)+selected.greatSelfDefenseModifier,
    rerollWeaponLowOnce:source.rerollWeaponLowOnce===true||selected.rerollWeaponLowOnce===true,
    outcomes:[...(sourceItem?.system?.mechanics?.attack?.outcomes??[]),...selected.outcomes]};
}

/** An ability must explicitly say that it uses a weapon. The optional Item ID
 * resolves only within its Actor; otherwise a sole equipped weapon is unambiguous.
 * Multiple held weapons are never guessed or silently combined.
 */
export function abilityUsesWeapon(item) {
  const attack=object(item?.system?.mechanics?.attack);
  return item?.type==='ability' && (attack.useWeapon===true ||
    !!String(attack.weaponId??'').trim() || !!String(attack.weaponUuid??'').trim());
}
export function resolveAbilityWeapon(item,actor) {
  if(!abilityUsesWeapon(item) || !actor?.items) return null;
  const attack=object(item.system.mechanics.attack);
  const explicit=String(attack.weaponId??'').trim() || String(attack.weaponUuid??'').trim();
  if(explicit) {
    const all=actor.items.contents??[...actor.items];
    return all.find(weapon=>weapon.type==='weapon' &&
      (weapon.id===explicit||weapon.uuid===explicit))??null;
  }
  const hand=actor.system?.equipment??{};
  const ids=[...new Set([hand.leftHand,hand.rightHand].filter(Boolean))];
  const choices=ids.map(id=>actor.items.get?.(id)).filter(weapon=>weapon?.type==='weapon');
  return choices.length===1?choices[0]:null;
}

/** Sweeping affects base weapon dice; Catalyst affects magic damage dice belonging to a spell (including Blade). */
export function weaponRerollEligible(part,rule,profileKind) {
  if(part?.kind!=='die'||part.noReroll||part.gameRerolled||part.pending||!Number.isInteger(part.faces)||
    part.faces<2||!Number.isFinite(part.value))return false;
  const id=part.profilePart??part.id;
  return rule==='sweeping' ? !part.added&&profileKind!=='magic'&&['A','B'].includes(id)&&[1,2].includes(part.value) :
    rule==='catalyst'&&!part.added&&part.value===1 &&
      (part.spellDamage===true || (profileKind==='magic'&&/^M[1-9]\d*$/.test(id))) &&
      ['магический','magical','magic'].includes(String(part.damageType??(profileKind==='magic'?'магический':'')).toLowerCase());
}

/** Explicit opt-in: one real Roll per matching damage die. Retain original values
 * and the same per-die history marker used by the post-roll gameplay menu. */
export async function autoRerollWeaponParts(parts,traits,profileKind) {
  const history=[];
  for(const part of parts) {
    const rule=['sweeping','catalyst'].find(key=>traits?.[key]&&weaponRerollEligible(part,key,profileKind));
    if(!rule)continue;
    const roll=await new Roll(`1d${part.faces}`).evaluate();
    const value=roll.total;
    if(!Number.isInteger(value)||value<1||value>part.faces)throw Error('Invalid automatic reroll result');
    const before={value:part.value,excluded:!!part.excluded};
    // The replacement is the active result for every later calculation.
    // original and history are audit data, not a second damage pool.
    part.value=value;part.gameRerolled=true;
    history.push({by:game.user?.id??null,at:Date.now(),action:'reroll',id:part.id,
      before,after:{value,excluded:!!part.excluded},gameReroll:true,automatic:true,rule,
      ...(typeof roll.toJSON==='function'?{roll:roll.toJSON()}: {})});
  }
  return history;
}
