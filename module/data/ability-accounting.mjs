/**
 * Fast NRI 0.1.16 / 2C: optional, card-defined resource and ability usage.
 * Only explicit accounting mechanics are read; descriptive free text is not
 * interpreted. Resources and uses are advisory: no game action is blocked.
 *
 * system.mechanics.accounting = {
 *   resourceCosts: [{resourceId:'row-id',amount:2,kind:'class'}],
 *   frequency: {uses:2},        // per one explicit Rest
 *   cooldownRounds: 3          // only rounds of an active Combat
 * };
 *
 * Older 2A keys (frequency.reset, cooldownSeconds) are not timers and do not
 * create additional rest types. In v0.1.16 no worldTime timers are used.
 */
import {canReadChatContent} from './chat-visibility.mjs';
import {privateAreaSourceFor,createAreaUseMessage,PENDING_AREA_USES} from './private-area-source.mjs';
import {serverTimestamp} from './server-clock.mjs';
import {restResourceTarget} from './classes.mjs';
import {directedInterventionVariants} from './intervention-variants.mjs';
import {TEMP_HP_FLAG,readTempHpState,tempHpStateUpdate} from '../damage/temporary-hp-layers.mjs';
const SCOPE = 'fast-nri-v14';
const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION_ID = /^[A-Za-z0-9_-]{1,40}$/;
/** One opaque id per logical card use; it is never derived from a card name,
 * time window, or an earlier use of the same ability. */
export function createCardActionId() { return foundry.utils.randomID(); }
export function normalizedCardActionId(value) {
  return typeof value === 'string' && ACTION_ID.test(value) ? value : null;
}
function eventKeyFor(message, item, actionId) {
  const id = normalizedCardActionId(actionId);
  if (!id) return message.id;
  // Distinct cards within one composite action retain independent costs.
  // An absent Item is a separate built-in action source.
  const source = item ? String(item.id ?? '') : 'builtin';
  if (!ROW_ID.test(source)) return message.id;
  // The length prefix prevents collisions when ids contain underscores.
  return `a_${id.length}_${id}_${source}`;
}

const RESOURCE_KINDS = new Set(['class', 'intervention']);
const INTERVENTION_NAMES = new Set(['вмешательство', 'вмешательства', 'intervention', 'interventions']);
const resourceNameKey = value => String(value ?? '').trim().toLocaleLowerCase('ru');
const resourceKind = row => row?.kind ||
  (INTERVENTION_NAMES.has(resourceNameKey(row?.name)) ? 'intervention' : null);
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const positiveNumber = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
const positiveInteger = value => Number.isSafeInteger(value) && value > 0 ? value : null;
function actorCanWrite(actor) {
  return !!actor && (actor.isOwner === true ||
    actor.canUserModify?.(game.user, 'update') === true || game.user?.isGM === true);
}
function historyOf(actor) {
  return asObject(actor?.getFlag?.(SCOPE,'accountingEvents') ?? actor?.flags?.[SCOPE]?.accountingEvents);
}
function interventionResourceId(actor) {
  const rows = Object.entries(actor?.system?.resources ?? {}).filter(([id,row]) =>
    ROW_ID.test(id) && resourceKind(row) === 'intervention');
  return rows.length===1 ? rows[0][0] : null;
}
function combatForActor(actor) {
  const combat=game.combat;
  if (!actor || !combat?.started || combat.active === false || !Number.isInteger(combat.round)) return null;
  // The combat must include this actor (a synthetic token Actor is matched by token id).
  const hasActor=Array.from(combat.combatants ?? []).some(c =>
    c.actor?.uuid === actor.uuid || c.actorId === actor.id &&
    (!actor.isToken || c.tokenId === actor.token?.id));
  return hasActor ? combat : null;
}
/** No name-based special casing; no hard restrictions on ability usage. */
export function accountingRule(item, execution=null) {
  const raw=asObject(item?.system?.mechanics?.accounting);
  const variant=asObject(execution?.accounting);
  // A variant may replace the ability's resource costs; rest/frequency/cooldown
  // still belong to the one source Item. An explicit [] means no resource cost.
  const costs=Object.hasOwn(variant,'resourceCosts') ? variant.resourceCosts : raw.resourceCosts;
  const resourceCosts=Array.isArray(costs) ? costs.flatMap(cost=>{
    const id=String(cost?.resourceId ?? '');
    const resourceName=String(cost?.resourceName ?? '').trim();
    const amount=positiveNumber(cost?.amount);
    if ((!ROW_ID.test(id) && !resourceName) || amount === null) return [];
    return [{resourceId:ROW_ID.test(id)?id:null,resourceName,amount,
      kind:RESOURCE_KINDS.has(cost?.kind)?cost.kind:null}];
  }) : [];
  const legacyMaster=item?.type==='ability' &&
    item.flags?.[SCOPE]?.contentId==='fnri7.rulebook.racial.master-boia';
  const uses=positiveInteger(asObject(raw.frequency).uses) ?? (legacyMaster ? 1 : null);
  const frequency=uses ? {uses} : null;
  const cooldownRounds=positiveInteger(raw.cooldownRounds);
  return resourceCosts.length || frequency || cooldownRounds ?
    {resourceCosts,frequency,cooldownRounds} : null;
}
/** A world Item cannot know the arbitrary ID of a resource row created in
 * an Actor sheet. An authored resourceName resolves ONLY if exactly one row
 * has that name (and, if specified, the requested kind). Never silently
 * resolve two same-named rows or auto-create/rename a player's resources.
 */
