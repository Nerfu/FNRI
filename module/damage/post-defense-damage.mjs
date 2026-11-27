/** Card-defined separate damage after defenses. The explicit click confirms
 * that players have finished resolving defenses; it does not apply HP. */
import {canReadChatContent,chatAudience} from '../data/chat-visibility.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {sameCoverAudience} from './cover-ally-state.mjs';
import {snapshotDamageParts,damageDisplay} from './damage-core.mjs';
const ID='fast-nri-v14';
const flag=(m,k)=>m?.getFlag?.(ID,k);
const tr=k=>game.i18n.localize(`FASTNRI.Damage.${k}`);
const live=m=>game.messages?.get?.(m?.id)??null;
const pending=new Set();
const hit=degree=>['partial','success','great'].includes(degree);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function ferocityCritical(parent,offer){
  if(!offer.ferocity)return false;
  const report=(game.messages?.contents??[]).findLast(m=>{const r=flag(m,'hpReport');return r?.sourceMessageId===parent.id&&r.kind==='damage'&&!r.reverted&&(!offer.targetUuid||r.tokenUuid===offer.targetUuid)&&canReadChatContent(m)&&sameCoverAudience(parent,m);});
  return report?flag(report,'hpReport').critical===true:damageDisplay(flag(parent,'weaponDamage')).active;
}
function validParts(parts){
  return Array.isArray(parts)&&parts.length>0&&parts.length<=100&&parts.every(p=>
    (p?.kind==='die'&&Number.isInteger(p.faces)&&p.faces>0&&p.faces<=1000&&p.formula===`1d${p.faces}`||p?.kind==='fixed'&&Number.isSafeInteger(p.value)&&p.value>0&&p.value<=1000&&p.formula===String(p.value))&&typeof p.damageType==='string'&&p.damageType.trim());
}
export function postDefenseChoices(root,parent,card,eligible){
  if(!canReadChatContent(root)||!canReadChatContent(parent)||!sameCoverAudience(root,parent)||card?.cancelled)return [];
  return (card?.postDefenseDamage??[]).flatMap(offer=>{
    if(!offer||!/^after-\d+$/.test(offer.id)||!validParts(offer.parts))return [];
    const status=eligible(offer);if(!status)return [];
    const target=offer.targetUuid?globalThis.foundry?.utils?.fromUuidSync?.(offer.targetUuid):null;
    if(target?.hidden===true)return [];
    const id=stableDocumentId('pdf',[root.id,offer.id]);
    if(game.messages?.get?.(id))return [];
    const name=offer.label||tr('postDefenseDamage');
    const label=[name,target?.name,status==='manual'?tr('postDefenseManual'):tr('postDefenseAfter')].filter(Boolean).join(' · ');
    return [{id,offer,root,parent,label,name,status}];
  });
}
export function directedPostDefenseChoices(message){
  const current=live(message),card=flag(current,'weaponDamage');
  if(!card||card.areaAttack||card.postDefenseOrigin||card.cancelled||!hit(card.degree)||card.parts?.some(p=>p.pending))return [];
  const root=live({id:card.attackMessageId});
  if(!root)return [];
  // Only the latest result in this chain may launch the separate roll.
  const latest=(game.messages?.contents??[]).findLast(m=>{
    const c=flag(m,'weaponDamage');
    return c?.attackMessageId===root.id&&!c.areaAttack&&!c.postDefenseOrigin&&canReadChatContent(m)&&sameCoverAudience(root,m);
  });
  if(latest?.id!==current.id)return [];
  return postDefenseChoices(root,current,card,offer=>{
    if(offer.ferocity&&!['success','great'].includes(card.degree))return false;
    return !offer.targetUuid?'manual':!card.originalTargetUuid||offer.targetUuid===card.originalTargetUuid;
  });
}
export async function publishPostDefenseDamage(choice,choices){
  if(!choice||pending.has(choice.id))return null;
  pending.add(choice.id);
  try{
    const find=()=>choices().find(c=>c.id===choice.id);
    let current=find();if(!current){ui.notifications?.warn(tr('postDefenseUnavailable'));return null;}
    const {offer,root,parent,name,label,status}=current;
    const critical=ferocityCritical(parent,offer);
    const parts=critical?[...offer.parts,...offer.parts]:offer.parts;
    const definitions=parts.map((p,index)=>({...p,id:`post-${index}`,partOrigin:offer.ferocity||p.traits?.length?'postDefense':'attackAugment',source:offer.sourceUuid??null}));
    const formula=definitions.map(p=>p.formula).join(' + ');
    const roll=await new Roll(formula).evaluate();
    // Recheck the current defense chain and audience after rolling.
    current=find();if(!current||current.parent.id!==parent.id||!sameCoverAudience(root,current.root)||
      current.status!==status||JSON.stringify(current.offer)!==JSON.stringify(offer)||ferocityCritical(current.parent,current.offer)!==critical)return null;
    const snapshot={version:2,attackMessageId:null,previousMessageId:null,name,
      postDefenseOrigin:{rootMessageId:root.id,parentMessageId:parent.id,offerId:offer.id,targetUuid:offer.targetUuid??null},
      originalTargetUuid:offer.targetUuid??null,sourceUuid:offer.sourceUuid??null,sourceActorUuid:null,
      isIntervention:true,noCritical:true,naturalD20:null,criticalTriggered:false,manualCritical:false,
      cancelled:false,damageType:definitions[0].damageType,properties:'',parts:snapshotDamageParts(roll,definitions),
      adjustments:{penalty:0,resistance:0,vulnerability:0},history:[],revision:0};
    const data=await roll.toMessage({speaker:root.speaker,flavor:`<strong>${esc(label)}</strong>`,flags:{[ID]:{weaponDamage:snapshot}}},{create:false});
    current=find();if(!current||current.parent.id!==parent.id||!sameCoverAudience(root,current.root)||current.status!==status||JSON.stringify(current.offer)!==JSON.stringify(offer)||ferocityCritical(current.parent,current.offer)!==critical)return null;
    // Native deterministic ID prevents duplicate publication across clients.
    try{return await ChatMessage.create({...data,...chatAudience(root),_id:choice.id},{keepId:true});}
    catch(error){if(game.messages?.get?.(choice.id))return null;throw error;}
  }finally{pending.delete(choice.id);}
}
