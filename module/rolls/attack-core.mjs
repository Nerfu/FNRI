/**
 * Fast NRI 7.0 — pure attack-degree and standard physical-profile calculations.
 * Stage 4 draft. No Foundry document updates, rolls, chat messages, or HP writes.
 * Every value comes from the attack/target/card; there are no built-in game defaults.
 */
export const ATTACK_DEGREES = Object.freeze(["failure", "partial", "success", "great"]);

const finite = value => typeof value === "number" && Number.isFinite(value);
const fail = (reason, detail = null) => ({ ok: false, reason, detail });
const pass = result => ({ ok: true, ...result });
const clampDegree = value => Math.max(0, Math.min(3, value));

export function ferocityAttackDegree(result,enabled=false) {
  return enabled&&result?.ok&&result.degree==='partial'?{...result,degree:'failure',degreeIndex:0}:result;
}
export const ferocityDamageApplies=degree=>degree==='success'||degree==='great';

export function bestiaryAttackExpression(actor) {
  const modifier = actor?.system?.attackModifier;
  if (actor?.type !== 'npc' || !finite(modifier)) return null;
  return `1d20 ${modifier < 0 ? '-' : '+'} ${Math.abs(modifier)}`;
}

export function naturalAttackingD20(roll) {
  const dice = (roll?.dice ?? []).filter(die => die.faces === 20 && die.number === 1);
  if (dice.length !== 1) return null;
  const active = (dice[0].results ?? []).filter(result => result.active !== false);
  const value = active.length === 1 ? active[0].result : null;
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : null;
}

export function resolveCheckDegree({total, naturalD20, difficulty} = {}) {
  if (!finite(difficulty)) return fail('missing-or-invalid-difficulty');
  const result = resolveAttackDegree({
    total, naturalD20, ac:{partial:difficulty-10,success:difficulty,great:difficulty+10}
  });
  if (!result.ok) return result;
  const index = result.naturalTwenty ? 3 : result.degreeIndex;
  return pass({degree:ATTACK_DEGREES[index],degreeIndex:index,
    naturalOne:result.naturalOne,naturalTwenty:result.naturalTwenty});
}

/** Compare an already evaluated attack against all three AC thresholds.
 * naturalD20 must be the value of the attacking d20, not the total Roll result.
 * Attacker-side degree changes occur after the base degree. Natural 1 is final.
 * Natural 20 does NOT improve a degree: it is only a later damage multiplier.
 */
export function resolveAttackDegree({ total, naturalD20, ac, attackerDegreeShift = 0 } = {}) {
  if (!finite(total)) return fail("missing-or-invalid-attack-total");
  if (!Number.isInteger(naturalD20) || naturalD20 < 1 || naturalD20 > 20)
    return fail("missing-or-invalid-natural-d20");
  const thresholds = [ac?.partial, ac?.success, ac?.great];
  if (!thresholds.every(finite)) return fail("missing-or-invalid-ac-thresholds");
  if (!(thresholds[0] <= thresholds[1] && thresholds[1] <= thresholds[2]))
    return fail("ac-thresholds-out-of-order");
  if (!Number.isInteger(attackerDegreeShift)) return fail("invalid-attacker-degree-shift");
  const baseIndex = thresholds.reduce((best, threshold, index) => total >= threshold ? index + 1 : best, 0);
  const index = naturalD20 === 1 ? 0 : clampDegree(baseIndex + attackerDegreeShift);
  return pass({
    degree: ATTACK_DEGREES[index], degreeIndex: index,
    baseDegree: ATTACK_DEGREES[naturalD20 === 1 ? 0 : baseIndex],
    baseDegreeIndex: naturalD20 === 1 ? 0 : baseIndex,
    naturalOne: naturalD20 === 1,
    naturalTwenty: naturalD20 === 20,
    // A suggested numeric factor only: actual application is after defenses,
    // and never to periodic damage/healing or a separately resolved instance.
    attackNaturalTwentyDamageMultiplier: naturalD20 === 20 ? 2 : 1
  });
}

/** Directed defense lowers EFFECT degree, NOT attack degree/damage profile.
 * Only for directed attacks against AC without the Area property.
 * This function does not calculate any defense roll or damage removal.
 */
