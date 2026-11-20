## 0.1.10 — интерфейс, быстрые действия и сохранение (2026-11-20)

- Шапка листов Character и NPC стала компактной; все поля редактирования перенесены в «Характеристики», штатный режим видимости бросков используется напрямую.
- Нажатие на HP в шапке открывает редактирование текущих и временных HP. Оба поля сохраняются тем же адресным механизмом, что и основные характеристики.
- Список навыков стал плотнее: единые заголовки столбцов, четыре сворачиваемые группы и раздел пользовательских навыков/Специализаций, фильтр «Все / С кубами».
- В списке способностей можно бросить формулу её Item-карточки без открытия карточки; использует штатный режим чата Foundry.
- Индикатор «Сохранение… / Сохранено / Ошибка сохранения» показывает статус очереди адресных обновлений; не скрывает ошибки до исправления поля.
- Последняя вкладка запоминается индивидуально для пользователя и каждого Actor в собственном User flag; состояние раскрытых разделов сохраняется до закрытия листа.
- Разделы вкладки «Характеристики» сворачиваются; объём новых записей и поля Actor/Item не ограничены.
- Локально проверены Node тесты и Chromium (интерфейс, права, броски, HP, сохранение/ошибки, вкладки, фильтрация и эффекты).

## 0.1.9 — каталог навыков Рулбука 7.0 и стабильное сохранение

- 15 базовых навыков из Рулбука 7.0 доступны сразу в листах персонажа и существа; кубы назначаются отдельно для каждого Actor.
- Две начальные редактируемые Специализации: основная `2d6` и дополнительная `2d4`.
- Навыки сгруппированы по четырём нормативным категориям; пользовательские навыки и Специализации создаются и редактируются самостоятельно.
- `Actor.system.skills` остаётся `TypedObjectField`: адресные обновления записей, начальные значения для новых персонажей, безопасный показ стандартных навыков у ранее созданных Actor.
- Подготовка листа объединяет сохранённые и подготовленные записи, не скрывая их при неполной инициализации; несовпадение диагностируется в консоли без автоматической перезаписи.
- Инициализация моделей использует `Object.assign` для сохранения регистраций других модулей.
- Убрано техническое пояснение о формуле из интерфейса карточки предмета.
- Тесты каталога, адресных изменений, браузерного UI и перезагрузки данных.

## Локальная доработка 0.1.8 — выбор своей формулы (17.11.2026, без релиза)

- Выбор «Своя формула…» сразу очищает ранее выбранные кубы и сохраняет пустую формулу. До ввода нового значения Skill Check использует 1d20 (+ модификатор).
- Поддержан пустой открытый редактор при перерисовке листа; существующие нестандартные формулы и смена типа записи не затронуты.
- Добавлен браузерный регрессионный тест.

## 0.1.8 — этап 3: броски и числовые эффекты (локальный кандидат; НЕ опубликовано)

- Навыки: выпадающий выбор d4/d6/d8/d10/d12; Специализации: Основная 2d6 / Дополнительная 2d4. Сохраняется пункт «Своя формула…» для нестандартных/прежних значений. Изменение категории не перезаписывает кубы.

- Общая проверка навыка/Специализации: `1d20 + (кубы) + подготовленный числовой модификатор`; нет ограничений на количество записей или набор кубов.
- Стандартный `Roll.toMessage` с режимами `public`, `gm`, `blind`, `self`, исходной формулой и деталями выпавших кубов в штатном чате.
- Карточки всех типов, включая прежний `item`, получили необязательную собственную полную формулу Roll; информационное устаревание не влияет на броски.
- Native ActiveEffect: числовая поправка к защитам, КЗ, Скорости и отдельной строке навыка; добавление, просмотр, отключение и удаление.
- ActiveEffect на Item доступен в штатном редакторе, перенос выключен по умолчанию и включается пользователем сознательно.
- Добавлен локальный тест приватности режимов сообщения и независимых модификаторов, браузерный регресс вкладок.
- Нет формул степеней успеха, атаки, урона и автоматических последствий без актуального нормативного Rulebook 7.0.
- Исходные значения Actor/Item не мигрируют и не исправляются автоматически.

## 0.1.7 — исправление навигации листов (опубликовано 2026-11-17)

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
