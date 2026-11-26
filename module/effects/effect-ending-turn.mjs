/** General DC15 checks on the native designated-GM end-turn path.
 * A durable, minimal Actor receipt precedes cleanup; no gameplay journal.
 * Private roll details remain on the GM client, like periodic damage. */
import {eligibleForGeneralEnding} from './effect-ending.mjs';
import {conditionEffectEntry} from './condition-turn.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
import {queueActorWrite} from '../data/ability-accounting.mjs';
const S='fast-nri-v14';
const privateRows=new Map();
const liveInstances=new Map();
const emptyTurns=new WeakMap();
const privateEffect=e=>conditionEffectEntry(e).gmOnly;
const read=(actor,key)=>actor.getFlag?.(S,key)??actor.flags?.[S]?.[key]??{};
function stamp(e){
  const f=e?.flags?.[S]??{};
  if(typeof f.effectEndingInstance==='string')return `instance:${f.effectEndingInstance}`;
  const created=e?._stats?.createdTime??e?._source?._stats?.createdTime;
  if(created!=null)return `created:${created}`;
  // Native embedded AE data may have no _stats. Ordinary document IDs are
  // unique per application; explicitly reused IDs require a generation tag.
  return f.hudCondition||f.attackOutcomeApplication?null:`id:${e.id}`;
}
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const t=k=>esc(game.i18n.localize(`FASTNRI.EffectEnding.${k}`));
const gms=()=>[...new Set([...(game.users?.contents??[]).filter(u=>u.isGM).map(u=>u.id),game.user.id])];
const audience=(actor,gmOnly)=>[...new Set([...gms(),...(gmOnly?[]:(game.users?.contents??[]).filter(u=>actor.testUserPermission?.(u,'OWNER')===true).map(u=>u.id))])];
function hiddenCombatant(c){return c.hidden===true||c.token?.hidden===true||c.token?.document?.hidden===true;}
async function flush(actor,id,receipt,combatant){
  const details=receipt.gmOnly?privateRows.get(id):receipt.details;
  const same=liveInstances.get(id);
  const uncertain=new Set();
  const gmOnly=receipt.gmOnly||!details||hiddenCombatant(combatant)||receipt.rows.some(row=>{
    const e=actor.effects?.get(row.id);return e&&privateEffect(e);
  });
  for(const row of receipt.rows){
    if(!row.finish)continue;
    const e=actor.effects?.get(row.id);
    if(!e)continue;
    // HUD uses a stable ID; a replacement instance must not be removed.
    if(row.created!==null?stamp(e)!==row.created:same?.get(row.id)!==e){uncertain.add(row.id);continue;}
    if(!eligibleForGeneralEnding(e)){uncertain.add(row.id);continue;}
    await actor.deleteEmbeddedDocuments('ActiveEffect',[row.id]);
    if(actor.effects?.get(row.id)===e)throw Error('Effect removal not confirmed');
  }
  let msg=game.messages?.get(id);
  if(msg&&!msg.getFlag?.(S,'effectEndingReport'))throw Error('Effect ending message ID collision');
  if(!msg){
    const content=details?`<div class="fnri-hp-report"><div>${t('endTurn')}</div>${details.map(row=>{
      const name=row.uuid?`@UUID[${row.uuid}]{${esc(row.name)}}`:esc(row.name);
      const status=uncertain.has(row.id)?'manual':row.finish?'removed':'remains';
      return `<div>${name} · <strong>${esc(row.total)}</strong> · ${t(status)}</div>`;
    }).join('')}</div>`:`<div>${t('privateRecovery')}</div>`;
    const enriched=await foundry.applications.ux.TextEditor.enrichHTML(content,{secrets:false});
    // Never broaden the original audience on recovery or ownership change.
    const recipients=audience(actor,gmOnly).filter(u=>receipt.whisper.includes(u)||gms().includes(u));
    const data={_id:id,speaker:ChatMessage.getSpeaker({actor}),content:enriched,
      whisper:recipients,rolls:details?.map(row=>row.roll)??[],flags:{[S]:{effectEndingReport:true}}};
    try{await ChatMessage.create(data,{keepId:true});}
    catch(error){if(!game.messages?.get(id)?.getFlag?.(S,'effectEndingReport'))throw error;}
  }
  await actor.update({[`flags.${S}.effectEndingPending.-=${id}`]:null},{fnriJournal:{skip:true}});
  privateRows.delete(id);liveInstances.delete(id);
}
export async function settleGeneralEffectEndTurn(combat,combatant,context){
  const round=context?.round,actor=combatant?.token?.actor??combatant?.actor;
  if(!game.user?.isGM||game.system?.id!==S||!combat?.started||context?.skipped||!combat.id||!combatant?.id||
    !Number.isSafeInteger(round)||round<1||actor?.documentName!=='Actor')return null;
  const key=stableDocumentId('gep',[combat.id,combatant.id]);
  const id=stableDocumentId('gem',[combat.id,combatant.id,round,actor.uuid]);
  return queueActorWrite(actor,async()=>{
    // Snapshot before awaiting writes. Newly applied effects wait until next turn.
    const effects=(actor.effects?.contents??[]).filter(eligibleForGeneralEnding);
    for(const [pendingId,pending] of Object.entries(read(actor,'effectEndingPending'))){
      try{await flush(actor,pendingId,pending,combatant);}
      catch(error){console.error('Fast NRI | effect ending report requires retry',error);}
    }
    if(Math.max(read(actor,'effectEndingProgress')[key]??0,emptyTurns.get(actor)?.get(key)??0)>=round)return null;
    const outstanding=new Set(Object.values(read(actor,'effectEndingPending')).flatMap(p=>p.rows.filter(r=>r.finish).map(r=>r.id)));
    const rows=[],details=[],instances=new Map();
    let gmOnly=hiddenCombatant(combatant);
    for(const e of effects){
      if(outstanding.has(e.id)||actor.effects?.get(e.id)!==e||!eligibleForGeneralEnding(e))continue;
      const roll=await new Roll('1d20').evaluate({allowInteractive:false});
      const total=Number(roll.total);
      if(!Number.isInteger(total)||total<1||total>20)throw Error('Invalid effect ending roll');
      if(actor.effects?.get(e.id)!==e||!eligibleForGeneralEnding(e))continue;
      const entry=conditionEffectEntry(e);gmOnly ||= privateEffect(e);
      const row={id:e.id,created:stamp(e),finish:total>=15};
      rows.push(row);instances.set(e.id,e);
      details.push({...row,name:entry.name,uuid:entry.uuid??null,total,roll:roll.toJSON()});
    }
    // Empty turns need no persistent Actor write; a local guard covers repeats.
    const patch={[`flags.${S}.effectEndingProgress.${key}`]:round};
    if(rows.length){
      const receipt={rows,gmOnly,whisper:audience(actor,gmOnly),...(gmOnly?{}:{details})};
      patch[`flags.${S}.effectEndingPending.${id}`]=receipt;
      if(gmOnly)privateRows.set(id,details);
      liveInstances.set(id,instances);
      try{await actor.update(patch,{fnriJournal:{skip:true}});}
      catch(error){if(!read(actor,'effectEndingPending')[id]){privateRows.delete(id);liveInstances.delete(id);}throw error;}
      try{await flush(actor,id,receipt,combatant);}catch(error){console.error('Fast NRI | effect ending report requires retry',error);}
    }else {
      const rounds=emptyTurns.get(actor)??new Map();rounds.set(key,round);emptyTurns.set(actor,rounds);
    }
    return {rows};
  });
}
