import {activeConditionEffect} from './active-effect.mjs';
export {activeConditionEffect} from './active-effect.mjs';
/** Native Combat turn notifications and expiry for informational markers. */
import {CONDITION_CARD_LINKS} from './condition-statuses.generated.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {queueActorWrite} from '../data/ability-accounting.mjs';
const S='fast-nri-v14';
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const flags=e=>e?.flags?.[S]??{};
function conditionId(e){
  if(Object.hasOwn(CONDITION_CARD_LINKS,flags(e).conditionId))return flags(e).conditionId;
  return [...(e.statuses??[])].map(s=>s.startsWith('fnri7-')?s.slice(6):null).find(s=>Object.hasOwn(CONDITION_CARD_LINKS,s));
}
function identity(combat,combatant,context){
  const round=context?.round ?? combat?.round;
  if(!game.user?.isGM || !combat?.started || context?.skipped || !combat.id || !combatant?.id || !Number.isSafeInteger(round) || round<1)return null;
  return [combat.id,combatant.id,round];
}
/** Shared conservative visibility for start and ending reports. */
export function conditionEffectEntry(e){
  const id=conditionId(e),card=CONDITION_CARD_LINKS[id];
  const f=flags(e),sourceId=f.abilityResultMessageId??f.periodicDamage?.sourceMessageId;
  const source=sourceId?game.messages?.get(sourceId):null;
  const gmOnly=!card||e.showIcon===0||e.hidden===true||f.hidden===true||f.privateToGm===true||f.attackOutcomeApplication===true||f.periodicDamage?.privateToGm===true||
    (sourceId&&(!source||source.blind||source.whisper?.length));
  return {...(card??{name:e.name}),gmOnly:!!gmOnly};
}
/** Known conditions link to their authoritative system Item; independent
 * sources are displayed once. Other active effects keep their own names. */
export function conditionReminderEntries(actor){
  const unique=new Map();
  for(const e of actor?.allApplicableEffects?.()??actor?.effects?.contents??[]){
    if(!activeConditionEffect(e))continue;
    const entry=conditionEffectEntry(e);
    if(!entry.name)continue;
    const {gmOnly}=entry;
    const id=conditionId(e);
    const key=CONDITION_CARD_LINKS[id]?id:`effect:${e.uuid??e.id??entry.name}`;
    const old=unique.get(key);
    unique.set(key,{...entry,gmOnly:!!gmOnly || old?.gmOnly===true});
  }
  return [...unique.values()];
}
export async function remindConditionsAtTurnStart(combat,combatant,context){
  const turn=identity(combat,combatant,context), actor=combatant?.token?.actor ?? combatant?.actor;
  if(!turn || !actor)return;
  const entries=conditionReminderEntries(actor);
  if(!entries.length)return;
  const id=stableDocumentId('ctr',turn);
  if(game.messages?.get(id))return;
  const hidden=combatant.hidden===true || combatant.token?.hidden===true || combatant.token?.document?.hidden===true;
  const gmOnly=hidden || entries.some(e=>e.gmOnly);
  const whisper=(game.users?.contents??[]).filter(user=>user.isGM || (!gmOnly && actor.testUserPermission?.(user,'OWNER')===true)).map(u=>u.id);
  if(game.user?.isGM && !whisper.includes(game.user.id))whisper.push(game.user.id);
  if(!whisper.length)return; // Never fall back to public chat.
  const names=entries.map(e=>e.uuid?`@UUID[${e.uuid}]{${esc(e.name)}}`:esc(e.name));
  const content=await foundry.applications.ux.TextEditor.enrichHTML(`<div>${names.join(' · ')}</div>`,{secrets:false});
  try{
    await ChatMessage.create({_id:id,speaker:ChatMessage.getSpeaker({actor,token:combatant.token}),content,whisper,
      flags:{[S]:{conditionReminder:true}}},{keepId:true});
  }catch(error){if(!game.messages?.get(id)?.getFlag?.(S,'conditionReminder'))throw error;}
}
/** Only explicitly marked Actor instances expire, not Item definitions or
 * independently authored conditions that happen to have the same name. */
const lastExpired=new WeakMap();
export async function expireInformationalMarkers(combat,combatant,context){
  const turn=identity(combat,combatant,context), actor=combatant?.token?.actor ?? combatant?.actor;
  if(!turn || !actor || !(actor.isOwner || actor.canUserModify?.(game.user,'update') || game.user?.isGM))return;
  await queueActorWrite(actor,async()=>{
    const rounds=lastExpired.get(combat)??new Map();
    if((rounds.get(combatant.id)??0)>=turn[2])return;
    const ids=(actor.effects?.contents??[]).filter(e=>flags(e).conditionId==='stunned' && flags(e).informationalMarker===true).map(e=>e.id);
    if(ids.length)await actor.deleteEmbeddedDocuments('ActiveEffect',ids);
    rounds.set(combatant.id,turn[2]);lastExpired.set(combat,rounds);
  });
}
