import {rhythmBonus} from '../data/classes.mjs';
import {activeConditionEffect} from '../effects/active-effect.mjs';
import {defenseFormationForActor} from '../spatial/formation.mjs';
import {isFrightened,isOffGuard} from '../effects/condition-calculations.mjs';
import {specializationEntries,preparedSpecializationEntry} from '../data/specializations.mjs';
import {cardContributionEntry,buildRollContributionCatalog,ruleComponents,nonStackingSelections,effectiveHindrance,roleContributionEntry} from './roll-contributions.mjs';
import {weaponTraitEntry,weaponTraitOptions} from '../equipment/weapon-traits.mjs';
import {abilityAccountingStatus,finishCardAccounting} from '../data/ability-accounting.mjs';
import {attackAugmentEntries} from './attack-augmentations.mjs';
import {attackSituationalEntries} from './attack-situational.mjs';
import {targetHindranceEntries} from './attack-hindrance.mjs';
import {isAreaAttack} from './attack-properties.mjs';
/**
 * Per-roll ActiveEffect preparation. Native effects already present in prepared
 * Actor data are filtered on an ephemeral Actor clone, never by mutating a
 * persisted Actor or subtracting guesses from its prepared statistics.
 *
 * Card-defined `flags.fast-nri-v14.rollInfluence` is OPTIONAL:
 * { kinds:['skill'|'attack'|'ability'|'intervention'], skillId?:string,
 *   defenseStat?:string, modifier?:number, replace?:{from:string,to:string},
 *   onUse?:'none'|'remove'|'disable' }
 * An effect without explicit scope never becomes a universal modifier.
 */
const SCOPE = 'fast-nri-v14';
const pr=key=>game.i18n.localize(`FASTNRI.Preroll.${key}`);
const KINDS = new Set(['skill', 'attack', 'ability', 'intervention', 'damage', 'maneuver', 'heal']);
const USE = new Set(['none', 'remove', 'disable']);
const pendingUse = new WeakSet();
const safe = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function effectsOf(actor) {
  if (!actor) return [];
  if (typeof actor.allApplicableEffects === 'function') return [...actor.allApplicableEffects()];
  return [...(actor.effects?.contents ?? actor.effects ?? []),
    ...(actor.items?.contents ?? actor.items ?? []).flatMap(item => item.effects?.contents ?? [])];
}

function embeddedEffectsOf(actor) {
  const actorEffects = actor?.effects?.contents ?? [...(actor?.effects ?? [])];
  const items = actor?.items?.contents ?? [...(actor?.items ?? [])];
  return [...actorEffects, ...items.flatMap(item =>
    item.effects?.contents ?? [...(item.effects ?? [])])];
}

function usedInFormula(path, expression = '') {
  if (!path.startsWith('system.')) return false;
  // Native roll data can expose @foo or @system.foo paths, depending on the
  // Actor implementation. This only discovers dependencies, never evaluates JS.
  const raw = path.slice('system.'.length);
  return [raw, path].some(name => expression.includes(`@${name}`));
}

function nativeChangeMatches(change, { kind, skillId = null, defenseStat = null, formula = '' } = {}) {
  const key = String(change?.key ?? '');
  if (kind === 'skill' && skillId &&
      (key === `system.skills.${skillId}.modifier` || key === `system.skills.${skillId}.dice`)) return true;
  if (kind === 'attack' && ['system.combatDie', 'system.attackModifier'].includes(key)) return true;
  if (kind === 'maneuver' && (['system.combatDie','system.attackModifier'].includes(key) ||
      key === 'system.skills.core_athletics.dice' || key === 'system.skills.core_athletics.modifier')) return true;
  if (kind === 'intervention' &&
      (key === `system.defenses.${defenseStat}` || key === 'system.combatDie' || key === 'system.attackModifier')) return true;
  return usedInFormula(key, formula);
}

export function nativeEffectMatches(effect, params = {}) {
  const changes = effect?.system?.changes ?? [];
  return Array.isArray(changes) && changes.some(change => nativeChangeMatches(change, params));
}

function configuredRule(effect, {kind, skillId, defenseStat}) {
  const rule = effect?.flags?.[SCOPE]?.rollInfluence;
  if (!rule || !Array.isArray(rule.kinds) || !rule.kinds.includes(kind)) return null;
  if (rule.skillId && rule.skillId !== skillId) return null;
  if (rule.defenseStat && rule.defenseStat !== defenseStat) return null;
  const rawModifier = String(rule.modifier ?? '').trim().replace(/\s+/g,'');
  const finiteModifier = /^[+-]?(?:(?:\d+(?:\.\d+)?|\.\d+)|(?:[1-9]\d*)?d[1-9]\d*)$/i.test(rawModifier)
    ? rawModifier : null;
  const replace = rule.replace;
  const replacement = replace && typeof replace.from === 'string' && typeof replace.to === 'string' &&
    /^\d*d\d+$/i.test(replace.from.trim()) && /^\d*d\d+$/i.test(replace.to.trim()) ?
      {from:replace.from.trim(), to:replace.to.trim()} : null;
  return {modifier:finiteModifier, replacement, onUse:USE.has(rule.onUse) ? rule.onUse : 'none'};
}

/** Discover only effects whose influence on THIS kind of roll can be proven. */
export function applicableRollEffects(actor, params = {}) {
  if (!actor || !KINDS.has(params.kind)) return [];
  return effectsOf(actor).filter(activeConditionEffect)
    .map(effect => {
      const allNativeChanges = effect.system?.changes ?? [];
      const nativeChanges = Array.isArray(allNativeChanges) ? allNativeChanges
        .map((change,index) => ({change,index}))
        .filter(({change}) => nativeChangeMatches(change,params))
        .map(({change,index}) => ({id:`native-${index}`,index,kind:'native',
          key:String(change.key ?? ''),value:String(change.value ?? ''),
          type:change.type ?? change.mode ?? null})) : [];
      const native = nativeChanges.length > 0;
      const rule = configuredRule(effect, params);
      const extraParts=ruleComponents(effect.flags?.[SCOPE]?.rollContributions ?? [],params);
      if (!native && !rule && !extraParts.length) return null;
      const parts = [...nativeChanges, ...extraParts];
      if (rule?.modifier !== null && rule?.modifier !== undefined)
        parts.push({id:'modifier',kind:'modifier',value:rule.modifier});
      if (rule?.replacement) parts.push({id:'replacement',kind:'replacement',...rule.replacement});
      // A card may define a scoped action with consumption but no numeric bonus.
      if (!parts.length && rule) parts.push({id:'activation',kind:'activation'});
      return {uuid:String(effect.uuid ?? ''), sourceType:'effect',sourceUuid:String(effect.uuid ?? ''), id:effect.id, effect,
        name:String(effect.name ?? pr('effect')), native, nativeChanges, parts,
        modifier:rule?.modifier ?? null,
        replacement:rule?.replacement ?? null, onUse:rule?.onUse ?? 'none',
        actorOwned:effect.parent?.documentName === 'Actor'};
    }).filter(entry => entry && entry.uuid);
}

