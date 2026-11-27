/** One immutable area result and independent, append-only intervention reports.
 * No updateChatMessage calls; published rolls and result cards never change.
 */
import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {postDefenseChoices,publishPostDefenseDamage} from './post-defense-damage.mjs';
import {selectAreaDamageParts} from './area-damage-profile.mjs';
import {ATTACK_DEGREES,resolveAttackDegree,resolveCheckDegree,naturalAttackingD20,ferocityDamageApplies} from '../rolls/attack-core.mjs';
import {CHECK_DEFENSES, messageIntervention} from '../rolls/attack-properties.mjs';
import {prepareRoll,finalizeRollEffects,redactActorSourceForAudience,defenseConditionSummary} from '../rolls/roll-context.mjs';
import {counteractionFormula} from './counteraction.mjs';
import {areaInterventionChoices} from './area-card-interventions.mjs';
import {publishWithFollowUpOffers,availableAreaFollowUps,applyAreaFollowUp} from './area-follow-ups.mjs';
import {publishAreaUse} from '../data/ability-accounting.mjs';
import {chooseIntervention} from './intervention-menu.mjs';
import {standaloneIntervention,completeInterventionChoices} from './standalone-intervention.mjs';
import {declareAction,actionText} from '../rolls/action-declaration.mjs';
import {chooseCoverAlly, coverAllyOption} from './cover-ally.mjs';
import {
  applyCoverExclusions, coverActorKey, coverRecipients, coverRecords, coverScope, hasDamageForCoverTarget, sameCoverAudience, hasIntervened, interventionActorKey
} from './cover-ally-state.mjs';
import {applyHp,actorForToken,chooseControlledToken} from './hp-actions.mjs';
import {calculateDamage, coverAllyDice} from './damage-core.mjs';
import {previewDeclaredDamageDefenses} from './periodic-damage.mjs';
import {attackOutcomeForDamageCard} from '../equipment/attack-outcomes.mjs';
import {applyAttackOutcomeEffects} from '../equipment/attack-outcome-application.mjs';
const ID='fast-nri-v14';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const DEGREE_NAMES={failure:'Провал',partial:'Частичный успех',success:'Успех',great:'Большой успех'};
const active=m=>game.messages?.get(m?.id)??null;
const canWrite=a=>!!a && (game.user?.isGM||a.isOwner||a.canUserModify?.(game.user,'update')===true);
const records=()=>Array.from(game.messages?.contents??[]);
const orderedInterventions=entries=>[...entries].sort((a,b)=>
  (Number(a.timestamp??0)-Number(b.timestamp??0))||String(a.id).localeCompare(String(b.id)));
const canRead=m=>!!m&&canReadChatContent(m);
const hiddenTarget=uuid=>!!uuid && foundry.utils.fromUuidSync(uuid)?.hidden===true;
function interventionsFor(root){
  const audience=chatAudience(root);
  const linked=orderedInterventions(records().filter(message=>{
    const record=message.getFlag?.(ID,'areaIntervention');
    if(record?.version!==1 || record.rootMessageId!==root.id || !canReadChatContent(message))return false;
    // Never copy a narrower whisper into a new result for a wider audience.
    const original=chatAudience(message);
    return original.blind===audience.blind && original.whisper.length===audience.whisper.length &&
      original.whisper.every(id=>audience.whisper.includes(id));
  }));
  const parents=new Map(linked.map(message=>[message.id,message.getFlag(ID,'areaIntervention')]));
  return linked.filter(message=>{
    const record=parents.get(message.id);
    if (record.kindKey!=='followUp') return true;
    const parent=parents.get(record.parentMessageId);
    return parent?.success===true && parent.kindKey!=='followUp' && parent.targetKey===record.targetKey &&
      Number.isInteger(record.degreeReduction) && record.degreeReduction>=1 && record.degreeReduction<=3;
  });
}
const parts=card=>(card.parts??[]).filter(p=>!p.pending&&!p.excluded&&!p.immune&&Number.isFinite(p.value));
function profileFor(card,degree,{actor=null,covers=[],targetUuid=null,choices=[]}={}){
  if(card.areaAttack?.damageProfileInvalid===true)
    return {degree,damage:null,profileComplete:false,profileReason:'invalid-card-area-profile',
      includedPartIds:[],excludedPartIds:[]};
  // A targeted augmentation is part of the one shared roll, but only of
  // the chosen recipient's damage. Unassigned additions remain manual.
  const valid=parts(card).filter(p=>p.value>=0&&(!p.singleTarget||p.targetUuid&&p.targetUuid===targetUuid)&&
    (!p.ferocityDamage||ferocityDamageApplies(degree)));
  // Immunity removes parts before a defense or profile can choose a die.
  // The profile still describes the size of the original shared damage pool.
  const fullDefenses=actor?previewDeclaredDamageDefenses(actor,card):null;
  // The canon defines default area profiles only for two or three dice.
  // Full success and failure are unambiguous; do not invent removal steps
  // for an expanded pool in intermediate degrees without a card profile.
  const extra=valid.some(p=>p.singleTarget||p.ferocityDamage);
  const explicit=card.areaAttack?.damageProfile??null;
  const expanded=extra&&!explicit&&valid.length>3;
  const immune=new Set(fullDefenses?.immunePartIds??[]);
  const selection=expanded&&['great','failure'].includes(degree)?{ok:true,
    includedPartIds:degree==='great'?valid.filter(p=>!immune.has(p.id)).map(p=>p.id):[],
    excludedPartIds:degree==='failure'?valid.filter(p=>!immune.has(p.id)).map(p=>p.id):[]}:
    selectAreaDamageParts(valid,degree,explicit,{immunePartIds:fullDefenses?.immunePartIds,choices});
  if(!selection.ok)return {degree,damage:null,profileComplete:false,
    profileReason:selection.reason,includedPartIds:[],excludedPartIds:[],decisions:selection.decisions??[]};
  const ids=new Set(selection.includedPartIds);
  const masked=applyCoverExclusions({...card,parts:card.parts.map(p=>({...p,
    excluded:p.excluded||!ids.has(p.id)}))},covers);
  if (!masked) return {degree,damage:null,profileComplete:false,profileReason:'cover-changed'};
  // The shared dice are never rerolled. Read only explicitly declared
  // defenses of THIS recipient, not a defense guessed from a spell name.
  const defenses=actor?previewDeclaredDamageDefenses(actor,masked):null;
  if(defenses?.complete){
    masked.adjustments={...(card.adjustments??{}),
      resistance:Math.max(Number(card.adjustments?.resistance)||0,defenses.resistance),
      vulnerability:Math.max(Number(card.adjustments?.vulnerability)||0,defenses.vulnerability)};
  }
  return {degree,damage:calculateDamage(masked).total,card:masked,
    defenseComplete:defenses?.complete??null,defensesApplied:defenses?.complete===true,
    profileComplete:true,includedPartIds:selection.includedPartIds,
    excludedPartIds:selection.excludedPartIds,decisions:selection.decisions??[]};
}

