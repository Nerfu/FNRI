import {registerCreatureSizes,setCreatureSize} from "./module/data/creature-size.mjs";
import {registerGameArchive,importGameArchive} from "./module/data/game-archive.mjs";
import {registerWorldRoles} from "./module/data/roles.mjs";
import {conditionHudClass} from './module/effects/condition-hud.mjs';
import {registerConditionStatuses} from './module/effects/condition-statuses.mjs';
import {registerHpLimit} from "./module/damage/hp-limit.mjs";
import {registerInitialSheetLock} from './module/sheets/sheet-lock.mjs';
import {registerActorSides} from './module/data/actor-side.mjs';
import {registerGameReroll} from './module/rolls/game-reroll.mjs';
import {registerAbilityChat,publishAbility,abilityExecutions,abilityExecution,executeAbilityFromChat} from './module/abilities/ability-chat.mjs';
import {registerTempHpManualEdits,registerTempHpWorldTime,readTempHpState,grantTempHp,removeTempHpLayer,tempHpMax,planTempHpExpiration} from './module/damage/temporary-hp-layers.mjs';
import {FastNRICombat} from './module/combat/fnri-combat.mjs';
import {FastNRICombatant} from './module/combat/initiative.mjs';
import {FastNRITokenRuler} from './module/spatial/token-ruler.mjs';
import {applyCardDamageWithResponse} from './module/damage/hp-actions.mjs';
import {coverAllyDice, planCoverAlly} from './module/damage/damage-core.mjs';
import {planResponsiveDamage} from './module/damage/responsive-healing.mjs';
import {retryPeriodicOutbox} from './module/damage/periodic-turn.mjs';
import {registerDeathLifecycle,reconcileDeathEffects,planDeathTransition,deathStateOf} from './module/damage/death-lifecycle.mjs';
import {initiateCounteraction} from './module/damage/counteraction.mjs';
import {createPeriodicDamageEffect,preparePeriodicDamage} from './module/effects/periodic-effect.mjs';
import {readPeriodicData,orderedPeriodicEffects,declaredPeriodicDefenses,inspectDamageDefenseSources,previewDeclaredDamageDefenses,calculatePeriodicTick,planPeriodicHp,periodicEndPlan} from './module/damage/periodic-damage.mjs';
import {abilityAccountingStatus,retryCardAccounting,restActor,createCardActionId} from './module/data/ability-accounting.mjs';
import {findProjectionActor,findProjectionActors,projectionActorsForAbility,linkProjectionActor,unlinkProjectionActor,resolveSpellOrigin,isProjectionToken,projectionCaster,projectionSpatialPreview} from './module/projection/projection.mjs';
import {useItem,inspectItemUse} from './module/equipment/item-use.mjs';
import {attackOutcomePreview,attackOutcomeForDamageCard} from './module/equipment/attack-outcomes.mjs';
import {prepareAttackOutcomeDecision,applyAttackOutcomeEffects,undoAttackOutcomeEffects,prepareDamageCardOutcomes} from './module/equipment/attack-outcome-application.mjs';
import {sendWeaponDamage} from './module/weapon/weapon-attack.mjs';
import {itemCapabilities,equipmentDefensePreview,equipmentSkillBonusPreview,spellFocusPreview} from './module/equipment/item-properties.mjs';
import {standardAction,rollStandardAction,STANDARD_ACTIONS} from './module/rolls/standard-actions.mjs';
import {registerCheckLinks} from './module/rolls/check-links.mjs';
import {registerActorJournal} from './module/data/actor-journal.mjs';
import {registerPrivateAreaSourceCleanup} from './module/data/private-area-source.mjs';
import {registerAreaFollowUpButtons} from './module/damage/area-attack.mjs';
import {registerChatEffectDrag} from './module/effects/chat-effect-links.mjs';
import {registerEffectsPanel} from './module/effects/effects-panel.mjs';
import {registerFreeHp} from './module/damage/free-hp.mjs';
import {registerRollEditor} from './module/damage/roll-editor.mjs';
import {registerDamageComponentChoice} from './module/damage/damage-component-choice.mjs';
import {registerDamageChatControls} from './module/damage/damage-chat.mjs';
import {registerDamageRecovery,ensureDamageRecovery} from './module/abilities/damage-recovery.mjs';
import {registerWeaponChatControls} from "./module/weapon/weapon-attack.mjs";
import {registerClassLifecycle} from './module/data/class-lifecycle.mjs';
import {registerSkillAllocationSettings} from "./module/data/skill-allocation.mjs";
import {registerRacialSettings} from "./module/data/racial-properties.mjs";
import {registerRacialPropertyLifecycle,racialItemDocumentClass} from "./module/sheets/racial-property-lifecycle.mjs";
/**
 * Fast NRI 7.0 — Foundry VTT v14 system initialization.
 * The subtype data models and sheets are registered during the init hook.
 * Roll and damage cards provide explicit, auditable interactions.
 * No migration or automatic world edits are performed during startup.
 */
