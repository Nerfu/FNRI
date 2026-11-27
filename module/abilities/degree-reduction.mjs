/** A card-owned, no-roll degree change. Only a visible, exact recipient's
 * result is linked; the source roll, other recipients and their HP are untouched. */
import {ATTACK_DEGREES,resolveDirectedEffectDegree} from '../rolls/attack-core.mjs';
import {CHECK_DEFENSES} from '../rolls/attack-properties.mjs';
import {chooseByButtons} from '../rolls/button-choice.mjs';
import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {canExecuteAction,escapeActionText as esc,declareAction,actionText} from '../rolls/action-declaration.mjs';
import {finishCardAccounting,publishAreaUse} from '../data/ability-accounting.mjs';
import {redactActorSourceForAudience} from '../rolls/roll-context.mjs';
import {coverScope,sameCoverAudience,coverRecords,hasDamageForCoverTarget} from '../damage/cover-ally-state.mjs';
import {liveAreaRows,areaCheckState} from '../damage/area-attack.mjs';
import {damageAtReducedDegree,damageDegreeIncreaseParts,snapshotDamageParts,copy} from '../damage/damage-core.mjs';
import {directedSpellSpatialContext} from '../spatial/spatial-context.mjs';
import {resolveSpellOrigin} from '../projection/projection.mjs';
const ID='fast-nri-v14';
const flag=(m,k)=>m?.getFlag?.(ID,k);
const messages=()=>game.messages?.contents??[];
const nameOf=d=>game.i18n.localize('FASTNRI.DegreeReduction.'+d);
const doc=t=>t?.document??t;
const active=new Set();
export function degreeReductionRule(item){
  const r=item?.system?.mechanics?.degreeReduction;
  return CHECK_DEFENSES.includes(r?.targetDefense)&&Number.isInteger(r.amount)&&r.amount>=1&&r.amount<=3?r:null;
}
function afterDegree(degree,amount){return resolveDirectedEffectDegree({attackDegree:degree,successfulDefenses:amount}).effectDegree;}
function ownTokens(actor){
  const all=globalThis.canvas?.tokens?.placeables??[];
  const selected=globalThis.canvas?.tokens?.controlled??[];
  const own=t=>(t?.actor??t?.document?.actor)?.uuid===actor.uuid;
  const pool=selected.some(own)?selected:all;
  return new Map([...pool,...(!selected.some(own)&&actor.token?[actor.token]:[])].filter(own)
    .filter(t=>doc(t).uuid&&doc(t).hidden!==true).map(t=>[doc(t).uuid,t]));
}
function correctionsChanged(m,total){
  const edit=flag(m,'rollEdit');
  return !!edit&&(edit.currentTotal!==total||(edit.components??[]).some(p=>p.kind==='die'&&p.faces===20&&(p.added||p.excluded||p.value!==p.original)));
}
export function degreeReductionCandidates(actor,item){
  const rule=degreeReductionRule(item);
  if(!rule||item.parent?.uuid!==actor?.uuid||!canExecuteAction(actor))return [];
  const tokens=ownTokens(actor),seen=new Set(),out=[];
  for(const message of [...messages()].reverse()){
    if(!canReadChatContent(message)||redactActorSourceForAudience(actor,message))continue;
    const damage=flag(message,'weaponDamage'),check=flag(message,'checkRoll'),attack=flag(message,'weaponAttack');
    const existing=flag(message,'degreeChange');
    // A pre-damage record is a continuation of the attack, not another attack.
    // Ignore it here; its root uses the saved degree instead.
    if(existing?.kind==='attack')continue;
    const scope=coverScope(message);
    const add=(kind,uuid,degree,label)=>{
      const token=tokens.get(uuid),key=JSON.stringify([scope,uuid]);
      if(!token||seen.has(key))return;
      seen.add(key);
      if(!ATTACK_DEGREES.includes(degree)||degree==='failure'||hasDamageForCoverTarget(message,token)||coverRecords(message,uuid).length)return;
      const reduced=afterDegree(degree,rule.amount);
      const source=kind==='damage'?damage:kind==='attack'?attack:null;
      const after=source?.ferocity&&source.postDefenseDamage?.some(o=>o.ferocity)&&reduced==='partial'?'failure':reduced;
      out.push({kind,message,uuid,token,degree,after,label,scope});
    };
    if(damage?.version===2&&damage.targetDefense===rule.targetDefense){
      if(damage.areaAttack?.version===1){
        if(damage.areaRootMessageId&&damage.areaRootMessageId!==message.id)continue;
        for(const row of liveAreaRows(message))add('area',row.tokenUuid,row.degree,damage.name);
      }else if(!damage.postDefenseOrigin){
        // Newest continuation supersedes all earlier damage snapshots, even a cancelled one.
        let degree=damage.cancelled||damage.parts?.some(p=>p.pending)?null:damage.degree;
        try {if(degree&&degree!=='failure')damageAtReducedDegree(damage,afterDegree(degree,rule.amount));}catch{degree=null;}
        add('damage',damage.originalTargetUuid,degree,damage.name);
      }
    }else if(check?.targetDefense===rule.targetDefense){
      add('check',check.result?.targetUuid,correctionsChanged(message,check.result?.total)?null:check.result?.degree,check.label);
    }else if(attack?.targetDefense===rule.targetDefense&&!attack.areaAttack){
      add('attack',attack.originalTargetUuid,correctionsChanged(message,attack.attackTotal)?null:currentAttackDegree(message),attack.name);
    }
  }
  return out;
}
/** Original attack stays immutable; only a recommendation is changed. */
export function currentAttackDegree(message,{recommendation=false}={}){
  const attack=flag(message,'weaponAttack');
  let degree=attack?.attackDegree??attack?.suggestedDegree;
  const records=messages().filter(entry=>{const r=flag(entry,'degreeChange');return r?.kind==='attack'&&r.sourceMessageId===message.id&&r.targetUuid===attack?.originalTargetUuid&&canReadChatContent(entry)&&sameCoverAudience(entry,message);});
  if(recommendation&&!records.length)return attack?.suggestedDegree;
  if(correctionsChanged(message,attack?.attackTotal))return null;
  for(const entry of records){const r=flag(entry,'degreeChange');if(r.before===degree&&ATTACK_DEGREES.includes(r.after))degree=r.after;}
  return degree;
}
function sameCandidate(a,b){return !!b&&a.kind===b.kind&&a.message.id===b.message.id&&a.uuid===b.uuid&&a.degree===b.degree&&a.after===b.after;}
export async function applyDegreeReduction({actor,item,choice,execution}){
  const live=degreeReductionCandidates(actor,item).find(row=>sameCandidate(row,choice));
  if(!live)return null;
  const {message,uuid,token,kind,degree,after}=live,rule=degreeReductionRule(item);
  const key=JSON.stringify([actor.uuid,item.uuid,message.id,uuid]);
  if(active.has(key))return null;
  active.add(key);
  try{
    const record={version:1,kind,sourceMessageId:message.id,targetUuid:uuid,before:degree,after,actorUuid:actor.uuid};
    const audience=chatAudience(message);
    const content=`<strong>${esc(item.name)}</strong> · ${esc(token.name??doc(token).name??actor.name)}<p>${esc(nameOf(degree))} → <strong>${esc(nameOf(after))}</strong></p>`;
    const data={speaker:ChatMessage.getSpeaker({actor,token:doc(token)}),...audience,content,flags:{[ID]:{degreeChange:record,
      abilityExecution:{executionId:execution.id,actorUuid:actor.uuid,sourceItemUuid:item.uuid}}}};
    const flags=data.flags[ID];
    if(kind==='check'){
      const check=flag(message,'checkRoll');
      flags.checkRoll={...check,actorUuid:actor.uuid,isIntervention:false,previousMessageId:message.id,
        result:{...check.result,degree:after}};
    }else if(kind==='damage'){
      const card=flag(message,'weaponDamage');
      const next=damageAtReducedDegree(card,after);
      if(ATTACK_DEGREES.includes(card.effectDegree)&&!next.cancelled)next.effectDegree=afterDegree(card.effectDegree,rule.amount);
      next.previousMessageId=message.id;next.revision=(card.revision??0)+1;
      next.history=[...(next.history??[]),{action:'degreeReduction',source:item.uuid,name:item.name,before:degree,after}];
      flags.weaponDamage=next;
    }else if(kind==='area'){
      const card=flag(message,'weaponDamage'),target=card.areaAttack.targets.find(t=>t.uuid===uuid);
      flags.areaIntervention={version:1,rootMessageId:message.id,targetKey:target.key,targetName:target.name,
        kind:item.name,kindKey:'degreeReduction',degreeReduction:rule.amount,success:true,naturalTwentyCancels:false,
        attackCheckTotal:areaCheckState(message).total,actorUuid:actor.uuid,tokenUuid:uuid};
      return await publishAreaUse({actor,item,execution,isIntervention:false,publish:messageId=>{
        if(!degreeReductionCandidates(actor,item).some(row=>sameCandidate(row,live)))return null;
        return ChatMessage.create({...data,...(messageId?{_id:messageId}:{})},{keepId:!!messageId});
      }});
    }
    const result=await ChatMessage.create(data);
    if(result)await finishCardAccounting({actor,item,message:result,execution,isIntervention:false});
    return result;
  }finally{active.delete(key);}
}
export async function executeDegreeReduction({actor,item,execution,source}){
  const candidates=degreeReductionCandidates(actor,item);
  const manual=()=>declareAction({actor,item,label:item.name,description:item.system?.description??'',source,execution,isIntervention:false});
  if(!candidates.length)return manual();
  const rows=candidates.map((row,i)=>({value:String(i),label:`${row.label??''} · ${row.token.name??actor.name} · ${nameOf(row.degree)} → ${nameOf(row.after)}`}));
  rows.push({value:'manual',label:actionText('standalone')});
  const choice=await chooseByButtons({title:item.name,rows,confirmLabel:game.i18n.localize('FASTNRI.AbilityChat.manualApply')});
  if(!choice)return null;
  return choice.value==='manual'?manual():applyDegreeReduction({actor,item,choice:candidates[Number(choice.value)],execution});
}

