/** Permanent racial contributions are explicit card data, not temporary effects.
 * Only the listed fields are interpreted. All other mechanics remain with their
 * existing handlers. Apply to prepared PC data once per Foundry preparation. */
import {racialPropertyRule,racialContentId} from './racial-properties.mjs';
import {equipmentDefensePreview} from '../equipment/item-properties.mjs';
export function permanentRacialStats(actor){
  const result={hpMax:0,speed:0,heldShieldAc:0,ac:{partial:0,success:0,great:0},defenses:{awareness:0,reflex:0,fortitude:0,will:0}};
  const seen=new Set();
  const add=(target,key,value)=>{if(Number.isFinite(value))target[key]+=value;};
  for(const item of actor?.items?.contents??[]){
    if(!racialPropertyRule(item))continue;
    const data=item.system.mechanics.characterContributions;
    if(!data||typeof data!=='object')continue;
    const id=racialContentId(item)||item.id;
    if(id&&seen.has(id))continue;
    if(id)seen.add(id);
    for(const key of ['hpMax','speed','heldShieldAc'])add(result,key,data[key]);
    for(const group of ['ac','defenses'])for(const key of Object.keys(result[group]))add(result[group],key,data[group]?.[key]);
  }
  return result;
}
export function preparePermanentRacialStats(system){
  const p=permanentRacialStats(system.parent);
  const add=(target,key,value)=>{if(Number.isFinite(target?.[key]))target[key]+=value;};
  add(system.hp,'max',p.hpMax);add(system,'speed',p.speed);
  for(const group of ['ac','defenses'])for(const [key,value] of Object.entries(p[group]))add(system[group],key,value);
  const held=equipmentDefensePreview(system.parent,{system,shieldBonus:p.heldShieldAc}).protection;
  for(const key of Object.keys(p.ac))add(system.ac,key,held);
}
