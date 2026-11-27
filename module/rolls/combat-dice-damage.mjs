import {activeConditionEffect} from '../effects/active-effect.mjs';
import {isOffGuard} from '../effects/condition-calculations.mjs';
import {minimumCellGap,sameScene,standingConscious} from '../spatial/geometry.mjs';
import {formationForTarget} from '../spatial/formation.mjs';
import {tokenSide} from '../data/actor-side.mjs';
import {selectedRollParts,applyDirectRollModifiers} from './roll-context.mjs';
const S='fast-nri-v14';
const abilities=actor=>(actor?.items?.contents??[]).filter(i=>i.type==='ability');
export const passiveRule=(actor,key)=>abilities(actor).find(i=>i.system?.mechanics?.passive===true&&i.system.mechanics[key]===true);
const hidden=t=>(t?.document??t)?.hidden===true||t?.visible===false;
export function relativeOffGuard(actor,target,{tokens=globalThis.canvas?.tokens?.placeables??[],grid=globalThis.canvas?.grid}={}){
  if(!actor||!target?.actor||hidden(target))return false;
  const effects=target.actor.allApplicableEffects?.()??target.actor.effects?.contents??[];
  const sources=new Set(abilities(actor).flatMap(i=>(i.effects?.contents??[]).map(e=>e.uuid)).filter(Boolean));
  if([...effects].some(e=>activeConditionEffect(e)&&e.flags?.[S]?.relativeOffGuard===true&&sources.has(e.origin)))return true;
  if(!passiveRule(actor,'isolatedOffGuard')||grid?.isSquare!==true||![1,-1].includes(tokenSide(target)))return false;
  if(!target.document?.parent?.id)return false;
  for(const other of tokens){
    if(other===target||other.document?.uuid===target.document.uuid||!sameScene(other,target)||hidden(other))continue;
    const gap=minimumCellGap(other,target,grid);
    if(gap===null||gap===0)return false;
    if(gap!==1)continue;
    const side=tokenSide(other),hp=other.actor?.system?.hp?.current;
    if(![1,-1].includes(side)||!Number.isFinite(hp))return false;
    if(side===tokenSide(target)&&standingConscious(other))return false;
  }
  return true;
}
export function targetOffGuard(actor,target,options={}){
  return !!target&&!hidden(target)&&(isOffGuard(target.actor)||relativeOffGuard(actor,target,options)||
    formationForTarget(target,options.tokens??globalThis.canvas?.tokens?.placeables??[],{grid:options.grid??globalThis.canvas?.grid})?.surrounded===true);
}
const basePattern=/^1d20(?:\s*\+\s*1d(4|6|8|10|12))?$/i;
export function appendCombatDice(formula,combatDie,count){
  const match=basePattern.exec(String(formula).trim());
  const faces=/^(?:1)?d(4|6|8|10|12)$/i.exec(String(combatDie??''))?.[1];
  if(!match||!faces||!Number.isInteger(count)||count<1)return formula;
  return formula+` + ${count}d${faces}`;
}
/** Only the explicitly identified combat-die prefix, not equal-faced skill/manual dice. */
export function combatDamageReferences(roll,base,context){
  const replacementOnly=(context.selected??[]).map(e=>({...e,parts:selectedRollParts(e).filter(p=>p.kind==='replacement'),enabledPartIds:undefined}));
  let expression;
  try{expression=applyDirectRollModifiers(base,replacementOnly);}catch{return [];}
  if(!/^1d20(?:\s*\+\s*[1-9]\d*d(?:4|6|8|10|12))+$/i.test(expression))return [];
  const expected=[...expression.matchAll(/([1-9]\d*)d(\d+)/gi)].flatMap(m=>Array(Number(m[1])).fill(Number(m[2])));
  const actual=(roll.dice??[]).flatMap(d=>(d.results??[]).filter(r=>r.active!==false).map(r=>({faces:d.faces,value:r.result})));
  if(expected.some((n,i)=>actual[i]?.faces!==n||!Number.isInteger(actual[i]?.value)||actual[i].value<1||actual[i].value>n))return [];
  return expected.slice(1).map((faces,i)=>({id:`die-${i+2}`,faces,value:actual[i+1].value}));
}
export function combatDamageEntries(data,degree,edit){
  if(!['success','great'].includes(degree))return [];
  const parts=(data.combatDamageReferences??[]).flatMap((ref,i)=>{
    const current=edit?.components?.find(p=>p.id===ref.id);
    if(current?.excluded)return [];
    const value=current?.value??ref.value;
    return Number.isSafeInteger(value)&&value>0?[{id:`combat-${i}`,kind:'modifier',label:`Куб боя ${i+1}`,value:String(value)}]:[];
  });
  return parts.length?[{uuid:'combat-dice-damage',sourceType:'item',name:'Удар исподтишка',native:false,nativeChanges:[],actorOwned:false,onUse:'none',parts}]:[];
}
