/** Initialize PC class data on native creation or explicit class selection,
 * including direct Actor.update/import. No world scans or migrations. */
import {classInitializationUpdate} from './classes.mjs';
import {permanentRacialStats} from './character-contributions.mjs';

export function registerClassLifecycle(){
  Hooks.on('preCreateActor',(actor,_data,_options,userId)=>{
    if(actor.type!=='character'||userId!==game.user?.id)return;
    const raw=actor.toObject(true).system??{};
    const patch=classInitializationUpdate(raw,{hpBonus:permanentRacialStats(actor).hpMax});
    const rows=raw.resources??{};
    if(!Object.hasOwn(rows,"intervention")&&!Object.values(rows).some(row=>row.kind==="intervention"||["вмешательство","вмешательства","intervention","interventions"].includes(String(row.name??"").trim().toLowerCase())))
      patch["system.resources.intervention"]={name:"Вмешательства",kind:"intervention",current:1,max:1};
    if(Object.keys(patch).length)actor.updateSource(foundry.utils.expandObject(patch));
  });
  Hooks.on('preUpdateActor',(actor,changed,_options,userId)=>{
    if(actor.type!=='character'||userId!==game.user?.id)return;
    const delta=foundry.utils.expandObject(changed).system??{};
    if(!Object.hasOwn(delta,'className'))return;
    const raw=actor.toObject(true).system??{};
    const next={...raw,...delta,hp:{...raw.hp,...delta.hp},resources:{...raw.resources}};
    for(const [id,row] of Object.entries(delta.resources??{})){
      if(id.startsWith('-=')){delete next.resources[id.slice(2)];continue;}
      if(row===null){delete next.resources[id];continue;}
      next.resources[id]={...next.resources[id],...row};
    }
    const patch=classInitializationUpdate(next,{hpBonus:permanentRacialStats(actor).hpMax});
    // Keep the initialization in the original Actor update (including journal).
    for(const [path,value] of Object.entries(patch)){
      if(Object.hasOwn(changed,path))changed[path]=value;
      else foundry.utils.setProperty(changed,path,value);
    }
  });
}
