/**
 * Stage 3C.3 — end-of-turn settlement using Foundry's designated-GM Combat
 * lifecycle. No world timer, socket relay, private roles or new UI.
 *
 * The Actor update stores HP and the applied-turn receipt together. Pending
 * chat/effect cleanup is replayable by its stable key; it never repeats HP.
 * External manual updates during an await are not a cross-document transaction:
 * those limitations are recorded in the project handoff.
 */
import {zeroHpPreventionItem,markZeroHpPrevention} from './zero-hp-prevention.mjs';
import {queueActorWrite} from '../data/ability-accounting.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {canReadChatContent,gmChatAudience} from '../data/chat-visibility.mjs';
import {planDeathTransition,advanceDeathEndTurn,reconcileDeathEffects} from './death-lifecycle.mjs';
import {PERIODIC_SCOPE as SCOPE,readPeriodicData,orderedPeriodicEffects,
  isActivePeriodicEffect,declaredPeriodicDefenses,calculatePeriodicTick,
  planPeriodicHp,periodicEndPlan} from './periodic-damage.mjs';

const object=x=>x && typeof x==='object' && !Array.isArray(x)?x:{};
// Private chat details live only on the settling GM client until published.
const privateReceipts=new Map();
const escape=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const text=key=>escape(game.i18n.localize(`FASTNRI.PeriodicDamage.${key}`));
const signedAmount=value=>value<0 ? ` − ${-value}` : value>0 ? ` + ${value}` : '';
const validCount=x=>Number.isSafeInteger(x)&&x>=0;
const actorCanWrite=actor=>!!actor && actor.documentName==='Actor' &&
  (game.user?.isGM===true || actor.canUserModify?.(game.user,'update')===true);
const readFlag=(actor,name)=>object(actor?.getFlag?.(SCOPE,name) ?? actor?.flags?.[SCOPE]?.[name]);
function turnIdentity(combat,combatant,context) {
  const round=context?.round;
  if (!combat?.id || !combatant?.id || !Number.isSafeInteger(round)||round<1) return null;
  return {combatId:combat.id,combatantId:combatant.id,round,
    key:`${combat.id}:${combatant.id}:${round}`,tokenUuid:combatant.token?.uuid??null};
}
function settledInTurn(previous, identity) {
  return previous?.combatId===identity.combatId &&
    previous?.combatantId===identity.combatantId &&
    validCount(previous.lastRound) && previous.lastRound>=identity.round;
}
function pendingId(actor,effect,identity) {
  return stableDocumentId('pdx',[actor.uuid,effect.id,identity.key]);
}
function stableMessageId(receiptId) {
  return stableDocumentId('pdm',receiptId);
}

