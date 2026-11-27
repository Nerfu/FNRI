import {queueActorWrite} from "../data/ability-accounting.mjs";
import {
  RACIAL_SYSTEM_ID, racialLabel, racialContentId, racialState, racialPropertyRule,
  racialPropertyChoices, selectedRacialPropertyChoice, racialAddWarnings, changesAncestry,
  racialAddBlock, racialRemoveBlock, racialCreationPlan, racialChoicesForItem, selectedRacialChoiceForItem, obsoleteRacialProperty
} from "../data/racial-properties.mjs";
import {racialCatalog, addRacialProperty, chooseRacialSubproperty} from "./racial-property-picker.mjs";

import {obsoleteSkillAllocationPatch} from '../data/skill-allocation.mjs';
async function cleanSkillReferences(actor){
  const raw=actor.toObject?.(true)?.system??actor.system;
  const patch=obsoleteSkillAllocationPatch(raw,actor.items.contents);
  if(Object.keys(patch).length)await actor.update(patch);
}
const openChoices = new WeakSet();
// An explicit permitted removal must survive unrelated ancestry syncs.
// This is composition state, not a journal or accounting event.
const suppressedKey='suppressedInnateProperties';
function suppressedInnates(actor) {
  const value=actor.getFlag?.(RACIAL_SYSTEM_ID,suppressedKey);
  return new Set(Array.isArray(value)?value.filter(id=>typeof id==='string'):[]);
}
async function writeSuppressed(actor, previous, next) {
  if (previous.size===next.size&&[...previous].every(id=>next.has(id))) return;
  await actor.update({[`flags.${RACIAL_SYSTEM_ID}.${suppressedKey}`]:[...next]});
}
export async function rememberInnateRemoval(actor,item) {
  const id=racialContentId(item);
  if (!racialPropertyRule(item)||!id||!racialState(actor).innate.has(id)) return;
  return queueActorWrite(actor,async()=>{
    if (!racialState(actor).innate.has(id)||actor.items.contents.some(owned=>racialPropertyRule(owned)&&racialContentId(owned)===id)) return;
    const previous=suppressedInnates(actor);
    await writeSuppressed(actor,previous,new Set([...previous,id]));
  });
}
export async function forgetInnateRemoval(actor,item) {
  const id=racialContentId(item);
  if (!racialPropertyRule(item)||!id) return;
  return queueActorWrite(actor,async()=>{
    const previous=suppressedInnates(actor),next=new Set(previous);
    next.delete(id);
    await writeSuppressed(actor,previous,next);
  });
}

function reportError(error) {
  console.warn("Fast NRI | racial properties", error);
  ui.notifications?.warn(racialLabel("unavailable"));
}

export async function editRacialSubproperty(item) {
  if (!racialChoicesForItem(item).length || openChoices.has(item)) return;
  const actor = item.parent;
  openChoices.add(item);
  try {
    const selection = await chooseRacialSubproperty(item);
    if (!selection || !actor?.isOwner) return;
    await queueActorWrite(actor, async () => {
      const live = actor.items.get(item.id);
      if (live !== item) return;
      const rule = racialPropertyRule(live);
      if (rule?.selection !== selection && racialChoicesForItem(live,actor).some(choice => choice.id === selection))
        await live.update({"system.mechanics.racialProperty.selection": selection});
    });
  } finally {
    openChoices.delete(item);
  }
}

export async function syncInnateProperties(actor, grant = true) {
  const prompts = await queueActorWrite(actor, async () => {
    let state = racialState(actor);
    // An obsolete Half-Blood or Nature can itself remove another ancestry.
    // Recompute after each removal batch, then grant the final innate set.
    while(true){
      const obsolete=actor.items.contents.filter(item=>obsoleteRacialProperty(actor,item,state));
      if(!obsolete.length)break;
      const before=actor.items.contents.length;
      await actor.deleteEmbeddedDocuments("Item",obsolete.map(item=>item.id),{fnriAncestrySync:true});
      state=racialState(actor);
      if(actor.items.contents.length>=before)break;
    }
    // If the new primary race equals the selected second race, clear only
    // the invalid choice; the universal Half-Blood card remains editable.
    for(const item of actor.items.contents){
      const rule=racialPropertyRule(item);
      if(changesAncestry(item)&&rule?.selection&&!selectedRacialChoiceForItem(item,actor))
        await item.update({"system.mechanics.racialProperty.selection":""},{fnriPicker:true});
    }
    state=racialState(actor);
    await cleanSkillReferences(actor);
    const existing = new Set(actor.items.contents.filter(racialPropertyRule).map(racialContentId));
    const previous=suppressedInnates(actor);
    const suppressed=new Set([...previous].filter(id=>state.innate.has(id)&&!existing.has(id)));
    await writeSuppressed(actor,previous,suppressed);
    if (!grant) return [];
    const missing = new Set([...state.innate].filter(id => !existing.has(id)&&!suppressed.has(id)));
    if (missing.size) {
      for (const card of await racialCatalog()) {
        const id = racialContentId(card);
        if (missing.has(id) && racialState(actor).innate.has(id)) {
          await addRacialProperty(actor, card, null, {automatic: true});
        }
      }
    }
    const innate = racialState(actor).innate;
    return actor.items.contents.filter(item => {
      const rule = racialPropertyRule(item);
      return innate.has(racialContentId(item)) && racialPropertyChoices(rule).length && !selectedRacialPropertyChoice(rule);
    });
  });
  for (const item of prompts) {
    if (actor.items.get(item.id) !== item || !racialState(actor).innate.has(racialContentId(item)) ||
        selectedRacialPropertyChoice(racialPropertyRule(item))) continue;
    await editRacialSubproperty(item);
  }
}

