import {queueActorWrite,abilityAccountingStatus,finishCardAccounting} from '../data/ability-accounting.mjs';
import {zeroHpPreventionItem,markZeroHpPrevention} from './zero-hp-prevention.mjs';
import {hasTempHpResultExpired} from '../abilities/temporary-hp-cast.mjs';
import {ensureDamageRecovery} from '../abilities/damage-recovery.mjs';
import {canReadChatContent,chatAudience,gmChatAudience} from '../data/chat-visibility.mjs';
import {undoAttackOutcomeEffects} from '../equipment/attack-outcome-application.mjs';
import {
  coverActorKey, coverRecords, coverReportId, coverScope, directedCoverSnapshot, hasCoverApplication, isCurrentDirectedCoverSource
} from './cover-ally-state.mjs';
/** Explicit HP changes with per-application report and undo (no automatic HP). */
import {calculateDamage, planHpChange, reverseHpChange} from './damage-core.mjs';
import {previewDeclaredDamageDefenses} from './periodic-damage.mjs';
import {planDeathTransition,reconcileDeathEffects,deathStateOf,deathStateUpdate} from './death-lifecycle.mjs';
import {planResponsiveDamage,planResponsiveDeath} from './responsive-healing.mjs';
import {readTempHpState,layeredHpSnapshot,equalTempHpState,tempHpReceipt,sameTempHpReceipt,restoreTempHpReceipt,tempHpMax,planManualTempHpEdit,cappedTempHpExpiry,tempHpStateUpdate,TEMP_HP_FLAG,reconcileTempHpEffects} from './temporary-hp-layers.mjs';
export const SYSTEM_ID='fast-nri-v14';
const locks=new Set();
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const t=key=>game.i18n.localize(`FASTNRI.Damage.${key}`);
const hpValue=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:0;
const canChange=actor=>!!actor && (game.user?.isGM === true || actor.canUserModify?.(game.user,'update')===true || actor.isOwner===true);
/** The placed Token may proxy an Actor through its TokenDocument. Never edit
 * the baseActor: for unlinked tokens that would damage every copy of an NPC. */
export const actorForToken=token=>token?.actor ?? token?.document?.actor ?? null;
function reportMissingActor(token) {
  console.warn('Fast NRI | Cannot apply HP: selected Token has no Actor', {
    tokenId:token?.id ?? token?.document?.id ?? null,
    tokenName:token?.name ?? token?.document?.name ?? null,
    actorId:token?.document?.actorId ?? null
  });
  ui.notifications?.error(t('missingTokenActor'));
}
const confirm=async(content,title)=>Boolean(await foundry.applications.api.DialogV2.confirm({window:{title},content,modal:true,rejectClose:false}));
const messageFrom=id=>game.messages?.get(id);
const deathSnapshot=state=>state?.version===1?{...state}:null;
const deathStillMatches=(actor,state)=>foundry.utils.equals(deathSnapshot(deathStateOf(actor)),state);

export async function chooseControlledToken() {
  const all=canvas?.tokens?.controlled ?? [];
  if (all.length===0) { ui.notifications?.warn(t('selectToken')); return null; }
  if (all.length===1) return all[0];
  const choices=all.map((token,i)=>`<option value="${i}">${esc(token.name)}</option>`).join('');
  const fd=await foundry.applications.api.DialogV2.input({window:{title:t('selectToken')},
    content:`<select name="token">${choices}</select>`,ok:{label:t('select')},rejectClose:false});
  const n=Number(fd?.token);
  return fd && Number.isInteger(n) && n>=0 && n<all.length ? all[n] : null;
}

/** HP chat actions always require a single explicitly controlled scene token.
 * No target fallback, Actor search or new recipient-selection dialog. */
export async function chooseHpRecipient() {
  const controlled = canvas?.tokens?.controlled ?? [];
  if (controlled.length === 0) {
    ui.notifications?.warn(t('tokenNotSelected'));
    return null;
  }
  // Multiple controlled tokens have not been approved for automatic routing.
  // Do not guess a recipient or open an unapproved menu.
  if (controlled.length !== 1) {ui.notifications?.warn(t('selectOneToken'));return null;}
  const token = controlled[0];
  const actor = actorForToken(token);
  if (!actor) {reportMissingActor(token);return null;}
  if (!canChange(actor)) {ui.notifications?.error(t('noPermission'));return null;}
  return {actor,token,name:token.name ?? actor.name};
}