// The standard attack builders identify the combat die explicitly. Do not guess
// which die is the combat die in arbitrary custom attack formulas.
function combatDieStep(actor,formula) {
  const faces=Number(/^(?:1)?d(4|6|8|10|12)$/i.exec(String(actor?.system?.combatDie??''))?.[1]);
  if(!faces || faces===12 || String(formula).replace(/\s+/g,'')!==`1d20+1d${faces}`)return null;
  return {from:`1d${faces}`,to:`1d${faces+2}`};
}
function fixedCombatDieStep(actor,formula) {
  const faces=Number(/^(?:1)?d(4|6|8|10|12)$/i.exec(String(actor?.system?.combatDie??''))?.[1]);
  if(!faces || String(formula).replace(/\s+/g,'')!==`1d20+1d${faces}`)return null;
  return {from:`1d${faces}`,to:'1d12'};
}
function ferocityEntry(actor,params) {
  if(params.kind!=='attack'||!params.usesCombatDie)return null;
  const step=fixedCombatDieStep(actor,params.formula);
  if(!step)return null;
  const item=(actor?.items?.contents??[]).find(item=>item.type==='ability' && item.uuid &&
    item.system?.mechanics?.attackCombatDieOverride===12 && item.system?.mechanics?.partialAttackFails===true &&
    (item.system?.mechanics?.successDamageDie===6 || item.system?.mechanics?.ferocityAfterDefenses===true));
  if(item?.system?.mechanics?.ferocityAfterDefenses===true && (params.attackKind!=='melee'||isAreaAttack(params.attackProperties)||(params.declaredTargets?.length??0)>1))return null;
  if(!item)return null;
  const status=abilityAccountingStatus(actor,item);
  const warning=status?.remaining===0?game.i18n.localize('FASTNRI.GameReroll.exhausted'):null;
  const note=!warning && status?.remaining!=null?game.i18n.localize('FASTNRI.AbilityChat.dailyRemaining').replace('{remaining}',String(status.remaining)):null;
  return {uuid:`ferocity:${item.uuid}`,sourceUuid:item.uuid,sourceType:'item',id:item.id,name:item.name,
    effect:null,native:false,nativeChanges:[],modifier:null,replacement:null,onUse:'none',actorOwned:false,
    combatMasterItem:item,combatMasterActor:actor,ferocity:true,
    parts:[{id:'combat-die-override',kind:'replacement',label:item.name,...step,defaultEnabled:false,warning,note}]};
}
function combatMasterEntry(actor,params) {
  if(params.kind!=='attack'||!params.usesCombatDie)return null;
  const step=combatDieStep(actor,params.formula);
  if(!step)return null;
  const item=(actor?.items?.contents??[]).find(item=>item.type==='ability' && item.uuid &&
    (item.system?.mechanics?.combatDieUpgrade===true || item.flags?.[SCOPE]?.contentId==='fnri7.rulebook.racial.master-boia'));
  if(!item)return null;
  const status=abilityAccountingStatus(actor,item);
  const warning=status?.remaining===0?game.i18n.localize('FASTNRI.GameReroll.exhausted'):null;
  const note=!warning && status?.remaining!=null?
    game.i18n.localize('FASTNRI.AbilityChat.dailyRemaining').replace('{remaining}',String(status.remaining)):null;
  return {uuid:`combat-master:${item.uuid}`,sourceUuid:item.uuid,sourceType:'item',id:item.id,name:item.name,
    effect:null,native:false,nativeChanges:[],modifier:null,replacement:null,onUse:'none',actorOwned:false,
    combatMasterItem:item,combatMasterActor:actor,
    parts:[{id:'combat-die-step',kind:'replacement',label:item.name,...step,defaultEnabled:false,warning,note}]};
}

/** Collect a unified list of selectable sources, using explicit Item rules only.
 * The fixed formula is a separate read-only catalog row, never an extra bonus.
 */
export function applicableRollContributions(actor,{sourceItem=null,weaponItem=null,...params}={}) {
  const effects=applicableRollEffects(actor,params);
  const source=cardContributionEntry(sourceItem,params);
  const weaponSource=weaponItem && weaponItem!==sourceItem ? cardContributionEntry(weaponItem,params) : null;
  const traits=weaponTraitEntry(weaponItem??(sourceItem?.type==='weapon'?sourceItem:null),params);
  const augments=attackAugmentEntries(actor,{...params,weaponItem:weaponItem??(sourceItem?.type==='weapon'?sourceItem:null)});
  // Passive class/race Items can explicitly contribute to other rolls.
  // Being present in inventory alone never makes a bonus automatic.
  const otherItems = [...(actor?.items?.contents ?? [])]
    .filter(item => item.uuid !== sourceItem?.uuid && item.uuid !== weaponItem?.uuid)
    .map(item => cardContributionEntry(item,params,{passive:true})).filter(Boolean);
  const rhythm=params.kind==='attack'?rhythmBonus(actor):0;
  const rhythmEntry=rhythm>0?{uuid:'class-rhythm',sourceType:'item',name:'Ритм',native:false,nativeChanges:[],onUse:'none',actorOwned:false,
    parts:[{id:'rhythm',kind:'modifier',label:'Ритм',value:String(rhythm)}]}:null;
  const role=roleContributionEntry(actor,params);
  const master=combatMasterEntry(actor,params);
  const ferocity=ferocityEntry(actor,params);
  return [...effects,...(rhythmEntry?[rhythmEntry]:[]),...(role?[role]:[]),...(master?[master]:[]),...(ferocity?[ferocity]:[]),...(source?[source]:[]),...(weaponSource?[weaponSource]:[]),
    ...(traits?[traits]:[]),...augments,...otherItems];
}

/** Stable per-change IDs are local to one ActiveEffect document. They are not
 * permanent change IDs across edits to the card; every roll discovers anew. */
export function selectedRollParts(entry) {
  const all = entry.parts ?? [
    ...(entry.nativeChanges ?? []).map((c,i)=>({id:`native-${c.index ?? i}`,kind:'native',...c})),
    ...(entry.modifier !== null && entry.modifier !== undefined ? [{id:'modifier',kind:'modifier',value:entry.modifier}]:[]),
    ...(entry.replacement ? [{id:'replacement',kind:'replacement',...entry.replacement}]:[])
  ];
  if (!Array.isArray(entry.enabledPartIds)) return all.filter(part=>part.defaultEnabled!==false);
  const allowed = new Set(entry.enabledPartIds);
  return all.filter(part => allowed.has(part.id));
}

/** Project a UI choice onto validated contributions without modifying source
 * ActiveEffect objects. A fully unchecked effect is omitted from the roll. */
export function selectRollParts(available, choice = {}) {
  return available.map(entry => {
    const provided = choice[entry.uuid];
    if (!Array.isArray(provided)) return {...entry,enabledPartIds:entry.parts
      .filter(part=>part.defaultEnabled!==false).map(part=>part.id)};
    const allowed = new Set(entry.parts.map(part => part.id));
    const ids = [...new Set(provided.filter(id => allowed.has(id)))];
    const enabledPartIds=entry.exclusiveParts?ids.slice(0,1):ids;
    return {...entry,enabledPartIds};
  }).filter(entry => selectedRollParts(entry).length > 0);
}

