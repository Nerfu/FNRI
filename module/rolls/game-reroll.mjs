/** Player-facing, rule-bound rerolls. Never grants access to the GM editor. */
import {naturalAttackingD20} from './attack-core.mjs';
import {chooseByButtons} from './button-choice.mjs';
import {weaponRerollEligible} from '../equipment/weapon-traits.mjs';
import {privateAreaSourceFor} from '../data/private-area-source.mjs';
import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {abilityAccountingStatus,finishCardAccounting} from '../data/ability-accounting.mjs';
import {canExecuteAction,actionSpeaker,escapeActionText as esc} from './action-declaration.mjs';
import {redactActorSourceForAudience} from './roll-context.mjs';
import {getEditorParts,nativeRollView,rollSnapshot,computedRollTotal} from '../damage/roll-editor.mjs';
import {changePart,copy,calculateDamage} from '../damage/damage-core.mjs';
const ID='fast-nri-v14';
const flag=(m,k)=>m?.getFlag?.(ID,k)??m?.flags?.[ID]?.[k];
const l=k=>game.i18n.localize(`FASTNRI.GameReroll.${k}`);
const live=m=>game.messages?.get(m?.id)??null;
const selected=()=>globalThis.canvas?.tokens?.controlled??[];
const active=new Set();
const isTalisman=i=>i?.system?.mechanics?.talisman?.rerollAnyDieExceptD20===true;
const eligible=p=>p.kind==='die'&&!p.noReroll&&!p.pending&&Number.isInteger(p.faces)&&p.faces>=2&&Number.isFinite(p.value);

