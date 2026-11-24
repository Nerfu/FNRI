/**
 * Fast NRI 7.0 — damage-dependent recovery, used by the Rulebook's Drain.
 *
 * The weapon damage card owns its Roll, intervention outcome and HP application.
 * This adapter reads the *applied* HP report and a card-authored contract,
 * then creates ONE independent recovery result; it never grants HP or a class
 * resource until the respective button is pressed. No hidden extra Item or
 * ActiveEffect snapshot is copied into ChatMessage data.
 */
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {queueActorWrite} from '../data/ability-accounting.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {applyHp} from '../damage/hp-actions.mjs';

const SCOPE='fast-nri-v14';
const keyFor=value=>String(value??'').trim().toLocaleLowerCase('ru');
const escape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const good=number=>Number.isSafeInteger(number)&&number>=0;
const owned=actor=>!!actor && (game.user?.isGM===true || actor.isOwner===true ||
  actor.canUserModify?.(game.user,'update')===true);
const ongoing=new Set();

/** Read the specific variant used for this attack. Do NOT decide by the spell name. */
export function recoveryRuleForDamage(card,item){
  if(card?.version!==2 || item?.type!=='ability' ||
    item.parent?.documentName!=='Actor' || !card.executionId ||
    item.uuid!==card.sourceUuid || item.parent.uuid!==card.sourceActorUuid)return null;
  const execution=item.system?.mechanics?.executions?.find(e=>e?.id===card.executionId);
  const rule=execution?.onDamageApplied;
  if(rule?.kind!=='drain' || rule.hpFrom!=='maxDamageDie' ||
    rule.requiresHpLoss!==true || !String(rule.resourceName??'').trim())return null;
  const by=rule.resourceByEffectDegree;
  if(!by || !['failure','partial','success','great'].every(d=>good(by[d])))return null;
  return {resourceName:rule.resourceName,byDegree:by,spellCancellation:rule.spellCancellation===true};
}

/** Pure, grounded in the latest damage card and the actual HP report. */
export function planDamageRecovery(report,card,rule){
  if(!rule || report?.kind!=='damage' || report?.reverted ||
    report?.sourceMessageId!==card?.messageId || card?.cancelled ||
    report?.sourceRevision!==(card?.revision??0) ||
    !good(report?.hitPointsDamage??Math.max(0,report?.before?.current-report?.after?.current)))return null;
  const lost=report.hitPointsDamage??Math.max(0,report.before.current-report.after.current);
  if(lost<=0)return null;
  const degree=card.effectDegree??card.degree;
  if(!['partial','success','great'].includes(degree))return null;
  const maxDie=Math.max(0,...(card.parts??[])
    .filter(p=>p?.kind==='die' && p.faces===4 && /^M[1-9]\d*$/.test(p.profilePart) &&
      !p.excluded && !p.immune && !p.pending &&
      Number.isSafeInteger(p.value) && p.value>=1)
    .map(p=>p.value));
  return {hp:maxDie,resource:rule.byDegree[degree],degree,
    spellCancellation:rule.spellCancellation && ['success','great'].includes(degree)};
}

/** Deterministic message ID survives retries after a partial failure. */
export async function ensureDamageRecovery(hpMessage,{damageMessage=null}={}){
  const hp=game.messages?.get(hpMessage?.id)??hpMessage;
  if(!canReadChatContent(hp))return null;
  const report=hp.getFlag?.(SCOPE,'hpReport');
  if(report?.kind!=='damage' || report.reverted || !report.sourceMessageId)return null;
  const source=damageMessage??game.messages?.get(report.sourceMessageId);
  if(!source || source.id!==report.sourceMessageId || !canReadChatContent(source))return null;
  const damage=source.getFlag?.(SCOPE,'weaponDamage');
  if(damage?.version!==2)return null;
  const item=damage.sourceUuid ? await fromUuid(damage.sourceUuid):null;
  const rule=recoveryRuleForDamage(damage,item);
  if(!rule)return null;
  const amounts=planDamageRecovery(report,{...damage,messageId:source.id},rule);
  if(!amounts)return null;
  const id=stableDocumentId('fdr',[hp.id]);
  const existing=game.messages?.get(id);
  if(existing)return existing.getFlag?.(SCOPE,'damageRecovery')?.hpReportId===hp.id?existing:null;
  if(ongoing.has(id))return null;
  ongoing.add(id);
  try{
    // The HP report can be undone while documents are looked up. Do not
    // mint a recovery against an already reverted report.
    const latestHp=game.messages?.get(hp.id)??hp;
    const latestSource=game.messages?.get(source.id)??source;
    if(latestHp.getFlag?.(SCOPE,'hpReport')?.reverted ||
      latestSource.getFlag?.(SCOPE,'weaponDamage')?.revision!==report.sourceRevision ||
      !canReadChatContent(latestSource))return null;
    const card={version:1,hpReportId:hp.id,damageMessageId:source.id,
      sourceActorUuid:damage.sourceActorUuid,sourceItemUuid:item.uuid,
      targetActorUuid:report.actorUuid,hp:amounts.hp,
      resource:amounts.resource,resourceName:rule.resourceName,
      degree:amounts.degree,spellCancellation:amounts.spellCancellation};
    const content=`<article class="fnri-damage-recovery"><strong>${escape(item.name)} — восстановление</strong>`+
      `<p>После применения урона: HP <strong>${card.hp}</strong>, ${escape(card.resourceName)} <strong>${card.resource}</strong>.</p>`+
      (card.spellCancellation?`<p><small>${escape(game.i18n.localize('FASTNRI.DamageRecovery.cancelledSpellExtra'))}</small></p>`:'')+
      '</article>';
    const data={_id:id,speaker:ChatMessage.getSpeaker({actor:item.parent}),content,
      whisper:[...(source.whisper??[])],blind:source.blind===true,
      flags:{[SCOPE]:{damageRecovery:card}}};
    try {return await ChatMessage.create(data,{keepId:true});}
    catch(error){
      const other=game.messages?.get(id);
      if(other?.getFlag?.(SCOPE,'damageRecovery')?.hpReportId===hp.id)return other;
      throw error;
    }
  }finally{ongoing.delete(id);}
}