export function registerRacialPropertyLifecycle() {
  const shouldSync = (actor, userId) => actor?.type === "character" && actor.isOwner && game.user.id === userId;
  const reconcile = (actor, grant = true) => { void syncInnateProperties(actor, grant).catch(reportError); };

  Hooks.on("preCreateItem", (item, _data, options = {}) => {
    const blocked = racialAddBlock(item.parent,item);
    if (blocked) {
      if (!options.fnriPicker) ui.notifications?.warn(racialLabel(blocked));
      return false;
    }
    if (!options.fnriPicker) for (const warning of racialAddWarnings(item.parent,item).filter(key=>key!=='limitReached'))
      ui.notifications?.warn(racialLabel(warning));
  });

  Hooks.on("preDeleteItem", (item, options = {}) => {
    // No generic bypass flag: obsolete automatic properties are no longer
    // innate in the new ancestry, so normal synchronization is permitted.
    const blocked = racialRemoveBlock(item.parent,item);
    if (blocked) {
      if (!options.fnriPicker) ui.notifications?.warn(racialLabel(blocked));
      return false;
    }
  });

  Hooks.on("createActor", (actor, _options, userId) => {
    if (shouldSync(actor, userId) && actor.system.race) reconcile(actor);
  });

  const afterUpdate=(actor,change,_options,userId)=>{
    if(shouldSync(actor,userId)&&["race","role"].some(field=>Object.hasOwn(change,`system.${field}`)||Object.hasOwn(change.system??{},field)))reconcile(actor);
  };
  Hooks.on("updateActor",afterUpdate);
  Hooks.on("updateActorDelta",(delta,change,options,userId)=>afterUpdate(delta?.parent?.actor,change,options,userId));

  Hooks.on("createItem", (item, options, userId) => {
    const actor = item.parent;
    if (!shouldSync(actor, userId) || !racialPropertyRule(item)) return;
    void forgetInnateRemoval(actor,item).catch(reportError);
    if (options.fnriPicker) return;
    if (changesAncestry(item) && selectedRacialChoiceForItem(item,actor)) reconcile(actor);
    if (!selectedRacialChoiceForItem(item,actor))
      void editRacialSubproperty(item).catch(reportError);
  });

  Hooks.on("updateItem", (item, change, options, userId) => {
    if (!shouldSync(item.parent, userId) || options.fnriPicker || !changesAncestry(item)) return;
    const path = "system.mechanics.racialProperty.selection";
    if (Object.hasOwn(change, path) || foundry.utils.hasProperty(change, path)) reconcile(item.parent);
  });

  Hooks.on("deleteItem", (item, options, userId) => {
    if (!shouldSync(item.parent,userId)||!racialPropertyRule(item)) return;
    // Schedule the state write immediately, before a subsequent ancestry
    // reconciliation on the same client. No hook waits on its own queue.
    const recorded=rememberInnateRemoval(item.parent,item);
    void recorded.catch(reportError);
    if (!options.fnriAncestrySync){
      if(changesAncestry(item))void recorded.then(()=>reconcile(item.parent,false)).catch(reportError);
      else void queueActorWrite(item.parent,()=>cleanSkillReferences(item.parent)).catch(reportError);
    }
  });
}

/** Foundry v14 preflight runs once for the complete pending creation batch.
 * The single-Item hook alone cannot see other pending Items. Keep unrelated
 * Items and cancel only the prohibited additions. */
export function racialItemDocumentClass(Base) {
  return class FastNRIRacialItem extends Base {
    static async _preCreateOperation(documents, operation, user) {
      if (await super._preCreateOperation(documents,operation,user) === false) return false;
      const {allowed,blocked}=racialCreationPlan(documents);
      if (!blocked.length) return;
      documents.splice(0,documents.length,...allowed);
      if (!operation.fnriPicker) ui.notifications?.warn(racialLabel('limitReached'));
      if (!documents.length) return false;
    }
  };
}
