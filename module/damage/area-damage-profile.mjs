/**
 * Declarative, card-owned damage-die removal for an area attack.
 * Only the current values of evaluated parts are considered (including rerolls):
 * this never rolls new dice,
 * writes chat documents, mutates a target, or changes the attack degree.
 * Equivalent ties use stable source order. Unequal typed/propertied ties
 * are left unresolved: the defender, not the engine, chooses the removed die.
 */
import {ATTACK_DEGREES} from '../rolls/attack-core.mjs';

const STEPS=new Set(['lowest','highest','all']);
const fail=reason=>({ok:false,reason});

/** Dice with the same result are interchangeable ONLY if no declared
 * property distinguishing their gameplay consequences has been lost. The
 * per-part source and formula are included conservatively: a card may give
 * two otherwise identical dice source-specific effects. This is not a new
 * rule for choosing dice; it merely recognizes when either choice is equal.
 */
function sameRemovalConsequences(a,b){
  const normalizedTraits=p=>Array.isArray(p.traits)?[...new Set(p.traits.map(t=>
    String(t).trim().toLocaleLowerCase('ru')))].sort().join('\u0000'):'';
  return String(a.damageType??'').trim().toLocaleLowerCase('ru')===
      String(b.damageType??'').trim().toLocaleLowerCase('ru') &&
    normalizedTraits(a)===normalizedTraits(b) &&
    (a.source??null)===(b.source??null) &&
    (a.kind??null)===(b.kind??null) &&
    (a.formula??null)===(b.formula??null) &&
    (a.faces??null)===(b.faces??null) &&
    (a.profilePart??null)===(b.profilePart??null);
}


/** A card may declare areaDamageProfile:
 * {failure:{remove:['all']},partial:{remove:['highest']},
 *  success:{remove:['lowest']},great:{remove:[]}}.
 * For 3 dice use ['highest','lowest'] on partial. The steps are applied
 * sequentially to retained dice using their current values; no formula is inferred from a name.
 */
export function parseAreaDamageProfile(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail('missing-area-profile');
  if(Object.keys(raw).some(key=>!ATTACK_DEGREES.includes(key)))return fail('unknown-area-degree');
  const profile={};
  for(const degree of ATTACK_DEGREES){
    const entry=raw[degree];
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||
       Object.keys(entry).some(key=>key!=='remove')||!Array.isArray(entry.remove)||
       entry.remove.length>64||entry.remove.some(step=>!STEPS.has(step))||
       (entry.remove.includes('all')&&entry.remove.length!==1))
      return fail(`invalid-area-profile-${degree}`);
    profile[degree]={remove:[...entry.remove]};
  }
  return {ok:true,profile};
}

/** Rulebook defaults are defined for 2 or 3 full-damage components. Other
 * counts require explicit data on the Item instead of a fabricated profile.
 */
export function areaRemovalSteps(degree,count,custom=null){
  if(!ATTACK_DEGREES.includes(degree))return fail('invalid-area-degree');
  if(!Number.isInteger(count)||count<0)return fail('invalid-area-part-count');
  if(custom!==null&&custom!==undefined){
    const result=parseAreaDamageProfile(custom);
    return result.ok?{ok:true,steps:result.profile[degree].remove,custom:true}:result;
  }
  if(count!==2&&count!==3)return fail('undefined-default-area-profile');
  const steps=degree==='great'?[]:degree==='success'?['lowest']:
    degree==='partial'?(count===3?['highest','lowest']:['highest']):['all'];
  return {ok:true,steps,custom:false};
}

/** Choose removal steps from the full pool, then apply them only to parts
 * the recipient is not immune to. Keep the identity of each remaining die.
 */
export function selectAreaDamageParts(parts,degree,custom=null,{immunePartIds=[]}={}){
  if(!Array.isArray(parts)||parts.some(p=>!p||typeof p.id!=='string'||
    typeof p.value!=='number'||!Number.isFinite(p.value)||p.value<0))
    return fail('invalid-area-parts');
  if(new Set(parts.map(p=>p.id)).size!==parts.length)return fail('duplicate-area-part-id');
  const removal=areaRemovalSteps(degree,parts.length,custom);
  if(!removal.ok)return removal;
  const immune=new Set(immunePartIds);
  const remaining=parts.filter(part=>!immune.has(part.id));
  const removed=[];
  for(const step of removal.steps){
    if(step==='all'){removed.push(...remaining.splice(0));break;}
    if(!remaining.length)break;
    let index=0;
    for(let i=1;i<remaining.length;i++){
      if(step==='lowest'?remaining[i].value<remaining[index].value:
        remaining[i].value>remaining[index].value)index=i;
    }
    const tied=remaining.filter(p=>p.value===remaining[index].value);
    // A mixed tie requires the defender's choice, which has no approved
    // extra interface in the area chat. The single 'all' step is handled
    // above and never creates such ambiguity.
    if(tied.length>1 &&
       tied.some(p=>!sameRemovalConsequences(tied[0],p)))
      return {...fail('ambiguous-area-die-tie'),step,tiedPartIds:tied.map(p=>p.id)};
    removed.push(...remaining.splice(index,1));
  }
  const kept=new Set(remaining.map(p=>p.id));
  return {ok:true,includedPartIds:parts.filter(p=>kept.has(p.id)).map(p=>p.id),
    excludedPartIds:removed.map(p=>p.id),custom:removal.custom};
}
