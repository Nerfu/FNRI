/** Fast NRI size categories and native Token dimensions. No startup migration,
 * automatic movement, texture scaling, or ownership escalation. */
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

/** An explicit sheet/API choice. Base Actor changes its prototype and linked
 * tokens, synthetic Actor changes only its own token. Unlinked copies and
 * manually configured native dimensions are otherwise untouched. */
export function setCreatureSize(actor,size) {
  if(!supported(actor)||!validCreatureSize(size)||!canUpdate(actor))return Promise.resolve(false);
  const task=(pending.get(actor)??Promise.resolve()).catch(()=>{}).then(async()=>{
    if(!canUpdate(actor))return false;
    const token=actor.isToken?actor.token:null;
    const dims=sizeDimensions(size);
    if(token && !canUpdate(token))return false;
    if(token){
      await actor.update({'system.size':size});
      if(!sameDimensions(token,dims))await token.update(dims);
      return true;
    }
    await actor.update({'system.size':size,'prototypeToken.width':dims.width,'prototypeToken.height':dims.height});
    let incomplete=false;
    for(const doc of actor.getDependentTokens?.({linked:true,concreteOnly:true})??[]){
      if(doc.actorLink!==true || (doc.actor!==actor&&doc.baseActor!==actor) || sameDimensions(doc,dims))continue;
      if(!canUpdate(doc)){incomplete=true;continue;}
      try{await doc.update(dims);}
      catch(error){incomplete=true;console.warn('Fast NRI | token size synchronization failed',error);}
    }
    if(incomplete)globalThis.ui?.notifications?.warn(globalThis.game.i18n.localize('FASTNRI.CreatureSize.syncIncomplete'));
    return true;
  });
  pending.set(actor,task);
  return task;
}

/** On new Actor creation honor an explicit size, without touching legacy
 * imports with authored dimensions or any existing document at startup. */
export function registerCreatureSizes(){
  Hooks.on('preCreateActor',(actor,data,_options,userId)=>{
    const size=sizeOfChange(data);
    if(userId!==game.user?.id||!supported(actor)||!validCreatureSize(size))return;
    const supplied=data?.prototypeToken??{};
    const dims=sizeDimensions(size);
    // Explicit native dimensions are intentional (including non-square footprints).
    if(supplied.width!=null&&supplied.height!=null)return;
    actor.updateSource({'prototypeToken.width':supplied.width??dims.width,'prototypeToken.height':supplied.height??dims.height});
  });
}