/** Directed increase after damage is determined. Shared degree-change records,
 * original audience and accounting; no mutation of the attack or HP. */
export function degreeIncreaseRule(item){
  const rule=item?.system?.mechanics?.degreeIncrease;
  return Number.isInteger(rule?.amount)&&rule.amount>=1&&rule.amount<=3?rule:null;
}
export function degreeIncreaseCandidates(actor,item){
  const rule=degreeIncreaseRule(item);
  if(!rule||item.parent?.uuid!==actor?.uuid||!canExecuteAction(actor))return [];
  const tokens=(globalThis.canvas?.tokens?.placeables??[]).filter(t=>t.visible!==false&&doc(t).hidden!==true&&doc(t).uuid);
  const seen=new Set(),out=[];
  for(const message of [...messages()].reverse()){
    const card=flag(message,'weaponDamage');
    if(!canReadChatContent(message)||redactActorSourceForAudience(actor,message)||card?.version!==2||card.areaAttack||card.postDefenseOrigin)continue;
    const scope=coverScope(message),key=JSON.stringify([scope,chatAudience(message)]);
    if(seen.has(key))continue;seen.add(key);
    const root=game.messages?.get?.(card.attackMessageId),attack=flag(root,'weaponAttack');
    if(!canReadChatContent(root)||!sameCoverAudience(root,message)||!attack||attack.areaAttack||!card.originalTargetUuid||attack.originalTargetUuid!==card.originalTargetUuid||!card.sourceActorUuid||attack.actorUuid!==card.sourceActorUuid||correctionsChanged(root,attack.attackTotal))continue;
    const target=tokens.find(t=>doc(t).uuid===card.originalTargetUuid);
    const sources=tokens.filter(t=>(t.actor??doc(t).actor)?.uuid===card.sourceActorUuid);
    const exact=sources.find(t=>doc(t).uuid===attack.spatialOrigin?.tokenUuid);
    const token=exact??(sources.length===1?sources[0]:null);
    if(!target||!token||hasDamageForCoverTarget(message,target)||coverRecords(message,card.originalTargetUuid).length)continue;
    // Conditional augmentations and changed profiles need a full re-resolution.
    // Keep the existing manual use rather than silently lose their effects.
    if(attack.ordinaryWeaponDamage?.length||attack.combatDamageReferences?.length||attack.autoRerollTraits?.sweeping||attack.autoRerollTraits?.catalyst||card.postDefenseDamage?.length||card.attackAugments?.length||card.history?.some(h=>h.action==='intervention'||h.action==='degreeReduction'))continue;
    const plan=damageDegreeIncreaseParts(card,rule.amount);
    if(!plan)continue;
    out.push({message,token,uuid:doc(token).uuid,degree:card.degree,after:plan.after,definitions:plan.definitions});
  }
  return out;
}
export async function applyDegreeIncrease({actor,item,choice,execution,spellCast=null,publishResult=null}){
  const find=()=>degreeIncreaseCandidates(actor,item).find(r=>r.message.id===choice.message.id&&r.uuid===choice.uuid&&r.degree===choice.degree&&r.after===choice.after);
  const live=find();if(!live)return null;
  const {message,token,uuid,degree,after,definitions}=live;
  const key=JSON.stringify([actor.uuid,item.uuid,message.id,uuid]);
  if(active.has(key))return null;active.add(key);
  try{
    const range=directedSpellSpatialContext({origin:resolveSpellOrigin(actor),targetTokens:[token],spellRange:spellCast?.spellRange});
    if(range?.spellRangeWarning)globalThis.ui?.notifications?.warn(range.spellRangeWarning);
    const card=flag(message,'weaponDamage'),before=JSON.stringify(card);
    const roll=definitions.length?await new Roll(definitions.map(d=>d.formula).join(' + ')).evaluate():null;
    if(!find()||JSON.stringify(flag(message,'weaponDamage'))!==before)return null;
    const next=copy(card);
    next.parts.push(...snapshotDamageParts(roll,definitions,{damageType:card.damageType,properties:card.properties}));
    next.originalDegree=card.originalDegree??degree;next.degree=after;next.effectDegree=after;next.previousMessageId=message.id;next.revision=(card.revision??0)+1;
    next.history=[...(next.history??[]),{action:'degreeIncrease',source:item.uuid,name:item.name,before:degree,after}];
    const data={speaker:ChatMessage.getSpeaker({actor}),...chatAudience(message),content:`<strong>${esc(item.name)}</strong> · ${esc(token.name??doc(token).name)}<p>${esc(nameOf(degree))} → <strong>${esc(nameOf(after))}</strong></p>`,flags:{[ID]:{weaponDamage:next,degreeChange:{version:1,kind:'damage',sourceMessageId:message.id,targetUuid:card.originalTargetUuid,before:degree,after,actorUuid:actor.uuid},abilityExecution:{executionId:execution.id,actorUuid:actor.uuid,sourceItemUuid:item.uuid}}}};
    if(roll)data.rolls=[roll.toJSON()];
    const result=await (publishResult?publishResult(data):ChatMessage.create(data));
    if(result)await finishCardAccounting({actor,item,message:result,execution,isIntervention:execution.isIntervention,chargedWeaponUuid:spellCast?.chargedWeaponUuid??null});
    return result;
  }finally{active.delete(key);}
}
export async function executeDegreeIncrease({actor,item,execution,source,spellCast,publishResult}){
  const candidates=degreeIncreaseCandidates(actor,item);
  const manual=()=>declareAction({actor,item,label:item.name,description:item.system?.description??'',source,execution,isIntervention:execution.isIntervention,spellCast});
  const rows=candidates.map((r,i)=>({value:String(i),label:`${r.token.name??doc(r.token).name} · ${flag(r.message,'weaponDamage').name} · ${nameOf(r.degree)} → ${nameOf(r.after)}`}));
  rows.push({value:'manual',label:actionText('standalone')});
  const pick=await chooseByButtons({title:item.name,rows,confirmLabel:game.i18n.localize('FASTNRI.AbilityChat.manualApply')});
  if(!pick)return null;
  return pick.value==='manual'?manual():applyDegreeIncrease({actor,item,choice:candidates[Number(pick.value)],execution,spellCast,publishResult});
}
