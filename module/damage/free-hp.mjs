/** Independent chat application: read-only source, explicit recipient, existing HP transaction. */
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {applyHp,chooseHpRecipient} from './hp-actions.mjs';
import {calculateDamage} from './damage-core.mjs';
import {resolveAreaResults} from './area-attack.mjs';
import {previewDeclaredDamageDefenses} from './periodic-damage.mjs';
import {chooseRollChoice,rollChoices,getEditorParts,editableMessage,rollSnapshot} from './roll-editor.mjs';
import {isPotionMessage,recordPotionReceipt,potionText} from '../data/potion-resource.mjs';
const ID='fast-nri-v14';
const flag=(m,k)=>m?.getFlag?.(ID,k)??m?.flags?.[ID]?.[k];
const l=k=>game.i18n.localize(`FASTNRI.Damage.${k}`);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const live=m=>game.messages?.get(m?.id)??null;
const checked=v=>[true,'on','true','1',1].includes(v);
export function selectableDice(view){
  if(!canReadChatContent(view)||!editableMessage(view))return [];
  return getEditorParts(view).filter(p=>p.kind==='die'&&!p.pending&&!p.excluded&&Number.isFinite(p.value));
}
// Only explicitly stored source penalties are safe to reuse across targets.
// The dialog exposes this value so the participants can redistribute it.
export function sourceDicePenalty(view){
  return (flag(view,'weaponDamage')?.penaltyComponents??[]).reduce((sum,p)=>sum+(Number.isFinite(p.value)&&p.value<0&&!p.excluded?-p.value:0),0);
}
export function calculateSelectedDice(view,ids,actor,{kind='damage',penalty,resistance=0,vulnerability=0,modifier=0,damageType='',critical}={}){
  if(!canReadChatContent(view))throw Error('Unreadable Roll');
  penalty??=kind==='damage'?sourceDicePenalty(view):0;
  const source=flag(view,'weaponDamage');
  if(!['damage','heal'].includes(kind)||![penalty,resistance,vulnerability].every(v=>Number.isFinite(v)&&v>=0)||!Number.isFinite(modifier))throw Error('Invalid HP adjustments');
  const selected=new Set(ids),parts=selectableDice(view).filter(p=>selected.has(p.id)).map(p=>({...p,immune:false,excluded:false,damageType:p.damageType||source?.damageType||damageType,value:p.value*(p.coefficient??1)}));
  if(!parts.length)return {total:0,complete:true};
  const manualFormula=!source && (flag(view,'rollEdit')??rollSnapshot(view)).manualTotalOnly===true;
  if(kind==='heal')return {total:Math.trunc(Math.max(0,parts.reduce((sum,p)=>sum+p.value,0)+modifier)),complete:!manualFormula};
  // Old target's immunities and numerical defenses are not copied. Keep only
  // intrinsic rules (critical, damage traits, ignoring resistance/temp HP).
  const card={...source,cancelled:false,parts,adjustments:{penalty,resistance:0,vulnerability:0}};
  const defenses=previewDeclaredDamageDefenses(actor,card);
  const immune=new Set(defenses.immunePartIds);
  card.parts=parts.map(p=>({...p,immune:immune.has(p.id)}));
  card.adjustments.resistance=Math.max(resistance,defenses.resistance);
  card.adjustments.vulnerability=Math.max(vulnerability,defenses.vulnerability);
  if(modifier!==0)card.parts.push({id:'manual',kind:'fixed',value:modifier,excluded:false});
  const result=calculateDamage(card,{critical});
  return {...result,total:Math.trunc(result.total),complete:defenses.complete&&!manualFormula,immunePartIds:[...immune]};
}
export function itemHpResults(message){
  if(!canReadChatContent(message))return [];
  const kinds={healHp:'heal',addTempHp:'temp'};
  return (flag(message,'itemUseResult')?.results??[]).flatMap(row=>{
    if(!kinds[row.kind]||row.manual)return [];
    const view=row.rollIndex==null?null:rollChoices(message).find(c=>c.id===String(row.rollIndex))?.message;
    const amount=row.rollIndex==null?row.amount:(flag(view,'rollEdit')?.currentTotal??view?.rolls?.[0]?.total);
    return Number.isFinite(amount)?[{kind:kinds[row.kind],amount:Math.max(0,Math.trunc(amount))}]:[];
  });
}
/** Only already published numerical results, not a guessed area-wide total. */
export function readyHp(message){
  if(!canReadChatContent(message))return null;
  const itemResults=itemHpResults(message);if(itemResults.length===1)return itemResults[0];
  const cover=flag(message,'coverAlly'),recovery=flag(message,'damageRecovery'),card=flag(message,'weaponDamage'),report=flag(message,'hpReport'),receipt=flag(message,'periodicReceipt'),ability=flag(message,'abilityResult');
  if(Number.isFinite(cover?.amount))return {kind:'damage',amount:cover.amount};
  if(Number.isFinite(recovery?.hp))return {kind:'heal',amount:recovery.hp};
  if(Number.isFinite(report?.requested))return {kind:report.kind,amount:report.requested,...(report.ignoreTempHp?{ignoreTempHp:true}:{})};
  if(ability?.kind==='temporaryHp'&&Number.isFinite(ability.amount))return {kind:'temp',amount:ability.amount};
  if(Number.isFinite(receipt?.damage))return {kind:'damage',amount:receipt.damage,ignoreTempHp:true};
  if(card?.version===2&&!card.areaAttack&&!card.parts?.some(p=>p.pending))return {kind:'damage',amount:calculateDamage(card).total,ignoreTempHp:card.damageRules?.ignoreTempHp===true};
  return null;
}
export async function applyIndependentHp(message,{kind,amount,recipient,ignoreTempHp=false}={}){
  if(!canReadChatContent(message)||!['damage','heal','temp'].includes(kind)||!Number.isSafeInteger(amount)||amount<0)return null;
  recipient??=await chooseHpRecipient();
  if(!recipient)return null;
  const current=live(message);
  if(!canReadChatContent(current))return null;
  // The participant selected a placed token, not an Actor resolved from the
  // old attack. Revalidate that it still has the intended Actor and is selected.
  const controlled=globalThis.canvas?.tokens?.controlled??[];
  if(controlled.length!==1||controlled[0]!==recipient.token||(recipient.token.actor??recipient.token.document?.actor)!==recipient.actor){ui.notifications?.warn(l('tokenNotSelected'));return null;}
  const report=await applyHp({kind,amount,sourceMessage:current,token:recipient.token,actor:recipient.actor,independent:true,ignoreTempHp});
  if(report?.id && ['heal','temp'].includes(kind) && isPotionMessage(current) && itemHpResults(current).some(row=>row.kind===kind)){
    try{await recordPotionReceipt(recipient.actor,current);}
    catch(error){console.warn('Fast NRI | potion receipt pending',error);ui.notifications?.warn(potionText('receiptFailed'));}
  }
  return report;
}
const active=new Set();
async function guarded(message,fn){
  if(!canReadChatContent(message)||active.has(message.id))return;
  active.add(message.id);try{return await fn();}catch(error){console.error('Fast NRI | independent HP',error);ui.notifications?.error(error.message);}finally{active.delete(message.id);}
}
const isArea=m=>!!(flag(m,'weaponDamage')?.areaAttack||flag(m,'areaResult'));
const channels=(kind,types=['damage','heal','temp'])=>`<label>${esc(l('hpChannel'))}<select name="kind" required><option value="" ${types.includes(kind)?'':'selected'}>${esc(l('selectHpChannel'))}</option>${types.map(k=>`<option value="${k}" ${k===kind?'selected':''}>${esc(l(k))}</option>`).join('')}</select></label>`;
export async function openFreeHp(message){return guarded(message,async()=>{
  const recipient=await chooseHpRecipient();if(!recipient)return;
  let initial=readyHp(message);
  const itemRows=itemHpResults(message);
  if(itemRows.length>1){
    const selection=await foundry.applications.api.DialogV2.input({window:{title:l('applyFreeHp')},content:`<select name="row"><option value="manual">${esc(l('manualAmount'))}</option>${itemRows.map((r,i)=>`<option value="${i}">${esc(l(r.kind))}: ${r.amount}</option>`).join('')}</select>`,ok:{label:l('select')},rejectClose:false});
    if(!selection)return;
    if(selection.row!=='manual')initial=itemRows[Number(selection.row)]??null;
  }
  const area=flag(message,'areaResult');
  const areaRows=area?.results??(flag(message,'weaponDamage')?.areaAttack?.version===1?resolveAreaResults(message,[]):null);
  if(!initial&&areaRows){
    const rows=areaRows.filter(r=>Number.isFinite(r.damage));
    if(rows.length){
      const input=await foundry.applications.api.DialogV2.input({window:{title:l('applyFreeHp')},content:`<label>${esc(l('selectPublishedAmount'))}<select name="row"><option value="manual">${esc(l('manualAmount'))}</option>${rows.map((r,i)=>`<option value="${i}">${esc(r.name)}: ${esc(r.damage)}</option>`).join('')}</select></label>`,ok:{label:l('select')},rejectClose:false});
      if(!input)return;
      if(input.row!=='manual'&&rows[Number(input.row)])initial={kind:'damage',amount:rows[Number(input.row)].damage};
    }
  }else if(!initial&&!itemRows.length&&!isArea(message)&&editableMessage(message)){
    const choice=await chooseRollChoice(message);if(!choice)return;
    initial={kind:flag(message,'abilityResult')?.kind==='temporaryHp'?'temp':null,amount:flag(choice.message,'rollEdit')?.currentTotal??choice.message.rolls?.[0]?.total??null};
  }
  const input=await foundry.applications.api.DialogV2.input({window:{title:l('applyFreeHp')},content:`<p>${esc(recipient.name)}</p>${channels(initial?.kind)}<label>${esc(l('value'))}<input name="amount" type="number" min="0" step="1" value="${esc(initial?.amount==null?'':Math.max(0,Math.trunc(initial.amount)))}"></label>`,ok:{label:l('applyFreeHp')},rejectClose:false});
  if(!input||String(input.amount??'').trim()==='')return;
  return applyIndependentHp(message,{kind:input.kind,amount:Number(input.amount),recipient,ignoreTempHp:initial?.ignoreTempHp===true});
});}
function fingerprint(view){return JSON.stringify({parts:selectableDice(view),card:flag(view,'weaponDamage'),edit:flag(view,'rollEdit')});}
export async function openPartialDice(message){return guarded(message,async()=>{
  const choice=await chooseRollChoice(message);if(!choice)return;
  const view=choice.message;
  const parts=selectableDice(view);if(!parts.length){ui.notifications?.warn(l('selectDiceFirst'));return;}
  const snapshot=fingerprint(view);
  const recipient=await chooseHpRecipient();if(!recipient)return;
  const content=`<p>${esc(recipient.name)}</p>${channels(flag(view,'weaponDamage')?'damage':null,['damage','heal'])}<fieldset><legend>${esc(l('component'))}</legend>${parts.map((p,i)=>`<label><input type="checkbox" name="die${i}" checked> ${esc(p.formula)}: ${esc(p.value)} ${esc(p.damageType??'')}</label>`).join('')}</fieldset><label>${esc(l('damageType'))}<input name="damageType" type="text"></label>${['penalty','resistance','vulnerability','modifier'].map(k=>`<label>${esc(l(k==='modifier'?'totalCorrection':k))}<input type="number" name="${k}" value="${k==='penalty'?esc(sourceDicePenalty(view)):0}" step="1" ${k==='modifier'?'':'min="0"'}></label>`).join('')}<p>${esc(l('partialDiceHint'))}</p>`;
  const dialog=foundry.applications.api.DialogV2;
  const input=await dialog.input({window:{title:l('applyPartialDice')},content,ok:{label:l('partialPreview')},rejectClose:false});
  if(!input)return;
  const ids=parts.filter((p,i)=>checked(input[`die${i}`])).map(p=>p.id);
  if(!ids.length){ui.notifications?.warn(l('selectDiceFirst'));return;}
  const currentView=()=>{const m=live(message);return canReadChatContent(m)?rollChoices(m).find(c=>c.id===choice.id)?.message:null;};
  const fresh=currentView();
  if(!fresh||fingerprint(fresh)!==snapshot){ui.notifications?.warn(l('error'));return;}
  const opts={kind:input.kind,damageType:String(input.damageType??''),...Object.fromEntries(['penalty','resistance','vulnerability','modifier'].map(k=>[k,Number(input[k]??0)]))};
  const result=calculateSelectedDice(fresh,ids,recipient.actor,opts);
  const explanation=[`${l(input.kind)}: ${result.total}`,result.immunePartIds?.length?`${l('partialImmuneDice')}: ${result.immunePartIds.length}`:'',result.resistance?`${l('resistance')}: ${result.resistance}`:'',result.vulnerability?`${l('vulnerability')}: ${result.vulnerability}`:'',result.multiplier>1?`×${result.multiplier}`:'',!result.complete?l('partialDefenseIncomplete'):''].filter(Boolean);
  const ok=await dialog.confirm({window:{title:l('applyPartialDice')},content:`<p>${esc(recipient.name)}</p>${explanation.map(x=>`<p>${esc(x)}</p>`).join('')}`,rejectClose:false});
  if(!ok)return;
  const latest=currentView();
  if(!latest||fingerprint(latest)!==snapshot||JSON.stringify(calculateSelectedDice(latest,ids,recipient.actor,opts))!==JSON.stringify(result)){ui.notifications?.warn(l('error'));return;}
  return applyIndependentHp(message,{kind:input.kind,amount:result.total,recipient,ignoreTempHp:flag(latest,'weaponDamage')?.damageRules?.ignoreTempHp===true});
});}
function contextMessage(element){const id=element?.closest?.('[data-message-id]')?.dataset?.messageId??element?.dataset?.messageId;return game.messages?.get(id);}
export function registerFreeHp(){
  Hooks.on('renderChatMessageHTML',(message,html)=>{
    if(!html?.querySelector||!isPotionMessage(message)||html.querySelector('[data-fnri-potion-receipt]'))return;
    const button=document.createElement('button');button.type='button';button.className='fnri-damage-button';button.dataset.fnriPotionReceipt='';button.textContent=potionText('receive');
    button.addEventListener('click',()=>void guarded(message,async()=>{
      const recipient=await chooseHpRecipient();if(!recipient)return;
      const result=await recordPotionReceipt(recipient.actor,message);
      if(result)ui.notifications?.info(potionText(result.duplicate?'alreadyReceived':'received'));
    }));
    (html.querySelector('.message-content')??html).append(button);
  });
  Hooks.on('renderChatMessageHTML',(message,html)=>{
    if(!html?.querySelector||!itemHpResults(message).length||html.querySelector('[data-fnri-item-hp]'))return;
    const button=document.createElement('button');button.type='button';button.className='fnri-damage-button';button.dataset.fnriItemHp='';button.textContent=l('applyFreeHp');
    button.addEventListener('click',()=>void openFreeHp(message));(html.querySelector('.message-content')??html).append(button);
  });
  Hooks.on('getChatMessageContextOptions',(_app,items)=>{
  items.push({label:'FASTNRI.Damage.applyFreeHp',icon:'fa-solid fa-heart-pulse',visible:el=>canReadChatContent(contextMessage(el)),onClick:(_event,el)=>void openFreeHp(contextMessage(el))});
  items.push({label:'FASTNRI.Damage.applyPartialDice',icon:'fa-solid fa-list-check',visible:el=>{const msg=contextMessage(el);return canReadChatContent(msg)&&editableMessage(msg)&&rollChoices(msg).some(c=>selectableDice(c.message).length>0);},onClick:(_event,el)=>void openPartialDice(contextMessage(el))});
});}