function resolveResourceCost(resources,cost) {
  if(cost.resourceId)return {...cost};
  const wanted = resourceNameKey(cost.resourceName);
  const matches = Object.entries(resources ?? {}).filter(([id,row]) => {
    const kind = resourceKind(row);
    return ROW_ID.test(id) && resourceNameKey(row?.name) === wanted &&
      (!cost.kind || !kind || cost.kind === kind);
  });
  if(matches.length!==1)return {...cost,resourceId:null,
    reason:matches.length?'ambiguous':'unavailable'};
  return {...cost,resourceId:matches[0][0]};
}
function resolvedResourceCosts(actor,explicit) {
  return explicit.map(cost => resolveResourceCost(actor?.system?.resources,cost));
}

/** Untyped sheet rows can be classified by the same declarations that spend them. */
export function classResourceIds(actor, resources, confirmedChanges = []) {
  const ids = new Set(Object.keys(resources).filter(id => resourceKind(resources[id]) === 'class'));
  const addUntyped = id => {
    if (id && Object.hasOwn(resources,id) && !resourceKind(resources[id])) ids.add(id);
  };
  if (Array.isArray(confirmedChanges)) {
    for (const change of confirmedChanges) addUntyped(change?.resourceId);
  }
  for (const item of actor.items ?? []) {
    const executions = item.system?.mechanics?.executions;
    for (const execution of [null, ...(Array.isArray(executions) ? executions : [])]) {
      for (const cost of accountingRule(item,execution)?.resourceCosts ?? []) {
        if (cost.kind === 'intervention') continue;
        addUntyped(resolveResourceCost(resources,cost).resourceId);
      }
    }
  }
  return ids;
}

/** Read-only preview uses EXACTLY the same cost contract as an eventual card use.
 * It does not reserve, decrement, lock, or refuse an action. When more than one
 * intervention resource exists, no one is silently selected.
 */
export function abilityCostPreview(actor,item,execution=null) {
  const explicit=resolvedResourceCosts(actor,accountingRule(item,execution)?.resourceCosts??[]);
  const hasInterventionCost=explicit.some(cost=>cost.kind==='intervention' ||
    resourceKind(actor?.system?.resources?.[cost.resourceId])==='intervention');
  const counter=execution?.isIntervention===true && !hasInterventionCost
    ? interventionResourceId(actor) : null;
  const combined=new Map();
  const warnings=explicit.filter(cost=>!cost.resourceId).map(cost=>({
    reason:cost.reason??'unavailable',resourceName:cost.resourceName,resourceId:null
  }));
  for (const cost of [...explicit,...(counter?[{resourceId:counter,amount:1,kind:'intervention'}]:[])]) {
    if(!cost.resourceId)continue;
    combined.set(cost.resourceId,(combined.get(cost.resourceId)??0)+cost.amount);
  }
  if (execution?.isIntervention===true && !hasInterventionCost && !counter)
    warnings.push({reason:'intervention-resource-unknown',resourceId:null});
  for (const [resourceId,amount] of combined) {
    const row=actor?.system?.resources?.[resourceId];
    const available=row?.current;
    if (typeof available !== 'number' || !Number.isFinite(available)) {
      warnings.push({reason:'unavailable',resourceId});
    } else if (available<amount) {
      warnings.push({reason:'insufficient',resourceId});
    }
  }
  return warnings;
}
function eventsAfterRest(actor) {
  const all=Object.values(historyOf(actor)).filter(e=>e && (e.type==='rest' || e.type==='use'));
  const lastRest=all.findLastIndex(e=>e.type==='rest');
  return all.slice(lastRest+1);
}
/** Only a use in the Actor's current active combat can start a round cooldown.
 * Rest clears the usage baseline for both kinds of frequency.
 */
