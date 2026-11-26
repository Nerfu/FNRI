/** Only the native HUD's FNRI condition actions are adapted. Actor's general
 * toggleStatusEffect and all other HUD actions retain their core semantics. */
import {CONDITION_STATUSES} from './condition-statuses.generated.mjs';
import {newEndingInstance} from './effect-ending.mjs';
import {activeConditionEffect} from './condition-turn.mjs';
import {queueActorWrite} from '../data/ability-accounting.mjs';
import {stableDocumentId} from '../data/document-id.mjs';
const S='fast-nri-v14';
const hudId=(actor,id)=>stableDocumentId('hcs',[actor.uuid,id]);
const own=(actor,id)=>actor && (actor.effects?.contents??[]).find(e=>e.id===hudId(actor,id) && e.flags?.[S]?.hudCondition===id);
const overlay=e=>e?.flags?.core?.overlay===true;
export async function toggleHudCondition(actor,id,{asOverlay=false}={}){
  if(!Object.hasOwn(CONDITION_STATUSES,id) || !actor || !(actor.isOwner || actor.canUserModify?.(game.user,'update') || game.user?.isGM))return;
  return queueActorWrite(actor,async()=>{
    const existing=own(actor,id);
    if(existing){
      if(!activeConditionEffect(existing)){
        // Replace just the retired HUD instance, never a card or Item effect.
        await actor.deleteEmbeddedDocuments('ActiveEffect',[existing.id]);
      }else if(asOverlay && !overlay(existing)){
        await existing.update({'flags.core.overlay':true});return existing;
      }else{
        await actor.deleteEmbeddedDocuments('ActiveEffect',[existing.id]);return false;
      }
    }
    const {_id,id:status,hud,...data}=structuredClone(CONDITION_STATUSES[id]);
    data._id=hudId(actor,status);
    data.flags[S].hudCondition=status;
    data.flags[S].effectEndingInstance=newEndingInstance();
    if(asOverlay)data.flags.core={...data.flags.core,overlay:true};
    try{return (await actor.createEmbeddedDocuments('ActiveEffect',[data],{keepId:true}))[0];}
    catch(error){const current=own(actor,id);if(current?.id===data._id)return current;throw error;}
  });
}
/** v14 TokenHUD.DEFAULT_OPTIONS.actions.effect is the native click action.
 * Keep the same palette and buttons; use native handler for foreign statuses. */
export function conditionHudClass(Base){
  const native=Base.DEFAULT_OPTIONS?.actions?.effect ?? foundry.applications.hud.TokenHUD.DEFAULT_OPTIONS.actions.effect;
  return class extends Base{
    static DEFAULT_OPTIONS={actions:{effect:{...native,handler:async function(event,target){
      const id=target.dataset.statusId;
      if(!Object.hasOwn(CONDITION_STATUSES,id))return native.handler.call(this,event,target);
      await toggleHudCondition(this.actor,id,{asOverlay:event.button===2});
      await this.render();
    }}}};
    _getStatusEffectChoices(){
      const choices=super._getStatusEffectChoices();
      for(const choice of Object.values(choices)){
        if(!Object.hasOwn(CONDITION_STATUSES,choice.id))continue;
        const e=own(this.actor,choice.id);
        choice.isActive=activeConditionEffect(e);
        choice.isOverlay=choice.isActive && overlay(e);
        const css=new Set(String(choice.cssClass??'').split(/\s+/).filter(Boolean));
        css.delete('active');css.delete('overlay');
        if(choice.isActive)css.add('active');if(choice.isOverlay)css.add('overlay');
        choice.cssClass=[...css].join(' ');
      }
      return choices;
    }
  };
}
