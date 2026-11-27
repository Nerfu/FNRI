/** Fast NRI size categories and native Token dimensions. No startup migration,
 * automatic movement, texture scaling, or ownership escalation. */
import {activeConditionEffect} from "../effects/active-effect.mjs";
import {primaryRace} from "./racial-properties.mjs";

export const CREATURE_SIZES = ['small','medium','large','huge'];
export const validCreatureSize = value => CREATURE_SIZES.includes(value);
export const creatureSize = value => validCreatureSize(value) ? value : 'medium';
export function sizeDimensions(size) {
  const side={small:1,medium:1,large:2,huge:3}[size];
  return side ? {width:side,height:side} : null;
}
const supported = actor => ['character','npc'].includes(actor?.type);
const canUpdate = doc => doc?.canUserModify?.(globalThis.game?.user,'update')===true;
const sizeOfChange = data => data?.['system.size'] ?? data?.system?.size;
const sameDimensions = (doc, dims) => doc?.width===dims.width&&doc?.height===dims.height;
const pending = new WeakMap();
const rawSystem = actor => actor.toObject?.(true)?.system ?? actor.system;
const raceSize = race => primaryRace({system:{race}})==='halfling'?'small':'medium';
const local = userId => userId===globalThis.game?.user?.id;
const changedField = (data,key) => Object.hasOwn(data??{},`system.${key}`)||Object.hasOwn(data?.system??{},key);
export const SIZE_CHANGE_KEY = 'system.sizeChange';

