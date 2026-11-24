/**
 * Explicit Actor-owned attack consequences. Decisions and previews only read
 * data. Applying templates writes native ActiveEffects to the supplied Actor.
 */
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {attackOutcomeForDamageCard, confirmedAttackDamage, resolveOutcomeItem} from './attack-outcomes.mjs';
import {createCardEffectData} from '../effects/apply-card-effect.mjs';
import {createPeriodicDamageEffect,preparePeriodicDamage} from '../effects/periodic-effect.mjs';
import {calculatePeriodicTick,declaredPeriodicDefenses} from '../damage/periodic-damage.mjs';
import {resolveSystemContentItem} from '../data/system-content.mjs';

const SCOPE = 'fast-nri-v14';
const isIndex = value => Number.isInteger(value) && value >= 0;

async function resolveTemplates(sourceUuid, {effectIds = [], effectRefs = []}) {
  const missingTemplates = [];
  const templates = new Map();
  const localItem = effectIds.length ? await resolveOutcomeItem(sourceUuid) : null;

  function collect(item, effectId, reference) {
    const effect = item?.documentName === 'Item' ? item.effects?.get(effectId) : null;
    if (!effect?.uuid || effect.transfer === true) missingTemplates.push(reference);
    else templates.set(effect.uuid, {item,effect});
  }

  for (const id of new Set(effectIds)) collect(localItem, id, `Item:${sourceUuid}/${id}`);
  for (const {contentId, effectId} of effectRefs) {
    collect(await resolveSystemContentItem(contentId), effectId, `Content:${contentId}/${effectId}`);
  }
  return {templates:[...templates.values()], missingTemplates};
}

async function describeOutcome(rule, choiceIndex) {
  const needsChoice = rule.kind === 'choice' &&
    (!isIndex(choiceIndex) || choiceIndex >= rule.options.length);
  const selection = rule.kind === 'choice' ? rule.choiceEffects[choiceIndex] : rule;
  const supportsTemplates = ['condition','choice'].includes(rule.kind) && !needsChoice;
  const {templates, missingTemplates} = supportsTemplates && selection
    ? await resolveTemplates(rule.sourceUuid, selection) : {templates:[],missingTemplates:[]};
  // Leave the existing UI preview contract unchanged. The periodic route
  // is an explicit API branch, not a new visible effect-action control.
  const canApplyEffects = !rule.timingUndeclared && templates.length > 0 &&
    missingTemplates.length === 0;
  return {
    decision:{
      resolved:true, sourceUuid:rule.sourceUuid, index:rule.index, kind:rule.kind,
      instruction:rule, selectedOption:needsChoice ? null : rule.options[choiceIndex] ?? null,
      choiceIndex:rule.kind === 'choice' && !needsChoice ? choiceIndex : null,
      requiresChoice:needsChoice, options:needsChoice ? [...rule.options] : [],
      effectIds:selection?.effectIds ?? [], effectRefs:selection?.effectRefs ?? [],
      missingTemplates, canApplyEffects, manual:!canApplyEffects,
      timingUndeclared:rule.timingUndeclared,
      movementIsManual:true, automaticallyApplied:false
    },
    templates
  };
}

async function prepareOutcome(message, {
  sourceUuid = null, index, choiceIndex = null, ...context
}={}) {
  if (!isIndex(index)) throw Error('An explicit non-negative outcome index is required');
  const preview = await attackOutcomeForDamageCard(message, context);
  const matches = preview.applicable.filter(rule => rule.index === index &&
    (!sourceUuid || rule.sourceUuid === sourceUuid));
  if (matches.length === 1) return describeOutcome(matches[0], choiceIndex);
  return {decision:{
    resolved:false, reason:matches.length ? 'ambiguous-outcome' : 'not-applicable',
    pending:preview.pending, unsupported:preview.unsupported,
    sourceUnavailable:preview.sourceUnavailable === true,
    weaponSourceUnavailable:preview.weaponSourceUnavailable === true,
    manual:true, automaticallyApplied:false
  }};
}

export async function prepareAttackOutcomeDecision(message, options) {
  return (await prepareOutcome(message, options)).decision;
}

