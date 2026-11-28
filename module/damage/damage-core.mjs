/** Fast NRI 7.0 — isolated, serializable damage calculations. Never mutates a Roll.
 * No implicit immunities/resistances: resolved values are supplied by cards/GM.
 */
import {resolveDirectedEffectDegree,physicalAttackPartsForDegree,ferocityDamageApplies} from '../rolls/attack-core.mjs';
import {magicAttackPartsForDegree} from '../rolls/magic-attack-profile.mjs';
import {CHECK_DEFENSES} from '../rolls/attack-properties.mjs';
import {tempHpMax,planTempHpLayers} from './temporary-hp-layers.mjs';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const nonNegative = n => finite(n) ? Math.max(0, n) : 0;
export const copy = value => JSON.parse(JSON.stringify(value));

export function snapshotDamageParts(roll, definitions, {damageType='физический', properties=''}={}) {
  const terms = (roll?.dice ?? []).flatMap(d => (d.results ?? [])
    .filter(r => r.active !== false).map(r => ({faces:d.faces, value:r.result})));
  let index=0;
  const traits=String(properties ?? '').split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
  return definitions.map((def,i) => {
    let value;
    if (def.kind === 'die') {
      const result=terms[index++];
      if (!result || result.faces !== def.faces || !finite(result.value))
        throw new Error(`Roll result does not match damage component ${def.id}`);
      value=result.value * (def.sign === -1 ? -1 : 1);
    } else value=def.value;
    if (!finite(value) || (def.kind === 'die' && value === 0)) throw new Error('Invalid damage component');
    return {id:def.id ?? `part-${i}`, kind:def.sign === -1 ? 'fixed' : def.kind,
      faces:def.sign === -1 ? null : (def.faces ?? null),
      formula:def.formula, original:value, value, excluded:false,
      ...(def.profilePart ? {profilePart:def.profilePart} : {}),
      ...(def.ferocityDamage===true?{ferocityDamage:true}:{}),
      ...(def.spellDamage===true?{spellDamage:true}:{}),
      ...(def.singleTarget===true?{singleTarget:true,targetUuid:def.targetUuid??null}:{}),
      damageType:def.damageType || damageType, traits:def.partOrigin==='attackAugment' ? [] : (def.traits?.length ? [...def.traits] : [...traits]),
      source:def.source ?? null};
  });
}

/** Immunity removes a part and its traits. Defense removal and GM exclusion
 * are also exclusions. Reducing a die to zero DOES NOT remove its traits.
 */
/** Critical rules live on the attack card. 20 is the ordinary threshold,
 * but a private card may define another inclusive natural-d20 threshold.
 * Never derive it from the modified roll total. */
export function criticalDamageRule(card) {
  if(card?.noCritical===true)return {threshold:20,multiplier:1,triggered:false};
  const raw=Number(card?.criticalThreshold);
  const threshold=Number.isInteger(raw) && raw>=1 && raw<=20 ? raw : 20;
  const multiplier=Number(card?.naturalCritMultiplier ?? card?.criticalMultiplier);
  const validMultiplier=Number.isFinite(multiplier) && multiplier>1 ? multiplier : 2;
  const natural=Number(card?.naturalD20);
  return {threshold,multiplier:natural===20&&Number(card?.naturalTwentyMultiplier)>1?Math.max(validMultiplier,Number(card.naturalTwentyMultiplier)):validMultiplier,
    triggered:!CHECK_DEFENSES.includes(card?.targetDefense) &&
      Number.isInteger(natural) && natural>=threshold && natural<=20};
}

/** Explicit buttons may request normal/critical damage. Without the option,
 * preserve legacy semantics for old stored cards and their interventions. */