function rootId(message){
  const direct=message?.getFlag?.(ID,'weaponDamage');
  if(direct?.areaAttack?.version===1)return direct.areaRootMessageId??message.id;
  return message?.getFlag?.(ID,'areaIntervention')?.rootMessageId??
    message?.getFlag?.(ID,'areaResult')?.rootMessageId??null;
}
function baseOf(root){
  const card=root?.getFlag?.(ID,'weaponDamage');
  if(card?.areaAttack?.version!==1)return null;
  return {card,area:card.areaAttack};
}

/** Explicit profile decisions belong to a recipient, degree and shared roll revision.
 * Publish them in the existing area-result message, never edit another user's roll. */
const profileKey=(uuid,degree)=>JSON.stringify([uuid,degree]);
function areaProfileChoices(root){
  const revision=baseOf(root)?.card.revision??0, choices=new Map();
  const linked=orderedInterventions(records().filter(m=>canRead(m)&&sameCoverAudience(m,root)&&
    m.getFlag?.(ID,'areaResult')?.rootMessageId===root.id));
  for(const message of linked)for(const row of message.getFlag(ID,'areaResult').results){
    if(row.profileRevision===revision&&Array.isArray(row.profileChoices))
      choices.set(profileKey(row.tokenUuid,row.degree),row.profileChoices);
  }
  return choices;
}
function recipientProfile(root,degree,options={},selections=areaProfileChoices(root)){
  return profileFor(baseOf(root).card,degree,{...options,choices:selections.get(profileKey(options.targetUuid,degree))??[]});
}

export function liveAreaRows(root) {
  return resolveAreaResults(root,interventionsFor(root).map(message=>message.getFlag(ID,'areaIntervention')));
}

function areaAnswered(root, token) {
  return hasIntervened(root,actorForToken(token));
}

const sameAreaCoverSource = (message,root) => sameCoverAudience(message,root) && !messageIntervention(root);

/** Reconstruct only the existing ally's target profile, omitting its own
 * transfer record. No new intervention, adjacency check or resource spend. */
export function areaCoverSnapshot(message,ally,{omitMessageId=null}={}){
  const root=game.messages?.get(rootId(message)),base=baseOf(root);
  if(!canRead(message)||!canRead(root)||!sameAreaCoverSource(message,root)||!base||base.card.cancelled||base.card.parts.some(p=>p.pending))return null;
  const uuid=ally.document?.uuid??ally.uuid;
  const degree=liveAreaRows(root)?.find(row=>row.tokenUuid===uuid)?.degree;
  const covers=coverRecords(root,uuid).filter(r=>r.messageId!==omitMessageId);
  if(!degree||covers.some(r=>r.allyKey!==coverActorKey(ally.actor)||r.sourceRevision!==(base.card.revision??0)))return null;
  return recipientProfile(root,degree,{actor:ally.actor,covers,targetUuid:uuid}).card??null;
}

export function areaCoverCandidates(message, defender) {
  const root=game.messages?.get(rootId(message));
  const base=baseOf(root);
  if (!canRead(message) || !canRead(root) || !sameAreaCoverSource(message,root) ||
      !base || base.card.cancelled || base.card.parts.some(part=>part.pending)) return [];
  const interventions = interventionsFor(root);
  const rows = resolveAreaResults(root,interventions.map(message => message.getFlag(ID,'areaIntervention')));
  return coverRecipients(defender,base.area.targets.map(target=>target.uuid)).flatMap(ally=>{
    if (hasDamageForCoverTarget(root,ally)) return [];
    const degree=rows.find(row=>row.tokenUuid===ally.document.uuid)?.degree;
    const covers=coverRecords(root,ally.document.uuid);
    if (!degree || covers.some(cover=>cover.allyKey!==coverActorKey(ally.actor) ||
      cover.sourceRevision!==(base.card.revision??0))) return [];
    const profile=recipientProfile(root,degree,{actor:ally.actor,covers,targetUuid:ally.document.uuid});
    return profile.damage>0 && coverAllyDice(profile.card).length ? [{ally,card:profile.card}] : [];
  });
}