export async function applyAttackOutcomeEffects(message, options={}) {
  const selected = options.target;
  const actor = selected?.documentName === 'Actor' ? selected : selected?.actor;
  const current = game.messages?.get(message?.id);
  if (!current) throw Error('An existing damage message is required');
  const card = current.getFlag(SCOPE, 'weaponDamage');
  const revision = card?.revision ?? 0;
  const {decision, templates} = await prepareOutcome(current, {...options,target:actor});
  if (decision.kind === 'periodicDamage') {
    return applyPeriodicOutcome(current,card,revision,decision,actor,options);
  }
  if (!decision.canApplyEffects) return {...decision,appliedEffectUuids:[],appliedCount:0};
  if (actor?.documentName !== 'Actor') throw Error('An explicit target Actor is required');
  if (!(actor.isOwner === true || actor.canUserModify?.(game.user, 'update') === true) ||
      typeof actor.createEmbeddedDocuments !== 'function') {
    throw Error('No permission to apply effects to the selected Actor');
  }

  // Include the original attack so a result and its derived defense card use
  // the same key. The destination Actor scopes IDs independently per target.
  const attackId = card.attackMessageId || current.id;
  // Area snapshots can contain rules from multiple independent Items.
  // Their effect identities must include the exact authoring source, not just
  // a generic 'source' slot, or equal-index outcomes may collide on one Actor.
  const sourceKey = card.areaAttack?.version===1 ? decision.sourceUuid :
    (decision.sourceUuid === card.weaponItemUuid &&
      decision.sourceUuid !== card.sourceUuid ? 'weapon' : 'source');
  const entries = templates.map(({item, effect}) => ({
    item, effect, id:stableDocumentId('fao',[attackId,sourceKey,decision.index,effect.uuid])
  }));
  function existing(entry) {
    const instance = actor.effects?.get(entry.id);
    if (instance && ((!card.areaOutcomeRedacted && instance.origin !== entry.effect.uuid) ||
        instance.getFlag(SCOPE, 'attackOutcomeApplication') !== true)) {
      throw Error('Attack outcome ActiveEffect identity conflict');
    }
    return instance;
  }

  // Recheck after template lookups. In particular, an HP undo can begin while
  // the earlier template resolution is in flight.
  const latestMessage = game.messages?.get(current.id);
  const latest = latestMessage?.getFlag(SCOPE, 'weaponDamage');
  if (!latest || !canReadChatContent(latestMessage) ||
      (latest.revision ?? 0) !== revision) {
    return {...decision,canApplyEffects:false,manual:true,reason:'damage-card-changed',
      appliedEffectUuids:[],appliedCount:0};
  }
  if (decision.instruction.afterDamage === true &&
      confirmedAttackDamage(current, latest, options.damageReportId, actor) === null) {
    return {...decision,canApplyEffects:false,manual:true,reason:'damage-not-applied',
      appliedEffectUuids:[],appliedCount:0};
  }

  const datas = entries.filter(entry => !existing(entry)).map(({item, effect, id}) => {
    const data = createCardEffectData(item,effect,actor);
    if (card.areaOutcomeRedacted) delete data.origin;
    data._id = id;
    data.flags ??= {};
    data.flags[SCOPE] ??= {};
    data.flags[SCOPE].attackOutcomeApplication = true;
    if (decision.instruction.afterDamage) {
      data.flags[SCOPE].attackOutcomeReportKey = stableDocumentId('hpr', options.damageReportId);
    }
    return data;
  });
  let created = [];
  if (datas.length) {
    try {
      created = await actor.createEmbeddedDocuments('ActiveEffect',datas,{keepId:true});
    } catch (error) {
      // A second client can win the native create. Treat that as success only
      // once the same effects are visible on this Actor.
      if (!entries.every(existing)) throw error;
    }
  }
  const confirmed = entries.map(existing);
  if (confirmed.some(effect => !effect)) throw Error('Foundry did not confirm all requested outcome effects');
  return {...decision, appliedCount:created.length, alreadyAppliedCount:entries.length-created.length,
    appliedEffectUuids:confirmed.map(effect => effect.uuid)};
}

/** Separate native periodic instance for each attack and target.  No UI and
 * no guessed traits. A retry of the same application reuses the original ID. */
