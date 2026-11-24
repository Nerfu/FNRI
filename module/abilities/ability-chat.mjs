/**
 * Fast NRI 7.0 — agreed card-first ability flow (Foundry 14).
 *
 * Sheet "to chat" -> readable Item description -> one button per authored
 * execution -> native roll / attack / pending effect result -> separate apply.
 * Publishing never spends resources. Costs are advisory at publication and
 * recorded only after a successful execution-result message exists.
 * Passive abilities have NO executions; their descriptions are still shareable.
 * No special casing by ability name, class, hand count or action type.
 */
import {abilityAccountingStatus,abilityCostPreview,finishCardAccounting,queueActorWrite} from '../data/ability-accounting.mjs';
import {applyHp} from '../damage/hp-actions.mjs';
import {abilityTempHpExpiry} from './temporary-hp-cast.mjs';
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {createPrivateAreaSourceMessage,privateAreaSourceFor} from '../data/private-area-source.mjs';
import {declareAction,actionText} from '../rolls/action-declaration.mjs';
import {cardRollKind} from '../rolls/roll-contributions.mjs';
import {postRoll,itemFormula} from '../rolls/checks.mjs';
import {redactActorSourceForAudience} from '../rolls/roll-context.mjs';
import {isAreaAttack,effectiveWeaponProperties} from '../rolls/attack-properties.mjs';
import {resolveAbilityWeapon} from '../equipment/weapon-traits.mjs';
import {projectionActorsForAbility} from '../projection/projection.mjs';
import {sendOtherItemAttack} from '../weapon/weapon-attack.mjs';
import {resolveCardEffectTarget,applyCardEffect} from '../effects/apply-card-effect.mjs';

const ID='fast-nri-v14';
const TYPES=new Set(['roll','attack','temporaryHp','effect','projection']);
const EXECUTION_ID=/^[A-Za-z0-9_-]{1,64}$/;
const esc=x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const text=(key)=>game.i18n.localize(`FASTNRI.AbilityChat.${key}`);
const isActorOwner=actor=>!!actor && (actor.isOwner===true || actor.canUserModify?.(game.user,'update')===true || game.user?.isGM===true);
const ownerAbility=item=>item?.documentName==='Item' && item.type==='ability' &&
  item.parent?.documentName==='Actor';

/** Authored executions, or one manual use for an active card. No inference from prose. */
export function abilityExecutions(item) {
  if(!ownerAbility(item) || item.system?.mechanics?.passive === true)return [];
  const raw=item.system?.mechanics?.executions;
  const seen=new Set(), result=[];
  for(const row of Array.isArray(raw)?raw:[]){
    const id=typeof row?.id==='string'?row.id:'';
    if(!EXECUTION_ID.test(id) || seen.has(id) || !TYPES.has(row?.type))continue;
    const label=String(row.label??'').trim();
    if(!label)continue;
    seen.add(id);
    result.push({...row,id,label,isIntervention:typeof row.isIntervention==='boolean' ? row.isIntervention :
      item.system?.mechanics?.isIntervention===true});
  }
  // Active cards without an automated execution still have a genuine use.
  // The description-only publication remains free, and passives above have no button.
  if(!result.length)result.push({id:'manual-use',type:'manual',label:actionText('declare'),
    isIntervention:item.system?.mechanics?.isIntervention===true});
  return result;
}

export function abilityExecution(item,id){return abilityExecutions(item).find(e=>e.id===id)??null;}

function initialAudience(){
  const configured=game.settings.get('core','messageMode');
  const mode=({publicroll:'public',gmroll:'gm',blindroll:'blind',selfroll:'self'})[configured]??configured;
  // v14 native ChatMessage.applyMode, not an approximation of whisper rules.
  const data=ChatMessage.applyMode({},['public','gm','blind','self'].includes(mode)?mode:'public');
  return {whisper:[...(data.whisper??[])],blind:!!data.blind};
}
function inheritingAudience(message){return {whisper:[...(message.whisper??[])],blind:!!message.blind};}

function costMessages(actor,item,execution){
  return abilityCostPreview(actor,item,execution).map(warning=>{
    const name=actor.system?.resources?.[warning.resourceId]?.name || warning.resourceName || warning.resourceId;
    const resource=name ? ` (${name})` : '';
    return (warning.reason==='insufficient'?text('insufficient'):
      warning.reason==='intervention-resource-unknown'?text('unassignedIntervention'):
        warning.reason==='ambiguous'?text('ambiguousResource'):text('unavailable'))+resource;
  });
}

