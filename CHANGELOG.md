# Fast NRI Foundry System — Code Changelog

## 0.1.4 — Numeric input display hotfix (2026-11-16)

- Render numeric Actor/Item fields as text inputs with `data-dtype="Number"`, supported by Foundry's form handling, to avoid blank controls on the v14 sheet.
- Add visible number-field styling scoped to FNRI sheets.
- Keep the existing numeric `TypeDataModel` schemas, including nullable fields, unchanged.
- Add template smoke checks; runtime display still requires a test in a live Foundry world.

## 0.1.3 — Bootstrap syntax and sheet hotfix (2026-11-16)

- Fix the confirmed startup-blocking SyntaxError: missing closing brace in LegacyItemModel (module/data/models.mjs).
- Add mandatory JavaScript syntax checks before packaging GitHub releases.

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