export function abilityAccountingStatus(actor,item) {
  const rule=accountingRule(item);
  if (!rule) return null;
  const uses=eventsAfterRest(actor).filter(e=>e.type==='use' && e.sourceItemUuid===item?.uuid);
  const previous=uses.at(-1);
  const combat=rule.cooldownRounds ? combatForActor(actor) : null;
  let cooldownRemainingRounds=null;
  if (combat) {
    const combatUse=uses.findLast(event=>event.combatId===combat.id && Number.isInteger(event.combatRound));
    cooldownRemainingRounds=combatUse
      ? Math.max(0,rule.cooldownRounds-Math.max(0,combat.round-combatUse.combatRound))
      : 0;
  }
  return {
    used:uses.length,remaining:rule.frequency?Math.max(0,rule.frequency.uses-uses.length):null,
    frequency:rule.frequency,cooldownRemainingRounds,lastUsed:previous?.at??null
  };
}
/** For the existing Actor journal: no ordinary actions, no second ledger. */
export function accountingJournal(actor) {
  return Object.values(historyOf(actor)).filter(e=>e?.type==='use' &&
    ((e.classResourceChanges?.length??0)>0 || e.trackedFrequency===true))
    .sort((a,b)=>(a.at??0)-(b.at??0));
}
const pendingActorWrites = new Map();

/** Serialize cooperating writes on this client. A cross-Actor Item use waits
 * for both documents before preparing its changes. */
export function queueActorWrite(actors, operation) {
  const keys = [...new Set((Array.isArray(actors) ? actors : [actors])
    .map(actor => actor?.uuid).filter(Boolean))];
  const previous = [...new Set(keys.map(key => pendingActorWrites.get(key)).filter(Boolean))];
  const task = Promise.allSettled(previous).then(operation);
  for (const key of keys) pendingActorWrites.set(key, task);
  const clear = () => {
    for (const key of keys) if (pendingActorWrites.get(key) === task) pendingActorWrites.delete(key);
  };
  void task.then(clear,clear);
  return task;
}
/** A completed ChatMessage is the default usage key. Explicit composite
 * actions can share one key across several successful primary messages.
 * This is opt-in only: unrelated clicks never merge by proximity or name. */
export async function recordCardUse({actor,item=null,message,isIntervention=false,actionId=null,execution=null}={}) {
  if (!actorCanWrite(actor) || !message?.id || !ROW_ID.test(String(message.id))) return null;
  const rule=accountingRule(item,execution);
  const counter=isIntervention?interventionResourceId(actor):null;
  if (!rule && !counter) return null;
  return queueActorWrite(actor,()=>commitCardUse({actor,item,message,isIntervention,actionId,execution}));
}
export async function finishCardAccounting(args) {
  try {return await recordCardUse(args);}
  catch(error) {console.error('Fast NRI | Published action accounting failed',error);return null;}
}