// A copied damage card on an intervention is not a roll by the defender.
// Its native defense roll, in contrast, belongs to that defender.
export function ownsRerollSource(message,actor,token=null){
  if(!canReadChatContent(message)||!actor)return false;
  const card=flag(message,'weaponDamage');
  const areaResponse=flag(message,'areaIntervention');
  const owner=card?.intervention?.initiatorActorUuid??areaResponse?.initiatorActorUuid??areaResponse?.actorUuid??flag(message,'checkRoll')?.actorUuid??flag(message,'weaponAttack')?.actorUuid??
    flag(message,'itemUseResult')?.actorUuid??flag(message,'manualAction')?.actorUuid??flag(message,'abilityExecution')?.actorUuid??
    flag(message,'gameReroll')?.actorUuid??card?.sourceActorUuid??privateAreaSourceFor(message)?.actor?.uuid;
  if(owner)return owner===actor.uuid;
  const speaker=message.speaker;
  if(actor.isToken)return speaker?.token===(token?.id??token?.document?.id??actor.token?.id)&&speaker?.scene===(token?.document?.parent?.id??actor.token?.parent?.id);
  return !!actor.id&&speaker?.actor===actor.id;
}
export function rerollParts(message,actor,token=null,{ignoreReportId=null}={}){
  // A reroll report is part of its original roll, never a fresh opportunity.
  if(flag(message,'gameReroll')||!ownsRerollSource(message,actor,token))return [];
  const card=flag(message,'weaponDamage'),attack=flag(message,'weaponAttack');
  const rows=[];
  // A source damage snapshot is authoritative. Do not offer its duplicate
  // native Roll; for area roots the first Roll is the separate attack check.
  const root=card?.version===2&&!card.previousMessageId&&!card.intervention&&(!card.areaRootMessageId||card.areaRootMessageId===message.id);
  if(root)for(const p of card.parts??[])if(eligible(p))rows.push({view:'damage',part:p});
  for(const [index,roll] of (message.rolls??[]).entries()){
    if(root&&(!attack||index!==0))continue;
    if(!Number.isFinite(roll.total))continue;
    const view=nativeRollView(message,index);
    for(const p of getEditorParts(view))if(eligible(p))rows.push({view:String(index),part:p});
  }
  // History is shared across ALL gameplay sources, including automatic rerolls.
  // Reports also cover read-only source messages (no source mutation required).
  const reported=new Set();
  for(const report of game.messages?.contents??game.messages?.values?.()??[]){
    if(report.id===ignoreReportId)continue;
    const record=flag(report,'gameReroll');
    if(record?.sourceMessageId===message.id&&canReadChatContent(report))reported.add(JSON.stringify([record.view,record.partId]));
  }
  return rows.filter(({view,part})=>{
    const history=view==='damage'?card.history:flag(nativeRollView(message,Number(view)),'rollEdit')?.history;
    return !part.gameRerolled&&!(history??[]).some(h=>h.gameReroll===true&&h.id===part.id)&&
      !(view==='damage'&&card.weaponLowRerollApplied&&['A','B'].includes(part.profilePart??part.id))&&
      !reported.has(JSON.stringify([view,part.id]));
  });
}
// Rule-specific eligibility: Sweeping base weapon dice, Catalyst spell damage dice.
// Copied defense cards and pending components never qualify.
function weaponRerollOptions(message,parts){
  const card=flag(message,'weaponDamage');
  if(!card||card.previousMessageId||card.intervention)return [];
  const traits=card.gameRerollTraits??{
    sweeping:card.weaponTraitIds?.includes('sweeping')===true,
    catalyst:card.weaponTraitIds?.includes('catalyst')===true};
  return ['sweeping','catalyst'].flatMap(rule=>{
    if(!traits[rule])return [];
    const candidates=parts.filter(({view,part:p})=>view==='damage'&&weaponRerollEligible(p,rule,card.profileKind));
    return candidates.length?[{id:`trait:${rule}`,rule,label:l(rule),parts:candidates,exhausted:false}]:[];
  });
}
// Only the original, unambiguous check d20, not damage, added dice or a GM-edited 1.
function luckParts(message,parts){
  const damage=flag(message,'weaponDamage'),attack=flag(message,'weaponAttack');
  const check=flag(message,'checkRoll');
  const isCheck=!!(attack||check&&!flag(message,'abilityResult')||damage?.intervention||flag(message,'areaIntervention')||flag(message,'manualAction')?.isIntervention);
  if(!isCheck||check?.previousMessageId&&!check.isIntervention||damage&&!attack&&!damage.intervention)return [];
  if((message.rolls?.[0]?.dice??[]).filter(d=>d.faces===20).length!==1||naturalAttackingD20(message.rolls?.[0])!==1)return [];
  return parts.filter(({view,part})=>view==='0'&&part.faces===20&&part.original===1&&part.value===1&&!part.added&&!part.excluded);
}
export function rerollOptions(message,actor,token=null){
  const parts=rerollParts(message,actor,token);
  if(!parts.length)return [];
  const talismanParts=parts.filter(({part})=>part.faces!==20);
  const talismans=talismanParts.length?[...(actor.items?.contents??[])].filter(isTalisman).map(item=>{
    const status=abilityAccountingStatus(actor,item),quantity=item.system?.quantity??1;
    const exhausted=quantity<=0||(status?.used??0)>=(status?.frequency?.uses??1)*quantity;
    return {id:item.id,rule:'talisman',label:item.name,item,parts:talismanParts,exhausted};
  }):[];
  const luck=luckParts(message,parts);
  const lucky=luck.length?[...(actor.items?.contents??[])].filter(item=>item.system?.mechanics?.reroll?.naturalOneD20===true).map(item=>{
    const status=abilityAccountingStatus(actor,item);
    return {id:item.id,rule:'luck',label:item.name,item,parts:luck,exhausted:status?.remaining===0};
  }):[];
  return [...talismans,...lucky,...weaponRerollOptions(message,parts)];
}
function selection(message){
  const tokens=selected();
  if(tokens.length!==1){ui.notifications?.info(l(tokens.length?'multipleTokens':'noToken'));return null;}
  const token=tokens[0],actor=token.actor??token.document?.actor;
  if(!canExecuteAction(actor)||!canReadChatContent(message)){ui.notifications?.info(l('noOptions'));return null;}
  return {token,actor};
}
const sameSelection=(token,actor)=>selected().length===1&&selected()[0]===token&&(token.actor??token.document?.actor)===actor&&canExecuteAction(actor);
const signature=(m,row)=>JSON.stringify([row.view,row.part, row.view==='damage'?flag(m,'weaponDamage')?.revision:flag(nativeRollView(m,Number(row.view)),'rollEdit')]);
const sameAudience=(a,b)=>a.blind===b.blind&&JSON.stringify([...a.whisper].sort())===JSON.stringify([...b.whisper].sort());
function correction(message,row,value,rule){
  if(row.view==='damage'){
    const {next,old,current}=changePart(flag(message,'weaponDamage'),row.part.id,'reroll',value);
    // The reroll never undoes a previous defensive exclusion.
    next.parts.find(p=>p.id===row.part.id).excluded=old.excluded;current.excluded=old.excluded;
    next.revision=(next.revision??0)+1;
    next.history=[...(next.history??[]),{by:game.user.id,at:Date.now(),action:'reroll',id:row.part.id,before:old,after:current,gameReroll:true,rule}];
    return {view:message,patch:{[`flags.${ID}.weaponDamage`]:next},total:next.areaAttack?null:calculateDamage(next).total};
  }
  const view=nativeRollView(message,Number(row.view));
  const state=copy(flag(view,'rollEdit')??rollSnapshot(view));
  const part=state.components.find(p=>p.id===row.part.id);
  const before={value:part.value,excluded:!!part.excluded};part.value=value;
  state.history.push({by:game.user.id,at:Date.now(),action:'reroll',id:part.id,before,after:{value,excluded:!!part.excluded},gameReroll:true,rule});
  if(state.manualTotalOnly)return {view,patch:{[`flags.${ID}.rollEdit`]:state},total:null};
  state.currentTotal=computedRollTotal(state);
  const patch={[`flags.${ID}.rollEdit`]:state};
  const card=flag(message,'weaponDamage');
  // The existing area calculator reads its shared check total from the
  // damage snapshot, not the native-roll correction flag.
  if(row.view==='0'&&flag(message,'weaponAttack')&&card?.areaAttack&&!card.previousMessageId){
    const next=copy(card);next.attackTotal=state.currentTotal;next.areaAttack.attackTotal=state.currentTotal;
    if(rule==='luck'){next.naturalD20=value;next.areaAttack.naturalD20=value;next.naturalTwenty=value===20;}
    next.revision=(next.revision??0)+1;
    patch[`flags.${ID}.weaponDamage`]=next;
  }
  return {view,patch,total:state.currentTotal};
}
/** The only player mutation here is a validated single random die result.
 * No public method accepts a replacement number or arbitrary flag patch. */
