/**
 * Fast NRI 7.0: typed magical directed-attack damage profile.
 * The ordinary weapon A/B/C adapter is deliberately unchanged.
 * Every surviving die is an independent editable damage component.
 * This is pure data validation / expansion, not a Roll or HP application.
 */
import {bestiaryAttackExpression,parseDamageByDegree} from './attack-core.mjs';

export const MAGIC_DEGREES = Object.freeze(['failure','partial','success','great']);
const fail=reason=>({ok:false,reason});

/** Ordinary dice can grow or be added with each degree. Fixed bonuses
 * are independent components whenever the authored profile specifies them.
 */
export function parseMagicAttackProfile(profile) {
  const parsed = parseDamageByDegree(profile, 'M');
  if (!parsed.ok) return fail(parsed.detail ? `invalid-magic-${parsed.detail}` : 'missing-magic-profile');
  let previous = [];
  for (const degree of MAGIC_DEGREES.slice(1)) {
    const faces = parsed.partsByDegree[degree].filter(part => part.kind === 'die')
      .map(part => part.faces).sort((a,b) => b-a);
    if (!faces.length || previous.some((value,index) => !(faces[index] >= value)))
      return fail(`invalid-magic-${degree}`);
    previous = faces;
  }
  return parsed;
}

export function magicAttackPartsForDegree(profile, degree) {
  if (!MAGIC_DEGREES.includes(degree)) return fail('invalid-magic-degree');
  const parsed = parseMagicAttackProfile(profile);
  return parsed.ok ? {ok:true,degree,parts:parsed.partsByDegree[degree]} : parsed;
}

/** Character spells use the combat die even without weapon proficiency.
 * A missing/invalid Actor combat die is advisory, not an action prohibition:
 * the normal preroll window still allows the player to fix the expression.
 */
export function magicCombatAttackExpression(actor) {
  const bestiary=bestiaryAttackExpression(actor);
  if (bestiary) return {expression:bestiary,warning:null};
  const raw=String(actor?.system?.combatDie??'').trim();
  const valid=/^(?:1)?d([1-9]\d*)$/i.exec(raw);
  const die=valid && Number.isSafeInteger(Number(valid[1])) && Number(valid[1])<=1000
    ? `1d${Number(valid[1])}` : null;
  return {expression:die?`1d20 + ${die}`:'1d20',warning:die?null:'missingCombatDie'};
}
