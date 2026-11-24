import {currentMessageMode, resolveMessageMode} from '../data/chat-visibility.mjs';
import {finishCardAccounting,normalizedCardActionId} from '../data/ability-accounting.mjs';
import {cardEffectLinks} from '../effects/chat-effect-links.mjs';
import {prepareRoll,finalizeRollEffects,visibleRollInfluences,fixedRollComponents} from "./roll-context.mjs";
import {weaponTraitOptions,selectedWeaponTraitIds} from '../equipment/weapon-traits.mjs';
import {naturalAttackingD20,resolveCheckDegree} from './attack-core.mjs';
import {CHECK_DEFENSES,selectedTargetSnapshot} from './attack-properties.mjs';
/** Fast NRI stage 3: safe, transparent wrappers around Foundry v14 Roll.
 * This file does not determine outcomes, attacks, damage or resource costs.
 */
export {MESSAGE_MODES, resolveMessageMode} from '../data/chat-visibility.mjs';

const finiteOrZero = value => (typeof value === "number" && Number.isFinite(value)) ? value : 0;
const safeText = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Skill and specialization both use the very same check. The optional
 * modifier is a prepared value: native ActiveEffect changes have already
 * been applied by Foundry. Never add the underlying effect a second time.
 */
export function skillFormula(entry) {
  const dice = String(entry?.dice ?? "").trim();
  const modifier = finiteOrZero(entry?.modifier);
  return `1d20${dice ? ` + (${dice})` : ""}${modifier ? ` + (${modifier})` : ""}`;
}

export function itemFormula(item) {
  // A card owns its complete expression. The common engine never silently
  // inserts d20 or a class/race-based modifier into an item card roll.
  return String(item?.system?.rollFormula ?? "").trim();
}

export async function postRoll(options) {
  return (await postCheckRoll(options))?.roll ?? null;
}

export async function postCheckRoll({ formula, label, actor = null, mode, isIntervention=false,
  attackKind=null,targetDefense=null,selfDefenseRule=null, kind='ability', skillId=null,
  formulaForActor=null, skipPreroll=false, sourceItem=null, actionId=null, accountingItem=null,
  defenseStat=null,weaponItem=null,difficulty=null,execution=null,audienceMessage=null,
  resultKind=null,targetTokens=null,standardActionId=null,targetDifficultyModifier=null,
  compareEachTarget=false,recordRecipient=false }) {
  const usesTargetDefense = CHECK_DEFENSES.includes(targetDefense);
  const declaredTargets = usesTargetDefense || recordRecipient
    ? [...(targetTokens ?? game.user?.targets ?? [])] : null;
  const context = await prepareRoll({actor,kind,skillId,defenseStat,formula,
    formulaForActor,skipDialog:skipPreroll,label,sourceItem,weaponItem});
  if (context === null) return null; // Closing the preparation window changes nothing.
  const expression = context.expression.trim();
  if (!expression) throw new Error("empty-formula");
  if (typeof Roll.validate === "function" && !Roll.validate(expression)) throw new Error("invalid-formula");
  const sharedActionId=normalizedCardActionId(actionId);
  const roll = await new Roll(expression, context.actor?.getRollData?.() ?? {}).evaluate();
  const visibilityMode = audienceMessage ? (audienceMessage.blind ? 'blind' :
    (audienceMessage.whisper?.length ? 'gm' : 'public')) : resolveMessageMode(mode, currentMessageMode());
  const targets = declaredTargets && ['public', 'ic'].includes(visibilityMode) && !recordRecipient
    ? declaredTargets.filter(token => (token?.document ?? token)?.hidden !== true)
    : declaredTargets;
  const target = targets ? selectedTargetSnapshot(targets,targetDefense) : null;
  const targetDifficulty = target?.status === 'one'
    ? target.difficulty + (targetDifficultyModifier?.(targets[0]) ?? 0) : null;
  const targetDifficulties = new Map();
  if (compareEachTarget && usesTargetDefense) {
    for (const token of targets) {
      const snapshot = selectedTargetSnapshot([token],targetDefense);
      if (snapshot.uuid) targetDifficulties.set(snapshot.uuid,snapshot.difficulty);
    }
  }
  const naturalD20 = naturalAttackingD20(roll);
  const resolved = resolveCheckDegree({total:roll.total,naturalD20,
    difficulty:Number.isFinite(difficulty) ? difficulty : targetDifficulty});
  const result = resolved.ok ? {degree:resolved.degree,naturalD20,
    total:roll.total,targetUuid:target?.uuid ?? null} : null;
  // The individual comparisons are returned to the caller. The published
  // roll has the normal audience and carries no list of selected observers.
  const targetResults = Array.from(targetDifficulties, ([targetUuid, difficulty]) => {
    const comparison = resolveCheckDegree({total:roll.total,naturalD20,difficulty});
    return {targetUuid, degree:comparison.ok ? comparison.degree : null};
  });
  const recipient = recordRecipient ? declaredTargets[0] : null;
  const chatResult = result && (recipient?.document ?? recipient)?.hidden === true
    ? {...result,targetUuid:null} : result;
  const speaker = actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker();
  const audience=audienceMessage ? {whisper:[...(audienceMessage.whisper??[])],blind:!!audienceMessage.blind} : {};
  const messageData = {
    ...audience,
    speaker,
    flavor: `<strong>${safeText(label)}</strong><div class="fnri-roll-expression">${safeText(expression)}</div>${cardEffectLinks(sourceItem)}`,
    flags:{'fast-nri-v14':{...(sharedActionId?{compositeActionId:sharedActionId}:{}),
      ...(execution?.id?{abilityExecution:{executionId:execution.id,sourceItemUuid:sourceItem?.uuid??null,actorUuid:actor?.uuid??null}}:{}),
      ...(resultKind==='temporaryHp' && execution?.id ? {abilityResult:{version:1,kind:'temporaryHp',
        executionId:execution.id,sourceItemUuid:sourceItem?.uuid??null,actorUuid:actor?.uuid??null}}:{}),
      fixedRollComponents:fixedRollComponents(context,{redact:actor && !actor.hasPlayerOwner && ['public','ic'].includes(visibilityMode)}),
      checkRoll:{version:1,label:String(label),actorUuid:actor?.uuid??null,
      ...(standardActionId ? {standardActionId} : {}),
      ...(weaponTraitOptions(weaponItem).length?{
        weaponItemUuid:actor && actor.hasPlayerOwner!==true && ['public','ic'].includes(visibilityMode)
          ? null : weaponItem.uuid,
        weaponTraitIds:selectedWeaponTraitIds(context,weaponItem)}:{}),
      isIntervention:!!isIntervention,attackKind,targetDefense,selfDefenseRule,
      ...(chatResult ? {result:chatResult} : {}),
      rollInfluences:visibleRollInfluences(context,actor,visibilityMode)}}}
  };
  // toMessage(create:false) keeps native Roll serialization, while explicit
  // source audience is restored on creation instead of being overwritten by
  // the user's current roll-mode preference.
  const message=audienceMessage ? await ChatMessage.create({
    ...await roll.toMessage(messageData,{create:false,messageMode:'public'}),...audience
  }) : await roll.toMessage(messageData,{messageMode:visibilityMode});
  await finalizeRollEffects(context,message);
  await finishCardAccounting({actor,item:accountingItem??sourceItem,message,isIntervention,actionId:sharedActionId,execution});
  return {roll, message, result, targetResults};
}