// Public snapshots contain degrees, not the target's private thresholds.
// A changed shared check cannot safely reuse those degrees or infer them
// from the target's current (possibly changed) statistics.
export function areaCheckState(root){
  const base=baseOf(root);
  if(!base)return null;
  const {card,area}=base;
  const correction=root.getFlag(ID,'rollEditNative0');
  const originalTotal=card.originalAttackTotal??root.rolls?.[0]?.total??area.attackTotal;
  const total=correction?.currentTotal??area.attackTotal;
  const changedD20=(correction?.components??[]).some(p=>p.kind==='die'&&p.faces===20&&
    (p.added||p.excluded||p.value!==p.original));
  return {total,changed:total!==originalTotal||changedD20};
}

export function resolveAreaResults(root,interventions=[]){
  const base=baseOf(root);
  if(!base)return null;
  const {card,area}=base;
  const check=areaCheckState(root), selections=areaProfileChoices(root);
  return area.targets.map(t=>{
    // New snapshots retain only a degree, not private target AC/defense
    // values. A legacy work-in-progress snapshot may still hold thresholds.
    const calculation=t.status==='one' && !ATTACK_DEGREES.includes(t.initialDegree) ?
      (CHECK_DEFENSES.includes(card.targetDefense)?resolveCheckDegree({total:area.attackTotal,naturalD20:area.naturalD20,difficulty:t.difficulty}):
        resolveAttackDegree({total:area.attackTotal,naturalD20:area.naturalD20,ac:t.ac})) : null;
    let degree=ATTACK_DEGREES.includes(t.initialDegree)?t.initialDegree:
      (calculation?.ok?calculation.degree:null);
    const related=interventions.filter(r=>r.targetKey===t.key);
    if(check.changed || related.some(r=>r.attackCheckTotal!=null&&r.attackCheckTotal!==check.total))degree=null;
    for(const intervention of related){
      if(!degree||!intervention.success)continue;
      if(intervention.naturalD20===20 && intervention.naturalTwentyCancels!==false){degree='failure';continue;}
      const offset=['card','followUp','degreeReduction'].includes(intervention.kindKey) ?
        (Number.isInteger(intervention.degreeReduction)?intervention.degreeReduction:1) :
        (intervention.safe===true?2:1);
      degree=ATTACK_DEGREES[Math.max(0,ATTACK_DEGREES.indexOf(degree)-offset)];
    }
    const profile=degree?recipientProfile(root,degree,{targetUuid:t.uuid},selections):null;
    return {key:t.key,name:t.name,tokenUuid:t.uuid,initial:ATTACK_DEGREES.includes(t.initialDegree)?t.initialDegree:
      (calculation?.ok?calculation.degree:null),
      degree,damage:profile?.damage??null,profileComplete:profile?.profileComplete!==false,
      includedPartIds:profile?.includedPartIds??[],
      excludedPartIds:profile?.excludedPartIds??[],
      ...(profile?.profileComplete===false?{profileReason:profile.profileReason}:{}),
      interventions:related.length};
  });
}
async function targetToken(){
  return chooseControlledToken();
}
export async function rollAreaIntervention(message,{skipPreroll=false}={}){
  const source=active(message);
  if(!source||!canReadChatContent(source))return null;
  const id=rootId(source),root=game.messages?.get(id),base=baseOf(root);
  const token=await targetToken(),actor=actorForToken(token);
  if(!actor||!canWrite(actor))return null;
  const capturedAudience=chatAudience(source);
  const standalone=choice=>standaloneIntervention(actor,null,{choice,source:capturedAudience,skipPreroll,defenseToken:token});
  if(!base||!canReadChatContent(root)||!sameCoverAudience(root,capturedAudience))return standalone();
  const areaTarget = recipient => base.area.targets.find(target =>
    target.uuid===recipient.document?.uuid && recipient.document?.hidden!==true);
  const targeted = () => [...(game.user?.targets??[])].filter(areaTarget);
  const choices = showAll => {
    const selected = targeted();
    const options=areaInterventionChoices(actor,{targetDefense:base.card.targetDefense,showAll,
      canProtectSelf:!!areaTarget(token) && !coverRecords(root,token.document.uuid).length,
      canProtectAlly:selected.length===1 && !coverRecords(root,selected[0].document.uuid).length ||
        (selected.length===0 && !!areaTarget(token) && !coverRecords(root,token.document.uuid).length)
    });
    const cover=coverAllyOption(actor);
    if (cover && sameAreaCoverSource(source,root) && (showAll || areaCoverCandidates(source,token).length)) options.push(cover);
    const full=showAll?completeInterventionChoices(actor,options):options;
    full.push({key:'standalone',label:actionText('standalone'),standalone:true});
    return full;
  };
  const chosen = await chooseIntervention({actor, choices,
    title:game.i18n.localize('FASTNRI.Damage.intervention'), repeated:()=>areaAnswered(root,token)});
  if (!chosen) return null;
  if(chosen.standalone)return standalone();
  if(chosen.independent)return standalone(chosen);
  if (chosen.kind==='coverAlly') return chooseCoverAlly({source:root,defender:token,
    candidates:()=>areaCoverCandidates(active(source),token),repeatWarningShown:chosen.repeatWarningShown,menuWarningsShown:chosen.menuWarningsShown});
  let protectedToken=token;
  if(chosen.mayProtectAlly){
    const selected=targeted();
    // A protective technique may still protect its own user. The original
    // controlled token remains the default; an explicitly targeted SINGLE
    // participant replaces it. Do not infer among multiple targets.
    if(selected.length>1){
      ui.notifications?.warn('Выберите не более одной защищаемой цели.');
      return standalone(chosen);
    }
    if(selected.length===1)protectedToken=selected[0];
  }
  const target=areaTarget(protectedToken);
  if(!target){ui.notifications?.warn('Защищаемый токен не входит в объявленные цели.');return standalone(chosen);}
  if(coverRecords(root,target.uuid).length)return standalone(chosen);
  if(areaAnswered(root,token)&&!chosen.repeatWarningShown)ui.notifications?.warn(game.i18n.localize('FASTNRI.Damage.repeatIntervention'));
  const kind=chosen.kind==='dodge'?'Уворот':
    chosen.kind==='counteraction'?'Противодействие':chosen.label;
  const movement=chosen.movement;
  const stat=chosen.stat;
  const formulaForActor=a=>chosen.formula??counteractionFormula(a,stat);
  const formula=formulaForActor(actor);
  if(!formula){ui.notifications?.warn('Не определена формула Защиты.');return standalone(chosen);}
  const context=await prepareRoll({actor,kind:'intervention',defenseStat:stat,defenseToken:token,usesDefenseStat:!chosen.formula,attackOffGuard:base.area.targets.some(t=>t.uuid===token.document?.uuid&&t.attackOffGuard===true),formula,
    formulaForActor,sourceItem:chosen.item,skipDialog:skipPreroll,label:kind});
  if(!context)return null;
  const roll=await new Roll(context.expression,context.actor?.getRollData?.()??{}).evaluate();
  const naturalD20=naturalAttackingD20(roll);
  const publishIndependent=()=>declareAction({actor,item:chosen.item,label:kind,source:capturedAudience,isIntervention:true,execution:{accounting:chosen.accounting},roll,context});
  if(naturalD20===null) {ui.notifications?.warn('Не определён результат d20 Вмешательства.');return publishIndependent();}
  const attackCheckTotal=areaCheckState(root).total;
  const success=naturalD20===20 || (naturalD20!==1&&roll.total>=attackCheckTotal);
  // Movement and safe destination are player/GM decisions; a checkbox records the result.
  let safe=false;
  if(chosen.kind==='dodge'&&success&&naturalD20!==20){
    const answer=await foundry.applications.api.DialogV2.input({window:{title:'Результат Уворота'},
      content:'<label><input type="checkbox" name="safe" value="yes"> Достигнуто безопасное место (движение выполнено вручную)</label>',
      ok:{label:'Опубликовать'},rejectClose:false});
    if(!answer)return publishIndependent();
    safe=answer.safe==='yes'||answer.safe===true;
  }
  const knockedDown=chosen.kind==='dodge'&&(naturalD20===1||movement==='leap');
  const record={version:1,rootMessageId:id,targetKey:target.key,targetName:target.name,kind,
    kindKey:chosen.kind,degreeReduction:chosen.reduction,
    naturalTwentyCancels:chosen.naturalTwentyCancels,
    success,safe,attackCheckTotal,
    ...(chosen.kind==='dodge'?{movement,knockedDown}:{}),naturalD20,total:roll.total};
  // Movement and the native condition remain under participant control; the
  // complete decision is visible in this self-contained intervention message.
  const notice=chosen.kind==='dodge' ?
    (naturalD20===1?' · '+game.i18n.localize('FASTNRI.AreaIntervention.naturalOne'):
    (movement==='leap'?' · '+game.i18n.localize('FASTNRI.AreaIntervention.leap'):
      ' · '+game.i18n.localize('FASTNRI.AreaIntervention.step')))+
    (success&&naturalD20!==20?' · '+game.i18n.localize(
      safe?'FASTNRI.AreaIntervention.safe':'FASTNRI.AreaIntervention.inside'):'') : '';
  const draft=await roll.toMessage({
    flavor:`${esc(kind)} · ${esc(target.name)} — ${success?'Успех':'Провал'}${esc(notice)}${esc(defenseConditionSummary(context))}`
  },{create:false,messageMode:'public'});
  // The preroll/choice may have been open while someone deleted the attack.
  // If the linked calculation is stale, publish the already evaluated Roll
  // as a standalone action below; never fabricate a target or reroll.
  function publishDefense(messageId) {
    const latestRoot=game.messages?.get(id);
    if(!canRead(latestRoot)||!sameCoverAudience(latestRoot,capturedAudience)||(latestRoot.getFlag(ID,'weaponDamage')?.revision??0)!==(base.card.revision??0)){
      ui.notifications?.warn('Исходное сообщение атаки отсутствует.');
      return null;
    }
    const performer=foundry.utils.fromUuidSync(token.document.uuid);
    const recipient=foundry.utils.fromUuidSync(target.key);
    if(!recipient || recipient.hidden || performer?.actor?.uuid!==actor.uuid || !canWrite(actor) ||
        coverRecords(latestRoot,target.uuid).length)return null;
    const redactSource=performer.hidden || redactActorSourceForAudience(actor,latestRoot);
    if(!redactSource)Object.assign(record,{actorUuid:actor.uuid,tokenUuid:performer.uuid});
    else record.initiatorKey=interventionActorKey(root,actor);
    draft.speaker=redactSource?{alias:'Fast NRI'}:ChatMessage.getSpeaker({actor,token:performer});
    draft.flags={[ID]:{areaIntervention:record}};
    Object.assign(draft,chatAudience(latestRoot));
    if(messageId)draft._id=messageId;
    return ChatMessage.create(draft,{keepId:!!messageId});
  }
  const created=await publishAreaUse({actor,item:chosen.item,execution:{accounting:chosen.accounting},
    publish:messageId=>publishWithFollowUpOffers({actor,token,record,messageId,publish:publishDefense})});
  if(created){await finalizeRollEffects(context,created);return created;}
  return publishIndependent();
}
const snapshotOf=m=>m?.getFlag?.(ID,'areaResult');
/** The button on ANY intervention gathers ALL currently existing linked rolls. */
export async function applyAreaInterventions(message){
  const current=active(message);
  if(!current||!canReadChatContent(current))return null;
  const id=rootId(current),root=game.messages?.get(id);
  if(!root||!canReadChatContent(root)||!baseOf(root)){
    ui.notifications?.warn('Исходное сообщение атаки отсутствует.');
    return null;
  }
  const linked=interventionsFor(root).filter(message=>
    !hiddenTarget(message.getFlag(ID,'areaIntervention').targetKey));
  const entries=linked.map(m=>({...m.getFlag(ID,'areaIntervention'),messageId:m.id}));
  const results=resolveAreaResults(root,entries).filter(result=>!hiddenTarget(result.tokenUuid));
  const ids=linked.map(m=>m.id).sort();
  const data={version:1,rootMessageId:id,interventionIds:ids,results};
  return ChatMessage.create({speaker:baseOf(root).card.areaOutcomeRedacted?{alias:'Fast NRI'}:root.speaker,
    content:`<strong>${esc(baseOf(root).card.name)}</strong> · ${entries.some(entry=>entry.kindKey==='degreeReduction')?esc(game.i18n.localize('FASTNRI.DegreeReduction.result')):'результат с учётом Вмешательств'}`,
    ...chatAudience(root),flags:{[ID]:{areaResult:data}}});
}
function resultsFor(message){
  const current=active(message),id=rootId(current),root=game.messages?.get(id);
  if(!current||!root||!canReadChatContent(current)||!canReadChatContent(root)||!sameCoverAudience(current,root))return null;
  const result=snapshotOf(current);
  if(result?.version!==1||areaCheckState(root)?.changed)return {root,rows:resolveAreaResults(root,[])};
  const selections=areaProfileChoices(root);
  return {root,rows:result.results.map(row=>{
    const choices=selections.get(profileKey(row.tokenUuid,row.degree))??[];
    if(!row.degree||!choices.length&&!Array.isArray(row.profileChoices))return row;
    const profile=recipientProfile(root,row.degree,{targetUuid:row.tokenUuid},selections);
    return {...row,damage:profile.damage,profileComplete:profile.profileComplete,
      includedPartIds:profile.includedPartIds,excludedPartIds:profile.excludedPartIds,profileReason:profile.profileReason??null};
  })};
}
/** Independent HP application can use a published amount even if its source
 * was removed or the check changed; this is not automatic linked damage. */
