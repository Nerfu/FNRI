/**
 * Declarative, card-owned damage-die removal for an area attack.
 * Only the current values of evaluated parts are considered (including rerolls):
 * this never rolls new dice,
 * writes chat documents, mutates a target, or changes the attack degree.
 * Equivalent ties use stable source order. Unequal typed/propertied ties
 * are left unresolved for GM correction or manual HP application.
 */
import {ATTACK_DEGREES} from '../rolls/attack-core.mjs';

const STEPS=new Set(['lowest','highest','all']);
const fail=reason=>({ok:false,reason});

/** Equal results require a choice only if their damage type or traits differ. */
function sameRemovalConsequences(a,b){
  const normalize=v=>String(v??'').trim().toLocaleLowerCase('ru');
  const traits=p=>JSON.stringify([...new Set((p.traits??[]).map(normalize))].sort());
  return normalize(a.damageType)===normalize(b.damageType)&&traits(a)===traits(b);
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
export function selectAreaDamageParts(parts,degree,custom=null,{immunePartIds=[],choices=[]}={}){
  if(!Array.isArray(parts)||parts.some(p=>!p||typeof p.id!=='string'||
    typeof p.value!=='number'||!Number.isFinite(p.value)||p.value<0))
    return fail('invalid-area-parts');
  if(new Set(parts.map(p=>p.id)).size!==parts.length)return fail('duplicate-area-part-id');
  const removal=areaRemovalSteps(degree,parts.length,custom);
  if(!removal.ok)return removal;
  const immune=new Set(immunePartIds);
  const remaining=parts.filter(part=>!immune.has(part.id));
  const removed=[],decisions=[];
  for(const [stepIndex,step] of removal.steps.entries()){
    if(step==='all'){removed.push(...remaining.splice(0));break;}
    if(!remaining.length)break;
    let index=0;
    for(let i=1;i<remaining.length;i++){
      if(step==='lowest'?remaining[i].value<remaining[index].value:
        remaining[i].value>remaining[index].value)index=i;
    }
    const tied=remaining.filter(p=>p.value===remaining[index].value);
    const chosen=choices[stepIndex];
    const ambiguous=tied.length>1&&tied.some(p=>!sameRemovalConsequences(tied[0],p));
    if(chosen!=null){
      index=remaining.findIndex(p=>p.id===chosen);
      if(index<0){
        decisions.push({stepIndex,step,currentId:null,candidates:remaining.map(p=>p.id)});
        return {...fail('invalid-area-choice'),decisions};
      }
    }
    const unresolved=chosen==null&&ambiguous;
    decisions.push({stepIndex,step,currentId:unresolved?null:remaining[index].id,
      candidates:(unresolved?tied:remaining).map(p=>p.id)});
    if(unresolved)return {...fail('ambiguous-area-die-tie'),step,tiedPartIds:tied.map(p=>p.id),decisions};
    removed.push(...remaining.splice(index,1));
  }
  const kept=new Set(remaining.map(p=>p.id));
  return {ok:true,includedPartIds:parts.filter(p=>kept.has(p.id)).map(p=>p.id),
    excludedPartIds:removed.map(p=>p.id),custom:removal.custom,decisions};
}