/** Healing is available for future card adapters and macros, not silently
 * inferred from a weapon's damage type. */
export async function applyHp({kind='damage',amount,sourceMessage=null,token=null,actor=null,critical=false,multiplier=1,expectedRevision=null,responseHealing=null,effectDegree=null,coverApplicationKey=null,independent=false,ignoreTempHp=false}={}) {
  if (sourceMessage && !canReadChatContent(sourceMessage)) return null;
  let recipient;
  if (actor) recipient={actor,token,name:token?.name ?? actor.name};
  else if (token) recipient={actor:actorForToken(token),token,name:token.name};
  else recipient=await chooseHpRecipient();
  if (!recipient) return null;
  ({actor,token}=recipient);
  if (!actor) {reportMissingActor(token);return null;}
  if (!canChange(actor)) {ui.notifications?.error(t('noPermission'));return null;}
  if (!['damage','heal','temp'].includes(kind)) throw new Error('Unknown HP channel');
  if (responseHealing !== null && kind !== 'damage')
    throw Error('Reactive healing belongs to a damage application only');
  const key=actor.uuid;
  if (locks.has(key)) return null;
  locks.add(key);
  let preventedBy=null,markerItem=null;
  try {
    const applied=await queueActorWrite(actor, async () => {
      if (!canChange(actor)) return null;
      if (coverApplicationKey && hasCoverApplication(coverApplicationKey)) return null;
      const reportId = coverApplicationKey ? coverReportId(coverApplicationKey) : null;
      // For immutable AREA messages, deleting the root ends further automatic
      // application. Do not resurrect its snapshot from an old button closure.
      // Preserve the established fallback for older, non-area HP workflows.
      const areaSource=!independent && sourceMessage?.getFlag?.(SYSTEM_ID,'weaponDamage')?.areaAttack?.version===1;
      const currentSource=sourceMessage ?
        (messageFrom(sourceMessage.id) ?? (areaSource ? null : sourceMessage)) : null;
      if (areaSource && !currentSource) return null;
      if (currentSource && !canReadChatContent(currentSource)) return null;
      const sourceRevision = currentSource?.getFlag?.(SYSTEM_ID,'weaponDamage')?.revision ?? 0;
      if (!independent && expectedRevision !== null && expectedRevision !== sourceRevision) return null;
      const doc=token?.document ?? token ?? null;
      const hiddenAreaRecipient=(areaSource || independent) && doc?.hidden===true;
      // This API receives the *resolved* response-healing result. No
      // hidden Item use, Roll or resource charge is invented here.
      const attack=independent?null:currentSource?.getFlag?.(SYSTEM_ID,'weaponDamage');
      const bypassTemp=kind==='damage' && (independent ? ignoreTempHp===true : attack?.damageRules?.ignoreTempHp===true);
      const initialHp=layeredHpSnapshot(actor);
      const layerId=kind==='temp'?foundry.utils.randomID():null;
      const abilityResult=kind==='temp'?currentSource?.getFlag?.(SYSTEM_ID,'abilityResult'):null;
      const expiry=abilityResult?.kind==='temporaryHp'?abilityResult.expiry:undefined;
      if(expiry&&hasTempHpResultExpired(expiry,{combat:game.combat,worldTime:game.time?.worldTime}))
        ui.notifications?.warn(game.i18n.localize('FASTNRI.AbilityChat.expiredTemporaryHp'));

      const makePlan=(preventZero=false)=>responseHealing===null ? planHpChange(initialHp,amount,kind,
        {id:layerId,source:{kind:'hp-card',messageId:sourceMessage?.id??null},
          worldTime:game.time?.worldTime??null,expiry:cappedTempHpExpiry(expiry),
          ignoreTempHp:bypassTemp,preventZero}) :
        planResponsiveDamage(initialHp,amount,responseHealing,{
          ignoreTempHp:attack?.damageRules?.ignoreTempHp===true,preventZero});
      let plan=makePlan();
      const phase=plan.damagePhase??plan;
      if(kind==='damage'&&phase.before.current>0&&phase.after.current===0&&initialHp.max>=1){
        markerItem=zeroHpPreventionItem(actor);
        if(markerItem)plan=makePlan(true);
        const item=(actor.items?.contents??[]).find(item=>item.type==='ability'&&item.system?.mechanics?.preventZeroHp===true&&!item.system?.mechanics?.preventZeroHpMarker);
        if(!markerItem&&item){
          const exhausted=abilityAccountingStatus(actor,item)?.remaining===0;
          const accepted=await confirm(`<p>0 → 1 HP</p>${exhausted?`<p>${esc(game.i18n.localize('FASTNRI.GameReroll.exhausted'))}</p>`:''}`,item.name);
          if(accepted){plan=makePlan(true);preventedBy=item;}
        }
      }
      const death=responseHealing===null ? await planDeathTransition(actor,{
        before:plan.before.current,after:plan.after.current,kind,
        hitPointsDamage:plan.damageThroughTemp,
        degree:effectDegree??attack?.effectDegree??attack?.degree??null,
        naturalD20:attack?.naturalD20??null
      }) : await planResponsiveDeath(actor,plan,{
        degree:effectDegree??attack?.effectDegree??attack?.degree??null,
        naturalD20:attack?.naturalD20??null
      });
      // When damage resolves first and exhausts the counter, the ordinary
      // reactive heal must not leave the dead Actor with positive HP.
      const after=plan.damagePhase && death.after?.dead===true ? plan.damagePhase.after : plan.after;
      const delta={current:after.current-plan.before.current,temp:after.temp-plan.before.temp};
      const name=recipient.name ?? actor.name;
      const deathTransition=death.changed ?
        {before:deathSnapshot(death.before),after:deathSnapshot(death.after)} : null;
      const report={version:1,kind,recipientName:name,
        actorUuid:actor.uuid,tokenUuid:doc?.uuid ?? null,sourceMessageId:sourceMessage?.id ?? null,
        sourceRevision,...(independent?{independent:true}:{}),...(bypassTemp?{ignoreTempHp:true}:{}),
        before:plan.before,after,delta,requested:plan.requested,
        hitPointsDamage:kind==='damage' ? (plan.damagePhase?
          Math.max(0,plan.damagePhase.before.current-plan.damagePhase.after.current):
          Math.max(0,plan.before.current-plan.after.current)) : 0,
        tempHpLayers:kind!=='heal'&&plan.tempHpState?{before:tempHpReceipt(plan.beforeTempHpState),
          after:tempHpReceipt(plan.tempHpState)}:null,
        ...(deathTransition?{deathTransition}:{}),
        // Keep only the timing fact in a potentially public HP report.
        // The response's amount/source may belong to a separate private Roll.
        actual:plan.actual,...(plan.response?{response:{version:1,order:plan.response.order}}:{}),
        critical:kind==='damage' && critical,multiplier:kind==='damage'&&critical?multiplier:1,
        reverted:false,author:game.user.id,createdAt:Date.now()};
      if (coverApplicationKey) report.coverApplicationKey=coverApplicationKey;
      // A public damage card may provide a useful reason. Never copy names from
      // a whispered or blind message into the target Actor's journal.
      const confirmedSource=currentSource ? messageFrom(currentSource.id) : null;
      if (currentSource && (!confirmedSource || !canReadChatContent(confirmedSource) ||
          (!independent && (confirmedSource.getFlag?.(SYSTEM_ID,'weaponDamage')?.revision??0)!==sourceRevision)))
        return null;
      const publicSource = confirmedSource && !confirmedSource.blind &&
        !(confirmedSource.whisper?.length);
      const sourceName = publicSource && !hiddenAreaRecipient && !(areaSource && doc?.hidden===true) ?
        confirmedSource.getFlag?.(SYSTEM_ID, 'weaponDamage')?.name : null;
      const reason = sourceName ? `${t(kind)} · ${sourceName}` : t(kind);
      if (hpValue(actor.system?.hp?.current)!==plan.before.current ||
          hpValue(actor.system?.hp?.temp)!==plan.before.temp ||
          !equalTempHpState(readTempHpState(actor),plan.beforeTempHpState) ||
          (deathTransition && !deathStillMatches(actor,deathTransition.before))) return null;
      const marker=markerItem?await markZeroHpPrevention(actor,markerItem):null;
      try {await actor.update({'system.hp.current':after.current,
        'system.hp.temp':after.temp,...tempHpStateUpdate(actor,plan.tempHpState),...death.patch},
        {fnriJournal:{kind,reason},fnriDeathLifecycle:'managed',fnriTempHp:'managed'});}
      catch(error){if(marker)await actor.deleteEmbeddedDocuments('ActiveEffect',[marker.id]);throw error;}
      try {
        await reconcileTempHpEffects(actor);
        const chatData={speaker:ChatMessage.getSpeaker(doc ? {actor,token:doc} : {actor}),
          content:`<div class="fnri-hp-report">${esc(name)} · ${esc(t(kind))}`+
            (kind==='damage' && critical ? ` (${esc(t('critical'))} ×${esc(multiplier)})` : '')+`: <strong>${plan.actual}</strong>`+
            (kind==='damage' ? ` <small>(${esc(t('temp'))} ${-(plan.damagePhase?.delta.temp ?? plan.delta.temp)}, HP ${-(plan.damagePhase?.delta.current ?? plan.delta.current)})</small>`:'')+(markerItem?`<p>${esc(markerItem.name)}: 1 HP</p>`:'')+`</div>`,
          flags:{[SYSTEM_ID]:{hpReport:report}}};
        const latestSource=confirmedSource ? messageFrom(confirmedSource.id) : null;
        if (confirmedSource && (!latestSource || !canReadChatContent(latestSource) ||
          (!independent && (latestSource.getFlag?.(SYSTEM_ID,'weaponDamage')?.revision??0)!==sourceRevision)))
          throw Error('Damage source changed after HP application');
        if (latestSource) {
          // A change of message audience is never widened by an HP report.
          Object.assign(chatData,hiddenAreaRecipient || areaSource && doc?.hidden===true
            ? gmChatAudience(latestSource) : chatAudience(latestSource));
        }
        // Foundry VTT v14: without a source, applyMode() with no explicit mode
        // uses the initiating client's current core message setting.
        const visibleData=latestSource ? chatData : ChatMessage.applyMode(chatData);
        const created=reportId ? await ChatMessage.create({...visibleData,_id:reportId},{keepId:true}) :
          await ChatMessage.create(visibleData);
        if (death.needsEffects) {
          try {await reconcileDeathEffects(actor);}
          catch(error) {console.warn('Fast NRI | HP death effect sync needs retry',error);}
        }
        // A new recovery result is posted only AFTER HP was actually changed
        // and its own report persisted. Failure of the follow-up must not undo
        // the successful HP transaction. The deterministic ID supports retry.
        if(created && kind==='damage' && attack){
          try {await ensureDamageRecovery(created,{damageMessage:latestSource});}
          catch(error){console.warn('Fast NRI | recovery follow-up pending',error);
            ui.notifications?.warn('Похищение: восстановление не опубликовано; возможен повтор через API.');}
        }
        return created;
      } catch(error) {
        const alreadyRecorded = reportId ? messageFrom(reportId) : null;
        const receipt = alreadyRecorded?.getFlag(SYSTEM_ID,'hpReport');
        if (receipt && receipt.coverApplicationKey === coverApplicationKey && receipt.actorUuid === actor.uuid &&
          receipt.before.current === plan.before.current && receipt.before.temp === plan.before.temp &&
          receipt.after.current === after.current && receipt.after.temp === after.temp) {
          if (death.needsEffects) await reconcileDeathEffects(actor);
          return alreadyRecorded;
        }
        // Avoid successful but untracked changes when the chat creation fails.
        const hp=actor.system.hp;
        if (hp.current===after.current && hp.temp===after.temp &&
          equalTempHpState(readTempHpState(actor),plan.tempHpState) &&
          (!deathTransition || deathStillMatches(actor,deathTransition.after))) {
          try {await actor.update({'system.hp.current':plan.before.current,
            'system.hp.temp':plan.before.temp,...tempHpStateUpdate(actor,plan.beforeTempHpState),
            ...(deathTransition?deathStateUpdate(actor,deathTransition.before,'hp-report-rollback'):{})},
            {fnriJournal:{kind:'recovery',reason:t('undo')},fnriDeathLifecycle:'managed',fnriTempHp:'managed'});
            if(marker)await actor.deleteEmbeddedDocuments('ActiveEffect',[marker.id]);
            await reconcileTempHpEffects(actor);
            if (death.changed) await reconcileDeathEffects(actor);}
          catch (rollbackError) {console.error('Fast NRI | recovery failed',rollbackError);}
        }
        throw error;
      }
    });
    // The HP operation holds the Actor write queue. Charge only after its
    // report is persisted and that queue is released, never on a cancelled
    // confirmation or a failed/rolled-back HP write.
    if(applied&&preventedBy)await finishCardAccounting({actor,item:preventedBy,message:applied,actionId:applied.id});
    return applied;
  } finally {locks.delete(key);}
}