export function areaResultRows(message){
  const current=active(message);if(!canRead(current))return null;
  const stored=snapshotOf(current)?.results,resolved=resultsFor(current);
  return stored&&(!resolved||areaCheckState(resolved.root)?.changed)?stored:resolved?.rows??null;
}
export function areaComponentChoices(message){
  // Profile correction is a GM tool, not a player-side ability choice.
  if(!game.user?.isGM)return [];
  if(!message?.getFlag?.(ID,'weaponDamage')?.areaAttack&&!snapshotOf(message))return [];
  const resolved=resultsFor(message);if(!resolved||areaCheckState(resolved.root)?.changed)return [];
  const {root,rows}=resolved,card=baseOf(root).card;
  if(card.cancelled||card.parts.some(p=>p.pending))return [];
  const controlled=globalThis.canvas?.tokens?.controlled??[], selections=areaProfileChoices(root);
  return rows.flatMap(row=>{
    const token=controlled.find(t=>t.document?.uuid===row.tokenUuid&&t.document?.hidden!==true);
    const actor=actorForToken(token);
    if(!row.degree||!canWrite(actor))return [];
    const options={targetUuid:row.tokenUuid,actor}, profile=recipientProfile(root,row.degree,options,selections);
    const previous=selections.get(profileKey(row.tokenUuid,row.degree))??[];
    const covers=coverRecords(root,row.tokenUuid);
    return (profile.decisions??[]).flatMap(decision=>{
      const candidates=decision.candidates.filter(id=>id!==decision.currentId).flatMap(id=>{
        const choices=previous.slice(0,decision.stepIndex);choices[decision.stepIndex]=id;
        const next=profileFor(card,row.degree,{...options,choices});
        // Do not silently invalidate an existing transfer. The receipt can
        // still be edited through its own existing component-choice command.
        if(covers.length&&(!next.card||!applyCoverExclusions(next.card,covers)))return [];
        const p=card.parts.find(p=>p.id===id);
        return [{id:p.id,formula:p.formula,value:p.value,damageType:p.damageType,traits:p.traits??[],choices}];
      });
      return candidates.length?[{index:`area:${row.key}:${decision.stepIndex}`,name:`${row.name} · ${decision.stepIndex+1}`,currentId:decision.currentId,sourceRevision:card.revision??0,candidates}]:[];
    });
  });
}
export async function publishAreaComponentChoice(message,index,partId){
  const choice=areaComponentChoices(message).find(c=>c.index===index);
  const candidate=choice?.candidates.find(p=>p.id===partId);if(!candidate)return null;
  const resolved=resultsFor(message);if(!resolved)return null;
  const {root,rows}=resolved,card=baseOf(root).card;
  const row=rows.find(r=>index.startsWith(`area:${r.key}:`));if(!row)return null;
  const profile=profileFor(card,row.degree,{targetUuid:row.tokenUuid,choices:candidate.choices});
  const changed={...row,damage:profile.damage,profileComplete:profile.profileComplete,
    includedPartIds:profile.includedPartIds,excludedPartIds:profile.excludedPartIds,profileReason:profile.profileReason??null,
    profileRevision:card.revision??0,profileChoices:candidate.choices};
  // Retain the result's own degrees; only the chosen target changes.
  const results=rows.filter(r=>!hiddenTarget(r.tokenUuid)).map(r=>r===row?changed:
    Object.fromEntries(Object.entries(r).filter(([k])=>!['profileChoices','profileRevision'].includes(k))));
  const data={version:1,rootMessageId:root.id,interventionIds:snapshotOf(message)?.interventionIds??[],results};
  return ChatMessage.create({speaker:card.areaOutcomeRedacted?{alias:'Fast NRI'}:root.speaker,
    content:`<strong>${esc(card.name)}</strong> · ${esc(game.i18n.localize('FASTNRI.Damage.chooseOtherDie'))}`,
    ...chatAudience(root),flags:{[ID]:{areaResult:data}}});
}

