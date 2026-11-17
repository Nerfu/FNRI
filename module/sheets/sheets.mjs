import { skillFormula, itemFormula, postRoll, resolveMessageMode } from "../rolls/checks.mjs";
/** Fast NRI v14: stage-2 document sheets. No game-rule automation. */
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;

const STYLES = ["fast-nri-v14", "fast-nri-sheet"];
const TAB_IDS = new Set(["overview", "skills", "abilities", "inventory", "description"]);
const ITEM_TYPES = new Set(["weapon", "armor", "gear", "ability"]);
const ROW_FIELDS = {
  skills: new Set(["name", "kind", "dice", "modifier", "value"]),
  resources: new Set(["name", "current", "max"]),
  equipmentSlots: new Set(["name", "itemId"])
};
const NUMERIC_ROW_FIELDS = {
  skills: new Set(["modifier", "value"]),
  resources: new Set(["current", "max"]),
  equipmentSlots: new Set()
};
const EQUIPMENT_SLOTS = ["leftHand", "rightHand", "armor"];
const VALID_ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DICE_CUSTOM = "__custom__"; // UI-only sentinel; never persisted to Actor data.
const DICE_PRESETS = Object.freeze({
  skill: ["1d4", "1d6", "1d8", "1d10", "1d12"],
  specialization: ["2d6", "2d4"]
});

