import {queueActorWrite} from '../data/ability-accounting.mjs';

/** Limit current HP against the prepared maximum, never temporary HP. */
export function capCurrentHp(current,max){
  return Number.isFinite(current)&&Number.isFinite(max)?Math.max(0,Math.min(current,Math.max(0,max))):current;
}
export function prepareHpLimit(system){
  if(system?.hp)system.hp.current=capCurrentHp(system.hp.current,system.hp.max);
}

/** The current pool changes by the same amount as the effective maximum.
 * A separate explicit current-HP edit wins; this includes imports and class
 * initialization. Missing values are not interpreted as zero. */
export function planHpMaximumChange(before,after,{explicitCurrent=false,rawCurrent=after?.current}={}){
  if(!Number.isFinite(after?.max))return null;
  if(explicitCurrent)return Number.isFinite(rawCurrent)?capCurrentHp(rawCurrent,after.max):null;
  if(!Number.isFinite(before?.max)||!Number.isFinite(before?.current)||before.max===after.max)return null;
  const max=Math.max(0,after.max),oldMax=Math.max(0,before.max);
  return Math.max(0,Math.min(max,before.current+max-oldMax));
}

const supported=actor=>['character','npc'].includes(actor?.type);
const owner=actor=>actor?.isOwner===true||actor?.canUserModify?.(game.user,'update')===true||game.user?.isGM===true;
const rawHp=actor=>actor._source?.system?.hp??actor.toObject?.(true)?.system?.hp??actor.system?.hp??{};
const snapshot=actor=>({current:actor.system?.hp?.current,max:actor.system?.hp?.max});
const effectActor=doc=>doc?.actor??(doc?.parent?.documentName==='Actor'?doc.parent:doc?.parent?.parent);
const deltaActor=delta=>delta?.parent?.actor;
const putCurrent=(changed,value)=>{
  if(Object.hasOwn(changed,'system.hp.current'))changed['system.hp.current']=value;
  else if(changed.system?.hp)changed.system.hp.current=value;
};

/** Observe native document transactions, not data preparation/rendering.
 * Only the initiating client writes. A local transaction snapshot is shared
 * by all documents in a batch; only an opaque identifier travels in options.
 * The normal Actor HP write retains the existing journal/death lifecycle.
 */
export function registerHpLimit(){
  const pending=new Map(),queued=new Map();
  let sequence=0;
  function remember(actor,options,userId,explicitCurrent=false){
    if(!supported(actor)||!actor.uuid||!owner(actor)||userId!==game.user?.id||!options||options.fnriHpMaximumManaged)return;
    // Native pre-hooks run once per document; a batch may affect many Actors.
    let id=options.fnriHpMaximumOperation;
    if(!id||!pending.has(id)){
      id=`${userId}:${++sequence}`;
      options.fnriHpMaximumOperation=id;
      pending.set(id,new Map());
      // Cancelled/failed operations have no post-hook. Keep memory bounded.
      if(pending.size>256)pending.delete(pending.keys().next().value);
    }
    const batch=pending.get(id),previous=batch.get(actor.uuid);
    if(previous){previous.explicitCurrent||=explicitCurrent;return;}
    batch.set(actor.uuid,{before:snapshot(actor),explicitCurrent});
  }
  function finish(actor,options,userId){
    if(!supported(actor)||userId!==game.user?.id||options?.fnriHpMaximumManaged)return;
    const id=options?.fnriHpMaximumOperation,batch=pending.get(id),entry=batch?.get(actor.uuid);
    if(!entry)return;
    // Consume once even if ActorDelta and Actor, or several Items, emit hooks.
    batch.delete(actor.uuid);
    if(!batch.size)pending.delete(id);
    const expectedRaw=rawHp(actor).current;
    const existing=queued.get(actor.uuid);
    if(existing){
      // Coalesce transactions that finish before the actor write queue runs.
      // A newer explicit HP assignment supersedes older automatic work.
      if(entry.explicitCurrent||existing.expectedRaw!==expectedRaw||existing.entry.explicitCurrent){
        existing.entry=entry;
        existing.expectedRaw=expectedRaw;
      }
      existing.actor=actor;
      return existing.task;
    }
    const work={actor,entry,expectedRaw};
    queued.set(actor.uuid,work);
    work.task=queueActorWrite(actor,async()=>{
      queued.delete(actor.uuid);
      const target=work.actor;
      if(!owner(target))return;
      const hp=target.system?.hp,raw=rawHp(target).current;
      // A newer ordinary HP write or an earlier reconciliation won. Never
      // overwrite it using an obsolete pre-operation snapshot.
      if(raw!==work.expectedRaw)return;
      const value=planHpMaximumChange(work.entry.before,hp,{explicitCurrent:work.entry.explicitCurrent,rawCurrent:raw});
      if(value===null||value===raw)return;
      await target.update({'system.hp.current':value},{fnriHpMaximumManaged:true,
        fnriJournal:{kind:'hpMaximum',reason:''}});
    }).catch(error=>console.error('Fast NRI | maximum HP reconciliation failed',error));
    return work.task;
  }
  function beforeActor(actor,changed,options,userId){
    if(!supported(actor))return;
    const delta=foundry.utils.expandObject(changed).system;
    // Preserve the existing manual cap. A simultaneous max/class edit must
    // be capped against the freshly prepared maximum after the operation.
    const explicit=Object.hasOwn(delta?.hp??{},'current');
    if(explicit&&!Object.hasOwn(delta.hp,'max')&&!Object.hasOwn(delta,'className')&&!Object.hasOwn(changed,'items')&&!Object.hasOwn(changed,'effects')){
      const value=capCurrentHp(delta.hp.current,actor.system?.hp?.max);
      putCurrent(changed,value);
    }
    if(delta||Object.hasOwn(changed,'items')||Object.hasOwn(changed,'effects'))remember(actor,options,userId,explicit);
  }
  Hooks.on('preUpdateActor',beforeActor);
  Hooks.on('updateActor',(actor,_changes,options,userId)=>finish(actor,options,userId));
  Hooks.on('preUpdateActorDelta',(delta,changed,options,userId)=>beforeActor(deltaActor(delta),changed,options,userId));
  Hooks.on('updateActorDelta',(delta,_changes,options,userId)=>finish(deltaActor(delta),options,userId));
  for(const type of ['Item','ActiveEffect']){
    const actorOf=type==='Item'?doc=>doc?.parent:effectActor;
    for(const action of ['Create','Update']){
      Hooks.on(`pre${action}${type}`,(doc,_data,options,userId)=>remember(actorOf(doc),options,userId));
      Hooks.on(`${action.toLowerCase()}${type}`,(doc,...args)=>{
        const [options,userId]=action==='Create'?args:args.slice(1);
        return finish(actorOf(doc),options,userId);
      });
    }
    Hooks.on(`preDelete${type}`,(doc,options,userId)=>remember(actorOf(doc),options,userId));
    Hooks.on(`delete${type}`,(doc,options,userId)=>finish(actorOf(doc),options,userId));
  }
}
