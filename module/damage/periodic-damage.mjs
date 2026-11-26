import {activeConditionEffect} from '../effects/active-effect.mjs';
/**
 * Fast NRI 7.0 — Stage 3C.1/3C.2: periodic damage data and pure calculations.
 * Every native Actor ActiveEffect is a distinct instance; neither its title,
 * icon nor its Item origin confers traits or numerical defenses.
 *
 * This module does NOT apply HP, run turn hooks or roll termination checks.
 */
export const PERIODIC_SCOPE = 'fast-nri-v14';
export const PERIODIC_KEY = 'periodicDamage';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const nonnegative = value => Number.isSafeInteger(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const traitKey = value => String(value ?? '').trim().toLocaleLowerCase('ru');
const UNIVERSAL = new Set(['универсальная', 'универсальный', 'universal', 'all', '*']);
const PHYSICAL = new Set(['физический', 'physical']);
const MAGICAL = new Set(['магический', 'magical']);

export function periodicTraits(raw) {
  if (!Array.isArray(raw)) return [];
  const used = new Set();
  return raw.filter(value => typeof value === 'string')
    .map(value => value.trim()).filter(value => {
      const key = traitKey(value);
      if (!key || used.has(key)) return false;
      used.add(key);
      return true;
    });
}

/** A missing value or primary trait prevents *automatic* processing; it does
 * not prevent storing, editing or manually resolving the ActiveEffect. */
export function readPeriodicData(effect) {
  const raw = object(effect?.flags?.[PERIODIC_SCOPE]?.[PERIODIC_KEY]);
  const value = nonnegative(raw.value) ? raw.value : null;
  const traits = periodicTraits(raw.traits);
  const primary = traits.some(trait => PHYSICAL.has(traitKey(trait)) || MAGICAL.has(traitKey(trait)));
  const durationValid = raw.durationTicks == null ||
    (Number.isSafeInteger(raw.durationTicks) && raw.durationTicks >= 1);
  const durationTicks = durationValid ? raw.durationTicks ?? null : null;
  const end = object(raw.end);
  return {
    version: raw.version === 1 ? 1 : null,
    value, traits, durationTicks,
    sourceMessageId: typeof raw.sourceMessageId === 'string' ? raw.sourceMessageId : null,
    ...(raw.privateToGm===true?{privateToGm:true}:{}),
    applicationKey: typeof raw.applicationKey === 'string' ? raw.applicationKey : null,
    end: {
      skipCheck: end.skipCheck === true,
      bonuses: Array.isArray(end.bonuses) ? end.bonuses.filter(nonnegative) : [],
      penalties: Array.isArray(end.penalties) ? end.penalties.filter(nonnegative) : []
    },
    eligible: raw.version === 1 && value !== null && primary && durationValid,
    needsManualInput: raw.version === 1 && (value === null || !primary || !durationValid)
  };
}

export function isActivePeriodicEffect(effect) {
  return effect?.parent?.documentName === 'Actor' && effect.id &&
    activeConditionEffect(effect) &&
    readPeriodicData(effect).version === 1;
}

/** A character can have any number of independent, identically named effects.
 * Earlier creation wins ties, then stable document ID resolves same-ms ties. */
export function orderedPeriodicEffects(actor) {
  return [...(actor?.effects?.contents ?? [])]
    .filter(isActivePeriodicEffect)
    .sort((a,b) => {
      const x=readPeriodicData(a).value, y=readPeriodicData(b).value;
      if (x !== y) return (y ?? -1)-(x ?? -1);
      const ax=Number(a._stats?.createdTime ?? a.flags?.[PERIODIC_SCOPE]?.[PERIODIC_KEY]?.createdAt ?? 0);
      const bx=Number(b._stats?.createdTime ?? b.flags?.[PERIODIC_SCOPE]?.[PERIODIC_KEY]?.createdAt ?? 0);
      return ax-bx || String(a.id).localeCompare(String(b.id));
    });
}

/** Explicit defensive data only. The absence of a declared defense means 0,
 * not a guessed resistance based on ancestry, names or description text.
 * Sources may supply `immunities:[trait]`, `resistances:[{trait,value}]`,
 * `vulnerabilities:[{trait,value}]`. Separate positive values use MAX, not SUM.
 */
function equippedItemIds(actor) {
  // Card-authored equipped defenses only: no inference from an Item name,
  // armor category, possession or arbitrary inventory membership.
  const equipment=object(actor?.system?.equipment);
  const slots=object(actor?.system?.equipmentSlots);
  return new Set([...Object.values(equipment),...Object.values(slots).map(slot=>slot?.itemId)]
    .filter(id=>typeof id==='string' && id.length>0));
}

/** Diagnostic/read-only enumeration of explicitly authored defense sources.
 * Future class/race/role cards can use `activation:'passive'`; equipment cards
 * can request `activation:'equipped'` only when worn/held in an Actor slot.
 * Inactive/suppressed effects contribute nothing. No new role/permission type.
 */
export function inspectDamageDefenseSources(actor) {
  const sources=[];
  const own = actor?.flags?.[PERIODIC_SCOPE]?.damageDefenses;
  if (own && typeof own === 'object') sources.push({kind:'actor-flag',id:actor?.uuid??null,rule:own});
  const effects = actor?.allApplicableEffects?.() ?? actor?.effects?.contents ?? [];
  const seen=new Set();
  for (const effect of effects) {
    const id=effect?.uuid??effect?.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    if (!activeConditionEffect(effect)) continue;
    const data = effect?.flags?.[PERIODIC_SCOPE]?.damageDefenses;
    if (data && typeof data === 'object')
      sources.push({kind:'active-effect',id:id??null,rule:data});
  }
  const equipped=equippedItemIds(actor);
  for (const item of actor?.items?.contents ?? []) {
    const rule = item?.system?.mechanics?.damageDefenses;
    if (!rule || typeof rule!=='object') continue;
    if (rule.activation==='passive' || rule.activation==='equipped' && equipped.has(item.id))
      sources.push({kind:'item',id:item.uuid??item.id??null,rule});
  }
  return sources;
}

export function declaredPeriodicDefenses(actor) {
  return inspectDamageDefenseSources(actor).map(source=>source.rule);
}

/** The same explicit rules as periodic damage, but per surviving *part* of an
 * instantaneous damage card. This is a preview for the existing GM editor:
 * it never silently edits a Roll/card, and cannot replace pending dice or
 * an unclassified component with an invented damage type.
 */
export function previewDeclaredDamageDefenses(actor,card) {
  const defenses=declaredPeriodicDefenses(actor);
  const active=(card?.parts??[]).filter(part=>!part?.excluded && !part?.immune);
  const pending=active.filter(part=>part?.pending);
  const parts=active.filter(part=>!part?.pending &&
    typeof part?.value==='number' && Number.isFinite(part.value) && part.value>=0);
  const invalid=active.filter(part=>!part?.pending &&
    (typeof part?.value!=='number' || !Number.isFinite(part.value)));
  const incomplete=invalid.length>0 || parts.some(part=>!PHYSICAL.has(traitKey(part.damageType)) &&
    !MAGICAL.has(traitKey(part.damageType)));
  const immunities=entries(defenses,'immunities');
  const removed=[];
  const surviving=[];
  for (const part of parts) {
    const traits=new Set(periodicTraits([part.damageType,...(Array.isArray(part.traits)?part.traits:[])]).map(traitKey));
    const immune=immunities.some(row=>matches(
      typeof row==='string'?row:object(row).trait??object(row).property,traits));
    (immune?removed:surviving).push(part.id);
  }
  const survivingParts=parts.filter(part=>surviving.includes(part.id));
  const traits=new Set(survivingParts.flatMap(part=>
    periodicTraits([part.damageType,...(Array.isArray(part.traits)?part.traits:[])]).map(traitKey)));
  return {
    complete:pending.length===0 && !incomplete,
    pendingPartIds:pending.map(part=>part.id),
    immunePartIds:removed,survivingPartIds:surviving,
    resistance:survivingParts.length?maxMatching(entries(defenses,'resistances'),traits):0,
    vulnerability:survivingParts.length?maxMatching(entries(defenses,'vulnerabilities'),traits):0,
    sourceCount:defenses.length,
    // Existing manual adjustments and an individual defense's die removal are
    // not combined into this preview to avoid double-applying either of them.
    applied:false
  };
}

function entries(sources, key) {
  return sources.flatMap(source => Array.isArray(source?.[key]) ? source[key] : []);
}
function matches(trait, traits) {
  const key = traitKey(trait);
  return !!key && (UNIVERSAL.has(key) || traits.has(key));
}
function maxMatching(sourceEntries, traits) {
  return sourceEntries.reduce((result, row) => {
    const item = object(row);
    return matches(item.trait ?? item.property, traits) && nonnegative(item.value)
      ? Math.max(result,item.value) : result;
  }, 0);
}

/** Reusable rules engine. Shields/interventions and critical multiplication
 * do NOT apply to periodic damage, and it never changes its saved base value. */
export function calculatePeriodicTick(data, defenses = []) {
  const value = data?.value;
  if (!nonnegative(value)) return {resolved:false,reason:'missing-value',total:null};
  const list = periodicTraits(data.traits);
  const keys = new Set(list.map(traitKey));
  const primary = [...keys].some(x=>PHYSICAL.has(x)||MAGICAL.has(x));
  if (!primary) return {resolved:false,reason:'missing-damage-type',total:null};
  const source = Array.isArray(defenses) ? defenses : [defenses];
  const immune = entries(source,'immunities').some(row =>
    matches(typeof row === 'string' ? row : object(row).trait ?? object(row).property,keys));
  if (immune) return {resolved:true,immune:true,reason:'immunity',value,traits:list,
    resistance:0,vulnerability:0,total:0};
  const resistance=maxMatching(entries(source,'resistances'),keys);
  const vulnerability=maxMatching(entries(source,'vulnerabilities'),keys);
  // The rulebook applies one combined expression, then checks whether it is positive.
  // Clamping before vulnerability would incorrectly revive a fully resisted hit.
  const total=Math.max(0,value-resistance+vulnerability);
  return {resolved:true,immune:false,reason:total>0?'damage':'zero',value,traits:list,
    resistance,vulnerability,total};
}

/** The temporary HP bucket is deliberately untouched. A positive hit against
 * an Actor already at 0 HP remains significant for a future death-counter
 * operation even if the numerical HP difference is zero. */
export function planPeriodicHp(hp, amount) {
  if (!nonnegative(amount)) throw Error('Invalid periodic damage');
  const before = {
    current:nonnegative(hp?.current) ? hp.current : 0,
    temp:nonnegative(hp?.temp) ? hp.temp : 0
  };
  const after = {current:Math.max(0,before.current-amount),temp:before.temp};
  return {before,after,requested:amount,actual:before.current-after.current,
    reachedZero:amount>0 && before.current>0 && after.current===0,
    affectsDeathCounter:amount>0 && after.current===0};
}

/** Do not roll yet; a later end-turn stage will evaluate the exact d20 roll.
 * The completion rule is DC 11, without special 1/20 or success degrees. */
export function periodicEndPlan(data, processedCount) {
  if (!integer(processedCount)) throw Error('Invalid processed count');
  const limit=data?.durationTicks;
  if (limit != null && (!Number.isSafeInteger(limit) || limit<1)) throw Error('Invalid periodic duration');
  const durationEnded=limit != null && processedCount >= limit;
  const end=object(data?.end);
  const bonuses=Array.isArray(end.bonuses)?end.bonuses.filter(nonnegative):[];
  const penalties=Array.isArray(end.penalties)?end.penalties.filter(nonnegative):[];
  const modifier=(bonuses.length?Math.max(...bonuses):0)-(penalties.length?Math.max(...penalties):0);
  return {durationEnded,needsCheck:!durationEnded && end.skipCheck !== true,
    dc:11,modifier};
}
