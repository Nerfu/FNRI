/** A manual execution is a chat declaration, never an automatic consequence. */
import {finishCardAccounting} from '../data/ability-accounting.mjs';
import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {redactActorSourceForAudience,finalizeRollEffects} from './roll-context.mjs';
const ID='fast-nri-v14';
export const escapeActionText=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export const actionText=k=>game.i18n.localize(`FASTNRI.SheetActions.${k}`);
export const canExecuteAction=actor=>!!actor&&(game.user?.isGM===true||actor.isOwner===true||actor.canUserModify?.(game.user,'update')===true);
export function actionAudience(source=null){
  if(source) return chatAudience(source);
  const mode=game.settings.get('core','messageMode');
  const normalized=({publicroll:'public',gmroll:'gm',blindroll:'blind',selfroll:'self'})[mode]??mode;
  return chatAudience(ChatMessage.applyMode({},['public','gm','blind','self'].includes(normalized)?normalized:'public'));
}
export function actionSpeaker(actor,audience){
  return actor.token?.hidden===true && redactActorSourceForAudience(actor,audience) ? {alias:'Fast NRI'} : ChatMessage.getSpeaker({actor});
}
export async function declareAction({actor,item=null,label,description='',isIntervention=false,execution=null,source=null,actionId=null,account=true,roll=null,context=null}={}){
  if(!canExecuteAction(actor)||source&&!canReadChatContent(source))return null;
  const audience=actionAudience(source),redact=redactActorSourceForAudience(actor,audience);
  const details=description&&globalThis.foundry?.applications?.ux?.TextEditor?.enrichHTML
    ? await foundry.applications.ux.TextEditor.enrichHTML(String(description),{secrets:false,relativeTo:item??actor})
    : escapeActionText(description);
  const rollSummary=Number.isFinite(roll?.total)?`<p>${escapeActionText(roll.formula??context?.expression??'')} = <strong>${roll.total}</strong></p>`:'';
  const content=`<article class="fnri-action-declaration"><strong>${escapeActionText(label)}</strong>${details?`<div>${details}</div>`:''}${rollSummary}<p>${escapeActionText(actionText('manualConsequences'))}</p></article>`;
  const data={speaker:actionSpeaker(actor,audience),...audience,content,
    flags:{[ID]:{manualAction:{version:1,label:String(label),isIntervention,...(!redact?{actorUuid:actor.uuid,itemUuid:item?.uuid??null}:{})}}}};
  if(roll)data.rolls=[roll.toJSON()];
  const message=await ChatMessage.create(data);
  if(message?.id){await finalizeRollEffects(context,message);if(account)await finishCardAccounting({actor,item,message,isIntervention,execution,actionId});}
  return message;
}
