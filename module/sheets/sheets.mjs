import { skillFormula, itemFormula, postRoll } from "../rolls/checks.mjs";
import { isPhysicalWeaponCard, isPhysicalOtherItemAttack, sendWeaponAttack, sendOtherItemAttack } from "../weapon/weapon-attack.mjs";
import { itemGrip, equipmentKind, itemSlot, planEquipmentChange, hasFreeSecondHand } from "../equipment/equipment.mjs";
import { resolveUnarmedAction, sendUnarmedAttack, availableUnarmedActions, UNARMED_CHOICE_FLAG } from "../rolls/unarmed.mjs";
import { BASIC_SKILLS, BASIC_SKILLS_BY_ROW_ID, SKILL_GROUPS, standardSkillEntry } from "../data/skills-catalog.mjs";
/** Fast NRI v14: stage-2 document sheets. No game-rule automation. */
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;

const SYSTEM_ID = "fast-nri-v14";
const STYLES = ["fast-nri-v14", "fast-nri-sheet"];
const SECTION_DEFAULTS = Object.freeze({
  identity: true, parameters: true, ac: true, defenses: true,
  effects: false, resources: false, wealth: false
});
const TAB_IDS = new Set(["characteristics", "skills", "abilities", "inventory", "description"]);
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
const showStat = value => value === null || value === undefined || value === "" ? "—" : String(value);

/** Reconcile storage with prepared data. Effects may alter prepared modifiers,
 * but editable field defaults must come from source, when it exists. Do not
 * fall back to an empty source dictionary and accidentally hide prepared rows.
 */
function storedSkills(actor) {
  const source = actor.toObject?.(true)?.system?.skills ?? {};
  const raw = actor._source?.system?.skills ?? {};
  const prepared = actor.system?.skills ?? {};
  // Both are keyed records; source records override effect-adjusted prepared values.
  return { ...prepared, ...raw, ...source };
}

function preparedSkillRow(row, actor, customEditors) {
  return {
    ...row,
    hasDice: !!String(row.dice ?? "").trim(),
    effectiveModifier: actor.system.skills?.[row.id]?.modifier,
    hasEffectiveModifier: (actor.system.skills?.[row.id]?.modifier ?? 0) !== (row.modifier ?? 0),
    isSpecialization: row.kind === "specialization",
    isSkill: row.kind !== "specialization",
    skillDiceOptions: diceOptions("skill", String(row.dice ?? ""), customEditors.has(row.id)),
    specializationDiceOptions: diceOptions("specialization", String(row.dice ?? ""), customEditors.has(row.id)),
    hasCustomDice: customEditors.has(row.id) ||
      (!!row.dice && !DICE_PRESETS[row.kind === "specialization" ? "specialization" : "skill"].includes(row.dice)),
    hasLegacyValue: row.value !== null && row.value !== undefined
  };
}


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