async function selectedRecipients(message,{manual=false}={}){
  const all=[...(globalThis.canvas?.tokens?.controlled??[])];
  const root=resultsFor(message)?.root,allowed=new Set(baseOf(root)?.area.targets.map(t=>t.uuid)??[]);
  return all.filter(t=>manual || t.document?.hidden!==true && allowed.has(t.document?.uuid))
    .filter(t=>canWrite(actorForToken(t)));
}
export function latestAreaDamageReport(root,token){
  const actor=actorForToken(token);
  const tokenUuid=token?.document?.uuid;
  if(!actor?.uuid||!tokenUuid)return null;
  return records().filter(m=>canRead(m)).reverse().find(m=>{
    const report=m.getFlag?.(ID,'hpReport');
    return report?.version===1 && report.kind==='damage' && report.reverted!==true &&
      report.pendingUndo!==true && report.sourceMessageId===root.id &&
      report.sourceRevision===(root.getFlag(ID,'weaponDamage')?.revision??0) &&
      report.actorUuid===actor.uuid && report.tokenUuid===tokenUuid;
  })??null;
}
/** One explicit click for the selected recipients; no message is edited.
 * 'both' resolves HP first, so item outcomes requiring confirmed damage
 * receive the exact report for their own Actor, never another target's HP.
 */