export function calculateDamage(card, {critical}={}) {
  const parts=card?.parts ?? [];
  const remaining=parts.filter(p=>!p.excluded && !p.immune && !p.pending);
  // GM die edits may exceed the die maximum, but cannot fall below 1.
  // A negative fixed correction is a PENALTY, never a damage die. Keep it
  // outside the surviving damage-parts sum, so it is applied after immunity
  // and defensive reductions, along with explicitly recorded penalties.
  // A part can be manually excluded by the GM, but a defense selecting the
  // biggest/smallest damage die must never select a penalty as that die.
  // Only surviving DAMAGE parts carry types and traits into resistance and
  // vulnerability. An explicit negative correction is a penalty, not a die;
  // it must not keep a damage property alive by itself. A reduced-to-zero die
  // remains a damage part and still carries its traits (Rulebook).
  const damageParts=remaining.filter(p=>finite(p.value) && p.value>=0);
  const gross=damageParts.reduce((sum,p)=>sum+p.value,0);
  const partPenalty=remaining.reduce((sum,p)=>sum+(finite(p.value)?Math.max(0,-p.value):0),0);
  const a=card?.adjustments ?? {};
  const penalty=nonNegative(a.penalty)+partPenalty;
  const criticalRule=criticalDamageRule(card);
  const multiply=typeof critical==='boolean' ? critical :
    (card?.manualCritical === null || card?.manualCritical === undefined ? criticalRule.triggered : !!card.manualCritical);
  const manualMultiplier=Number(card?.manualCritMultiplier);
  const chosenMultiplier=card?.manualCritical===true && finite(manualMultiplier) && manualMultiplier>1
    ? manualMultiplier : criticalRule.multiplier;
  const multiplier=card?.cancelled || card?.noCritical===true ? 1 : (multiply ? chosenMultiplier : 1);
  const base=Math.max(0,gross-penalty);
  const resistance=card?.damageRules?.ignoreResistance === true ? 0 : (damageParts.length ? nonNegative(a.resistance) : 0);
  const vulnerability=damageParts.length ? nonNegative(a.vulnerability) : 0;
  const beforeReduction=Math.max(0,base*multiplier-resistance)+vulnerability;
  // A2.3: decrease the FINAL physical damage once, without introducing
  // separate resistance/vulnerability pools or changing selectable dice.
  const physical=damageParts.filter(p=>['физический','physical'].includes(String(p.damageType??'').trim().toLocaleLowerCase('ru')));
  const physicalCap=physical.length===damageParts.length ? beforeReduction :
    physical.reduce((sum,p)=>sum+p.value,0)*multiplier;
  const physicalReduction=card?.cancelled || !physical.length ? 0 :
    Math.min(nonNegative(a.physicalReduction),physicalCap,beforeReduction);
  return {gross, penalty, multiplier, resistance, vulnerability,
    ...(Object.hasOwn(a,'physicalReduction')?{physicalReduction}:{}),
    total:card?.cancelled ? 0 : beforeReduction-physicalReduction,
    activeParts:damageParts.length};
}

/** Both displayed values use the same surviving components, penalties and defenses. */
export function largestDamageDieHealing(card) {
  if(card?.healLargestDamageDie!==true||card.cancelled||card.parts?.some(p=>p.pending))return null;
  return Math.max(0,...(card.parts??[]).filter(p=>['die','fixed'].includes(p.kind)&&!p.excluded&&!p.immune&&finite(p.value)&&p.value>0).map(p=>p.value));
}

export function damageChoices(card) {
  return {normal:calculateDamage(card,{critical:false}),
    critical:calculateDamage(card,{critical:true}),
    rule:criticalDamageRule(card)};
}

/** One honest total on the chat card. Critical multiplication precedes resistance
 * and vulnerability; never multiply an already mitigated normal total. */
export function damageDisplay(card) {
  const values=damageChoices(card);
  const active=card?.noCritical!==true && (card?.manualCritical===true ||
    (card?.manualCritical!==false && values.rule.triggered));
  const {normal,critical}=values;
  if(!active) return {...values,active,expression:String(normal.total)};
  if(card?.cancelled) return {...values,active,expression:'0'};
  const n=critical.multiplier;
  const close=(a,b)=>Math.abs(a-b)<1e-9;
  if(close(normal.total*n,critical.total))
    return {...values,active,expression:`${normal.total} × ${n} = ${critical.total}`};
  // More complicated defenses operate in this order: base, multiplication,
  // resistance with floor at zero, then vulnerability.
  const base=Math.max(0,critical.gross-critical.penalty);
  let expression=`${base} × ${n}`;
  if(critical.resistance) {
    expression+=` − ${critical.resistance}`;
    if(base*n<critical.resistance)expression=`max(0, ${expression})`;
  }
  if(critical.vulnerability)expression+=` + ${critical.vulnerability}`;
  if(critical.physicalReduction)expression+=` − ${critical.physicalReduction}`;
  return {...values,active,expression:`${expression} = ${critical.total}`};
}