/** A calculated spatial modifier may depend on a selectable weapon property.
 * The gate controls whether it exists in THIS attack, not merely its numeric
 * contribution. Hidden alternatives are excluded from the calculation.
 */
function weaponTraitGateAllows(entry,selected) {
  const gate=entry?.weaponTraitGate;
  if(!gate)return true;
  const weapon=selected.find(row=>row.uuid===gate.entryUuid);
  const on=!!weapon && selectedRollParts(weapon).some(part=>part.id===gate.partId);
  return on===gate.enabled;
}

/** A bare −4/−6/−10 switch exists only when no source of that amount
 * is displayed in this particular preroll. Weapon property alternatives are
 * counted only if their per-attack trait gate currently allows them. */
function hindranceEntryAvailable(entry,selected,available){
  if(entry?.requiresAny?.length&&!entry.requiresAny.some(gate=>selected.some(row=>row.uuid===gate.entryUuid&&selectedRollParts(row).some(part=>part.id===gate.partId))))return false;
  if(!weaponTraitGateAllows(entry,selected))return false;
  if(!entry?.fallbackPenalty)return true;
  return !available.some(other=>other!==entry && !other.fallbackPenalty &&
    weaponTraitGateAllows(other,selected) &&
    other.parts?.some(p=>p.kind==='modifier' &&
      p.nonStackingGroup==='hindrance' && Number(p.value)===-entry.fallbackPenalty));
}

/** The property applies to THIS attack only. Turning off the weapon trait
 * restores ordinary penalties without rebuilding the dialog or changing Actor. */
function guidedBySelectedTrait(selected,weaponItem,sourceItem,attackProperties=''){
  const traits=weaponTraitOptions(weaponItem);
  const guided=traits.find(t=>String(t.label??'').toLowerCase()==='наводимое');
  const row=weaponItem?.uuid ? selected.find(e=>e.uuid===`weapon-traits:${weaponItem.uuid}`):null;
  const sourceGuided=/(?:^|[,;])\s*наводимое\s*(?:[,;]|$)/i.test(
    String(sourceItem?.system?.properties??''));
  if(sourceGuided)return true;
  if(guided)return !!row && selectedRollParts(row).some(p=>p.id===`trait-${guided.id}`);
  const own=String(attackProperties??'');
  if(/(?:^|[,;])\s*наводимое\s*(?:[,;]|$)/i.test(own) && !weaponItem)return true;
  // Only a non-selectable weapon property is always active. Selectable
  // properties must never be inferred from the Item's display text.
  return !guided && /(?:^|[,;])\s*наводимое\s*(?:[,;]|$)/i.test(
    String(weaponItem?.system?.properties??''));
}

function removeGuidedHindrance(selected,{weaponItem=null,sourceItem=null,attackProperties=''}={}){
  if(!guidedBySelectedTrait(selected,weaponItem,sourceItem,attackProperties))return selected;
  return selected.map(entry=>{
    const enabled=selectedRollParts(entry).filter(p=>p.nonStackingGroup!=='hindrance').map(p=>p.id);
    return {...entry,enabledPartIds:enabled};
  }).filter(entry=>selectedRollParts(entry).length);
}

/** Selection is per-component, not one master switch per source.
 * Group headers only organize the display. */
function partDescription(part) {
  if (part.kind === 'replacement') return `${part.from} → ${part.to}`;
  if (part.kind === 'activation') return pr('fromCard');
  if (part.kind === 'hindranceReduction') return `до ${part.value}`;
  return String(part.value ?? '');
}

/** Group only explicitly non-stacking components, not all positive modifiers.
 * Keep original per-component indices so existing DialogV2 reads selections.
 */
function sourceComponent(entry, part, i, j) {
  const grouped=part.nonStackingGroup;
  return `<label class="fnri-preroll-component fnri-preroll-choice${grouped?' fnri-preroll-stacking':''}"`+
    ` data-fnri-part-entry="${i}" data-fnri-part-index="${j}"`+
    (grouped?` data-fnri-nonstack="${safe(grouped)}"`:``)+
    (entry.fallbackPenalty?` data-fnri-hindrance-fallback="${entry.fallbackPenalty}"`:``)+`>`+
    `<input class="fnri-preroll-toggle" type="checkbox" name="part_${i}_${j}"`+
    `${part.defaultEnabled===false?'':' checked'}>`+
    `<span class="fnri-preroll-switch" aria-hidden="true"></span>`+
    `<span class="fnri-preroll-label">${safe(entry.fallbackPenalty ? '' :
      (part.label ?? (part.kind === 'native' ? part.key :
      part.kind === 'replacement' ? pr('replaceDie') : entry.name)))}</span>`+
    (grouped==='hindrance'?``:`<code>${safe(partDescription(part))}</code>`)+
    (part.warning?`<small class="fnri-preroll-warning">⚠ ${safe(part.warning)}</small>`:
      part.note?`<small class="fnri-preroll-stack-note">${safe(part.note)}</small>`:``)+
    `</label>`;
}