export async function applyCardDamage(message,{critical=false}={}) {
  if (!canReadChatContent(message)) return null;
  const card=message?.getFlag?.(SYSTEM_ID,'weaponDamage');
  if (!card || card.version!==2) throw new Error('Unsupported damage card');
  if(card.parts?.some(p=>p.kind==='die'&&p.pending)) {
    ui.notifications?.warn(t('unrolledDice'));return null;
  }
  return applyDirectedDamage(message,card,{critical});
}

/** Programmatic, explicitly chosen reactive-healing path. The pre-evaluated
 * healingAmount must come from the actual response ability/HP-gain result.
 * This call does not consume an intervention, use an Item or add a button.
 * If no response was declared, use ordinary applyCardDamage instead.
 */
export async function applyCardDamageWithResponse(message,{healingAmount,critical=false,actor=null,token=null}={}) {
  if (!canReadChatContent(message)) return null;
  const card=message?.getFlag?.(SYSTEM_ID,'weaponDamage');
  if (!card || card.version!==2) throw Error('Unsupported damage card');
  if (card.parts?.some(p=>p.kind==='die'&&p.pending)) {
    ui.notifications?.warn(t('unrolledDice')); return null;
  }
  return applyDirectedDamage(message,card,{critical,actor,token,responseHealing:healingAmount});
}

