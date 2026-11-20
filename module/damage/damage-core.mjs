/** Fast NRI 7.0 — isolated, serializable damage calculations. Never mutates a Roll.
 * No implicit immunities/resistances: resolved values are supplied by cards/GM.
 */
import {resolveDirectedEffectDegree} from '../rolls/attack-core.mjs';
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
      value=result.value;
    } else value=def.value;
    if (!finite(value) || value < 0) throw new Error('Invalid damage component');
    return {id:def.id ?? `part-${i}`, kind:def.kind, faces:def.faces ?? null,
      formula:def.formula, original:value, value, excluded:false,
      damageType, traits:[...traits], source:def.source ?? null};
  });
}

/** Immunity removes a part and its traits. Defense removal and GM exclusion
 * are also exclusions. Reducing a die to zero DOES NOT remove its traits.
 */
/** Critical rules live on the attack card. 20 is the ordinary threshold,
 * but a private card may define another inclusive natural-d20 threshold.
 * Never derive it from the modified roll total. */
export function criticalDamageRule(card) {
  const raw=Number(card?.criticalThreshold);
  const threshold=Number.isInteger(raw) && raw>=1 && raw<=20 ? raw : 20;
  const multiplier=Number(card?.naturalCritMultiplier ?? card?.criticalMultiplier);
  const validMultiplier=Number.isFinite(multiplier) && multiplier>1 ? multiplier : 2;
  const natural=Number(card?.naturalD20);
  return {threshold,multiplier:validMultiplier,
    triggered:Number.isInteger(natural) && natural>=threshold && natural<=20};
}

/** Explicit buttons may request normal/critical damage. Without the option,
 * preserve legacy semantics for old stored cards and their interventions. */
export function calculateDamage(card, {critical}={}) {
  const parts=card?.parts ?? [];
  const remaining=parts.filter(p=>!p.excluded && !p.immune && !p.pending);
  // GM die edits may exceed the die maximum, but cannot fall below 1.
  // Fixed contributions may be signed; the net damage is floored at zero.
  const gross=remaining.reduce((sum,p)=>sum+(finite(p.value)?p.value:0),0);
  const a=card?.adjustments ?? {};
  const penalty=nonNegative(a.penalty);
  const criticalRule=criticalDamageRule(card);
  const multiply=typeof critical==='boolean' ? critical :
    (card?.manualCritical === null || card?.manualCritical === undefined ? criticalRule.triggered : !!card.manualCritical);
  const manualMultiplier=Number(card?.manualCritMultiplier);
  const chosenMultiplier=card?.manualCritical===true && finite(manualMultiplier) && manualMultiplier>1
    ? manualMultiplier : criticalRule.multiplier;
  const multiplier=card?.cancelled ? 1 : (multiply ? chosenMultiplier : 1);
  const base=Math.max(0,gross-penalty);
  const resistance=remaining.length ? nonNegative(a.resistance) : 0;
  const vulnerability=remaining.length ? nonNegative(a.vulnerability) : 0;
  return {gross, penalty, multiplier, resistance, vulnerability,
    total:card?.cancelled ? 0 : Math.max(0,base*multiplier-resistance)+vulnerability,
    activeParts:remaining.length};
}

/** Both displayed values use the same surviving components, penalties and defenses. */
export function damageChoices(card) {
  return {normal:calculateDamage(card,{critical:false}),
    critical:calculateDamage(card,{critical:true}),
    rule:criticalDamageRule(card)};
}

/** One honest total on the chat card. Critical multiplication precedes resistance
 * and vulnerability; never multiply an already mitigated normal total. */
export function damageDisplay(card) {
  const values=damageChoices(card);
  const active=card?.manualCritical===true ||
    (card?.manualCritical!==false && values.rule.triggered);
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
  return {...values,active,expression:`${expression} = ${critical.total}`};
}

export function changePart(card, id, action, newValue=null) {
  const next=copy(card);
  const part=next.parts?.find(p=>p.id===id);
  if (!part) throw new Error('Damage component not found');
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

export function biggestDamageParts(card) {
  const live=(card?.parts ?? []).filter(p=>!p.excluded && !p.immune && !p.pending);
  if (!live.length) return [];
  const max=Math.max(...live.map(p=>nonNegative(p.value)));
  return live.filter(p=>nonNegative(p.value)===max);
}

export function selfDefenseOutcome({card, defenseTotal, naturalD20}={}) {
  if (!Number.isInteger(naturalD20) || naturalD20<1 || naturalD20>20 || !finite(defenseTotal))
    throw new Error('Invalid directed defense roll');
  const success=naturalD20!==1 && (naturalD20===20 || (finite(card?.attackTotal) && defenseTotal>=card.attackTotal));
  const cancelled=success && naturalD20===20 && card?.naturalD20!==20;
  return {success,cancelled,choices:success&&!cancelled?biggestDamageParts(card):[],
    effectDegree:success ? resolveDirectedEffectDegree({attackDegree:card.effectDegree || card.degree,
      successfulDefenses:1,fullyCancelled:cancelled}).effectDegree : card.effectDegree||card.degree};
}

export function planHpChange(hp,amount,kind='damage') {
  const current=nonNegative(hp?.current);
  const max=Math.max(current,nonNegative(hp?.max));
  const temp=nonNegative(hp?.temp);
  const n=nonNegative(amount);
  let after={current,temp};
  if (kind==='damage') {
    const absorbed=Math.min(temp,n);
    after={temp:temp-absorbed,current:Math.max(0,current-(n-absorbed))};
  } else if (kind==='heal') after.current=Math.min(max,current+n);
  else if (kind==='temp') after.temp=Math.max(temp,n);
  else throw new Error('Invalid HP change kind');
  return {kind,before:{current,temp},after,
    delta:{current:after.current-current,temp:after.temp-temp},requested:n,
    actual:kind==='damage' ? current-after.current+temp-after.temp :
      kind==='heal' ? after.current-current : after.temp-temp};
}

export function reverseHpChange(now, report) {
  const current=nonNegative(now?.current),temp=nonNegative(now?.temp);
  const max=Math.max(current,nonNegative(now?.max));
  const d=report?.delta;
  if (!finite(d?.current) || !finite(d?.temp)) throw new Error('Missing saved HP delta');
  return {changedSince:current!==report.after.current || temp!==report.after.temp,
    current:Math.min(max,Math.max(0,current-d.current)),
    temp:Math.max(0,temp-d.temp)};
}