export function renderRollPreparation(effects, {label='',formula='',spatialInfo=null} = {}) {
  const groups=new Map(),hindrances=new Map(),other=[],specializations=[];
  for(const [i,entry] of effects.entries())for(const [j,part] of entry.parts.entries()){
    if(entry.sourceType==='specialization') {
      const group = entry.group ? game.i18n.localize(`FASTNRI.SkillGroups.${entry.group}`) : '';
      const label = group && group !== `FASTNRI.SkillGroups.${entry.group}` ? `${entry.name} · ${group}` : entry.name;
      specializations.push(sourceComponent(entry,{...part,label},i,j));
      continue;
    }
    const group=part.nonStackingGroup;
    if(group==='hindrance' && part.kind==='modifier'){
      const penalty=Number(part.value);
      if(!hindrances.has(penalty))hindrances.set(penalty,[]);
      hindrances.get(penalty).push(sourceComponent(entry,part,i,j));
      continue;
    }
    const html=sourceComponent(entry,part,i,j);
    if(group){
      if(!groups.has(group))groups.set(group,[]);
      groups.get(group).push(html);
    }else{
      let set=other.find(row=>row.uuid===entry.uuid);
      if(!set)other.push(set={uuid:entry.uuid,name:entry.name,parts:[]});
      set.parts.push(html);
    }
  }
  const penaltyOrder=[-4,-6,-10,...[...hindrances.keys()].filter(x=>![-4,-6,-10].includes(x)).sort((a,b)=>b-a)];
  const penaltyGroup=hindrances.size?`<div class="fnri-preroll-entry fnri-preroll-group fnri-hindrance-group">`+
    `<strong class="fnri-preroll-source">Штраф помехи</strong>`+
    `<small class="fnri-preroll-group-note">(не суммируются)</small>`+
    penaltyOrder.filter(n=>hindrances.has(n)).map(n=>
      `<div class="fnri-hindrance-level" data-fnri-hindrance-level="${Math.abs(n)}">`+
      `<strong class="fnri-hindrance-value">${n}</strong>`+
      `<div class="fnri-hindrance-sources">${hindrances.get(n).join('')}</div></div>`).join('')+
    `</div>`:'';
  const groupTitle={equipmentBonus:'Бонусы снаряжения'};
  const otherGroups=[...groups.keys()].map(group=>
    `<div class="fnri-preroll-entry fnri-preroll-group" data-fnri-group="${safe(group)}">`+
    `<strong class="fnri-preroll-source">${safe(groupTitle[group]??group)}</strong>`+
    groups.get(group).join('')+`</div>`).join('');
  const defaults=selectRollParts(effects);
  const rows=other.map(entry=>`<div class="fnri-preroll-entry"${effects.find(e=>e.uuid===entry.uuid)?.requiresAny?.length?` data-fnri-dependent-entry="${effects.findIndex(e=>e.uuid===entry.uuid)}"${hindranceEntryAvailable(effects.find(e=>e.uuid===entry.uuid),defaults,effects)?'':' style="display:none"'}`:''}>`+
    `<strong class="fnri-preroll-source">${safe(entry.name)}</strong>`+
    entry.parts.join('')+`</div>`).join('');
  return `<section class="fnri-preroll-list" data-fnri-preroll>`+
    `<details class="fnri-preroll-preview" open><summary><strong>${safe(pr('total'))}</strong>`+
      `<code data-fnri-preview-formula>${safe(formula)}</code></summary>`+
      `<div data-fnri-preview-breakdown></div></details>`+
    `<small data-fnri-preview-error role="status" aria-live="polite"></small>`+
    (label?`<p class="fnri-preroll-action">${safe(label)}</p>`:'')+
    (Number.isFinite(spatialInfo?.distanceSpaces)||Number.isFinite(spatialInfo?.spellRange) ? `<div class="fnri-spatial-info">`+
      `<small>Дистанция: ${safe(spatialInfo.distanceSpaces ?? '—')}${Number.isFinite(spatialInfo.spellRange)?` / ${safe(spatialInfo.spellRange)}`:''} клеток</small>`+
      (spatialInfo.spellRangeWarning?`<small class="fnri-spell-range-warning">${safe(spatialInfo.spellRangeWarning)}</small>`:'')+`</div>` : '')+
    `<div class="fnri-preroll-effects">${specializations.length?`<div class="fnri-preroll-entry fnri-preroll-group"><strong class="fnri-preroll-source">${safe(pr('specializations'))}</strong>${specializations.join('')}${specializations.length>1?`<small class="fnri-preroll-group-note">${safe(pr('multipleSpecializations'))}</small>`:''}</div>`:''}${penaltyGroup}${otherGroups}${rows}</div>`+
    `<div class="fnri-preroll-manual"><div class="fnri-preroll-manual-head">`+
      `<strong>${safe(pr('extra'))}</strong>`+
      `<button type="button" data-fnri-add-manual>+ ${safe(pr('add'))}</button></div>`+
      `<div class="fnri-preroll-manual-columns"><span>${safe(pr('value'))}</span><span>${safe(pr('comment'))}</span></div>`+
      `<div data-fnri-manual-list></div></div></section>`;
}

function manualRowHTML() {
  return `<div class="fnri-preroll-manual-row" data-fnri-manual-row>`+
    `<input type="text" data-fnri-manual-value placeholder="+1d6" aria-label="${safe(pr('value'))}">`+
    `<input type="text" data-fnri-manual-comment placeholder="${safe(pr('optional'))}" aria-label="${safe(pr('comment'))}">`+
    `<button type="button" data-fnri-remove-manual aria-label="${safe(pr('remove'))}">×</button></div>`;
}

/** Positive/negative fixed numbers or dice, each with an optional comment. */
export function sanitizeManualComponents(items=[]) {
  const result=[];
  for(const row of items) {
    const raw=String(row?.value??'').replace(/\s+/g,'');
    if (!raw) continue;
    if (!/^[+-]?(?:(?:\d+(?:\.\d+)?|\.\d+)|(?:[1-9]\d*)?d[1-9]\d*)$/i.test(raw))
      throw new Error(`${pr('invalid')}: ${raw}`);
    if (/^[+-]?(?:0+(?:\.0*)?|\.0+)$/.test(raw)) continue;
    result.push({value:raw,comment:String(row?.comment??'').trim().slice(0,200)});
  }
  return result;
}

export async function computeRollPreview({actor=null, available=[], selected=available,
  formula='', formulaForActor=null, manual=[],baseAdjustment=0} = {}) {
  const choices = new Map(selected.map(entry => [entry.uuid,entry]));
  const excluded = available.filter(entry => entry.effect && entry.native && !choices.has(entry.uuid));
  const partial = new Map();
  for (const entry of available) {
    if (!entry.native || !choices.has(entry.uuid)) continue;
    const enabled = new Set(selectedRollParts(choices.get(entry.uuid)).map(part => part.id));
    const omitted = entry.nativeChanges.filter(change => !enabled.has(change.id)).map(change => change.index);
    if (omitted.length) partial.set(entry.uuid, omitted);
  }
  const rollActor = await actorWithoutEffects(actor, excluded, partial);
  const rawBase = formulaForActor ? String(formulaForActor(rollActor) ?? '') : String(formula ?? '');
  const base = baseAdjustment ? `${rawBase} + (${baseAdjustment})` : rawBase;
  let priorCombatStep=null;
  selected=selected.flatMap(entry=>{
    if(entry.specializationId)return [preparedSpecializationEntry(entry,rollActor)].filter(row=>selectedRollParts(row).length);
    if(!entry.combatMasterItem)return [entry];
    const step=entry.ferocity?fixedCombatDieStep(rollActor,base):combatDieStep(rollActor,base);
    if(!step)return [];
    if(entry.ferocity&&priorCombatStep)step.from=priorCombatStep.to;
    if(!entry.ferocity)priorCombatStep=step;
    return [{...entry,parts:entry.parts.map(part=>({...part,...step}))}];
  });
  let expression = applyDirectRollModifiers(base, selected);
  const additions=sanitizeManualComponents(manual);
  for(const part of additions) expression += ` + (${part.value})`;
  if (!expression.trim()) throw new Error('empty-formula');
  if (typeof globalThis.Roll?.validate === 'function' && !Roll.validate(expression))
    throw new Error('invalid-formula');
  return {actor:rollActor,base,expression,selected,manual:additions,hindrance:hindranceSummary(selected)};
}

/** A d20 check always has a preroll; other formulas need a selectable part.
 * The generic manual input itself does not count as an available modifier.
 * Resolve authored roll-data references when the native helper is available.
 */
export function needsPreroll(formula, effects=[], {actor=null,skipDialog=false}={}) {
  if(skipDialog)return false;
  let expression=String(formula??'');
  if(expression.includes('@')&&typeof globalThis.Roll?.replaceFormulaData==='function')
    expression=Roll.replaceFormulaData(expression,actor?.getRollData?.()??{});
  return /(?<![\w.])(?:1)?d20(?!\d)/i.test(expression) ||
    effects.some(entry=>entry.parts?.length>0);
}

