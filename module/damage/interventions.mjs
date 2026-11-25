import {canReadChatContent} from '../data/chat-visibility.mjs';
import {CHECK_DEFENSES, messageIntervention, DEFENSE_ABILITIES} from '../rolls/attack-properties.mjs';
import {finishCardAccounting,normalizedCardActionId} from '../data/ability-accounting.mjs';
import {chooseIntervention} from './intervention-menu.mjs';
import {standaloneIntervention,completeInterventionChoices} from './standalone-intervention.mjs';
import {declareAction,actionText} from '../rolls/action-declaration.mjs';
import {chatAudience} from '../data/chat-visibility.mjs';
import {chooseCoverAlly, coverAllyOption} from './cover-ally.mjs';
import {coverRecords, directedCoverCandidates, isCurrentDirectedCoverSource, sameCoverAudience, hasIntervened} from './cover-ally-state.mjs';
import {directedInterventionVariants} from '../data/intervention-variants.mjs';
/** Chainable intervention cards. All card-owned rules are read from Item data;
 * the only built-in game action is Rulebook Self-Defense.
 */
import {copy,selfDefenseOutcome,calculateDamage} from './damage-core.mjs';
import {BASE_SELF_DEFENSE} from '../data/core-actions.mjs';
import {chooseControlledToken,actorForToken} from './hp-actions.mjs';
import {matchesDefenseChange, resolveDefenseContext} from './defense-context.mjs';
import {counteractionFormula, initiateCounteraction} from './counteraction.mjs';
import {ATTACK_DEGREES} from '../rolls/attack-core.mjs';
import {prepareRoll,finalizeRollEffects,visibleRollInfluences,redactActorSourceForAudience} from '../rolls/roll-context.mjs';
const ID='fast-nri-v14';
const tr=k=>game.i18n.localize('FASTNRI.Damage.'+k);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const naturalD20=roll=>{const ds=(roll?.dice??[]).filter(d=>d.faces===20&&d.number===1);
  const n=ds.length===1?ds[0].results?.filter(r=>r.active!==false)?.[0]?.result:null;
  return Number.isInteger(n)&&n>=1&&n<=20?n:null;};

export function availableInterventions(actor, {card = null, tokenUuid = null, showAll = false} = {}) {
  if (card?.areaAttack?.version === 1) return [];
  const abilities=[...(actor?.items?.contents??actor?.items??[])].filter(i=>i.type==='ability' &&
    (i.system?.mechanics?.intervention || i.system?.mechanics?.selfDefense?.activation==='intervention' ||
      /(?:вмешательств|intervention)/i.test(String(i.system?.trigger??''))));
  const personal = !card?.originalTargetUuid || card.originalTargetUuid === tokenUuid;
  const opposed = CHECK_DEFENSES.includes(card?.targetDefense);
  const contextAvailable = !card?.cancelled;
  const base = [];
  if (!card || showAll || (contextAvailable && !opposed && personal)) {
    base.push({id:BASE_SELF_DEFENSE.id, name:game.i18n.localize('FASTNRI.'+BASE_SELF_DEFENSE.nameKey), builtin:true});
  }
  if (opposed && personal && !card.cancelled && ATTACK_DEGREES.includes(card.degree) &&
      Number.isFinite(card.attackTotal) && counteractionFormula(actor, card.targetDefense) &&
      (showAll || contextAvailable)) {
    base.push({id:'builtin:counteraction', name:tr('counteraction'), counteraction:true});
  }
  const variants = abilities.flatMap(item => directedInterventionVariants(item).flatMap(({id, label, rule}) => {
    const selfDefense = item.system?.mechanics?.selfDefense;
    const unsuitable=!!card&&(!contextAvailable || (rule?.requiresDefense && rule.requiresDefense !== (card.targetDefense ?? 'ac')) ||
      !matchesDefenseChange(rule, card.attackKind) ||
      (selfDefense?.activation === 'intervention' && !matchesDefenseChange(selfDefense, card.attackKind)) ||
      (rule?.targeting === 'self' && !personal));
    if(unsuitable&&!showAll)return [];
    return [{id:id ? `${item.id}:${id}` : item.id, variantId:id,
      name:label ? `${item.name} · ${label}` : item.name, item, rule, builtin:false,...(unsuitable?{independent:true}:{})}];
  }));
  return [...base, ...variants];
}