// Use the same receipt for the initial write and recovery. The Item's name,
// identity, frequency and chosen price are captured before publishing.
export async function publishAreaUse({actor,item,execution,isIntervention=true,publish,messageId}) {
  const rule=accountingRule(item,execution);
  const resourceCosts=resolvedResourceCosts(actor,rule?.resourceCosts??[]).map(cost=>({
    ...cost,kind:cost.kind??resourceKind(actor.system?.resources?.[cost.resourceId])??'class'
  }));
  const hasCounterCost=resourceCosts.some(cost=>cost.kind==='intervention' ||
    resourceKind(actor.system?.resources?.[cost.resourceId])==='intervention');
  const implicitCounter=isIntervention && !hasCounterCost ?
    interventionResourceId(actor) : null;
  if (!rule && !implicitCounter) return publish(messageId);
  const use={actorUuid:actor.uuid,item:item?{uuid:item.uuid,type:item.type,name:item.name}:null,
    rule:rule?{...rule,resourceCosts}:null,
    isIntervention,implicitCounter};
  const message=await createAreaUseMessage(actor,use,publish,messageId);
  if (message) {
    try { await settleAreaUse(actor,message,use); }
    catch(error) {
      console.warn('Fast NRI | Retrying published intervention accounting',error);
      try { await settleAreaUse(actor,message,use); }
      catch(retryError) {console.error('Fast NRI | Intervention accounting pending',retryError);}
    }
  }
  return message;
}

function settleAreaUse(actor,message,use) {
  return queueActorWrite(actor,()=>{
    if (!actorCanWrite(actor) || use.actorUuid!==actor.uuid || !game.messages?.get(message.id)) return null;
    return commitCardUse({actor,item:use.item,message,isIntervention:use.isIntervention,areaUse:use});
  });
}
/** Recover a missing accounting write for a published result. The existing
 * usage key makes a repeated recovery return the already recorded event. */
export async function retryCardAccounting(message, {actor,item=null,isIntervention=false}={}) {
  const current = game.messages?.get(message?.id);
  if (!canReadChatContent(current) ||
      !(current.isAuthor || game.user?.isGM) || !actorCanWrite(actor)) return null;
  const area=current.getFlag(SCOPE,'areaIntervention');
  if (area) {
    if (area.actorUuid && area.actorUuid!==actor.uuid) return null;
    const saved=historyOf(actor)[current.id];
    if (saved?.areaPerformerUuid===actor.uuid)
      return !item || item.uuid===saved.sourceItemUuid ? saved : null;
    const use=actor.getFlag(SCOPE,PENDING_AREA_USES)?.[current.id];
    if (!use || use.actorUuid!==actor.uuid || (item && item.uuid!==use.item?.uuid)) return null;
    return settleAreaUse(actor,current,use);
  }
  const defense = current.getFlag(SCOPE,'weaponDamage')?.intervention;
  const check = current.getFlag(SCOPE,'checkRoll');
  const attack = current.getFlag(SCOPE,'weaponAttack');
  const sourceActor = defense?.initiatorActorUuid ?? check?.actorUuid ?? attack?.actorUuid ??
    current.getFlag(SCOPE,'abilityExecution')?.actorUuid;
  const privateSource=sourceActor ? null : privateAreaSourceFor(current);
  if ((sourceActor??privateSource?.actor.uuid) !== actor.uuid) return null;
  if (item?.parent?.documentName === 'Actor' && item.parent.uuid !== actor.uuid) return null;
  const executionId=current.getFlag(SCOPE,'abilityExecution')?.executionId??privateSource?.executionId;
  const executions=item?.system?.mechanics?.executions;
  let execution=Array.isArray(executions) ? executions.find(e=>e?.id===executionId) : null;
  if (defense?.variantId) {
    if (!item || (defense.sourceUuid && defense.sourceUuid !== item.uuid)) return null;
    execution = directedInterventionVariants(item).find(variant => variant.id === defense.variantId)?.rule;
    if (!execution) return null;
  }
  const augmentSources=current.getFlag(SCOPE,'weaponAttack')?.attackAugments??[];
  const isAugment=augmentSources.some(entry=>entry?.sourceUuid===item?.uuid) ||
    privateSource?.augmentItemUuids?.includes(item?.uuid)===true;
  if (privateSource && item && !isAugment && item.uuid!==privateSource.accountingItemUuid) return null;
  return recordCardUse({actor,item,message:current,isIntervention,execution,
    actionId:isAugment?current.id:current.getFlag(SCOPE,'compositeActionId')});
}