/** Handle DialogV2's built-in render callback, not an inline HTML event or
 * ApplicationV1 listener. Recompute via the SAME function used for rolling.
 * DialogV2 is not re-rendered on toggle: only its text preview is updated.
 */
export async function chooseRollEffects(effects, {actor=null, formula='',formulaForActor=null,
  skipDialog=false,label='',baseSource='',spatialInfo=null,
  weaponItem=null,sourceItem=null,attackProperties='' } = {}) {
  const baseFormula=formulaForActor?formulaForActor(actor):formula;
  if (!needsPreroll(baseFormula,effects,{actor,skipDialog})) {
    const defaults=selectRollParts(effects);
    const visible=defaults.filter(entry=>hindranceEntryAvailable(entry,defaults,effects));
    return {selected:removeGuidedHindrance(visible,{weaponItem,sourceItem,attackProperties}),manual:[]};
  }
  const content=renderRollPreparation(effects,{label,formula,baseSource,spatialInfo});
  const read=form=>{
    const choices={};
    for (const [i,entry] of effects.entries()) {
      choices[entry.uuid]=entry.parts.filter((_part,j)=>
        form?.elements?.namedItem?.(`part_${i}_${j}`)?.checked===true).map(part=>part.id);
    }
    const root=form?.querySelector?.('[data-fnri-preroll]') ?? form;
    const manual=sanitizeManualComponents([...(root?.querySelectorAll?.('[data-fnri-manual-row]')??[])]
      .map(row=>({value:row.querySelector('[data-fnri-manual-value]')?.value ?? '',
        comment:row.querySelector('[data-fnri-manual-comment]')?.value ?? ''})));
    const raw=selectRollParts(effects,choices);
    const visible=raw.filter(entry=>hindranceEntryAvailable(entry,raw,effects));
    return {selected:removeGuidedHindrance(visible,{weaponItem,sourceItem,attackProperties}),manual};
  };
  return await foundry.applications.api.DialogV2.wait({
    window:{title:pr('title')},content,rejectClose:false,
    render:(_event,dialog)=>{
      const root=dialog.element?.querySelector?.('[data-fnri-preroll]');
      if(!root || root.dataset.fnriBound) return;
      root.dataset.fnriBound='true';
      const form=root.closest('form')??dialog.element?.querySelector?.('form');
      const output=root.querySelector('[data-fnri-preview-formula]');
      const breakdown=root.querySelector('[data-fnri-preview-breakdown]');
      const errorOutput=root.querySelector('[data-fnri-preview-error]');
      const rollButton=dialog.element?.querySelector?.('button[data-action="roll"]');
      let revision=0;
      const update=async()=>{
        const current=++revision;
        if(errorOutput) errorOutput.textContent='';
        try {
          const choice=read(form);
          // The same space calculation is reused; a trait toggle simply
          // selects the matching already calculated alternative, without
          // changing targets or remeasuring the scene mid-preroll.
          const rawChoices={};
          for(const [i,entry] of effects.entries())rawChoices[entry.uuid]=entry.parts.filter((_part,j)=>
            form?.elements?.namedItem?.(`part_${i}_${j}`)?.checked===true).map(part=>part.id);
          const raw=selectRollParts(effects,rawChoices);
          for(const row of root.querySelectorAll('[data-fnri-part-entry]')){
            const entry=effects[Number(row.dataset.fnriPartEntry)];
            row.style.display=hindranceEntryAvailable(entry,raw,effects)?'':'none';
          }
          for(const group of root.querySelectorAll('[data-fnri-dependent-entry]')){
            const index=Number(group.dataset.fnriDependentEntry);
            const entry=effects[index];
            const visible=hindranceEntryAvailable(entry,raw,effects);
            group.style.display=visible?'':'none';
            if(!visible)for(const [j] of entry.parts.entries()){
              const input=form?.elements?.namedItem?.(`part_${index}_${j}`);
              if(input)input.checked=false;
            }
          }
          for(const level of root.querySelectorAll('[data-fnri-hindrance-level]')){
            const visible=[...level.querySelectorAll('[data-fnri-part-entry]')]
              .filter(row=>row.style.display!=='none');
            level.classList.toggle('fnri-hindrance-bare',visible.length===1 &&
              !!visible[0].dataset.fnriHindranceFallback);
          }
          const preview=await computeRollPreview({actor,available:effects,...choice,formula,formulaForActor});
          if(current!==revision)return;
          if(output)output.textContent=preview.expression;
          if(breakdown) {
            breakdown.replaceChildren();
            const add=(text,value)=>{
              const line=document.createElement('div');line.className='fnri-preroll-breakdown-row';
              const name=document.createElement('span');name.textContent=text;
              const amount=document.createElement('code');amount.textContent=String(value);
              line.append(name,amount);breakdown.append(line);
            };
            add(baseSource||pr('baseRoll'),preview.base);
            const grouped=nonStackingSelections(choice.selected);
            const biggest=grouped.get('hindrance')?.winner;
            let hindranceShown=false;
            for(const entry of preview.selected)for(const part of selectedRollParts(entry)){
              if(!['modifier','replacement','native'].includes(part.kind))continue;
              if(part.nonStackingGroup==='hindrance'){
                if(hindranceShown || !biggest || Number(part.value)!==Number(biggest.value))continue;
                hindranceShown=true;
                const reasons=choice.selected.flatMap(row=>selectedRollParts(row)
                  .filter(p=>p.nonStackingGroup==='hindrance' && Number(p.value)===Number(biggest.value))
                  .map(p=>row.fallbackPenalty?'':(p.label||row.name))).filter(Boolean);
                add(`Штраф помехи${reasons.length?' · '+[...new Set(reasons)].join(', '):''}`,preview.hindrance?.value??biggest.value);
                continue;
              }
              if(part.nonStackingGroup){
                const winner=grouped.get(part.nonStackingGroup)?.winner;
                if(winner?.entry!==entry.uuid||winner?.part!==part.id)continue;
              }
              add(`${entry.name} · ${part.label??(part.kind==='native'?part.key:pr('component'))}`,
                partDescription(part));
            }
            for(const [i,part] of choice.manual.entries())
              add(part.comment||`${pr('manual')} ${i+1}`,part.value);
          }
        } catch(error) {
          if(current!==revision)return;
          if(output) output.textContent='—';
          if(errorOutput)errorOutput.textContent=String(error.message??error);
        }
      };
      root.addEventListener('input',()=>{void update();});
      root.addEventListener('change',event=>{
        const row=event?.target?.closest?.('[data-fnri-part-entry]');
        const index=Number(row?.dataset.fnriPartEntry);
        if(event?.target?.checked && effects[index]?.exclusiveParts){
          for(const [j] of effects[index].parts.entries()){
            const input=form?.elements?.namedItem?.(`part_${index}_${j}`);
            if(input&&input!==event.target)input.checked=false;
          }
        }
        void update();
      });
      root.addEventListener('click',event=>{
        if(event.target.closest('[data-fnri-add-manual]')) {
          root.querySelector('[data-fnri-manual-list]')?.insertAdjacentHTML('beforeend',manualRowHTML());
          void update();
        }
        const remove=event.target.closest('[data-fnri-remove-manual]');
        if(remove){remove.closest('[data-fnri-manual-row]')?.remove();void update();}
      });
      void update();
    },
    buttons:[{action:'roll',label:pr('roll'),default:true,
      callback:async(_event,button)=>{
        const choice=read(button.form);
        await computeRollPreview({actor,available:effects,...choice,formula,formulaForActor});
        return choice;
      }},{action:'cancel',label:pr('cancel'),callback:()=>null}]
  });
}