export function selfDefenseFormula(actor,attackKind,chosenStat=null) {
  const stat=chosenStat ?? (attackKind==='melee'?'fortitude':
    ['ranged','distance','throw'].includes(attackKind)?'reflex':null);
  if(!DEFENSE_ABILITIES.includes(stat))
    return {expression:null,warnings:[tr('unknownRange')],stat:null};
  const rawDefense=actor?.system?.defenses?.[stat];
  const defense=rawDefense===null || rawDefense==='' || rawDefense===undefined?NaN:Number(rawDefense);
  const bonus=Number.isFinite(defense)?defense:0;
  const die=String(actor?.system?.combatDie??'').trim().toLowerCase();
  const isNpc=actor?.type==='npc';
  const combat=/^(?:1)?d\d+$/.test(die) ? (die.startsWith('1')?die:'1'+die) : null;
  const attackMod=Number(actor?.system?.attackModifier);
  const expression=isNpc ? `1d20 + ${bonus} + ${Number.isFinite(attackMod)?attackMod:0}`:
    `1d20 + ${bonus}${combat?` + ${combat}`:''}`;
  const warnings=[];
  if(!Number.isFinite(defense))warnings.push(tr('missingDefense'));
  // A missing combat die already yields a valid 1d20 defense. No noisy warning:
  // an absent term is not a reason to interrupt a GM-approved roll.
  return {expression,warnings,stat};
}

async function chooseTie(parts) {
  if(parts.length===1)return parts[0];
  const opts=parts.map(p=>`<option value="${esc(p.id)}">${esc(p.formula)} · ${p.value}</option>`).join('');
  const fd=await foundry.applications.api.DialogV2.input({window:{title:tr('chooseRemoved')},
    content:`<select name="part">${opts}</select>`,ok:{label:tr('select')},rejectClose:false});
  return parts.find(p=>p.id===fd?.part)??null;
}

