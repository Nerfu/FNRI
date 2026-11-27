import {protectiveCombatDice} from '../rolls/roll-contributions.mjs';
import {interventionWarnings} from '../data/intervention-availability.mjs';
import {declareAction,canExecuteAction} from '../rolls/action-declaration.mjs';
import {standaloneIntervention} from './standalone-intervention.mjs';
import {chatAudience,canReadChatContent} from '../data/chat-visibility.mjs';
import {sameCoverAudience,hasIntervened} from './cover-ally-state.mjs';
import {finishCardAccounting} from '../data/ability-accounting.mjs';
import {naturalAttackingD20, ATTACK_DEGREES, resolveDirectedEffectDegree} from '../rolls/attack-core.mjs';
import {CHECK_DEFENSES, messageIntervention} from '../rolls/attack-properties.mjs';
import {prepareRoll, finalizeRollEffects, defenseConditionSummary} from '../rolls/roll-context.mjs';
import {counteractionOutcome} from './damage-core.mjs';

const SCOPE = 'fast-nri-v14';

export function counteractionFormula(actor, stat, {allowMissingDefense=false}={}) {
  if (!CHECK_DEFENSES.includes(stat)) return null;
  const raw = actor?.system?.defenses?.[stat];
  if (!Number.isFinite(raw) && !allowMissingDefense) return null;
  const value=Number.isFinite(raw)?raw:0;
  const die = String(actor.system?.combatDie ?? '').trim();
  const combat = /^(?:1)?d[1-9]\d*$/i.test(die) ? (die.startsWith('1') ? die : '1'+die) : '';
  const npc = actor.type === 'npc' && Number.isFinite(actor.system?.attackModifier)
    ? actor.system.attackModifier : 0;
  return `1d20 + (${value})${combat ? ' + '+protectiveCombatDice(actor,combat) : npc ? ` + (${npc})` : ''}`;
}

