/**
 * Fast NRI 7.0 — Foundry VTT 14 system entry point.
 * Stage 1: data models and minimal sheets. No rules are automated yet.
 */
import { CharacterModel, NPCModel, WeaponModel, ArmorModel, GearModel, AbilityModel, LegacyItemModel } from "./module/data/models.mjs";
import { FastNRICharacterSheet, FastNRINPCSheet, FastNRIItemSheet } from "./module/sheets/sheets.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.dataModels = { ...(CONFIG.Actor.dataModels ?? {}),
    character: CharacterModel,
    npc: NPCModel
  };
  CONFIG.Item.dataModels = { ...(CONFIG.Item.dataModels ?? {}),
    weapon: WeaponModel,
    armor: ArmorModel,
    gear: GearModel,
    ability: AbilityModel,
    // Internal compatibility for documents originating in starter 0.1.0.
    item: LegacyItemModel
  };

  const { DocumentSheetConfig } = foundry.applications.apps;
  const { Actor, Item } = foundry.documents;
  const namespace = game.system.id;
  DocumentSheetConfig.registerSheet(Actor, namespace, FastNRICharacterSheet, {
    types: ["character"], makeDefault: true, label: "FASTNRI.Sheets.character"
  });
  DocumentSheetConfig.registerSheet(Actor, namespace, FastNRINPCSheet, {
    types: ["npc"], makeDefault: true, label: "FASTNRI.Sheets.npc"
  });
  DocumentSheetConfig.registerSheet(Item, namespace, FastNRIItemSheet, {
    types: ["weapon", "armor", "gear", "ability", "item"],
    makeDefault: true, label: "FASTNRI.Sheets.item"
  });

  console.info("Fast NRI 7.0 | Stage 1 initialized (Foundry v14)");
});
