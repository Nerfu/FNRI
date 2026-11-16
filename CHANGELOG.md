# Fast NRI Foundry System — Code Changelog

## 0.1.3 — Sheet registration diagnostics (2026-11-16)

- Register the generic Actor sheet and Item sheet without subtype restrictions; NPC receives a specific default sheet.
- Use an explicit system package type in the manifest.
- Report missing sheet registrations to the GM after Foundry initializes its sheet registry.
- Add executable bootstrap smoke tests to the GitHub release workflow.
- No gameplay rules or Actor/Item schema changes. Still requires validation in a real Foundry v14 world.

## 0.1.2 — Foundry v14 sheet hotfix (2026-11-16)

- Initialize TypeDataModel registries safely before registering the document sheets.
- Give ActorSheetV2 and ItemSheetV2 a form application root and a root Handlebars template part.
- No gameplay or persistent schema changes. Verification inside running Foundry v14 is still pending.

## 0.1.1 — Stage 1 scaffold (2026-11-16)

- Registered Actor `character` and `npc` TypeDataModel subtypes.
- Registered four primary Item types: `weapon`, `armor`, `gear`, `ability`.
- Retained legacy Item `item` for compatibility with 0.1.0 starter documents.
- Added minimal editable Actor/Item v14 Handlebars sheets and built-in Item drag/drop area.
- Added RU/EN UI text. Game calculations, imports and migrations are not yet implemented.