export function changePart(card, id, action, newValue=null, {gmOverride=false}={}) {
  const next=copy(card);
  const part=next.parts?.find(p=>p.id===id);
  if (!part) throw new Error('Damage component not found');
  if(action==='reroll' && part.noReroll && !gmOverride)throw new Error('Damage component cannot be rerolled');
  const old={value:part.value,excluded:!!part.excluded,pending:!!part.pending};
  if (action==='exclude') part.excluded=true;
  else if (action==='restore') part.excluded=false;
  else if (action==='reset') {if(part.pending)throw new Error('Unrolled dice must be rolled first');part.value=part.original;part.excluded=false;}
  else if (action==='set' || action==='reroll') {
    if (!finite(newValue) || (action==='set' && part.kind==='die' && !Number.isInteger(newValue)) ||
      (action==='reroll' && (part.kind!=='die' || !Number.isInteger(newValue) || newValue<1 || newValue>part.faces)))
      throw new Error('Invalid damage component value');
    part.value=action==='set' && part.kind==='die' ? Math.max(1,newValue) : newValue;
    if(part.pending) {part.original=part.value;part.pending=false;}
    if(action==='reroll')part.excluded=false;
  } else throw new Error('Unknown component operation');
  return {next,old,current:{value:part.value,excluded:!!part.excluded,pending:!!part.pending}};
}

/** Append new GM-created components; no original component is rewritten. A die is
 * stored independently so later rerolls, exclusions and defenses address its ID.
 * Pending dice have no numeric value until a real evaluated Roll resolves them.
 */
export function appendDamageComponents(card,{kind,faces,count=1,values=[],value=0,damageType='',traits=[]}={}) {
  if(card?.version!==2 || !Array.isArray(card.parts))throw new Error('Damage snapshot is unavailable');
  if(!['die','fixed'].includes(kind))throw new Error('Unknown component kind');
  if(kind==='die' && (!Number.isInteger(faces) || faces<2 || faces>1000 ||
    !Number.isInteger(count) || count<1 || count>1000 ||
    values.some(v=>!Number.isInteger(v) || v<1 || v>faces) || (values.length!==0 && values.length!==count)))throw new Error('Invalid dice addition');
  if(kind==='fixed' && !finite(value))throw new Error('Invalid fixed addition');
  if(typeof damageType!=='string' || damageType.length>100)throw new Error('Invalid damage type');
  if(!Array.isArray(traits) || traits.length>30 ||
    traits.some(t=>typeof t!=='string' || t.length>100))throw new Error('Invalid traits');
  const next=copy(card), occupied=new Set(next.parts.map(p=>p.id));
  // Never reuse a discarded component ID: old audit entries still reference it.
  for(const entry of next.history??[]) {
    for(const id of entry.ids??[])occupied.add(id);
    for(const part of entry.changes??[])if(part.id)occupied.add(part.id);
  }
  let number=1;
  const makeId=()=>{while(occupied.has(`gm-${number}`))number++;const id=`gm-${number++}`;occupied.add(id);return id;};
  const pending=kind==='die' && values.length===0;
  const given=kind==='die' ? (pending?Array(count).fill(null):values) : [value];
  const appended=given.map(n=>({id:makeId(),kind,faces:kind==='die'?faces:null,
    formula:kind==='die'?`1d${faces}`:(n>=0?`+${n}`:String(n)),
    original:n,value:n,pending:kind==='die'&&pending,excluded:false,damageType:damageType.trim(),
    traits:traits.map(t=>t.trim()).filter(Boolean),source:'gm:roll-editor'}));
  next.parts.push(...appended);
  return {next,appended};
}

function remainingDamageParts(card) {
  return (card?.parts??[]).filter(p=>!p.excluded&&!p.immune&&!p.pending&&
    finite(p.value)&&p.value>=0);
}

export function smallestDamageParts(card) {
  const live=remainingDamageParts(card);
  if(!live.length)return [];
  const min=Math.min(...live.map(p=>nonNegative(p.value)));
  return live.filter(p=>nonNegative(p.value)===min);
}

export function biggestDamageParts(card) {
  // Damage penalties are not dice, even when the GM entered a negative
  // fixed contribution through the existing correction interface.
  const live=remainingDamageParts(card);
  if (!live.length) return [];
  const max=Math.max(...live.map(p=>nonNegative(p.value)));
  return live.filter(p=>nonNegative(p.value)===max);
}

/** Input is the target's own snapshot after immunity and all earlier defenses.
 * A positive fixed damage bonus is also a damage die under the Rulebook. */