export async function applyAreaDamage(message,{degree=null,effect=false,both=false}={}){
  const resolved=resultsFor(message);
  if(!resolved){
    ui.notifications?.warn('Исходное сообщение атаки отсутствует.');
    return null;
  }
  if(degree!==null&&!ATTACK_DEGREES.includes(degree))throw Error('Unknown manual area degree');
  const recipients=await selectedRecipients(message,{manual:degree!==null});
  if(!recipients.length){ui.notifications?.warn('Выберите доступные для изменения токены.');return null;}
  const card=baseOf(resolved.root).card;
  if(card.parts.some(p=>p.pending)){
    ui.notifications?.warn('Сначала необходимо получить результаты кубов.');return null;
  }
  const applied=[];
  for(const token of recipients){
    // Another participant can delete the root while damage for an earlier
    // target is being resolved. Stop rather than continue from stale flags.
    if(!game.messages?.get(resolved.root.id)){
      ui.notifications?.warn('Исходное сообщение атаки отсутствует.');
      break;
    }
    const actor=actorForToken(token);
    const privateRecipient=token.document?.hidden===true;
    if(degree===null && privateRecipient)continue;
    const covers=coverRecords(resolved.root,token.document?.uuid);
    if (covers.some(cover=>cover.allyKey!==coverActorKey(actor) || cover.sourceRevision!==(card.revision??0))) {
      ui.notifications?.warn(game.i18n.localize('FASTNRI.CoverAlly.changed'));continue;
    }
    const rows=covers.length ? liveAreaRows(resolved.root) : resolved.rows;
    const outcome=rows.find(r=>r.tokenUuid===token.document?.uuid);
    if ((!effect || both) && covers.length && degree !== null && degree !== outcome?.degree) {
      ui.notifications?.warn(game.i18n.localize('FASTNRI.CoverAlly.changed'));continue;
    }
    const useDegree=degree??outcome?.degree;
    if(!useDegree){ui.notifications?.warn(`Не определена степень для ${token.name}.`);continue;}
    let report=null;
    if(!effect||both){
      const calculation=recipientProfile(resolved.root,useDegree,{actor,covers,targetUuid:token.document?.uuid});
      if(calculation.profileComplete===false){
        ui.notifications?.warn(`${token.name}: ${calculation.profileReason==='ambiguous-area-die-tie'||calculation.profileReason==='invalid-area-choice'?game.i18n.localize(game.user?.isGM?'FASTNRI.Damage.chooseOtherDie':'FASTNRI.Damage.areaChoiceAskGM'):'профиль урона этой степени не задан.'} Расчёт не применён.`);
        continue;
      }
      if(calculation.defenseComplete===false)
        ui.notifications?.warn(`${token.name}: часть защит от урона требует ручной проверки; применён расчёт по доступным данным.`);
      // A failed or fully avoided attack creates no pointless 0-HP report.
      // Card-defined effects at the same degree may still be applicable.
      if(calculation.damage>0){
        report=await applyHp({kind:'damage',amount:calculation.damage,sourceMessage:resolved.root,
          token,actor,expectedRevision:card.revision??0,effectDegree:useDegree,
          coverApplicationKey:covers.length?`ally:${coverScope(resolved.root)}:${token.document.uuid}`:null});
        if(report)applied.push(report);
      }
    }
    if(effect||both){
      // Manual effect-only application may follow a previous HP click. The
      // afterDamage/requiresDamage conditions use its real, per-target report.
      const confirmed=both?report:(report??latestAreaDamageReport(resolved.root,token));
      const preview=await attackOutcomeForDamageCard(resolved.root,{
        target:actor,damageReportId:confirmed?.id??null,effectDegreeOverride:useDegree});
      let manualOutcomes=0;
      for(const rule of preview.applicable){
        const result=await applyAttackOutcomeEffects(resolved.root,{target:actor,index:rule.index,
          sourceUuid:rule.sourceUuid,effectDegreeOverride:useDegree,
          privateRecipient,recipientToken:token,
          damageReportId:confirmed?.id??null});
        if(result){
          if(result.manual===true && !['immunity','zero-on-application'].includes(result.reason))
            manualOutcomes++;
          if((result.appliedCount??0)>0 || (result.alreadyAppliedCount??0)>0)
            applied.push(result);
        }
      }
      // One local notification per recipient only for unresolved consequences;
      // don't tell the table that immunity or a valid no-effect roll failed.
      if(preview.pending.length || manualOutcomes)
        ui.notifications?.warn(`${token.name}: часть Эффектов требует ручной проверки.`);
    }
  }
  return applied;
}
function button(label,callback){
  const el=document.createElement('button');el.type='button';el.className='fnri-damage-button';el.textContent=label;
  let busy=false;el.addEventListener('click',async e=>{if(busy)return;busy=true;
    try{await callback(e);}catch(error){console.error('Fast NRI | area action',error);ui.notifications?.error('Не удалось выполнить действие.');}
    finally{busy=false;}});return el;
}
function fillFollowUpButtons(message,container) {
  container.replaceChildren();
  const available=availableAreaFollowUps(message);
  container.hidden=available.length===0;
  for (const option of available) {
    container.append(button(option.label,async()=>{
      try {await applyAreaFollowUp(message,option.messageId);}
      finally {fillFollowUpButtons(message,container);}
    }));
  }
}