import {
  CharacterModel, NPCModel, WeaponModel, ArmorModel,
  GearModel, AbilityModel, LegacyItemModel
} from "./module/data/models.mjs";
import {
  FastNRICharacterSheet, FastNRINPCSheet, FastNRIItemSheet
} from "./module/sheets/sheets.mjs";

const SYSTEM_ID = "fast-nri-v14";

Hooks.once("init", () => {
  registerGameArchive();
  registerWorldRoles();
  registerConditionStatuses();
  CONFIG.Token.hudClass = conditionHudClass(CONFIG.Token.hudClass ?? foundry.applications.hud.TokenHUD);
  registerCheckLinks();
  registerRacialSettings();
  registerSkillAllocationSettings();
  registerRacialPropertyLifecycle();
  CONFIG.Item.documentClass = racialItemDocumentClass(CONFIG.Item.documentClass ?? foundry.documents.Item);
  registerClassLifecycle();
  registerActorSides();
  registerCreatureSizes();
  registerInitialSheetLock();
  // Foundry native _onEndTurn executes only on designated GM.
  CONFIG.Combat.documentClass = FastNRICombat;
  CONFIG.Combatant.documentClass = FastNRICombatant;
  CONFIG.Combat.initiative.formula = "1d20";
  CONFIG.Token.rulerClass = FastNRITokenRuler;
  Object.assign(CONFIG.Actor.dataModels ??= {}, {
    character: CharacterModel,
    npc: NPCModel
  });
  Object.assign(CONFIG.Item.dataModels ??= {}, {
    weapon: WeaponModel,
    armor: ArmorModel,
    gear: GearModel,
    ability: AbilityModel,
    // Preserve the 0.1.0 subtype; never migrate existing documents silently.
    item: LegacyItemModel
  });

  const { DocumentSheetConfig } = foundry.applications.apps;
  const { Actor, Item } = foundry.documents;
  // Register a default for ALL supported Actor types. A generic registration
  // does not depend on the engine enumerating a particular subtype yet.
  // The NPC-specific registration then overrides the generic Actor default.
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, FastNRICharacterSheet, {
    makeDefault: true,
    label: "FASTNRI.Sheets.character"
  });
  DocumentSheetConfig.registerSheet(Actor, SYSTEM_ID, FastNRINPCSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "FASTNRI.Sheets.npc"
  });
  DocumentSheetConfig.registerSheet(Item, SYSTEM_ID, FastNRIItemSheet, {
    makeDefault: true,
    label: "FASTNRI.Sheets.item"
  });

  registerWeaponChatControls();
  registerAbilityChat();
  registerGameReroll();
  registerRollEditor();
  registerFreeHp();
  registerDamageChatControls();
  registerDamageComponentChoice();
  registerDamageRecovery();
  registerEffectsPanel();
  registerChatEffectDrag();
  registerHpLimit();
  registerActorJournal();
  registerPrivateAreaSourceCleanup();
  registerAreaFollowUpButtons();
  registerTempHpManualEdits();
  registerTempHpWorldTime();
  registerDeathLifecycle();
  // The approved Rest action is shared by the sheet button and this public system API.
  game.system.api ??= {};
  game.system.api.setCreatureSize = setCreatureSize;
  game.system.api.restActor = restActor;
  game.system.api.abilityAccountingStatus = abilityAccountingStatus;
  game.system.api.retryCardAccounting = retryCardAccounting;
  // Card-first ability flow: publication is free; execution and application are separate.
  Object.assign(game.system.api,{publishAbility,abilityExecutions,abilityExecution,executeAbilityFromChat});
  // Optional internal context for multi-message card uses. No new UI.
  game.system.api.createCardActionId = createCardActionId;
  // Read-only baseline action definitions and optional re-use of the standard check.
  // These do not add buttons, assign Items, or spend turn actions.
  game.system.api.standardAction = standardAction;
  game.system.api.standardActions = STANDARD_ACTIONS;
  game.system.api.rollStandardAction = rollStandardAction;
  game.system.api.initiateCounteraction = initiateCounteraction;
  game.system.api.applyCardDamageWithResponse = applyCardDamageWithResponse;
  Object.assign(game.system.api,{coverAllyDice,planCoverAlly});
  game.system.api.ensureDamageRecovery = ensureDamageRecovery;
  game.system.api.planResponsiveDamage = planResponsiveDamage;
  Object.assign(game.system.api,{readTempHpState,tempHpMax,grantTempHp,removeTempHpLayer,planTempHpExpiration});
  // Stage 3C: native Combat end-turn bridge, separate periodic markers and calculations.
  Object.assign(game.system.api, {createPeriodicDamageEffect,preparePeriodicDamage,
    readPeriodicData,orderedPeriodicEffects,declaredPeriodicDefenses,
    inspectDamageDefenseSources,previewDeclaredDamageDefenses,calculatePeriodicTick,planPeriodicHp,periodicEndPlan,retryPeriodicOutbox,
    reconcileDeathEffects,planDeathTransition,deathStateOf});
  // Game cards are shipped as Foundry-native system compendiums.
  // Rulebook cards retain native compendiums. Separate game ZIPs use native Document/FilePicker APIs.
  game.system.api.importGameArchive = importGameArchive;
  Object.assign(game.system.api,{findProjectionActor,findProjectionActors,projectionActorsForAbility,
    linkProjectionActor,unlinkProjectionActor,resolveSpellOrigin,
    isProjectionToken,projectionCaster,projectionSpatialPreview});
  // Engine-only item support; target Actor is supplied explicitly by the caller.
  // No new sheet button, confirmation, or unapproved chat presentation.
  game.system.api.useItem = useItem;
  game.system.api.inspectItemUse = inspectItemUse;
  game.system.api.attackOutcomePreview = attackOutcomePreview;
  game.system.api.attackOutcomeForDamageCard = attackOutcomeForDamageCard;
  // Explicit owner-directed consequence resolution: never moves scene tokens.
  game.system.api.prepareAttackOutcomeDecision = prepareAttackOutcomeDecision;
  game.system.api.prepareDamageCardOutcomes = prepareDamageCardOutcomes;
  game.system.api.applyAttackOutcomeEffects = applyAttackOutcomeEffects;
  game.system.api.undoAttackOutcomeEffects = undoAttackOutcomeEffects;
  // Explicit opt-in for voluntary native-die rerolls. Not a new chat UI.
  game.system.api.weaponDamageWithReroll = (message, degree) =>
    sendWeaponDamage(message,degree,{rerollLowWeaponDice:true});
  game.system.api.itemCapabilities = itemCapabilities;
  game.system.api.equipmentDefensePreview = equipmentDefensePreview;
  game.system.api.equipmentSkillBonusPreview = equipmentSkillBonusPreview;
  game.system.api.spellFocusPreview = spellFocusPreview;
  console.info("Fast NRI 7.0 | sheets and combat chat controls registered");
});

