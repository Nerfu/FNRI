/** Fast NRI stage 3: safe, transparent wrappers around Foundry v14 Roll.
 * This file does not determine outcomes, attacks, damage or resource costs.
 */
export const MESSAGE_MODES = new Set(["public", "gm", "blind", "self", "ic"]);

const finiteOrZero = value => (typeof value === "number" && Number.isFinite(value)) ? value : 0;
const safeText = value => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Skill and specialization both use the very same check. The optional
 * modifier is a prepared value: native ActiveEffect changes have already
 * been applied by Foundry. Never add the underlying effect a second time.
 */
export function skillFormula(entry) {
  const dice = String(entry?.dice ?? "").trim();
  const modifier = finiteOrZero(entry?.modifier);
  return `1d20${dice ? ` + (${dice})` : ""}${modifier ? ` + (${modifier})` : ""}`;
}

export function itemFormula(item) {
  // A card owns its complete expression. The common engine never silently
  // inserts d20 or a class/race-based modifier into an item card roll.
  return String(item?.system?.rollFormula ?? "").trim();
}

export function resolveMessageMode(selected, defaultMode = "public") {
  if (MESSAGE_MODES.has(selected)) return selected;
  return MESSAGE_MODES.has(defaultMode) ? defaultMode : "public";
}

export async function postRoll({ formula, label, actor = null, mode = "public" }) {
  const expression = String(formula ?? "").trim();
  if (!expression) throw new Error("empty-formula");
  if (typeof Roll.validate === "function" && !Roll.validate(expression)) throw new Error("invalid-formula");
  // The core Roll keeps every die result and supplies its native chat tooltip.
  const roll = await new Roll(expression, actor?.getRollData?.() ?? {}).evaluate();
  const speaker = actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker();
  await roll.toMessage({
    speaker,
    flavor: `<strong>${safeText(label)}</strong><div class="fnri-roll-expression">${safeText(expression)}</div>`
  }, { messageMode: resolveMessageMode(mode) });
  return roll;
}