/** One target, one current result. The caller supplies that target explicitly. */
export async function initiateCounteraction(message, {target,skipPreroll=false,repeatWarningShown=false,menuWarningsShown=false} = {}) {
  const actor = target?.documentName === 'Actor' ? target : target?.actor;
  if(actor?.documentName!=='Actor'||!canExecuteAction(actor))return null;
  const current = game.messages?.get ? game.messages.get(message?.id) : message;
  if((current&&!canReadChatContent(current))||(!current&&message&&!canReadChatContent(message)))return null;
  const visible=current&&canReadChatContent(current);
  const original=visible?current:message;
  const damage=original?.getFlag?.(SCOPE,'weaponDamage');
  const check=original?.getFlag?.(SCOPE,'checkRoll');
  const stat=damage?.targetDefense??check?.targetDefense;
  const capturedAudience=original?chatAudience(original):null;
  const independent=()=>standaloneIntervention(actor,'counteraction',{choice:{id:'counteraction',counteraction:true,menuWarningsShown},stat,source:capturedAudience,skipPreroll,defenseToken:target?.documentName==='Actor'?null:target});
  const continuation=m=>!!(m?.getFlag?.(SCOPE,'weaponDamage')?.previousMessageId || m?.getFlag?.(SCOPE,'checkRoll')?.previousMessageId);
  if(!visible||(messageIntervention(current)&&!continuation(current))||!CHECK_DEFENSES.includes(stat)||!(damage?.version===2||check?.result))return independent();
  const targetUuid=damage?.originalTargetUuid??check?.result?.targetUuid;
  if(!targetUuid)return independent();
  const token=await fromUuid(targetUuid);
  if(token?.actor?.uuid!==actor.uuid || (target?.documentName!=='Actor' && (target?.document??target)?.uuid!==targetUuid))return independent();
  if(damage?.cancelled||damage?.parts?.some(part=>part.pending))return independent();
  const degree=damage?.degree??check?.result?.degree;
  const total=damage?.attackTotal??current.getFlag(SCOPE,'rollEdit')?.currentTotal??check?.result?.total;
  if(!ATTACK_DEGREES.includes(degree)||!Number.isFinite(total))return independent();
  const revision=damage?.revision??0;
  const formulaForActor=prepared=>counteractionFormula(prepared,stat);
  const formula=formulaForActor(actor);
  if(!formula)return independent();
  if(hasIntervened(current,actor)&&!repeatWarningShown)ui.notifications?.warn(game.i18n.localize('FASTNRI.Damage.repeatIntervention'));
  if(!menuWarningsShown){const warnings=interventionWarnings(actor);if(warnings.length)ui.notifications?.warn(warnings.join(' · '));}
  const label = game.i18n.localize('FASTNRI.Damage.counteraction');
  const context = await prepareRoll({actor,kind:'intervention',defenseStat:stat,formula,
    formulaForActor,skipDialog:skipPreroll,label,defenseToken:token,usesDefenseStat:true,attackOffGuard:damage?.attackOffGuard===true});
  if (!context) return null;
  const roll = await new Roll(context.expression,context.actor?.getRollData?.() ?? {}).evaluate();
  const natural = naturalAttackingD20(roll);
  const publishIndependent=()=>declareAction({actor,label,source:capturedAudience,isIntervention:true,roll,context});
  if(natural===null)return publishIndependent();

  const latest=game.messages?.get?game.messages.get(current.id):current;
  if (!canReadChatContent(latest) || !sameCoverAudience(latest,capturedAudience) || (messageIntervention(latest)&&!continuation(latest)) ||
      (damage && (latest.getFlag(SCOPE,'weaponDamage')?.revision ?? 0) !== revision) ||
      (!damage && ((latest.getFlag(SCOPE,'rollEdit')?.currentTotal ?? latest.getFlag(SCOPE,'checkRoll')?.result?.total) !== total || latest.getFlag(SCOPE,'checkRoll')?.result?.targetUuid!==targetUuid || latest.getFlag(SCOPE,'checkRoll')?.result?.degree!==degree))) return publishIndependent();

  const success = natural !== 1 && (natural === 20 || roll.total >= total);
  const resolved = success ? resolveDirectedEffectDegree({
    attackDegree:degree,successfulDefenses:1,fullyCancelled:natural === 20
  }).effectDegree : degree;
  const details = {id:'builtin:counteraction',name:label,initiatorActorUuid:actor.uuid,degree:resolved,total:roll.total,
    naturalD20:natural,success};
  let flags;
  if (damage) {
    const origin = game.messages?.get(damage.attackMessageId);
    const profile = damage.profile ?? (canReadChatContent(origin) ? origin.getFlag(SCOPE,'weaponAttack')?.profile : null);
    let next;
    try {({next}=counteractionOutcome({card:{...damage,profile},defenseTotal:roll.total,naturalD20:natural}));}
    catch(error){
      // A legacy/incomplete damage profile is not a reason to lose the roll.
      ui.notifications?.warn(game.i18n.localize('FASTNRI.SheetActions.manualConsequences'));
      return publishIndependent();
    }
    next.previousMessageId = current.id;
    next.isIntervention = true;
    next.revision = (damage.revision ?? 0)+1;
    next.intervention = details;
    next.history = [...(next.history ?? []),{action:'intervention',source:details.id,
      by:game.user.id,at:Date.now(),name:label,checkTotal:roll.total,success,cancelled:next.cancelled}];
    flags = {weaponDamage:next};
  } else {
    flags = {checkRoll:{version:1,label,isIntervention:true,actorUuid:actor.uuid,targetDefense:stat,
      ...(check.standardActionId ? {standardActionId:check.standardActionId} : {}),
      previousMessageId:current.id,result:{...check.result,degree:resolved,total}}};
  }
  const data = await roll.toMessage({speaker:ChatMessage.getSpeaker({actor}),
    flavor:label+defenseConditionSummary(context),flags:{[SCOPE]:flags}}, {create:false});
  data.whisper = [...(current.whisper ?? [])];
  data.blind = current.blind === true;
  const finalSource=game.messages?.get?game.messages.get(current.id):current;
  if(!canReadChatContent(finalSource)||!sameCoverAudience(finalSource,capturedAudience))return publishIndependent();
  const created = await ChatMessage.create(data);
  await finalizeRollEffects(context,created);
  await finishCardAccounting({actor,message:created,isIntervention:true});
  return created;
}