function warnAtPublication(actor,item,executions) {
  const warnings=new Set(executions.flatMap(execution=>costMessages(actor,item,execution)));
  if (item.system?.mechanics?.attackAugment && !executions.length) {
    for (const warning of costMessages(actor,item,null)) warnings.add(warning);
  }
  const status=abilityAccountingStatus(actor,item);
  if (status?.remaining===0) warnings.add(text('noDailyUses'));
  if (status?.cooldownRemainingRounds>0) {
    warnings.add(game.i18n.format('FASTNRI.AbilityChat.roundCooldown',{rounds:status.cooldownRemainingRounds}));
  }
  if (warnings.size) ui.notifications?.warn(`${item.name} — ${[...warnings].join(', ')}`);
}

/** Post a description even for passive abilities. No accounting, rolls, or
 * reserved resources at publication. Notifications contain no current balances.
 */
export async function publishAbility(item) {
  if(!ownerAbility(item) || !isActorOwner(item.parent))return null;
  const actor=item.parent;
  const audience=initialAudience();
  const executions=abilityExecutions(item);
  const privateSource=redactActorSourceForAudience(actor,audience) && executions.some(execution=>{
    if(execution.type!=='attack')return false;
    const rule={...item.system.mechanics.attack,...execution.attack};
    const weapon=rule.kind==='physical' ? resolveAbilityWeapon(item,actor) : null;
    return isAreaAttack([rule.properties,weapon&&effectiveWeaponProperties(weapon.system)].filter(Boolean).join(', '));
  });
  const raw=String(item.system?.description || item.system?.effect || item.system?.notes || '').trim();
  // Use Foundry's native enrichment for rich descriptions, UUID links and
  // secret blocks; a plain escaped fallback is used if the API is unavailable.
  const enriched=raw && foundry.applications?.ux?.TextEditor?.enrichHTML
    ? await foundry.applications.ux.TextEditor.enrichHTML(raw,{secrets:false,relativeTo:item}) :
      esc(raw).replace(/\r?\n/g,'<br>');
  const description=raw ? `<div class="fnri-ability-description">${enriched}</div>` :
    `<p>${esc(text('noDescription'))}</p>`;
  const data={
    speaker:privateSource?{alias:'Fast NRI'}:ChatMessage.getSpeaker({actor}),
    content:`<article class="fnri-ability-publication"><strong>${esc(item.name)}</strong>${description}</article>`,
    ...audience,
    flags:{[ID]:{abilityPublication:privateSource ? {version:1,areaSourceRedacted:true} :
      {version:1,actorUuid:actor.uuid,itemUuid:item.uuid}}}
  };
  const message=privateSource ? await createPrivateAreaSourceMessage(data,actor,{itemUuid:item.uuid}) :
    await ChatMessage.create(data);
  if(message)warnAtPublication(actor,item,executions);
  return message;
}

async function documentsForPublication(message){
  if(!canReadChatContent(message))return null;
  const data=message.getFlag(ID,'abilityPublication');
  if(data?.version!==1)return null;
  const privateSource=data.areaSourceRedacted===true ? privateAreaSourceFor(message) : null;
  const itemUuid=privateSource?.itemUuid??data.itemUuid;
  if(!itemUuid || !(privateSource?.actor || data.actorUuid))return null;
  const actor=privateSource?.actor??await fromUuid(data.actorUuid);
  const item=await fromUuid(itemUuid);
  if(actor?.documentName!=='Actor'|| !ownerAbility(item)||item.parent.uuid!==actor.uuid)return null;
  return {actor,item};
}

/** A button's execution is the cost event. Selecting the button cannot spend
 * resources if preroll is dismissed or the result message fails to post.
 */
