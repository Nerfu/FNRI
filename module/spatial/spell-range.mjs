import {classDefinition} from '../data/classes.mjs';
import {itemSlot,weaponProficiency} from '../equipment/equipment.mjs';
import {chooseByButtons} from '../rolls/button-choice.mjs';
const range=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const held=actor=>(actor?.items?.contents??[]).filter(item=>itemSlot(item.id,actor?.system)?.kind==='hand');
const energyId=value=>typeof value==='string'&&value.trim()?value.trim():null;
/** Card-specific energy takes precedence (including multiclass executions).
 * Without a card field, use only a class whose spell energy the canon defines. */
export function spellEnergy(actor,rule){
  if(Object.hasOwn(rule??{},'spellEnergy'))return energyId(rule.spellEnergy);
  return energyId(classDefinition(actor?.system)?.spellEnergy);
}
/** One authored spell declaration for all execution types. Explicit card
 * energy overrides class defaults, including a null value. Ordinary weapon
 * attacks and attack augments do not enter the spell-focus path. */
export function spellExecutionRule(item,execution){
  if(!execution)return null;
  const mechanics=item?.system?.mechanics??{};
  const attack=execution.type==='attack'?{...mechanics.attack,...execution.attack}:null;
  const rule={...mechanics.spell,...execution.spell,...attack};
  const tags=String(rule.properties??item?.system?.tags??'').split(/[,;]+/);
  if(!tags.some(p=>p.trim().toLowerCase()==='заклинание'))return null;
  if(attack&&attack.kind!=='magic')return null;
  // Explicit spell metadata on non-attacks avoids inheriting the main class's
  // energy for an unrelated or unconverted spell card.
  if(!attack&&!Object.hasOwn(rule,'spellEnergy'))return null;
  if(attack&&!Object.hasOwn(rule,'spellRange')){
    if(!energyId(rule.spellEnergy))return null;
    rule.spellRange='current';
  }
  if(attack&&directedSpellRange(item.parent,rule)===null)return null;
  return rule;
}
/** Read-only option data for the chat declaration. Conductance defines the
 * candidates; holding and proficiency are advisory readiness, not identity.
 * Stable order inside a group preserves the inventory order. No item is used
 * or equipped by this function. Resource/charge warnings belong to each
 * execution variant and will be added by the chat execution planner. */
export function spellWeaponOptions(actor,rule){
  const energy=spellEnergy(actor,rule);
  if(!energy)return [];
  return (actor?.items?.contents??[]).filter(item=>item.type==='weapon'&&
    item.system?.mechanics?.weapon?.isSpellcastingFocus===true&&
    Array.isArray(item.system.mechanics.weapon.conducts)&&item.system.mechanics.weapon.conducts.includes(energy)&&printedSpellRange(item)!==null)
    .map(weapon=>{
      const held=itemSlot(weapon.id,actor?.system)?.kind==='hand';
      const proficient=weaponProficiency(weapon,actor).proficient;
      const warnings=[...(!held?['notHeld']:[]),...(!proficient?['notProficient']:[])];
      return {weapon,held,proficient,warnings};
    }).sort((a,b)=>Number(b.held)-Number(a.held)||a.warnings.length-b.warnings.length);
}
/** Strictly eligible equipment for the existing pre-chat execution path.
 * Do not use this filtered list for the new advisory chat options. */
export function eligibleSpellWeapons(actor,rule){
  return spellWeaponOptions(actor,rule).filter(row=>row.held&&row.proficient).map(row=>row.weapon);
}
function printedSpellRange(item){
  const raw=item?.system?.distance??item?.system?.mechanics?.weapon?.printedDistance;
  if(raw==null||String(raw).trim()==='')return null;
  return range(Number(raw));
}
/** Highest non-stacking bonus, only when a compatible weapon is selected. */
export function focusRangeBonus(actor){
  return Math.max(0,...held(actor).filter(item=>item.type==='gear').map(item=>{
    const rule=item.system?.mechanics?.spell;
    if(rule?.stack!=='highest')return 0;
    if(rule.requiresProficiency&&!rule.proficiencyClasses?.includes(classDefinition(actor?.system)?.name??actor?.system?.className))return 0;
    return range(rule.rangeBonus)??0;
  }));
}
export function currentSpellRange(actor,weapon=null){
  const base=range(classDefinition(actor?.system)?.spellRange)??3;
  // A negative prepared value is a real modifier, not a missing default.
  // Clamp only the final distance, after the chosen weapon replaces the base.
  const prepared=Number.isFinite(actor?.system?.spellRange)?actor.system.spellRange:base;
  if(!weapon)return Math.max(0,prepared);
  // A chosen weapon replaces the base, not the prepared adjustment. Use the
  // raw Actor value (if present) to separate it from native changes once.
  const raw=range(actor?._source?.system?.spellRange)??base;
  return Math.max(0,(printedSpellRange(weapon)??raw)+(prepared-raw)+focusRangeBonus(actor));
}
export function directedSpellRange(actor,rule,weapon=null,{advisory=false}={}){
  const valid=weapon&&(advisory?spellWeaponOptions(actor,rule).some(row=>row.weapon===weapon):eligibleSpellWeapons(actor,rule).includes(weapon));
  if(rule?.spellRange==='current')return currentSpellRange(actor,valid?weapon:null);
  return range(rule?.spellRange);
}
/** Do not silently choose the longest weapon. A sole eligible weapon needs
 * no additional dialog; several require an explicit declaration. */
export async function chooseSpellWeapon(actor,rule){
  const options=eligibleSpellWeapons(actor,rule);
  if(options.length<=1)return {weapon:options[0]??null};
  const rows=options.map((weapon,i)=>({value:String(i),label:`${weapon.name} · ${directedSpellRange(actor,rule,weapon)} кл.`}));
  rows.push({value:'none',label:'Без Оружия заклинателя'});
  const pick=await chooseByButtons({title:'Оружие заклинателя',rows,confirmLabel:'Выбрать'});
  if(!pick)return null;
  // Recheck the item in case equipment changed during selection.
  const weapon=pick.value==='none'?null:options[Number(pick.value)];
  if(weapon&&!eligibleSpellWeapons(actor,rule).includes(weapon))return {weapon:null};
  return {weapon};
}
