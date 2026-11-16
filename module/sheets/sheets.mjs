/** Fast NRI v14: stage-2 document sheets. No game-rule automation. */
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;

const STYLES = ["fast-nri-v14", "fast-nri-sheet"];
const TAB_IDS = new Set(["overview", "skills", "abilities", "inventory", "description"]);
const ITEM_TYPES = new Set(["weapon", "armor", "gear", "ability"]);
const ROW_FIELDS = {
  skills: new Set(["name", "kind", "dice", "value"]),
  resources: new Set(["name", "current", "max"]),
  equipmentSlots: new Set(["name", "itemId"])
};
const NUMERIC_ROW_FIELDS = {
  skills: new Set(["value"]),
  resources: new Set(["current", "max"]),
  equipmentSlots: new Set()
};
const EQUIPMENT_SLOTS = ["leftHand", "rightHand", "armor"];
const VALID_ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;

const sortedItems = items => [...items].sort((a, b) =>
  (a.sort - b.sort) || a.name.localeCompare(b.name));
const localized = key => game.i18n.localize("FASTNRI." + key);
const rowsOf = object => Object.entries(object ?? {}).map(([id, values]) => ({ id, ...values }));

function numberFromInput(raw, integer = false) {
  const value = raw.trim();
  if (!value) return { valid: true, value: null };
  // Accept decimal comma for Russian users, but reject JavaScript coercions
  // like 0x10, Infinity, whitespace-only, or malformed expressions.
  const normalized = value.replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return { valid: false };
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) return { valid: false };
  return { valid: true, value: parsed };
}

function rowWithSelection(item, equipment) {
  return {
    item, id: item.id, name: item.name, img: item.img, type: item.type,
    selectedLeft: equipment?.leftHand === item.id,
    selectedRight: equipment?.rightHand === item.id,
    selectedArmor: equipment?.armor === item.id
  };
}