export function registerAreaFollowUpButtons() {
  // Refresh only local controls. A parent ChatMessage is immutable.
  function refresh(message) {
    const record=message.getFlag(ID,'areaIntervention');
    if (record?.kindKey!=='followUp') return;
    const parent=game.messages.get(record.parentMessageId);
    if (!parent) return;
    for (const group of document.querySelectorAll('[data-fnri-area-follow-ups]')) {
      if (group.dataset.fnriAreaFollowUps===parent.id) fillFollowUpButtons(parent,group);
    }
  }
  Hooks.on('createChatMessage',refresh);
  Hooks.on('deleteChatMessage',refresh);
}

export function areaPostDefenseChoices(message){
  const root=game.messages?.get(rootId(message));
  if(!canRead(root)||!canRead(message)||!sameCoverAudience(root,message))return [];
  const card=baseOf(root)?.card;
  if(!card||card.cancelled)return [];
  // Resolve the current chain, never a stale area result snapshot.
  const rows=liveAreaRows(root);
  return postDefenseChoices(root,message,card,offer=>{
    const target=offer.targetUuid;
    if(!target)return 'manual';
    if(hiddenTarget(target))return false;
    const row=rows.find(row=>row.tokenUuid===target);
    return !row?.degree?'manual':['partial','success','great'].includes(row.degree);
  });
}
function areaButtons(message,anchor){
  const actions=document.createElement('div');actions.className='fnri-area-actions';
  const card=message.getFlag(ID,'weaponDamage');
  const intervention=message.getFlag(ID,'areaIntervention');
  const result=snapshotOf(message);
  if(card?.areaAttack?.version===1 || result?.version===1){actions.append(button('Вмешаться',event=>rollAreaIntervention(message,{skipPreroll:!!event?.shiftKey})));}
  if(intervention?.version===1){actions.append(button(intervention.kindKey==='degreeReduction'?game.i18n.localize('FASTNRI.DegreeReduction.result'):'Применить вмешательства',()=>applyAreaInterventions(message)));}
  if(intervention?.followUpVersion===1 && intervention.success===true) {
    const group=document.createElement('span');
    group.dataset.fnriAreaFollowUps=message.id;
    fillFollowUpButtons(message,group);
    actions.append(group);
  }
  if(card?.areaAttack?.version===1||result?.version===1){
    actions.append(button('Нанести рассчитанный урон и эффекты',async()=>{
      await applyAreaDamage(message,{both:true});
    }));
    const details=document.createElement('details');details.className='fnri-area-manual';
    const summary=document.createElement('summary');summary.textContent='Ручное применение (урон / эффект)';details.append(summary);
    for(const [kind,label] of [[false,'Урон'],[true,'Эффект']]){
      const heading=document.createElement('small');heading.textContent=label;details.append(heading);
      for(const degree of ATTACK_DEGREES){
        details.append(button(DEGREE_NAMES[degree],()=>applyAreaDamage(message,{degree,effect:kind})));
      }
    }
    actions.append(details);
  }
  if(card?.areaAttack?.version===1||result?.version===1)for(const choice of areaPostDefenseChoices(message))
    actions.append(button(choice.label,()=>publishPostDefenseDamage(choice,()=>areaPostDefenseChoices(message))));
  anchor.append(actions);
}
export function renderAreaChat(message,html){
  const damage=message.getFlag?.(ID,'weaponDamage');
  const intervention=message.getFlag?.(ID,'areaIntervention');
  const result=snapshotOf(message);
  if(!damage?.areaAttack&&!intervention&&!result)return false;
  if(!canReadChatContent(message))return true;
  html.querySelector('.fnri-area-card')?.remove();
  const anchor=html.querySelector('.message-content')??html;
  const panel=document.createElement('section');panel.className='fnri-area-card';
  if(damage?.areaAttack||result){
    const root=damage?.areaAttack?message:game.messages?.get(result?.rootMessageId);
    const attack=baseOf(root);
    if(attack){const total=document.createElement('div');total.className='fnri-area-attack-total';
      const rerolled=(attack.card.history??[]).some(h=>h.action==='reroll');
      const label=rerolled?game.i18n.localize('FASTNRI.GameReroll.currentDice'):'Кубы';
      const nativeTotals=html.querySelectorAll?.('.dice-roll .dice-total')??[];
      const nativePair=root===message&&message.getFlag(ID,'weaponAttack')&&message.rolls?.length===2&&nativeTotals.length===2&&
        Number(nativeTotals[0].textContent?.trim())===areaCheckState(root)?.total&&Number(nativeTotals[1].textContent?.trim())===message.rolls[1].total;
      // Only remove a duplicate when the actual native attack total is present.
      const diceText=`${label}: ${parts(attack.card).map(p=>p.value).join(' + ')||'—'}`;
      total.textContent=nativePair?diceText:`Общая атака: ${areaCheckState(root)?.total??'—'} · ${diceText}`;
      if(nativePair)for(const [i,caption] of ['Общая атака','Урон'].entries()){
        const roll=nativeTotals[i].closest?.('.dice-roll');
        if(roll&&!roll.querySelector('[data-fnri-area-roll-label]')){const name=document.createElement('small');name.dataset.fnriAreaRollLabel='';name.textContent=caption;roll.prepend(name);}
      }
      panel.append(total);
      // The native attack Roll must never be struck out by a damage reroll.
      // Only mark the second, original damage total if the two native totals
      // are individually present and match the original damage Roll.
      if(rerolled&&root===message&&message.getFlag(ID,'weaponAttack')&&message.rolls?.length===2){
        const nativeTotals=html.querySelectorAll?.('.dice-roll .dice-total')??[];
        if(nativeTotals.length===2&&Number(nativeTotals[1].textContent?.trim())===message.rolls[1].total){
          nativeTotals[1].classList.add('fnri-original-roll');
          nativeTotals[1].title=game.i18n.localize('FASTNRI.Damage.originalTotal');
        }
      }
    }
    const rows=result?.version===1?(areaCheckState(root)?.changed?result.results.map(row=>({...row,degree:null,damage:null})):resultsFor(message)?.rows??[]):resolveAreaResults(message,[]);
    for(const degree of ATTACK_DEGREES.slice().reverse()){
      const matches=rows.filter(r=>r.degree===degree);
      if(!matches.length)continue;
      const line=document.createElement('div');line.className='fnri-area-degree';
      const heading=document.createElement('strong');heading.textContent=DEGREE_NAMES[degree];line.append(heading);
      const names=document.createElement('span');names.textContent=' · '+matches.map(r=>`${r.name} (${r.damage??'—'} до индивидуальных защит)`).join(', ');line.append(names);panel.append(line);
    }
    const missing=rows.filter(r=>!r.degree);if(missing.length){const line=document.createElement('p');
      line.textContent='Степень вручную: '+missing.map(r=>r.name).join(', ');panel.append(line);}
  }
  if(intervention?.kindKey==='followUp'){
    const note=document.createElement('small');
    note.textContent=game.i18n.format('FASTNRI.AreaIntervention.reduction',{
      target:intervention.targetName,amount:intervention.degreeReduction});
    panel.append(note);
  } else if(intervention?.version===1 && intervention.kindKey!=='degreeReduction'){const note=document.createElement('small');note.textContent=
    `${intervention.kind}: ${intervention.targetName} · ${intervention.success?'успех':'провал'}`+
    (intervention.knockedDown?' · '+game.i18n.localize('FASTNRI.AreaIntervention.knockedDown'):'');panel.append(note);}
  areaButtons(message,panel);anchor.append(panel);return true;
}
