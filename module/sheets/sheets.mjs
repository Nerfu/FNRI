import { currentMessageMode } from '../data/chat-visibility.mjs';
import {resolveSkillAllocation,skillDieEditPatch,skillAllocationPatch,planSkillUpgrade,skillPoolEditPatch,skillFormulaOverridePatch,resetSkillAssignmentsPatch} from "../data/skill-allocation.mjs";
import {openSkillEditor,skillUpgradeCandidates} from "./skill-editor.mjs";
import {classAbilityCard,missingClassAbilityRows,useClassAbilityCard} from "./class-abilities.mjs";
import {chooseCharacterOption} from "./character-choice.mjs";
import {classSelectionUpdate,classNames,classDefinition,prepareClassBaseStats,DOUBLE_INVOCATION_ID} from "../data/classes.mjs";
import {permanentRacialStats} from "../data/character-contributions.mjs";
import {chooseByButtons} from '../rolls/button-choice.mjs';
import {isProjectionActor,projectionCaster,projectionLink,projectionActorsForAbility,
  linkProjectionActor,unlinkProjectionActor,worldProjectionActor,worldProjectionAbility} from '../projection/projection.mjs';
import {publishAbility} from '../abilities/ability-chat.mjs';
import { actorJournalRows } from "../data/actor-journal.mjs";
import { potionResource, potionText } from "../data/potion-resource.mjs";
import { restActor, queueActorWrite } from "../data/ability-accounting.mjs";
import { interventionWarnings } from "../data/intervention-availability.mjs";
import { showAllInterventions } from "../damage/intervention-menu.mjs";
import { skillFormula, itemFormula, postRoll } from "../rolls/checks.mjs";
import { rollStandardAction, standardAction } from "../rolls/standard-actions.mjs";
import { hasCheckLinks } from "../rolls/check-links.mjs";
import { useItem } from "../equipment/item-use.mjs";
import { declareAction, actionAudience, actionSpeaker } from "../rolls/action-declaration.mjs";
import { standaloneIntervention } from "../damage/standalone-intervention.mjs";
import { cardRollKind } from "../rolls/roll-contributions.mjs";
import { roleNames } from "../data/roles.mjs";
import { initiateCounteraction } from "../damage/counteraction.mjs";
import { openEffectParametersEditor } from "../effects/effect-parameters-editor.mjs";
import { isPhysicalWeaponCard, isPhysicalOtherItemAttack, sendWeaponAttack, sendOtherItemAttack } from "../weapon/weapon-attack.mjs";
import {abilityUsesWeapon,resolveAbilityWeapon} from "../equipment/weapon-traits.mjs";
import { equipmentKind, itemSlot, planEquipmentChange, needsSecondHandWarning } from "../equipment/equipment.mjs";
import { resolveUnarmedAction, sendUnarmedAttack, availableUnarmedActions, UNARMED_CHOICE_FLAG } from "../rolls/unarmed.mjs";
import { BASIC_SKILLS, BASIC_SKILLS_BY_ROW_ID, SKILL_GROUPS, standardSkillEntry } from "../data/skills-catalog.mjs";
import { BASE_SELF_DEFENSE } from "../data/core-actions.mjs";
import {compactPhysicalProfile,attackCardDetails} from "./attack-preview.mjs";
import {racialPropertyRows,racialChoiceWarning,openRacialPropertyEditor,chooseRacialSubproperty,addRacialProperty} from "./racial-property-picker.mjs";
import {racialRaceNames,racialLabel,racialPropertyRule,changesAncestry,racialState} from "../data/racial-properties.mjs";
import {editRacialSubproperty,syncInnateProperties} from "./racial-property-lifecycle.mjs";
import {normalizeAttackKind,effectiveWeaponProperties,hasComputedReach,explicitInterventionFromCard} from "../rolls/attack-properties.mjs";
import { actionSections, extraAbilityActions, isFirearm, sheetAction, sheetActionText,
  shortRestActions, skillActionRows } from "./action-catalog.mjs";
import { interventionSources, openChatSource, talismanSources } from "./action-context.mjs";
/** Fast NRI v14: stage-2 document sheets. No game-rule automation. */
const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;

const SYSTEM_ID = "fast-nri-v14";
const STYLES = ["fast-nri-v14", "fast-nri-sheet"];
const SECTION_DEFAULTS = Object.freeze({
  identity: true, parameters: true, ac: true, defenses: true,
  effects: false, resources: false, wealth: false
});
const TAB_IDS = new Set(["characteristics", "actions", "skills", "abilities", "inventory", "description", "journal"]);
const ACTOR_PARTIALS = Object.fromEntries(['actor-actions', 'actor-standard-action', 'actor-core-skill', 'actor-short-rest']
  .map(id => [`fnri-${id}`, `systems/${SYSTEM_ID}/templates/${id}.hbs`]));
const ITEM_TYPES = new Set(["weapon", "armor", "gear", "ability"]);
const ROW_FIELDS = {
  skills: new Set(["name", "kind", "group", "dice", "modifier", "value"]),
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
  specialization: ["1d6", "1d4", "1d8", "1d10", "1d12"]
});

function diceOptions(kind, current, customEditing = false) {
  const available = DICE_PRESETS[kind] ?? DICE_PRESETS.skill;
  // Keep the custom editor open after an empty value is saved and the Actor
  // sheet is re-rendered by Foundry's document update notifications.
  const selected = customEditing ? DICE_CUSTOM :
    (available.includes(current) ? current : (current ? DICE_CUSTOM : ""));
  const result = [{ value: "", label: localized("Fields.noDice"), selected: selected === "" }];
  for (const value of available) {
    const label = value.slice(1);
    result.push({ value, label, selected: selected === value });
  }
  result.push({ value: DICE_CUSTOM, label: localized("Fields.customDice"), selected: selected === DICE_CUSTOM });
  return result;
}

const sortedItems = items => [...items].sort((a, b) =>
  (a.sort - b.sort) || a.name.localeCompare(b.name));
const localized = key => game.i18n.localize("FASTNRI." + key);
const fmtOptions = raw => Array.isArray(raw) ? raw.join(', ') : String(raw??'');
const makeOptions=(values,current)=>values.map(value=>({value,label:({
  '':'—',ac:'КЗ',fortitude:localized('Damage.statFortitude'),
  reflex:localized('Damage.statReflex'),will:localized('Damage.statWill'),
  set:localized('Damage.defenseSet'),choose:localized('Damage.defenseChoose'),
  passive:localized('Damage.passive'),intervention:localized('Damage.intervention'),
  any:localized('Damage.any'),melee:localized('Weapon.melee'),ranged:localized('Weapon.ranged')
})[value]??value, selected:value===current}));
const rowsOf = object => Object.entries(object ?? {}).map(([id, values]) => ({ id, ...values }));
const showStat = value => value === null || value === undefined || value === "" ? "—" : String(value);
const escapeHtml = value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function chooseSheetOption(title, options, intro = "", {buttons = false} = {}) {
  if (!options.length) return null;
  if (buttons) {
    const row = await chooseByButtons({title, intro, confirmLabel:localized('Damage.select'), rows:options.map(({name},i)=>({value:String(i),label:name}))});
    return row ? options[Number(row.value)] ?? null : null;
  }
  const choices = options.map(({name}, index) => `<option value="${index}">${escapeHtml(name)}</option>`).join("");
  const result = await DialogV2.input({window: {title}, content:
    (intro ? `<p>${escapeHtml(intro)}</p>` : "") +
    `<select name="choice" aria-label="${escapeHtml(title)}">${choices}</select>`,
    ok: {label: localized("Damage.select")}, rejectClose: false});
  return result ? options[Number(result.choice)] ?? null : null;
}

function showSheetDescription(title, content) {
  return DialogV2.prompt({window: {title}, content,
    ok: {label: localized("Builtin.close")}, rejectClose: false});
}

/** Chat feedback for the existing Rest action. Uses ONLY the changes returned
 * by the completed Actor operation; no extra journal, snapshot, or UI window.
 * Public NPC messages do not disclose private resource values or ability names.
 */
