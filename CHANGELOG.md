## 0.1.7 — исправление навигации листов (2026-11-17)

- Исправлено переключение пяти вкладок на листах персонажа и NPC.
- Вкладки переключаются без полной перерисовки и не блокируются ошибками сохранения или невалидными полями.
- Сохранение навыков, Специализаций, ресурсов и экипировки не менялось.
- Добавлены браузерные регрессионные проверки реальных кликов по элементам UI (в имитации API, не в настоящей Foundry).

# Fast NRI Foundry System — Code Changelog

## 0.1.6 — свободные навыки/Специализации и слоты (2026-11-17)

- Replace fixed numeric-only skill editor with unlimited skill/specialization rows sharing one addressable dictionary; free text dice expressions, no limits/presets forced.
- Preserve stage-2 legacy numeric row value separately; no automatic migration or reinterpretation.
- Allow any embedded Item in left/right hand or armor and add/delete arbitrarily many named equipment slots.
- Clear extra-slot Item references on explicit deletion, preserve missing external references with warning; no automatic gameplay effects.
- Prevent a failed Actor field update from silently losing unsaved changes on tab switch; add regression coverage.
- Expand source, local unit tests, RU/EN labels and template generator. No rules, roll logic or existing published data were changed.


### Исправления по аудиту (2026-11-16)

- Replace unpublished skill/resource arrays with keyed `TypedObjectField` for targeted partial updates.
- Replace competing Actor submit paths with a serialized field-level change handler and input validation.
- Move HP, combat die/attack modifier, speed, AC, defenses and resource summary to persistent Actor header.
- Preserve and visibly mark missing equipment references instead of silently clearing external deletions.
- Add optional manual wealth text field; no economy rules or automation.
- Make smoke tests version-agnostic; require explicit manual GitHub release workflow approval.
- No publication, no content import or migration, no game-rule changes.


### Базовые листы этапа 2

- Character and NPC sheet tabs: Overview, Skills, Abilities, Inventory, Description.
- Optional lists of skills and manually controlled resources in Actor TypeDataModel.
- Equipped-item references to embedded Item IDs for left hand, right hand and armor.
- Actor sheet actions for creating/opening/deleting embedded Items and editing manual lists.
- Scoped layout/CSS for tab visibility, fields, responsive layout and Foundry v14 scrolling.
- No rolls, automatic game-rule calculation, content imports or migration.

## 0.1.5 — Scrolling for Actor and Item sheets (2026-11-16)

- Fix clipping by making Foundry window-content the scroll container.
- Leave the sheet content at natural height.

## 0.1.4 — Numeric input display hotfix (2026-11-16)

- Render numeric fields as typed text inputs and add visible field styling.

## 0.1.3 — Bootstrap syntax and sheet hotfix (2026-11-16)

- Fix startup-blocking SyntaxError in LegacyItemModel.
- Register generic Actor and Item sheets with an NPC-specific override.
- Add JS syntax checks before publishing.

## 0.1.2 — Foundry v14 sheet hotfix (2026-11-16)

- Initialize data model registries safely, use root form templates.

## 0.1.1 — Stage 1 scaffold (2026-11-16)

- Register Actor and Item TypeDataModels and basic sheets, RU/EN.
