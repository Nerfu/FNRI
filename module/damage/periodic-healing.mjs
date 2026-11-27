/** Authored healing at the beginning of a native turn. No timers or damage checks. */
import {queueActorWrite} from '../data/ability-accounting.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {activeConditionEffect} from '../effects/active-effect.mjs';
import {chatAudience,gmChatAudience,canReadChatContent} from '../data/chat-visibility.mjs';
import {planDeathTransition,reconcileDeathEffects} from './death-lifecycle.mjs';
const S='fast-nri-v14';
const read=(doc,key)=>doc?.getFlag?.(S,key)??doc?.flags?.[S]?.[key];
const positive=n=>Number.isSafeInteger(n)&&n>0;
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function createPeriodicHealing(actor,item,source){
  const rule=item.system?.mechanics?.periodicHealing;
  if(!positive(rule?.value)||!positive(rule?.durationTicks)||!canReadChatContent(source))return null;
  if(!(game.user?.isGM||actor.isOwner||actor.canUserModify?.(game.user,'update')))return null;
  const id=stableDocumentId('phe',[actor.uuid,source.id]);
  return queueActorWrite(actor,async()=>{
    const prior=actor.effects?.get?.(id);if(prior)return prior;
    const [effect]=await actor.createEmbeddedDocuments('ActiveEffect',[{_id:id,name:item.name,img:item.img,type:'base',showIcon:2,disabled:false,transfer:false,origin:item.uuid,duration:{},system:{changes:[]},flags:{[S]:{periodicHealing:{version:1,value:rule.value,durationTicks:rule.durationTicks,sourceMessageId:source.id}}}}],{keepId:true});
    return effect;
  });
}
async function flush(actor,combatant){
  for(const [id,r] of Object.entries(read(actor,'periodicHealingPending')??{})){
    const source=game.messages?.get?.(r.sourceMessageId);
    const hidden=combatant.hidden||combatant.token?.hidden||combatant.token?.document?.hidden;
    const current=chatAudience(source);
    const original=r.audience??{whisper:[],blind:false};
    const narrower=original.whisper.length?{whisper:current.whisper.length?original.whisper.filter(id=>current.whisper.includes(id)):original.whisper,blind:original.blind||current.blind}:current;
    const audience=hidden||!canReadChatContent(source)||original.whisper.length&&!narrower.whisper.length?gmChatAudience(source):narrower;
    if(!game.messages?.get?.(id)){
      const content=`<div class="fnri-hp-report"><strong>${esc(actor.name)} · Периодическое исцеление</strong><div>HP ${r.before} → ${r.after} (+${r.after-r.before})</div><small>${r.count}/${r.durationTicks}</small></div>`;
      try{await ChatMessage.create({_id:id,speaker:ChatMessage.getSpeaker({actor}),...audience,content,flags:{[S]:{periodicHealingReport:true}}},{keepId:true});}
      catch(error){if(!game.messages?.get?.(id))throw error;}
    }
    if(r.count>=r.durationTicks&&actor.effects?.get?.(r.effectId))await actor.deleteEmbeddedDocuments('ActiveEffect',[r.effectId]);
    await actor.update({[`flags.${S}.periodicHealingPending.-=${id}`]:null,...(r.count>=r.durationTicks?{[`flags.${S}.periodicHealingProgress.-=${r.effectId}`]:null}:{})},{fnriJournal:{skip:true}});
  }
}
export async function settlePeriodicHealingStartTurn(combat,combatant,context){
  const actor=combatant?.token?.actor??combatant?.actor,round=context?.round;
  if(!game.user?.isGM||game.system?.id!==S||!combat?.started||context?.skipped||!combat.id||!combatant?.id||!positive(round)||actor?.documentName!=='Actor')return null;
  return queueActorWrite(actor,async()=>{
    await flush(actor,combatant);
    for(const effect of [...(actor.effects?.contents??[])]){
      const rule=read(effect,'periodicHealing');
      if(!activeConditionEffect(effect)||rule?.version!==1||!positive(rule.value)||!positive(rule.durationTicks))continue;
      const previous=read(actor,'periodicHealingProgress')?.[effect.id]??{};
      const key=`${combat.id}:${combatant.id}`;
      if(previous.key===key&&previous.round>=round||previous.count>=rule.durationTicks)continue;
      const before=actor.system?.hp?.current,max=actor.system?.hp?.max;
      if(!Number.isSafeInteger(before)||!Number.isSafeInteger(max)||before<0||max<0)continue;
      const after=Math.min(max,before+rule.value),count=(previous.count??0)+1;
      const id=stableDocumentId('phm',[actor.uuid,effect.id,key,round]);
      const death=await planDeathTransition(actor,{before,after,kind:'heal'});
      if(actor.system.hp.current!==before||!activeConditionEffect(actor.effects?.get?.(effect.id)))continue;
      await actor.update({'system.hp.current':after,[`flags.${S}.periodicHealingProgress.${effect.id}`]:{key,round,count},[`flags.${S}.periodicHealingPending.${id}`]:{effectId:effect.id,sourceMessageId:rule.sourceMessageId,audience:chatAudience(game.messages?.get?.(rule.sourceMessageId)),before,after,count,durationTicks:rule.durationTicks},...death.patch},{fnriJournal:{kind:'heal',reason:'Периодическое исцеление'},fnriDeathLifecycle:'managed'});
      if(death.needsEffects)await reconcileDeathEffects(actor);
      await flush(actor,combatant);
    }
  });
}
