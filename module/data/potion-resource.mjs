import {actorClassDefinition} from './classes.mjs';
/** Recipient-side shared potion counter. Publication or transfer is not receipt. */
import {canReadChatContent} from './chat-visibility.mjs';
import {queueActorWrite} from './ability-accounting.mjs';
const ID='fast-nri-v14';
const flag=(doc,key)=>doc?.getFlag?.(ID,key)??doc?.flags?.[ID]?.[key];
export const potionText=key=>game.i18n.localize(`FASTNRI.Potions.${key}`);
export function potionResource(actor){
  const items=actor?.items?.contents??[];
  const stable=items.some(i=>i.type==='ability'&&flag(i,'contentId')==='fnri7.rulebook.racial.ustoichivyi');
  const base=actor?.type==='character'&&Number.isSafeInteger(actor.system?.potionsBaseMax)?actor.system.potionsBaseMax:3;
  const max=base+Number(stable)+(actorClassDefinition(actor)?.potionBonus??0);
  const used=Number.isSafeInteger(actor?.system?.potionsUsed)?actor.system.potionsUsed:0;
  return {used,max,over:used>max};
}
export function isPotionItem(item){
  const rule=item?.system?.mechanics?.potion;
  return !!rule&&typeof rule==='object'&&!Array.isArray(rule);
}
export const isPotionMessage=message=>canReadChatContent(message)&&flag(message,'itemUseResult')?.potion===true;
const canWrite=actor=>actor && (actor.isOwner===true||actor.canUserModify?.(game.user,'update')===true||game.user?.isGM===true);
/** One published potion use per recipient. Reapplying an HP result is allowed,
 * but must not accidentally charge its potion again. Manual correction is free. */
export async function recordPotionReceipt(actor,message){
  if(!canWrite(actor)||!isPotionMessage(message)||! /^[A-Za-z0-9_-]{1,64}$/.test(message.id??''))return null;
  return queueActorWrite(actor,async()=>{
    if(!canWrite(actor)||!isPotionMessage(game.messages?.get(message.id)))return null;
    if(flag(actor,'potionReceipts')?.[message.id]===true)return {duplicate:true};
    const {used,max}=potionResource(actor),after=used+1;
    await actor.update({'system.potionsUsed':after,[`flags.${ID}.potionReceipts.${message.id}`]:true},{fnriJournal:{kind:'potion'}});
    if(after>max)ui.notifications?.warn(potionText('over'));
    return {used:after,max,over:after>max};
  });
}