export function coverAllyDice(card) {
  if (!card || card.cancelled || card.parts?.some(part => part.pending)) return [];
  return remainingDamageParts(card).filter(part => part.kind === 'die' ||
    part.kind === 'fixed' && part.value > 0).map(({id, formula, value, damageType, traits}) =>
    ({id, formula, value, damageType, traits:[...(traits??[])]}));
}

/** A proposal only. Keep the source Roll immutable and leave all other
 * effects with the ally. Finish the ally's ordinary damage calculation
 * from the returned snapshot, including defenses after the chosen die. */
export function planCoverAlly(card, partId) {
  const transferred = coverAllyDice(card).find(part => part.id === partId);
  if (!transferred) return null;
  const allyCard = copy(card);
  allyCard.parts.find(part => part.id === partId).excluded = true;
  return {allyCard, transferred, redirectedDamage:transferred.value};
}

export function selfDefenseOutcome({card, defenseTotal, naturalD20}={}) {
  if (!Number.isInteger(naturalD20) || naturalD20<1 || naturalD20>20 || !finite(defenseTotal))
    throw new Error('Invalid directed defense roll');
  const success=naturalD20!==1 && (naturalD20===20 || (finite(card?.attackTotal) && defenseTotal>=card.attackTotal));
  const cancelled=success && naturalD20===20 && card?.naturalD20!==20;
  return {success,cancelled,choices:success&&!cancelled?(card?.defenseRemovalOrder==='lowest'?smallestDamageParts(card):biggestDamageParts(card)):[],
    effectDegree:success ? resolveDirectedEffectDegree({attackDegree:card.effectDegree || card.degree,
      successfulDefenses:1,fullyCancelled:cancelled}).effectDegree : card.effectDegree||card.degree};
}

/** Counteraction changes the check degree itself. Keep evaluated parts in the
 * snapshot and deactivate the profile portions lost at the new degree. */
export function counteractionOutcome({card, defenseTotal, naturalD20} = {}) {
  if (!CHECK_DEFENSES.includes(card?.targetDefense) || !finite(defenseTotal) ||
      !Number.isInteger(naturalD20) || naturalD20 < 1 || naturalD20 > 20) {
    throw Error('Counteraction requires a check against a defense characteristic');
  }
  const success = naturalD20 !== 1 &&
    (naturalD20 === 20 || (finite(card.attackTotal) && defenseTotal >= card.attackTotal));
  const degree = success ? resolveDirectedEffectDegree({
    attackDegree:card.degree,successfulDefenses:1,fullyCancelled:naturalD20 === 20
  }).effectDegree : card.degree;
  if (!success) return {success,degree,next:copy(card)};
  return {success,degree,next:damageAtReducedDegree(card,degree)};
}

/** Reuse evaluated damage components for an explicitly reduced degree. */
export function damageAtReducedDegree(card,degree) {
  const next=copy(card);
  if(card.ferocity&&card.postDefenseDamage?.some(o=>o.ferocity)&&degree==='partial')degree='failure';
  const retained = card.profileKind==='magic' ? magicAttackPartsForDegree(card.profile,degree) :
    physicalAttackPartsForDegree(card.profile,degree);
  if (degree !== 'failure' && !retained.ok) throw Error('Missing damage profile for counteraction');
  const slots = new Set(retained.ok ? retained.parts.map(part => part.id) : []);
  for (const part of next.parts ?? []) {
    const slot = part.profilePart ?? (['A','B','C'].includes(part.id) ||
      (card.profileKind==='magic' && /^M[1-9]\d*$/.test(part.id)) ? part.id : null);
    if ((slot && !slots.has(slot)) || (part.ferocityDamage&&!ferocityDamageApplies(degree))) part.excluded = true;
  }
  // An explicitly authored lower degree can replace components. A fixed
  // component needs no roll. A newly required die needs manual resolution.
  if ((card.profile?.degrees || card.profileKind === 'magic') && retained.ok) {
    const missing = retained.parts.filter(def => !next.parts?.some(part => (part.profilePart ?? part.id) === def.id));
    if (missing.some(def => def.kind === 'die')) throw Error('Reduced degree requires an unevaluated damage die');
    const added = snapshotDamageParts(null, missing.map(def => ({...def,profilePart:def.id})), card);
    if (added.length) (next.parts ??= []).push(...added);
  }
  next.originalDegree = card.originalDegree ?? card.degree;
  next.degree = degree;
  next.effectDegree = degree;
  next.cancelled = Boolean(card.cancelled || degree === 'failure');
  return next;
}