export function resolveDirectedEffectDegree({ attackDegree, successfulDefenses = 0, fullyCancelled = false } = {}) {
  const index = ATTACK_DEGREES.indexOf(attackDegree);
  if (index < 0) return fail("invalid-attack-degree");
  if (!Number.isInteger(successfulDefenses) || successfulDefenses < 0)
    return fail("invalid-defense-count");
  const finalIndex = fullyCancelled ? 0 : clampDegree(index - successfulDefenses);
  return pass({
    attackDegree,
    effectDegree: ATTACK_DEGREES[finalIndex],
    fullyCancelled: Boolean(fullyCancelled)
  });
}

/** Standard target physical attack, excluding attack spells and Area.
 * A and B are SINGLE ordinary dice; C is a POSITIVE FIXED number.
 * Special card exceptions and spells must use their own profile adapters.
 * Parts are not rolled here: later code must retain per-die results/types.
 */
export function parseStandardPhysicalProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile))
    return fail("missing-profile");
  const parseDie = (value, key) => {
    const result = /^1d([1-9]\d*)$/i.exec(String(value ?? "").trim());
    if (!result) return fail("invalid-single-die", key);
    const faces = Number(result[1]);
    if (!Number.isSafeInteger(faces)) return fail("invalid-die-faces", key);
    return pass({ part: { id: key, kind: "die", faces, formula: `1d${faces}` } });
  };
  const a = parseDie(profile.A, "A");
  if (!a.ok) return a;
  const b = parseDie(profile.B, "B");
  if (!b.ok) return b;
  const value = (typeof profile.C === "number") ? profile.C :
    (/^\+?\d+(?:\.\d+)?$/.test(String(profile.C ?? "").trim())
      ? Number(String(profile.C).trim()) : NaN);
  if (!finite(value) || value <= 0) return fail("invalid-positive-fixed-bonus", "C");
  return pass({ parts: [a.part, b.part, { id: "C", kind: "fixed", value, formula: String(value) }] });
}

/** Return independent damage parts for degree 0...3, preserving identities.
 * C remains its own fixed-result damage die under Rulebook 'Кубы урона'.
 * This produces NO roll, automatic effect or HP mutation.
 */
export function standardPhysicalPartsForDegree(profile, degree) {
  const index = ATTACK_DEGREES.indexOf(degree);
  if (index < 0) return fail("invalid-attack-degree");
  const parsed = parseStandardPhysicalProfile(profile);
  if (!parsed.ok) return parsed;
  return pass({ degree, parts: parsed.parts.slice(0, index).map(part => ({ ...part })) });
}

/** Expand a card's explicit degree expressions into independently rolled parts.
 * A part keeps its identity across degrees only while its die/value is the same.
 */
export function parseDamageByDegree(profile, prefix) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return fail('missing-profile');
  if (String(profile.failure ?? '').trim() !== '0') return fail('invalid-degree-profile', 'failure');
  const partsByDegree = {failure: []};
  const slots = new Map();
  let nextId = 1;
  for (const degree of ATTACK_DEGREES.slice(1)) {
    const terms = String(profile[degree] ?? '').split('+').map(term => term.trim());
    const parts = [];
    const used = new Map();
    for (const term of terms) {
      const die = /^([1-9][0-9]*)d([1-9][0-9]*)$/i.exec(term);
      const count = die ? Number(die[1]) : 1;
      const faces = die ? Number(die[2]) : null;
      const value = !die && /^[1-9][0-9]*$/.test(term) ? Number(term) : null;
      if (count > 64 - parts.length || (die ? faces > 1000 : !Number.isSafeInteger(value)))
        return fail('invalid-degree-profile', degree);
      const formula = die ? `1d${faces}` : String(value);
      if (!slots.has(formula)) slots.set(formula, []);
      const ids = slots.get(formula);
      const start = used.get(formula) ?? 0;
      for (let index = start; index < start + count; index++) {
        ids[index] ??= `${prefix}${nextId++}`;
        parts.push({id:ids[index],formula,...(die ? {kind:'die',faces} : {kind:'fixed',value})});
      }
      used.set(formula,start + count);
    }
    partsByDegree[degree] = parts;
  }
  return pass({partsByDegree});
}

export function parsePhysicalAttackProfile(profile) {
  return profile?.degrees ? parseDamageByDegree(profile.degrees, 'P') : parseStandardPhysicalProfile(profile);
}

export function physicalAttackPartsForDegree(profile, degree) {
  if (!profile?.degrees) return standardPhysicalPartsForDegree(profile, degree);
  if (!ATTACK_DEGREES.includes(degree)) return fail('invalid-attack-degree');
  const parsed = parsePhysicalAttackProfile(profile);
  return parsed.ok ? pass({degree,parts:parsed.partsByDegree[degree]}) : parsed;
}