export async function executeAbilityFromChat(message,executionId,{skipPreroll=false}={}){
  // Capture target IDENTITIES at click time, before UUID lookups/preroll.
  // Current target defense values are resolved at roll time against these
  // same tokens (so changing target selection cannot redirect the attack).
  // Independent uses never infer a shared Double Invocation session.
  const clickTargets=[...(game.user?.targets??[])];
  const clickControlled=[...(globalThis.canvas?.tokens?.controlled??[])];
  const source=game.messages?.get(message?.id);
  if(!source || !canReadChatContent(source))return null;
  const docs=await documentsForPublication(source);
  if(!docs || !isActorOwner(docs.actor))return null;
  const {item,actor}=docs;
  const execution=abilityExecution(item,executionId);
  if(!execution)throw Error(text('missingExecution'));
  // Source data is reread after publication; costs and active effects are never
  // copied into the ChatMessage. A warning does not prohibit the action.
  switch(execution.type){
    case 'manual': {
      const label=item.name,formula=itemFormula(item);
      if(formula)return postRoll({formula,label,actor,kind:cardRollKind(item,execution),sourceItem:item,execution,
        isIntervention:execution.isIntervention,skipPreroll,audienceMessage:source,targetTokens:[]});
      return declareAction({actor,item,label,description:item.system?.description??'',source,execution,
        isIntervention:execution.isIntervention});
    }
    case 'attack': {
      // A selected Projection changes ONLY the spatial origin of this attack;
      // the Actor used to roll and spend resources remains the caster.
      return sendOtherItemAttack(item,actor,{execution,skipPreroll,audienceMessage:source,
        targetTokens:clickTargets,originTokens:clickControlled});
    }
    case 'projection': {
      // Execution is a normal resource/accounting event. Actor creation and
      // token placement are deliberately manual Foundry actions, not spell UI.
      const linked = projectionActorsForAbility(item);
      const description = linked.length ?
        `${esc(text('projectionActorsLabel'))}: ${linked.map(a => esc(a.name)).join(', ')}` :
        esc(text('projectionActorMissing'));
      const result = await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({actor}), ...inheritingAudience(source),
        content: `<strong>${esc(item.name)}</strong> · ${esc(execution.label)}`+
          `<p>${description}</p>`,
        flags: {[ID]: {abilityExecution: {executionId: execution.id,
          actorUuid: actor.uuid, sourceItemUuid: item.uuid},
          projectionResult: {version: 2, actorUuids: linked.map(a => a.uuid)}}}
      });
      if (result) await finishCardAccounting({actor,item,message:result,execution});
      return result;
    }
    case 'roll': {
      const formula=String(execution.formula??itemFormula(item)).trim();
      if(!formula)throw Error(text('missingFormula'));
      return postRoll({formula,label:`${item.name} · ${execution.label}`,actor,
        kind:cardRollKind(item,execution),sourceItem:item,execution,isIntervention:execution.isIntervention,
        skipPreroll,audienceMessage:source,
        targetDefense:execution.targetDefense??item.system?.mechanics?.attack?.targetDefense,
        targetTokens:clickTargets});
    }
    case 'temporaryHp': {
      // A fixed-value effect is not a fake Roll('5'). It publishes its own
      // result with an explicit amount. Dice formulas still use native Roll.
      if(Number.isSafeInteger(execution.amount) && execution.amount>0){
        const expiry=abilityTempHpExpiry(actor,execution,{combat:game.combat,
          worldTime:game.time?.worldTime});
        const result=await ChatMessage.create({
          speaker:ChatMessage.getSpeaker({actor}),...inheritingAudience(source),
          content:`<strong>${esc(item.name)}</strong> · ${esc(execution.label)}`+
            `<p>${esc(text('temporaryHpResult'))}: <strong>${execution.amount}</strong></p>`,
          flags:{[ID]:{
            abilityExecution:{executionId:execution.id,actorUuid:actor.uuid,sourceItemUuid:item.uuid},
            abilityResult:{version:1,kind:'temporaryHp',sourceItemUuid:item.uuid,
              actorUuid:actor.uuid,executionId:execution.id,amount:execution.amount,
              target:execution.target==='self'?'self':'selected',expiry}
          }}
        });
        if(result)await finishCardAccounting({actor,item,message:result,
          execution,isIntervention:execution.isIntervention});
        return result;
      }
      const formula=String(execution.formula??itemFormula(item)).trim();
      if(!formula)throw Error(text('missingFormula'));
      // Share the complete native preroll/finalize/accounting pipeline with
      // ordinary checks; application of the evaluated total remains separate.
      return postRoll({formula,label:`${item.name} · ${execution.label}`,actor,
        kind:cardRollKind(item,execution),sourceItem:item,execution,isIntervention:execution.isIntervention,
        skipPreroll,audienceMessage:source,resultKind:'temporaryHp'});
    }
    case 'effect': {
      const effect=item.effects?.get(execution.effectId);
      if(!effect || effect.transfer===true)throw Error(text('missingEffect'));
      const result=await ChatMessage.create({
        speaker:ChatMessage.getSpeaker({actor}),...inheritingAudience(source),
        content:`<strong>${esc(item.name)}</strong> · ${esc(execution.label)}<p>${esc(effect.name)}</p>`,
        flags:{[ID]:{
          abilityExecution:{executionId:execution.id,actorUuid:actor.uuid,sourceItemUuid:item.uuid},
          abilityResult:{version:1,kind:'effect',sourceItemUuid:item.uuid,actorUuid:actor.uuid,
            executionId:execution.id,effectId:effect.id}
        }}
      });
      if(result)await finishCardAccounting({actor,item,message:result,execution,isIntervention:execution.isIntervention});
      return result;
    }
  }
  return null;
}

