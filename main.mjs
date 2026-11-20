import {registerWeaponChatControls} from "./module/weapon/weapon-attack.mjs";
/**
 * Fast NRI 7.0 — Foundry VTT v14 system initialization.
 * The subtype data models and sheets are registered during the init hook.
 * No combat rules or character data are changed by this release.
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
  console.info("Fast NRI 7.0 | data models, sheets and weapon chat controls registered");
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
      ui.notifications?.warn("Fast NRI: некоторые листы не зарегистрированы (" + details + "). Сообщите об этом разработчику.");
    }
  } catch (error) {
    console.error("Fast NRI 7.0 | sheet diagnostics failed", error);
    ui.notifications?.warn("Fast NRI: не удалось проверить регистрацию листов. Подробности в консоли Foundry.");
  }
});
