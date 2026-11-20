/** Card-owned defense changes, applied in event order to only one property.
 * An unknown kind never silently becomes Fortitude. No effect is inferred by
 * class/name. Attack context and passive/activated abilities are independent.
 */
import {normalizeAttackKind,DEFENSE_ABILITIES} from '../rolls/attack-properties.mjs';
const valid=x=>DEFENSE_ABILITIES.includes(x);
export function defenseOptions(raw) {
  const list=Array.isArray(raw)?raw:String(raw??'').split(/[,;\s]+/);
  return [...new Set(list.map(s=>String(s).trim().toLowerCase()).filter(valid))];
}
export function matchesDefenseChange(rule,kind) {
  const against=String(rule?.againstKind??'any').trim().toLowerCase();
  return (!against || against==='any' || against===normalizeAttackKind(kind));
}
function addRule(state,rule,source,kind) {
  if(!rule || !matchesDefenseChange(rule,kind))return state;
  const mode=String(rule.mode??'').toLowerCase();
  let options=[];
  if(mode==='set')options=defenseOptions([rule.stat]);
  else if(mode==='choose')options=defenseOptions(rule.options);
  if(mode==='choose' && !options.length)options=[...DEFENSE_ABILITIES];
  if(!options.length)return state;
  return {options,stat:options.length===1?options[0]:null,
    requiresChoice:options.length>1,source,trace:[...state.trace,{source,mode,options}]};
}
/** Incoming attack changes first, defender's passive cards second, chosen
 * intervention card last. A later applicable rule replaces only this property.
 * Read-only source order is Foundry's explicit Item.sort (+ ID tie break).
 */
export function resolveDefenseContext({attack={},defender=null,selectedItem=null}={}) {
  const kind=normalizeAttackKind(attack.attackKind);
  const initial=kind==='melee'?'fortitude':kind==='ranged'?'reflex':null;
  let state={options:initial?[initial]:[],stat:initial,requiresChoice:!initial,
    source:initial?'default':'unknown',trace:initial?[{source:'default',mode:'set',options:[initial]}]:[]};
  state=addRule(state,attack.selfDefenseRule,'attack',kind);
  const passives=[...(defender?.items?.contents??defender?.items??[])].filter(item=>item?.type==='ability' && item.system?.mechanics?.selfDefense?.activation==='passive')
    .sort((a,b)=>(Number(a.sort??0)-Number(b.sort??0))||String(a.id??'').localeCompare(String(b.id??'')));
  for(const item of passives)state=addRule(state,item.system.mechanics.selfDefense,item.uuid??item.id,kind);
  if(selectedItem) {
    const rule=selectedItem.system?.mechanics?.selfDefense;
    if(rule?.activation==='intervention')state=addRule(state,rule,selectedItem.uuid??selectedItem.id,kind);
  }
  if(!state.options.length)state={...state,options:[...DEFENSE_ABILITIES],requiresChoice:true};
  return state;
}
