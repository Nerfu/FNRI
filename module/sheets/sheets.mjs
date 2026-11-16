/** Minimal v14 document sheets: editable source fields and embedded Item list. */
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;

const STYLES = ["fast-nri-v14", "fast-nri-sheet"];

class ActorBase extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: [...STYLES, "fast-nri-actor"],
    position: { width: 700, height: 720 },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: { openItem: ActorBase.openItem }
  };

  static async openItem(_event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (item) await item.sheet.render({ force: true });
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.actor = this.actor;
    ctx.system = this.actor.system;
    ctx.items = this.actor.items.contents.toSorted((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    ctx.editable = this.isEditable;
    return ctx;
  }
}

export class FastNRICharacterSheet extends ActorBase {
  static PARTS = {
    body: { template: "systems/fast-nri-v14/templates/character.hbs" }
  };
}

export class FastNRINPCSheet extends ActorBase {
  static PARTS = {
    body: { template: "systems/fast-nri-v14/templates/npc.hbs" }
  };
}

export class FastNRIItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: [...STYLES, "fast-nri-item"],
    position: { width: 570, height: 620 },
    form: { submitOnChange: true, closeOnSubmit: false }
  };
  static PARTS = {
    body: { template: "systems/fast-nri-v14/templates/item.hbs" }
  };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.item = this.item;
    ctx.system = this.item.system;
    ctx.isWeapon = this.item.type === "weapon";
    ctx.isArmor = this.item.type === "armor";
    ctx.isGear = this.item.type === "gear";
    ctx.isAbility = this.item.type === "ability";
    ctx.isLegacy = this.item.type === "item";
    ctx.deprecated = this.item.getFlag("fast-nri-v14", "status") === "deprecated";
    ctx.editable = this.isEditable;
    return ctx;
  }
}
