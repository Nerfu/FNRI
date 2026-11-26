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
import {abilityAccountingStatus,abilityCostPreview,finishCardAccounting,queueActorWrite,chargedWeaponRemaining} from '../data/ability-accounting.mjs';
import {applyHp} from '../damage/hp-actions.mjs';
import {abilityTempHpExpiry} from './temporary-hp-cast.mjs';
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {createPrivateAreaSourceMessage,privateAreaSourceFor,createSpellResultMessage} from '../data/private-area-source.mjs';
import {declareAction,actionText,actionAudience} from '../rolls/action-declaration.mjs';
import {cardRollKind} from '../rolls/roll-contributions.mjs';
import {postRoll,itemFormula} from '../rolls/checks.mjs';
import {redactActorSourceForAudience} from '../rolls/roll-context.mjs';
import {isAreaAttack,effectiveWeaponProperties,CHECK_DEFENSES} from '../rolls/attack-properties.mjs';
import {resolveAbilityWeapon} from '../equipment/weapon-traits.mjs';
import {projectionActorsForAbility,resolveSpellOrigin} from '../projection/projection.mjs';
import {sendOtherItemAttack} from '../weapon/weapon-attack.mjs';
import {resolveCardEffectTarget,applyCardEffect} from '../effects/apply-card-effect.mjs';
import {directedSpellSpatialContext} from '../spatial/spatial-context.mjs';
import {spellWeaponOptions,directedSpellRange,spellExecutionRule} from '../spatial/spell-range.mjs';
import {weaponTraitOptions} from '../equipment/weapon-traits.mjs';

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
  if(!result.length && !item.system?.mechanics?.attackAugment)result.push({id:'manual-use',type:'manual',label:itemFormula(item)?text('rollAction'):text('manualApply'),
    isIntervention:item.system?.mechanics?.isIntervention===true});
  return result;
}

export function abilityExecution(item,id){return abilityExecutions(item).find(e=>e.id===id)??null;}

function inheritingAudience(message){return {whisper:[...(message.whisper??[])],blind:!!message.blind};}

function costMessages(actor,item,execution,options={}){
  return abilityCostPreview(actor,item,execution,options).map(warning=>{
    const name=actor.system?.resources?.[warning.resourceId]?.name || warning.resourceName || warning.resourceId;
    const resource=name ? ` (${name})` : '';
    return (warning.reason==='insufficient'?text('insufficient'):
      (warning.reason==='intervention-resource-unknown'||warning.reason==='missing'&&warning.scope==='common')?text('unassignedIntervention'):
        warning.reason==='ambiguous'?text('ambiguousResource'):warning.reason==='kindMismatch'?text('resourceKindMismatch'):text('unavailable'))+resource;
  });
}