async function applyDirectedDamage(message,card,{critical,actor=null,token=null,responseHealing=null}) {
  let snapshot=card, coverApplicationKey=null;
  const allCovers=coverRecords(message);
  if (allCovers.length) {
    if (!actor && !token) {
      const selected=await chooseHpRecipient();
      if (!selected) return null;
      ({actor,token}=selected);
    }
    if (!token && actor) {
      const uuids=[...new Set(allCovers.filter(cover => cover.allyKey===coverActorKey(actor)).map(cover=>cover.allyToken))];
      const original=uuids.length===1 ? await fromUuid(uuids[0]) : null;
      if (original?.actor?.uuid === actor.uuid) token=original;
    }
    const uuid=(token?.document ?? token)?.uuid;
    const records=allCovers.filter(cover => cover.allyToken===uuid ||
      !uuid && cover.allyKey===coverActorKey(actor));
    if (records.length) {
      if (!isCurrentDirectedCoverSource(message) || !uuid) {
        ui.notifications?.warn(game.i18n.localize('FASTNRI.CoverAlly.changed'));return null;
      }
      snapshot=directedCoverSnapshot(message,{actor:actor ?? actorForToken(token),document:token?.document ?? token});
      if (!snapshot) {ui.notifications?.warn(game.i18n.localize('FASTNRI.CoverAlly.changed'));return null;}
      coverApplicationKey=`ally:${coverScope(message)}:${uuid}`;
    }
  }
  if(card.postDefenseOrigin) {
    if(!actor&&!token){const recipient=await chooseHpRecipient();if(!recipient)return null;({actor,token}=recipient);}
    const defenses=previewDeclaredDamageDefenses(actor??actorForToken(token),snapshot);
    const immune=new Set(defenses.immunePartIds);
    snapshot={...snapshot,parts:snapshot.parts.map(p=>({...p,immune:p.immune||immune.has(p.id)})),
      adjustments:{...snapshot.adjustments,resistance:Math.max(snapshot.adjustments?.resistance??0,defenses.resistance),
        vulnerability:Math.max(snapshot.adjustments?.vulnerability??0,defenses.vulnerability)}};
    if(!defenses.complete)ui.notifications?.warn(t('postDefenseReview'));
    critical=false;
  }
  const values=calculateDamage(snapshot,{critical});
  return applyHp({kind:'damage',amount:values.total,sourceMessage:message,actor,token,critical,
    multiplier:values.multiplier,responseHealing,expectedRevision:card.revision??0,coverApplicationKey});
}