async function applyPeriodicOutcome(message,card,revision,decision,actor,options) {
  if (actor?.documentName!=='Actor' || !(actor.isOwner===true ||
      actor.canUserModify?.(game.user,'update')===true))
    throw Error('No Actor permission to apply periodic outcome');
  const attackId=card.attackMessageId || message.id;
  const sourceKey=card.areaAttack?.version===1 ? decision.sourceUuid :
    (decision.sourceUuid===card.weaponItemUuid &&
      decision.sourceUuid!==card.sourceUuid ? 'weapon':'source');
  const applicationId=stableDocumentId('fpd',[attackId,sourceKey,decision.index,actor.uuid]);
  const existing=actor.effects?.get(applicationId);
  if (existing) {
    if (existing.getFlag(SCOPE,'periodicDamage')?.applicationKey!==applicationId)
      throw Error('Periodic outcome identity collision');
    return {...decision,appliedEffectUuids:[existing.uuid],appliedCount:0,
      alreadyAppliedCount:1};
  }
  // The card, result and HP report must still refer to the same revision.
  const latest=game.messages?.get(message.id);
  const latestCard=latest?.getFlag(SCOPE,'weaponDamage');
  if (!canReadChatContent(latest) || !latestCard ||
      (latestCard.revision??0)!==revision ||
      (decision.instruction.afterDamage === true &&
        confirmedAttackDamage(latest,latestCard,options.damageReportId,actor)===null)) {
    return {...decision,manual:true,reason:'damage-card-changed',appliedEffectUuids:[],appliedCount:0};
  }
  const rule=decision.instruction;
  const prepared=await preparePeriodicDamage({value:rule.value,formula:rule.formula,
    traits:rule.traits,durationTicks:rule.durationTicks,end:rule.end,
    name:rule.periodicName || 'Периодический урон'});
  const initial=calculatePeriodicTick(prepared.data,declaredPeriodicDefenses(actor));
  if (!initial.resolved || initial.total<=0) {
    // According to the rulebook, immunity or a nonpositive calculation
    // prevents automatic application; manual ActiveEffect creation stays free.
    return {...decision,manual:true,reason:!initial.resolved?'missing-periodic-data':
      initial.immune?'immunity':'zero-on-application',initialCalculation:initial,
      appliedEffectUuids:[],appliedCount:0};
  }
  const source=card.areaOutcomeRedacted ? null : await resolveOutcomeItem(decision.sourceUuid);
  // Preparing an Item-authored Roll and resolving its source both await. The
  // GM may undo the HP report or change the damage card in the meantime.
  // Recheck the same approved revision and Actor immediately before creating
  // the native ActiveEffect (a Foundry document write is still not a CAS).
  const atCommit=game.messages?.get(message.id);
  const atCommitCard=atCommit?.getFlag(SCOPE,'weaponDamage');
  if (!canReadChatContent(atCommit) || !atCommitCard ||
      (atCommitCard.revision??0)!==revision ||
      (rule.afterDamage===true &&
        confirmedAttackDamage(atCommit,atCommitCard,options.damageReportId,actor)===null)) {
    return {...decision,manual:true,reason:'damage-card-changed-during-preparation',
      appliedEffectUuids:[],appliedCount:0};
  }
  const result=await createPeriodicDamageEffect(actor,{prepared,documentId:applicationId,
    applicationKey:applicationId,sourceMessage:latest,sourceItem:source,
    privateToGm:card.areaAttack?.version===1 &&
      (options.privateRecipient===true || options.recipientToken?.document?.hidden===true),
    damageReportKey:rule.afterDamage && options.damageReportId ?
      stableDocumentId('hpr',options.damageReportId):null});
  return {...decision,appliedEffectUuids:[result.effect.uuid],
    appliedCount:result.alreadyApplied?0:1,
    alreadyAppliedCount:result.alreadyApplied?1:0,initialCalculation:initial};
}

/** Explicit cleanup after HP has been reverted. Effects from another
 * report, including manual copies, remain independent. */
export async function undoAttackOutcomeEffects(damageReportId,{target}={}) {
  const message = game.messages?.get(damageReportId);
  if (!canReadChatContent(message)) return [];
  const report = message.getFlag(SCOPE,'hpReport');
  const actor = target?.documentName === 'Actor' ? target : target?.actor;
  if (report?.version !== 1 || report.kind !== 'damage' || !report.reverted ||
      !actor?.uuid || actor.uuid !== report.actorUuid ||
      !(actor.isOwner || actor.canUserModify?.(game.user,'update'))) return [];
  const reportKey = stableDocumentId('hpr',damageReportId);
  const ids = (actor.effects?.contents ?? [])
    .filter(effect => effect.getFlag(SCOPE,'attackOutcomeApplication') === true &&
      effect.getFlag(SCOPE,'attackOutcomeReportKey') === reportKey)
    .map(effect => effect.id);
  return ids.length ? actor.deleteEmbeddedDocuments('ActiveEffect',ids) : [];
}

export async function prepareDamageCardOutcomes(message, context={}) {
  const preview = await attackOutcomeForDamageCard(message, context);
  const outcomes = [];
  for (const rule of preview.applicable) {
    const {decision} = await describeOutcome(rule, null);
    const options = [];
    const choices = rule.kind === 'choice' ? rule.options : [];
    for (const [choiceIndex, label] of choices.entries()) {
      const {decision:option} = await describeOutcome(rule, choiceIndex);
      options.push({label,choiceIndex,manual:option.manual,canApplyEffects:option.canApplyEffects,
        missingTemplates:option.missingTemplates,
        hasLinkedTemplateReference:option.effectIds.length + option.effectRefs.length > 0});
    }
    outcomes.push({sourceUuid:rule.sourceUuid,index:rule.index,kind:rule.kind,
      conditions:rule.conditions,formula:rule.formula,traits:rule.traits,distance:rule.distance,
      oncePerTurn:rule.oncePerTurn,afterDamage:rule.afterDamage,requiresDamage:rule.requiresDamage,
      timingUndeclared:rule.timingUndeclared,
      manual:decision.manual,canApplyEffects:decision.canApplyEffects,
      missingTemplates:decision.missingTemplates,needsChoice:decision.requiresChoice,options,
      automaticallyApplied:false,movementIsManual:true});
  }
  return {effectDegree:preview.effectDegree,outcomes,pending:preview.pending,
    unsupported:preview.unsupported,sourceUnavailable:preview.sourceUnavailable === true,
    weaponSourceUnavailable:preview.weaponSourceUnavailable === true,
    automaticallyApplied:false,movementIsManual:true};
}