function rowWithSelection(item, system) {
  const slot = itemSlot(item.id, system);
  const isEquipped = Boolean(slot);
  const label = slot?.kind === 'hand' ?
    (slot.positions.length === 2 ? localized('Equipment.bothHands') :
      localized(slot.positions[0] === 'leftHand' ? 'Equipment.hand1' : 'Equipment.hand2')) :
    slot?.kind === 'armor' ? localized('Fields.armorSlot') :
      (slot?.label || localized('Equipment.other'));
  return {
    item, id: item.id, name: item.name, img: item.img, type: item.type,
    isEquipped, equipmentLabel: isEquipped ? label : '',
    canEquip: equipmentKind(item) !== null,
    hasRollFormula: !!itemFormula(item),
    canWeaponAttack: isPhysicalWeaponCard(item),
    canOtherAttack: isPhysicalOtherItemAttack(item)
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
      toggleQuickHp: ActorBase.toggleQuickHp,
      toggleSkillGroup: ActorBase.toggleSkillGroup,
      rollAbility: ActorBase.rollAbility,
      weaponAttack: ActorBase.weaponAttack,
      attackEquipped: ActorBase.attackEquipped,
      attackUnarmed: ActorBase.attackUnarmed,
      selectUnarmedAttack: ActorBase.selectUnarmedAttack,
      toggleEquipment: ActorBase.toggleEquipment,
      cleanOrphanedEquipment: ActorBase.cleanOrphanedEquipment,
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
    const savedTab = game.user?.getFlag?.(SYSTEM_ID, "sheetTab_" + this.actor?.id);
    this._selectedTab = TAB_IDS.has(savedTab) ? savedTab : "characteristics";
    this._writeQueue = Promise.resolve();
    this._tabFlagQueue = Promise.resolve();
    this._quickHpOpen = false;
    this._skillsFilter = "all";
    this._groupState = new Map();
    this._sectionState = new Map();
    this._pendingWrites = 0;
    this._lastWriteError = false;
    this._failedFields = new Set();
    // UI-only selection; never persisted as a game-rule constraint or sentinel.
    this._customDiceEditors = new Set();
  }

  /** Serialize updates initiated from this sheet, and keep the queue usable
   * after a rejected update. Across clients, each edit uses an independent
   * document field path instead of replacing skills/resources wholesale.
   */
  _updateSaveIndicator() {
    const el = this.element?.querySelector?.("[data-fnri-save-state]");
    if (!el) return;
    const status = this._pendingWrites ? "saving" :
      (this._lastWriteError || this._failedFields.size ? "error" : "saved");
    el.dataset.state = status;
    el.textContent = localized("Save." + status);
  }

  _queueWrite(operation, fieldKey = null) {
    this._pendingWrites++;
    this._updateSaveIndicator();
    const update = this._writeQueue.then(async () => {
      if (!this.isEditable) return;
      return operation();
    });
    this._writeQueue = update.then(() => {
      if (fieldKey) this._failedFields.delete(fieldKey);
      this._lastWriteError = false;
      this._pendingWrites--;
      this._updateSaveIndicator();
    }, error => {
      if (fieldKey) this._failedFields.add(fieldKey);
      this._lastWriteError = true;
      this._pendingWrites--;
      this._updateSaveIndicator();
      console.error("Fast NRI | Actor sheet update failed", error);
      ui.notifications?.error(localized("Hints.saveFailed"));
    });
    return update;
  }

  async _flushWrites() {
    await this._writeQueue;
    return !this._lastWriteError && this._failedFields.size === 0;
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
    // A user's last tab is remembered per Actor, without touching Actor data.
    if (this.actor?.id && game.user?.setFlag) {
      this._tabFlagQueue = this._tabFlagQueue.then(() =>
        game.user.setFlag(SYSTEM_ID, "sheetTab_" + this.actor.id, tab)
      ).catch(error => console.warn("Fast NRI | Could not save last sheet tab", error));
    }
  }

  static toggleQuickHp() {
    if (!this.isEditable) return;
    this._quickHpOpen = !this._quickHpOpen;
    const panel = this.element?.querySelector?.("[data-fnri-quick-hp]");
    if (panel) panel.hidden = !this._quickHpOpen;
    const button = this.element?.querySelector?.("[data-action='toggleQuickHp']");
    button?.setAttribute?.("aria-expanded", String(this._quickHpOpen));
    if (this._quickHpOpen) panel?.querySelector?.("input")?.focus?.();
  }

  static toggleSkillGroup(_event, button) {
    const id = button.dataset.group;
    if (![...SKILL_GROUPS, "custom"].includes(id)) return;
    const expanded = !(this._groupState.get(id) ?? true);
    this._groupState.set(id, expanded);
    const panel = [...(this.element?.querySelectorAll?.("[data-fnri-skill-group-content]") ?? [])]
      .find(node => node.dataset.fnriSkillGroupContent === id);
    if (panel) panel.hidden = !expanded;
    button.setAttribute?.("aria-expanded", String(expanded));
  }

  _applySkillFilter() {
    for (const row of this.element?.querySelectorAll?.("[data-fnri-skill-entry]") ?? []) {
      row.hidden = this._skillsFilter === "assigned" && row.dataset.fnriDiceAssigned !== "true";
    }
  }

  static async rollAbility(_event, button) {
    const id = button.closest?.("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "ability") return;
    const formula = itemFormula(item);
    if (!formula) return;
    try {
      await postRoll({formula, label: item.name, actor: this.actor,
        mode: game.settings.get("core", "messageMode")});
    } catch (error) {
      console.error("Fast NRI | Ability roll failed", error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }

  static async weaponAttack(_event, button) {
    const id = button.closest?.("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!isPhysicalWeaponCard(item)) return;
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized("Hints.unsavedRoll"));
    try { await sendWeaponAttack(item, this.actor); }
    catch (error) {
      console.error("Fast NRI | weapon attack failed",error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }

  static async toggleEquipment(_event, button) {
    if (!this.isEditable) return;
    const id = button.closest?.('[data-item-id]')?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item || equipmentKind(item) === null) return;
    await this._queueWrite(async () => {
      const equipped = Boolean(itemSlot(id, this.actor.system));
      const planned = planEquipmentChange(this.actor.system, item, !equipped);
      if (!planned.ok) throw new Error(`Equipment: ${planned.reason}`);
      if (Object.keys(planned.updates).length) await this.actor.update(planned.updates);
    });
  }

  static async cleanOrphanedEquipment() {
    if (!this.isEditable) return;
    await this._queueWrite(async () => {
      const known = new Set(this.actor.items.contents.map(item => item.id));
      const equipment = this.actor.system.equipment ?? {};
      const updates = {};
      for (const key of EQUIPMENT_SLOTS) {
        if (equipment[key] && !known.has(equipment[key])) {
          updates[`system.equipment.${key}`] = '';
          if (key !== 'armor') updates[`system.equipmentWear.${key}`] = 0;
        }
      }
      for (const [slotId, row] of Object.entries(this.actor.system.equipmentSlots ?? {})) {
        if (VALID_ROW_ID.test(slotId) && row?.itemId && !known.has(row.itemId))
          updates[`system.equipmentSlots.${slotId}.itemId`] = '';
      }
      if (Object.keys(updates).length) await this.actor.update(updates);
    });
  }

  static async attackEquipped(_event, button) {
    const id = button.closest?.('[data-item-id]')?.dataset.itemId;
    const item = this.actor.items.get(id);
    const slot = item && itemSlot(id, this.actor.system);
    if (!slot) return; // Cannot attack from a backpack or a stale UI row.
    if (item.type === 'weapon' && itemGrip(item) === '1+' && slot.kind === 'hand' &&
        !hasFreeSecondHand(this.actor.system, slot.positions[0])) {
      return ui.notifications?.warn(localized('Equipment.secondHandRequired'));
    }
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
    try {
      if (isPhysicalWeaponCard(item)) await sendWeaponAttack(item, this.actor);
      else if (isPhysicalOtherItemAttack(item)) await sendOtherItemAttack(item, this.actor);
    } catch (error) {
      console.error('Fast NRI | equipped attack failed', error);
      ui.notifications?.warn(localized('Hints.rollFailed'));
    }
  }

  /** Keep the user's explicit choice on the Actor, not in an item or UI-only state. */
  static async selectUnarmedAttack(_event, button) {
    if (!this.isEditable) return;
    const key = button.dataset.unarmedChoice;
    if (!key || !availableUnarmedActions(this.actor).some(option => option.key === key)) return;
    await this._queueWrite(() => this.actor.update({
      [`flags.${SYSTEM_ID}.${UNARMED_CHOICE_FLAG}`]: key
    }), `flags.${SYSTEM_ID}.${UNARMED_CHOICE_FLAG}`);
  }

  static async attackUnarmed() {
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
    try { await sendUnarmedAttack(this.actor); }
    catch (error) {
      console.error('Fast NRI | unarmed attack failed', error);
      ui.notifications?.warn(localized('Hints.rollFailed'));
    }
  }

  static async rollSkill(_event, button) {
    const id = button.dataset.id;
    if (!VALID_ROW_ID.test(id ?? "")) return;
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized("Hints.unsavedRoll"));
    const standard = BASIC_SKILLS_BY_ROW_ID.get(id);
    const entry = this.actor.system.skills?.[id] ?? storedSkills(this.actor)[id] ??
      (standard ? standardSkillEntry(standard) : null);
    if (!entry) return;
    try {
      await postRoll({
        formula: skillFormula(entry), label: entry.name || localized("Fields.skill"),
        actor: this.actor, mode: game.settings.get("core", "messageMode")
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
      const changes = planEquipmentChange(this.actor.system, item, false).updates ?? {};
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
      const source = this.actor._source?.system?.[collection] ?? this.actor.toObject?.(true)?.system?.[collection] ?? {};
      if (!Object.hasOwn(this.actor.system[collection] ?? {}, id) && !Object.hasOwn(source, id)) return;
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
    if (collection === "skills" && field === "dice") {
      const row = control.closest?.("[data-fnri-skill-entry]");
      if (row) row.dataset.fnriDiceAssigned = String(!!String(parsed.value ?? "").trim());
      this._applySkillFilter();
    }
    const fieldKey = "system." + collection + "." + id + "." + field;
    void this._queueWrite(async () => {
      if (!Object.hasOwn(this.actor.system[collection] ?? {}, id)) {
        const source = this.actor._source?.system?.[collection] ?? this.actor.toObject?.(true)?.system?.[collection] ?? {};
        if (Object.hasOwn(source, id)) {
          // The prepared model can be temporarily incomplete after loading.
          // Preserve and update the existing persisted row, never overwrite it.
          return this.actor.update({ [fieldKey]: parsed.value });
        }
        // For pre-v0.1.9 characters, a missing standard entry is displayed
        // virtually; the first edit creates exactly that entry, without
        // replacing any other skill (including those on other clients).
        const standard = collection === "skills" ? BASIC_SKILLS_BY_ROW_ID.get(id) : null;
        if (!standard) return;
        return this.actor.update({ ["system.skills." + id]: {
          ...standardSkillEntry(standard), [field]: parsed.value
        } });
      }
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
    this._updateSaveIndicator();
    const filter = root.querySelector?.("[data-fnri-skill-filter]");
    if (filter) {
      filter.value = this._skillsFilter;
      filter.addEventListener("change", event => {
        this._skillsFilter = event.currentTarget.value === "assigned" ? "assigned" : "all";
        this._applySkillFilter();
      });
      this._applySkillFilter();
    }
    for (const section of root.querySelectorAll?.("[data-fnri-section]") ?? []) {
      section.addEventListener("toggle", event => {
        this._sectionState.set(event.currentTarget.dataset.fnriSection, event.currentTarget.open);
      });
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
    // Equipment buttons, not editable selectors, own the slot assignment.
    const allIDs = new Set(items.map(item => item.id));
    const missingEquipment = {
      leftHand: !!equipment.leftHand && !allIDs.has(equipment.leftHand),
      rightHand: !!equipment.rightHand && !allIDs.has(equipment.rightHand),
      armor: !!equipment.armor && !allIDs.has(equipment.armor)
    };
    // Keep legacy custom slot rows readable/editable by name, never erase data.
    const extraSlotRows = Object.entries(actor.system.equipmentSlots ?? {})
      .filter(([id,slot]) => !id.startsWith('auto_') || !!slot.itemId)
      .map(([id, slot]) => ({ id, name: slot.name, itemId: slot.itemId,
        missing: !!slot.itemId && !allIDs.has(slot.itemId) }));
    const attackRow = (id, label, occupied = false) => {
      const item = items.find(i => i.id === id);
      const allowed = item && (isPhysicalWeaponCard(item) || isPhysicalOtherItemAttack(item));
      const activeSlot = item ? itemSlot(item.id, actor.system) : null;
      const blocked = item?.type === 'weapon' && itemGrip(item) === '1+' &&
        activeSlot?.kind === 'hand' && !hasFreeSecondHand(actor.system, activeSlot.positions[0]);
      return { id: item?.id ?? '', name: item?.name ?? '', label, occupied,
        canAttack: !!allowed && !blocked, blocked: !!blocked };
    };
    const bothHands = !!equipment.leftHand && equipment.leftHand === equipment.rightHand;
    const hands = bothHands ? [attackRow(equipment.leftHand,localized('Equipment.bothHands'))] : [
      attackRow(equipment.leftHand,localized('Equipment.hand1')),
      attackRow(equipment.rightHand,localized('Equipment.hand2'))
    ];
    const unarmed = resolveUnarmedAction(actor);
    const otherAttacks = items.filter(item => {
      const slot = itemSlot(item.id,actor.system);
      return slot?.kind === 'other' && isPhysicalOtherItemAttack(item);
    }).map(item => attackRow(item.id,localized('Equipment.other')));
    const completeSkills = storedSkills(actor);
    // Diagnostics only: if source has records that the prepared model missed,
    // show them from the source and report the mismatch once per sheet.
    const missingPrepared = Object.keys(completeSkills).filter(id =>
      !Object.hasOwn(actor.system.skills ?? {}, id));
    if (missingPrepared.length && !this._reportedMissingPreparedSkills) {
      this._reportedMissingPreparedSkills = true;
      console.warn("Fast NRI | Actor skill data mismatch after preparation", {
        actorId: actor.id, missingPrepared
      });
    }
    const tab = TAB_IDS.has(this._selectedTab) ? this._selectedTab : "characteristics";
    return {
      ...context,
      actor, system: base, effectiveSystem: actor.system, effectiveDiffs, editable: this.isEditable,
      quickHpOpen: this._quickHpOpen,
      skillFilterAssigned: this._skillsFilter === "assigned",
      sections: Object.fromEntries(Object.entries(SECTION_DEFAULTS).map(([id, initial]) =>
        [id, this._sectionState.get(id) ?? initial])),
      customGroupExpanded: this._groupState.get("custom") ?? true,
      summary: {
        hp: `${showStat(actor.system.hp?.current)} / ${showStat(actor.system.hp?.max)}`,
        tempHP: Number(actor.system.hp?.temp) ? (Number(actor.system.hp.temp) > 0 ? `+${actor.system.hp.temp}` : String(actor.system.hp.temp)) : "",
        ac: ["partial", "success", "great"].map(key => showStat(actor.system.ac?.[key])).join(" / "),
        combatDie: showStat(actor.system.combatDie),
        attackModifier: showStat(actor.system.attackModifier),
        speed: showStat(actor.system.speed)
      },
      preparedResourceRows: rowsOf(actor.system.resources),
      activeTab: tab,
      tabs: {
        characteristics: tab === "characteristics", skills: tab === "skills",
        abilities: tab === "abilities", inventory: tab === "inventory",
        description: tab === "description"
      },
      items: items.map(item => rowWithSelection(item, actor.system)),
      abilityItems: items.filter(i => i.type === "ability").map(item => rowWithSelection(item, actor.system)),
      inventoryItems: items.filter(i => i.type !== "ability").map(item => rowWithSelection(item, actor.system)),
      attackHands: hands, unarmedAction: unarmed, otherAttacks, hasOtherAttacks: otherAttacks.length > 0,
      missingEquipment, extraSlotRows,
      hasMissingEquipment: Object.values(missingEquipment).some(Boolean) || extraSlotRows.some(row => row.missing),
      effectRows: [...(actor.effects?.contents ?? [])].map(effect => ({
        id: effect.id, name: effect.name, disabled: effect.disabled
      })),
      effectTargets: [
        { key: "system.speed", name: localized("Fields.speed") },
        ...["partial", "success", "great"].map(field => ({ key: "system.ac." + field, name: localized("Fields." + field) })),
        ...["awareness", "reflex", "fortitude", "will"].map(field => ({ key: "system.defenses." + field, name: localized("Fields." + field) })),
        ...(actor.type === "npc" ? [{ key: "system.attackModifier", name: localized("Fields.attackModifier") }] : []),
        ...rowsOf(completeSkills).filter(row => VALID_ROW_ID.test(row.id)).map(row => ({
          key: `system.skills.${row.id}.modifier`, name: (row.name || localized("Fields.skill")) + " · " + localized("Fields.checkModifier")
        }))
      ],
      catalogGroups: SKILL_GROUPS.map(group => ({
        id: group, name: localized("SkillGroups." + group),
        expanded: this._groupState.get(group) ?? true,
        rows: BASIC_SKILLS.filter(skill => skill.group === group).map(skill => {
          const id = "core_" + skill.id;
          const current = completeSkills[id] ?? standardSkillEntry(skill);
          // Standard catalogue identity is authoritative, but the assigned
          // formula and modifier always belong to this Actor's own record.
          return preparedSkillRow({ ...current, name: skill.name, id,
            description: skill.description, standard: true }, actor, this._customDiceEditors);
        })
      })),
      skillRows: rowsOf(completeSkills).filter(row => !BASIC_SKILLS_BY_ROW_ID.has(row.id))
        .map(row => preparedSkillRow(row, actor, this._customDiceEditors)),
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
      weaponAttack: FastNRIItemSheet.weaponAttack,
      createItemEffect: FastNRIItemSheet.createItemEffect,
      editItemEffect: FastNRIItemSheet.editItemEffect,
      toggleItemEffect: FastNRIItemSheet.toggleItemEffect,
      deleteItemEffect: FastNRIItemSheet.deleteItemEffect
    }
  };
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
  static async weaponAttack() {
    if (!isPhysicalWeaponCard(this.item)) return;
    try { await sendWeaponAttack(this.item); }
    catch (error) {
      console.error("Fast NRI | weapon attack failed",error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }

  static async rollItem(_event, _button) {
    // A roll from an Item sheet belongs to that card; no fixed game rules
    // are applied or silently derived from class, weapon or user settings.
    const item = this.item;
    const formula = this.element?.querySelector?.('[name="system.rollFormula"]')?.value?.trim() ?? itemFormula(item);
    if (!formula) return ui.notifications?.warn(localized("Hints.emptyRollFormula"));
    try {
      // Respect the native Chat sidebar visibility mode at the moment of the roll.
      const mode = game.settings.get("core", "messageMode");
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
      gearHand: this.item.system?.mechanics?.equipment?.slot === 'hand',
      gearArmor: this.item.system?.mechanics?.equipment?.slot === 'armor',
      gearOther: this.item.system?.mechanics?.equipment?.slot === 'other',
      gearPhysicalAttack: this.item.system?.mechanics?.attack?.kind === 'physical',
      abilityReplaceUnarmed: this.item.system?.mechanics?.unarmedAttack?.mode === 'replace',
      abilityOptionUnarmed: this.item.system?.mechanics?.unarmedAttack?.mode === 'option',
      deprecated: this.item.getFlag("fast-nri-v14", "status") === "deprecated",
      hasRollFormula: !!itemFormula(this.item),
      canWeaponAttack: isPhysicalWeaponCard(this.item),
      weaponAutoProficiency: !this.item.system.proficiencyMode || this.item.system.proficiencyMode === 'auto',
      weaponYesProficiency: this.item.system.proficiencyMode === 'yes',
      weaponNoProficiency: this.item.system.proficiencyMode === 'no',
      weaponRuleRows: Object.entries(this.item.system?.mechanics?.propertyRules ?? {}).map(([name,description])=>({name,description})),
      itemEffects: [...(this.item.effects?.contents ?? [])].map(effect => ({
        id: effect.id, name: effect.name, disabled: effect.disabled, transfer: effect.transfer
      }))
    };
  }
}