/** Build an ephemeral Actor clone from source data; disable fully excluded
 * ActiveEffects and remove selected change rows for partially included effects.
 * The caller must not mutate already prepared Actor.system or the live Actor.
 */
export async function actorWithoutEffects(actor, excluded = [], partial = new Map()) {
  if (!excluded?.length && !partial.size) return actor;
  if (!actor?.toObject || !actor?.clone) throw new Error('Ephemeral Actor clone unavailable');
  const source = actor.toObject(true);
  const ids = new Set(excluded.map(e => e.uuid));
  const changed = new Set();
  const partialDone = new Set();
  const updateSourceEffect = (effect, original) => {
    if (!original?.uuid) return;
    if (ids.has(original.uuid)) {effect.disabled = true;changed.add(original.uuid);return;}
    if (!partial.has(original.uuid)) return;
    if (!Array.isArray(effect.system?.changes)) throw Error('Native ActiveEffect changes unavailable');
    const dropped = new Set(partial.get(original.uuid));
    if ([...dropped].some(i => !Number.isInteger(i) || i < 0 || i >= effect.system.changes.length))
      throw Error('Cannot isolate selected ActiveEffect change');
    effect.system.changes = effect.system.changes.filter((_change,i) => !dropped.has(i));
    partialDone.add(original.uuid);
  };
  for (const effect of source.effects ?? []) {
    const original = actor.effects?.get?.(effect._id ?? effect.id);
    updateSourceEffect(effect,original);
  }
  for (const item of source.items ?? []) {
    const originalItem = actor.items?.get?.(item._id ?? item.id);
    for (const effect of item.effects ?? []) {
      const original = originalItem?.effects?.get?.(effect._id ?? effect.id);
      updateSourceEffect(effect,original);
    }
  }
  if (changed.size !== ids.size || partialDone.size !== partial.size)
    throw Error('Cannot locate all excluded ActiveEffects in Actor source');
  const temporary = await actor.clone({effects:source.effects, items:source.items}, {keepId:true});
  if (!temporary || temporary === actor) throw Error('Ephemeral Actor clone failed');
  const clonedEffects = embeddedEffectsOf(temporary);
  // Embedded effect UUIDs can change on cloning. Match parent identity as well
  // as the effect ID so two Items with the same embedded ID cannot be confused.
  const matchClone = original => clonedEffects.find(e => e.id === original?.id &&
    e.parent?.documentName === original?.parent?.documentName &&
    (original?.parent?.documentName === 'Actor' || e.parent?.id === original?.parent?.id));
  for (const entry of excluded) {
    if (!matchClone(entry.effect)?.disabled) throw Error('Ephemeral clone failed to exclude effect');
  }
  for (const [uuid,indices] of partial) {
    const original = embeddedEffectsOf(actor).find(e => e.uuid === uuid);
    const updated = matchClone(original);
    if (!updated || updated.system?.changes?.length !== (original.system?.changes?.length ?? 0)-indices.length)
      throw Error('Ephemeral clone failed to filter ActiveEffect changes');
  }
  return temporary;
}

/** A group is selected per component. All checked penalties remain visible;
 * only the strongest numeric hindrance actually contributes to the formula.
 * This is NOT the same as deduplicating/removing entries from the dialog.
 */
export function hindranceSummary(selected=[]) {
  const group=nonStackingSelections(selected).get('hindrance');
  if(!group)return null;
  return {...effectiveHindrance(selected,group),candidates:group.candidates,
    counter:group.candidates.length,winner:group.winner};
}