async function commitCardUse({actor,item,message,isIntervention,actionId,execution,areaUse=null}) {
  const key=eventKeyFor(message,item,actionId);
  if (historyOf(actor)[key]) return historyOf(actor)[key];
  const rule=areaUse ? areaUse.rule : accountingRule(item,execution);
  const explicit=areaUse ? (rule?.resourceCosts??[]) : resolvedResourceCosts(actor,rule?.resourceCosts??[]);
  const hasInterventionCost=explicit.some(cost=>cost.kind==='intervention' ||
    resourceKind(actor.system?.resources?.[cost.resourceId])==='intervention');
  const counter=areaUse ? areaUse.implicitCounter :
    (isIntervention && !hasInterventionCost ? interventionResourceId(actor) : null);
  const combined=new Map();
  const unresolved=explicit.filter(cost=>!cost.resourceId).map(cost=>({
    resourceId:null,resourceName:cost.resourceName,amount:cost.amount,
    reason:cost.reason??'unavailable'
  }));
  for (const cost of [...explicit,...(counter?[{resourceId:counter,amount:1,kind:'intervention'}]:[])]) {
    if(!cost.resourceId)continue;
    const previous=combined.get(cost.resourceId);
    combined.set(cost.resourceId,{resourceId:cost.resourceId,
      amount:(previous?.amount??0)+cost.amount,
      kind:cost.kind??resourceKind(actor.system?.resources?.[cost.resourceId])??'class'});
  }
  const updates={},resourceChanges=[],skippedCosts=[...unresolved];
  for (const cost of combined.values()) {
    const row=actor.system?.resources?.[cost.resourceId];
    const before=row?.current;
    if (!row || typeof before!=='number' || !Number.isFinite(before)) {
      skippedCosts.push({resourceId:cost.resourceId,amount:cost.amount,reason:'unavailable'});continue;
    }
    if (before<cost.amount) {
      skippedCosts.push({resourceId:cost.resourceId,amount:cost.amount,reason:'insufficient'});continue;
    }
    const after=before-cost.amount;
    updates[`system.resources.${cost.resourceId}.current`]=after;
    resourceChanges.push({resourceId:cost.resourceId,kind:cost.kind,before,after,delta:-cost.amount});
  }
  const combat=item?.type==='ability' && rule?.cooldownRounds ? combatForActor(actor):null;
  const trackedFrequency=Boolean(rule?.frequency || combat);
  const event={type:'use',at:serverTimestamp(),by:game.user?.id??null,
    ...(areaUse?{areaPerformerUuid:areaUse.actorUuid}:{}),
    sourceItemUuid:item?.uuid??null,
    sourceName:message.blind || message.whisper?.length ? null : item?.name??null,
    chatMessageUuid:message.blind || message.whisper?.length ? null : message.uuid??null,
    actionId:key!==message.id ? normalizedCardActionId(actionId) : null,trackedFrequency,
    frequency:rule?.frequency??null,cooldownRounds:combat?rule.cooldownRounds:null,
    combatId:combat?.id??null,combatRound:combat?.round??null,
    classResourceChanges:resourceChanges.filter(c=>c.kind==='class'),resourceChanges,skippedCosts};
  updates[`flags.${SCOPE}.accountingEvents.${key}`]=event;
  if (areaUse && actor.getFlag(SCOPE,PENDING_AREA_USES)?.[message.id]) {
    updates[`flags.${SCOPE}.${PENDING_AREA_USES}.-=${message.id}`]=null;
  }
  await actor.update(updates);
  return event;
}
/**
 * The single approved Rest action. HP are restored to their current maximum,
 * temporary HP are cleared, numerical resources with a maximum are filled
 * (PC Rhythm is reset to zero),
 * and every tracked ability use/cooldown is reset by the new rest marker.
 *
 * In Foundry v14, Item transfer effects remain embedded in their Item. Only
 * ActiveEffects directly embedded in this Actor are removed. In particular,
 * an Actor effect copied from a spell Item is still an Actor-owned effect and
 * is removed; the original Item effect template is never changed.
 *
 * Both the Actor sheet button and game.system.api.restActor(actor) invoke this
 * same operation. No per-rest subtype, dialog, calendar, or background timer.
 */