// The native change is a declaration, not a continuous override of system.size.
// An absolute category or a signed number of steps is an explicit operation.
function sizeOperation(row) {
  if(row.key!==SIZE_CHANGE_KEY||row.type!=='override')return null;
  const value=String(row.value??'').trim();
  if(validCreatureSize(value))return value;
  if(/^[+-]\d+$/.test(value)&&Number.isSafeInteger(Number(value)))return Number(value);
  return null;
}
function effectSources(actor){
  const result=[];
  for(const effect of actor.allApplicableEffects?.()??actor.effects?.contents??[]){
    if(!activeConditionEffect(effect)||!effect.uuid)continue;
    const operations=(effect.system?.changes??[]).map(sizeOperation).filter(v=>v!==null);
    if(operations.length)result.push({id:effect.uuid,operations});
  }
  return result;
}
function sameOperations(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function computeSize(state){
  let size=state.base;
  for(const row of state.effects){
    if(!row.applied)continue;
    for(const op of row.operations){
      size=typeof op==='string'?op:CREATURE_SIZES[Math.min(CREATURE_SIZES.length-1,Math.max(0,CREATURE_SIZES.indexOf(size)+op))];
    }
  }
  return size;
}
// Keep only currently active sources, in activation/change order. A manual or
// racial choice establishes a new base and supersedes earlier sources.
function currentState(raw,sources){
  const state=raw.sizeState;
  const previous=state?.effects??[];
  const unchanged=previous.filter(row=>sources.some(s=>s.id===row.id&&sameOperations(s.operations,row.operations)));
  const added=sources.filter(s=>!unchanged.some(row=>row.id===s.id)).map(s=>({...s,applied:true}));
  return {base:state?.base??creatureSize(raw.size),effects:[...unchanged,...added]};
}
function enqueue(actor,work){
  if(!supported(actor)||!canUpdate(actor))return Promise.resolve(false);
  const task=(pending.get(actor)??Promise.resolve()).catch(()=>{}).then(()=>canUpdate(actor)?work():false);
  pending.set(actor,task);
  return task;
}
async function writeSize(actor,size,state,{sync=true}={}){
  const token=actor.isToken?actor.token:null;
  const dims=sizeDimensions(size);
  if(token&&!canUpdate(token))return false;
  const patch={'system.size':size,'system.sizeState':state};
  if(!sync){await actor.update(patch);return true;}
  if(token){
    await actor.update(patch);
    if(!sameDimensions(token,dims))await token.update(dims);
    return true;
  }
  await actor.update({...patch,'prototypeToken.width':dims.width,'prototypeToken.height':dims.height});
  let incomplete=false;
  for(const doc of actor.getDependentTokens?.({linked:true,concreteOnly:true})??[]){
    if(doc.actorLink!==true || (doc.actor!==actor&&doc.baseActor!==actor) || sameDimensions(doc,dims))continue;
    if(!canUpdate(doc)){incomplete=true;continue;}
    try{await doc.update(dims);}
    catch(error){incomplete=true;console.warn('Fast NRI | token size synchronization failed',error);}
  }
  if(incomplete)globalThis.ui?.notifications?.warn(globalThis.game.i18n.localize('FASTNRI.CreatureSize.syncIncomplete'));
  return true;
}


/** An explicit sheet/API choice. Base Actor changes its prototype and linked
 * tokens, synthetic Actor changes only its own token. Unlinked copies and
 * manually configured native dimensions are otherwise untouched. */
export function setCreatureSize(actor,size) {
  if(!supported(actor)||!canUpdate(actor)||(size!=='default'&&!validCreatureSize(size)))return Promise.resolve(false);
  const sources=effectSources(actor);
  return enqueue(actor,()=>{
    const raw=rawSystem(actor),state=currentState(raw,sources);
    state.base=size==='default'?raceSize(raw.race):size;
    state.effects=state.effects.map(row=>({...row,applied:size==='default'}));
    return writeSize(actor,computeSize(state),state);
  });
}

/** Called only on a document event, never from prepare/render or a timer. */
export function reconcileCreatureSize(actor){
  if(!supported(actor)||!canUpdate(actor))return Promise.resolve(false);
  const sources=effectSources(actor);
  return enqueue(actor,()=>{
    const raw=rawSystem(actor);
    if(!sources.length&&!raw.sizeState?.effects?.length)return true;
    const state=currentState(raw,sources);
    if(sameOperations(state,raw.sizeState))return true;
    const size=computeSize(state);
    return writeSize(actor,size,state,{sync:size!==raw.size});
  });
}

/** On new Actor creation honor an explicit size, preserve explicitly
 * authored native dimensions; no existing document is touched at startup. */
export function registerCreatureSizes(){
  Hooks.on('preCreateActor',(actor,data,_options,userId)=>{
    if(!local(userId)||!supported(actor))return;
    const explicit=sizeOfChange(data);
    if(explicit!==undefined&&!validCreatureSize(explicit))return;
    const race=data?.['system.race']??data?.system?.race;
    if(explicit===undefined&&!race)return;
    const size=explicit??raceSize(race);
    if(explicit===undefined)actor.updateSource({'system.size':size});
    const supplied=data?.prototypeToken??{};
    const dims=sizeDimensions(size);
    // Explicit native dimensions are intentional (including non-square footprints).
    if(supplied.width!=null&&supplied.height!=null)return;
    actor.updateSource({'prototypeToken.width':supplied.width??dims.width,'prototypeToken.height':supplied.height??dims.height});
  });
  const report=task=>task.catch(error=>console.warn('Fast NRI | size update failed',error));
  const refresh=(actor,userId)=>{
    if(local(userId)&&supported(actor))return report(reconcileCreatureSize(actor));
  };
  Hooks.on('createActor',(actor,_options,userId)=>refresh(actor,userId));
  Hooks.on('updateActor',(actor,changed,_options,userId)=>{
    if(local(userId)&&supported(actor)&&changedField(changed,'race'))
      return report(setCreatureSize(actor,raceSize(rawSystem(actor).race)));
  });
  const declared=effect=>(effect.system?.changes??[]).some(row=>row.key===SIZE_CHANGE_KEY);
  const effectActor=effect=>effect.parent?.documentName==='Actor'?effect.parent:effect.parent?.parent;
  const effectEvent=(effect,userId)=>{
    const actor=effectActor(effect);
    if(!local(userId)||!supported(actor))return;
    if(declared(effect)||rawSystem(actor).sizeState?.effects?.some(row=>row.id===effect.uuid))return refresh(actor,userId);
  };
  for(const event of ['createActiveEffect','deleteActiveEffect'])
    Hooks.on(event,(effect,_options,userId)=>effectEvent(effect,userId));
  Hooks.on('updateActiveEffect',(effect,_changes,_options,userId)=>effectEvent(effect,userId));
  const itemEvent=(item,userId)=>{
    const actor=item.parent;
    if(!local(userId)||!supported(actor))return;
    if(item.effects?.contents?.some(declared)||rawSystem(actor).sizeState?.effects?.some(row=>row.id.startsWith(`${item.uuid}.ActiveEffect.`)))return refresh(actor,userId);
  };
  for(const event of ['createItem','deleteItem'])
    Hooks.on(event,(item,_options,userId)=>itemEvent(item,userId));
  Hooks.on('updateItem',(item,_changes,_options,userId)=>itemEvent(item,userId));

}