function restChatContent(actor, result) {
  const label = key => localized(`Actions.${key}`);
  const lines = [];
  const isNPC = actor.type === 'npc';
  const hp = result.hpChanges ?? [];
  const hpCurrent = hp.find(change => change.field === 'current');
  const hpTemp = hp.find(change => change.field === 'temp');
  const formatChange = change => `${showStat(change.before)} → ${showStat(change.after)}`;
  if (hpCurrent) lines.push(isNPC ? label('restHp') : `${label('restHp')}: ${formatChange(hpCurrent)}`);
  if (hpTemp) lines.push(isNPC ? label('restTemp') : `${label('restTemp')}: ${formatChange(hpTemp)}`);

  const resources = result.resourceChanges ?? [];
  if (isNPC) {
    if (resources.length) lines.push(`${label('restResources')}: ${resources.length}`);
  } else {
    for (const change of resources) {
      const name = change.potion ? potionText("name") : String(actor.system?.resources?.[change.resourceId]?.name ?? '').trim() || label('restUnnamedResource');
      lines.push(`${name}: ${formatChange(change)}`);
    }
  }
  const abilityCount = result.restoredAbilityCount ?? 0;
  if (abilityCount) {
    const names = !isNPC ? (result.restoredAbilityNames ?? []) : [];
    lines.push(`${label('restAbilities')}: ${names.length === abilityCount ? names.join(', ') : abilityCount}`);
  }
  if (result.removedActorEffectCount > 0)
    lines.push(`${label('restEffects')}: ${result.removedActorEffectCount}`);

  const title = `<p>${escapeHtml(actor.name)} — ${escapeHtml(label('restChat'))}</p>`;
  return lines.length
    ? `${title}<ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
    : `${title}<p>${escapeHtml(label('restAlreadyFull'))}</p>`;
}

/** Reconcile storage with prepared data. Effects may alter prepared modifiers,
 * but editable field defaults must come from source, when it exists. Do not
 * fall back to an empty source dictionary and accidentally hide prepared rows.
 */
function storedSkills(actor) {
  const source = actor.toObject?.(true)?.system?.skills ?? {};
  const prepared = actor.system?.skills ?? {};
  // Use the public source view, not internal _source; preserve prepared defaults.
  const result={ ...prepared, ...source };
  if(actor.type==='character'){
    const allocation=resolveSkillAllocation(actor.toObject?.(true)?.system??actor.system,actor.items?.contents??[]);
    if(allocation.active)for(const [id,skill] of BASIC_SKILLS_BY_ROW_ID)if(result[id])result[id]={...result[id],dice:allocation.rows[skill.id].formula};
  }
  return result;
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

// HP inputs accept a bare absolute number or +/- integer arithmetic. A leading
// sign is relative to the latest persisted HP; no JS evaluation or dice rolls.
function hpMathFromInput(raw) {
  const text = raw.trim();
  if (!text) return {valid:true, value:null, relative:false};
  if (!/^[+-]?\s*\d+(?:\s*[+-]\s*\d+)*$/.test(text)) return {valid:false};
  const compact = text.replace(/\s/g, "");
  const terms = compact.match(/[+-]?\d+/g).map(Number);
  if (!terms.every(Number.isSafeInteger)) return {valid:false};
  let value = 0;
  for (const term of terms) {
    value += term;
    if (!Number.isSafeInteger(value)) return {valid:false};
  }
  return {valid:true, value, relative:/^[+-]/.test(compact)};
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
    hasRollFormula: !!itemFormula(item) ||
      (abilityUsesWeapon(item) && isPhysicalOtherItemAttack(item,item.parent)),
    canWeaponAttack: isPhysicalWeaponCard(item),
    canOtherAttack: isPhysicalOtherItemAttack(item)
  };
}

function isMeleeAttack(item, actor) {
  if (isPhysicalWeaponCard(item)) return normalizeAttackKind(item.system.attackKind) === 'melee';
  if (!isPhysicalOtherItemAttack(item, actor)) return false;
  const kind = item.system.mechanics.attack.attackKind ?? resolveAbilityWeapon(item, actor)?.system?.attackKind ?? 'melee';
  return normalizeAttackKind(kind) === 'melee';
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
      openProjectionOwner: ActorBase.openProjectionOwner,
      toggleProjectionFull: ActorBase.toggleProjectionFull,
      toggleQuickHp: ActorBase.toggleQuickHp,
      toggleSkillGroup: ActorBase.toggleSkillGroup,
      toggleSkillActions: ActorBase.toggleSkillActions,
      openSheetAction: ActorBase.openSheetAction,
      declareSheetAction: ActorBase.declareSheetAction,
      jumpToSheetAction: ActorBase.jumpToSheetAction,
      rollSheetAction: ActorBase.rollSheetAction,
      rollQuickStrike: ActorBase.rollQuickStrike,
      openInterventionSource: ActorBase.openInterventionSource,
      invokeFromSheet: ActorBase.invokeFromSheet,
      openGrantedAction: ActorBase.openGrantedAction,
      useInventoryItem: ActorBase.useInventoryItem,
      rollAbility: ActorBase.rollAbility,
      publishAbility: ActorBase.publishAbility,
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
      viewBuiltinSelfDefense: ActorBase.viewBuiltinSelfDefense,
      createItem: ActorBase.createItem,
      deleteItem: ActorBase.deleteItem,
      addSkill: ActorBase.addSkill,
      addSpecialization: ActorBase.addSpecialization,
      removeSkill: ActorBase.removeSkill,
      addResource: ActorBase.addResource,
      adjustResource: ActorBase.adjustResource,
      removeResource: ActorBase.removeResource,
      restActor: ActorBase.restActor,
      addEquipmentSlot: ActorBase.addEquipmentSlot,
      removeEquipmentSlot: ActorBase.removeEquipmentSlot
    }
  };

  constructor(options = {}) {
    super(options);
    const savedTab = game.user?.getFlag?.(SYSTEM_ID, "sheetTab_" + this.actor?.id);
    this._selectedTab = TAB_IDS.has(savedTab) ? savedTab : "characteristics";
    this._showProjectionFull = false;
    this._writeQueue = Promise.resolve();
    this._tabFlagQueue = Promise.resolve();
    this._quickHpOpen = false;
    this._characterEditing = false;
    this._skillEditorOpen = false;
    this._restPending = false;
    this._skillsFilter = "all";
    this._groupState = new Map();
    this._expandedSkillActions = new Set();
    this._pendingSheetActions = new Set();
    this._sectionState = new Map();
    this._pendingWrites = 0;
    this._lastWriteError = false;
    this._failedFields = new Set();
    // UI-only selection; never persisted as a game-rule constraint or sentinel.
    this._customDiceEditors = new Set();
  }

  static async openProjectionOwner() {
    const owner = projectionCaster(this.actor);
    if (owner) await owner.sheet?.render({force: true});
    else ui.notifications?.info(localized('Projection.unlinked'));
  }

  static toggleProjectionFull() {
    this._showProjectionFull = !this._showProjectionFull;
    this.setPosition({width: this._showProjectionFull ? 760 : 470, height: this._showProjectionFull ? 720 : 530});
    this.render({force: true});
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

  _queueWrite(operation, fieldKey = null, reportError = null) {
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
      if (typeof reportError === "function") reportError(error);
      else ui.notifications?.error(localized("Hints.saveFailed"));
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

  static toggleSkillActions(_event, button) {
    const panel = button.closest('[data-fnri-skill-entry]')?.querySelector('[data-fnri-skill-actions]');
    if (!panel) return;
    const id = button.dataset.id;
    const expanded = !this._expandedSkillActions.has(id);
    if (expanded) this._expandedSkillActions.add(id);
    else this._expandedSkillActions.delete(id);
    panel.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
  }

  static jumpToSheetAction(_event, button) {
    if (!this.element) return;
    ActorBase.changeTab.call(this, null, {dataset: {fnriTarget: 'actions'}});
    const id = button.dataset.id;
    const action = id && [...this.element.querySelectorAll('[data-fnri-panel="actions"] [data-fnri-sheet-action]')]
      .find(row => row.dataset.fnriSheetAction === id);
    const row = action || this.element.querySelector(id === 'unarmed' ? '.fnri-unarmed-row' : '.fnri-attacks');
    row?.scrollIntoView({block: 'nearest'});
    row?.querySelector('button')?.focus({preventScroll: true});
  }

  static async declareSheetAction(_event, button) {
    if (!this.isEditable) return;
    const action=sheetAction(button.dataset.id);
    if(!action || this._pendingSheetActions.has(action.id))return;
    this._pendingSheetActions.add(action.id);
    try {
      if(!await this._flushWrites())return ui.notifications?.warn(localized('Hints.unsavedRoll'));
      return await declareAction({actor:this.actor,label:action.name,description:sheetActionText(action.id,'description')});
    } finally {this._pendingSheetActions.delete(action.id);}
  }

  static async openSheetAction(_event, button) {
    const action = sheetAction(button.dataset.id);
    if (!action) return;
    if (action.id === 'selfDefense') {
      return ActorBase.viewBuiltinSelfDefense.call(this, null, button);
    }
    if (action.id === 'reload') {
      const itemId = button.closest('[data-item-id]')?.dataset.itemId;
      const weapons = this.actor.items.contents.filter(item => (!itemId || item.id === itemId) && isFirearm(item));
      const item = weapons.length === 1 ? weapons[0] : await chooseSheetOption(action.name, weapons,
        sheetActionText(action.id, 'description'));
      if (item) {
        if (weapons.length === 1) await showSheetDescription(action.name,
          `<p>${escapeHtml(sheetActionText(action.id, 'description'))}</p>`);
        if (this.actor.items.get(item.id) === item) await item.sheet.render({force: true});
        return;
      }
      if (weapons.length) return;
    }
    await showSheetDescription(action.name, `<p>${escapeHtml(sheetActionText(action.id, "description"))}</p>`);
    if (action.id === 'combatMaster') {
      ActorBase.jumpToSheetAction.call(this, null, {dataset: {}});
    }
  }

  static async rollQuickStrike(event) {
    const id = 'quickStrike';
    if (!this.isEditable || this._pendingSheetActions.has(id)) return;
    this._pendingSheetActions.add(id);
    try {
      if (!await this._flushWrites()) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
      const actor = this.actor;
      const equipped = sortedItems(actor.items.contents).filter(item =>
        ['hand', 'other'].includes(itemSlot(item.id, actor.system)?.kind) && isMeleeAttack(item, actor));
      const attacks = [
        ...equipped.map(item => ({name: item.name, item})),
        ...availableUnarmedActions(actor).map(({name, key, sourceItemId}) =>
          ({name, key, item:sourceItemId ? actor.items.get(sourceItemId) : null}))
      ];
      const selected = await chooseSheetOption(sheetActionText(id, 'name'), attacks, sheetActionText(id, 'description'));
      if (!selected) return;
      const targetTokens = [...(game.user.targets ?? [])];
      const options = {skipPreroll: !!event?.shiftKey, isIntervention: true, targetTokens};
      if (targetTokens.length > 1) {
        const choice = await chooseSheetOption(localized('SheetActions.selectTarget'),
          targetTokens.map(token => ({name: token.name, token})));
        if (!choice) return;
        options.targetTokens = [choice.token];
      }
      const warnings = interventionWarnings(actor, selected.item);
      if (warnings.length) ui.notifications?.warn(warnings.join(', '));
      if (selected.key) return await sendUnarmedAttack(actor, {...options, choice: selected.key});
      const {item} = selected;
      const slot = itemSlot(item.id, actor.system);
      if (actor.items.get(item.id) !== item || !['hand', 'other'].includes(slot?.kind) || !isMeleeAttack(item, actor)) return;
      if (isPhysicalWeaponCard(item)) {
        return await sendWeaponAttack(item, actor, {...options, gripWarning: needsSecondHandWarning(actor.system, item, slot)});
      }
      return await sendOtherItemAttack(item, actor, options);
    } catch (error) {
      console.error('Fast NRI | quick strike failed', error);
      ui.notifications?.warn(localized('Hints.rollFailed'));
    } finally {
      this._pendingSheetActions.delete(id);
    }
  }

  static async rollSheetAction(event, button) {
    if (!this.isEditable) return;
    const action = standardAction(button.dataset.id);
    if (!action?.skillId || this._pendingSheetActions.has(action.id)) return;
    this._pendingSheetActions.add(action.id);
    try {
      if (!await this._flushWrites()) return ui.notifications?.warn(localized("Hints.unsavedRoll"));
      const mode = currentMessageMode();
      const targetTokens = [...(game.user.targets ?? [])].filter(token =>
        mode === 'gm' || mode === 'blind' || mode === 'self' || (token.document ?? token).hidden !== true);
      const options = {skipPreroll: !!event?.shiftKey, targetTokens};
      if (action.id === 'escape') {
        const skills = BASIC_SKILLS.filter(skill => action.skillChoices.includes(skill.id));
        const selection = await chooseSheetOption(sheetActionText(action.id, 'name'), skills);
        if (!selection) return;
        options.skillId = selection.id;
      }
      if (action.id !== 'hide' && (action.defenseStat || action.id === 'firstAid') && options.targetTokens.length > 1) {
        const choice = await chooseSheetOption(localized('SheetActions.selectTarget'),
          options.targetTokens.map(token => ({name: token.name, token})));
        if (!choice) return;
        options.targetTokens = [choice.token];
      }
      await rollStandardAction(this.actor, action.id, options);
    } catch (error) {
      console.error('Fast NRI | standard action failed', error);
      ui.notifications?.warn(localized('Hints.rollFailed'));
    } finally {
      this._pendingSheetActions.delete(action.id);
    }
  }

  static async openInterventionSource(_event, button) {
    if (!this.isEditable) return;
    const action = sheetAction(button.dataset.id);
    if (!action?.context || this._pendingSheetActions.has(action.id)) return;
    this._pendingSheetActions.add(action.id);
    try {
      if (!await this._flushWrites()) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
      const findSources = () => interventionSources(this.actor, action.id, {showAll:showAllInterventions()});
      const sources = findSources();
      const standalone=()=>standaloneIntervention(this.actor,action.id,{skipPreroll:!!_event?.shiftKey});
      if (!sources.length) return await standalone();
      const chosen = await chooseSheetOption(localized('SheetActions.chooseSource'),[
        {name:localized('SheetActions.standalone'),standalone:true},
        ...sources.map(source => ({...source, name: [source.label, source.message.alias].filter(Boolean).join(' · ')}))], '', {buttons:true});
      if (!chosen) return;
      if(chosen.standalone)return await standalone();
      const current = findSources().find(entry => entry.message.id === chosen.message.id);
      if (!current) return await standalone();
      if (current.directCheck) {
        const warnings = interventionWarnings(this.actor);
        if (warnings.length) ui.notifications?.warn(warnings.join(', '));
        await initiateCounteraction(current.message, {target: this.actor, skipPreroll: !!_event?.shiftKey});
      } else {
        const eligible = current.tokens ?? [];
        const controlled = eligible.filter(token => token.controlled);
        const token = controlled.length === 1 ? controlled[0] : eligible.length === 1 ? eligible[0] :
          await chooseSheetOption(localized('Damage.selectToken'), eligible);
        if (!eligible.length) return await standalone();
        if (!token) return;
        if ((globalThis.canvas?.tokens?.controlled ?? []).length !== 1 || !token.controlled) {
          if (!token.control({releaseOthers: true})) return await standalone();
        }
        if (!await openChatSource(current.message, {focusDefense: true})) return await standalone();
      }
    } catch (error) {
      console.error('Fast NRI | intervention source failed', error);
      ui.notifications?.warn(localized('Hints.rollFailed'));
    } finally {
      this._pendingSheetActions.delete(action.id);
    }
  }

  static async invokeFromSheet(_event, button) {
    if (!this.isEditable) return;
    const actor = this.actor;
    const actionId = button.dataset.id;
    const classInvocation = ['invocation', 'doubleInvocation'].includes(actionId) &&
      classDefinition(actor.system)?.abilityIds?.includes(DOUBLE_INVOCATION_ID);
    const action = extraAbilityActions(actor.items.contents).find(entry => entry.id === actionId)
      ?? (classInvocation ? sheetAction(actionId) : null);
    if (!action || this._pendingSheetActions.has(action.id)) return;
    this._pendingSheetActions.add(action.id);
    try {
      if (!await this._flushWrites()) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
      const description = sheetActionText(action.id, 'description');
      // Invocation declares the rule only; spells are used independently.
      const item = action.itemId ? actor.items.get(action.itemId) :
        action.id === 'doubleInvocation' && classInvocation ? await classAbilityCard(actor, DOUBLE_INVOCATION_ID) : undefined;
      return await declareAction({actor,item,label:action.name,description:item?.system?.description??description,account:false});
    } catch (error) {
      console.error('Fast NRI | invocation publication failed',error);
      ui.notifications?.warn(localized('AbilityChat.actionFailed'));
    } finally {
      this._pendingSheetActions.delete(action.id);
    }
  }

  static async openGrantedAction(_event, button) {
    if (button.dataset.id === 'coverAlly') return ActorBase.openInterventionSource.call(this, null, button);
    if (button.dataset.id === 'combatMaster') return ActorBase.openSheetAction.call(this, null, button);
    ActorBase.jumpToSheetAction.call(this, null, button);
    if (button.dataset.id === 'unarmed') {
      const picker = this.element.querySelector('.fnri-unarmed-picker');
      const itemId = button.closest('[data-item-id]')?.dataset.itemId;
      if (picker && itemId) {
        picker.open = true;
        [...picker.querySelectorAll('[data-unarmed-choice]')]
          .find(option => option.dataset.unarmedChoice === `item:${itemId}`)?.focus({preventScroll: true});
      }
    }
  }

  static async useInventoryItem(_event, button) {
    if (!this.isEditable) return;
    const id = button.closest('[data-item-id]')?.dataset.itemId;
    const item = id && this.actor.items.get(id);
    if (!item || item.type === 'ability') return;
    const lock = `item:${id}`;
    if (this._pendingSheetActions.has(lock)) return;
    this._pendingSheetActions.add(lock);
    try {
      if (item.system.mechanics?.talisman) {
        const sources = talismanSources(this.actor);
        const selected = sources.length ? await chooseSheetOption(item.name,
          [...sources,{name:localized('SheetActions.standalone'),standalone:true}], item.system.description, {buttons:true}) : {standalone:true};
        if (!selected) return;
        if (!selected.standalone && await openChatSource(selected.message)) return;
        if (!await this._flushWrites()) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
        return await declareAction({actor:this.actor,item,label:item.name,description:item.system.description??''});
      }
      if (!await this._flushWrites()) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
      if (this.actor.items.get(id) !== item) return;
      await useItem(item,{skipPreroll:!!_event?.shiftKey});

    } catch (error) {
      console.error('Fast NRI | item use failed', error);
      ui.notifications?.warn(localized('SheetActions.itemManual'));
    } finally {
      this._pendingSheetActions.delete(lock);
    }
  }

  _applySkillFilter() {
    for (const row of this.element?.querySelectorAll?.("[data-fnri-skill-entry]") ?? []) {
      row.hidden = this._skillsFilter === "assigned" && row.dataset.fnriDiceAssigned !== "true";
    }
  }

  /** Sending a description never runs or spends the ability. */
  static async publishAbility(_event, button) {
    const row = button.closest?.('[data-item-id]');
    const classId = row?.dataset.classContentId;
    const action = classId && `class-ability:${classId}`;
    if (action && (!this.isEditable || this._pendingSheetActions.has(action))) return;
    if (action) this._pendingSheetActions.add(action);
    try {
      if (classId && !await this._flushWrites()) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
      const item = classId ? await useClassAbilityCard(this.actor, classId) : this.actor.items.get(row?.dataset.itemId);
      if (item?.type !== 'ability') {
        if (classId) ui.notifications?.warn(localized('AbilityChat.actionFailed'));
        return;
      }
      await publishAbility(item);
    } catch (error) {
      console.error('Fast NRI | ability publication failed', error);
      ui.notifications?.warn(localized('AbilityChat.actionFailed'));
    } finally {
      if (action) this._pendingSheetActions.delete(action);
    }
  }

  static async rollAbility(event, button) {
    const id = button.closest?.("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!item || item.type !== "ability") return;
    const formula = itemFormula(item);
    const weapon=resolveAbilityWeapon(item,this.actor);
    if(abilityUsesWeapon(item) && !weapon)
      ui.notifications?.warn(localized('Hints.ambiguousAbilityWeapon')); // advisory; action stays available
    const physicalAttack=abilityUsesWeapon(item) && isPhysicalOtherItemAttack(item,this.actor);
    if (!formula && !physicalAttack) return;
    try {
      if (physicalAttack) await sendOtherItemAttack(item,this.actor,{skipPreroll:!!event?.shiftKey});
      else await postRoll({formula, label: item.name, actor: this.actor,
        isIntervention:explicitInterventionFromCard(item),
        kind:cardRollKind(item),sourceItem:item,weaponItem:weapon,
        targetDefense:item.system.mechanics?.attack?.targetDefense,skipPreroll:!!event?.shiftKey});
    } catch (error) {
      console.error("Fast NRI | Ability roll failed", error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }

  static async weaponAttack(event, button) {
    const id = button.closest?.("[data-item-id]")?.dataset.itemId;
    const item = this.actor.items.get(id);
    if (!isPhysicalWeaponCard(item)) return;
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized("Hints.unsavedRoll"));
    try { await sendWeaponAttack(item, this.actor, {skipPreroll:!!event?.shiftKey}); }
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
    if (this.actor.type === "character" && equipmentKind(item) === "armor") return;
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

  static async attackEquipped(event, button) {
    const id = button.closest?.('[data-item-id]')?.dataset.itemId;
    const item = this.actor.items.get(id);
    const slot = item && itemSlot(id, this.actor.system);
    if (!slot) return; // Cannot attack from a backpack or a stale UI row.
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
    try {
      const gripWarning = needsSecondHandWarning(this.actor.system, item, slot);
      if (isPhysicalWeaponCard(item)) await sendWeaponAttack(item, this.actor, {gripWarning,skipPreroll:!!event?.shiftKey});
      else if (isPhysicalOtherItemAttack(item)) await sendOtherItemAttack(item, this.actor, {skipPreroll:!!event?.shiftKey});
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

  static async attackUnarmed(event) {
    await this._writeQueue;
    if (this._failedFields.size) return ui.notifications?.warn(localized('Hints.unsavedRoll'));
    try { await sendUnarmedAttack(this.actor,{skipPreroll:!!event?.shiftKey}); }
    catch (error) {
      console.error('Fast NRI | unarmed attack failed', error);
      ui.notifications?.warn(localized('Hints.rollFailed'));
    }
  }

  static async rollSkill(event, button) {
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
        actor: this.actor,
        kind:'skill',skillId:id,skipPreroll:!!event?.shiftKey,
        formulaForActor: prepared => skillFormula(prepared?.system?.skills?.[id] ?? entry)
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

  /** System-granted ability. Display the normative text only; no Item or edit form. */
  static async viewBuiltinSelfDefense(_event, button) {
    if (button?.closest?.('[data-fnri-builtin-action]')?.dataset.fnriBuiltinAction !== BASE_SELF_DEFENSE.id) return;
    const title = localized(BASE_SELF_DEFENSE.nameKey);
    const field = (label, value) => `<div class="fnri-builtin-field"><strong>${escapeHtml(localized('Builtin.' + label))}</strong>` +
      `<span>${escapeHtml(value)}</span></div>`;
    const content = `<section class="fnri-builtin-detail">` +
      `<p class="fnri-builtin-readonly">${escapeHtml(localized('Builtin.readOnly'))}</p>` +
      field('requirement', localized(BASE_SELF_DEFENSE.actionCostKey)) +
      field('traits', localized(BASE_SELF_DEFENSE.traitsKey)) +
      field('target', localized(BASE_SELF_DEFENSE.targetKey)) +
      `<p>${escapeHtml(localized('Builtin.selfDefenseDescription'))}</p>` +
      field('melee', localized('Builtin.selfDefenseMelee')) +
      field('ranged', localized('Builtin.selfDefenseRanged')) +
      field('formula', localized(this.actor.type === 'npc' ? 'Builtin.selfDefenseNpcFormula' : 'Builtin.selfDefenseCharacterFormula')) +
      `<p>${escapeHtml(localized('Builtin.selfDefenseResolution'))}</p>` +
      `<p>${escapeHtml(localized('Builtin.selfDefenseLimits'))}</p>` +
      `</section>`;
    await DialogV2.prompt({ window: { title }, content,
      ok: { label: localized('Builtin.close') }, rejectClose: false });
  }

  static async openItem(_event, button) {
    const row = button.closest("[data-item-id]");
    const classId = row?.dataset.classContentId;
    try {
      const item = classId ? await classAbilityCard(this.actor, classId) : this.actor.items.get(row?.dataset.itemId);
      if (item) await item.sheet.render({ force: true });
      else if (classId) ui.notifications?.warn(localized('AbilityChat.actionFailed'));
    } catch (error) {
      console.warn('Fast NRI | opening Item sheet failed', error);
      ui.notifications?.warn(localized('AbilityChat.actionFailed'));
    }
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
    const id = button.closest("[data-item-id]")?.dataset.itemId;
    if (this.actor.type === "character" && racialPropertyRule(this.actor.items.get(id))) return;
    await this._deleteOwnedItem(id);
  }

  async _deleteOwnedItem(id, {confirm = true, ...options} = {}) {
    if (!this.isEditable) return false;
    const item = this.actor.items.get(id);
    if (!item) return false;
    if (confirm && !await DialogV2.confirm({
      window: { title: localized("Actions.deleteItem") },
      content: `<p>${localized("Hints.confirmDelete")}</p>`,
      rejectClose: false
    })) return false;
    return this._queueWrite(async () => {
      if (this.actor.items.get(id) !== item) return false;
      await this.actor.deleteEmbeddedDocuments("Item", [id], options);
      if (this.actor.items.has(id)) return false;
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
      return true;
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
  /** The single approved Rest button in the bottom-right of Characteristics.
   * Drain already queued sheet edits, then serialize Rest with later edits.
   * This calls the same non-visual API as scripts and macros.
   */
  static async restActor(_event, button) {
    if (!this.isEditable || this._restPending) return;
    this._restPending = true;
    button.disabled = true;
    try {
      await this._writeQueue;
      if (this._failedFields.size || this._lastWriteError) {
        ui.notifications?.warn(localized('Hints.saveFailed'));
        return;
      }
      let completed;
      try {
        completed = await this._queueWrite(() => restActor(this.actor), null, error => {
          const detail = String(error?.message ?? "").trim();
          ui.notifications?.error(`${localized("Hints.restFailed")}${detail ? `: ${detail}` : ""}`);
        });
      } catch {
        // _queueWrite has already logged and displayed the actual Rest error.
        return;
      }
      if (!completed) {
        ui.notifications?.error(localized("Hints.restUnavailable"));
        return;
      }
      // Chat reports the completed action only; failed Actor updates must not
      // create a success message. Chat publication is a separate operation.
      try {
        const audience = actionAudience();
        const message = await ChatMessage.create({
          speaker: actionSpeaker(this.actor, audience), ...audience,
          content: restChatContent(this.actor, completed)
        });
        if (!message) throw new Error("ChatMessage.create returned no message");
      } catch (error) {
        console.error("Fast NRI | Rest completed, but chat message failed", error);
        ui.notifications?.error(localized("Hints.restChatFailed"));
      }
    } finally {
      this._restPending = false;
      if (button.isConnected) button.disabled = false;
    }
  }

  static async addResource() {
    await this._addRow("resources", { name: "", current: null, max: null });
  }
  /** Quick +/- edits use the same Actor queue as automatic resource changes.
   * Read the latest persisted value inside the queue, never the rendered input. */
  static async adjustResource(_event, button) {
    if (!this.isEditable) return;
    const { resource, id, delta: rawDelta } = button.dataset;
    if (rawDelta !== "1" && rawDelta !== "-1") return;
    if (resource !== "potions" && (resource !== "row" || !VALID_ROW_ID.test(id ?? ""))) return;
    const delta = Number(rawDelta);
    const field = resource === "potions" ? "system.potionsUsed" : `system.resources.${id}.current`;
    await this._queueWrite(() => queueActorWrite(this.actor, async () => {
      if (!this.isEditable) return;
      const source = this.actor.toObject?.(true)?.system ?? this.actor.system;
      const row = source.resources?.[id];
      if (resource === "row" && !row) return;
      const before = resource === "potions" ? source.potionsUsed : row.current;
      const current = Number.isFinite(before) ? before : 0;
      // Ordinary resource values retain their existing unrestricted edit range.
      const after = resource === "potions" ? Math.max(0, current + delta) : current + delta;
      if (after === current) return;
      await this.actor.update({ [field]: after });
    }), field).catch(() => {});
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
      const source = this.actor.toObject?.(true)?.system?.[collection] ?? {};
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
      const raw=this.actor.toObject?.(true)?.system??this.actor.system;
      const items=this.actor.items?.contents??[];
      if(this.actor.type==='character'&&collection==='skills'&&field==='dice'&&BASIC_SKILLS_BY_ROW_ID.has(id)&&resolveSkillAllocation(raw,items).active){
        const patch=skillDieEditPatch(raw,items,BASIC_SKILLS_BY_ROW_ID.get(id).id,parsed.value);
        if(Object.keys(patch).length)return this.actor.update(patch);
        return;
      }
      if (!Object.hasOwn(this.actor.system[collection] ?? {}, id)) {
        const source = this.actor.toObject?.(true)?.system?.[collection] ?? {};
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
    if (!this._projectionSized && isProjectionActor(this.actor)) {
      this._projectionSized = true;
      this.setPosition({width: 470, height: 530});
    }
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
      if (input.hasAttribute?.("data-fnri-hp-math")) {
        input.addEventListener("keydown", event => {
          if (event.key === "Enter") { event.preventDefault(); input.blur(); }
        });
      }
      input.addEventListener("change", event => {
        event.stopPropagation();
        if (!this.isEditable) return;
        const control = event.currentTarget;
        const field = control.name;
        if (field !== "name" && !field.startsWith("system.")) return;
        if (control.hasAttribute?.("data-fnri-hp-math") &&
            (field === "system.hp.current" || field === "system.hp.temp")) {
          const typed = control.value;
          const parsed = hpMathFromInput(typed);
          if (!parsed.valid) return this._invalidNumber(control);
          control.setCustomValidity?.("");
          void this._queueWrite(() => queueActorWrite(this.actor, async () => {
            if (!this.isEditable) return;
            const key = field === "system.hp.current" ? "current" : "temp";
            const source = this.actor.toObject?.(true)?.system ?? this.actor.system;
            const before = source.hp?.[key] ?? 0;
            const value = parsed.relative ? before + parsed.value : parsed.value;
            if (value !== null && !Number.isSafeInteger(value)) throw new Error("HP arithmetic outside safe integer range");
            await this.actor.update({[field]:value});
            if (control.value === typed) control.value = value === null ? "" : String(value);
          }), field).catch(() => {});
          return;
        }
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
    await foundry.applications.handlebars.loadTemplates(ACTOR_PARTIALS);
    const context = await super._prepareContext(options);
    const actor = this.actor;
    // AE-adjusted values are used by rolls, NEVER as edit-form defaults.
    // toObject(true) is the original persisted source, not prepared data.
    const base = actor.toObject?.(true)?.system ?? actor.system;
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
      const gripWarning = needsSecondHandWarning(actor.system, item, activeSlot);
      const attack = item?.type === 'weapon' ? item.system : item?.system?.mechanics?.attack;
      const damageSummary = allowed ? compactPhysicalProfile(attack?.damageProfile) : '';
      const details = allowed ? attackCardDetails({
        distance: attack?.distance || item.system?.distance,
        properties: item?.type === 'weapon' ? effectiveWeaponProperties(item.system) : attack?.properties,
        reach: item?.type === 'weapon' ? item.system?.reach : null,
        range: item?.type === 'weapon' ? item.system?.range : null,
        rangeLabel: localized('Fields.range'), reachLabel: localized('Fields.reach')
      }) : '';
      return { id: item?.id ?? '', name: item?.name ?? '', label, occupied,
        damageSummary, details, canAttack: !!allowed, gripWarning: !!gripWarning };
    };
    const bothHands = !!equipment.leftHand && equipment.leftHand === equipment.rightHand;
    const hands = bothHands ? [attackRow(equipment.leftHand,localized('Equipment.bothHands'))] : [
      attackRow(equipment.leftHand,localized('Equipment.hand1')),
      attackRow(equipment.rightHand,localized('Equipment.hand2'))
    ];
    const unarmed = resolveUnarmedAction(actor);
    unarmed.damageSummary=compactPhysicalProfile(unarmed.damageProfile);
    unarmed.details=attackCardDetails({properties:unarmed.properties});
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
      projectionSheet: isProjectionActor(actor) && !this._showProjectionFull,
      projectionFullAvailable: isProjectionActor(actor),
      projectionOwner: projectionCaster(actor) ? {name: projectionCaster(actor).name} : null,
      projectionAc: (() => {
        const ac = projectionCaster(actor)?.system?.ac ?? actor.system?.ac;
        return ['partial','success','great'].map(k => showStat(ac?.[k])).join(' / ');
      })(),
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
      potions: potionResource(actor),
      preparedResourceRows: rowsOf(actor.system.resources),
      activeTab: tab,
      tabs: {
        characteristics: tab === "characteristics", actions: tab === "actions", skills: tab === "skills",
        abilities: tab === "abilities", inventory: tab === "inventory",
        description: tab === "description", journal: tab === "journal"
      },
      items: items.map(item => rowWithSelection(item, actor.system)),
      builtinSelfDefense: { id: BASE_SELF_DEFENSE.id, name: localized(BASE_SELF_DEFENSE.nameKey) },
      abilityItems: items.filter(i => i.type === "ability").map(item => {
        const contentId = item.getFlag(SYSTEM_ID, 'contentId');
        const mechanics = item.system.mechanics ?? {};
        const grantedAction = unarmed.choices.some(choice => choice.key === `item:${item.id}`) ? 'unarmed' :
          mechanics.attackAugment ? 'attacks' :
          mechanics.grantsAction === 'coverAlly' || contentId === 'fnri7.rulebook.racial.samootverzhennyi' ? 'coverAlly' :
          contentId === 'fnri7.rulebook.racial.master-boia' ? 'combatMaster' : null;
        return {...rowWithSelection(item, actor.system), grantedAction,
          doubleInvocation: mechanics.doubleInvocation === true || contentId === DOUBLE_INVOCATION_ID};
      }),
      inventoryItems: items.filter(i => i.type !== "ability").map(item => {
        return {...rowWithSelection(item, actor.system),
          canReload: isFirearm(item), canUse: true};
      }),
      actionSections: actionSections(items),
      invocation: extraAbilityActions(items).find(action => action.id === 'invocation'),
      shortRestActions: shortRestActions(actor),
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
          return {...preparedSkillRow({ ...current, name: skill.name, id,
            description: skill.description, standard: true }, actor, this._customDiceEditors),
            namedActions: skillActionRows(skill.id), actionsExpanded: this._expandedSkillActions.has(id)};
        })
      })),
      skillRows: rowsOf(completeSkills).filter(row => !BASIC_SKILLS_BY_ROW_ID.has(row.id))
        .map(row => preparedSkillRow(row, actor, this._customDiceEditors)),
      resourceRows: rowsOf(base.resources),
      journalRows: actorJournalRows(actor)
    };
  }
}

export class FastNRICharacterSheet extends ActorBase {
  static PARTS = { main: { root: true, template: "systems/fast-nri-v14/templates/character.hbs" } };
  static DEFAULT_OPTIONS = {
    actions: {
      toggleCharacterEditor: FastNRICharacterSheet.toggleCharacterEditor,
      openSkillEditor: FastNRICharacterSheet.openSkillEditor,
      editRacialProperties: FastNRICharacterSheet.editRacialProperties,
      chooseIdentity: FastNRICharacterSheet.chooseIdentity,
      chooseTradition: FastNRICharacterSheet.chooseTradition,
      resetSkillDice: FastNRICharacterSheet.resetSkillDice,
      changeRacialSubproperty: FastNRICharacterSheet.changeRacialSubproperty
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const raw=this.actor.toObject?.(true)?.system??this.actor.system;
    const allocation=resolveSkillAllocation(raw,this.actor.items?.contents??[]);
    const skillName=id=>BASIC_SKILLS.find(s=>s.id===id)?.name??id;
    const rule=classDefinition(this.actor.system);
    const base=foundry.utils?.deepClone ? foundry.utils.deepClone(raw) : JSON.parse(JSON.stringify(raw));
    prepareClassBaseStats(base);
    const characterEditing=!!this._characterEditing&&this.isEditable;
    const race = racialState(this.actor);
    const racialProperties = racialPropertyRows(this.actor, race);
    const additionalRacialProperties = racialProperties.filter(row => !row.innate);
    const raceWarning = racialChoiceWarning(race);
    const missingAbilities = await missingClassAbilityRows(this.actor);
    const ownedClassAbilities = new Set(rule?.abilityIds);
    const abilityItems = context.abilityItems.map(row => ({
      ...row, isRacialProperty: Boolean(racialPropertyRule(row.item)),
      classAbility: ownedClassAbilities.has(row.item.getFlag(SYSTEM_ID, 'contentId'))
    }));
    const playSkill=row=>{const dice=this.actor.system.skills?.[row.id]?.dice??row.dice;return {...row,dice,hasDice:!!String(dice??'').trim()};};
    return {...context, system:characterEditing?base:this.actor.system,
      characterEditing, pcSkillView:true, rawHp:raw.hp, basePotionMax:raw.potionsBaseMax??3,
      effectiveDiffs:{speed:base.speed!==this.actor.system.speed, ...Object.fromEntries(["hp","ac","defenses"].map(group=>[group,Object.fromEntries(Object.keys(base[group]??{}).map(key=>[key,base[group][key]!==this.actor.system[group]?.[key]]))]))},
      resourceRows:rowsOf(characterEditing?raw.resources:this.actor.system.resources),
      catalogGroups:context.catalogGroups.map(g=>({...g,rows:g.rows.map(playSkill)})), skillRows:context.skillRows.map(playSkill),
      innateRacialProperties: racialProperties.filter(row => row.innate),
      additionalRacialProperties,
      showAdditionalRacialProperties: race.races.length > 0 || additionalRacialProperties.length > 0,
      racialChoiceWarning: raceWarning ? `FASTNRI.RacialProperties.${raceWarning}` : null,
      skillAllocation:allocation.active?{
        free: [4,6,8,10,12].map(size=>({size,count:allocation.free.filter(d=>d.face===size).length})).filter(d=>d.count),
        warnings:allocation.warnings.map(w=>({text:[localized('SkillAllocation.'+w.code),w.skill?skillName(w.skill):'',w.expected!==undefined?`(${w.expected||'—'} → ${w.actual||'—'})`:''].filter(Boolean).join(' ')})),
        upgrades:allocation.upgrades.map(u=>({...u,selected:u.target?(allocation.dice.find(d=>d.id===u.target)?.skill?skillName(allocation.dice.find(d=>d.id===u.target).skill):localized('SkillAllocation.freeDie')):''}))
      }:null,
      hasTradition:!!rule?.traditions,
      traditionName:skillName(this.actor.system.classTradition)||'', 
      standardArmor:classDefinition(this.actor.system)?.armorName??"",
      inventoryItems:context.inventoryItems.map(row=>({...row,canEquip:row.canEquip&&equipmentKind(row.item)!=="armor"})),
      invocation: context.invocation ?? (rule?.abilityIds?.includes(DOUBLE_INVOCATION_ID) ? sheetAction('invocation') : null),
      abilityItems: [...abilityItems.filter(row => row.classAbility), ...missingAbilities,
        ...abilityItems.filter(row => !row.classAbility)]};
  }

  static async toggleCharacterEditor() {
    if(!this.isEditable||!await this._flushWrites())return;
    this._characterEditing=!this._characterEditing;
    if(this._characterEditing){this._selectedTab='characteristics';this._sectionState.set('identity',true);}
    await this.render({force:true});
  }
  static async openSkillEditor() {
    if(!this.isEditable||this._skillEditorOpen||!await this._flushWrites())return;
    this._skillEditorOpen=true;
    try {await openSkillEditor(this,{
      chooseTradition:()=>FastNRICharacterSheet.chooseTradition.call(this),
      upgrade:(id,die)=>this._applySkillUpgrade(id,die),
      assign:(id,choice)=>this._editSkillPool(id,choice),
      manual:(id,value)=>this._setSkillFormulaOverride(id,value),
      reset:()=>FastNRICharacterSheet.resetSkillDice.call(this),
      add:kind=>this._addRow('skills',{name:'',kind,dice:'',modifier:null,value:null}),
      remove:id=>this._removeRow('skills',id),
      save:control=>this._saveRowControl(control)
    });} finally {this._skillEditorOpen=false;}
  }

  static async chooseIdentity(_event,button) {
    if (!this.isEditable || !await this._flushWrites()) return;
    const field=button.dataset.identity;
    const choices={race:racialRaceNames,className:classNames,role:roleNames};
    if (!Object.hasOwn(choices,field)) return;
    const selection=await chooseCharacterOption({title:localized("Fields."+field),names:choices[field](),current:this.actor.system[field],
      searchLabel:localized("RacialProperties.search"),clearLabel:localized("CharacterChoice.clear"),cancelLabel:localized("RacialProperties.cancel")});
    if (selection===null) return;
    await this._queueWrite(()=>this.actor.update(field==="className"
      ? classSelectionUpdate(this.actor,selection,{hpBonus:permanentRacialStats(this.actor).hpMax})
      : {[`system.${field}`]:selection}),`system.${field}`);
  }

  static async chooseTradition() {
    if(!this.isEditable||!await this._flushWrites())return;
    const rule=classDefinition(this.actor.system);
    if(!rule?.traditions)return;
    const choices=BASIC_SKILLS.filter(s=>rule.traditions.includes(s.id));
    const selection=await chooseCharacterOption({title:localized('SkillAllocation.traditionLabel'),names:choices.map(s=>s.name),current:choices.find(s=>s.id===this.actor.system.classTradition)?.name,
      searchLabel:localized('RacialProperties.search'),clearLabel:localized('CharacterChoice.clear'),cancelLabel:localized('RacialProperties.cancel')});
    if(selection===null)return;
    await this._queueWrite(()=>this.actor.update({'system.classTradition':choices.find(s=>s.name===selection)?.id??''}),'system.classTradition');
  }
  static async resetSkillDice() {
    if(!this.isEditable||!await this._flushWrites())return;
    await this._queueWrite(()=>{
      const raw=this.actor.toObject?.(true)?.system??this.actor.system;
      const patch=resetSkillAssignmentsPatch(raw);
      if(Object.keys(patch).length)return this.actor.update(patch);
    });
  }
  async _editSkillPool(skill, choice) {
    return this._queueWrite(() => {
      const raw = this.actor.toObject?.(true)?.system ?? this.actor.system;
      const patch = skillPoolEditPatch(raw, this.actor.items?.contents ?? [], skill, choice);
      if (!patch) return ui.notifications?.warn(localized('SkillAllocation.poolChanged'));
      if (Object.keys(patch).length) return this.actor.update(patch);
    });
  }

  async _setSkillFormulaOverride(skill, value) {
    return this._queueWrite(() => {
      const raw = this.actor.toObject?.(true)?.system ?? this.actor.system;
      const patch = skillFormulaOverridePatch(raw, skill, value);
      if (Object.keys(patch).length) return this.actor.update(patch);
    });
  }

  async _applySkillUpgrade(upgradeId, dieId) {
    return this._queueWrite(() => {
      const live = this.actor.toObject?.(true)?.system ?? this.actor.system;
      const allocation = resolveSkillAllocation(live, this.actor.items?.contents ?? []);
      const upgrade = allocation.upgrades.find(entry => entry.id === upgradeId);
      if (!upgrade || dieId && !skillUpgradeCandidates(allocation, upgrade).some(die => die.id === dieId)) return;
      const patch = skillAllocationPatch(live, planSkillUpgrade(live, upgradeId, dieId));
      if (Object.keys(patch).length) return this.actor.update(patch);
    });
  }
  static async editRacialProperties() {
    if (!this.isEditable) return;
    if (!racialState(this.actor).races.length && !this.actor.items.contents.some(racialPropertyRule)) return;
    try {
      await openRacialPropertyEditor(this.actor, {add: async card => {
        if (!this.isEditable) return;
        const selection = await chooseRacialSubproperty(card);
        const added = await this._queueWrite(() => addRacialProperty(this.actor, card, selection));
        if (added && selection && changesAncestry(added)) await syncInnateProperties(this.actor);
      }, remove: async id => {
        const item = this.actor.items.get(id);
        if (!racialPropertyRule(item)) return;
        const sync = changesAncestry(item);
        const deleted = await this._deleteOwnedItem(id, {confirm: false, fnriAncestrySync: sync});
        if (deleted && sync) await syncInnateProperties(this.actor, false);
      }});
    } catch (error) {
      console.warn("Fast NRI | racial property picker failed", error);
      ui.notifications?.warn(localized("RacialProperties.unavailable"));
    }
  }

  static async changeRacialSubproperty(_event, button) {
    if (!this.isEditable) return;
    const item = this.actor.items.get(button.dataset.itemId);
    if (!item) return;
    try { await editRacialSubproperty(item); }
    catch (error) {
      console.warn("Fast NRI | racial property choice failed", error);
      ui.notifications?.warn(racialLabel("unavailable"));
    }
  }
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
      openProjectionActor: FastNRIItemSheet.openProjectionActor,
      unlinkProjection: FastNRIItemSheet.unlinkProjection,
      weaponAttack: FastNRIItemSheet.weaponAttack,
      createItemEffect: FastNRIItemSheet.createItemEffect,
      editItemEffect: FastNRIItemSheet.editItemEffect,
      toggleItemEffect: FastNRIItemSheet.toggleItemEffect,
      deleteItemEffect: FastNRIItemSheet.deleteItemEffect
    }
  };
  async _onRender(context, options) {
    await super._onRender(context, options);
    const drop = this.element?.querySelector?.('[data-fnri-projection-drop]');
    if (drop) {
      drop.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'link'; });
      drop.addEventListener('drop', event => { void this._onDrop(event); });
    }
  }

  /** Drops are scoped to the single Projection field. Other drops retain the
   * standard ItemSheetV2 workflow; there is no independent link manager.
   */
  async _onDrop(event) {
    if (!event.target?.closest?.('[data-fnri-projection-drop]'))
      return super._onDrop(event);
    event.preventDefault();
    event.stopPropagation();
    if (!this.isEditable) return ui.notifications?.warn(localized('Projection.permission'));
    try {
      const editor = foundry.applications.ux.TextEditor.implementation;
      let data = editor?.getDragEventData?.(event) ?? {};
      if (!data.uuid && !data.id) {
        try { data = JSON.parse(event.dataTransfer?.getData('text/plain') || '{}'); }
        catch { data = {}; }
      }
      const document = data.uuid ? await fromUuid(data.uuid) :
        data.type === 'Actor' ? game.actors?.get(data.id) : null;
      const actor = worldProjectionActor(document);
      if (!actor) return ui.notifications?.warn(localized('Projection.actorOnly'));
      const previous = projectionLink(actor);
      const previousItem = previous?.abilityUuid ? await fromUuid(previous.abilityUuid) : null;
      const bindingItem = worldProjectionAbility(this.item);
      if (!bindingItem) throw Error(localized('Projection.linkFailed'));
      if (previous && !(previous.version === 2 && previous.casterUuid === bindingItem.parent.uuid &&
        previous.abilityUuid === bindingItem.uuid)) {
        const owner = game.actors?.contents?.find(a => a.uuid === previous.casterUuid);
        const oldCard = previous.abilityUuid ? await fromUuid(previous.abilityUuid) : null;
        const detail = [owner?.name ?? previous.casterUuid, oldCard?.name].filter(Boolean).map(escapeHtml).join(' · ');
        const ok = await DialogV2.confirm({
          window: {title: localized('Projection.transferTitle')},
          content: `<p>${localized('Projection.existingOwner')}: <strong>${detail}</strong>.</p>`+
            `<p>${localized('Projection.transferQuestion')}</p>`,
          rejectClose: false
        });
        if (!ok) return;
        const current = projectionLink(actor);
        if (JSON.stringify(current) !== JSON.stringify(previous))
          throw Error(localized('Projection.changedDuringDialog'));
      }
      await linkProjectionActor(this.item, actor);
      await this.render({force: true});
      if (previousItem?.uuid !== bindingItem.uuid && previousItem?.sheet?.rendered)
        await previousItem.sheet.render({force: true});
      ui.notifications?.info(localized('Projection.linked'));
    } catch (error) {
      console.error('Fast NRI | Projection link failed', error);
      ui.notifications?.error(error?.message || localized('Projection.linkFailed'));
    }
  }

  static async openProjectionActor(_event, button) {
    const actor = game.actors?.get(button.dataset.actorId);
    if (actor) await actor.sheet?.render({force: true});
  }

  static async unlinkProjection(_event, button) {
    if (!this.isEditable) return;
    const actor = game.actors?.get(button.dataset.actorId);
    if (!actor) return;
    try {
      await unlinkProjectionActor(this.item, actor);
      await this.render({force: true});
    } catch (error) {
      console.error('Fast NRI | Projection unlink failed', error);
      ui.notifications?.warn(error?.message || localized('Projection.linkFailed'));
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
    if (effect) await openEffectParametersEditor(this.item.parent?.documentName === 'Actor'
      ? this.item.parent : null, effect);
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
  static async weaponAttack(event, _button) {
    if (!isPhysicalWeaponCard(this.item)) return;
    // Same shortcut as the Actor sheet: Shift rolls immediately with all
    // eligible influences. The embedded Item supplies its parent Actor;
    // a standalone world Item deliberately rolls without an Actor.
    const actor = this.item.parent?.documentName === 'Actor' ? this.item.parent : null;
    try { await sendWeaponAttack(this.item, actor, {skipPreroll:!!event?.shiftKey}); }
    catch (error) {
      console.error("Fast NRI | weapon attack failed",error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }

  static async rollItem(event, _button) {
    // A roll from an Item sheet belongs to that card; no fixed game rules
    // are applied or silently derived from class, weapon or user settings.
    const item = this.item;
    const formula = this.element?.querySelector?.('[name="system.rollFormula"]')?.value?.trim() ?? itemFormula(item);
    const actor=item.parent?.documentName==='Actor'?item.parent:null;
    const physicalAttack=abilityUsesWeapon(item) && isPhysicalOtherItemAttack(item,actor);
    if (abilityUsesWeapon(item) && !resolveAbilityWeapon(item,actor))
      ui.notifications?.warn(localized('Hints.ambiguousAbilityWeapon'));
    if (!formula && !physicalAttack) return ui.notifications?.warn(localized("Hints.emptyRollFormula"));
    try {
      // Same existing roll button: abilities with a declared physical weapon
      // use the shared attack pipeline, other abilities the shared check.
      if (physicalAttack) await sendOtherItemAttack(item,actor,{skipPreroll:!!event?.shiftKey});
      else await postRoll({ formula, label: item.name, isIntervention:explicitInterventionFromCard(item),
        actor,kind:cardRollKind(item),sourceItem:item,weaponItem:resolveAbilityWeapon(item,actor),
        targetDefense:item.system.mechanics?.attack?.targetDefense,
        skipPreroll:!!event?.shiftKey });
    } catch (error) {
      console.error("Fast NRI | item roll failed", error);
      ui.notifications?.warn(localized("Hints.rollFailed"));
    }
  }
  static PARTS = { main: { root: true, template: "systems/fast-nri-v14/templates/item.hbs" } };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.toObject?.(true)?.system ?? this.item.system;
    const checkDescription = hasCheckLinks(system.description)
      ? await foundry.applications.ux.TextEditor.enrichHTML(escapeHtml(system.description), {
        relativeTo: this.item, custom: true, secrets: false, rolls: false
      }) : null;
    return {
      ...context,
      item: this.item,
      system, checkDescription,
      effectiveSystem: this.item.system, editable: this.isEditable,
      isWeapon: this.item.type === "weapon", isArmor: this.item.type === "armor",
      isGear: this.item.type === "gear", isAbility: this.item.type === "ability",
      isProjectionAbility: this.item.type === 'ability' &&
        Array.isArray(this.item.system?.mechanics?.executions) &&
        this.item.system.mechanics.executions.some(row => row.type === 'projection') &&
        this.item.parent?.documentName === 'Actor',
      projectionActors: projectionActorsForAbility(this.item).map(actor => ({id: actor.id, name: actor.name, img: actor.img})),
      isLegacy: this.item.type === "item",
      gearHand: this.item.system?.mechanics?.equipment?.slot === 'hand',
      gearArmor: this.item.system?.mechanics?.equipment?.slot === 'armor',
      gearOther: this.item.system?.mechanics?.equipment?.slot === 'other',
      gearPhysicalAttack: this.item.system?.mechanics?.attack?.kind === 'physical',
      abilityReplaceUnarmed: this.item.system?.mechanics?.unarmedAttack?.mode === 'replace',
      abilityOptionUnarmed: this.item.system?.mechanics?.unarmedAttack?.mode === 'option',
      deprecated: this.item.getFlag("fast-nri-v14", "status") === "deprecated",
      hasRollFormula: !!itemFormula(this.item) ||
        (abilityUsesWeapon(this.item) && isPhysicalOtherItemAttack(this.item,this.item.parent)),
      canWeaponAttack: isPhysicalWeaponCard(this.item),
      weaponAutoProficiency: !this.item.system.proficiencyMode || this.item.system.proficiencyMode === 'auto',
      weaponYesProficiency: this.item.system.proficiencyMode === 'yes',
      weaponNoProficiency: this.item.system.proficiencyMode === 'no',
      weaponRuleRows: Object.entries(this.item.system?.mechanics?.propertyRules ?? {}).map(([name,description])=>({name,description})),
      computedReach: this.item.type==='weapon' && hasComputedReach(this.item.system),
      weaponMelee:normalizeAttackKind(this.item.system.attackKind)==='melee',
      weaponRanged:normalizeAttackKind(this.item.system.attackKind)==='ranged',
      weaponFocus:normalizeAttackKind(this.item.system.attackKind)==='focus',
      weaponUnknownKind:!String(this.item.system.attackKind??'').trim(),
      weaponLegacyKind:!normalizeAttackKind(this.item.system.attackKind)?String(this.item.system.attackKind??'').trim():null,
      itemIsIntervention:explicitInterventionFromCard(this.item),
      targetDefenseOptions:makeOptions(['ac','fortitude','reflex','will'],this.item.system.mechanics?.attack?.targetDefense || 'ac'),
      attackDefenseModes:makeOptions(['','set','choose'],this.item.system.mechanics?.attack?.selfDefense?.mode ?? ''),
      attackDefenseStats:makeOptions(['','fortitude','reflex','will'],this.item.system.mechanics?.attack?.selfDefense?.stat ?? ''),
      attackDefenseChoices:fmtOptions(this.item.system.mechanics?.attack?.selfDefense?.options),
      abilityDefenseActivations:makeOptions(['','passive','intervention'],this.item.system.mechanics?.selfDefense?.activation ?? ''),
      abilityDefenseModes:makeOptions(['','set','choose'],this.item.system.mechanics?.selfDefense?.mode ?? ''),
      abilityDefenseStats:makeOptions(['','fortitude','reflex','will'],this.item.system.mechanics?.selfDefense?.stat ?? ''),
      abilityDefenseChoices:fmtOptions(this.item.system.mechanics?.selfDefense?.options),
      abilityAgainstKinds:makeOptions(['any','melee','ranged'],this.item.system.mechanics?.selfDefense?.againstKind ?? 'any'),
      itemEffects: [...(this.item.effects?.contents ?? [])].map(effect => ({
        id: effect.id, name: effect.name, disabled: effect.disabled, transfer: effect.transfer
      }))
    };
  }
}
