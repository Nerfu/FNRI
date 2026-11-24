/**
 * Fast NRI 7.0: typed magical directed-attack damage profile.
 * The ordinary weapon A/B/C adapter is deliberately unchanged.
 * Every surviving die is an independent editable damage component.
 * This is pure data validation / expansion, not a Roll or HP application.
 */
import {bestiaryAttackExpression} from './attack-core.mjs';

export const MAGIC_DEGREES = Object.freeze(['failure','partial','success','great']);
const fail=reason=>({ok:false,reason});

/** Profile authored on Item.mechanics.attack.damageProfile:
 * {failure:'0',partial:'1d6',success:'2d6',great:'3d6'}.
 * Each degree has an explicit number of dice; no scaling inferred by name.
 */
export function parseMagicAttackProfile(profile) {
  if(!profile || typeof profile!=='object' || Array.isArray(profile))return fail('missing-magic-profile');
  if(profile.failure!==0 && String(profile.failure??'').trim()!=='0')return fail('invalid-magic-failure');
  const parsed={failure:{count:0,faces:0}};
  for(const degree of MAGIC_DEGREES.slice(1)){
    const matched=/^([1-9]\d*)d([1-9]\d*)$/i.exec(String(profile[degree]??'').trim());
    if(!matched)return fail(`invalid-magic-${degree}`);
    const count=Number(matched[1]),faces=Number(matched[2]);
    if(!Number.isSafeInteger(count) || count>64 || !Number.isSafeInteger(faces) || faces>1000)
      return fail(`invalid-magic-${degree}`);
    parsed[degree]={count,faces};
  }
  return {ok:true,profile:parsed};
}

export function magicAttackPartsForDegree(profile,degree) {
  if(!MAGIC_DEGREES.includes(degree))return fail('invalid-magic-degree');
  const parsed=parseMagicAttackProfile(profile);
  if(!parsed.ok)return parsed;
  const {count,faces}=parsed.profile[degree];
  return {ok:true,degree,parts:Array.from({length:count},(_unused,i)=>({
    id:`M${i+1}`,kind:'die',faces,formula:`1d${faces}`
  }))};
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