function executionWarnings(actor,item,execution,options={}){
  const warnings=costMessages(actor,item,execution,options);
  const status=abilityAccountingStatus(actor,item);
  if(status?.remaining===0)warnings.push(text('noDailyUses'));
  if(status?.cooldownRemainingRounds>0)warnings.push(game.i18n.format('FASTNRI.AbilityChat.roundCooldown',{rounds:status.cooldownRemainingRounds}));
  return [...new Set(warnings)];
}
export function abilityChatVariants(actor,item){
  const rows=[];
  for(const execution of abilityExecutions(item)){
    const rule=spellExecutionRule(item,execution);
    const warnings=executionWarnings(actor,item,execution);
    const weapons=rule?spellWeaponOptions(actor,rule):[];
    if(!weapons.length){rows.push({executionId:execution.id,label:execution.label,
      ...(rule?{spellWeaponId:null}:{}),warnings:rule?warnings:[]});continue;}
    const distanceDetails=weapon=>{const distance=directedSpellRange(actor,rule,weapon,{advisory:true});return distance===null?[]:[game.i18n.format('FASTNRI.AbilityChat.spellDistance',{distance})];};
    for(const option of weapons){
      const weapon=option.weapon;
      const details=[...distanceDetails(weapon),
        ...weaponTraitOptions(weapon).filter(t=>!['spellweapon','charged'].includes(t.id)).map(t=>t.label)];
      rows.push({executionId:execution.id,spellWeaponId:weapon.id,held:option.held,
        label:`${execution.label} · ${weapon.name}`,details:details.join(' · '),
        warnings:[...warnings,...option.warnings.map(key=>text(key))]});
      if(weaponTraitOptions(weapon).some(t=>t.id==='charged')){
        const chargeWarnings=executionWarnings(actor,item,execution,{chargedWeaponUuid:weapon.uuid});
        if(chargedWeaponRemaining(actor,weapon)===0)chargeWarnings.push(text('chargedExhausted'));
        rows.push({executionId:execution.id,spellWeaponId:weapon.id,charged:true,held:option.held,
          label:`${execution.label} · ${weapon.name} — ${text('chargedOption')}`,
          details:[...details,text('chargedNoClassCost')].join(' · '),
          warnings:[...chargeWarnings,...option.warnings.map(key=>text(key))]});
      }
    }
    rows.push({executionId:execution.id,spellWeaponId:null,label:`${execution.label} · ${text('noSpellWeapon')}`,
      details:distanceDetails(null).join(' · '),warnings});
  }
  // Readiness order across authored executions, not only inside each group.
  // Stable sort preserves authored order within equal readiness.
  const group=row=>row.held===true?0:row.held===false?1:2;
  return rows.sort((a,b)=>group(a)-group(b)||
    (a.held===b.held&&a.held!==undefined?a.warnings.length-b.warnings.length:0));
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
  const raw=String(item.system?.description || item.system?.effect || item.system?.notes || '').trim();
  // Use Foundry's native enrichment for rich descriptions, UUID links and
  // secret blocks; a plain escaped fallback is used if the API is unavailable.
  const enriched=raw && foundry.applications?.ux?.TextEditor?.enrichHTML
    ? await foundry.applications.ux.TextEditor.enrichHTML(raw,{secrets:false,relativeTo:item}) :
      esc(raw).replace(/\r?\n/g,'<br>');
  const description=raw ? `<div class="fnri-ability-description">${enriched}</div>` :
    `<p>${esc(text('noDescription'))}</p>`;
  const audience=actionAudience();
  const executions=abilityExecutions(item);
  const privateSource=redactActorSourceForAudience(actor,audience) && executions.some(execution=>{
    if(execution.type!=='attack')return false;
    const rule={...item.system.mechanics.attack,...execution.attack};
    const weapon=rule.kind==='physical' ? resolveAbilityWeapon(item,actor) : null;
    return isAreaAttack([rule.properties,weapon&&effectiveWeaponProperties(weapon.system)].filter(Boolean).join(', '));
  });
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
export async function executeAbilityFromChat(message,executionId,{skipPreroll=false,spellWeaponId=undefined,charged=false}={}){
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
  if(!execution) {
    if(executionId==='manual-use' && item.system?.mechanics?.attackAugment)return null;
    throw Error(text('missingExecution'));
  }
  // Source data is reread after publication; costs and active effects are never
  // copied into the ChatMessage. A warning does not prohibit the action.
  const rule=spellExecutionRule(item,execution);
  let spellCast=null,chosenWeapon=null;
  if(rule){
    const rows=abilityChatVariants(actor,item).filter(row=>row.executionId===executionId);
    // A stale/deleted or now incompatible source is not silently replaced.
    // Refresh the options; the independent no-weapon path stays available.
    const variant=rows.find(row=>row.spellWeaponId===(spellWeaponId??null)&&Boolean(row.charged)===charged);
    if(!variant){ui.notifications?.warn(text('spellWeaponChanged'));return null;}
    spellWeaponId=variant.spellWeaponId;
    const weapon=chosenWeapon=spellWeaponId===null?null:spellWeaponOptions(actor,rule).find(row=>row.weapon.id===spellWeaponId)?.weapon;
    spellCast={spellWeaponUuid:weapon?.uuid??null,spellRange:directedSpellRange(actor,rule,weapon,{advisory:true}),
      ...(charged?{chargedWeaponUuid:weapon.uuid}:{})};
    if(variant.warnings.length)ui.notifications?.warn(variant.warnings.join(' · '));
  } else if(spellWeaponId!==undefined||charged)return null;
  const chargedWeaponUuid=spellCast?.chargedWeaponUuid??null;
  // Keep the same accounting identity on every result, including manual
  // and effect executions, so recovery cannot charge the wrong price.
  const executionFlag={executionId:execution.id,actorUuid:actor.uuid,sourceItemUuid:item.uuid};
  const publishResult=data=>createSpellResultMessage(data,actor,{spellCast,executionId:execution.id,itemUuid:item.uuid,
    redacted:redactActorSourceForAudience(actor,source)});
  const spellLabel=chosenWeapon?`${execution.label} · ${chosenWeapon.name}${charged?` — ${text('chargedOption')}`:''}`:execution.label;
  // Non-attack range applies only to an authored directed recipient. Area,
  // self and manual-placement cases keep their existing independent handling.
  const directed=execution.target==='selected'||rule?.target==='selected'||CHECK_DEFENSES.includes(execution.targetDefense);
  const spatialInfo=execution.type!=='attack'&&directed&&execution.target!=='self'&&rule?.target!=='self'&&Number.isFinite(spellCast?.spellRange)?
    directedSpellSpatialContext({origin:resolveSpellOrigin(actor,{controlled:clickControlled}),targetTokens:clickTargets,
      spellRange:spellCast.spellRange,properties:rule.properties??item.system.tags}):null;
  const rolled=execution.type==='roll'||execution.type==='temporaryHp'&&!(Number.isSafeInteger(execution.amount)&&execution.amount>0)||execution.type==='manual'&&!!itemFormula(item);
  if(spatialInfo?.spellRangeWarning&&(!rolled||skipPreroll))ui.notifications?.warn(spatialInfo.spellRangeWarning);
  const rollSpellOptions=spellCast?{spellCast,weaponItem:chosenWeapon,declaredSpellWeapon:true,spatialInfo}:{};
  switch(execution.type){
    case 'manual': {
      const label=chosenWeapon?`${item.name} · ${spellLabel}`:item.name,formula=itemFormula(item);
      if(formula)return postRoll({formula,label,actor,kind:cardRollKind(item,execution),sourceItem:item,execution,
        isIntervention:execution.isIntervention,skipPreroll,audienceMessage:source,targetTokens:[],...rollSpellOptions});
      return declareAction({actor,item,label,description:item.system?.description??'',source,execution,
        isIntervention:execution.isIntervention,spellCast});
    }
    case 'attack': {
      // A selected Projection changes ONLY the spatial origin of this attack;
      // the Actor used to roll and spend resources remains the caster.
      return sendOtherItemAttack(item,actor,{execution,skipPreroll,audienceMessage:source,
        targetTokens:clickTargets,originTokens:clickControlled,spellWeaponId,charged});
    }
    case 'projection': {
      // Execution is a normal resource/accounting event. Actor creation and
      // token placement are deliberately manual Foundry actions, not spell UI.
      const linked = projectionActorsForAbility(item);
      const description = linked.length ?
        `${esc(text('projectionActorsLabel'))}: ${linked.map(a => esc(a.name)).join(', ')}` :
        esc(text('projectionActorMissing'));
      const result = await publishResult({
        speaker: ChatMessage.getSpeaker({actor}), ...inheritingAudience(source),
        content: `<strong>${esc(item.name)}</strong> · ${esc(spellLabel)}`+
          `<p>${description}</p>`,
        flags: {[ID]: {abilityExecution: executionFlag,
          projectionResult: {version: 2, actorUuids: linked.map(a => a.uuid)}}}
      });
      if (result) await finishCardAccounting({actor,item,message:result,execution,chargedWeaponUuid});
      return result;
    }
    case 'roll': {
      const formula=String(execution.formula??itemFormula(item)).trim();
      if(!formula)throw Error(text('missingFormula'));
      return postRoll({formula,label:`${item.name} · ${spellLabel}`,actor,
        kind:cardRollKind(item,execution),sourceItem:item,execution,isIntervention:execution.isIntervention,
        skipPreroll,audienceMessage:source,
        targetDefense:execution.targetDefense??item.system?.mechanics?.attack?.targetDefense,
        targetTokens:clickTargets,...rollSpellOptions});
    }
    case 'temporaryHp': {
      // A fixed-value effect is not a fake Roll('5'). It publishes its own
      // result with an explicit amount. Dice formulas still use native Roll.
      if(Number.isSafeInteger(execution.amount) && execution.amount>0){
        const expiry=abilityTempHpExpiry(actor,execution,{combat:game.combat,
          worldTime:game.time?.worldTime});
        const result=await publishResult({
          speaker:ChatMessage.getSpeaker({actor}),...inheritingAudience(source),
          content:`<strong>${esc(item.name)}</strong> · ${esc(spellLabel)}`+
            `<p>${esc(text('temporaryHpResult'))}: <strong>${execution.amount}</strong></p>`,
          flags:{[ID]:{
            abilityExecution:executionFlag,
            abilityResult:{version:1,kind:'temporaryHp',sourceItemUuid:item.uuid,
              actorUuid:actor.uuid,executionId:execution.id,amount:execution.amount,
              target:execution.target==='self'?'self':'selected',expiry}
          }}
        });
        if(result)await finishCardAccounting({actor,item,message:result,
          execution,isIntervention:execution.isIntervention,chargedWeaponUuid});
        return result;
      }
      const formula=String(execution.formula??itemFormula(item)).trim();
      if(!formula)throw Error(text('missingFormula'));
      // Share the complete native preroll/finalize/accounting pipeline with
      // ordinary checks; application of the evaluated total remains separate.
      return postRoll({formula,label:`${item.name} · ${spellLabel}`,actor,
        kind:cardRollKind(item,execution),sourceItem:item,execution,isIntervention:execution.isIntervention,
        skipPreroll,audienceMessage:source,resultKind:'temporaryHp',...rollSpellOptions});
    }
    case 'effect': {
      const effect=item.effects?.get(execution.effectId);
      if(!effect || effect.transfer===true)throw Error(text('missingEffect'));
      const result=await publishResult({
        speaker:ChatMessage.getSpeaker({actor}),...inheritingAudience(source),
        content:`<strong>${esc(item.name)}</strong> · ${esc(spellLabel)}<p>${esc(effect.name)}</p>`,
        flags:{[ID]:{
          abilityExecution:executionFlag,
          abilityResult:{version:1,kind:'effect',sourceItemUuid:item.uuid,actorUuid:actor.uuid,
            executionId:execution.id,effectId:effect.id}
        }}
      });
      if(result)await finishCardAccounting({actor,item,message:result,execution,isIntervention:execution.isIntervention,chargedWeaponUuid});
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

// Rendering is local to readers who may execute the source. An older async
// UUID lookup must not replace a newer option list after an equipment update.
const publicationRender=new WeakMap();
export async function renderAbilityPublication(message,html){
  if(!html?.querySelector)return;
  const request={};publicationRender.set(html,request);
  if(!canReadChatContent(message)){
    html.querySelector('[data-fnri-ability-options]')?.remove();return;
  }
  const docs=await documentsForPublication(message);
  if(publicationRender.get(html)!==request)return;
  html.querySelector('[data-fnri-ability-options]')?.remove();
  if(!docs || !canReadChatContent(message) || !isActorOwner(docs.actor))return;
  const options=document.createElement('section');
  options.dataset.fnriAbilityOptions='';options.dataset.actorUuid=docs.actor.uuid;options.className='fnri-ability-chat-options';
  const remaining=abilityAccountingStatus(docs.actor,docs.item)?.remaining;
  if (remaining!=null) {
    const daily=document.createElement('small');
    daily.dataset.fnriAbilityRemaining=docs.item.id;
    daily.dataset.actorUuid=docs.actor.uuid;
    showDailyRemaining(daily,remaining);
    options.append(daily);
  }
  for(const variant of abilityChatVariants(docs.actor,docs.item)){
    const row=document.createElement('div');row.className='fnri-ability-chat-option';
    const button=addButton(row,variant.label,async event=>{
      try{return await executeAbilityFromChat(message,variant.executionId,
        {skipPreroll:!!event?.shiftKey,spellWeaponId:variant.spellWeaponId,charged:variant.charged===true});}
      finally{await renderAbilityPublication(game.messages?.get(message.id)??message,html);}
    });
    // Readiness is advisory. Never disable a button for an unmet rule.
    if(variant.details){const detail=document.createElement('small');detail.textContent=variant.details;button.append(detail);}
    if(variant.warnings.length){const warning=document.createElement('small');warning.className='fnri-spell-option-warning';
      warning.textContent=`⚠ ${variant.warnings.join(' · ')}`;button.append(warning);}
    options.append(row);
  }
  if(options.childElementCount) (html.querySelector('.message-content')??html).append(options);
}
function refreshPublicationOptions(actor){
  if(!actor?.uuid||typeof document==='undefined')return;
  for(const node of document.querySelectorAll('[data-fnri-ability-options]')){
    if(node.dataset.actorUuid!==actor.uuid)continue;
    const html=node.closest('.chat-message');
    const message=game.messages?.get(html?.dataset?.messageId);
    if(message)void renderAbilityPublication(message,html).catch(error=>console.warn('Fast NRI | ability message refresh failed',error));
  }
}

export function registerAbilityChat(){
  Hooks.on('updateActor',refreshPublicationOptions);
  Hooks.on('updateActorDelta',delta=>refreshPublicationOptions(delta.parent?.actor));
  Hooks.on('updateToken',token=>refreshPublicationOptions(token.actor));
  for(const hook of ['createItem','updateItem','deleteItem'])Hooks.on(hook,item=>refreshPublicationOptions(item.parent));
  Hooks.on('updateActor',refreshDailyRemaining);
  Hooks.on('updateActorDelta',delta=>refreshDailyRemaining(delta.parent?.actor));
  Hooks.on('updateToken',token=>refreshDailyRemaining(token.actor));
  Hooks.on('renderChatMessageHTML',(message,html)=>{
    if(!html?.querySelector)return;
    if(!canReadChatContent(message)){
      // Invalidate pending owner-only renders if native visibility changed.
      publicationRender.set(html,{});
      html.querySelector('[data-fnri-ability-options]')?.remove();
      html.querySelector('[data-fnri-ability-apply]')?.remove();
      return;
    }
    const publication=message.getFlag?.(ID,'abilityPublication');
    const result=message.getFlag?.(ID,'abilityResult');
    if(publication?.version===1){
      void renderAbilityPublication(message,html).catch(error=>console.warn('Fast NRI | ability message display failed',error));
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
