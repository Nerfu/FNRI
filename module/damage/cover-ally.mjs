import {interventionWarnings} from '../data/intervention-availability.mjs';
import {publishAreaUse} from '../data/ability-accounting.mjs';
import {canReadChatContent, chatAudience} from '../data/chat-visibility.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {redactActorSourceForAudience} from '../rolls/roll-context.mjs';
import {coverAllyDice, planCoverAlly} from './damage-core.mjs';
import {applyIndependentHp} from './free-hp.mjs';
import {areaCoverSnapshot} from './area-attack.mjs';
import {declareAction} from '../rolls/action-declaration.mjs';
import {
  COVER_ALLY_ID, coverActorKey, coverAllyItem, coverScope,
  isCurrentDirectedCoverSource, sameCoverAudience, hasIntervened, coverRecords, directedCoverSnapshot
} from './cover-ally-state.mjs';

const ID = 'fast-nri-v14';
const esc = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const local = key => game.i18n.localize(`FASTNRI.CoverAlly.${key}`);
const canWrite = actor => !!actor && (game.user.isGM || actor.isOwner || actor.canUserModify?.(game.user,'update'));
const pending = new Set();

export function coverAllyOption(actor) {
  const item = coverAllyItem(actor);
  return item ? {key:COVER_ALLY_ID,id:COVER_ALLY_ID,name:local('name'),kind:'coverAlly',item} : null;
}

async function choose(entries, title, describe, {autoSelect = true} = {}) {
  if (autoSelect && entries.length === 1) return entries[0];
  const answer = await foundry.applications.api.DialogV2.input({
    window:{title}, ok:{label:game.i18n.localize('FASTNRI.Damage.select')}, rejectClose:false,
    content:`<select name="choice" aria-label="${esc(title)}">${entries.map((entry,index) =>
      `<option value="${index}">${esc(describe(entry))}</option>`).join('')}</select>`
  });
  if (answer?.choice == null) return null;
  return entries[Number(answer.choice)] ?? null;
}

const describeDie = die => [`${die.formula} → ${die.value}`,die.damageType,...die.traits].filter(Boolean).join(' · ');

/** Both damage routes supply the exact recipient-specific snapshot. */
export async function chooseCoverAlly({source, defender, candidates,repeatWarningShown=false,menuWarningsShown=false}) {
  const actor = defender.actor, item = coverAllyItem(actor);
  if (!item || !canWrite(actor) || !canReadChatContent(source) || pending.has(actor.uuid)) return null;
  const audience=chatAudience(source);
  const independent=()=>declareAction({actor,item,label:local('name'),description:item.system?.description??'',source:audience,isIntervention:true});
  const scope = coverScope(source);
  const performer = coverActorKey(actor);
  const available = () => candidates().filter(({card}) => coverAllyDice(card).length);
  if(hasIntervened(source,actor)&&!repeatWarningShown)ui.notifications?.warn(game.i18n.localize('FASTNRI.Damage.repeatIntervention'));
  if(!menuWarningsShown){const warnings=interventionWarnings(actor,item);if(warnings.length)ui.notifications?.warn(warnings.join(' · '));}
  pending.add(actor.uuid);
  try {
    const entries = available();
    if (!entries.length) return independent();
    const entry = await choose(entries, local('chooseAlly'), candidate => candidate.ally.name);
    if (!entry) return null;
    const die = await choose(coverAllyDice(entry.card), local('chooseDie'), describeDie, {autoSelect:false});
    if (!die) return null;
    const target = entry.ally.document.uuid;
    const current = available().find(candidate => candidate.ally.document.uuid === target);
    const plan = current && planCoverAlly(current.card, die.id);
    if (!plan || describeDie(plan.transferred) !== describeDie(die)) {
      ui.notifications?.warn(local('changed'));return independent();
    }
    const baseId = stableDocumentId('cvr',[scope,target,die.id]);
    // A previous choice may have moved away from this component. Keep its
    // original message identity and allocate a fresh use for the freed die.
    const existing=game.messages?.get(baseId)?.getFlag(ID,'coverAlly');
    const messageId=existing&&existing.partId!==die.id?stableDocumentId('cvr',[scope,target,die.id,coverRecords(source,target).map(r=>r.messageId).sort()]):baseId;
    const record = {
      version:1,scope,sourceId:source.id,sourceRevision:source.getFlag(ID,'weaponDamage')?.revision ?? 0,
      allyToken:target,allyKey:coverActorKey(entry.ally.actor),
      defenderToken:defender.document.uuid,defenderKey:performer,partId:die.id,amount:plan.redirectedDamage
    };
    const heading = game.i18n.format('FASTNRI.CoverAlly.heading',{defender:defender.name,ally:entry.ally.name});
    const detail = game.i18n.format('FASTNRI.CoverAlly.detail',{die:die.formula,value:record.amount,defender:defender.name});
    const published=await publishAreaUse({actor,item,messageId,publish:async id => {
      const live = game.messages?.get(source.id);
      const ready = available().find(candidate => candidate.ally.document.uuid === target);
      const readyDie = ready && planCoverAlly(ready.card, die.id)?.transferred;
      if (!canReadChatContent(live) || !sameCoverAudience(live,source) || !readyDie ||
          (live.getFlag(ID,'weaponDamage')?.revision ?? 0) !== record.sourceRevision ||
          coverActorKey(ready.ally.actor) !== record.allyKey || coverActorKey(defender.actor) !== performer ||
          describeDie(readyDie) !== describeDie(die) || game.messages?.get(messageId) ||
          coverAllyItem(actor)?.id !== item.id) return null;
      const speaker = redactActorSourceForAudience(actor,source) ? {alias:'Fast NRI'} :
        ChatMessage.getSpeaker({actor,token:defender.document});
      return ChatMessage.create({_id:id ?? messageId,speaker,...chatAudience(source),
        content:`<strong>${esc(heading)}</strong><div>${esc(detail)}</div>`,
        flags:{[ID]:{coverAlly:record}}},{keepId:true});
    }});
    return published??independent();
  } finally {pending.delete(actor.uuid);}
}