class ActorBase extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: [...STYLES, "fast-nri-actor"],
    position: { width: 760, height: 720 },
    // Actor inputs have ONE addressable update path below. The core form's
    // submit-on-change would otherwise compete with row updates.
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      fnriSwitchTab: ActorBase.changeTab,
      openItem: ActorBase.openItem,
      createItem: ActorBase.createItem,
      deleteItem: ActorBase.deleteItem,
      addSkill: ActorBase.addSkill,
      addSpecialization: ActorBase.addSpecialization,
      removeSkill: ActorBase.removeSkill,
      addResource: ActorBase.addResource,
      removeResource: ActorBase.removeResource,
      addEquipmentSlot: ActorBase.addEquipmentSlot,
      removeEquipmentSlot: ActorBase.removeEquipmentSlot
    }
  };

  constructor(options = {}) {
    super(options);
    this._selectedTab = "overview";
    this._writeQueue = Promise.resolve();
    this._failedFields = new Set();
  }

  /** Serialize updates initiated from this sheet, and keep the queue usable
   * after a rejected update. Across clients, each edit uses an independent
   * document field path instead of replacing skills/resources wholesale.
   */
  _queueWrite(operation, fieldKey = null) {
    const update = this._writeQueue.then(async () => {
      if (!this.isEditable) return;
      return operation();
    });
    this._writeQueue = update.then(() => {
      if (fieldKey) this._failedFields.delete(fieldKey);
    }, error => {
      if (fieldKey) this._failedFields.add(fieldKey);
      console.error("Fast NRI | Actor sheet update failed", error);
      ui.notifications?.error(localized("Hints.saveFailed"));
    });
    return update;
  }

  async _flushWrites() {
    await this._writeQueue;
    return this._failedFields.size === 0;
  }

  /** Switch visible panels in place, without saving or re-rendering the
   * document. Navigation must work even if an unrelated field failed to save
   * or currently has invalid input. Keeping the same DOM preserves that input
   * for correction, rather than silently losing it on a full re-render.
   *
   * Use system-specific data attributes and action name to avoid conflicting
   * with ApplicationV2's own built-in tab navigation conventions.
   */
  static changeTab(_event, button) {
    const tab = button.dataset.fnriTarget;
    if (!TAB_IDS.has(tab)) return;
    this._selectedTab = tab;
    const root = this.element;
    if (!root) return;
    for (const nav of root.querySelectorAll(".fnri-tabs [data-fnri-target]")) {
      const selected = nav.dataset.fnriTarget === tab;
      nav.classList.toggle("active", selected);
      if (selected) nav.setAttribute("aria-current", "page");
      else nav.removeAttribute("aria-current");
    }
    for (const panel of root.querySelectorAll("[data-fnri-panel]")) {
      panel.hidden = panel.dataset.fnriPanel !== tab;
    }
  }

  static async openItem(_event, button) {
    const id = button.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (item) await item.sheet.render({ force: true });
  }

  static async createItem(_event, button) {
    if (!this.isEditable || !ITEM_TYPES.has(button.dataset.type)) return;
    const type = button.dataset.type;
    await this._queueWrite(async () => {
      const name = game.i18n.localize("TYPES.Item." + type);
      const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
      if (item) await item.sheet.render({ force: true });
    });
  }

  static async deleteItem(_event, button) {
    if (!this.isEditable) return;
    const id = button.closest("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item) return;
    const ok = await DialogV2.confirm({
      window: { title: localized("Actions.deleteItem") },
      content: `<p>${localized("Hints.confirmDelete")}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    await this._queueWrite(async () => {
      if (!this.actor.items.get(id)) return;
      await this.actor.deleteEmbeddedDocuments("Item", [id]);
      // Slot cleanup for our own delete action. Other deletion routes are
      // displayed as an explicit missing choice that the user can clear.
      const equipment = this.actor.system.equipment ?? {};
      const changes = {};
      for (const slot of EQUIPMENT_SLOTS) {
        if (equipment[slot] === id) changes["system.equipment." + slot] = "";
      }
      for (const [slotId, extra] of Object.entries(this.actor.system.equipmentSlots ?? {})) {
        if (extra?.itemId === id && VALID_ROW_ID.test(slotId)) {
          changes["system.equipmentSlots." + slotId + ".itemId"] = "";
        }
      }
      if (Object.keys(changes).length) await this.actor.update(changes);
    });
  }

  static async addSkill() {
    await this._addRow("skills", { name: "", kind: "skill", dice: "", value: null });
  }
  static async addSpecialization() {
    await this._addRow("skills", { name: "", kind: "specialization", dice: "", value: null });
  }
  static async removeSkill(_event, button) {
    await this._removeRow("skills", button.dataset.id);
  }
  static async addResource() {
    await this._addRow("resources", { name: "", current: null, max: null });
  }
  static async removeResource(_event, button) {
    await this._removeRow("resources", button.dataset.id);
  }
  static async addEquipmentSlot() {
    await this._addRow("equipmentSlots", { name: "", itemId: "" });
  }
  static async removeEquipmentSlot(_event, button) {
    await this._removeRow("equipmentSlots", button.dataset.id);
  }

  async _addRow(collection, value) {
    if (!this.isEditable || !Object.hasOwn(ROW_FIELDS, collection)) return;
    const id = foundry.utils.randomID();
    if (!VALID_ROW_ID.test(id)) throw new Error("Invalid generated row ID");
    await this._queueWrite(() => this.actor.update({ ["system." + collection + "." + id]: value }));
  }

  async _removeRow(collection, id) {
    if (!this.isEditable || !(collection in ROW_FIELDS) || !VALID_ROW_ID.test(id ?? "")) return;
    await this._queueWrite(async () => {
      if (!Object.hasOwn(this.actor.system[collection] ?? {}, id)) return;
      // Foundry v14's supported deletion operator (not the legacy -=key).
      await this.actor.update({ ["system." + collection + "." + id]: globalThis._del });
    });
  }

  _invalidNumber(control) {
    control.setCustomValidity?.(localized("Hints.invalidNumber"));
    control.reportValidity?.();
    ui.notifications?.warn(localized("Hints.invalidNumber"));
  }

  /** Register a single, addressable save path for each Actor control.
   * Row inputs intentionally have no `name` and cannot be submitted by
   * Handlebars FormData. This prevents the old competing full-array write.
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    for (const input of root.querySelectorAll("[data-row-collection][data-row-field][data-row-id]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        if (!this.isEditable) return;
        const control = event.currentTarget;
        const { rowCollection: collection, rowId: id, rowField: field } = control.dataset;
        if (!ROW_FIELDS[collection]?.has(field) || !VALID_ROW_ID.test(id ?? "")) return;
        const isNumber = NUMERIC_ROW_FIELDS[collection]?.has(field) ?? false;
        const parsed = isNumber ? numberFromInput(control.value) : { valid: true, value: control.value };
        if (!parsed.valid) return this._invalidNumber(control);
        control.setCustomValidity?.("");
        const fieldKey = "system." + collection + "." + id + "." + field;
        void this._queueWrite(async () => {
          if (!Object.hasOwn(this.actor.system[collection] ?? {}, id)) return;
          return this.actor.update({ [fieldKey]: parsed.value });
        }, fieldKey).catch(() => {});
      });
    }
    for (const input of root.querySelectorAll("input[name],select[name],textarea[name]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        if (!this.isEditable) return;
        const control = event.currentTarget;
        const field = control.name;
        if (field !== "name" && !field.startsWith("system.")) return;
        const isNumber = control.dataset.dtype === "Number";
        const parsed = isNumber ? numberFromInput(control.value, control.dataset.integer === "true")
          : { valid: true, value: control.value };
        if (!parsed.valid) return this._invalidNumber(control);
        control.setCustomValidity?.("");
        void this._queueWrite(() => this.actor.update({ [field]: parsed.value }), field).catch(() => {});
      });
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const items = sortedItems(actor.items.contents);
    const equipment = actor.system.equipment ?? {};
    // Every embedded Item is assignable. Type labels do not impose game-rule
    // restrictions on manual equipment choices.
    const allChoices = items.map(item => rowWithSelection(item, equipment));
    const allIDs = new Set(items.map(item => item.id));
    const missingEquipment = {
      leftHand: !!equipment.leftHand && !allIDs.has(equipment.leftHand),
      rightHand: !!equipment.rightHand && !allIDs.has(equipment.rightHand),
      armor: !!equipment.armor && !allIDs.has(equipment.armor)
    };
    const extraSlotRows = Object.entries(actor.system.equipmentSlots ?? {}).map(([id, slot]) => ({
      id, name: slot.name, itemId: slot.itemId,
      missing: !!slot.itemId && !allIDs.has(slot.itemId),
      choices: items.map(item => ({ id: item.id, name: item.name, selected: item.id === slot.itemId }))
    }));
    const tab = TAB_IDS.has(this._selectedTab) ? this._selectedTab : "overview";
    return {
      ...context,
      actor, system: actor.system, editable: this.isEditable,
      activeTab: tab,
      tabs: {
        overview: tab === "overview", skills: tab === "skills",
        abilities: tab === "abilities", inventory: tab === "inventory",
        description: tab === "description"
      },
      items: items.map(item => rowWithSelection(item, equipment)),
      abilityItems: items.filter(i => i.type === "ability").map(item => rowWithSelection(item, equipment)),
      inventoryItems: items.filter(i => i.type !== "ability").map(item => rowWithSelection(item, equipment)),
      handChoices: allChoices, armorChoices: allChoices, missingEquipment,
      extraSlotRows,
      hasMissingEquipment: Object.values(missingEquipment).some(Boolean) || extraSlotRows.some(row => row.missing),
      skillRows: rowsOf(actor.system.skills).map(row => ({
        ...row,
        isSpecialization: row.kind === "specialization",
        isSkill: row.kind !== "specialization",
        hasLegacyValue: row.value !== null && row.value !== undefined
      })),
      resourceRows: rowsOf(actor.system.resources)
    };
  }
}

export class FastNRICharacterSheet extends ActorBase {
  static PARTS = { main: { root: true, template: "systems/fast-nri-v14/templates/character.hbs" } };
}

export class FastNRINPCSheet extends ActorBase {
  static PARTS = { main: { root: true, template: "systems/fast-nri-v14/templates/npc.hbs" } };
}

export class FastNRIItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    tag: "form", classes: [...STYLES, "fast-nri-item"],
    position: { width: 570, height: 620 },
    form: { submitOnChange: true, closeOnSubmit: false }
  };
  static PARTS = { main: { root: true, template: "systems/fast-nri-v14/templates/item.hbs" } };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      item: this.item, system: this.item.system, editable: this.isEditable,
      isWeapon: this.item.type === "weapon", isArmor: this.item.type === "armor",
      isGear: this.item.type === "gear", isAbility: this.item.type === "ability",
      isLegacy: this.item.type === "item",
      deprecated: this.item.getFlag("fast-nri-v14", "status") === "deprecated"
    };
  }
}