export async function revertHpReport(message) {
  if (!canReadChatContent(message)) return null;
  const report=message?.getFlag?.(SYSTEM_ID,'hpReport');
  if (!report || report.reverted) return null;
  if (!game.user?.isGM && !message.isAuthor) {ui.notifications?.error(t('noPermission'));return null;}
  const key=`undo:${message.id}`;
  if (locks.has(key)) return null;
  locks.add(key);
  try {
    // Re-read persistent message; never use stale click state.
    const fresh=messageFrom(message.id) ?? message;
    if (!canReadChatContent(fresh)) return null;
    const saved=fresh.getFlag(SYSTEM_ID,'hpReport');
    if (!saved || saved.reverted || saved.pendingUndo) return null;
    // The TokenDocument may have been reassigned to a different Actor since
    // this HP application. Its CURRENT actor is not automatically the original
    // recipient. Always resolve/validate the Actor UUID saved in the report.
    // This also preserves synthetic Actor identity for unlinked tokens.
    const doc=saved.tokenUuid ? await fromUuid(saved.tokenUuid) : null;
    const tokenActor=doc?.actor ?? null;
    const actor=tokenActor?.uuid === saved.actorUuid ? tokenActor :
      (saved.actorUuid ? await fromUuid(saved.actorUuid) : null);
    if (actor?.documentName !== 'Actor' || actor.uuid !== saved.actorUuid) {
      ui.notifications?.error(t('missingReportActor'));
      return null;
    }
    if (!canChange(actor)) {ui.notifications?.error(t('noPermission'));return null;}
    const hpBeforeUndo={current:actor.system.hp.current,temp:actor.system.hp.temp};
    const beforeUndoState=readTempHpState(actor);
    const beforeUndoDeath=deathSnapshot(deathStateOf(actor));
    const deathTransition=saved.deathTransition;
    if (deathTransition && !deathStillMatches(actor,deathTransition.after))
      throw Error('Death counter changed since this report; use manual correction');
    const layerReceipt=saved.tempHpLayers;
    if(layerReceipt && !sameTempHpReceipt(beforeUndoState,layerReceipt.after)){
      ui.notifications?.warn('Temporary HP layers changed after this report; use manual correction instead of unsafe undo');
      return null;
    }
    const reverse=reverseHpChange(actor.system.hp,saved);
    if (reverse.changedSince) {
      const yes=await confirm(`<p>${esc(t('changedHp'))}</p><p>HP: ${actor.system.hp.current} → ${reverse.current}, `+
        `${esc(t('temp'))}: ${actor.system.hp.temp} → ${reverse.temp}</p>`,t('undo'));
      if (!yes) return null;
    }
    // A confirmation can stay open while HP changes elsewhere. Do not apply
    // the previously displayed values to a newly changed Actor. The user can
    // retry the ordinary undo action using the updated HP.
    const stillMatches=()=>actor.system.hp.current===hpBeforeUndo.current &&
      actor.system.hp.temp===hpBeforeUndo.temp &&
      equalTempHpState(readTempHpState(actor),beforeUndoState) &&
      deathStillMatches(actor,beforeUndoDeath);

    return await queueActorWrite(actor,async()=>{
      if (!stillMatches()) return null;
      if (!canChange(actor)) {ui.notifications?.error(t('noPermission'));return null;}
      const current=()=>messageFrom(fresh.id) ?? fresh;
      const latest=current();
      const readReport=()=>current().getFlag(SYSTEM_ID,'hpReport');
      const latestReport=readReport();
      if (!canReadChatContent(latest) || !latestReport || latestReport.reverted ||
          latestReport.pendingUndo) return null;

      const reverseTempState=layerReceipt ? restoreTempHpReceipt(beforeUndoState,layerReceipt.before) :
        planManualTempHpEdit(beforeUndoState,reverse.temp,{id:foundry.utils.randomID()});
      const reverseTemp=tempHpMax(reverseTempState);
      // An older report without a saved counter keeps its historical transition.
      const undoKind=reverse.current>hpBeforeUndo.current?'heal':
        reverse.current<hpBeforeUndo.current?'damage':'temp';
      const oldReportTransition=deathTransition ? null : await planDeathTransition(actor,{
        before:hpBeforeUndo.current,after:reverse.current,kind:undoKind,
        hitPointsDamage:undoKind==='damage'?hpBeforeUndo.current-reverse.current:0
      });
      const changesDeath=Boolean(deathTransition || oldReportTransition?.changed);
      const reverseDeath=deathTransition ? deathTransition.before : oldReportTransition?.changed ?
        deathSnapshot(oldReportTransition.after) : beforeUndoDeath;
      const deathPatch=changesDeath?deathStateUpdate(actor,reverseDeath,'hp-undo'):{};
      const undoId=foundry.utils.randomID();
      const flag=`flags.${SYSTEM_ID}.hpReport`;
      const atReservation=readReport();
      if (!stillMatches() || !atReservation || atReservation.reverted ||
          atReservation.pendingUndo || !canReadChatContent(current())) return null;

      let attemptedHpWrite=false;
      try {
        // One reservation for the existing report; no new Actor permissions.
        await latest.update({[`${flag}.pendingUndo`]:undoId});
        if (readReport()?.pendingUndo!==undoId || !stillMatches() || !canChange(actor))
          throw Error(t('error'));
        attemptedHpWrite=true;
        await actor.update({'system.hp.current':reverse.current,'system.hp.temp':reverseTemp,
          ...tempHpStateUpdate(actor,reverseTempState),...deathPatch},
          {fnriJournal:{kind:'undo',reason:t('undo')},fnriDeathLifecycle:'managed',fnriTempHp:'managed'});
        if (readReport()?.pendingUndo!==undoId || !canReadChatContent(current()))
          throw Error(t('error'));
        await current().update({[`${flag}.reverted`]:true,[`${flag}.pendingUndo`]:null,
          [`${flag}.revertedAt`]:Date.now(),[`${flag}.revertedBy`]:game.user.id,
          [`${flag}.undoId`]:undoId,
          [`${flag}.reverseBefore`]:hpBeforeUndo,
          [`${flag}.reverseAfter`]:{current:reverse.current,temp:reverseTemp}});
      } catch(error) {
        const persisted=readReport();
        if (!(persisted?.reverted && persisted.undoId===undoId)) {
          let restored=!attemptedHpWrite || stillMatches();
          if (attemptedHpWrite && !restored && persisted?.pendingUndo===undoId &&
              actor.system.hp.current===reverse.current && actor.system.hp.temp===reverseTemp &&
              equalTempHpState(readTempHpState(actor),reverseTempState) &&
              deathStillMatches(actor,reverseDeath)) {
            try {
              await actor.update({'system.hp.current':hpBeforeUndo.current,
                'system.hp.temp':hpBeforeUndo.temp,...tempHpStateUpdate(actor,beforeUndoState),
                ...(changesDeath?deathStateUpdate(actor,beforeUndoDeath,'undo-compensation'):{})},
                {fnriJournal:{kind:'recovery',reason:t('undo')},fnriDeathLifecycle:'managed',fnriTempHp:'managed'});
              restored=true;
            } catch(rollbackError) {console.error('Fast NRI | undo compensation failed',rollbackError);}
          }
          if (restored && readReport()?.pendingUndo===undoId) {
            try {await current().update({[`${flag}.pendingUndo`]:null});}
            catch(clearError){console.error('Fast NRI | failed to clear pending undo',clearError);}
          }
          throw error;
        }
      }
      try {await reconcileTempHpEffects(actor);}
      catch(error){console.warn('Fast NRI | Shield undo sync needs retry',error);}
      // Effects are deferred until the HP report is marked undone.
      if (changesDeath) {
        try {await reconcileDeathEffects(actor);}
        catch(error) {console.warn('Fast NRI | HP undo death effect sync needs retry',error);}
      }
      // Remove only effects explicitly attached to THIS reverted HP report.
      // Independent or manually created effects are never rolled back.
      try {await undoAttackOutcomeEffects(fresh.id,{target:actor});}
      catch(error){console.warn('Fast NRI | HP undo needs manual outcome-effect cleanup',error);}
      return true;
    });
  } finally {locks.delete(key);}
}

export function renderHpReport(message,html) {
  if (!canReadChatContent(message)) return;
  const report=message?.getFlag?.(SYSTEM_ID,'hpReport');
  if (!report || !html?.querySelector || html.querySelector('[data-fnri-hp-actions]')) return;
  const anchor=html.querySelector('.message-content') ?? html;
  const wrap=document.createElement('div');wrap.dataset.fnriHpActions='';
  wrap.className='fnri-hp-report-actions';
  if (report.reverted) {
    anchor.classList.add('fnri-hp-reverted');
    const hint=document.createElement('small');hint.textContent=t('reverted');wrap.append(hint);
  } else if (game.user?.isGM || message.isAuthor) {
    const b=document.createElement('button');b.type='button';b.textContent=t('undo');
    let pending=false;
    b.addEventListener('click',async()=>{if(pending)return;pending=true;
      try {await revertHpReport(message);} catch(e){console.error('Fast NRI | undo failed',e);ui.notifications?.error(t('error'));}
      finally {pending=false;}});wrap.append(b);
  }
  anchor.append(wrap);
}