/** Reader/actor permission never follows the target's HP permissions. */
async function lookupRecovery(message){
  const live=game.messages?.get(message?.id)??message;
  if(!canReadChatContent(live))return null;
  const card=live.getFlag?.(SCOPE,'damageRecovery');
  if(card?.version!==1 || !card.sourceActorUuid || !card.hpReportId)return null;
  const actor=await fromUuid(card.sourceActorUuid);
  if(actor?.documentName!=='Actor' || actor.uuid!==card.sourceActorUuid || !owned(actor))return null;
  // Undoing the initial damage invalidates an as-yet unused restoration, but
  // never silently removes recovery already granted and subsequently edited.
  // A fabricated or copied result is never a valid healing entitlement.
  if(live.id!==stableDocumentId('fdr',[card.hpReportId]))return null;
  const original=game.messages?.get(card.hpReportId);
  const report=original?.getFlag?.(SCOPE,'hpReport');
  const damage=report?.sourceMessageId ? game.messages?.get(report.sourceMessageId) : null;
  const attack=damage?.getFlag?.(SCOPE,'weaponDamage');
  if(!report || report.reverted || report.kind!=='damage' ||
    report.sourceMessageId!==card.damageMessageId ||
    attack?.sourceActorUuid!==actor.uuid ||
    attack?.sourceUuid!==card.sourceItemUuid ||
    report.actorUuid!==card.targetActorUuid ||
    !((report.hitPointsDamage??Math.max(0,report.before?.current-report.after?.current))>0))return null;
  return {live,card,actor};
}

export async function applyDrainRestoration(message,kind){
  if(!['hp','resource'].includes(kind))return null;
  if(kind==='hp'){
    const live=game.messages?.get(message?.id);
    if(!canReadChatContent(live))return null;
    const card=live.getFlag?.(SCOPE,'damageRecovery');
    if(card?.version!==1||!good(card.hp))return null;
    return applyHp({kind:'heal',amount:card.hp,sourceMessage:live,independent:true});
  }
  const details=await lookupRecovery(message);
  if(!details)return null;
  const {live,card,actor}=details;
  if(ongoing.has(`${live.id}:${kind}`))return null;
  ongoing.add(`${live.id}:${kind}`);
  try{
    return queueActorWrite(actor,async()=>{
      if(!owned(actor))return null;
      if(actor.getFlag?.(SCOPE,'damageRecoveryApplied')?.[live.id]?.resource)return actor;
      const wanted=keyFor(card.resourceName);
      const rows=Object.entries(actor.system?.resources??{}).filter(([,row])=>
        keyFor(row?.name)===wanted && (!row.kind || row.kind==='class'));
      if(rows.length!==1){
        ui.notifications?.warn('Похищение: ресурс не найден или неоднозначен. Восстановите его вручную.');
        return null;
      }
      const [id,row]=rows[0];
      if(!Number.isFinite(row.current)){
        ui.notifications?.warn('Похищение: у ресурса нет числового значения.');return null;
      }
      const maximum=Number.isFinite(row.max)?Math.max(row.max,row.current):Infinity;
      const next=Math.min(maximum,row.current+card.resource);
      await actor.update({[`system.resources.${id}.current`]:next,
        [`flags.${SCOPE}.damageRecoveryApplied.${live.id}.resource`]:true},
        {fnriJournal:{kind:'resource',reason:'Похищение — восстановление Магической силы'}});
      return actor;
    });
  }finally{ongoing.delete(`${live.id}:${kind}`);}
}

export function registerDamageRecovery(){
  Hooks.on('renderChatMessageHTML',(message,html)=>{
    if(!html?.querySelector || !canReadChatContent(message))return;
    const card=message.getFlag?.(SCOPE,'damageRecovery');
    if(card?.version!==1 || html.querySelector('[data-fnri-recovery-actions]'))return;
    const root=document.createElement('section');root.dataset.fnriRecoveryActions='';
    root.className='fnri-ability-chat-options';
    for(const [kind,label] of [['hp','Восстановить HP'],['resource','Восстановить Магическую силу']]){
      if(kind==='hp' && !(card.hp>0))continue;
      if(kind==='resource' && !(card.resource>0))continue;
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.className='fnri-ability-chat-button';
      let pending=false;
      button.addEventListener('click',async()=>{
        if(pending)return;
        pending=true;
        try {await applyDrainRestoration(message,kind);}
        catch(error){console.error('Fast NRI | damage recovery failed',error);
          ui.notifications?.warn('Похищение: не удалось применить восстановление.');}
        finally{pending=false;}
      });
      root.append(button);
    }
    (html.querySelector('.message-content')??html).append(root);
  });
}
