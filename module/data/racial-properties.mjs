import {roleRacialChoices} from "./roles.mjs";

export function racialPropertyRule(item) {
  const rule = item?.system?.mechanics?.racialProperty;
  return item?.type === "ability" && rule && typeof rule === "object" && !Array.isArray(rule)
    ? rule : null;
}

export function racialPropertyChoices(rule) {
  if (!Array.isArray(rule?.choices)) return [];
  return rule.choices.filter(choice => typeof choice?.id === "string" && choice.id.trim() &&
    typeof choice.label === "string" && choice.label.trim());
}

export function selectedRacialPropertyChoice(rule) {
  return racialPropertyChoices(rule).find(choice => choice.id === rule.selection) ?? null;
}

/** Resolve inherited properties from the source Actor at the time of the roll. */
export function inheritedAttackTraits(actor, item, properties) {
  if (item?.type !== "ability") return [];
  const included = new Set(String(properties ?? "").split(/[,;]+/).map(normalize).filter(Boolean));
  const tags = new Set([...included, ...String(item.system?.tags ?? "").split(/[,;]+/).map(normalize).filter(Boolean)]);
  const result = [];
  for (const property of actor?.items?.contents ?? []) {
    const rule = racialPropertyRule(property);
    if (!tags.has(normalize(rule?.inheritsTo))) continue;
    const trait = selectedRacialPropertyChoice(rule)?.attackTrait;
    if (typeof trait !== "string" || !trait.trim() || included.has(normalize(trait))) continue;
    included.add(normalize(trait));
    result.push(trait.trim());
  }
  // Tags on the ability can mark a rule even when omitted from attack properties.
  return result;
}
export const RACIAL_SYSTEM_ID = "fast-nri-v14";
const RULEBOOK = "fnri7.rulebook.";
const LOW_LIGHT = RULEBOOK + "vision.low-light";
const DARKVISION = RULEBOOK + "vision.darkvision";
const HALF_BLOOD = RULEBOOK + "racial.polukrovka";
const NEPHALEM_NATURE = RULEBOOK + "racial.priroda-nefalema";
const RACES = {
  human: ["Человек", 3, RULEBOOK + "racial.umelyi"],
  elf: ["Эльф", 2, RULEBOOK + "racial.elfiiskoe-provorstvo", LOW_LIGHT],
  dwarf: ["Дварф", 2, DARKVISION],
  halfling: ["Полурослик", 2],
  orc: ["Орк", 2, DARKVISION],
  nephalem: ["Нефалем", 3, NEPHALEM_NATURE],
  draconic: ["Драконообразный", 3, LOW_LIGHT, RULEBOOK + "racial.drakonia-priroda"],
  catfolk: ["Котолюд", 3, LOW_LIGHT]
};

export const racialContentId = item => item?.getFlag?.(RACIAL_SYSTEM_ID, "contentId");
export const racialLabel = key => game.i18n.localize(`FASTNRI.RacialProperties.${key}`);
const normalize = value => String(value ?? "").trim().toLocaleLowerCase("ru").replaceAll("ё", "е");

// Retain legacy world keys for compatibility; they no longer control or block selection.
export function registerRacialSettings() {
  for (const [key, defaultValue] of [
    ["racialAncestryFilter", true], ["racialChoiceLimit", true], ["racialAllowInnateRemoval", false]
  ]) {
    game.settings.register(RACIAL_SYSTEM_ID, key, {
      name: `FASTNRI.RacialProperties.${key}`, hint: `FASTNRI.RacialProperties.${key}Hint`,
      scope: "world", config: false, type: Boolean, default: defaultValue
    });
  }
}

export const racialRaceNames = () => Object.values(RACES).map(([name]) => name);

export function racialState(actor) {
  const race = normalize(actor?.system?.race);
  const primary = Object.keys(RACES).find(id => id === race || normalize(RACES[id][0]) === race);
  const items = actor?.items?.contents ?? [];
  const secondary = racialPropertyRule(items.find(item => racialContentId(item) === HALF_BLOOD))?.selection;
  const races = [primary].filter(Boolean);
  if (primary === "human" && secondary !== "human" && Object.hasOwn(RACES, secondary)) races.push(secondary);
  const innate = new Set(races.flatMap(id => RACES[id].slice(2)));
  const nature = racialPropertyRule(items.find(item => racialContentId(item) === NEPHALEM_NATURE))?.selection;
  if (races.includes("nephalem")) {
    if (nature === "holy") {
      innate.add(LOW_LIGHT);
      innate.add(RULEBOOK + "racial.nebesnyi-poslannik");
    }
    if (nature === "unholy") innate.add(DARKVISION);
  }
  const chosen = new Set(items.filter(racialPropertyRule)
    .map(item => racialContentId(item) || item.id).filter(id => !innate.has(id)));
  return {races, innate, max: primary ? RACES[primary][1] + roleRacialChoices(actor) : null, used: chosen.size};
}

export function racialAddWarnings(actor, item, state = null) {
  const rule = racialPropertyRule(item);
  if (actor?.type !== "character" || !rule) return [];
  state ??= racialState(actor);
  const contentId = racialContentId(item);
  const warnings = [];
  if (contentId && actor.items.contents.some(owned => racialPropertyRule(owned) && racialContentId(owned) === contentId))
    warnings.push("duplicate");
  if (state.innate.has(contentId)) return warnings;
  if (rule.innateOnly === true ||
      (rule.universal !== true && !rule.races?.some?.(race => state.races.includes(race)))) warnings.push("wrongRace");
  if (state.max !== null && state.used >= state.max) warnings.push("limitReached");
  return warnings;
}

// Compatibility for callers that need just the first advisory warning.
export function racialAddProblem(actor, item, state = null) {
  return racialAddWarnings(actor, item, state)[0] ?? null;
}

export function changesAncestry(item) {
  return [HALF_BLOOD, NEPHALEM_NATURE].includes(racialContentId(item));
}

