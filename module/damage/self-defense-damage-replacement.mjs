/** Card-defined optional replacement of a surviving damage component. */
import {abilityAccountingStatus} from '../data/ability-accounting.mjs';
import {selectedRollParts} from '../rolls/roll-context.mjs';
import {copy,coverAllyDice} from './damage-core.mjs';
const l=k=>game.i18n.localize(`FASTNRI.Damage.${k}`);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ruleOf=item=>item?.type==='ability'&&item.system?.mechanics?.selfDefenseDamageReplacement?.value===1&&item.system.mechanics.selfDefenseDamageReplacement.noReroll===true;
export function replacementCandidates(card){
  const eligible=coverAllyDice(card).filter(p=>p.value>=1 && !card.parts.find(x=>x.id===p.id)?.noReroll);
  if(!eligible.length)return [];
  const max=Math.max(...eligible.map(p=>p.value));
  return eligible.filter(p=>p.value===max);
}
const normalized=v=>String(v??'').trim().toLocaleLowerCase('ru');
const signature=p=>JSON.stringify([normalized(p.damageType),[...new Set((p.traits??[]).map(normalized).filter(Boolean))].sort()]);
const describe=p=>[`${p.formula} · ${p.value}`,p.damageType,...p.traits].filter(Boolean).join(' · ');
async function chooseReplacement(item,candidates){
  if(candidates.every(p=>signature(p)===signature(candidates[0])))return candidates[0].id;
  const options=candidates.map(p=>`<option value="${esc(p.id)}">${esc(describe(p))}</option>`).join('');
  const form=await foundry.applications.api.DialogV2.input({window:{title:item.name},content:`<p>${esc(l('replaceSurvivingDie'))}</p><select name="part">${options}</select>`,ok:{label:l('select')},rejectClose:false});
  return form?.part;
}
export function selfDefenseReplacementEntries(actor,card){
  if(!replacementCandidates(card).length)return [];
  return [...(actor?.items?.contents??actor?.items??[])].filter(ruleOf).map(item=>({
    uuid:`self-defense-damage:${item.uuid}`,name:item.name,sourceType:'item',native:false,nativeChanges:[],actorOwned:false,onUse:'none',replacementItem:item,
    parts:[{id:'replace',kind:'activation',label:l('replaceSurvivingDie'),defaultEnabled:false,
      ...(abilityAccountingStatus(actor,item)?.remaining===0?{warning:game.i18n.localize('FASTNRI.AbilityChat.noDailyUses')}:{})}]}));
}
export function replaceSurvivingDamage(card,partId){
  if(!replacementCandidates(card).some(p=>p.id===partId))return null;
  const next=copy(card),part=next.parts.find(p=>p.id===partId),before=part.value;
  part.value=1;part.noReroll=true;
  return {next,before,partId};
}
export async function resolveSelfDefenseReplacements({actor,card,context,redact=false}){
  let next=card;const applied=[];
  for(const entry of context?.selected??[]){
    const item=entry.replacementItem;
    if(!ruleOf(item)||!selectedRollParts(entry).some(p=>p.id==='replace'))continue;
    const candidates=replacementCandidates(next);if(!candidates.length)continue;
    const partId=await chooseReplacement(item,candidates);
    const result=replaceSurvivingDamage(next,partId);if(!result)continue;
    if(abilityAccountingStatus(actor,item)?.remaining===0)globalThis.ui?.notifications?.warn(game.i18n.localize('FASTNRI.AbilityChat.noDailyUses'));
    next=result.next;next.history=[...(next.history??[]),{action:'set',rule:'selfDefenseDamageReplacement',selection:{kind:'set',value:1,noReroll:true},id:result.partId,before:{value:result.before},after:{value:1},name:redact?l('replaceSurvivingDie'):item.name}];
    applied.push(item);
  }
  return {next,applied};
}