function gmAudience() {
  const whisper=(game.users?.contents??[]).filter(user=>user.isGM).map(user=>user.id);
  if (!whisper.length && game.user?.isGM) whisper.push(game.user.id);
  return {whisper,blind:true};
}
const visibilityOf=message=>({
  whisper:Array.isArray(message?.whisper)?[...message.whisper]:[],
  blind:message?.blind===true
});
function sourceAudience(sourceMessageId) {
  if (!sourceMessageId) return null;
  const source=game.messages?.get(sourceMessageId);
  if (source && canReadChatContent(source))
    return visibilityOf(source);
  return gmAudience();
}
function reportAudience(details,privateResult) {
  if (!details) return gmAudience();
  const current=sourceAudience(details.sourceMessageId);
  if (!privateResult) return current??visibilityOf();
  const original=details.visibility;
  // A retry never broadens a previously private audience when the source changes.
  if (!current || !current.whisper.length && !current.blind) return original;
  const whisper=original.whisper.filter(id=>current.whisper.includes(id));
  return whisper.length ? {whisper,blind:original.blind||current.blind} :
    (details.privateToGm ? gmChatAudience(original) : gmAudience());
}
function receiptContent(receipt) {
  const c=receipt.calculation;
  const damage=[`<strong>${escape(c.total)} ${text('damage')}</strong>`];
  if (c.resistance || c.vulnerability) {
    const resistance=c.resistance ? ` − ${escape(c.resistance)} ${text('resistance')}` : '';
    const vulnerability=c.vulnerability ? ` + ${escape(c.vulnerability)} ${text('vulnerability')}` : '';
    damage.push(`${escape(c.value)}${resistance}${vulnerability}`);
  }
  if (c.total>0) damage.push(`HP ${escape(receipt.hpBefore)} → ${escape(receipt.hpAfter)}`);
  const lines=[
    `<strong>${escape(receipt.effectName)} · ${escape(receipt.actorName)}</strong>`,
    damage.join(' · ')
  ];
  switch (receipt.ending) {
    case 'check-success':
    case 'check-failure': {
      const check=receipt.check;
      const result=check?.modifier ?
        `${escape(check.die)}${escape(signedAmount(check.modifier))} = <strong>${escape(check.total)}</strong>` :
        check ? `<strong>${escape(check.total)}</strong>` : '';
      const status=text(receipt.finish?'removed':'remains');
      lines.push([text('removalCheck'),result,`<strong>${status}</strong>`].filter(Boolean).join(' · '));
      break;
    }
    case 'immunity':
    case 'zero':
    case 'duration':
      lines.push(`${text(receipt.ending)} · <strong>${text('removed')}</strong>`);
      break;
    case 'manual':
      lines.push(`${text('skipCheck')} · <strong>${text('remains')}</strong>`);
      break;
  }
  if(receipt.zeroHpPrevented)lines.push('Неукротимость: 1 HP');
  if (receipt.deathInitial != null)
    lines.push(`${text('deathCounter')} · 1d4+3 = ${escape(receipt.deathInitial)} · ${text('deathTick')}`);
  return `<div class="fnri-hp-report">${lines.map(line=>`<div>${line}</div>`).join('')}</div>`;
}
/** Retry finished-effect cleanup and chat independently of the HP update.
 * Remove the finished effect first so chat delivery cannot keep it active. */
export async function retryPeriodicOutbox(actor) {
  if (!actorCanWrite(actor)) return {pending:0,errors:['no-permission']};
  const snapshot=readFlag(actor,'periodicPending');
  const errors=[];
  for (const [id,receipt] of Object.entries(snapshot)) {
    if (!receipt?.messageId || !receipt?.effectId) continue;
    if (receipt.privateResult && !game.user?.isGM) continue;
    try {
      if (receipt.finish===true) {
        const effect=actor.effects?.get(receipt.effectId);
        if (effect?.getFlag?.(SCOPE,'periodicDamage')?.version===1) {
          await actor.deleteEmbeddedDocuments('ActiveEffect',[effect.id]);
        }
      }
      const recorded=game.messages?.get(receipt.messageId);
      if (recorded && recorded.getFlag(SCOPE,'periodicReceipt')?.id!==id)
        throw Error('Periodic ChatMessage ID collision');
      if (!recorded) {
        const details=receipt.privateResult ? privateReceipts.get(id) : receipt;
        const roll=details?.checkRoll ? Roll.fromData(details.checkRoll) : null;
        const content=details ? receiptContent(details) : `<p>${text('privateRecovery')}</p>`;
        const rollData=roll ? await roll.toMessage({content},{create:false}) : {};
        const output={...rollData,_id:receipt.messageId,
          speaker:ChatMessage.getSpeaker({actor}),
          content,
          flags:{[SCOPE]:{periodicReceipt:{version:1,id,turn:receipt.turnKey,
            targetActorUuid:actor.uuid,
            ...(details?.tokenUuid?{tokenUuid:details.tokenUuid}:{}),
            ...(Number.isFinite(details?.hpBefore)&&Number.isFinite(details?.hpAfter)?{hpDelta:details.hpAfter-details.hpBefore}:{}),
            ...(Number.isFinite(details?.calculation?.total)?{damage:details.calculation.total}:{})}}},
          ...reportAudience(details,receipt.privateResult===true)};
        try {await ChatMessage.create(output,{keepId:true});}
        catch(error) {
          // A concurrent/ambiguous server acknowledgement may still have
          // persisted our document. Confirm by stable ID, never post a second.
          const existing=game.messages?.get(receipt.messageId);
          if (!existing || existing.getFlag(SCOPE,'periodicReceipt')?.id!==id) throw error;
        }
      }
      // Only the outbox is removed; the applied turn's persistent progress
      // survives and remains an exact-once guard even after effect deletion.
      await actor.update({[`flags.${SCOPE}.periodicPending.-=${id}`]:null},
        {fnriJournal:{skip:true}});
      privateReceipts.delete(id);
    } catch(error) {
      errors.push({id,message:String(error?.message??error)});
      console.error('Fast NRI | periodic outbox requires retry',id,error);
    }
  }
  return {pending:Object.keys(readFlag(actor,'periodicPending')).length,errors};
}

