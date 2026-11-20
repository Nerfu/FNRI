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
export function calculateDamage(card) {
  const parts=card?.parts ?? [];
  const remaining=parts.filter(p=>!p.excluded && !p.immune);
  const gross=remaining.reduce((sum,p)=>sum+nonNegative(p.value),0);
  const a=card?.adjustments ?? {};
  const penalty=nonNegative(a.penalty);
  const multiplier=card?.cancelled ? 1 :
    (card?.manualCritical === null || card?.manualCritical === undefined
      ? (card?.naturalD20 === 20 ? nonNegative(card?.naturalCritMultiplier || 2) : 1)
      : (card.manualCritical ? nonNegative(card.manualCritMultiplier || 2) : 1));
  const base=Math.max(0,gross-penalty);
  const resistance=remaining.length ? nonNegative(a.resistance) : 0;
  const vulnerability=remaining.length ? nonNegative(a.vulnerability) : 0;
  return {gross, penalty, multiplier, resistance, vulnerability,
    total:card?.cancelled ? 0 : Math.max(0,base*multiplier-resistance)+vulnerability,
    activeParts:remaining.length};
}

export function changePart(card, id, action, newValue=null) {
  const next=copy(card);
  const part=next.parts?.find(p=>p.id===id);
  if (!part) throw new Error('Damage component not found');
  const old={value:part.value,excluded:!!part.excluded};
  if (action==='exclude') part.excluded=true;
  else if (action==='restore') part.excluded=false;
  else if (action==='set' || action==='reroll') {
    if (!finite(newValue) || newValue<0 || (action==='reroll' && (part.kind!=='die' || !Number.isInteger(newValue) || newValue<1 || newValue>part.faces)))
      throw new Error('Invalid damage component value');
    part.value=newValue;
  } else throw new Error('Unknown component operation');
  return {next,old,current:{value:part.value,excluded:!!part.excluded}};
}

export function biggestDamageParts(card) {
  const live=(card?.parts ?? []).filter(p=>!p.excluded && !p.immune);
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