function tokenByUuid(uuid){
  return (globalThis.canvas?.tokens?.placeables??[]).find(t=>t.document?.uuid===uuid)??globalThis.foundry?.utils?.fromUuidSync?.(uuid);
}
export function coverComponentChoice(message){
  const record=message?.getFlag?.(ID,'coverAlly');
  if(record?.version!==1||!canReadChatContent(message))return null;
  const source=game.messages?.get(record.sourceId),ally=tokenByUuid(record.allyToken),defender=tokenByUuid(record.defenderToken);
  if(!canReadChatContent(source)||!sameCoverAudience(source,message)||!ally?.actor||!defender?.actor||ally.visible===false||defender.visible===false||(ally.document??ally).hidden===true||(defender.document??defender).hidden===true||coverActorKey(ally.actor)!==record.allyKey||coverActorKey(defender.actor)!==record.defenderKey)return null;
  const card=source.getFlag(ID,'weaponDamage');
  if((card?.revision??0)!==record.sourceRevision)return null;
  const snapshot=card?.version===2&&!card.areaAttack?directedCoverSnapshot(source,ally,{omitMessageId:message.id}):areaCoverSnapshot(source,ally,{omitMessageId:message.id});
  const parts=coverAllyDice(snapshot),current=parts.find(p=>p.id===record.partId);
  if(!current||current.value!==record.amount)return null;
  const candidates=parts.filter(p=>p.id!==record.partId);
  return candidates.length?{record,current,candidates,allyName:ally.name,defenderName:defender.name}:null;
}
export function coverComponentPatch(message,partId){
  const choice=coverComponentChoice(message),die=choice?.candidates.find(p=>p.id===partId);
  if(!die)return null;
  const record={...choice.record,partId,amount:die.value,choiceHistory:[...(choice.record.choiceHistory??[]),{from:choice.record.partId,to:partId,by:game.user?.id,at:Date.now()}]};
  const heading=game.i18n.format('FASTNRI.CoverAlly.heading',{defender:choice.defenderName,ally:choice.allyName});
  const detail=game.i18n.format('FASTNRI.CoverAlly.detail',{die:die.formula,value:record.amount,defender:choice.defenderName});
  return {[`flags.${ID}.coverAlly`]:record,content:`<strong>${esc(heading)}</strong><div>${esc(detail)}</div>`};
}

export function renderCoverAlly(message, html) {
  if (message.getFlag(ID,'coverAlly')?.version !== 1) return false;
  if (!canReadChatContent(message)) return true;
  const anchor = html.querySelector('.message-content') ?? html;
  if (anchor.querySelector('[data-fnri-cover-apply]')) return true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fnri-damage-button';
  button.dataset.fnriCoverApply = '';
  button.textContent = game.i18n.localize('FASTNRI.Damage.apply');
  button.addEventListener('click', () => void applyCoverAlly(message).catch(error => {
    console.error('Fast NRI | cover damage failed', error);
    ui.notifications?.error(game.i18n.localize('FASTNRI.Damage.error'));
  }));
  anchor.append(button);
  return true;
}

export async function applyCoverAlly(message) {
  const current=game.messages?.get(message.id);
  if(!canReadChatContent(current))return null;
  const record=current.getFlag(ID,'coverAlly');
  if(record?.version!==1)return null;
  return applyIndependentHp(current,{kind:'damage',amount:record.amount});
}
