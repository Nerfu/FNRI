import {queueActorWrite} from "../data/ability-accounting.mjs";
import {
  RACIAL_SYSTEM_ID, racialLabel, racialContentId, racialState, racialPropertyRule,
  racialPropertyChoices, selectedRacialPropertyChoice, racialAddWarnings, changesAncestry,
  racialAddBlock, racialRemoveBlock, racialCreationPlan
} from "../data/racial-properties.mjs";
import {racialCatalog, addRacialProperty, chooseRacialSubproperty} from "./racial-property-picker.mjs";

const automatic = item => item.getFlag(RACIAL_SYSTEM_ID, "automaticRacialProperty") === true;
const openChoices = new WeakSet();

function reportError(error) {
  console.warn("Fast NRI | racial properties", error);
  ui.notifications?.warn(racialLabel("unavailable"));
}

export async function editRacialSubproperty(item) {
  if (!racialPropertyChoices(racialPropertyRule(item)).length || openChoices.has(item)) return;
  const actor = item.parent;
  openChoices.add(item);
  try {
    const selection = await chooseRacialSubproperty(item);
    if (!selection || !actor?.isOwner) return;
    await queueActorWrite(actor, async () => {
      const live = actor.items.get(item.id);
      if (live !== item) return;
      const rule = racialPropertyRule(live);
      if (rule?.selection !== selection && racialPropertyChoices(rule).some(choice => choice.id === selection))
        await live.update({"system.mechanics.racialProperty.selection": selection});
    });
  } finally {
    openChoices.delete(item);
  }
}

export async function syncInnateProperties(actor, grant = true) {
  const prompts = await queueActorWrite(actor, async () => {
    let state = racialState(actor);
    const obsolete = actor.items.contents.filter(item => automatic(item) && !state.innate.has(racialContentId(item)));
    if (obsolete.length) await actor.deleteEmbeddedDocuments("Item", obsolete.map(item => item.id), {fnriAncestrySync: true});
    if (!grant) return [];
    state = racialState(actor);
    const existing = new Set(actor.items.contents.filter(racialPropertyRule).map(racialContentId));
    const missing = new Set([...state.innate].filter(id => !existing.has(id)));
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

  Hooks.on("updateActor", (actor, change, _options, userId) => {
    if (shouldSync(actor, userId) && (Object.hasOwn(change, "system.race") ||
        Object.hasOwn(change.system ?? {}, "race"))) reconcile(actor);
  });

  Hooks.on("createItem", (item, options, userId) => {
    const actor = item.parent;
    if (!shouldSync(actor, userId) || options.fnriPicker || !racialPropertyRule(item)) return;
    if (changesAncestry(item) && selectedRacialPropertyChoice(racialPropertyRule(item))) reconcile(actor);
    if (!selectedRacialPropertyChoice(racialPropertyRule(item)))
      void editRacialSubproperty(item).catch(reportError);
  });

  Hooks.on("updateItem", (item, change, options, userId) => {
    if (!shouldSync(item.parent, userId) || options.fnriPicker || !changesAncestry(item)) return;
    const path = "system.mechanics.racialProperty.selection";
    if (Object.hasOwn(change, path) || foundry.utils.hasProperty(change, path)) reconcile(item.parent);
  });

  Hooks.on("deleteItem", (item, options, userId) => {
    if (shouldSync(item.parent, userId) && !options.fnriAncestrySync && changesAncestry(item))
      reconcile(item.parent, false);
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
