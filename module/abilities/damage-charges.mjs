/** Authored independent damage charges in one result. No target assignment or
 * preroll: the existing controlled-token HP action selects each recipient. */
import {snapshotDamageParts,calculateDamage} from '../damage/damage-core.mjs';
import {previewDeclaredDamageDefenses} from '../damage/periodic-damage.mjs';
import {applyHp,chooseHpRecipient} from '../damage/hp-actions.mjs';
import {abilityCostPreview,finishCardAccounting} from '../data/ability-accounting.mjs';
import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {createPrivateAreaSourceMessage,privateAreaSourceFor} from '../data/private-area-source.mjs';
import {redactActorSourceForAudience} from '../rolls/roll-context.mjs';
import {escapeActionText as esc} from '../rolls/action-declaration.mjs';
const ID='fast-nri-v14';
const tr=k=>game.i18n.localize(`FASTNRI.AbilityChat.${k}`);
export function damageChargeDefinitions(execution){
  const {count,faces,bonus}=execution??{};
  if(!Number.isSafeInteger(count)||count<1||count>10||!Number.isSafeInteger(faces)||faces<2||faces>1000||!Number.isSafeInteger(bonus)||bonus<0||bonus>1000)throw Error('Invalid damage charges');
  return [{id:'die',kind:'die',faces,formula:`1d${faces}`},...(bonus?[{id:'bonus',kind:'fixed',value:bonus,formula:String(bonus)}]:[])];
}
export function damageChargeTotal(charge,actor){
  const card={...charge,noCritical:true};
  const defenses=previewDeclaredDamageDefenses(actor,card);
  const immune=new Set(defenses.immunePartIds);
  return calculateDamage({...card,parts:card.parts.map(p=>({...p,immune:immune.has(p.id)})),adjustments:{resistance:defenses.resistance,vulnerability:defenses.vulnerability}},{critical:false}).total;
}
export async function publishDamageCharges({actor,item,execution,source}){
  const defs=damageChargeDefinitions(execution);
  const formula=defs.map(d=>d.formula).join(' + '),rolls=[],charges=[];
  for(let i=0;i<execution.count;i++){
    const roll=await new Roll(formula,actor.getRollData?.()??{}).evaluate();
    rolls.push(roll.toJSON());
    charges.push({parts:snapshotDamageParts(roll,defs,{damageType:execution.damageType,properties:item.system.tags}),damageRules:{ignoreResistance:execution.ignoreResistance===true}});
  }
  const redact=redactActorSourceForAudience(actor,source);
  const data={...chatAudience(source),speaker:redact?{alias:'Fast NRI'}:ChatMessage.getSpeaker({actor}),rolls,
    content:`<strong>${esc(item.name)}</strong> · ${esc(formula)}`,
    flags:{[ID]:{abilityResult:{version:1,kind:'damageCharges',charges,executionId:execution.id,...(!redact?{actorUuid:actor.uuid,sourceItemUuid:item.uuid}:{})},...(redact?{spellCastRedacted:true}:{})}}};
  if(redact)return createPrivateAreaSourceMessage(data,actor,{actorUuid:actor.uuid,accountingItemUuid:item.uuid,executionId:execution.id});
  return ChatMessage.create(data);
}
export async function applyDamageCharge(message,index){
  const recipient=await chooseHpRecipient();if(!recipient)return null;
  const current=game.messages?.get(message?.id);if(!canReadChatContent(current))return null;
  const result=current.getFlag(ID,'abilityResult');
  const charge=result?.kind==='damageCharges'&&result.version===1&&Number.isInteger(index)?result.charges[index]:null;
  if(!charge)return null;
  const hidden=privateAreaSourceFor(current);
  const payer=hidden?.actor??(result.actorUuid?await fromUuid(result.actorUuid):null);
  const itemUuid=hidden?.accountingItemUuid??result.sourceItemUuid;
  const item=itemUuid?await fromUuid(itemUuid):null;
  const execution=item?.parent?.uuid===payer?.uuid&&item?.system?.mechanics?.executions?.find(e=>e.id===result.executionId&&e.type==='damageCharges');
  const canAccount=!!execution&&(payer.isOwner===true||payer.canUserModify?.(game.user,'update')===true||game.user?.isGM===true);
  if(!canAccount)ui.notifications?.warn(tr('chargeManualAccounting'));
  else if(abilityCostPreview(payer,item,execution).length)ui.notifications?.warn(tr('insufficient'));
  const report=await applyHp({kind:'damage',amount:damageChargeTotal(charge,recipient.actor),sourceMessage:current,...recipient,independent:true});
  if(report&&canAccount)await finishCardAccounting({actor:payer,item,execution,message:report});
  return report;
}
