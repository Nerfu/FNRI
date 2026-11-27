import {tokenSide} from '../data/actor-side.mjs';
import {classDefinition} from '../data/classes.mjs';
const contributions=actor=>(actor?.items?.contents??[]).filter(i=>i.type==='ability'&&i.system?.mechanics?.passive===true).map(i=>i.system.mechanics.initiativeContribution).filter(Boolean);
const max=(rows,key)=>Math.max(0,...rows.map(r=>Number.isSafeInteger(r[key])?r[key]:0));
export function initiativeContribution(combatant){
  const actor=combatant?.actor;
  if(!actor)return 0;
  const own=max(contributions(actor),'self');
  if(classDefinition(actor.system)?.name==='Егерь')return own;
  const side=tokenSide(combatant.token);
  if(![1,-1].includes(side))return own;
  const allies=[];
  for(const other of combatant.parent?.combatants??[]){
    if(other===combatant||other.actor?.uuid===actor.uuid||other.hidden||other.token?.hidden||tokenSide(other.token)!==side)continue;
    allies.push(...contributions(other.actor));
  }
  return own+max(allies,'allies');
}
export class FastNRICombatant extends foundry.documents.Combatant {
  _getInitiativeFormula(){
    const base=super._getInitiativeFormula(), bonus=initiativeContribution(this);
    return bonus?`(${base}) + ${bonus}`:base;
  }
}