async function settleOne(actor,effectId,identity) {
  return queueActorWrite(actor,async()=>{
    if (!actorCanWrite(actor)) return {status:'no-permission'};
    const effect=actor.effects?.get(effectId);
    if (!isActivePeriodicEffect(effect)) return {status:'inactive'};
    const data=readPeriodicData(effect);
    if (!data.eligible) return {status:'manual-data'};
    const progress=readFlag(actor,'periodicProgress');
    const previous=object(progress[effectId]);
    if (previous.done===true || settledInTurn(previous,identity))
      return {status:'already-processed'};
    const calculation=calculatePeriodicTick(data,declaredPeriodicDefenses(actor));
    if (!calculation.resolved) return {status:'manual-defenses'};
    const hpBefore=actor.system?.hp?.current;
    if (!validCount(hpBefore)) return {status:'manual-hp'};
    const hp=planPeriodicHp(actor.system.hp,calculation.total);
    const markerItem=hp.reachedZero&&actor.system.hp.max>=1?zeroHpPreventionItem(actor):null;
    if(markerItem)hp.after.current=1;
    const count=validCount(previous.count)?previous.count+1:1;
    const endPlan=periodicEndPlan(data,count);
    let checkRoll=null;
    let check=null;
    let ending=calculation.total===0 ? calculation.immune?'immunity':'zero':
      endPlan.durationEnded?'duration':endPlan.needsCheck?'check-pending':'manual';
    if (calculation.total>0 && endPlan.needsCheck) {
      const modifier=endPlan.modifier;
      const formula=modifier<0 ? `1d20 - ${-modifier}` : modifier>0 ? `1d20 + ${modifier}` : '1d20';
      checkRoll=await new Roll(formula).evaluate({allowInteractive:false});
      const total=Number(checkRoll.total);
      check={die:total-modifier,modifier,total};
      ending=total>=endPlan.dc ? 'check-success':'check-failure';
    }
    const finish=['immunity','zero','duration','check-success'].includes(ending);
    // Shared 0-HP contract: first periodic hit to 0 also removes one point.
    // Subsequent positive ticks at 0 remove one, independent of HP delta.
    const death=await planDeathTransition(actor,{
      before:hp.before.current,after:hp.after.current,kind:'damage',
      hitPointsDamage:calculation.total,periodic:true
    });
    const id=pendingId(actor,effect,identity);
    const sourceVisibility=sourceAudience(data.sourceMessageId);
    const visibility=data.privateToGm ? gmChatAudience(sourceVisibility) :
      sourceVisibility??visibilityOf(ChatMessage.applyMode({}));
    const privateResult=visibility.blind || visibility.whisper.length>0;
    const receipt={version:1,id,messageId:stableMessageId(id),turnKey:identity.key,effectId,finish};
    const details={...receipt,sourceMessageId:data.sourceMessageId??null,
      ...(data.privateToGm?{privateToGm:true}:{}),
      actorName:actor.name,effectName:effect.name,tokenUuid:identity.tokenUuid??null,
      hpBefore:hp.before.current,hpAfter:hp.after.current,
      calculation,ending,check,...(markerItem?{zeroHpPrevented:true}:{}),checkRoll:checkRoll?.toJSON?.()??null,
      deathInitial:death.roll ? Number(death.roll.total) : null};
    const changed={
      [`flags.${SCOPE}.periodicProgress.${effectId}`]:{
        combatId:identity.combatId,combatantId:identity.combatantId,
        lastRound:identity.round,count,done:finish},
      [`flags.${SCOPE}.periodicPending.${id}`]:privateResult?{...receipt,privateResult:true}:details,
      ...death.patch
    };
    if (hp.after.current!==hp.before.current) changed['system.hp.current']=hp.after.current;
    // Native document writes are not CAS transactions across clients. Abort
    // a known stale plan rather than knowingly overwrite a manual HP edit.
    if (actor.system.hp.current!==hp.before.current ||
        !isActivePeriodicEffect(actor.effects?.get(effectId)))
      return {status:'stale-actor-needs-manual-review'};
    if (privateResult) privateReceipts.set(id,{...details,visibility});
    const marker=markerItem?await markZeroHpPrevention(actor,markerItem):null;
    try {
      await actor.update(changed,{
        fnriJournal:{kind:'periodic-damage',reason:'Периодический урон'},
        fnriDeathLifecycle:'managed'
      });
    } catch(error) {
      if (!readFlag(actor,'periodicPending')[id]) {privateReceipts.delete(id);if(marker)await actor.deleteEmbeddedDocuments('ActiveEffect',[marker.id]);}
      throw error;
    }
    if (death.needsEffects) {
      try {await reconcileDeathEffects(actor);}
      catch(error) {console.warn('Fast NRI | periodic 0-HP effects need retry',error);}
    }
    return {status:'applied',amount:calculation.total,finish,ending,
      deathRoll:death.roll?.toJSON?.()??null};
  });
}