/** For an increase of an evaluated, unmodified profile, retain all existing
 * components. A non-nested profile needs manual resolution, not a reroll. */
export function damageDegreeIncreaseParts(card,amount=1) {
  const from=['failure','partial','success','great'].indexOf(card?.degree);
  if(from<0||from===3||!Number.isInteger(amount)||amount<1||!Number.isInteger(card.naturalD20)||card.naturalD20<=1||card.naturalD20>20||card.areaAttack||card.postDefenseOrigin||card.intervention||card.ferocity||card.cancelled||card.effectDegree!==card.degree||card.parts?.some(p=>p.pending||p.excluded||p.immune))return null;
  const after=['failure','partial','success','great'][Math.min(3,from+amount)];
  const profile=card.profileKind==='magic'?magicAttackPartsForDegree:physicalAttackPartsForDegree;
  const previous=profile(card.profile,card.degree),next=profile(card.profile,after);
  if(!previous.ok||!next.ok||!Array.isArray(card.parts))return null;
  const match=(part,definition)=>definition&&part?.kind===definition.kind&&(part.kind==='die'?part.faces===definition.faces:part.original===definition.value);
  const bySlot=new Map();
  for(const part of card.parts){if(!part.profilePart)continue;if(bySlot.has(part.profilePart))return null;bySlot.set(part.profilePart,part);}
  if(bySlot.size!==previous.parts.length||previous.parts.some(d=>!match(bySlot.get(d.id),d)))return null;
  if(previous.parts.some(d=>!match(bySlot.get(d.id),next.parts.find(n=>n.id===d.id))))return null;
  const missing=next.parts.filter(d=>!bySlot.has(d.id));
  if(missing.some(d=>card.parts.some(p=>p.id===d.id)))return null;
  return {after,definitions:missing.map(d=>({...d,profilePart:d.id}))};
}

export function planHpChange(hp,amount,kind='damage',layerOptions={}) {
  const current=nonNegative(hp?.current);
  const max=finite(hp?.max)?nonNegative(hp.max):current;
  const temp=nonNegative(hp?.temp);
  // Actor HP fields are integers; never let fractional damage make the
  // layer ledger disagree with the scalar data model.
  const n=Math.trunc(nonNegative(amount));
  let after={current:Math.min(max,current),temp};
  let damageThroughTemp=0;
  if (kind==='damage') {
    const absorbed=layerOptions.ignoreTempHp===true?0:Math.min(temp,n);
    damageThroughTemp=n-absorbed;
    after={temp:temp-absorbed,current:Math.min(max,Math.max(0,current-damageThroughTemp))};
  } else if (kind==='heal') after.current=Math.min(max,current+n);
  else if (kind==='temp') after.temp=Math.max(temp,n);
  else throw new Error('Invalid HP change kind');
  let layerBefore=null,layerAfter=null;
  if(hp?.tempHpState?.version===1){
    layerBefore=hp.tempHpState;
    if(tempHpMax(layerBefore)!==temp)throw Error('Temporary HP aggregate does not match its layers');
    const layers=planTempHpLayers(layerBefore,n,
      kind==='damage' && layerOptions.ignoreTempHp!==true?'damage':kind==='temp'?'grant':'keep',layerOptions);
    layerAfter=layers.after;
    after.temp=layers.to;
  }
  if(kind==='damage'&&layerOptions.preventZero===true&&current>0&&after.current===0&&max>=1)after.current=1;
  return {kind,before:{current,temp},after,damageThroughTemp,
    ...(layerAfter?{tempHpState:layerAfter,beforeTempHpState:layerBefore}:{}),
    delta:{current:after.current-current,temp:after.temp-temp},requested:n,
    actual:kind==='damage' ? current-after.current+temp-after.temp :
      kind==='heal' ? after.current-current : after.temp-temp};
}

export function reverseHpChange(now, report) {
  const current=nonNegative(now?.current),temp=nonNegative(now?.temp);
  const max=finite(now?.max)?nonNegative(now.max):current;
  const d=report?.delta;
  if (!finite(d?.current) || !finite(d?.temp)) throw new Error('Missing saved HP delta');
  return {changedSince:current!==report.after.current || temp!==report.after.temp,
    current:Math.min(max,Math.max(0,current-d.current)),
    temp:Math.max(0,temp-d.temp)};
}