export async function initiateIntervention(message,{skipPreroll=false,actionId=null,accountingItem=null}={}) {
  if (!canReadChatContent(message)) return null;
  const card=message?.getFlag?.(ID,'weaponDamage');
  if(!card||card.version!==2)throw new Error('Intervention requires a component damage card');
  const pendingDice=card.parts?.some(p=>p.kind==='die'&&p.pending);
  if(pendingDice)ui.notifications?.warn(tr('unrolledDice'));
  const afterDefense = !!card.postDefenseOrigin || (messageIntervention(message) && !isCurrentDirectedCoverSource(message));
  if(afterDefense && !isCurrentDirectedCoverSource(message))ui.notifications?.warn(game.i18n.localize('FASTNRI.SheetActions.manualConsequences'));
  const token=await chooseControlledToken();if(!token)return null;
  const actor=actorForToken(token);
  if(!actor) {ui.notifications?.error(tr('missingTokenActor'));return null;}
  if (!(game.user.isGM || actor.isOwner || actor.canUserModify?.(game.user, 'update'))) {
    ui.notifications?.warn(tr('noPermission'));return null;
  }
  const standalone=choice=>standaloneIntervention(actor,null,{choice,source:capturedAudience,skipPreroll,actionId,accountingItem});
  const capturedAudience=chatAudience(message);
  const revision=card.revision??0;
  const answered = () => hasIntervened(message,actor);
  const candidates = () => directedCoverCandidates(game.messages?.get(message.id),token);
  const choices = showAll => {
    const cover=coverAllyOption(actor);
    const options=pendingDice || afterDefense || coverRecords(message).length ? [] :
      availableInterventions(actor, {card,tokenUuid:token.document?.uuid,showAll});
    if (cover && !pendingDice && isCurrentDirectedCoverSource(message) && (showAll || candidates().length)) options.push(cover);
    const full=showAll?completeInterventionChoices(actor,options):options;
    full.push({id:'standalone',name:actionText('standalone'),standalone:true});
    return full;
  };
  const selected = await chooseIntervention({actor, choices, title:tr('intervention'), repeated:answered});
  if (!selected) return null;
  if(selected.standalone)return standalone();
  if(selected.independent || (coverRecords(message).length && selected.kind!=='coverAlly'))return standalone(selected);
  if (selected.kind === 'coverAlly') return chooseCoverAlly({source:message,defender:token,candidates,repeatWarningShown:selected.repeatWarningShown,menuWarningsShown:selected.menuWarningsShown});
  if (selected.counteraction) return initiateCounteraction(message,{target:token,skipPreroll,repeatWarningShown:selected.repeatWarningShown,menuWarningsShown:selected.menuWarningsShown});
  if(answered()&&!selected.repeatWarningShown)ui.notifications?.warn(tr('repeatIntervention'));
  const rule=selected.rule;
  const isDefense=selected.builtin || rule?.effect?.kind==='directedDefense' ||
    selected.item?.system?.mechanics?.selfDefense?.activation==='intervention';
  // Invalid context must not change somebody else's attack. Execute the selected
  // option independently instead of simulating an applicable linked defense.
  if(card.cancelled || afterDefense || (isDefense && (CHECK_DEFENSES.includes(card.targetDefense) || (card.originalTargetUuid && card.originalTargetUuid!==token.document?.uuid))))return standalone(selected);
  let defenseContext=null;
  let chosenStat=null;
  if(isDefense) {
    defenseContext=resolveDefenseContext({attack:card,defender:actor,selectedItem:selected.item??null});
    chosenStat=defenseContext.stat;
    if(defenseContext.requiresChoice || !chosenStat) {
      const choices=defenseContext.options.map(stat=>`<option value="${esc(stat)}">${esc(tr('stat_'+stat))}</option>`).join('');
      const form=await foundry.applications.api.DialogV2.input({window:{title:tr('chooseDefense')},
        content:`<select name="defense">${choices}</select>`,ok:{label:tr('select')},rejectClose:false});
      if(!form || !defenseContext.options.includes(form.defense))return null;
      chosenStat=form.defense;
    }
  }
  const adapted=selected.builtin ? selfDefenseFormula(actor,card.attackKind,chosenStat) :
    {expression:String(rule?.rollFormula||selected.item?.system?.rollFormula||'').trim() ||
      (isDefense?selfDefenseFormula(actor,card.attackKind,chosenStat).expression:''),warnings:[]};
  // Card-owned penalty applies to CHECK-based defenses only, not to AC,
  // non-check defensive effects or arbitrary other rolls.
  const commonPenalty=isDefense && adapted.expression && Number.isFinite(card.defenseCheckModifier)
    ? card.defenseCheckModifier : 0;
  // Смертельное applies to the built-in Самозащита ONLY, and only
  // when the original attack degree is Great Success. A successful prior
  // directed defense does not rewrite the attack degree (only Effect degree).
  const greatSelfDefensePenalty=selected.builtin && card.degree==='great' &&
    Number.isFinite(card.greatSelfDefenseModifier) ? card.greatSelfDefenseModifier : 0;
  const defensePenalty=commonPenalty + greatSelfDefensePenalty;
  if(defensePenalty) adapted.expression=`(${adapted.expression}) + (${defensePenalty})`;
  const warnings=[...adapted.warnings];
  if(card.cancelled)warnings.push(tr('alreadyCancelled'));
  if(afterDefense && selected.builtin)warnings.push(tr('defenseVsIntervention'));
  if(selected.builtin && card.originalTargetUuid && token.document?.uuid!==card.originalTargetUuid)
    warnings.push(tr('selfDefenseOther'));
  if(selected.builtin && CHECK_DEFENSES.includes(card.targetDefense))warnings.push(tr('noAutomatedEffect'));
  if(!card.attackTotal && card.attackTotal!==0)warnings.push(tr('missingAttackTotal'));
  if(!selected.builtin && (!rule||!rule.effect) && !isDefense)warnings.push(tr('noAutomatedEffect'));
  if(warnings.length)ui.notifications?.warn(warnings.join(' · '));
  if(adapted.expression && typeof Roll.validate==='function' && !Roll.validate(adapted.expression)) {
    ui.notifications?.error(tr('invalidFormula'));return null;
  }
  // Share the same selection and ephemeral prepared Actor as other rolls.
  const context=adapted.expression?await prepareRoll({actor,kind:'intervention',
    defenseStat:chosenStat,formula:adapted.expression,skipDialog:skipPreroll,sourceItem:selected.item??null,
    label:selected.name,formulaForActor:selected.builtin?temp=>
      (defensePenalty ? `(${selfDefenseFormula(temp,card.attackKind,chosenStat).expression}) + (${defensePenalty})` :
        selfDefenseFormula(temp,card.attackKind,chosenStat).expression):null}):null;
  if(adapted.expression && context===null)return null;
  if(context?.expression && typeof Roll.validate==='function' && !Roll.validate(context.expression))
    throw Error('Invalid prepared intervention formula');
  const roll=context?.expression?await new Roll(context.expression,context.actor?.getRollData?.()??{}).evaluate():null;
  const stillLinked=()=>{const current=game.messages?.get?game.messages.get(message.id):message;return canReadChatContent(current)&&sameCoverAudience(current,capturedAudience)&&(current.getFlag(ID,'weaponDamage')?.revision??0)===revision&&!coverRecords(message).length;};
  const publishIndependent=()=>declareAction({actor,item:accountingItem??selected.item??null,label:selected.name,description:selected.item?.system?.description??'',source:capturedAudience,isIntervention:true,execution:rule,actionId,roll,context});
  if(!stillLinked())return publishIndependent();
  const next=copy(card);
  next.previousMessageId=message.id;
  next.isIntervention=true;
  // Copying a message audience also copies its responsibility to withhold
  // GM-only source UUIDs. A whisper to a player is not a GM-only whisper.
  const redactSource=redactActorSourceForAudience(actor,message);
  const visibleDefenseSource=redactSource && !['default','attack','unknown'].includes(defenseContext?.source)
    ? null : (defenseContext?.source??null);
  next.intervention={id:selected.id,name:selected.name,sourceUuid:redactSource?null:(selected.item?.uuid??null),
    ...(selected.variantId?{variantId:selected.variantId}:{}),
    initiatorActorUuid:actor.uuid,initiatorTokenUuid:token.document?.uuid??null,defenseStat:chosenStat,defenseSource:visibleDefenseSource,
    total:roll?.total??null,naturalD20:roll?naturalD20(roll):null,rollInfluences:visibleRollInfluences(context,actor,
      redactSource?'public':'gm')};
  next.revision=(next.revision??0)+1;
  next.history=[...(next.history??[])];
  let outcome=null;
  if(roll && isDefense && !CHECK_DEFENSES.includes(card.targetDefense)) {
    if(next.intervention.naturalD20===null||!Number.isFinite(roll.total))return publishIndependent();
    outcome=selfDefenseOutcome({card,defenseTotal:roll.total,naturalD20:next.intervention.naturalD20});
    if(outcome.success) {
      if(outcome.cancelled)next.cancelled=true;
      else if(outcome.choices.length) {
        const removed=await chooseTie(outcome.choices);
        if(!removed)return publishIndependent();
        const part=next.parts.find(p=>p.id===removed.id);
        if(part)part.excluded=true;
      }
      next.effectDegree=outcome.effectDegree;
    }
  }
  if(outcome) {
    next.intervention.success=outcome.success;
    next.intervention.damageReduction=Math.max(0,calculateDamage(card).total-calculateDamage(next).total);
  }
  next.history.push({by:game.user.id,at:Date.now(),action:'intervention',source:selected.id,name:selected.name,
    initiator:actor.uuid,defenseStat:chosenStat,defenseSource:visibleDefenseSource,
    checkTotal:roll?.total??null,success:outcome?.success??null,
    cancelled:outcome?.cancelled??false});
  const sharedActionId=normalizedCardActionId(actionId);
  const chatData={speaker:ChatMessage.getSpeaker({actor,token:token.document}),
    content:`<strong>${esc(selected.name)}</strong> · ${esc(token.name)}`,
    whisper:Array.isArray(message.whisper)?[...message.whisper]:[],
    blind:message.blind===true,
    flags:{[ID]:{weaponDamage:next,
      ...(sharedActionId?{compositeActionId:sharedActionId}:{})}}};
  if(roll)chatData.rolls=[roll.toJSON()];
  if (!stillLinked()) return publishIndependent();
  const created=await ChatMessage.create(chatData);
  await finalizeRollEffects(context,created);
  await finishCardAccounting({actor,item:accountingItem??selected.item??null,message:created,
    isIntervention:true,actionId:sharedActionId,execution:rule});
  return created;
}