/**
 * Read-only post-startup diagnostics. Sheet registrations are applied by
 * Foundry after init; we inspect the public API only after ready.
 */
Hooks.once("ready", () => {
  if (!game.user?.isGM) return;
  try {
    const api = foundry.applications.apps.DocumentSheetConfig;
    const types = [
      ["Actor", "character", "FastNRICharacterSheet"],
      ["Actor", "npc", "FastNRINPCSheet"],
      ["Item", "weapon", "FastNRIItemSheet"],
      ["Item", "ability", "FastNRIItemSheet"]
    ];
    const report = types.map(([documentName, subtype, expected]) => {
      const result = api.getSheetClassesForSubType(documentName, subtype);
      const registered = Object.keys(result.sheetClasses ?? {});
      return {
        documentName, subtype, expected, registered,
        defaultClass: result.defaultClass,
        present: registered.some(id => id.includes(expected))
      };
    });
    console.info("Fast NRI 7.0 | sheet registration report", report);
    const missing = report.filter(x => !x.present);
    if (missing.length) {
      const details = missing.map(x => x.documentName + ":" + x.subtype).join(", ");
      ui.notifications?.warn(game.i18n.format('FASTNRI.Hints.sheetRegistrationMissing', {details}));
    }
  } catch (error) {
    console.error("Fast NRI 7.0 | sheet diagnostics failed", error);
    ui.notifications?.warn(game.i18n.localize('FASTNRI.Hints.sheetDiagnosticsFailed'));
  }
});
