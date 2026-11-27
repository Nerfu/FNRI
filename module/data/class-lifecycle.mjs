/** Initialize PC class data on native creation or explicit class selection,
 * including direct Actor.update/import. No world scans or migrations. */
import {classInitializationUpdate,classDefinition,CLERIC_WEAPON_PROFICIENCY_ID} from './classes.mjs';
import {grantClassAbilities,editClassWeaponProficiency,editClassNature} from '../sheets/class-abilities.mjs';
import {obsoleteSkillAllocationPatch} from './skill-allocation.mjs';
import {permanentRacialStats} from './character-contributions.mjs';

const interventionLimit=system=>classDefinition(system)?.interventions??1;
const interventionRows=system=>Object.entries(system.resources??{}).filter(([,row])=>row?.kind==='intervention');
export function interventionClassUpdate(previous,next){
  const rows=interventionRows(next), limit=interventionLimit(next);
  if(!rows.length){
    if(Object.hasOwn(next.resources??{},'intervention'))return {};
    return {'system.resources.intervention':{name:'Вмешательства',kind:'intervention',current:limit,max:limit}};
  }
  const diff=limit-interventionLimit(previous);
  if(!diff||rows.length!==1)return {};
  const [id,row]=rows[0];
  if(!Number.isFinite(row.max)||!Number.isFinite(row.current))return {};
  const max=Math.max(0,row.max+diff);
  return {[`system.resources.${id}.max`]:max,[`system.resources.${id}.current`]:max-(row.max-row.current)};
}
export function registerClassLifecycle(){
  const grant = (actor,userId,enterClass=false) => {
    if(actor.type!=='character'||!actor.isOwner||userId!==game.user?.id)return;
    return grantClassAbilities(actor).then(async()=>{
      if(enterClass && classDefinition(actor.system)?.name==='Клерик'){
        const item=actor.items.contents.find(i=>i.getFlag('fast-nri-v14','contentId')===CLERIC_WEAPON_PROFICIENCY_ID);
        if(item&&!item.system?.mechanics?.weaponProficiency?.weaponContentIds?.length)await editClassWeaponProficiency(item,{initial:true});
        const nature=actor.items.contents.find(i=>i.system?.mechanics?.classNature);
        if(nature&&!nature.system.mechanics.classNature.selection)await editClassNature(nature);
      }
    }).catch(error=>{
      console.warn('Fast NRI | class ability grant failed',error);
      globalThis.ui?.notifications?.warn(game.i18n.localize('FASTNRI.Hints.saveFailed'));
    });
  };
  Hooks.on('createActor',(actor,_options,userId)=>grant(actor,userId,true));
  const afterUpdate=(actor,changed,options,userId)=>{
    if(!actor)return;
    if(Object.hasOwn(changed,'system.className')||Object.hasOwn(changed.system??{},'className'))return grant(actor,userId,options.fnriClassChanged===true);
  };
  Hooks.on('updateActor',afterUpdate);
  Hooks.on('updateActorDelta',(delta,changed,options,userId)=>afterUpdate(delta?.parent?.actor,changed,options,userId));
  Hooks.on('preCreateActor',(actor,_data,_options,userId)=>{
    if(actor.type!=='character'||userId!==game.user?.id)return;
    const raw=actor.toObject(true).system??{};
    const patch=classInitializationUpdate(raw,{hpBonus:permanentRacialStats(actor).hpMax});
    const rows=raw.resources??{};
    if(!interventionRows(raw).length&&!Object.hasOwn(rows,"intervention"))
      Object.assign(patch,interventionClassUpdate(raw,raw));
    if(Object.keys(patch).length)actor.updateSource(foundry.utils.expandObject(patch));
  });
  const beforeUpdate=(actor,changed,options,userId)=>{
    if(actor?.type!=='character'||userId!==game.user?.id)return;
    const delta=foundry.utils.expandObject(changed).system??{};
    if(!Object.hasOwn(delta,'className')&&!Object.hasOwn(delta,'classTradition'))return;
    const raw=actor.toObject(true).system??{};
    const next={...raw,...delta,hp:{...raw.hp,...delta.hp},resources:{...raw.resources}};
    for(const [id,row] of Object.entries(delta.resources??{})){
      if(id.startsWith('-=')){delete next.resources[id.slice(2)];continue;}
      if(row===null){delete next.resources[id];continue;}
      next.resources[id]={...next.resources[id],...row};
    }
    const previousClass=classDefinition(raw),newClass=classDefinition(next);
    options.fnriClassChanged=previousClass!==newClass;
    const patch={};
    if(options.fnriClassChanged){
      const previousResource=previousClass?.resource;
      if(previousResource&&previousResource.id!==newClass?.resource?.id){
        for(const [id,row] of Object.entries(next.resources)){
          if(row?.kind==='class'&&(id===previousResource.id||row.resourceKey===previousResource.id)){
            delete next.resources[id];
            patch[`system.resources.-=${id}`]=null;
          }
        }
      }
      if(!Object.hasOwn(delta,'classTradition')||!newClass?.traditions?.includes(next.classTradition)){
        if(next.classTradition){next.classTradition='';patch['system.classTradition']='';}
      }
      Object.assign(patch,interventionClassUpdate(raw,next));
    }
    if(Object.hasOwn(delta,'className'))Object.assign(patch,classInitializationUpdate(next,{hpBonus:permanentRacialStats(actor).hpMax}));
    if(options.fnriClassChanged||raw.classTradition!==next.classTradition){
      const currentAllocation=raw.skillAllocation??{};
      next.skillAllocation={...currentAllocation,...delta.skillAllocation,
        assignments:{...currentAllocation.assignments,...delta.skillAllocation?.assignments},
        upgrades:{...currentAllocation.upgrades,...delta.skillAllocation?.upgrades}};
      Object.assign(patch,obsoleteSkillAllocationPatch(next,actor.items?.contents??[]));
    }
    // Keep the initialization in the original Actor update (including journal).
    for(const [path,value] of Object.entries(patch)){
      if(Object.hasOwn(changed,path))changed[path]=value;
      else foundry.utils.setProperty(changed,path,value);
    }
  };
  Hooks.on('preUpdateActor',beforeUpdate);
  Hooks.on('preUpdateActorDelta',(delta,changed,options,userId)=>beforeUpdate(delta?.parent?.actor,changed,options,userId));
}