export async function executeGameReroll(message,{itemId,view,partId}={}){
  const source=live(message),chosen=selection(source);if(!chosen||active.has(source.id))return null;
  const {actor,token}=chosen;
  const option=rerollOptions(source,actor,token).find(o=>o.id===itemId);
  const row=option?.parts.find(p=>p.view===view&&p.part.id===partId);
  if(!row){ui.notifications?.info(l('noOptions'));return null;}
  active.add(source.id);
  try{
    if(option.exhausted)ui.notifications?.warn(l('exhausted'));
    const before=signature(source,row),audience=chatAudience(source),oldValue=row.part.value;
    const roll=await new Roll(`1d${row.part.faces}`).evaluate();
    const value=roll.total;if(!Number.isInteger(value)||value<1||value>row.part.faces)throw Error('Invalid reroll result');
    const current=live(source);
    // A private source becoming unreadable must not leak its old die in chat.
    if(current&&(!canReadChatContent(current)||!sameAudience(audience,chatAudience(current))))return null;
    const candidate=current&&rerollParts(current,actor,token).find(p=>p.view===view&&p.part.id===partId);
    const next=candidate&&signature(current,candidate)===before?correction(current,candidate,value,option.rule):null;
    const writable=!!next&&sameSelection(token,actor)&&current.canUserModify?.(game.user,'update')===true;
    const redact=redactActorSourceForAudience(actor,audience);
    const content=`<article class="fnri-game-reroll"><strong>${esc(redact?l('title'):option.label)}</strong> · ${esc(l('title'))}<p>1d${row.part.faces}: ${oldValue} → <strong>${value}</strong></p>${next?.total!=null?`<p>${esc(l('newTotal'))}: ${next.total}</p>`:''}<p>${esc(l('keepResult'))}</p><p>${esc(l('manualFollowup'))}</p></article>`;
    const report=await ChatMessage.create({speaker:actionSpeaker(actor,audience),...audience,content,rolls:[roll.toJSON()],flags:{[ID]:{gameReroll:{version:1,rule:option.rule,sourceMessageId:source.id,view,partId,faces:row.part.faces,before:oldValue,value,...(!redact?{actorUuid:actor.uuid}: {})}}}});
    if(!report?.id)return null;
    // Preserve the published result even if source or selection changed while
    // rolling/publishing, or the owner cannot edit the original message.
    const latest=live(source),latestRow=latest&&rerollParts(latest,actor,token,{ignoreReportId:report.id}).find(p=>p.view===view&&p.part.id===partId);
    let updated=false;
    if(writable&&latestRow&&sameSelection(token,actor)&&sameAudience(audience,chatAudience(latest))&&signature(latest,latestRow)===before&&latest.canUserModify?.(game.user,'update')===true){
      try{const fresh=correction(latest,latestRow,value,option.rule);await fresh.view.update(fresh.patch);updated=true;}catch(error){console.warn('Fast NRI | reroll source update failed',error);}
    }
    if(!updated||next?.total==null)ui.notifications?.info(l('manualFollowup'));
    // An independent report is the idempotency key, not the original roll.
    if(option.item)await finishCardAccounting({actor,item:option.item,message:report});
    return {report,value,updated};
  }finally{active.delete(source.id);}
}
export async function openGameReroll(message){
  const source=live(message),chosen=selection(source);if(!chosen)return null;
  const options=rerollOptions(source,chosen.actor,chosen.token);
  if(!options.length){ui.notifications?.info(l('noOptions'));return null;}
  const dialog=foundry.applications.api.DialogV2;
  const picked=await chooseByButtons({title:l('title'),rows:options.map((o,i)=>({value:String(i),label:`${o.label}${o.exhausted?' ⚠ '+l('exhausted'):''}`})),confirmLabel:l('select'),intro:l('opportunity')});
  const option=picked&&options[Number(picked.value)];if(!option)return null;
  const die=await dialog.input({window:{title:l('title')},content:`<label>${esc(l('die'))}<select name="choice">${option.parts.map((p,i)=>`<option value="${i}">${esc(p.view==='damage'?l('damage'):`#${Number(p.view)+1}`)} · ${esc(p.part.formula??`1d${p.part.faces}`)} = ${p.part.value}</option>`).join('')}</select></label>`,ok:{label:l('title')},rejectClose:false});
  const row=option.parts.find((_,i)=>String(i)===String(die?.choice));if(!row)return null;
  if(!sameSelection(chosen.token,chosen.actor)){ui.notifications?.info(l('selectionChanged'));return null;}
  const current=live(source),fresh=current&&rerollParts(current,chosen.actor,chosen.token).find(p=>p.view===row.view&&p.part.id===row.part.id);
  if(!fresh||JSON.stringify(fresh.part)!==JSON.stringify(row.part)){ui.notifications?.info(l('sourceChanged'));return null;}
  return executeGameReroll(source,{itemId:option.id,view:row.view,partId:row.part.id});
}
function contextMessage(element){const id=element?.closest?.('[data-message-id]')?.dataset?.messageId??element?.dataset?.messageId;return id?game.messages?.get(id):null;}
export function registerGameReroll(){
  Hooks.on('getChatMessageContextOptions',(_app,items)=>items.push({label:'FASTNRI.GameReroll.title',icon:'fa-solid fa-dice',visible:el=>{const m=contextMessage(el);return canReadChatContent(m)&&!!(m.rolls?.length||flag(m,'weaponDamage')?.parts?.length);},onClick:async(_event,el)=>{try{await openGameReroll(contextMessage(el));}catch(error){console.error('Fast NRI | game reroll',error);ui.notifications?.error(l('failed'));}}}));
}