const busy=new Set();
export async function applyResultToSelectedActor(message){
  const live=game.messages?.get(message?.id);
  if(!live || !canReadChatContent(live))return null;
  const data=live.getFlag(ID,'abilityResult');
  if(data?.version!==1)return null;
  // A published HP result is independent of the original Item and caster.
  if(data.kind==='temporaryHp'){
    const fixed=Number.isSafeInteger(data.amount)&&data.amount>0 ? data.amount : null;
    const total=fixed??live.rolls?.[0]?.total;
    if(typeof total!=='number' || !Number.isFinite(total))throw Error(text('missingRoll'));
    return applyHp({kind:'temp',amount:Math.max(0,Math.trunc(total)),sourceMessage:live,independent:true});
  }
  const item=await fromUuid(data.sourceItemUuid);
  if(!ownerAbility(item) || (data.actorUuid && item.parent?.uuid!==data.actorUuid))return null;
  // A self-only execution never redirects to a selected or targeted token.
  const actor=data.target==='self' ? item.parent : resolveCardEffectTarget(item,{
    targets:game.user?.targets??[],controlled:canvas?.tokens?.controlled??[]
  });
  if(!isActorOwner(actor))throw Error(text('noTargetPermission'));
  if(data.kind==='effect'){
    const template=item.effects?.get(data.effectId);
    if(!template || template.transfer===true)throw Error(text('missingEffect'));
    return queueActorWrite(actor,()=>applyCardEffect(item,template,actor,{resultMessageId:live.id}));
  }
  return null;
}

function addButton(container,label,click){
  const b=document.createElement('button');b.type='button';b.textContent=label;
  b.className='fnri-ability-chat-button';
  b.addEventListener('click',async event=>{
    const key=`${container.closest('.chat-message')?.dataset?.messageId??'message'}:${label}`;
    if(busy.has(key))return;
    busy.add(key);
    try{await click(event);}catch(error){
      console.error('Fast NRI | ability chat action failed',error);
      ui.notifications?.warn(error?.message||text('actionFailed'));
    }finally{busy.delete(key);}
  });
  container.append(b);
  return b;
}

function showDailyRemaining(node,remaining) {
  node.hidden=remaining==null;
  node.textContent=node.hidden ? '' : game.i18n.format('FASTNRI.AbilityChat.dailyRemaining',{remaining});
}

function refreshDailyRemaining(actor) {
  if (!actor?.uuid) return;
  for (const node of document.querySelectorAll('[data-fnri-ability-remaining]')) {
    if (node.dataset.actorUuid!==actor.uuid) continue;
    const item=isActorOwner(actor) ? actor.items.get(node.dataset.fnriAbilityRemaining) : null;
    showDailyRemaining(node,item ? abilityAccountingStatus(actor,item)?.remaining : null);
  }
}

export function registerAbilityChat(){
  Hooks.on('updateActor',refreshDailyRemaining);
  Hooks.on('updateActorDelta',delta=>refreshDailyRemaining(delta.parent?.actor));
  Hooks.on('updateToken',token=>refreshDailyRemaining(token.actor));
  Hooks.on('renderChatMessageHTML',(message,html)=>{
    if(!html?.querySelector || !canReadChatContent(message))return;
    const publication=message.getFlag?.(ID,'abilityPublication');
    const result=message.getFlag?.(ID,'abilityResult');
    if(publication?.version===1){
      void (async()=>{
        const docs=await documentsForPublication(message);
        if(!docs || !isActorOwner(docs.actor))return;
        html.querySelector('[data-fnri-ability-options]')?.remove();
        const options=document.createElement('section');
        options.dataset.fnriAbilityOptions='';options.className='fnri-ability-chat-options';
        const remaining=abilityAccountingStatus(docs.actor,docs.item)?.remaining;
        if (remaining!=null) {
          const daily=document.createElement('small');
          daily.dataset.fnriAbilityRemaining=docs.item.id;
          daily.dataset.actorUuid=docs.actor.uuid;
          showDailyRemaining(daily,remaining);
          options.append(daily);
        }
        for(const execution of abilityExecutions(docs.item)){
          const row=document.createElement('div');row.className='fnri-ability-chat-option';
          addButton(row,execution.label,event=>executeAbilityFromChat(message,execution.id,{skipPreroll:!!event?.shiftKey}));
          options.append(row);
        }
        if(options.childElementCount) (html.querySelector('.message-content')??html).append(options);
      })().catch(error=>console.warn('Fast NRI | ability message display failed',error));
    }
    if(result?.version===1 && ['temporaryHp','effect'].includes(result.kind)){
      // All readers may see the result, but Actor ownership is checked on apply.
      if(html.querySelector('[data-fnri-ability-apply]'))return;
      const controls=document.createElement('div');controls.dataset.fnriAbilityApply='';
      controls.className='fnri-ability-chat-options';
      addButton(controls,result.kind==='temporaryHp'?text('applyTemporaryHp'):text('applyEffect'),
        ()=>applyResultToSelectedActor(message));
      (html.querySelector('.message-content')??html).append(controls);
    }
  });
}