export async function restActor(actor) {
  if (!actorCanWrite(actor) || !['character','npc'].includes(actor?.type)) return null;
  return queueActorWrite(actor, async () => {
    if (!actorCanWrite(actor)) return null;
    // Collect only genuinely tracked ability uses since the previous Rest.
    // These names are returned to the caller for the chat report, not copied
    // into another historical snapshot or a second event log.
    const restoredUses = new Map();
    for (const use of eventsAfterRest(actor)) {
      if (use?.type !== 'use' || use.trackedFrequency !== true) continue;
      const key = use.sourceItemUuid || (use.sourceName ? `name:${use.sourceName}` : null);
      if (key && !restoredUses.has(key)) restoredUses.set(key, String(use.sourceName ?? '').trim());
    }
    // Delete only Actor-owned ActiveEffects. allApplicableEffects() also yields
    // transferred Item effects and MUST NOT be used for this destructive action.
    const actorEffects = [...(actor.effects?.contents ?? [])]
      .filter(effect => effect?.parent?.documentName === 'Actor' && effect.id);
    const previousEffects = actorEffects.map(effect => effect.toObject(true));
    const marker = foundry.utils.randomID();
    try {
      if (actorEffects.length) {
        await actor.deleteEmbeddedDocuments('ActiveEffect', actorEffects.map(effect => effect.id),{fnriShieldSync:true});
      }

      // Read prepared Actor data after removing Actor effects, so the restored
      // maximum cannot accidentally include a bonus from an expired condition.
      const updates = {};
      const hpChanges = [];
      const hp = actor.system?.hp ?? {};
      if (typeof hp.max === 'number' && Number.isFinite(hp.max) && hp.current !== hp.max) {
        updates['system.hp.current'] = hp.max;
        hpChanges.push({field:'current', before:hp.current ?? null, after:hp.max});
      }
      const layers=readTempHpState(actor);
      if (hp.temp !== 0) {
        updates['system.hp.temp'] = 0;
        hpChanges.push({field:'temp', before:hp.temp ?? null, after:0});
      }
      if(Object.keys(layers.layers).length) {
        // Rest removes every layer, including a hidden weaker source.
        Object.assign(updates,tempHpStateUpdate(actor,{version:1,layers:{}}));
      }

      const changes = [];
      if(Number.isSafeInteger(actor.system?.potionsUsed)&&actor.system.potionsUsed!==0){
        updates['system.potionsUsed']=0;
        changes.push({resourceId:'potionsUsed',before:actor.system.potionsUsed,after:0,potion:true});
      }
      for (const [id,row] of Object.entries(actor.system?.resources ?? {})) {
        const maximum = restResourceTarget(actor,id,row);
        if (!ROW_ID.test(id) || typeof maximum !== 'number' || !Number.isFinite(maximum)) continue;
        const before = row.current ?? null;
        if (before === maximum) continue;
        updates[`system.resources.${id}.current`] = maximum;
        changes.push({resourceId:id,before,after:maximum});
      }
      // Explicit rest marker, even when nothing numerical changes. This keeps
      // accounting and the existing journal in sync without a second ledger.
      const event = {
        type:'rest', at:serverTimestamp(), by:game.user?.id ?? null,
        resourceChanges:changes, hpChanges,
        removedActorEffectCount:actorEffects.length
      };
      updates[`flags.${SCOPE}.accountingEvents.${marker}`] = event;
      await actor.update(updates, {fnriJournal:{kind:'rest'},fnriTempHp:'managed'});
      // A return-only report for the already approved chat message. The stored
      // event is unchanged and remains the single authoritative Rest marker.
      return {...event,
        restoredAbilityCount:restoredUses.size,
        restoredAbilityNames:[...restoredUses.values()].filter(Boolean)};
    } catch (error) {
      if (!historyOf(actor)[marker]) {
        const missing = previousEffects.filter(effect => !actor.effects?.get(effect._id));
        if (missing.length) {
          try {
            await actor.createEmbeddedDocuments('ActiveEffect',missing,{keepId:true});
          } catch (recoveryError) {
            error.cause = recoveryError;
            console.error('Fast NRI | Rest effect recovery failed',recoveryError);
          }
        }
      }
      throw error;
    }
  });
}