/** Called exclusively from the native designated-GM end-turn lifecycle. */
export async function settlePeriodicEndTurn(combat,combatant,context) {
  if (!game.user?.isGM || game.system?.id!==SCOPE || !combat?.started ||
      context?.skipped===true) return null;
  const identity=turnIdentity(combat,combatant,context);
  // Prefer the TokenDocument synthetic Actor for an unlinked combatant.
  const actor=combatant?.token?.actor ?? combatant?.actor;
  if (!identity || actor?.documentName!=='Actor') return null;
  // Effects added while this end of turn is being processed wait until the next one.
  const effects=orderedPeriodicEffects(actor).map(effect=>effect.id);
  await retryPeriodicOutbox(actor);
  if (actor.getFlag?.(SCOPE,'deathEffectsPending')) {
    try {await reconcileDeathEffects(actor);}
    catch(error) {console.warn('Fast NRI | outstanding 0-HP effect sync needs retry',error);}
  }
  const result=[];
  for (const id of effects) {
    try {
      const row=await settleOne(actor,id,identity);
      result.push({id,...row});
      // Chat and effect removal may fail independently, but the Actor's HP and
      // progress are already durable. A retry cannot charge them twice.
      await retryPeriodicOutbox(actor);
    } catch(error) {
      console.error('Fast NRI | periodic turn settlement failed',identity.key,id,error);
      result.push({id,status:'error',message:String(error?.message??error)});
    }
  }
  try {await queueActorWrite(actor,()=>advanceDeathEndTurn(actor,identity));}
  catch(error) {console.error('Fast NRI | death turn bookkeeping failed',identity.key,error);}
  return {identity,results:result};
}