function diceOptions(kind, current, customEditing = false) {
  const available = DICE_PRESETS[kind] ?? DICE_PRESETS.skill;
  // Keep the custom editor open after an empty value is saved and the Actor
  // sheet is re-rendered by Foundry's document update notifications.
  const selected = customEditing ? DICE_CUSTOM :
    (available.includes(current) ? current : (current ? DICE_CUSTOM : ""));
  const result = [{ value: "", label: localized("Fields.noDice"), selected: selected === "" }];
  for (const value of available) {
    const label = kind === "skill" ? value.slice(1) :
      localized(value === "2d6" ? "Fields.primarySpecialization" : "Fields.secondarySpecialization");
    result.push({ value, label, selected: selected === value });
  }
  result.push({ value: DICE_CUSTOM, label: localized("Fields.customDice"), selected: selected === DICE_CUSTOM });
  return result;
}

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
      rollSkill: ActorBase.rollSkill,
      createEffect: ActorBase.createEffect,
      editEffect: ActorBase.editEffect,
      toggleEffect: ActorBase.toggleEffect,
      deleteEffect: ActorBase.deleteEffect,
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
    this._messageMode = "";
    // UI-only selection; never persisted as a game-rule constraint or sentinel.
    this._customDiceEditors = new Set();
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

  _rollMode() {
    const selected = this.element?.querySelector?.("[data-fnri-message-mode]")?.value || this._messageMode;
    if (selected) this._messageMode = selected;
    return resolveMessageMode(selected, game.settings.get("core", "messageMode"));
  }

  static async rollSkill(_event, button) {
    const id = button.dataset.id;
    if (!VALID_ROW_ID.test(id ?? "")) return;
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized("Hints.unsavedRoll"));
    const entry = this.actor.system.skills?.[id];
    if (!entry) return;
    try {
      await postRoll({
        formula: skillFormula(entry), label: entry.name || localized("Fields.skill"),
        actor: this.actor, mode: this._rollMode()
      });
    } catch (error) {
      console.error("Fast NRI | skill check failed", error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }

  static async createEffect(_event, button) {
    if (!this.isEditable) return;
    const root = this.element;
    const target = root?.querySelector?.("[data-fnri-effect-key]")?.value;
    const raw = root?.querySelector?.("[data-fnri-effect-amount]")?.value ?? "";
    const allowed = new Set([
      "system.speed", "system.ac.partial", "system.ac.success", "system.ac.great",
      "system.defenses.awareness", "system.defenses.reflex",
      "system.defenses.fortitude", "system.defenses.will", "system.attackModifier",
      ...Object.keys(this.actor.system.skills ?? {}).filter(id => VALID_ROW_ID.test(id))
        .map(id => `system.skills.${id}.modifier`)
    ]);
    const numeric = numberFromInput(raw);
    if (!allowed.has(target) || !numeric.valid || numeric.value === null) {
      return ui.notifications?.warn(localized("Hints.invalidEffect"));
    }
    await this._queueWrite(async () => {
      const [effect] = await this.actor.createEmbeddedDocuments("ActiveEffect", [{
        name: localized("Actions.createEffect"), type: "base", disabled: false,
        // Foundry v14 ActiveEffect V2 stores changes in system.changes, not
        // the removed v13 root changes array. Use the core initial phase so
        // prepared Actor fields receive the modifier before checks roll.
        system: { changes: [{
          key: target, type: "add", value: String(numeric.value), phase: "initial"
        }] }
      }]);
      if (effect) await effect.sheet?.render({ force: true });
    });
  }

  _effectByButton(button) {
    return this.actor.effects?.get(button.dataset.id);
  }
  static async editEffect(_event, button) {
    const effect = this._effectByButton(button);
    if (effect) await effect.sheet?.render({ force: true });
  }
  static async toggleEffect(_event, button) {
    if (!this.isEditable) return;
    const effect = this._effectByButton(button);
    if (effect) await this._queueWrite(() => effect.update({ disabled: !effect.disabled }));
  }
  static async deleteEffect(_event, button) {
    if (!this.isEditable) return;
    const effect = this._effectByButton(button);
    if (!effect) return;
    if (!await DialogV2.confirm({
      window: { title: localized("Actions.deleteEffect") },
      content: `<p>${localized("Hints.confirmDelete")}</p>`, rejectClose: false
    })) return;
    await this._queueWrite(() => this.actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]));
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
    await this._addRow("skills", { name: "", kind: "skill", dice: "", modifier: null, value: null });
  }
  static async addSpecialization() {
    await this._addRow("skills", { name: "", kind: "specialization", dice: "", modifier: null, value: null });
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

  /** Two convenient preset lists share one stored dice formula. A change of
   * category only changes the UI; it must never overwrite existing dice.
   * Custom formulas and old character data are preserved as written.
   */
  _syncDicePickers(id, kind) {
    const root = this.element;
    if (!root) return;
    const input = [...root.querySelectorAll("[data-fnri-custom-dice]")]
      .find(control => control.dataset.rowId === id);
    if (!input) return;
    const activeKind = kind === "specialization" ? "specialization" : "skill";
    const current = input.value;
    const selected = this._customDiceEditors.has(id) ? DICE_CUSTOM :
      (DICE_PRESETS[activeKind].includes(current) ? current : (current ? DICE_CUSTOM : ""));
    for (const picker of root.querySelectorAll("[data-fnri-dice-picker]")) {
      if (picker.dataset.rowId !== id) continue;
      picker.hidden = picker.dataset.fnriDicePicker !== activeKind;
      if (!picker.hidden) picker.value = selected;
    }
    input.hidden = selected !== DICE_CUSTOM;
  }

  _saveRowControl(control) {
    if (!this.isEditable) return;
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
  }

  /** Register a single, addressable save path for each Actor control.
   * Row inputs intentionally have no `name` and cannot be submitted by
   * Handlebars FormData. This prevents the old competing full-array write.
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const modeControl = root.querySelector?.("[data-fnri-message-mode]");
    if (modeControl) {
      modeControl.value = this._messageMode;
      modeControl.addEventListener("change", event => { this._messageMode = event.currentTarget.value; });
    }
    for (const input of root.querySelectorAll("[data-row-collection][data-row-field][data-row-id]")) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const control = event.currentTarget;
        if (control.dataset.rowCollection === "skills" && control.dataset.rowField === "kind") {
          this._syncDicePickers(control.dataset.rowId, control.value);
        }
        this._saveRowControl(control);
      });
    }
    for (const picker of root.querySelectorAll("[data-fnri-dice-picker]")) {
      picker.addEventListener("change", event => {
        event.stopPropagation();
        if (!this.isEditable || picker.hidden) return;
        const id = picker.dataset.rowId;
        const input = [...root.querySelectorAll("[data-fnri-custom-dice]")]
          .find(control => control.dataset.rowId === id);
        if (!input || !VALID_ROW_ID.test(id ?? "")) return;
        if (picker.value === DICE_CUSTOM) {
          // Choosing "Custom formula" starts with an EMPTY formula, not the
          // preceding preset. Until a new formula is entered, Skill Check is
          // 1d20 (+ modifier). Persist the clearing immediately.
          this._customDiceEditors.add(id);
          input.value = "";
          input.hidden = false;
          this._saveRowControl(input);
          input.focus?.();
          return; // Never persist the UI-only sentinel.
        }
        // Presets and "No die" leave custom editing mode. Use the same
        // addressable write queue as all other Actor fields.
        this._customDiceEditors.delete(id);
        input.value = picker.value;
        input.hidden = true;
        this._saveRowControl(input);
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
    // AE-adjusted values are used by rolls, NEVER as edit-form defaults.
    // toObject(true) is the original persisted source, not prepared data.
    const base = actor.toObject?.(true)?.system ?? actor._source?.system ?? actor.system;
    const different = (path) => {
      const parts = path.split(".");
      const get = (object) => parts.reduce((current, key) => current?.[key], object);
      return get(base) !== get(actor.system);
    };
    const effectiveDiffs = {
      speed: different("speed"), attackModifier: different("attackModifier"),
      hp: Object.fromEntries(["current", "max", "temp"].map(key => [key, different("hp." + key)])),
      ac: Object.fromEntries(["partial", "success", "great"].map(key => [key, different("ac." + key)])),
      defenses: Object.fromEntries(["awareness", "reflex", "fortitude", "will"].map(key => [key, different("defenses." + key)]))
    };
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
      actor, system: base, effectiveSystem: actor.system, effectiveDiffs, editable: this.isEditable,
      preparedResourceRows: rowsOf(actor.system.resources),
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
      effectRows: [...(actor.effects?.contents ?? [])].map(effect => ({
        id: effect.id, name: effect.name, disabled: effect.disabled
      })),
      effectTargets: [
        { key: "system.speed", name: localized("Fields.speed") },
        ...["partial", "success", "great"].map(field => ({ key: "system.ac." + field, name: localized("Fields." + field) })),
        ...["awareness", "reflex", "fortitude", "will"].map(field => ({ key: "system.defenses." + field, name: localized("Fields." + field) })),
        ...(actor.type === "npc" ? [{ key: "system.attackModifier", name: localized("Fields.attackModifier") }] : []),
        ...rowsOf(base.skills).filter(row => VALID_ROW_ID.test(row.id)).map(row => ({
          key: `system.skills.${row.id}.modifier`, name: (row.name || localized("Fields.skill")) + " · " + localized("Fields.checkModifier")
        }))
      ],
      skillRows: rowsOf(base.skills).map(row => ({
        effectiveModifier: actor.system.skills?.[row.id]?.modifier,
        hasEffectiveModifier: (actor.system.skills?.[row.id]?.modifier ?? 0) !== (row.modifier ?? 0),
        ...row,
        isSpecialization: row.kind === "specialization",
        isSkill: row.kind !== "specialization",
        skillDiceOptions: diceOptions("skill", String(row.dice ?? ""), this._customDiceEditors.has(row.id)),
        specializationDiceOptions: diceOptions("specialization", String(row.dice ?? ""), this._customDiceEditors.has(row.id)),
        hasCustomDice: this._customDiceEditors.has(row.id) ||
          (!!row.dice && !DICE_PRESETS[row.kind === "specialization" ? "specialization" : "skill"].includes(row.dice)),
        hasLegacyValue: row.value !== null && row.value !== undefined
      })),
      resourceRows: rowsOf(base.resources)
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
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      itemRoll: FastNRIItemSheet.rollItem,
      createItemEffect: FastNRIItemSheet.createItemEffect,
      editItemEffect: FastNRIItemSheet.editItemEffect,
      toggleItemEffect: FastNRIItemSheet.toggleItemEffect,
      deleteItemEffect: FastNRIItemSheet.deleteItemEffect
    }
  };
  constructor(options = {}) {
    super(options);
    this._messageMode = "";
  }
  async _onRender(context, options) {
    await super._onRender(context, options);
    const select = this.element?.querySelector?.("[data-fnri-message-mode]");
    if (select) {
      select.value = this._messageMode;
      select.addEventListener("change", event => { this._messageMode = event.currentTarget.value; });
    }
  }
  _itemEffect(button) { return this.item.effects?.get(button.dataset.id); }
  static async createItemEffect() {
    if (!this.isEditable) return;
    try {
      const [effect] = await this.item.createEmbeddedDocuments("ActiveEffect", [{
        name: localized("Actions.createEffect"), type: "base", disabled: false,
        transfer: false, system: { changes: [] }
      }]);
      if (effect) await effect.sheet?.render({ force: true });
    } catch (error) {
      console.error("Fast NRI | item effect create failed", error);
      ui.notifications?.error(localized("Hints.saveFailed"));
    }
  }
  static async editItemEffect(_event, button) {
    const effect = this._itemEffect(button);
    if (effect) await effect.sheet?.render({ force: true });
  }
  static async toggleItemEffect(_event, button) {
    if (!this.isEditable) return;
    const effect = this._itemEffect(button);
    if (effect) await effect.update({ disabled: !effect.disabled });
  }
  static async deleteItemEffect(_event, button) {
    if (!this.isEditable) return;
    const effect = this._itemEffect(button);
    if (!effect) return;
    if (!await DialogV2.confirm({ window: { title: localized("Actions.deleteEffect") },
      content: `<p>${localized("Hints.confirmDelete")}</p>`, rejectClose: false })) return;
    await this.item.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
  }
  static async rollItem(_event, _button) {
    // A roll from an Item sheet belongs to that card; no fixed game rules
    // are applied or silently derived from class, weapon or user settings.
    const item = this.item;
    const formula = this.element?.querySelector?.('[name="system.rollFormula"]')?.value?.trim() ?? itemFormula(item);
    if (!formula) return ui.notifications?.warn(localized("Hints.emptyRollFormula"));
    try {
      const mode = this.element?.querySelector?.("[data-fnri-message-mode]")?.value || this._messageMode || game.settings.get("core", "messageMode");
      await postRoll({ formula, label: item.name,
        actor: item.parent?.documentName === "Actor" ? item.parent : null, mode });
    } catch (error) {
      console.error("Fast NRI | item roll failed", error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }
  static PARTS = { main: { root: true, template: "systems/fast-nri-v14/templates/item.hbs" } };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      item: this.item,
      system: this.item.toObject?.(true)?.system ?? this.item._source?.system ?? this.item.system,
      effectiveSystem: this.item.system, editable: this.isEditable,
      isWeapon: this.item.type === "weapon", isArmor: this.item.type === "armor",
      isGear: this.item.type === "gear", isAbility: this.item.type === "ability",
      isLegacy: this.item.type === "item",
      deprecated: this.item.getFlag("fast-nri-v14", "status") === "deprecated",
      hasRollFormula: !!itemFormula(this.item),
      itemEffects: [...(this.item.effects?.contents ?? [])].map(effect => ({
        id: effect.id, name: effect.name, disabled: effect.disabled, transfer: effect.transfer
      }))
    };
  }
}
