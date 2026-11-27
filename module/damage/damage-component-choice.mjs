/** Player-side relocation of an already resolved component effect, not a roll editor.
 * Effect producers opt in with a selection descriptor in their audit entry.
 * No resource is spent here. */
import {canReadChatContent} from '../data/chat-visibility.mjs';
import {copy,calculateDamage} from './damage-core.mjs';
import {coverComponentChoice,coverComponentPatch} from './cover-ally.mjs';
import {coverRecords} from './cover-ally-state.mjs';
import {areaComponentChoices,publishAreaComponentChoice} from './area-attack.mjs';
const ID='fast-nri-v14';
const l=k=>game.i18n.localize(`FASTNRI.Damage.${k}`);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const cardOf=m=>m?.getFlag?.(ID,'weaponDamage')??m?.flags?.[ID]?.weaponDamage;
const descriptor=h=>h?.selection;
const mode=rule=>rule?.kind==='exclude'?'exclude':rule?.kind==='set'&&Number.isFinite(rule.value)?'set':null;
const eligible=p=>p&&!p.immune&&!p.pending&&Number.isFinite(p.value)&&(p.kind==='die'&&p.value>=0||p.kind==='fixed'&&p.value>0);
function recordedChoices(card){
  if(card?.version!==2||card.cancelled||card.postDefenseOrigin||card.areaAttack)return [];
  const history=card.history??[];
  const end=history.findLastIndex(h=>h.action==='intervention');
  if(end<0)return [];
  const start=history.slice(0,end).findLastIndex(h=>h.action==='intervention')+1;
  return history.slice(start,end).flatMap((entry,i)=>{
    const index=start+i, rule=descriptor(entry),kind=mode(rule);
    if(!kind||entry.action!==kind)return [];
    const latest=history.slice(end+1).findLast(h=>h.action==='moveComponentChoice'&&h.selectionIndex===index)??entry;
    const current=card.parts?.find(p=>p.id===latest.id);
    if(!eligible(current)||!Number.isFinite(latest.before?.value))return [];
    if(kind==='set'&&(current.value!==rule.value||rule.noReroll===true&&!current.noReroll||current.excluded))return [];
    if(kind==='exclude'&&(!current.excluded||current.value!==latest.before.value))return [];
    // A later GM edit of this part is not silently undone, even if it happens
    // to leave the same value. A move is a choice, not an unrestricted editor.
    const lastIndex=history.lastIndexOf(latest);
    if(history.slice(lastIndex+1).some(h=>h.action!=='moveComponentChoice'&&h.id===current.id&&['set','reset','reroll','exclude','restore'].includes(h.action)))return [];
    return [{index,name:entry.name,rule,kind,currentId:current.id,restoreValue:latest.before.value,restoreNoReroll:latest.before.noReroll===true}];
  });
}
const restore=(p,c)=>{if(c.kind==='exclude')p.excluded=false;else{p.value=c.restoreValue;if(c.restoreNoReroll)p.noReroll=true;else delete p.noReroll;}};
const accepts=(p,c)=>eligible(p)&&!p.excluded&&(c.kind==='exclude'||p.value>=1&&!p.noReroll);
function choicePlan(card,choice,targetId,all){
  if(choice.currentId===targetId)return null;
  const next=copy(card),old=next.parts.find(p=>p.id===choice.currentId),target=next.parts.find(p=>p.id===targetId);
  if(!old||!target)return null;
  const other=all.find(c=>c.index!==choice.index&&c.currentId===targetId);
  restore(old,choice);
  // If two effects select components on the same result, move them together
  // rather than losing one effect or charging it twice. Unrecorded exclusions
  // (immunity, earlier defense, GM correction) never become candidates.
  if(other?.kind==='exclude'&&choice.kind==='set')return null;
  if(other)restore(target,other);
  if(!accepts(target,choice)||other&&!accepts(old,other))return null;
  const moves=[];
  const apply=(c,p,from)=>{
    const before={value:p.value,excluded:!!p.excluded,noReroll:!!p.noReroll};
    if(c.kind==='exclude')p.excluded=true;
    else {p.value=c.rule.value;if(c.rule.noReroll===true)p.noReroll=true;}
    moves.push({action:'moveComponentChoice',selectionIndex:c.index,id:p.id,from,
      before,after:{value:p.value,excluded:!!p.excluded},by:globalThis.game?.user?.id,at:Date.now()});
  };
  apply(choice,target,old.id);
  if(other)apply(other,old,target.id);
  next.history.push(...moves);
  next.revision=(card.revision??0)+1;
  if(Number.isFinite(next.intervention?.damageReduction))next.intervention.damageReduction=Math.max(0,next.intervention.damageReduction+calculateDamage(card).total-calculateDamage(next).total);
  return next;
}
export function componentChoices(card){
  const all=recordedChoices(card);
  return all.flatMap(c=>{
    const candidates=(card.parts??[]).flatMap(p=>{
      if(!choicePlan(card,c,p.id,all))return [];
      const other=all.find(x=>x.index!==c.index&&x.currentId===p.id);
      return [{id:p.id,formula:p.formula,value:other?.restoreValue??p.value,damageType:p.damageType,traits:[...(p.traits??[])]}];
    });
    return candidates.length?[{...c,candidates}]:[];
  });
}
export function moveComponentChoice(card,index,partId){
  const all=recordedChoices(card),choice=all.find(c=>c.index===index);
  return choice?choicePlan(card,choice,partId,all):null;
}
function writable(message){
  if(!canReadChatContent(message)||!game.user)return false;
  return typeof message.canUserModify==='function'?message.canUserModify(game.user,'update')===true:!!(game.user.isGM||message.isAuthor);
}
const choicesOf=message=>{
  const cover=coverComponentChoice(message);
  if(cover)return [{index:'cover',name:game.i18n.localize('FASTNRI.CoverAlly.name'),currentId:cover.record.partId,candidates:cover.candidates}];
  // Do not invalidate already published transfer records by silently changing
  // their source revision. The transfer itself can be edited on its own card.
  if(cardOf(message)&&coverRecords(message).some(r=>r.sourceId===message.id))return [];
  return componentChoices(cardOf(message));
};
const areaMessage=m=>!!(cardOf(m)?.areaAttack||m?.getFlag?.(ID,'areaResult'));
const choicesFor=m=>areaMessage(m)?areaComponentChoices(m):writable(m)?choicesOf(m):[];
export const canMoveComponentChoice=message=>canReadChatContent(message)&&choicesFor(message).length>0;
const active=new Set();
export async function openComponentChoice(message){
  if(!canMoveComponentChoice(message)||active.has(message.id))return null;
  active.add(message.id);
  try{
    const fingerprint=m=>JSON.stringify([cardOf(m),m?.getFlag?.(ID,'coverAlly'),m?.getFlag?.(ID,'areaResult'),choicesFor(m)]);
    const snapshot=fingerprint(message),choices=choicesFor(message);
    const options=choices.flatMap(c=>c.candidates.map((p,i)=>({key:`${c.index}:${i}`,index:c.index,partId:p.id,label:[c.name,`${p.formula??p.id} · ${p.value}`,p.damageType,...p.traits].filter(Boolean).join(' · ')})));
    const form=await foundry.applications.api.DialogV2.input({window:{title:l('chooseOtherDie')},content:`<select name="choice">${options.map(o=>`<option value="${esc(o.key)}">${esc(o.label)}</option>`).join('')}</select>`,ok:{label:l('select')},rejectClose:false});
    const selected=options.find(o=>o.key===form?.choice);if(!selected)return null;
    const current=game.messages?.get(message.id);
    if(!canMoveComponentChoice(current)||fingerprint(current)!==snapshot){ui.notifications?.warn(l('error'));return null;}
    if(areaMessage(current))return await publishAreaComponentChoice(current,selected.index,selected.partId);
    if(selected.index==='cover'){const patch=coverComponentPatch(current,selected.partId);if(!patch)return null;await current.update(patch);return patch[`flags.${ID}.coverAlly`];}
    const next=moveComponentChoice(cardOf(current),selected.index,selected.partId);if(!next)return null;
    await current.update({[`flags.${ID}.weaponDamage`]:next});
    return next;
  }catch(error){console.error('Fast NRI | damage component choice',error);ui.notifications?.error(l('error'));return null;}
  finally{active.delete(message.id);}
}
export function registerDamageComponentChoice(){
  const messageOf=el=>game.messages?.get(el?.closest?.('[data-message-id]')?.dataset?.messageId??el?.dataset?.messageId);
  Hooks.on('getChatMessageContextOptions',(_app,items)=>items.push({label:'FASTNRI.Damage.chooseOtherDie',icon:'fa-solid fa-dice',visible:el=>canMoveComponentChoice(messageOf(el)),onClick:(_event,el)=>void openComponentChoice(messageOf(el))}));
}