/** Apply direct card roll changes (never persist to Actor). */
export function applyDirectRollModifiers(expression, selected) {
  let result = String(expression ?? '').trim();
  const winners=nonStackingSelections(selected);
  for (const entry of selected) {
    for (const part of selectedRollParts(entry)) {
    if (part.kind === 'replacement') {
      const {from,to} = part;
      // A situational minimum applies to the combat term after other selected
      // replacements, never to a matching skill or bonus die.
      if(part.minimumCombatDie===true){
        result=result.replace(/^(1d20\s*\+\s*)1d(4|6|8|10|12)(?![\w\d])/i,(_,prefix,faces)=>prefix+`1d${Math.max(Number(faces),Number(to.slice(2)))}`);
        continue;
      }
      // Replace one whole die term, not e.g. 1d8 inside 11d8 or 1d80.
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(^|[^\\w\\d])(${escaped})(?![\\w\\d])`, 'i');
      if (!rx.test(result)) throw Error(`Roll modifier ${entry.name}: required die ${from} absent`);
      result = result.replace(rx, (_whole,prefix) => prefix + to);
    }
    if (part.kind === 'modifier' && !part.nonStackingGroup) result += ` + (${part.value})`;
    }
  }
  for(const [group,winner] of winners){
    const value=group==='hindrance'?effectiveHindrance(selected,winner).value:winner.winner.value;
    if(Number(value)!==0)result += ` + (${value})`;
  }
  return result;
}

/** A check has a d20 in its base expression, not just in an optional addition.
 * Damage/healing amounts are not checks. Effect-ending callers identify their
 * purpose explicitly; do not infer it from the label or a localized name.
 * One synthetic contribution represents all currently active sources.
 */
export function frightenedCheckEntry(actor, {kind,formula='',formulaForActor=null,effectEnding=false}={}) {
  if (effectEnding || !['skill','attack','ability','intervention','maneuver'].includes(kind) || !isFrightened(actor)) return null;
  let expression=String((formulaForActor?formulaForActor(actor):formula) ?? '');
  if (expression.includes('@') && typeof globalThis.Roll?.replaceFormulaData==='function')
    expression=Roll.replaceFormulaData(expression,actor?.getRollData?.()??{});
  if (!/(?<![\w.])(?:[1-9]\d*)?d20(?!\d)/i.test(expression)) return null;
  const name=pr('frightened');
  return {uuid:'condition:frightened',sourceUuid:null,sourceType:'condition',
    id:'frightened',name,effect:null,native:false,nativeChanges:[],actorOwned:false,
    onUse:'none',modifier:'-2',replacement:null,
    parts:[{id:'check-modifier',kind:'modifier',label:name,value:'-2'}]};
}

/** Spatial off-guard changes the defensive characteristic at confirmation,
 * not the list of selectable roll modifiers. Already prepared conditions do not stack. */
export function surroundedDefenseAdjustment(actor,{defenseStat,defenseToken=null,usesDefenseStat=false,attackOffGuard=false}={}){
  if(!usesDefenseStat||!['awareness','fortitude','reflex','will'].includes(defenseStat)||isOffGuard(actor))return 0;
  return (attackOffGuard||defenseFormationForActor(actor,defenseToken)?.surrounded)?-2:0;
}

/** Shared roll preparation for skills, attacks, abilities and interventions. */
export async function prepareRoll({actor = null, kind, skillId = null, defenseStat = null,
  formula = '', formulaForActor = null, skipDialog = false, label = '',sourceItem=null,weaponItem=null,attackKind=null,
  extraEntries=[],prerollEntries=[],spatialInfo=null,targetActor=null,targetToken=null,attackProperties='',usesCombatDie=false,declaredTargets=[],declaredSpellWeapon=false,effectEnding=false,defenseToken=null,usesDefenseStat=false,attackOffGuard=false,attackDamage=false } = {}) {
  const frightened=frightenedCheckEntry(actor,{kind,formula,formulaForActor,effectEnding});
  const area=isAreaAttack(attackProperties);
  const isAttack=kind==='attack';
  const directed=isAttack && !area;
  const available = [...(kind==='skill' ? specializationEntries(actor,skillId) : []),
    ...(frightened?[frightened]:[]),
    ...applicableRollContributions(actor,{kind,skillId,defenseStat,formula,sourceItem,weaponItem,attackKind,attackProperties,usesCombatDie,declaredTargets,declaredSpellWeapon,attackDamage}),
    ...(Array.isArray(prerollEntries) ? prerollEntries : []),
    ...(directed && Array.isArray(extraEntries) ? extraEntries : []),
    ...(directed ? targetHindranceEntries({attacker:actor,target:targetActor,targetToken,area}) : []),
    ...(isAttack ? attackSituationalEntries() : [])];
  const choice = await chooseRollEffects(available,{actor,formula,formulaForActor,skipDialog,label,
    baseSource:sourceItem?.name??actor?.name??'',spatialInfo,
    weaponItem,sourceItem,attackProperties});
  if (choice === null) return null;
  const {manual} = choice;
  const baseAdjustment=kind==='intervention'&&!effectEnding?surroundedDefenseAdjustment(actor,{defenseStat,defenseToken,usesDefenseStat,attackOffGuard}):0;
  const defenseOffGuard=kind==='intervention'&&!effectEnding&&usesDefenseStat&&['awareness','fortitude','reflex','will'].includes(defenseStat)&&(baseAdjustment===-2||isOffGuard(actor));
  const {actor:rollActor,base,expression,selected} = await computeRollPreview({actor,available,selected:choice.selected,
    formula,formulaForActor,manual,baseAdjustment});
  return { actor: rollActor, base, expression, selected,defenseOffGuard,
    hindrance:hindranceSummary(selected),
    manual,contributions:buildRollContributionCatalog({actor,sourceItem,formula:baseAdjustment?base:formula,
      available:available.map(entry=>entry.combatMasterItem||entry.specializationId?(selected.find(row=>row.uuid===entry.uuid)??entry):entry),selected,manual}),
    snapshot:[...selected.map(x=>({uuid:x.uuid,name:x.name,sourceType:x.sourceType??'effect',native:x.native,
      nativeChanges:selectedRollParts(x).filter(p=>p.kind==='native'),
      components:selectedRollParts(x).map(({id,kind,key,value,type,from,to,nonStackingGroup})=>
        ({id,kind,key,value,type,from,to,nonStackingGroup})),
      modifier:selectedRollParts(x).some(p=>p.kind==='modifier')?x.modifier:null,
      replacement:selectedRollParts(x).some(p=>p.kind==='replacement')?x.replacement:null,
      onUse:x.onUse})),
      ...manual.map((part,i)=>({uuid:null,name:part.comment||`${pr('manual')} ${i+1}`,kind:'manual',modifier:part.value}))],
    excluded:available.filter(e=>!selected.some(s=>s.uuid===e.uuid)).map(e=>e.uuid),
    excludedComponents:available.flatMap(entry=>{
      const selectedEntry=selected.find(e=>e.uuid===entry.uuid);
      const enabled=new Set(selectedEntry?selectedRollParts(selectedEntry).map(p=>p.id):[]);
      return entry.parts.filter(p=>!enabled.has(p.id)).map(p=>({uuid:entry.uuid,partId:p.id}));
    }) };
}

/** Result-only label, never part of the selectable preroll contributions. */
export function defenseConditionSummary(context){
  return context?.defenseOffGuard ? ` · ${game.i18n.localize('FASTNRI.ModifierView.offGuard')} −2` : '';
}

/** ChatMessage flags are stored on the message, not under Actor permissions.
 * Do not put GM-only Actor source identifiers in a message whose audience
 * includes a non-GM. An unknown whisper recipient is conservatively treated
 * as a player. This is for stored provenance, not for roll visibility. */
export function redactActorSourceForAudience(actor, message) {
  if (!actor || actor.hasPlayerOwner === true) return false;
  const recipients = Array.isArray(message?.whisper) ? message.whisper : [];
  if (!recipients.length) return true;
  return recipients.some(id => game.users?.get?.(id)?.isGM !== true);
}

/** Do not expose metadata for hidden GM-controlled Actor effects through
 * flags of a public message. The numerical roll is still public, but names,
 * source UUIDs and internal change paths are not. This does not mutate the
 * local context used to spend eligible one-use effects. */
export function visibleRollInfluences(context, actor, mode='public') {
  const entries = context?.snapshot ?? [];
  if (!['public','ic'].includes(mode) || actor?.hasPlayerOwner === true || !actor) return entries;
  return entries.map(entry => entry.kind === 'situational' ? entry :
    {name:pr('hiddenInfluence'),native:entry.native,modifier:null,replacement:null,onUse:'none'});
}

/** Invoked only after a message has actually been created. No effect history. */
export async function finalizeRollEffects(context, message) {
  // A rejected/unsaved ChatMessage payload must never consume a one-use effect.
  if (!message?.id || !context) return;
  for (const entry of context.selected) {
    if(entry.combatMasterItem)await finishCardAccounting({actor:entry.combatMasterActor,item:entry.combatMasterItem,message,actionId:message.id});
    if (!entry.actorOwned || entry.onUse === 'none' || pendingUse.has(entry.effect)) continue;
    const effect = entry.effect;
    if (!effect?.parent?.isOwner || effect.disabled || !effect.parent.effects?.get?.(effect.id)) continue;
    pendingUse.add(effect);
    try {
      if (entry.onUse === 'remove') await effect.delete();
      else if (entry.onUse === 'disable') await effect.update({disabled:true});
    } catch (error) {
      console.error('Fast NRI | Could not finish one-use ActiveEffect',error);
      globalThis.ui?.notifications?.warn?.(pr('consumeFailed'));
    } finally {pendingUse.delete(effect);}
  }
}

/** Resolve independently selectable additions into actual damage parts.
 * Positive fixed additions are one fixed "die" each; penalties stay negative
 * and never turn into positive die results. */
export function damageComponentDefinitions(context) {
  const inputs=[];
  for(const entry of context?.selected ?? [])
    for(const part of selectedRollParts(entry)) {
      if(part.kind!=='modifier') continue;
      inputs.push({value:String(part.value),source:`${entry.sourceUuid??entry.uuid}::${part.id}`,
        damageType:part.damageType??'',traits:part.traits??[]});
    }
  for(const [i,part] of (context?.manual ?? []).entries())
    inputs.push({value:String(part.value),source:part.comment||`manual-${i+1}`});
  const definitions=[];
  for(const input of inputs) {
    const v=input.value.trim().replace(/\s+/g,'');
    const match=/^([+-]?)([1-9]\d*)?d([1-9]\d*)$/i.exec(v);
    if(match) {
      const sign=match[1]==='-'?-1:1;
      const count=Number(match[2]??1),faces=Number(match[3]);
      if(!Number.isSafeInteger(count)||count>1000)throw Error('Too many damage dice');
      for(let j=0;j<count;j++)definitions.push({id:`bonus-${definitions.length}`,kind:'die',faces,
        sign,formula:`1d${faces}`,source:input.source,damageType:input.damageType??'',traits:input.traits??[]});
    }else {
      const value=Number(v);
      if(!Number.isFinite(value))throw Error('Invalid damage addition');
      if(value!==0) definitions.push({id:`bonus-${definitions.length}`,kind:'fixed',value,
        formula:v,source:input.source,damageType:input.damageType??'',traits:input.traits??[]});
    }
  }
  return definitions;
}

/** Align the independently editable damage parts with the FINAL damage formula.
 * Direct card replacements can change a die's faces or number (1d6 -> 2d8).
 * Replaying the exact sequence of replacements and additions on component
 * groups keeps the snapshot aligned with the evaluated Roll without guessing
 * individual results from its aggregate total.
 *
 * Every profile adapter supplies one base expression term per definition.
 */
export function preparedDamageDefinitions(baseParts, context) {
  if (!Array.isArray(baseParts) || !baseParts.length) throw Error('Missing damage definitions');
  const additions = damageComponentDefinitions(context);
  let additionIndex=0;
  const occupied=new Set([...baseParts,...additions].map(part=>part.id));
  let addedId=1;
  const newId=()=>{
    while(occupied.has(`replacement-${addedId}`))addedId++;
    const id=`replacement-${addedId++}`;
    occupied.add(id);
    return id;
  };
  const segments=baseParts.map((part,index)=>({
    text:`${index?' + ':''}${String(part.formula??'')}`,
    parts:[{...part}]
  }));
  const pushModifier=value=>{
    const raw=String(value??'').replace(/\s+/g,'');
    const die=/^([+-]?)([1-9]\d*)?d([1-9]\d*)$/i.exec(raw);
    const count=die?Number(die[2]??1):(Number(raw)!==0?1:0);
    if (!Number.isSafeInteger(count) || count<0 || count>1000)
      throw Error('Invalid damage component count');
    const parts=additions.slice(additionIndex,additionIndex+count);
    if(parts.length!==count)throw Error('Damage component mapping mismatch');
    additionIndex+=count;
    segments.push({text:` + (${value})`,parts});
  };
  const replaceDie=(entry,part)=>{
    const from=String(part.from??'').trim(),to=String(part.to??'').trim();
    const parse=value=>/^(?:([1-9]\d*)?)d([1-9]\d*)$/i.exec(value);
    const previous=parse(from),next=parse(to);
    if(!previous||!next)throw Error('Invalid damage die replacement');
    const oldCount=Number(previous[1]??1),oldFaces=Number(previous[2]);
    const nextCount=Number(next[1]??1),nextFaces=Number(next[2]);
    if(!Number.isSafeInteger(nextCount)||nextCount>1000 || !Number.isSafeInteger(nextFaces))
      throw Error('Invalid replacement dice');
    // Use exactly the boundary rule of applyDirectRollModifiers(). A given
    // replacement affects only the first matching die term in formula order.
    const escaped=from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const rx=new RegExp(`(^|[^\\w\\d])(${escaped})(?![\\w\\d])`,'i');
    const segment=segments.find(candidate=>rx.test(candidate.text));
    if(!segment)throw Error(`Roll modifier ${entry.name}: required die ${from} absent`);
    if(segment.parts.length!==oldCount || segment.parts.some(d=>
      d.kind!=='die' || d.faces!==oldFaces))
      throw Error('Replacement does not map to independent damage dice');
    const previousParts=segment.parts;
    segment.parts=Array.from({length:nextCount},(_unused,index)=>({
      ...previousParts[Math.min(index,previousParts.length-1)],
      id:index<previousParts.length?previousParts[index].id:newId(),
      faces:nextFaces,formula:`1d${nextFaces}`
    }));
    segment.text=segment.text.replace(rx,(_whole,prefix)=>prefix+to);
  };
  for(const entry of context?.selected??[])
    for(const part of selectedRollParts(entry)) {
      if(part.kind==='replacement')replaceDie(entry,part);
      else if(part.kind==='modifier')pushModifier(part.value);
    }
  for(const part of context?.manual??[])pushModifier(part.value);
  if(additionIndex!==additions.length)throw Error('Unmapped additional damage components');
  // Check that the component replay equals the actually prepared expression;
  // do not silently infer dice from a modified/unsupported formula.
  if(segments.map(segment=>segment.text).join('')!==String(context?.expression??''))
    throw Error('Prepared damage expression differs from component mapping');
  return segments.flatMap(segment=>segment.parts);
}

/** Explicit positive/negative FIXED bonuses for attack/check roll editor.
 * The source formula remains one immutable base; no guessing its internals. */
export function fixedRollComponents(context,{redact=false}={}) {
  const result=[];
  const add=(value,label,source)=>{
    if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value).trim()))return;
    const number=Number(value);
    if(!Number.isFinite(number)||number===0)return;
    result.push({id:`fixed-${result.length}`,kind:'fixed',original:number,value:number,
      label:redact?pr('fixedComponent'):label,
      source:redact?null:source,formula:String(value),excluded:false});
  };
  const winners=nonStackingSelections(context?.selected??[]);
  for(const entry of context?.selected??[])
    for(const part of selectedRollParts(entry)) {
      if(part.kind!=='modifier')continue;
      // The editor may change only a term actually included in the Roll.
      // Other checked sources of hindrance remain in the preroll catalog.
      if(part.nonStackingGroup){
        const winner=winners.get(part.nonStackingGroup)?.winner;
        if(winner?.entry!==entry.uuid||winner?.part!==part.id)continue;
      }
      const value=part.nonStackingGroup==='hindrance'?effectiveHindrance(context.selected,winners.get('hindrance')).value:part.value;
      add(value,`${entry.name}: ${part.label??pr('component')}`,entry.sourceUuid??entry.uuid);
    }
  for(const [i,part] of (context?.manual??[]).entries())
    add(part.value,part.comment||`${pr('manual')} ${i+1}`,null);
  return result;
}
